import fs from 'node:fs/promises';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import multer from 'multer';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  candidateAddresses,
  candidateDocuments,
  candidateEducation,
  candidateEmployment,
  candidates,
  documentCategories,
  documentVerificationLogs,
  onboardingLinks,
  onboardingSubmissions,
  recruitmentStatusHistory,
  systemSettings,
  users,
} from '../../db/schema.ts';
import {
  type AuthenticatedRequest,
  getClientIp,
  rateLimit,
  requireAuth,
  requireRole,
} from '../middleware.ts';
import {
  decryptBuffer,
  encryptBuffer,
  generateNumericOtp,
  generateRandomToken,
  sanitizeText,
  sha256,
  signDownloadToken,
  validateFileMagicBytes,
  verifyDownloadToken,
} from '../security.ts';
import { notifyRecruiterById, notifyRoles, recordAuditLog } from '../audit.ts';
import { sendEmailNotification } from '../mailer.ts';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const ENCRYPTED_STORAGE_DIR = path.resolve(process.cwd(), 'storage', 'encrypted_docs');

async function verifyOnboardingSessionCookie(req: Request, linkId: number): Promise<boolean> {
  const raw = req.cookies?.nhr_onb_session as string | undefined;
  if (!raw) return false;
  const parts = raw.split('.');
  if (parts.length !== 2) return false;
  const [cookieLinkId, tokenHash] = parts;
  if (Number(cookieLinkId) !== linkId) return false;
  const [link] = await db.select().from(onboardingLinks).where(eq(onboardingLinks.id, linkId));
  if (!link || link.isRevoked || link.expiresAt < new Date() || !link.otpVerifiedAt) return false;
  return link.tokenHash === tokenHash;
}

// =====================================================================
// INTERNAL PORTAL: ONBOARDING LINK MANAGEMENT & VERIFICATION
// =====================================================================

router.get('/onboarding/links', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const authUser = req.authUser!;
    const rows = await db
      .select({
        id: onboardingLinks.id,
        candidateId: onboardingLinks.candidateId,
        candidateName: candidates.fullName,
        candidateCode: candidates.candidateCode,
        candidateEmail: candidates.email,
        candidateMobile: candidates.mobile,
        assignedRecruiterId: candidates.assignedRecruiterId,
        tokenPreview: onboardingLinks.tokenPreview,
        expiresAt: onboardingLinks.expiresAt,
        isRevoked: onboardingLinks.isRevoked,
        status: onboardingLinks.status,
        sharedChannel: onboardingLinks.sharedChannel,
        sharedAt: onboardingLinks.sharedAt,
        openedAt: onboardingLinks.openedAt,
        otpVerifiedAt: onboardingLinks.otpVerifiedAt,
        submittedAt: onboardingLinks.submittedAt,
        createdAt: onboardingLinks.createdAt,
        submissionId: onboardingSubmissions.id,
        reviewStatus: onboardingSubmissions.reviewStatus,
        draftStep: onboardingSubmissions.draftStep,
        consentAccepted: onboardingSubmissions.consentAccepted,
        consentTimestamp: onboardingSubmissions.consentTimestamp,
      })
      .from(onboardingLinks)
      .innerJoin(candidates, eq(onboardingLinks.candidateId, candidates.id))
      .leftJoin(onboardingSubmissions, eq(onboardingSubmissions.onboardingLinkId, onboardingLinks.id))
      .orderBy(desc(onboardingLinks.createdAt));

    const filtered =
      authUser.roleName === 'RECRUITER'
        ? rows.filter((r) => authUser.recruiterId && r.assignedRecruiterId === authUser.recruiterId)
        : rows;

    res.json({ links: filtered });
  } catch (error) {
    console.error('List onboarding links error:', error);
    res.status(500).json({ error: 'Failed to load onboarding tracking links.' });
  }
});

router.post('/onboarding/links', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const { candidateId, expiryDays } = req.body as { candidateId?: number; expiryDays?: number };
    const candId = Number(candidateId);
    if (!Number.isInteger(candId)) return res.status(400).json({ error: 'Candidate ID required.' });

    const [cand] = await db.select().from(candidates).where(eq(candidates.id, candId));
    if (!cand) return res.status(404).json({ error: 'Candidate not found.' });

    const authUser = req.authUser!;
    if (authUser.roleName === 'RECRUITER' && cand.assignedRecruiterId !== authUser.recruiterId) {
      return res.status(403).json({ error: 'Access denied to generate onboarding link for unassigned candidate.' });
    }

    const [ttlSetting] = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, 'onboarding_link_ttl_days'));
    const days = Number(expiryDays || ttlSetting?.value || 7);

    // Revoke any previous unsubmitted active links for single-active-token safety
    await db
      .update(onboardingLinks)
      .set({ isRevoked: true })
      .where(and(eq(onboardingLinks.candidateId, cand.id), eq(onboardingLinks.isRevoked, false)));

    const rawToken = generateRandomToken(24);
    const expiresAt = new Date(Date.now() + days * 86400 * 1000);

    const [created] = await db
      .insert(onboardingLinks)
      .values({
        candidateId: cand.id,
        tokenHash: sha256(rawToken),
        tokenPreview: `${rawToken.slice(0, 8)}...${rawToken.slice(-6)}`,
        createdBy: authUser.id,
        expiresAt,
        status: 'GENERATED',
      })
      .returning();

    if (!['ONBOARDING_PENDING', 'DOCUMENTS_SUBMITTED', 'DOCUMENTS_VERIFIED', 'JOINED'].includes(cand.currentStatus)) {
      await db
        .update(candidates)
        .set({ currentStatus: 'ONBOARDING_PENDING', updatedAt: new Date() })
        .where(eq(candidates.id, cand.id));
      await db.insert(recruitmentStatusHistory).values({
        candidateId: cand.id,
        fromStatus: cand.currentStatus,
        toStatus: 'ONBOARDING_PENDING',
        remarks: 'Secure candidate onboarding link generated',
        changedBy: authUser.id,
      });
    }

    await notifyRoles(['ADMIN', 'SUPER_ADMIN'], {
      title: 'Onboarding Link Generated',
      message: `Onboarding link created for ${cand.fullName} (${cand.candidateCode}) by ${authUser.fullName}.`,
      eventType: 'ONBOARDING_LINK_GENERATED',
      entityType: 'ONBOARDING',
      entityId: created.id,
    });

    await recordAuditLog({
      actorUserId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.roleName,
      action: 'ONBOARDING_LINK_GENERATED',
      targetType: 'CANDIDATE',
      targetId: cand.id,
      details: { linkId: created.id, expiresAt },
      ipAddress: getClientIp(req),
    });

    res.status(201).json({
      link: created,
      rawToken,
      onboardingPath: `/onboarding/${rawToken}`,
    });
  } catch (error) {
    console.error('Create onboarding link error:', error);
    res.status(500).json({ error: 'Failed to generate onboarding link.' });
  }
});

