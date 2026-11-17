import { Router } from 'express';
import { and, desc, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import QRCode from 'qrcode';
import { db } from '../../db/index.ts';
import {
  loginSessions,
  recruiters,
  roles,
  systemSettings,
  twoFactorSettings,
  userRoles,
  users,
} from '../../db/schema.ts';
import { ensureCoreMetadata, seedEnterpriseSampleData } from '../../db/seed.ts';
import { adminAuth } from '../../lib/firebase-admin.ts';
import {
  buildOtpauthUrl,
  decryptString,
  encryptString,
  generateNumericOtp,
  generateRandomToken,
  generateTotpSecret,
  hashPassword,
  sha256,
  verifyPassword,
  verifyTotpToken,
} from '../security.ts';
import {
  type AuthenticatedRequest,
  getClientIp,
  rateLimit,
  requireAuth,
} from '../middleware.ts';
import { recordAuditLog } from '../audit.ts';
import { isSmtpConfigured, sendEmailNotification } from '../mailer.ts';

const router = Router();

// Short-lived in-memory 2FA challenge store (expires in 5 minutes)
interface TwoFactorChallenge {
  userId: number;
  email: string;
  expiresAt: number;
  emailOtpHash?: string;
  emailOtpExpiresAt?: number;
}
const pending2faChallenges = new Map<string, TwoFactorChallenge>();

const parseDeviceLabel = (ua: string): string => {
  if (/mobile|android|iphone/i.test(ua)) return 'Mobile Browser';
  if (/ipad|tablet/i.test(ua)) return 'Tablet Browser';
  if (/edg/i.test(ua)) return 'Microsoft Edge';
  if (/chrome/i.test(ua)) return 'Google Chrome';
  if (/firefox/i.test(ua)) return 'Mozilla Firefox';
  if (/safari/i.test(ua)) return 'Apple Safari';
  return 'Web Client';
};

async function getSettingNumber(key: string, fallback: number): Promise<number> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
  const parsed = row ? Number(row.value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function getSettingBool(key: string, fallback: boolean): Promise<boolean> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
  if (!row) return fallback;
  return row.value === 'true';
}

function getSessionCookieOptions(req: AuthenticatedRequest, expires?: Date) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || '');
  const isHttps = req.secure || proto.split(',')[0].trim() === 'https';
  return {
    httpOnly: true,
    sameSite: (isHttps ? 'none' : 'lax') as 'none' | 'lax',
    secure: isHttps,
    ...(expires ? { expires } : {}),
    path: '/',
  };
}

async function createSessionForUser(
  userId: number,
  req: AuthenticatedRequest,
  res: any,
): Promise<string> {
  const ttlHours = await getSettingNumber('session_ttl_hours', 24);
  const rawSession = generateRandomToken(32);
  const tokenHash = sha256(rawSession);
  const ua = String(req.headers['user-agent'] || 'Unknown');
  const ip = getClientIp(req);
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);

  await db.insert(loginSessions).values({
    userId,
    sessionTokenHash: tokenHash,
    deviceInfo: parseDeviceLabel(ua),
    ipAddress: ip,
    userAgent: ua.slice(0, 300),
    isActive: true,
    expiresAt,
  });

  await db
    .update(users)
    .set({ lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null })
    .where(eq(users.id, userId));

  res.cookie('nhr_session', rawSession, getSessionCookieOptions(req, expiresAt));
  return rawSession;
}

router.get('/setup-status', async (_req, res) => {
  try {
    await ensureCoreMetadata();
    const existing = await db.select({ id: users.id }).from(users).limit(1);
    const enforce2fa = await getSettingBool('enforce_2fa_all_internal', false);
    res.json({
      setupRequired: existing.length === 0,
      enforce2fa,
      smtpConfigured: isSmtpConfigured(),
    });
  } catch (error) {
    console.error('Setup status error:', error);
    res.status(500).json({ error: 'Unable to check portal initialization status.' });
  }
});

