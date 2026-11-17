import { Router } from 'express';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, pool } from '../../db/index.ts';
import {
  auditLogs,
  candidateDocuments,
  candidates,
  documentCategories,
  jobs,
  loginSessions,
  onboardingLinks,
  permissions,
  recruiters,
  rolePermissions,
  roles,
  systemSettings,
  twoFactorSettings,
  userRoles,
  users,
} from '../../db/schema.ts';
import {
  type AuthenticatedRequest,
  getClientIp,
  requireAuth,
  requirePermission,
  requireRole,
} from '../middleware.ts';
import { generateRandomToken, hashPassword } from '../security.ts';
import { recordAuditLog } from '../audit.ts';
import { isSmtpConfigured } from '../mailer.ts';

const router = Router();

// Users & Recruiters Listing
router.get('/users', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const authUser = req.authUser!;
    const rows = await db
      .select({
        id: users.id,
        uid: users.uid,
        email: users.email,
        fullName: users.fullName,
        phone: users.phone,
        isActive: users.isActive,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        roleId: roles.id,
        roleName: roles.name,
        roleDisplayName: roles.displayName,
        recruiterId: recruiters.id,
        employeeCode: recruiters.employeeCode,
        department: recruiters.department,
        specialization: recruiters.specialization,
        targetMonthlyHires: recruiters.targetMonthlyHires,
        canCreateRecruiters: recruiters.canCreateRecruiters,
        canExportSensitive: recruiters.canExportSensitive,
        twoFactorEnabled: twoFactorSettings.enabled,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .leftJoin(recruiters, eq(recruiters.userId, users.id))
      .leftJoin(twoFactorSettings, eq(twoFactorSettings.userId, users.id))
      .orderBy(desc(users.createdAt));

    const filtered = authUser.roleName === 'ADMIN'
      ? rows.filter((r) => r.roleName === 'RECRUITER')
      : rows;

    res.json({ users: filtered });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ error: 'Failed to load user directory.' });
  }
});

// Recruiter dropdown list for assignments (Admin & Super Admin)
router.get('/recruiters', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const rows = await db
      .select({
        id: recruiters.id,
        userId: users.id,
        fullName: users.fullName,
        email: users.email,
        employeeCode: recruiters.employeeCode,
        department: recruiters.department,
        specialization: recruiters.specialization,
        targetMonthlyHires: recruiters.targetMonthlyHires,
        isActive: users.isActive,
      })
      .from(recruiters)
      .innerJoin(users, eq(recruiters.userId, users.id));

    const authUser = req.authUser!;
    if (authUser.roleName === 'RECRUITER') {
      return res.json({ recruiters: rows.filter((r) => r.userId === authUser.id) });
    }
    res.json({ recruiters: rows });
  } catch (error) {
    console.error('List recruiters error:', error);
    res.status(500).json({ error: 'Failed to load recruiters.' });
  }
});

const createUserSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().max(25).optional(),
  password: z.string().min(8).max(128),
  roleName: z.enum(['SUPER_ADMIN', 'ADMIN', 'RECRUITER']),
  department: z.string().max(100).optional(),
  specialization: z.string().max(120).optional(),
  targetMonthlyHires: z.number().int().min(1).max(100).optional(),
  canExportSensitive: z.boolean().optional(),
});