router.post('/onboarding/links/:id/share', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const linkId = Number(req.params.id);
    const { channel, onboardingUrl } = req.body as { channel?: 'WHATSAPP' | 'EMAIL' | 'COPY'; onboardingUrl?: string };
    const [link] = await db.select().from(onboardingLinks).where(eq(onboardingLinks.id, linkId));
    if (!link) return res.status(404).json({ error: 'Onboarding link not found.' });

    const [cand] = await db.select().from(candidates).where(eq(candidates.id, link.candidateId));
    if (!cand) return res.status(404).json({ error: 'Candidate not found.' });

    if (link.status === 'GENERATED') {
      await db
        .update(onboardingLinks)
        .set({ status: 'SHARED', sharedChannel: channel || 'COPY', sharedAt: new Date() })
        .where(eq(onboardingLinks.id, linkId));
    } else {
      await db
        .update(onboardingLinks)
        .set({ sharedChannel: channel || 'COPY', sharedAt: new Date() })
        .where(eq(onboardingLinks.id, linkId));
    }

    let mailResult = null;
    if (channel === 'EMAIL' && onboardingUrl) {
      mailResult = await sendEmailNotification({
        to: cand.email,
        subject: '9HR India Private Limited — Complete Your Candidate Onboarding',
        text: `Dear ${cand.fullName},\n\nWelcome to 9HR India Private Limited. Please complete your pre-joining onboarding and document submission using your secure link:\n${onboardingUrl}\n\nNote: You will verify your identity via a 6-digit OTP before submitting documents.`,
      });
    }

    res.json({ shared: true, mailResult });
  } catch (error) {
    console.error('Share onboarding link error:', error);
    res.status(500).json({ error: 'Failed to record link share.' });
  }
});

router.post('/onboarding/links/:id/revoke', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const linkId = Number(req.params.id);
    const [link] = await db.select().from(onboardingLinks).where(eq(onboardingLinks.id, linkId));
    if (!link) return res.status(404).json({ error: 'Link not found.' });

    const [cand] = await db.select().from(candidates).where(eq(candidates.id, link.candidateId));
    if (
      req.authUser!.roleName === 'RECRUITER' &&
      (!cand || cand.assignedRecruiterId !== req.authUser!.recruiterId)
    ) {
      return res.status(403).json({ error: 'Access denied to revoke link for unassigned candidate.' });
    }

    await db.update(onboardingLinks).set({ isRevoked: true }).where(eq(onboardingLinks.id, linkId));
    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.roleName,
      action: 'ONBOARDING_LINK_REVOKED',
      targetType: 'ONBOARDING',
      targetId: linkId,
      ipAddress: getClientIp(req),
    });

    res.json({ revoked: true });
  } catch (error) {
    console.error('Revoke onboarding link error:', error);
    res.status(500).json({ error: 'Failed to revoke link.' });
  }
});

router.post('/onboarding/links/:id/regenerate', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const linkId = Number(req.params.id);
    const { expiryDays } = (req.body || {}) as { expiryDays?: number };
    const [oldLink] = await db.select().from(onboardingLinks).where(eq(onboardingLinks.id, linkId));
    if (!oldLink) return res.status(404).json({ error: 'Onboarding link not found.' });

    const [cand] = await db.select().from(candidates).where(eq(candidates.id, oldLink.candidateId));
    if (!cand) return res.status(404).json({ error: 'Candidate not found.' });

    const authUser = req.authUser!;
    if (authUser.roleName === 'RECRUITER' && cand.assignedRecruiterId !== authUser.recruiterId) {
      return res.status(403).json({ error: 'Access denied to regenerate link for unassigned candidate.' });
    }

    const [ttlSetting] = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, 'onboarding_link_ttl_days'));
    const days = Number(expiryDays || ttlSetting?.value || 7);

    await db
      .update(onboardingLinks)
      .set({ isRevoked: true })
      .where(and(eq(onboardingLinks.candidateId, cand.id), eq(onboardingLinks.isRevoked, false)));

    const rawToken = generateRandomToken(24);
    const expiresAt = new Date(Date.now() + days * 86400 * 1000);

    const [created] = await db
      .insert(onboardingLinks)
      .values({
        candidateId: cand.id,
        tokenHash: sha256(rawToken),
        tokenPreview: `${rawToken.slice(0, 8)}...${rawToken.slice(-6)}`,
        createdBy: authUser.id,
        expiresAt,
        status: 'GENERATED',
      })
      .returning();

    await recordAuditLog({
      actorUserId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.roleName,
      action: 'ONBOARDING_LINK_REGENERATED',
      targetType: 'CANDIDATE',
      targetId: cand.id,
      details: { previousLinkId: oldLink.id, newLinkId: created.id, expiresAt },
      ipAddress: getClientIp(req),
    });

    res.status(201).json({
      link: created,
      rawToken,
      onboardingPath: `/onboarding/${rawToken}`,
    });
  } catch (error) {
    console.error('Regenerate onboarding link error:', error);
    res.status(500).json({ error: 'Failed to regenerate onboarding link.' });
  }
});