const initialSetupSchema = z.object({
  fullName: z.string().min(2).max(100),
  email: z.string().email(),
  phone: z.string().min(8).max(20).optional(),
  password: z.string().min(8).max(128),
  initializeSampleData: z.boolean().optional(),
  createDemoTeamAccounts: z.boolean().optional(),
  demoTeamPassword: z.string().min(8).max(128).optional(),
});

router.post('/initial-setup', rateLimit(60_000, 10, 'initial-setup'), async (req, res) => {
  try {
    await ensureCoreMetadata();
    const existing = await db.select({ id: users.id }).from(users).limit(1);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Workspace is already initialized. Please sign in.' });
    }

    const parsed = initialSetupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid setup details provided.' });
    }

    const data = parsed.data;
    const allRoles = await db.select().from(roles);
    const roleMap = new Map(allRoles.map((r) => [r.name, r.id]));
    const superAdminRoleId = roleMap.get('SUPER_ADMIN');
    if (!superAdminRoleId) {
      return res.status(500).json({ error: 'Roles metadata missing.' });
    }

    const [superUser] = await db
      .insert(users)
      .values({
        uid: `usr_${generateRandomToken(12)}`,
        email: data.email.toLowerCase(),
        fullName: data.fullName.trim(),
        phone: data.phone?.trim() || null,
        passwordHash: await hashPassword(data.password),
        roleId: superAdminRoleId,
        isActive: true,
      })
      .returning();

    await db.insert(userRoles).values({
      userId: superUser.id,
      roleId: superAdminRoleId,
      assignedBy: superUser.id,
    });

    let primaryRecruiterId: number | undefined;
    if (data.createDemoTeamAccounts && data.demoTeamPassword) {
      const adminRoleId = roleMap.get('ADMIN')!;
      const recRoleId = roleMap.get('RECRUITER')!;
      const demoHash = await hashPassword(data.demoTeamPassword);

      const [adminUser] = await db
        .insert(users)
        .values({
          uid: `usr_${generateRandomToken(12)}`,
          email: 'admin@9hrindia.com',
          fullName: 'Meera Krishnan (HR Admin)',
          phone: '+91 98200 10002',
          passwordHash: demoHash,
          roleId: adminRoleId,
          isActive: true,
        })
        .returning();

      const [recUser] = await db
        .insert(users)
        .values({
          uid: `usr_${generateRandomToken(12)}`,
          email: 'recruiter@9hrindia.com',
          fullName: 'Arjun Mehta (Lead Recruiter)',
          phone: '+91 98200 10003',
          passwordHash: demoHash,
          roleId: recRoleId,
          isActive: true,
        })
        .returning();

      await db.insert(userRoles).values([
        { userId: adminUser.id, roleId: adminRoleId, assignedBy: superUser.id },
        { userId: recUser.id, roleId: recRoleId, assignedBy: superUser.id },
      ]);

      const [recProfile] = await db
        .insert(recruiters)
        .values({
          userId: recUser.id,
          employeeCode: '9HR-REC-001',
          department: 'Technology & Leadership Hiring',
          specialization: 'Engineering & Cloud',
          targetMonthlyHires: 8,
        })
        .returning();
      primaryRecruiterId = recProfile.id;
    }

    if (data.initializeSampleData !== false) {
      await seedEnterpriseSampleData(superUser.id, primaryRecruiterId);
    }

    const sessionToken = await createSessionForUser(superUser.id, req as AuthenticatedRequest, res);
    await recordAuditLog({
      actorUserId: superUser.id,
      actorEmail: superUser.email,
      actorRole: 'SUPER_ADMIN',
      action: 'INITIAL_SUPER_ADMIN_CREATED',
      targetType: 'USER',
      targetId: superUser.id,
      ipAddress: getClientIp(req),
    });

    res.status(201).json({
      message: '9HR India Enterprise Portal initialized successfully.',
      sessionToken,
      user: {
        id: superUser.id,
        email: superUser.email,
        fullName: superUser.fullName,
        roleName: 'SUPER_ADMIN',
      },
    });
  } catch (error) {
    console.error('Initial setup error:', error);
    res.status(500).json({ error: 'Failed to initialize enterprise workspace.' });
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', rateLimit(60_000, 15, 'login'), async (req, res) => {
  try {
    await ensureCoreMetadata();
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Please enter a valid email and password.' });
    }

    const email = parsed.data.email.toLowerCase();
    const [userRow] = await db.select().from(users).where(eq(users.email, email));
    if (!userRow || !userRow.passwordHash) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (!userRow.isActive) {
      return res.status(403).json({ error: 'This account is deactivated. Contact your Super Admin.' });
    }

    if (userRow.lockedUntil && userRow.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((userRow.lockedUntil.getTime() - Date.now()) / 60_000);
      return res.status(423).json({
        error: `Account temporarily locked due to failed attempts. Try again in ${minutesLeft} minute(s).`,
      });
    }

    const valid = await verifyPassword(parsed.data.password, userRow.passwordHash);
    if (!valid) {
      const maxAttempts = await getSettingNumber('max_failed_login_attempts', 5);
      const lockoutMins = await getSettingNumber('lockout_duration_minutes', 15);
      const nextAttempts = userRow.failedLoginAttempts + 1;
      const shouldLock = nextAttempts >= maxAttempts;

      await db
        .update(users)
        .set({
          failedLoginAttempts: nextAttempts,
          lockedUntil: shouldLock ? new Date(Date.now() + lockoutMins * 60_000) : null,
        })
        .where(eq(users.id, userRow.id));

      await recordAuditLog({
        actorUserId: userRow.id,
        actorEmail: userRow.email,
        actorRole: 'UNKNOWN',
        action: shouldLock ? 'ACCOUNT_LOCKED' : 'FAILED_LOGIN',
        targetType: 'USER',
        targetId: userRow.id,
        details: { attempts: nextAttempts },
        ipAddress: getClientIp(req),
      });

      return res.status(401).json({
        error: shouldLock
          ? `Account locked for ${lockoutMins} minutes after ${maxAttempts} failed attempts.`
          : 'Invalid email or password.',
      });
    }

    const [roleRow] = await db.select().from(roles).where(eq(roles.id, userRow.roleId));
    const [twoFactor] = await db
      .select()
      .from(twoFactorSettings)
      .where(eq(twoFactorSettings.userId, userRow.id));

    const enforceAll2fa = await getSettingBool('enforce_2fa_all_internal', false);
    const needs2fa = Boolean(twoFactor?.enabled) || enforceAll2fa;

    if (needs2fa) {
      const challengeToken = generateRandomToken(24);
      const methods: string[] = [];
      if (twoFactor?.enabled && twoFactor.secretEncrypted) {
        methods.push('TOTP', 'BACKUP_CODE');
      }
      methods.push('EMAIL_OTP');

      // Generate an Email OTP automatically if TOTP isn't enrolled yet
      let devOtpPreview: string | undefined;
      const challenge: TwoFactorChallenge = {
        userId: userRow.id,
        email: userRow.email,
        expiresAt: Date.now() + 5 * 60 * 1000,
      };

      if (!twoFactor?.enabled) {
        const otp = generateNumericOtp(6);
        challenge.emailOtpHash = sha256(otp);
        challenge.emailOtpExpiresAt = Date.now() + 5 * 60 * 1000;
        const mailRes = await sendEmailNotification({
          to: userRow.email,
          subject: '9HR India Portal — Login Verification OTP',
          text: `Your 6-digit login verification OTP is ${otp}. Valid for 5 minutes.`,
        });
        if (!mailRes.delivered && process.env.NODE_ENV !== 'production') {
          devOtpPreview = otp;
        }
      }

      pending2faChallenges.set(challengeToken, challenge);
      return res.json({
        requires2fa: true,
        challengeToken,
        methods,
        devOtpPreview,
      });
    }

    const sessionToken = await createSessionForUser(userRow.id, req as AuthenticatedRequest, res);
    await recordAuditLog({
      actorUserId: userRow.id,
      actorEmail: userRow.email,
      actorRole: roleRow?.name || 'USER',
      action: 'USER_LOGIN',
      targetType: 'SESSION',
      targetId: userRow.id,
      ipAddress: getClientIp(req),
    });

    res.json({ requires2fa: false, message: 'Signed in successfully.', sessionToken });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Authentication service encountered an error.' });
  }
});

