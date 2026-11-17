import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { auditLogs, notifications, roles, users } from '../db/schema.ts';

export interface AuditParams {
  actorUserId?: number | null;
  actorEmail: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId?: string | number | null;
  details?: Record<string, unknown>;
  ipAddress: string;
}

export const recordAuditLog = async (params: AuditParams): Promise<void> => {
  try {
    await db.insert(auditLogs).values({
      actorUserId: params.actorUserId ?? null,
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId !== undefined && params.targetId !== null ? String(params.targetId) : null,
      detailsJson: params.details ?? {},
      ipAddress: params.ipAddress,
    });
  } catch (error) {
    console.error('Failed to record audit log:', error);
  }
};

export interface NotificationParams {
  userId: number;
  title: string;
  message: string;
  eventType: string;
  entityType?: string;
  entityId?: number;
}

export const createNotification = async (params: NotificationParams): Promise<void> => {
  try {
    await db.insert(notifications).values({
      userId: params.userId,
      title: params.title,
      message: params.message,
      eventType: params.eventType,
      entityType: params.entityType ?? null,
      entityId: params.entityId ?? null,
    });
  } catch (error) {
    console.error('Failed to create notification:', error);
  }
};

export const notifyRoles = async (
  roleNames: string[],
  payload: Omit<NotificationParams, 'userId'>,
): Promise<void> => {
  try {
    const matchedRoles = await db.select().from(roles).where(inArray(roles.name, roleNames));
    if (!matchedRoles.length) return;
    const roleIds = matchedRoles.map((r) => r.id);
    const targetUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.roleId, roleIds));

    for (const u of targetUsers) {
      await db.insert(notifications).values({
        userId: u.id,
        title: payload.title,
        message: payload.message,
        eventType: payload.eventType,
        entityType: payload.entityType ?? null,
        entityId: payload.entityId ?? null,
      });
    }
  } catch (error) {
    console.error('Failed to broadcast role notifications:', error);
  }
};

export const notifyRecruiterById = async (
  recruiterId: number | null | undefined,
  payload: Omit<NotificationParams, 'userId'>,
): Promise<void> => {
  if (!recruiterId) return;
  try {
    const { recruiters } = await import('../db/schema.ts');
    const [rec] = await db.select().from(recruiters).where(eq(recruiters.id, recruiterId));
    if (rec) {
      await createNotification({ ...payload, userId: rec.userId });
    }
  } catch (error) {
    console.error('Failed to notify recruiter:', error);
  }
};