router.post('/onboarding/links/:id/request-missing-docs', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const linkId = Number(req.params.id);
    const { categories, remarks } = req.body as { categories?: string[]; remarks?: string };
    const [link] = await db.select().from(onboardingLinks).where(eq(onboardingLinks.id, linkId));
    if (!link) return res.status(404).json({ error: 'Onboarding link not found.' });

    const [cand] = await db.select().from(candidates).where(eq(candidates.id, link.candidateId));
    if (!cand) return res.status(404).json({ error: 'Candidate not found.' });

    const authUser = req.authUser!;
    if (authUser.roleName === 'RECRUITER' && cand.assignedRecruiterId !== authUser.recruiterId) {
      return res.status(403).json({ error: 'Access denied for unassigned candidate.' });
    }

    const docList = Array.isArray(categories) ? categories.map((c) => sanitizeText(String(c))).filter(Boolean) : [];
    const noteText = remarks ? sanitizeText(remarks) : '';
    if (docList.length === 0 && !noteText) {
      return res.status(400).json({ error: 'Select at least one missing document or enter remarks.' });
    }

    const summary = [
      docList.length ? `Requested documents: ${docList.join(', ')}` : '',
      noteText ? `Instructions: ${noteText}` : '',
    ]
      .filter(Boolean)
      .join(' | ');

    const mailRes = await sendEmailNotification({
      to: cand.email,
      subject: '9HR India Onboarding — Action Required: Missing Documents',
      text: `Dear ${cand.fullName},\n\nHR Operations reviewed your onboarding profile and requires the following pending items:\n${docList.map((d) => `- ${d}`).join('\n')}\n${noteText ? `\nRemarks: ${noteText}` : ''}\n\nPlease upload these via your secure 9HR India onboarding link.`,
    });

    await notifyRecruiterById(cand.assignedRecruiterId, {
      title: 'Missing Documents Requested',
      message: `${cand.fullName} (${cand.candidateCode}): ${summary}`,
      eventType: 'MISSING_DOCUMENT_REQUESTED',
      entityType: 'ONBOARDING',
      entityId: link.id,
    });

    await notifyRoles(['ADMIN'], {
      title: 'Missing Documents Follow-up Logged',
      message: `${authUser.fullName} requested pending documents from ${cand.fullName}.`,
      eventType: 'MISSING_DOCUMENT_REQUESTED',
      entityType: 'ONBOARDING',
      entityId: link.id,
    });

    await recordAuditLog({
      actorUserId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.roleName,
      action: 'MISSING_DOCUMENTS_REQUESTED',
      targetType: 'CANDIDATE',
      targetId: cand.id,
      details: { linkId: link.id, categories: docList, remarks: noteText },
      ipAddress: getClientIp(req),
    });

    res.json({ requested: true, mailRes });
  } catch (error) {
    console.error('Request missing docs error:', error);
    res.status(500).json({ error: 'Failed to send missing documents request.' });
  }
});

// Inspect full onboarding submission record
router.get('/onboarding/submissions/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const subId = Number(req.params.id);
    if (!Number.isInteger(subId)) return res.status(400).json({ error: 'Invalid submission ID.' });

    const [sub] = await db.select().from(onboardingSubmissions).where(eq(onboardingSubmissions.id, subId));
    if (!sub) return res.status(404).json({ error: 'Onboarding submission not found.' });

    const [cand] = await db.select().from(candidates).where(eq(candidates.id, sub.candidateId));
    if (!cand) return res.status(404).json({ error: 'Candidate not found.' });

    const authUser = req.authUser!;
    if (authUser.roleName === 'RECRUITER' && cand.assignedRecruiterId !== authUser.recruiterId) {
      return res.status(403).json({ error: 'Access denied to this onboarding submission.' });
    }

    const docs = await db
      .select({
        id: candidateDocuments.id,
        categoryId: candidateDocuments.categoryId,
        categoryName: documentCategories.name,
        documentName: candidateDocuments.documentName,
        originalFileName: candidateDocuments.originalFileName,
        fileSizeBytes: candidateDocuments.fileSizeBytes,
        version: candidateDocuments.version,
        verificationStatus: candidateDocuments.verificationStatus,
        rejectionRemarks: candidateDocuments.rejectionRemarks,
        uploadedAt: candidateDocuments.uploadedAt,
      })
      .from(candidateDocuments)
      .innerJoin(documentCategories, eq(candidateDocuments.categoryId, documentCategories.id))
      .where(eq(candidateDocuments.candidateId, cand.id))
      .orderBy(desc(candidateDocuments.uploadedAt));

    res.json({
      submission: sub,
      candidate: {
        id: cand.id,
        candidateCode: cand.candidateCode,
        fullName: cand.fullName,
        email: cand.email,
        mobile: cand.mobile,
        currentStatus: cand.currentStatus,
      },
      documents: docs,
    });
  } catch (error) {
    console.error('Get onboarding submission error:', error);
    res.status(500).json({ error: 'Failed to load onboarding submission.' });
  }
});