router.post('/2fa/send-email-otp', rateLimit(60_000, 5, '2fa-otp'), async (req, res) => {
  const { challengeToken } = req.body as { challengeToken?: string };
  if (!challengeToken) return res.status(400).json({ error: 'Missing challenge token.' });
  const challenge = pending2faChallenges.get(challengeToken);
  if (!challenge || challenge.expiresAt < Date.now()) {
    return res.status(401).json({ error: '2FA challenge expired. Please log in again.' });
  }

  const otp = generateNumericOtp(6);
  challenge.emailOtpHash = sha256(otp);
  challenge.emailOtpExpiresAt = Date.now() + 5 * 60 * 1000;

  const mailRes = await sendEmailNotification({
    to: challenge.email,
    subject: '9HR India Portal — 2FA Email OTP',
    text: `Your 6-digit verification code is ${otp}. Valid for 5 minutes.`,
  });

  res.json({
    sent: true,
    mode: mailRes.mode,
    devOtpPreview: !mailRes.delivered && process.env.NODE_ENV !== 'production' ? otp : undefined,
  });
});

router.post('/2fa/verify', rateLimit(60_000, 10, '2fa-verify'), async (req, res) => {
  try {
    const { challengeToken, code, method } = req.body as {
      challengeToken?: string;
      code?: string;
      method?: 'TOTP' | 'BACKUP_CODE' | 'EMAIL_OTP';
    };

    if (!challengeToken || !code) {
      return res.status(400).json({ error: 'Verification code is required.' });
    }

    const challenge = pending2faChallenges.get(challengeToken);
    if (!challenge || challenge.expiresAt < Date.now()) {
      pending2faChallenges.delete(challengeToken || '');
      return res.status(401).json({ error: '2FA session expired. Please sign in again.' });
    }

    const [userRow] = await db.select().from(users).where(eq(users.id, challenge.userId));
    if (!userRow || !userRow.isActive) {
      return res.status(403).json({ error: 'User account unavailable.' });
    }
    const [roleRow] = await db.select().from(roles).where(eq(roles.id, userRow.roleId));
    const [twoFactor] = await db
      .select()
      .from(twoFactorSettings)
      .where(eq(twoFactorSettings.userId, userRow.id));

    let verified = false;
    const cleanCode = code.trim().toUpperCase();

    if (method === 'EMAIL_OTP') {
      if (
        challenge.emailOtpHash &&
        challenge.emailOtpExpiresAt &&
        challenge.emailOtpExpiresAt > Date.now() &&
        sha256(cleanCode) === challenge.emailOtpHash
      ) {
        verified = true;
      }
    } else if (method === 'BACKUP_CODE' && twoFactor) {
      const codeHash = sha256(cleanCode);
      const remaining = twoFactor.backupCodesHashJson.filter((h) => h !== codeHash);
      if (remaining.length < twoFactor.backupCodesHashJson.length) {
        verified = true;
        await db
          .update(twoFactorSettings)
          .set({ backupCodesHashJson: remaining, updatedAt: new Date() })
          .where(eq(twoFactorSettings.id, twoFactor.id));
      }
    } else if (twoFactor?.secretEncrypted) {
      const secret = decryptString(twoFactor.secretEncrypted);
      verified = verifyTotpToken(secret, cleanCode);
    }

    if (!verified) {
      return res.status(401).json({ error: 'Invalid verification code.' });
    }

    pending2faChallenges.delete(challengeToken);
    const sessionToken = await createSessionForUser(userRow.id, req as AuthenticatedRequest, res);
    await recordAuditLog({
      actorUserId: userRow.id,
      actorEmail: userRow.email,
      actorRole: roleRow?.name || 'USER',
      action: 'USER_LOGIN_2FA_VERIFIED',
      targetType: 'SESSION',
      targetId: userRow.id,
      details: { method: method || 'TOTP' },
      ipAddress: getClientIp(req),
    });

    res.json({ verified: true, sessionToken });
  } catch (error) {
    console.error('2FA verify error:', error);
    res.status(500).json({ error: 'Failed to verify 2FA code.' });
  }
});