router.post('/users', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const authUser = req.authUser!;
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid user details. Password must be at least 8 characters.' });
    }

    const data = parsed.data;

    // Strict privilege escalation prevention
    if (authUser.roleName === 'ADMIN' && data.roleName !== 'RECRUITER') {
      return res.status(403).json({ error: 'Admins can only provision Recruiter accounts.' });
    }

    const email = data.email.toLowerCase();
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing.length > 0) {
      return res.status(409).json({ error: 'A user with this email already exists.' });
    }

    const [roleRow] = await db.select().from(roles).where(eq(roles.name, data.roleName));
    if (!roleRow) return res.status(400).json({ error: 'Invalid role selected.' });

    const [created] = await db
      .insert(users)
      .values({
        uid: `usr_${generateRandomToken(12)}`,
        email,
        fullName: data.fullName.trim(),
        phone: data.phone?.trim() || null,
        passwordHash: await hashPassword(data.password),
        roleId: roleRow.id,
        isActive: true,
      })
      .returning();

    await db.insert(userRoles).values({
      userId: created.id,
      roleId: roleRow.id,
      assignedBy: authUser.id,
    });

    if (data.roleName === 'RECRUITER') {
      await db.insert(recruiters).values({
        userId: created.id,
        employeeCode: `9HR-REC-${String(created.id).padStart(3, '0')}`,
        department: data.department || 'Talent Acquisition',
        specialization: data.specialization || 'Full-Cycle Hiring',
        targetMonthlyHires: data.targetMonthlyHires || 6,
        canExportSensitive: Boolean(data.canExportSensitive),
      });
    }

    await recordAuditLog({
      actorUserId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.roleName,
      action: 'USER_CREATED',
      targetType: 'USER',
      targetId: created.id,
      details: { createdEmail: created.email, role: data.roleName },
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ id: created.id, email: created.email, roleName: data.roleName });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user account.' });
  }
});

router.patch('/users/:id', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const authUser = req.authUser!;
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Invalid user ID.' });

    const [target] = await db.select().from(users).where(eq(users.id, targetId));
    if (!target) return res.status(404).json({ error: 'User not found.' });

    const [targetRole] = await db.select().from(roles).where(eq(roles.id, target.roleId));
    if (authUser.roleName === 'ADMIN' && targetRole?.name !== 'RECRUITER') {
      return res.status(403).json({ error: 'Admins cannot modify Super Admin or Admin accounts.' });
    }

    const { fullName, phone, isActive, roleName, department, specialization, targetMonthlyHires, canExportSensitive } =
      req.body as Record<string, any>;

    const updates: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (typeof fullName === 'string' && fullName.trim().length >= 2) updates.fullName = fullName.trim();
    if (typeof phone === 'string') updates.phone = phone.trim();
    if (typeof isActive === 'boolean') {
      if (target.id === authUser.id && !isActive) {
        return res.status(400).json({ error: 'You cannot deactivate your own active session.' });
      }
      updates.isActive = isActive;
    }

    if (typeof roleName === 'string' && authUser.roleName === 'SUPER_ADMIN') {
      const [newRole] = await db.select().from(roles).where(eq(roles.name, roleName));
      if (newRole) {
        updates.roleId = newRole.id;
        if (roleName === 'RECRUITER') {
          await db
            .insert(recruiters)
            .values({
              userId: target.id,
              employeeCode: `9HR-REC-${String(target.id).padStart(3, '0')}`,
            })
            .onConflictDoNothing();
        }
      }
    }

    await db.update(users).set(updates).where(eq(users.id, targetId));

    const [recRow] = await db.select().from(recruiters).where(eq(recruiters.userId, targetId));
    if (recRow) {
      await db
        .update(recruiters)
        .set({
          ...(typeof department === 'string' ? { department } : {}),
          ...(typeof specialization === 'string' ? { specialization } : {}),
          ...(typeof targetMonthlyHires === 'number' ? { targetMonthlyHires } : {}),
          ...(typeof canExportSensitive === 'boolean' && authUser.roleName === 'SUPER_ADMIN'
            ? { canExportSensitive }
            : {}),
        })
        .where(eq(recruiters.id, recRow.id));
    }

    await recordAuditLog({
      actorUserId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.roleName,
      action: 'USER_UPDATED',
      targetType: 'USER',
      targetId,
      details: { isActive, roleName },
      ipAddress: getClientIp(req),
    });

    res.json({ updated: true });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user.' });
  }
});