// Admin / Super Admin request changes on submitted onboarding profile
router.post('/onboarding/submissions/:id/request-changes', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const subId = Number(req.params.id);
    const { remarks } = req.body as { remarks?: string };
    if (!remarks?.trim()) {
      return res.status(400).json({ error: 'Remarks are required when requesting changes.' });
    }

    const [sub] = await db.select().from(onboardingSubmissions).where(eq(onboardingSubmissions.id, subId));
    if (!sub) return res.status(404).json({ error: 'Submission not found.' });

    const cleanRemarks = sanitizeText(remarks);
    await db
      .update(onboardingSubmissions)
      .set({
        reviewStatus: 'CHANGES_REQUESTED',
        reviewedBy: req.authUser!.id,
        reviewedAt: new Date(),
        reviewRemarks: cleanRemarks,
        updatedAt: new Date(),
      })
      .where(eq(onboardingSubmissions.id, subId));

    await db
      .update(onboardingLinks)
      .set({ status: 'FORM_STARTED' })
      .where(eq(onboardingLinks.id, sub.onboardingLinkId));

    const [cand] = await db.select().from(candidates).where(eq(candidates.id, sub.candidateId));
    if (cand) {
      await sendEmailNotification({
        to: cand.email,
        subject: '9HR India Onboarding — Corrections Requested',
        text: `Dear ${cand.fullName},\n\nHR Operations reviewed your onboarding submission and requested updates:\n${cleanRemarks}\n\nPlease reopen your secure onboarding link to update and re-submit.`,
      });

      await notifyRecruiterById(cand.assignedRecruiterId, {
        title: 'Onboarding Changes Requested',
        message: `${cand.fullName} submission returned for updates: ${cleanRemarks}`,
        eventType: 'ONBOARDING_CHANGES_REQUESTED',
        entityType: 'ONBOARDING',
        entityId: sub.onboardingLinkId,
      });
    }

    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.roleName,
      action: 'ONBOARDING_CHANGES_REQUESTED',
      targetType: 'ONBOARDING_SUBMISSION',
      targetId: subId,
      details: { remarks: cleanRemarks },
      ipAddress: getClientIp(req),
    });

    res.json({ updated: true });
  } catch (error) {
    console.error('Request changes error:', error);
    res.status(500).json({ error: 'Failed to request onboarding changes.' });
  }
});

// Admin / Super Admin final onboarding submission review & approval
router.post('/onboarding/submissions/:id/approve', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const subId = Number(req.params.id);
    const { remarks, markJoined } = req.body as { remarks?: string; markJoined?: boolean };
    const [sub] = await db.select().from(onboardingSubmissions).where(eq(onboardingSubmissions.id, subId));
    if (!sub) return res.status(404).json({ error: 'Submission not found.' });

    await db
      .update(onboardingSubmissions)
      .set({
        reviewStatus: 'APPROVED',
        reviewedBy: req.authUser!.id,
        reviewedAt: new Date(),
        reviewRemarks: remarks ? sanitizeText(remarks) : 'All onboarding records verified and approved.',
        updatedAt: new Date(),
      })
      .where(eq(onboardingSubmissions.id, subId));

    await db
      .update(onboardingLinks)
      .set({ status: 'COMPLETED' })
      .where(eq(onboardingLinks.id, sub.onboardingLinkId));

    const [cand] = await db.select().from(candidates).where(eq(candidates.id, sub.candidateId));
    const targetCandStatus = markJoined ? 'JOINED' : 'DOCUMENTS_VERIFIED';

    if (cand) {
      await db
        .update(candidates)
        .set({ currentStatus: targetCandStatus, updatedAt: new Date() })
        .where(eq(candidates.id, cand.id));

      await db.insert(recruitmentStatusHistory).values({
        candidateId: cand.id,
        fromStatus: cand.currentStatus,
        toStatus: targetCandStatus,
        remarks: 'Final onboarding approved by HR Operations',
        changedBy: req.authUser!.id,
      });

      await notifyRecruiterById(cand.assignedRecruiterId, {
        title: 'Onboarding Completed',
        message: `${cand.fullName} onboarding has been finalized (${targetCandStatus}).`,
        eventType: 'ONBOARDING_COMPLETED',
        entityType: 'CANDIDATE',
        entityId: cand.id,
      });
    }

    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.roleName,
      action: 'ONBOARDING_FINAL_APPROVED',
      targetType: 'ONBOARDING_SUBMISSION',
      targetId: subId,
      ipAddress: getClientIp(req),
    });

    res.json({ approved: true, candidateStatus: targetCandStatus });
  } catch (error) {
    console.error('Approve onboarding error:', error);
    res.status(500).json({ error: 'Failed to approve onboarding.' });
  }
});

// =====================================================================
// SECURE DOCUMENT VERIFICATION & SHORT-LIVED DOWNLOAD STREAMING
// =====================================================================

router.get('/documents/queue', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const authUser = req.authUser!;
    const rows = await db
      .select({
        id: candidateDocuments.id,
        candidateId: candidateDocuments.candidateId,
        candidateName: candidates.fullName,
        candidateCode: candidates.candidateCode,
        assignedRecruiterId: candidates.assignedRecruiterId,
        categoryId: candidateDocuments.categoryId,
        categoryName: documentCategories.name,
        groupName: documentCategories.groupName,
        documentName: candidateDocuments.documentName,
        originalFileName: candidateDocuments.originalFileName,
        mimeType: candidateDocuments.mimeType,
        fileSizeBytes: candidateDocuments.fileSizeBytes,
        version: candidateDocuments.version,
        verificationStatus: candidateDocuments.verificationStatus,
        rejectionRemarks: candidateDocuments.rejectionRemarks,
        uploadedAt: candidateDocuments.uploadedAt,
      })
      .from(candidateDocuments)
      .innerJoin(candidates, eq(candidateDocuments.candidateId, candidates.id))
      .innerJoin(documentCategories, eq(candidateDocuments.categoryId, documentCategories.id))
      .orderBy(desc(candidateDocuments.uploadedAt));

    const filtered =
      authUser.roleName === 'RECRUITER'
        ? rows.filter((r) => authUser.recruiterId && r.assignedRecruiterId === authUser.recruiterId)
        : rows;

    res.json({ documents: filtered });
  } catch (error) {
    console.error('Document queue error:', error);
    res.status(500).json({ error: 'Failed to load document verification queue.' });
  }
});