// Firebase Google Sign-In bridge
router.post('/firebase', rateLimit(60_000, 15, 'firebase-auth'), async (req, res) => {
  try {
    await ensureCoreMetadata();
    const { idToken } = req.body as { idToken?: string };
    if (!idToken) {
      return res.status(400).json({ error: 'Missing Firebase ID token.' });
    }

    const decoded = await adminAuth.verifyIdToken(idToken);
    const email = (decoded.email || `${decoded.uid}@firebase.local`).toLowerCase();

    let [userRow] = await db.select().from(users).where(eq(users.uid, decoded.uid));
    if (!userRow) {
      [userRow] = await db.select().from(users).where(eq(users.email, email));
      if (userRow) {
        await db.update(users).set({ uid: decoded.uid }).where(eq(users.id, userRow.id));
      }
    }

    if (!userRow) {
      const existing = await db.select({ id: users.id }).from(users).limit(1);
      const roleName = existing.length === 0 ? 'SUPER_ADMIN' : 'RECRUITER';
      const [roleRow] = await db.select().from(roles).where(eq(roles.name, roleName));
      if (!roleRow) return res.status(500).json({ error: 'Roles unavailable.' });

      const [created] = await db
        .insert(users)
        .values({
          uid: decoded.uid,
          email,
          fullName: decoded.name || email.split('@')[0],
          roleId: roleRow.id,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: { email, lastLoginAt: new Date() },
        })
        .returning();
      userRow = created;

      await db.insert(userRoles).values({
        userId: userRow.id,
        roleId: roleRow.id,
        assignedBy: userRow.id,
      }).onConflictDoNothing();

      if (roleName === 'RECRUITER') {
        await db
          .insert(recruiters)
          .values({
            userId: userRow.id,
            employeeCode: `9HR-REC-${String(userRow.id).padStart(3, '0')}`,
          })
          .onConflictDoNothing();
      } else if (roleName === 'SUPER_ADMIN') {
        await seedEnterpriseSampleData(userRow.id);
      }
    }

    if (!userRow.isActive) {
      return res.status(403).json({ error: 'Account deactivated by administrator.' });
    }

    const [roleRow] = await db.select().from(roles).where(eq(roles.id, userRow.roleId));
    const sessionToken = await createSessionForUser(userRow.id, req as AuthenticatedRequest, res);
    await recordAuditLog({
      actorUserId: userRow.id,
      actorEmail: userRow.email,
      actorRole: roleRow?.name || 'RECRUITER',
      action: 'USER_LOGIN_GOOGLE_OAUTH',
      targetType: 'SESSION',
      targetId: userRow.id,
      ipAddress: getClientIp(req),
    });

    res.json({ signedIn: true, sessionToken });
  } catch (error) {
    console.error('Firebase auth error:', error);
    res.status(401).json({ error: 'Google Sign-In verification failed.' });
  }
});