router.delete('/users/:id', requireAuth, requireRole('SUPER_ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Invalid user ID.' });
    if (targetId === req.authUser!.id) {
      return res.status(400).json({ error: 'Cannot delete your own Super Admin account.' });
    }

    const [target] = await db.select().from(users).where(eq(users.id, targetId));
    if (!target) return res.status(404).json({ error: 'User not found.' });

    await db.delete(users).where(eq(users.id, targetId));
    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.roleName,
      action: 'USER_DELETED',
      targetType: 'USER',
      targetId,
      details: { deletedEmail: target.email },
      ipAddress: getClientIp(req),
    });

    res.json({ deleted: true });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Cannot delete user with active dependent recruitment records; deactivate instead.' });
  }
});

// Roles & Granular Permissions
router.get('/roles', requireAuth, requireRole('SUPER_ADMIN'), async (_req, res) => {
  try {
    const allRoles = await db.select().from(roles);
    const allPerms = await db.select().from(permissions);
    const mappings = await db.select().from(rolePermissions);

    res.json({
      roles: allRoles.map((r) => ({
        ...r,
        permissionIds: mappings.filter((m) => m.roleId === r.id).map((m) => m.permissionId),
      })),
      permissions: allPerms,
    });
  } catch (error) {
    console.error('Roles fetch error:', error);
    res.status(500).json({ error: 'Failed to load RBAC matrix.' });
  }
});

router.put('/roles/:id/permissions', requireAuth, requireRole('SUPER_ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const roleId = Number(req.params.id);
    const permissionIds = Array.isArray(req.body?.permissionIds) ? (req.body.permissionIds as number[]) : [];

    const [roleRow] = await db.select().from(roles).where(eq(roles.id, roleId));
    if (!roleRow) return res.status(404).json({ error: 'Role not found.' });
    if (roleRow.name === 'SUPER_ADMIN') {
      return res.status(400).json({ error: 'Super Admin retains unrestricted permissions.' });
    }

    await db.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    for (const pid of permissionIds) {
      await db.insert(rolePermissions).values({ roleId, permissionId: pid }).onConflictDoNothing();
    }

    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.roleName,
      action: 'ROLE_PERMISSIONS_UPDATED',
      targetType: 'ROLE',
      targetId: roleId,
      details: { roleName: roleRow.name, permissionCount: permissionIds.length },
      ipAddress: getClientIp(req),
    });

    res.json({ updated: true });
  } catch (error) {
    console.error('Update role permissions error:', error);
    res.status(500).json({ error: 'Failed to update role permissions.' });
  }
});

// System Settings (Super Admin)
router.get('/settings', requireAuth, requireRole('SUPER_ADMIN'), async (_req, res) => {
  try {
    const rows = await db.select().from(systemSettings);
    res.json({ settings: rows });
  } catch (error) {
    console.error('Settings fetch error:', error);
    res.status(500).json({ error: 'Failed to load system settings.' });
  }
});

router.put('/settings', requireAuth, requireRole('SUPER_ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const updates = req.body?.settings as Array<{ key: string; value: string }>;
    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: 'Expected array of settings updates.' });
    }

    for (const item of updates) {
      await db
        .update(systemSettings)
        .set({ value: String(item.value), updatedBy: req.authUser!.id, updatedAt: new Date() })
        .where(eq(systemSettings.key, item.key));
    }

    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.roleName,
      action: 'SYSTEM_SETTINGS_UPDATED',
      targetType: 'SYSTEM',
      details: { keys: updates.map((u) => u.key) },
      ipAddress: getClientIp(req),
    });

    res.json({ updated: true });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ error: 'Failed to update system settings.' });
  }
});

// Document Categories Management
router.get('/document-categories', requireAuth, async (_req, res) => {
  try {
    const rows = await db.select().from(documentCategories).orderBy(documentCategories.sortOrder);
    res.json({ categories: rows });
  } catch (error) {
    console.error('Doc categories error:', error);
    res.status(500).json({ error: 'Failed to fetch document categories.' });
  }
});