router.post('/documents/:id/verify', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const docId = Number(req.params.id);
    const { action, remarks } = req.body as {
      action?: 'APPROVED' | 'REJECTED' | 'REUPLOAD_REQUESTED';
      remarks?: string;
    };
    if (!['APPROVED', 'REJECTED', 'REUPLOAD_REQUESTED'].includes(String(action))) {
      return res.status(400).json({ error: 'Invalid verification action.' });
    }
    if ((action === 'REJECTED' || action === 'REUPLOAD_REQUESTED') && !remarks?.trim()) {
      return res.status(400).json({ error: 'Remarks are required when rejecting or requesting re-upload.' });
    }

    const [doc] = await db.select().from(candidateDocuments).where(eq(candidateDocuments.id, docId));
    if (!doc) return res.status(404).json({ error: 'Document not found.' });

    await db
      .update(candidateDocuments)
      .set({
        verificationStatus: action!,
        rejectionRemarks: remarks ? sanitizeText(remarks) : null,
        verifiedBy: req.authUser!.id,
        verifiedAt: new Date(),
      })
      .where(eq(candidateDocuments.id, docId));

    await db.insert(documentVerificationLogs).values({
      documentId: docId,
      action: action!,
      remarks: remarks ? sanitizeText(remarks) : null,
      actorUserId: req.authUser!.id,
    });

    const [cand] = await db.select().from(candidates).where(eq(candidates.id, doc.candidateId));
    if (cand) {
      if (action === 'REJECTED' || action === 'REUPLOAD_REQUESTED') {
        await notifyRecruiterById(cand.assignedRecruiterId, {
          title: action === 'REJECTED' ? 'Document Rejected' : 'Missing / Re-upload Document Requested',
          message: `${doc.documentName} for ${cand.fullName}: ${remarks}`,
          eventType: action === 'REJECTED' ? 'DOCUMENT_REJECTED' : 'MISSING_DOCUMENT_REQUESTED',
          entityType: 'DOCUMENT',
          entityId: doc.id,
        });
      }

      // Check if all uploaded docs for candidate are approved
      const allCandDocs = await db
        .select()
        .from(candidateDocuments)
        .where(eq(candidateDocuments.candidateId, cand.id));
      const anyPendingOrRejected = allCandDocs.some((d) => d.verificationStatus !== 'APPROVED');
      if (!anyPendingOrRejected && allCandDocs.length > 0 && cand.currentStatus === 'DOCUMENTS_SUBMITTED') {
        await db
          .update(candidates)
          .set({ currentStatus: 'DOCUMENTS_VERIFIED', updatedAt: new Date() })
          .where(eq(candidates.id, cand.id));
        await db
          .update(onboardingLinks)
          .set({ status: 'APPROVED' })
          .where(eq(onboardingLinks.candidateId, cand.id));
      }
    }

    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.roleName,
      action: `DOCUMENT_${action}`,
      targetType: 'DOCUMENT',
      targetId: docId,
      details: { remarks },
      ipAddress: getClientIp(req),
    });

    res.json({ updated: true });
  } catch (error) {
    console.error('Verify document error:', error);
    res.status(500).json({ error: 'Failed to update document verification status.' });
  }
});

router.post('/documents/:id/download-token', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const docId = Number(req.params.id);
    const [doc] = await db.select().from(candidateDocuments).where(eq(candidateDocuments.id, docId));
    if (!doc) return res.status(404).json({ error: 'Document not found.' });

    const [cand] = await db.select().from(candidates).where(eq(candidates.id, doc.candidateId));
    if (!cand) return res.status(404).json({ error: 'Candidate not found.' });

    const authUser = req.authUser!;
    if (
      authUser.roleName === 'RECRUITER' &&
      cand.assignedRecruiterId !== authUser.recruiterId
    ) {
      return res.status(403).json({ error: 'Access denied to this document.' });
    }

    const token = signDownloadToken({
      docId: doc.id,
      actorType: 'INTERNAL',
      actorId: authUser.id,
    });

    await recordAuditLog({
      actorUserId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.roleName,
      action: 'DOCUMENT_DOWNLOAD_AUTHORIZED',
      targetType: 'DOCUMENT',
      targetId: doc.id,
      ipAddress: getClientIp(req),
    });

    res.json({ url: `/api/documents/${doc.id}/stream?token=${encodeURIComponent(token)}` });
  } catch (error) {
    console.error('Download token error:', error);
    res.status(500).json({ error: 'Failed to authorize document access.' });
  }
});