router.post('/forgot-password', rateLimit(60_000, 5, 'forgot-pw'), async (req, res) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const [userRow] = await db.select().from(users).where(eq(users.email, email));
    let devResetToken: string | undefined;

    if (userRow && userRow.isActive) {
      const rawToken = generateRandomToken(24);
      await db
        .update(users)
        .set({
          passwordResetTokenHash: sha256(rawToken),
          passwordResetExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
        })
        .where(eq(users.id, userRow.id));

      const baseUrl = process.env.APP_URL || 'http://localhost:3000';
      const resetLink = `${baseUrl}/reset-password?token=${rawToken}`;
      const mailRes = await sendEmailNotification({
        to: userRow.email,
        subject: '9HR India Portal — Password Reset Instructions',
        text: `Reset your password using this link (valid for 30 minutes): ${resetLink}`,
      });

      if (!mailRes.delivered && process.env.NODE_ENV !== 'production') {
        devResetToken = rawToken;
      }

      await recordAuditLog({
        actorUserId: userRow.id,
        actorEmail: userRow.email,
        actorRole: 'USER',
        action: 'PASSWORD_RESET_REQUESTED',
        targetType: 'USER',
        targetId: userRow.id,
        ipAddress: getClientIp(req),
      });
    }

    res.json({
      message: 'If an active account matches that email, password reset instructions have been issued.',
      devResetToken,
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Unable to process password reset request.' });
  }
});