router.post('/document-categories', requireAuth, requirePermission('documents.categories'), async (req: AuthenticatedRequest, res) => {
  try {
    const schema = z.object({
      code: z.string().min(3).max(40),
      name: z.string().min(2).max(120),
      groupName: z.enum(['IDENTITY', 'EDUCATION', 'EMPLOYMENT', 'BANKING', 'OTHER']),
      isRequired: z.boolean().default(false),
      allowMasked: z.boolean().default(false),
      legalNote: z.string().max(300).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid category payload.' });

    const [created] = await db
      .insert(documentCategories)
      .values({
        ...parsed.data,
        code: parsed.data.code.toUpperCase().replace(/\s+/g, '_'),
        sortOrder: 90,
      })
      .returning();

    res.status(201).json({ category: created });
  } catch (error) {
    console.error('Create doc category error:', error);
    res.status(500).json({ error: 'Failed to create document category.' });
  }
});

router.patch('/document-categories/:id', requireAuth, requirePermission('documents.categories'), async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const { isRequired, isEnabled, allowMasked, legalNote } = req.body as Record<string, any>;
    await db
      .update(documentCategories)
      .set({
        ...(typeof isRequired === 'boolean' ? { isRequired } : {}),
        ...(typeof isEnabled === 'boolean' ? { isEnabled } : {}),
        ...(typeof allowMasked === 'boolean' ? { allowMasked } : {}),
        ...(typeof legalNote === 'string' ? { legalNote } : {}),
      })
      .where(eq(documentCategories.id, id));
    res.json({ updated: true });
  } catch (error) {
    console.error('Update doc category error:', error);
    res.status(500).json({ error: 'Failed to update document category.' });
  }
});

// Audit Logs & System Health (Super Admin)
router.get('/audit-logs', requireAuth, requirePermission('audit.view'), async (req, res) => {
  try {
    const actionFilter = String(req.query.action || '').trim();
    const rows = await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(200);

    const filtered = actionFilter
      ? rows.filter((r) => r.action.toLowerCase().includes(actionFilter.toLowerCase()))
      : rows;

    res.json({ logs: filtered });
  } catch (error) {
    console.error('Audit logs error:', error);
    res.status(500).json({ error: 'Failed to load audit logs.' });
  }
});

router.get('/system-health', requireAuth, requireRole('SUPER_ADMIN'), async (_req, res) => {
  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    const dbLatencyMs = Date.now() - start;

    const [userCount] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    const [candCount] = await db.select({ count: sql<number>`count(*)::int` }).from(candidates);
    const [jobCount] = await db.select({ count: sql<number>`count(*)::int` }).from(jobs);
    const [docCount] = await db.select({ count: sql<number>`count(*)::int` }).from(candidateDocuments);
    const [linkCount] = await db.select({ count: sql<number>`count(*)::int` }).from(onboardingLinks);
    const [sessionCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(loginSessions)
      .where(eq(loginSessions.isActive, true));

    res.json({
      health: {
        databaseStatus: 'CONNECTED',
        dbLatencyMs,
        encryptionAlgorithm: 'AES-256-GCM',
        smtpConfigured: isSmtpConfigured(),
        whatsappMode: process.env.WHATSAPP_CLOUD_TOKEN ? 'CLOUD_API' : 'WEB_SHARE_LINK',
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        counts: {
          users: userCount?.count || 0,
          candidates: candCount?.count || 0,
          jobs: jobCount?.count || 0,
          documents: docCount?.count || 0,
          onboardingLinks: linkCount?.count || 0,
          activeSessions: sessionCount?.count || 0,
        },
      },
    });
  } catch (error) {
    console.error('System health error:', error);
    res.status(500).json({ error: 'System health check failed.' });
  }
});

export default router;