router.get('/documents/:id/stream', async (req: Request, res: Response) => {
  try {
    const docId = Number(req.params.id);
    const token = String(req.query.token || '');
    const payload = verifyDownloadToken(token);
    if (!payload || payload.docId !== docId) {
      return res.status(403).json({ error: 'Expired or invalid document download token.' });
    }

    const [doc] = await db.select().from(candidateDocuments).where(eq(candidateDocuments.id, docId));
    if (!doc) return res.status(404).json({ error: 'Document not found.' });

    const safeFileName = path.basename(doc.encryptedStoragePath);
    const fullPath = path.join(ENCRYPTED_STORAGE_DIR, safeFileName);
    const encryptedData = await fs.readFile(fullPath);
    const decrypted = decryptBuffer(encryptedData, doc.encryptionIv, doc.encryptionTag);

    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${doc.originalFileName.replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(decrypted);
  } catch (error) {
    console.error('Stream document error:', error);
    res.status(500).json({ error: 'Unable to decrypt and stream document.' });
  }
});

// =====================================================================
// PUBLIC CANDIDATE ONBOARDING PORTAL (TOKEN + OTP PROTECTED)
// =====================================================================

async function resolveValidLink(rawToken: string) {
  const tokenHash = sha256(rawToken);
  const [link] = await db.select().from(onboardingLinks).where(eq(onboardingLinks.tokenHash, tokenHash));
  if (!link) return { link: null, error: 'Invalid onboarding link.' };
  if (link.isRevoked) return { link: null, error: 'This onboarding link has been revoked by HR.' };
  if (link.expiresAt < new Date()) return { link: null, error: 'This onboarding link has expired.' };
  return { link, error: null };
}

router.get('/public/onboarding/:token', rateLimit(60_000, 30, 'pub-onb-info'), async (req, res) => {
  try {
    const { link, error } = await resolveValidLink(req.params.token);
    if (!link) return res.status(404).json({ error });

    const [cand] = await db.select().from(candidates).where(eq(candidates.id, link.candidateId));
    if (!cand) return res.status(404).json({ error: 'Candidate profile unavailable.' });

    if (!link.openedAt) {
      await db
        .update(onboardingLinks)
        .set({
          openedAt: new Date(),
          status: ['GENERATED', 'SHARED'].includes(link.status) ? 'OPENED' : link.status,
        })
        .where(eq(onboardingLinks.id, link.id));

      await notifyRecruiterById(cand.assignedRecruiterId, {
        title: 'Candidate Opened Onboarding Link',
        message: `${cand.fullName} opened their secure onboarding portal link.`,
        eventType: 'ONBOARDING_LINK_OPENED',
        entityType: 'ONBOARDING',
        entityId: link.id,
      });
    }

    const otpSessionValid = await verifyOnboardingSessionCookie(req, link.id);
    const maskedEmail = cand.email.replace(/(.{2})(.*)(@.*)/, '$1***$3');

    res.json({
      candidateName: cand.fullName,
      candidateCode: cand.candidateCode,
      maskedEmail,
      status: link.status,
      expiresAt: link.expiresAt,
      otpVerified: otpSessionValid,
    });
  } catch (error) {
    console.error('Public onboarding info error:', error);
    res.status(500).json({ error: 'Failed to load onboarding portal.' });
  }
});

router.post('/public/onboarding/:token/send-otp', rateLimit(60_000, 5, 'pub-onb-otp'), async (req, res) => {
  try {
    const { link, error } = await resolveValidLink(req.params.token);
    if (!link) return res.status(404).json({ error });

    const [cand] = await db.select().from(candidates).where(eq(candidates.id, link.candidateId));
    if (!cand) return res.status(404).json({ error: 'Candidate not found.' });

    const otp = generateNumericOtp(6);
    await db
      .update(onboardingLinks)
      .set({
        otpHash: sha256(otp),
        otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      })
      .where(eq(onboardingLinks.id, link.id));

    const mailRes = await sendEmailNotification({
      to: cand.email,
      subject: '9HR India Onboarding — Identity Verification OTP',
      text: `Dear ${cand.fullName},\n\nYour 6-digit OTP to unlock your 9HR India onboarding portal is: ${otp}\nValid for 10 minutes.`,
    });

    res.json({
      sent: true,
      mode: mailRes.mode,
      devOtpPreview: !mailRes.delivered && process.env.NODE_ENV !== 'production' ? otp : undefined,
    });
  } catch (error) {
    console.error('Send onboarding OTP error:', error);
    res.status(500).json({ error: 'Failed to send verification OTP.' });
  }
});

router.post('/public/onboarding/:token/verify-otp', rateLimit(60_000, 10, 'pub-onb-verify'), async (req, res) => {
  try {
    const { link, error } = await resolveValidLink(req.params.token);
    if (!link) return res.status(404).json({ error });

    const otp = String(req.body?.otp || '').trim();
    if (!link.otpHash || !link.otpExpiresAt || link.otpExpiresAt < new Date()) {
      return res.status(400).json({ error: 'OTP expired. Request a new verification code.' });
    }
    if (sha256(otp) !== link.otpHash) {
      return res.status(401).json({ error: 'Incorrect OTP code.' });
    }

    await db
      .update(onboardingLinks)
      .set({
        otpVerifiedAt: new Date(),
        status: ['GENERATED', 'SHARED', 'OPENED'].includes(link.status) ? 'OTP_VERIFIED' : link.status,
      })
      .where(eq(onboardingLinks.id, link.id));

    // Ensure submission draft record exists
    await db
      .insert(onboardingSubmissions)
      .values({
        onboardingLinkId: link.id,
        candidateId: link.candidateId,
        reviewStatus: 'IN_PROGRESS',
      })
      .onConflictDoNothing({ target: onboardingSubmissions.onboardingLinkId });

    res.cookie('nhr_onb_session', `${link.id}.${link.tokenHash}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 4 * 3600 * 1000,
      path: '/',
    });

    res.json({ verified: true });
  } catch (error) {
    console.error('Verify onboarding OTP error:', error);
    res.status(500).json({ error: 'OTP verification failed.' });
  }
});

router.get('/public/onboarding/:token/workspace', async (req, res) => {
  try {
    const { link, error } = await resolveValidLink(req.params.token);
    if (!link) return res.status(404).json({ error });
    if (!(await verifyOnboardingSessionCookie(req, link.id))) {
      return res.status(401).json({ error: 'OTP verification required.' });
    }

    const [cand] = await db.select().from(candidates).where(eq(candidates.id, link.candidateId));
    const [sub] = await db
      .select()
      .from(onboardingSubmissions)
      .where(eq(onboardingSubmissions.onboardingLinkId, link.id));
    const categories = await db
      .select()
      .from(documentCategories)
      .where(eq(documentCategories.isEnabled, true))
      .orderBy(documentCategories.sortOrder);
    const docs = await db
      .select({
        id: candidateDocuments.id,
        categoryId: candidateDocuments.categoryId,
        documentName: candidateDocuments.documentName,
        originalFileName: candidateDocuments.originalFileName,
        fileSizeBytes: candidateDocuments.fileSizeBytes,
        version: candidateDocuments.version,
        verificationStatus: candidateDocuments.verificationStatus,
        rejectionRemarks: candidateDocuments.rejectionRemarks,
        uploadedAt: candidateDocuments.uploadedAt,
      })
      .from(candidateDocuments)
      .where(eq(candidateDocuments.candidateId, link.candidateId))
      .orderBy(desc(candidateDocuments.uploadedAt));

    res.json({
      candidate: cand,
      linkStatus: link.status,
      submittedAt: link.submittedAt,
      submission: sub,
      categories,
      documents: docs,
    });
  } catch (error) {
    console.error('Onboarding workspace error:', error);
    res.status(500).json({ error: 'Failed to load onboarding workspace.' });
  }
});

router.put('/public/onboarding/:token/draft', async (req, res) => {
  try {
    const { link, error } = await resolveValidLink(req.params.token);
    if (!link) return res.status(404).json({ error });
    if (!(await verifyOnboardingSessionCookie(req, link.id))) {
      return res.status(401).json({ error: 'OTP verification required.' });
    }

    const [sub] = await db
      .select()
      .from(onboardingSubmissions)
      .where(eq(onboardingSubmissions.onboardingLinkId, link.id));
    if (sub?.reviewStatus === 'SUBMITTED' || sub?.reviewStatus === 'APPROVED') {
      return res.status(409).json({ error: 'Application has already been submitted.' });
    }

    const { personalInfo, educationInfo, employmentInfo, bankingInfo, draftStep } = req.body as Record<string, any>;

    await db
      .update(onboardingSubmissions)
      .set({
        ...(personalInfo ? { personalInfoJson: personalInfo } : {}),
        ...(Array.isArray(educationInfo) ? { educationInfoJson: educationInfo } : {}),
        ...(Array.isArray(employmentInfo) ? { employmentInfoJson: employmentInfo } : {}),
        ...(bankingInfo ? { bankingInfoJson: bankingInfo } : {}),
        ...(typeof draftStep === 'number' ? { draftStep } : {}),
        updatedAt: new Date(),
      })
      .where(eq(onboardingSubmissions.onboardingLinkId, link.id));

    if (['GENERATED', 'SHARED', 'OPENED', 'OTP_VERIFIED'].includes(link.status)) {
      await db
        .update(onboardingLinks)
        .set({ status: 'FORM_STARTED' })
        .where(eq(onboardingLinks.id, link.id));
    }

    res.json({ saved: true });
  } catch (error) {
    console.error('Save onboarding draft error:', error);
    res.status(500).json({ error: 'Failed to save draft.' });
  }
});

router.post('/public/onboarding/:token/documents', upload.single('file'), async (req, res) => {
  try {
    const { link, error } = await resolveValidLink(req.params.token);
    if (!link) return res.status(404).json({ error });
    if (!(await verifyOnboardingSessionCookie(req, link.id))) {
      return res.status(401).json({ error: 'OTP verification required.' });
    }
    if (!req.file) return res.status(400).json({ error: 'Please select a file to upload.' });

    const categoryId = Number(req.body.categoryId);
    const [cat] = await db.select().from(documentCategories).where(eq(documentCategories.id, categoryId));
    if (!cat || !cat.isEnabled) return res.status(400).json({ error: 'Invalid document category.' });

    const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowedMimes.includes(req.file.mimetype) || !validateFileMagicBytes(req.file.buffer, req.file.mimetype)) {
      return res.status(400).json({ error: 'Only authentic PDF, JPG, and PNG files (max 10 MB) are accepted.' });
    }

    const existingDocs = await db
      .select()
      .from(candidateDocuments)
      .where(and(eq(candidateDocuments.candidateId, link.candidateId), eq(candidateDocuments.categoryId, cat.id)));

    const nextVersion = existingDocs.length > 0 ? Math.max(...existingDocs.map((d) => d.version)) + 1 : 1;

    await fs.mkdir(ENCRYPTED_STORAGE_DIR, { recursive: true });
    const { encrypted, ivHex, tagHex } = encryptBuffer(req.file.buffer);
    const fileKey = `cand_${link.candidateId}_cat_${cat.id}_v${nextVersion}_${generateRandomToken(8)}.enc`;
    await fs.writeFile(path.join(ENCRYPTED_STORAGE_DIR, fileKey), encrypted);

    const [createdDoc] = await db
      .insert(candidateDocuments)
      .values({
        candidateId: link.candidateId,
        categoryId: cat.id,
        documentName: cat.name,
        originalFileName: req.file.originalname,
        mimeType: req.file.mimetype,
        fileSizeBytes: req.file.size,
        encryptedStoragePath: fileKey,
        encryptionIv: ivHex,
        encryptionTag: tagHex,
        version: nextVersion,
        verificationStatus: 'PENDING',
        uploadedByRole: 'CANDIDATE',
      })
      .returning();

    await db.insert(documentVerificationLogs).values({
      documentId: createdDoc.id,
      action: 'UPLOADED',
      remarks: `Candidate uploaded version ${nextVersion}`,
    });

    if (!['SUBMITTED', 'APPROVED', 'COMPLETED'].includes(link.status)) {
      await db
        .update(onboardingLinks)
        .set({ status: 'DOCS_UPLOADED' })
        .where(eq(onboardingLinks.id, link.id));
    }

    const [cand] = await db.select().from(candidates).where(eq(candidates.id, link.candidateId));
    if (cand) {
      await notifyRecruiterById(cand.assignedRecruiterId, {
        title: 'Candidate Uploaded Document',
        message: `${cand.fullName} uploaded ${cat.name} (v${nextVersion}).`,
        eventType: 'DOCUMENTS_UPLOADED',
        entityType: 'DOCUMENT',
        entityId: createdDoc.id,
      });
      await notifyRoles(['ADMIN'], {
        title: 'Document Pending Verification',
        message: `${cand.fullName} uploaded ${cat.name} for review.`,
        eventType: 'DOCUMENTS_UPLOADED',
        entityType: 'DOCUMENT',
        entityId: createdDoc.id,
      });
    }

    res.status(201).json({ document: createdDoc });
  } catch (error) {
    console.error('Candidate document upload error:', error);
    res.status(500).json({ error: 'Failed to encrypt and save uploaded document.' });
  }
});

router.post('/public/onboarding/:token/documents/:docId/download-token', async (req, res) => {
  try {
    const { link, error } = await resolveValidLink(req.params.token);
    if (!link) return res.status(404).json({ error });
    if (!(await verifyOnboardingSessionCookie(req, link.id))) {
      return res.status(401).json({ error: 'OTP verification required.' });
    }

    const docId = Number(req.params.docId);
    const [doc] = await db.select().from(candidateDocuments).where(eq(candidateDocuments.id, docId));
    if (!doc || doc.candidateId !== link.candidateId) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    const token = signDownloadToken({
      docId: doc.id,
      actorType: 'CANDIDATE',
      actorId: link.candidateId,
    });
    res.json({ url: `/api/documents/${doc.id}/stream?token=${encodeURIComponent(token)}` });
  } catch (error) {
    console.error('Candidate doc token error:', error);
    res.status(500).json({ error: 'Failed to authorize document preview.' });
  }
});

router.post('/public/onboarding/:token/submit', async (req, res) => {
  try {
    const { link, error } = await resolveValidLink(req.params.token);
    if (!link) return res.status(404).json({ error });
    if (!(await verifyOnboardingSessionCookie(req, link.id))) {
      return res.status(401).json({ error: 'OTP verification required.' });
    }

    const [sub] = await db
      .select()
      .from(onboardingSubmissions)
      .where(eq(onboardingSubmissions.onboardingLinkId, link.id));
    if (!sub) return res.status(400).json({ error: 'Complete onboarding forms before submitting.' });
    if (sub.reviewStatus === 'SUBMITTED' || sub.reviewStatus === 'APPROVED') {
      return res.status(409).json({ error: 'Duplicate submission prevented: application already submitted.' });
    }

    const { consentAccepted } = req.body as { consentAccepted?: boolean };
    if (!consentAccepted) {
      return res.status(400).json({ error: 'You must accept the DPDP Act Privacy & Declaration consent before submitting.' });
    }

    // Verify all required enabled categories have an uploaded document
    const requiredCats = await db
      .select()
      .from(documentCategories)
      .where(and(eq(documentCategories.isEnabled, true), eq(documentCategories.isRequired, true)));
    const uploadedDocs = await db
      .select()
      .from(candidateDocuments)
      .where(eq(candidateDocuments.candidateId, link.candidateId));
    const uploadedCatIds = new Set(uploadedDocs.map((d) => d.categoryId));
    const missing = requiredCats.filter((c) => !uploadedCatIds.has(c.id));
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Please upload all mandatory documents before final submission: ${missing.map((m) => m.name).join(', ')}`,
      });
    }

    const now = new Date();
    const ip = getClientIp(req);

    await db
      .update(onboardingSubmissions)
      .set({
        consentAccepted: true,
        consentTimestamp: now,
        consentIp: ip,
        reviewStatus: 'SUBMITTED',
        updatedAt: now,
      })
      .where(eq(onboardingSubmissions.id, sub.id));

    await db
      .update(onboardingLinks)
      .set({ status: 'SUBMITTED', submittedAt: now })
      .where(eq(onboardingLinks.id, link.id));

    // Persist normalized addresses, education, employment into candidate tables
    const personal = sub.personalInfoJson as Record<string, string>;
    if (personal?.currentAddress) {
      await db.insert(candidateAddresses).values({
        candidateId: link.candidateId,
        addressType: 'CURRENT',
        line1: sanitizeText(String(personal.currentAddress)),
        city: sanitizeText(String(personal.city || 'India')),
        state: sanitizeText(String(personal.state || 'N/A')),
        pincode: sanitizeText(String(personal.pincode || '000000')),
      });
    }
    if (Array.isArray(sub.educationInfoJson)) {
      for (const edu of sub.educationInfoJson as Record<string, string>[]) {
        if (edu.level && edu.institution) {
          await db.insert(candidateEducation).values({
            candidateId: link.candidateId,
            level: sanitizeText(edu.level),
            institution: sanitizeText(edu.institution),
            boardOrUniversity: sanitizeText(edu.boardOrUniversity || 'Recognized Board'),
            yearOfPassing: sanitizeText(edu.yearOfPassing || ''),
            percentageOrCgpa: sanitizeText(edu.percentageOrCgpa || ''),
          });
        }
      }
    }
    if (Array.isArray(sub.employmentInfoJson)) {
      for (const emp of sub.employmentInfoJson as Record<string, string>[]) {
        if (emp.companyName && emp.designation) {
          await db.insert(candidateEmployment).values({
            candidateId: link.candidateId,
            companyName: sanitizeText(emp.companyName),
            designation: sanitizeText(emp.designation),
            startDate: sanitizeText(emp.startDate || ''),
            endDate: emp.endDate ? sanitizeText(emp.endDate) : null,
            lastCtc: emp.lastCtc ? sanitizeText(emp.lastCtc) : null,
            reasonForLeaving: emp.reasonForLeaving ? sanitizeText(emp.reasonForLeaving) : null,
          });
        }
      }
    }

    const [cand] = await db.select().from(candidates).where(eq(candidates.id, link.candidateId));
    if (cand) {
      await db
        .update(candidates)
        .set({ currentStatus: 'DOCUMENTS_SUBMITTED', updatedAt: now })
        .where(eq(candidates.id, cand.id));

      await db.insert(recruitmentStatusHistory).values({
        candidateId: cand.id,
        fromStatus: cand.currentStatus,
        toStatus: 'DOCUMENTS_SUBMITTED',
        remarks: 'Candidate completed and submitted onboarding application with DPDP consent',
      });

      await notifyRecruiterById(cand.assignedRecruiterId, {
        title: 'Onboarding Application Submitted',
        message: `${cand.fullName} submitted their complete onboarding profile and documents.`,
        eventType: 'ONBOARDING_SUBMITTED',
        entityType: 'ONBOARDING',
        entityId: link.id,
      });

      await notifyRoles(['ADMIN', 'SUPER_ADMIN'], {
        title: 'New Onboarding Submission for Review',
        message: `${cand.fullName} (${cand.candidateCode}) submitted onboarding documents for verification.`,
        eventType: 'ONBOARDING_SUBMITTED',
        entityType: 'ONBOARDING',
        entityId: link.id,
      });
    }

    res.json({ submitted: true, submittedAt: now });
  } catch (error) {
    console.error('Submit onboarding error:', error);
    res.status(500).json({ error: 'Failed to submit onboarding application.' });
  }
});

export default router;