router.post('/reset-password', rateLimit(60_000, 10, 'reset-pw'), async (req, res) => {
  try {
    const schema = z.object({
      token: z.string().min(16),
      newPassword: z.string().min(8).max(128),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Valid token and password (min 8 chars) required.' });
    }

    const tokenHash = sha256(parsed.data.token);
    const [userRow] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.passwordResetTokenHash, tokenHash),
          gt(users.passwordResetExpiresAt, new Date()),
        ),
      );

    if (!userRow) {
      return res.status(400).json({ error: 'Password reset token is invalid or expired.' });
    }

    await db
      .update(users)
      .set({
        passwordHash: await hashPassword(parsed.data.newPassword),
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userRow.id));

    await db
      .update(loginSessions)
      .set({ isActive: false })
      .where(eq(loginSessions.userId, userRow.id));

    await recordAuditLog({
      actorUserId: userRow.id,
      actorEmail: userRow.email,
      actorRole: 'USER',
      action: 'PASSWORD_RESET_COMPLETED',
      targetType: 'USER',
      targetId: userRow.id,
      ipAddress: getClientIp(req),
    });

    res.json({ message: 'Password updated successfully. Please sign in.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

router.get('/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const authUser = req.authUser!;
    const [twoFactor] = await db
      .select()
      .from(twoFactorSettings)
      .where(eq(twoFactorSettings.userId, authUser.id));

    res.json({
      user: {
        ...authUser,
        twoFactorEnabled: Boolean(twoFactor?.enabled),
        backupCodesRemaining: twoFactor?.backupCodesHashJson?.length || 0,
      },
    });
  } catch (error) {
    console.error('Auth me error:', error);
    res.status(500).json({ error: 'Unable to fetch user profile.' });
  }
});

router.post('/logout', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    if (req.authUser?.sessionId) {
      await db
        .update(loginSessions)
        .set({ isActive: false })
        .where(eq(loginSessions.id, req.authUser.sessionId));
    }
    res.clearCookie('nhr_session', getSessionCookieOptions(req as AuthenticatedRequest));
    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.roleName,
      action: 'USER_LOGOUT',
      targetType: 'SESSION',
      targetId: req.authUser!.sessionId,
      ipAddress: getClientIp(req),
    });
    res.json({ loggedOut: true });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed.' });
  }
});

// Active Sessions Management
router.get('/sessions', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const authUser = req.authUser!;
    const viewAll = authUser.roleName === 'SUPER_ADMIN' && req.query.scope === 'all';
    const rows = viewAll
      ? await db
          .select({
            id: loginSessions.id,
            userId: loginSessions.userId,
            userEmail: users.email,
            userName: users.fullName,
            deviceInfo: loginSessions.deviceInfo,
            ipAddress: loginSessions.ipAddress,
            isActive: loginSessions.isActive,
            lastActiveAt: loginSessions.lastActiveAt,
            expiresAt: loginSessions.expiresAt,
            createdAt: loginSessions.createdAt,
          })
          .from(loginSessions)
          .innerJoin(users, eq(loginSessions.userId, users.id))
          .orderBy(desc(loginSessions.lastActiveAt))
          .limit(100)
      : await db
          .select({
            id: loginSessions.id,
            userId: loginSessions.userId,
            deviceInfo: loginSessions.deviceInfo,
            ipAddress: loginSessions.ipAddress,
            isActive: loginSessions.isActive,
            lastActiveAt: loginSessions.lastActiveAt,
            expiresAt: loginSessions.expiresAt,
            createdAt: loginSessions.createdAt,
          })
          .from(loginSessions)
          .where(eq(loginSessions.userId, authUser.id))
          .orderBy(desc(loginSessions.lastActiveAt))
          .limit(30);

    res.json({
      sessions: rows.map((r) => ({ ...r, isCurrent: r.id === authUser.sessionId })),
    });
  } catch (error) {
    console.error('Sessions fetch error:', error);
    res.status(500).json({ error: 'Failed to load sessions.' });
  }
});

