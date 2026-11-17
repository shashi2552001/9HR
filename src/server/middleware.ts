import type { Request, Response, NextFunction } from 'express';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  loginSessions,
  permissions,
  recruiters,
  rolePermissions,
  roles,
  users,
} from '../db/schema.ts';
import { adminAuth } from '../lib/firebase-admin.ts';
import { sha256 } from './security.ts';
import type { RoleName } from './constants.ts';

export interface AuthUserContext {
  id: number;
  uid: string;
  email: string;
  fullName: string;
  phone: string | null;
  roleId: number;
  roleName: RoleName;
  roleDisplayName: string;
  recruiterId: number | null;
  canCreateRecruiters: boolean;
  canExportSensitive: boolean;
  permissions: string[];
  sessionId: number | null;
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUserContext;
}

export const getClientIp = (req: Request): string => {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
};

// Sliding-window in-memory rate limiter
const rateBuckets = new Map<string, number[]>();

export const rateLimit = (windowMs: number, maxRequests: number, keyPrefix: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${keyPrefix}:${getClientIp(req)}`;
    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = (rateBuckets.get(key) || []).filter((ts) => ts > cutoff);
    if (timestamps.length >= maxRequests) {
      return res.status(429).json({
        error: 'Too many requests. Please wait before retrying.',
      });
    }
    timestamps.push(now);
    rateBuckets.set(key, timestamps);
    next();
  };
};

// CSRF protection for cookie-authenticated state-changing endpoints
export const csrfGuard = (req: Request, res: Response, next: NextFunction) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  // Skip for multipart or token-based bearer calls, or enforce X-Requested-With header
  const hasBearer = req.headers.authorization?.startsWith('Bearer ');
  const hasXhr = req.headers['x-requested-with'] === 'XMLHttpRequest';
  if (hasBearer || hasXhr) {
    return next();
  }
  return res.status(403).json({ error: 'Forbidden: Missing CSRF protection header' });
};

async function hydrateUserContext(userRow: typeof users.$inferSelect, sessionId: number | null): Promise<AuthUserContext | null> {
  if (!userRow.isActive) return null;

  const [roleRow] = await db.select().from(roles).where(eq(roles.id, userRow.roleId));
  if (!roleRow) return null;

  const permRows = await db
    .select({ code: permissions.code })
    .from(rolePermissions)
    .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
    .where(eq(rolePermissions.roleId, roleRow.id));

  const [recruiterRow] = await db
    .select()
    .from(recruiters)
    .where(eq(recruiters.userId, userRow.id));

  return {
    id: userRow.id,
    uid: userRow.uid,
    email: userRow.email,
    fullName: userRow.fullName,
    phone: userRow.phone,
    roleId: roleRow.id,
    roleName: roleRow.name as RoleName,
    roleDisplayName: roleRow.displayName,
    recruiterId: recruiterRow ? recruiterRow.id : null,
    canCreateRecruiters: recruiterRow ? recruiterRow.canCreateRecruiters : roleRow.name === 'SUPER_ADMIN',
    canExportSensitive: recruiterRow ? recruiterRow.canExportSensitive : roleRow.name === 'SUPER_ADMIN',
    permissions: permRows.map((p) => p.code),
    sessionId,
  };
}

export const requireAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const authHeader = req.headers.authorization;
    const bearerToken =
      authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : undefined;

    // 1. Check HTTP-only session cookie or opaque DB session Bearer token (for strict cross-site iframes)
    const rawSessionToken =
      (req.cookies?.nhr_session as string | undefined) ||
      (bearerToken && !bearerToken.includes('.') ? bearerToken : undefined);

    if (rawSessionToken) {
      const tokenHash = sha256(rawSessionToken);
      const now = new Date();
      const [session] = await db
        .select()
        .from(loginSessions)
        .where(
          and(
            eq(loginSessions.sessionTokenHash, tokenHash),
            eq(loginSessions.isActive, true),
            gt(loginSessions.expiresAt, now),
          ),
        );

      if (session) {
        const [userRow] = await db.select().from(users).where(eq(users.id, session.userId));
        if (userRow && userRow.isActive) {
          const ctx = await hydrateUserContext(userRow, session.id);
          if (ctx) {
            // Update lastActiveAt asynchronously
            db.update(loginSessions)
              .set({ lastActiveAt: now })
              .where(eq(loginSessions.id, session.id))
              .catch(() => {});
            req.authUser = ctx;
            return next();
          }
        }
      }
    }

    // 2. Fallback: Firebase Bearer ID Token (JWT contains dots)
    if (bearerToken && bearerToken.includes('.')) {
      const idToken = bearerToken;
      const decoded = await adminAuth.verifyIdToken(idToken);
      const email = decoded.email || `${decoded.uid}@firebase.local`;

      let [userRow] = await db.select().from(users).where(eq(users.uid, decoded.uid));
      if (!userRow && decoded.email) {
        [userRow] = await db.select().from(users).where(eq(users.email, decoded.email.toLowerCase()));
        if (userRow) {
          await db.update(users).set({ uid: decoded.uid }).where(eq(users.id, userRow.id));
        }
      }

      if (!userRow) {
        // Check if any users exist; first Firebase user becomes SUPER_ADMIN, subsequent default to RECRUITER
        const existingUsers = await db.select({ id: users.id }).from(users).limit(1);
        const targetRoleName = existingUsers.length === 0 ? 'SUPER_ADMIN' : 'RECRUITER';
        const [targetRole] = await db.select().from(roles).where(eq(roles.name, targetRoleName));
        if (!targetRole) {
          return res.status(500).json({ error: 'System roles not initialized.' });
        }

        const inserted = await db
          .insert(users)
          .values({
            uid: decoded.uid,
            email: email.toLowerCase(),
            fullName: decoded.name || email.split('@')[0],
            roleId: targetRole.id,
            isActive: true,
            lastLoginAt: new Date(),
          })
          .onConflictDoUpdate({
            target: users.uid,
            set: { email: email.toLowerCase(), lastLoginAt: new Date() },
          })
          .returning();

        userRow = inserted[0];

        if (targetRoleName === 'RECRUITER') {
          await db
            .insert(recruiters)
            .values({
              userId: userRow.id,
              employeeCode: `9HR-REC-${String(userRow.id).padStart(3, '0')}`,
            })
            .onConflictDoNothing();
        }
      }

      if (!userRow.isActive) {
        return res.status(403).json({ error: 'Account has been deactivated by administrator.' });
      }

      const ctx = await hydrateUserContext(userRow, null);
      if (!ctx) {
        return res.status(403).json({ error: 'Unauthorized user role.' });
      }
      req.authUser = ctx;
      return next();
    }

    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  } catch (error) {
    console.error('Authentication middleware error:', error);
    return res.status(401).json({ error: 'Invalid or expired authentication session.' });
  }
};

export const requireRole = (...allowedRoles: RoleName[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!allowedRoles.includes(req.authUser.roleName)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${allowedRoles.join(' or ')}.`,
      });
    }
    next();
  };
};

export const requirePermission = (permissionCode: string) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (
      req.authUser.roleName !== 'SUPER_ADMIN' &&
      !req.authUser.permissions.includes(permissionCode)
    ) {
      return res.status(403).json({
        error: `Access denied. Missing permission: ${permissionCode}`,
      });
    }
    next();
  };
};