router.delete('/sessions/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid session ID.' });

    const [target] = await db.select().from(loginSessions).where(eq(loginSessions.id, id));
    if (!target) return res.status(404).json({ error: 'Session not found.' });

    if (target.userId !== req.authUser!.id && req.authUser!.roleName !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Cannot revoke another user’s session.' });
    }

    await db.update(loginSessions).set({ isActive: false }).where(eq(loginSessions.id, id));
    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.roleName,
      action: 'SESSION_REVOKED',
      targetType: 'SESSION',
      targetId: id,
      ipAddress: getClientIp(req),
    });

    res.json({ revoked: true });
  } catch (error) {
    console.error('Revoke session error:', error);
    res.status(500).json({ error: 'Failed to revoke session.' });
  }
});

// TOTP 2FA Enrollment
router.post('/2fa/setup', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const secret = generateTotpSecret();
    const otpauthUrl = buildOtpauthUrl(req.authUser!.email, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { width: 220, margin: 1 });

    await db
      .insert(twoFactorSettings)
      .values({
        userId: req.authUser!.id,
        enabled: false,
        secretEncrypted: encryptString(secret),
        backupCodesHashJson: [],
      })
      .onConflictDoUpdate({
        target: twoFactorSettings.userId,
        set: {
          secretEncrypted: encryptString(secret),
          updatedAt: new Date(),
        },
      });

    res.json({ secret, otpauthUrl, qrDataUrl });
  } catch (error) {
    console.error('2FA setup error:', error);
    res.status(500).json({ error: 'Failed to initialize TOTP setup.' });
  }
});

router.post('/2fa/enable', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const code = String(req.body?.code || '').trim();
    const [settings] = await db
      .select()
      .from(twoFactorSettings)
      .where(eq(twoFactorSettings.userId, req.authUser!.id));

    if (!settings?.secretEncrypted) {
      return res.status(400).json({ error: 'Initialize 2FA setup first.' });
    }

    const secret = decryptString(settings.secretEncrypted);
    if (!verifyTotpToken(secret, code)) {
      return res.status(400).json({ error: 'Invalid authenticator code. Check your device clock and retry.' });
    }

    // Generate 8 one-time recovery codes
    const recoveryCodes: string[] = [];
    const hashes: string[] = [];
    for (let i = 0; i < 8; i++) {
      const c = generateRandomToken(4).toUpperCase();
      recoveryCodes.push(c);
      hashes.push(sha256(c));
    }

    await db
      .update(twoFactorSettings)
      .set({
        enabled: true,
        backupCodesHashJson: hashes,
        verifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(twoFactorSettings.id, settings.id));

    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.roleName,
      action: '2FA_ENABLED',
      targetType: 'USER',
      targetId: req.authUser!.id,
      ipAddress: getClientIp(req),
    });

    res.json({ enabled: true, recoveryCodes });
  } catch (error) {
    console.error('2FA enable error:', error);
    res.status(500).json({ error: 'Failed to enable 2FA.' });
  }
});

router.post('/2fa/disable', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const enforceAll = await getSettingBool('enforce_2fa_all_internal', false);
    if (enforceAll && req.authUser!.roleName !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Company security policy enforces mandatory 2FA.' });
    }

    await db
      .update(twoFactorSettings)
      .set({ enabled: false, backupCodesHashJson: [], updatedAt: new Date() })
      .where(eq(twoFactorSettings.userId, req.authUser!.id));

    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.roleName,
      action: '2FA_DISABLED',
      targetType: 'USER',
      targetId: req.authUser!.id,
      ipAddress: getClientIp(req),
    });

    res.json({ enabled: false });
  } catch (error) {
    console.error('2FA disable error:', error);
    res.status(500).json({ error: 'Failed to disable 2FA.' });
  }
});

export default router;
