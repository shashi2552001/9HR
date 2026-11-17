import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  candidateAddresses,
  candidateAssignments,
  candidateDocuments,
  candidateEducation,
  candidateEmployment,
  candidates,
  documentCategories,
  interviewFeedback,
  interviews,
  jobRecruiters,
  jobs,
  offers,
  onboardingLinks,
  recruiters,
  recruitmentStatusHistory,
  users,
} from '../../db/schema.ts';
import {
  type AuthenticatedRequest,
  getClientIp,
  requireAuth,
  requireRole,
} from '../middleware.ts';
import {
  encryptBuffer,
  generateRandomToken,
  sanitizeText,
  validateFileMagicBytes,
} from '../security.ts';
import { notifyRecruiterById, notifyRoles, recordAuditLog } from '../audit.ts';
import { PIPELINE_STAGES } from '../constants.ts';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const ENCRYPTED_STORAGE_DIR = path.resolve(process.cwd(), 'storage', 'encrypted_docs');

async function ensureCandidateAccess(
  authUser: NonNullable<AuthenticatedRequest['authUser']>,
  candidateId: number,
) {
  const [cand] = await db.select().from(candidates).where(eq(candidates.id, candidateId));
  if (!cand) return { cand: null, allowed: false };
  if (authUser.roleName === 'SUPER_ADMIN' || authUser.roleName === 'ADMIN') {
    return { cand, allowed: true };
  }
  const allowed = Boolean(authUser.recruiterId && cand.assignedRecruiterId === authUser.recruiterId);
  return { cand, allowed };
}

// ---------------- JOBS ----------------
router.get('/jobs', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const authUser = req.authUser!;
    const allJobs = await db.select().from(jobs).orderBy(desc(jobs.createdAt));
    const assignments = await db
      .select({
        jobId: jobRecruiters.jobId,
        recruiterId: jobRecruiters.recruiterId,
        recruiterName: users.fullName,
      })
      .from(jobRecruiters)
      .innerJoin(recruiters, eq(jobRecruiters.recruiterId, recruiters.id))
      .innerJoin(users, eq(recruiters.userId, users.id));

    const candCounts = await db.select({ jobId: candidates.jobId }).from(candidates);

    const enriched = allJobs.map((job) => ({
      ...job,
      assignedRecruiters: assignments.filter((a) => a.jobId === job.id),
      applicantCount: candCounts.filter((c) => c.jobId === job.id).length,
    }));

    if (authUser.roleName === 'RECRUITER' && authUser.recruiterId) {
      // Recruiters see jobs assigned to them or open jobs
      const filtered = enriched.filter(
        (j) =>
          j.status === 'OPEN' ||
          j.assignedRecruiters.some((a) => a.recruiterId === authUser.recruiterId),
      );
      return res.json({ jobs: filtered });
    }

    res.json({ jobs: enriched });
  } catch (error) {
    console.error('List jobs error:', error);
    res.status(500).json({ error: 'Failed to load job openings.' });
  }
});

const jobSchema = z.object({
  title: z.string().min(2).max(150),
  department: z.string().min(2).max(100),
  clientCompany: z.string().min(2).max(150),
  location: z.string().min(2).max(120),
  employmentType: z.string().min(2).max(50),
  experienceMin: z.coerce.number().int().min(0).max(40),
  experienceMax: z.coerce.number().int().min(0).max(50),
  salaryRange: z.string().min(2).max(80),
  vacancies: z.coerce.number().int().min(1).max(500),
  requiredSkills: z.string().min(2).max(400),
  description: z.string().min(5).max(4000),
  closingDate: z.string().min(4).max(30),
  status: z.enum(['OPEN', 'PAUSED', 'CLOSED', 'FILLED']).optional(),
  recruiterIds: z.array(z.number().int()).optional(),
});

router.post('/jobs', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = jobSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Please complete all required job fields.' });
    }

    const data = parsed.data;
    const jobCode = `9HR-JOB-${Math.floor(100 + Math.random() * 900)}-${Date.now().toString().slice(-3)}`;

    const [created] = await db
      .insert(jobs)
      .values({
        jobCode,
        title: sanitizeText(data.title),
        department: sanitizeText(data.department),
        clientCompany: sanitizeText(data.clientCompany),
        location: sanitizeText(data.location),
        employmentType: data.employmentType,
        experienceMin: data.experienceMin,
        experienceMax: data.experienceMax,
        salaryRange: sanitizeText(data.salaryRange),
        vacancies: data.vacancies,
        requiredSkills: sanitizeText(data.requiredSkills),
        description: sanitizeText(data.description),
        closingDate: data.closingDate,
        status: data.status || 'OPEN',
        createdBy: req.authUser!.id,
      })
      .returning();

    if (data.recruiterIds?.length) {
      for (const recId of data.recruiterIds) {
        await db.insert(jobRecruiters).values({ jobId: created.id, recruiterId: recId }).onConflictDoNothing();
      }
    }

    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.roleName,
      action: 'JOB_CREATED',
      targetType: 'JOB',
      targetId: created.id,
      details: { jobCode: created.jobCode, title: created.title },
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ job: created });
  } catch (error) {
    console.error('Create job error:', error);
    res.status(500).json({ error: 'Failed to create job opening.' });
  }
});

router.patch('/jobs/:id', requireAuth, requireRole('SUPER_ADMIN', 'ADMIN'), async (req: AuthenticatedRequest, res) => {
  try {
    const jobId = Number(req.params.id);
    if (!Number.isInteger(jobId)) return res.status(400).json({ error: 'Invalid job ID.' });

    const {
      title,
      department,
      clientCompany,
      location,
      employmentType,
      experienceMin,
      experienceMax,
      requiredSkills,
      description,
      status,
      vacancies,
      salaryRange,
      closingDate,
      recruiterIds,
    } = req.body as Record<string, any>;

    await db
      .update(jobs)
      .set({
        ...(typeof title === 'string' && title.trim() ? { title: sanitizeText(title) } : {}),
        ...(typeof department === 'string' && department.trim() ? { department: sanitizeText(department) } : {}),
        ...(typeof clientCompany === 'string' && clientCompany.trim() ? { clientCompany: sanitizeText(clientCompany) } : {}),
        ...(typeof location === 'string' && location.trim() ? { location: sanitizeText(location) } : {}),
        ...(typeof employmentType === 'string' && employmentType.trim() ? { employmentType: sanitizeText(employmentType) } : {}),
        ...(typeof experienceMin === 'number' ? { experienceMin } : {}),
        ...(typeof experienceMax === 'number' ? { experienceMax } : {}),
        ...(typeof requiredSkills === 'string' && requiredSkills.trim() ? { requiredSkills: sanitizeText(requiredSkills) } : {}),
        ...(typeof description === 'string' && description.trim() ? { description: sanitizeText(description) } : {}),
        ...(status ? { status } : {}),
        ...(typeof vacancies === 'number' ? { vacancies } : {}),
        ...(typeof salaryRange === 'string' ? { salaryRange: sanitizeText(salaryRange) } : {}),
        ...(typeof closingDate === 'string' ? { closingDate } : {}),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    if (Array.isArray(recruiterIds)) {
      await db.delete(jobRecruiters).where(eq(jobRecruiters.jobId, jobId));
      for (const recId of recruiterIds) {
        await db.insert(jobRecruiters).values({ jobId, recruiterId: Number(recId) }).onConflictDoNothing();
      }
    }

    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.roleName,
      action: 'JOB_UPDATED',
      targetType: 'JOB',
      targetId: jobId,
      details: { status, vacancies },
      ipAddress: getClientIp(req),
    });

    res.json({ updated: true });
  } catch (error) {
    console.error('Update job error:', error);
    res.status(500).json({ error: 'Failed to update job opening.' });
  }
});

// ---------------- CANDIDATES ----------------
router.get('/candidates', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const authUser = req.authUser!;
    const statusFilter = String(req.query.status || '').trim();
    const search = String(req.query.search || '').trim().toLowerCase();

    const baseQuery = db
      .select({
        id: candidates.id,
        candidateCode: candidates.candidateCode,
        fullName: candidates.fullName,
        mobile: candidates.mobile,
        email: candidates.email,
        totalExperienceYears: candidates.totalExperienceYears,
        currentCompany: candidates.currentCompany,
        currentSalary: candidates.currentSalary,
        expectedSalary: candidates.expectedSalary,
        noticePeriodDays: candidates.noticePeriodDays,
        skills: candidates.skills,
        source: candidates.source,
        currentStatus: candidates.currentStatus,
        assignedRecruiterId: candidates.assignedRecruiterId,
        jobId: candidates.jobId,
        joiningDate: candidates.joiningDate,
        createdAt: candidates.createdAt,
        jobTitle: jobs.title,
        clientCompany: jobs.clientCompany,
        recruiterName: users.fullName,
      })
      .from(candidates)
      .leftJoin(jobs, eq(candidates.jobId, jobs.id))
      .leftJoin(recruiters, eq(candidates.assignedRecruiterId, recruiters.id))
      .leftJoin(users, eq(recruiters.userId, users.id));

    let rows =
      authUser.roleName === 'RECRUITER'
        ? authUser.recruiterId
          ? await baseQuery
              .where(eq(candidates.assignedRecruiterId, authUser.recruiterId))
              .orderBy(desc(candidates.createdAt))
          : []
        : await baseQuery.orderBy(desc(candidates.createdAt));

    if (statusFilter) {
      rows = rows.filter((r) => r.currentStatus === statusFilter);
    }
    if (search) {
      rows = rows.filter(
        (r) =>
          r.fullName.toLowerCase().includes(search) ||
          r.email.toLowerCase().includes(search) ||
          r.candidateCode.toLowerCase().includes(search) ||
          r.skills.toLowerCase().includes(search),
      );
    }

    res.json({ candidates: rows, stages: PIPELINE_STAGES });
  } catch (error) {
    console.error('List candidates error:', error);
    res.status(500).json({ error: 'Failed to load candidates.' });
  }
});

router.get('/candidates/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const candidateId = Number(req.params.id);
    if (!Number.isInteger(candidateId)) return res.status(400).json({ error: 'Invalid candidate ID.' });

    const { cand, allowed } = await ensureCandidateAccess(req.authUser!, candidateId);
    if (!cand) return res.status(404).json({ error: 'Candidate not found.' });
    if (!allowed) return res.status(403).json({ error: 'Access denied to this candidate record.' });

    const [jobRow] = cand.jobId ? await db.select().from(jobs).where(eq(jobs.id, cand.jobId)) : [null];
    const [recRow] = cand.assignedRecruiterId
      ? await db
          .select({ id: recruiters.id, fullName: users.fullName, email: users.email })
          .from(recruiters)
          .innerJoin(users, eq(recruiters.userId, users.id))
          .where(eq(recruiters.id, cand.assignedRecruiterId))
      : [null];

    const addresses = await db.select().from(candidateAddresses).where(eq(candidateAddresses.candidateId, cand.id));
    const education = await db.select().from(candidateEducation).where(eq(candidateEducation.candidateId, cand.id));
    const employment = await db.select().from(candidateEmployment).where(eq(candidateEmployment.candidateId, cand.id));
    const statusHistory = await db
      .select({
        id: recruitmentStatusHistory.id,
        fromStatus: recruitmentStatusHistory.fromStatus,
        toStatus: recruitmentStatusHistory.toStatus,
        remarks: recruitmentStatusHistory.remarks,
        changedAt: recruitmentStatusHistory.changedAt,
        changedByName: users.fullName,
      })
      .from(recruitmentStatusHistory)
      .leftJoin(users, eq(recruitmentStatusHistory.changedBy, users.id))
      .where(eq(recruitmentStatusHistory.candidateId, cand.id))
      .orderBy(desc(recruitmentStatusHistory.changedAt));

    const candInterviews = await db
      .select()
      .from(interviews)
      .where(eq(interviews.candidateId, cand.id))
      .orderBy(desc(interviews.scheduledAt));

    const interviewIds = candInterviews.map((i) => i.id);
    const feedbacks = interviewIds.length
      ? await db.select().from(interviewFeedback).where(inArray(interviewFeedback.interviewId, interviewIds))
      : [];

    const candOffers = await db
      .select()
      .from(offers)
      .where(eq(offers.candidateId, cand.id))
      .orderBy(desc(offers.releasedAt));

    const links = await db
      .select()
      .from(onboardingLinks)
      .where(eq(onboardingLinks.candidateId, cand.id))
      .orderBy(desc(onboardingLinks.createdAt));

    const docs = await db
      .select({
        id: candidateDocuments.id,
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
      .innerJoin(documentCategories, eq(candidateDocuments.categoryId, documentCategories.id))
      .where(eq(candidateDocuments.candidateId, cand.id))
      .orderBy(desc(candidateDocuments.uploadedAt));

    res.json({
      candidate: cand,
      job: jobRow,
      recruiter: recRow,
      addresses,
      education,
      employment,
      statusHistory,
      interviews: candInterviews.map((iv) => ({
        ...iv,
        feedback: feedbacks.filter((f) => f.interviewId === iv.id),
      })),
      offers: candOffers,
      onboardingLinks: links,
      documents: docs,
    });
  } catch (error) {
    console.error('Candidate detail error:', error);
    res.status(500).json({ error: 'Failed to load candidate profile.' });
  }
});

const candidateCreateSchema = z.object({
  fullName: z.string().min(2).max(120),
  mobile: z.string().min(8).max(25),
  email: z.string().email(),
  dob: z.string().optional(),
  gender: z.string().optional(),
  currentAddress: z.string().optional(),
  permanentAddress: z.string().optional(),
  educationSummary: z.string().optional(),
  totalExperienceYears: z.string().default('0'),
  currentCompany: z.string().optional(),
  previousCompany: z.string().optional(),
  currentSalary: z.string().optional(),
  expectedSalary: z.string().optional(),
  noticePeriodDays: z.coerce.number().int().min(0).max(365).optional(),
  skills: z.string().min(2),
  source: z.string().default('Direct'),
  jobId: z.coerce.number().int().optional(),
  assignedRecruiterId: z.coerce.number().int().optional(),
  forceDuplicate: z.boolean().optional(),
});

router.post('/candidates', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const authUser = req.authUser!;
    const parsed = candidateCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Please provide valid candidate full name, email, mobile, and skills.' });
    }

    const data = parsed.data;
    const email = data.email.toLowerCase().trim();

    if (!data.forceDuplicate) {
      const existing = await db
        .select({ id: candidates.id, candidateCode: candidates.candidateCode, fullName: candidates.fullName })
        .from(candidates)
        .where(eq(candidates.email, email));
      if (existing.length > 0) {
        return res.status(409).json({
          error: `Duplicate candidate found: ${existing[0].fullName} (${existing[0].candidateCode}). Confirm override to proceed.`,
          duplicate: existing[0],
        });
      }
    }

    const recruiterId =
      authUser.roleName === 'RECRUITER'
        ? authUser.recruiterId
        : data.assignedRecruiterId || authUser.recruiterId || null;

    const candidateCode = `9HR-${new Date().getFullYear()}-${String(Math.floor(1000 + Math.random() * 9000))}`;

    const [created] = await db
      .insert(candidates)
      .values({
        candidateCode,
        fullName: sanitizeText(data.fullName),
        mobile: sanitizeText(data.mobile),
        email,
        dob: data.dob || null,
        gender: data.gender || null,
        educationSummary: data.educationSummary ? sanitizeText(data.educationSummary) : null,
        totalExperienceYears: data.totalExperienceYears,
        currentCompany: data.currentCompany ? sanitizeText(data.currentCompany) : null,
        previousCompany: data.previousCompany ? sanitizeText(data.previousCompany) : null,
        currentSalary: data.currentSalary ? sanitizeText(data.currentSalary) : null,
        expectedSalary: data.expectedSalary ? sanitizeText(data.expectedSalary) : null,
        noticePeriodDays: data.noticePeriodDays ?? 30,
        skills: sanitizeText(data.skills),
        source: sanitizeText(data.source),
        currentStatus: 'NEW_CANDIDATE',
        assignedRecruiterId: recruiterId,
        jobId: data.jobId || null,
        createdBy: authUser.id,
      })
      .returning();

    if (data.currentAddress) {
      await db.insert(candidateAddresses).values({
        candidateId: created.id,
        addressType: 'CURRENT',
        line1: sanitizeText(data.currentAddress),
        city: 'India',
        state: 'N/A',
        pincode: '000000',
      });
    }
    if (data.permanentAddress) {
      await db.insert(candidateAddresses).values({
        candidateId: created.id,
        addressType: 'PERMANENT',
        line1: sanitizeText(data.permanentAddress),
        city: 'India',
        state: 'N/A',
        pincode: '000000',
      });
    }

    if (recruiterId) {
      await db.insert(candidateAssignments).values({
        candidateId: created.id,
        recruiterId,
        assignedBy: authUser.id,
        notes: 'Initial assignment on creation',
      });
    }

    await db.insert(recruitmentStatusHistory).values({
      candidateId: created.id,
      fromStatus: null,
      toStatus: 'NEW_CANDIDATE',
      remarks: 'Candidate profile created',
      changedBy: authUser.id,
    });

    await notifyRoles(['ADMIN', 'SUPER_ADMIN'], {
      title: 'New Candidate Added',
      message: `${created.fullName} (${created.candidateCode}) was added by ${authUser.fullName}.`,
      eventType: 'CANDIDATE_ADDED',
      entityType: 'CANDIDATE',
      entityId: created.id,
    });

    await recordAuditLog({
      actorUserId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.roleName,
      action: 'CANDIDATE_CREATED',
      targetType: 'CANDIDATE',
      targetId: created.id,
      details: { candidateCode: created.candidateCode, email: created.email },
      ipAddress: getClientIp(req),
    });

    res.status(201).json({ candidate: created });
  } catch (error) {
    console.error('Create candidate error:', error);
    res.status(500).json({ error: 'Failed to create candidate profile.' });
  }
});

// Bulk CSV / Excel Candidate Import
router.post('/candidates/import', requireAuth, upload.single('file'), async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Please upload a CSV or Excel (.xlsx/.xls) file.' });

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet);

    if (!rows.length) {
      return res.status(400).json({ error: 'Uploaded spreadsheet contains no rows.' });
    }

    const authUser = req.authUser!;
    const defaultJobId = req.body.jobId ? Number(req.body.jobId) : null;
    const recruiterId =
      authUser.roleName === 'RECRUITER'
        ? authUser.recruiterId
        : req.body.recruiterId
          ? Number(req.body.recruiterId)
          : authUser.recruiterId;

    let imported = 0;
    const skipped: string[] = [];

    for (const row of rows.slice(0, 200)) {
      const fullName = String(row.fullName || row['Full Name'] || row.Name || '').trim();
      const email = String(row.email || row['Email'] || row['Email Address'] || '')
        .trim()
        .toLowerCase();
      const mobile = String(row.mobile || row['Mobile'] || row['Phone'] || '').trim();
      const skills = String(row.skills || row['Skills'] || 'General').trim();

      if (!fullName || !email || !mobile) {
        skipped.push(email || fullName || 'Missing required columns');
        continue;
      }

      const dup = await db.select({ id: candidates.id }).from(candidates).where(eq(candidates.email, email));
      if (dup.length > 0) {
        skipped.push(`${email} (duplicate)`);
        continue;
      }

      const [cand] = await db
        .insert(candidates)
        .values({
          candidateCode: `9HR-${new Date().getFullYear()}-${String(Math.floor(1000 + Math.random() * 9000))}`,
          fullName: sanitizeText(fullName),
          email,
          mobile: sanitizeText(mobile),
          skills: sanitizeText(skills),
          totalExperienceYears: String(row.experience || row['Experience'] || '0'),
          currentCompany: row.currentCompany ? sanitizeText(String(row.currentCompany)) : null,
          expectedSalary: row.expectedSalary ? sanitizeText(String(row.expectedSalary)) : null,
          source: String(row.source || 'Bulk Import'),
          currentStatus: 'NEW_CANDIDATE',
          assignedRecruiterId: recruiterId || null,
          jobId: defaultJobId,
          createdBy: authUser.id,
        })
        .returning();

      await db.insert(recruitmentStatusHistory).values({
        candidateId: cand.id,
        fromStatus: null,
        toStatus: 'NEW_CANDIDATE',
        remarks: 'Imported via spreadsheet batch',
        changedBy: authUser.id,
      });
      imported++;
    }

    await recordAuditLog({
      actorUserId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.roleName,
      action: 'CANDIDATES_BULK_IMPORTED',
      targetType: 'CANDIDATE',
      details: { imported, skippedCount: skipped.length },
      ipAddress: getClientIp(req),
    });

    res.json({ imported, skipped });
  } catch (error) {
    console.error('Candidate import error:', error);
    res.status(500).json({ error: 'Failed to parse and import candidate spreadsheet.' });
  }
});

router.patch('/candidates/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const candidateId = Number(req.params.id);
    const { cand, allowed } = await ensureCandidateAccess(req.authUser!, candidateId);
    if (!cand) return res.status(404).json({ error: 'Candidate not found.' });
    if (!allowed) return res.status(403).json({ error: 'Access denied.' });

    const body = req.body as Record<string, any>;
    const updates: Partial<typeof candidates.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.fullName === 'string') updates.fullName = sanitizeText(body.fullName);
    if (typeof body.mobile === 'string') updates.mobile = sanitizeText(body.mobile);
    if (typeof body.skills === 'string') updates.skills = sanitizeText(body.skills);
    if (typeof body.currentCompany === 'string') updates.currentCompany = sanitizeText(body.currentCompany);
    if (typeof body.expectedSalary === 'string') updates.expectedSalary = sanitizeText(body.expectedSalary);
    if (typeof body.joiningDate === 'string') updates.joiningDate = body.joiningDate;
    if (body.jobId) updates.jobId = Number(body.jobId);

    // Reassign recruiter (Admin / Super Admin only)
    if (
      body.assignedRecruiterId &&
      (req.authUser!.roleName === 'SUPER_ADMIN' || req.authUser!.roleName === 'ADMIN')
    ) {
      const nextRecId = Number(body.assignedRecruiterId);
      updates.assignedRecruiterId = nextRecId;
      await db.insert(candidateAssignments).values({
        candidateId: cand.id,
        recruiterId: nextRecId,
        assignedBy: req.authUser!.id,
        notes: 'Reassigned by HR Operations',
      });
      await notifyRecruiterById(nextRecId, {
        title: 'Candidate Assigned',
        message: `${cand.fullName} (${cand.candidateCode}) has been assigned to your pipeline.`,
        eventType: 'CANDIDATE_ASSIGNED',
        entityType: 'CANDIDATE',
        entityId: cand.id,
      });
    }

    await db.update(candidates).set(updates).where(eq(candidates.id, candidateId));
    res.json({ updated: true });
  } catch (error) {
    console.error('Update candidate error:', error);
    res.status(500).json({ error: 'Failed to update candidate.' });
  }
});

router.post('/candidates/:id/status', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const candidateId = Number(req.params.id);
    const { cand, allowed } = await ensureCandidateAccess(req.authUser!, candidateId);
    if (!cand) return res.status(404).json({ error: 'Candidate not found.' });
    if (!allowed) return res.status(403).json({ error: 'Access denied.' });

    const { status, remarks } = req.body as { status?: string; remarks?: string };
    const validStage = PIPELINE_STAGES.find((s) => s.code === status);
    if (!validStage) return res.status(400).json({ error: 'Invalid recruitment status.' });

    await db
      .update(candidates)
      .set({ currentStatus: validStage.code, updatedAt: new Date() })
      .where(eq(candidates.id, candidateId));

    await db.insert(recruitmentStatusHistory).values({
      candidateId,
      fromStatus: cand.currentStatus,
      toStatus: validStage.code,
      remarks: remarks ? sanitizeText(remarks) : null,
      changedBy: req.authUser!.id,
    });

    if (validStage.code === 'SELECTED') {
      await notifyRoles(['ADMIN', 'SUPER_ADMIN'], {
        title: 'Candidate Selected',
        message: `${cand.fullName} (${cand.candidateCode}) has been marked Selected.`,
        eventType: 'CANDIDATE_SELECTED',
        entityType: 'CANDIDATE',
        entityId: cand.id,
      });
    }

    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.roleName,
      action: 'CANDIDATE_STATUS_CHANGED',
      targetType: 'CANDIDATE',
      targetId: cand.id,
      details: { from: cand.currentStatus, to: validStage.code },
      ipAddress: getClientIp(req),
    });

    res.json({ updated: true, status: validStage.code });
  } catch (error) {
    console.error('Candidate status error:', error);
    res.status(500).json({ error: 'Failed to update candidate pipeline status.' });
  }
});

// Upload encrypted resume for candidate
router.post('/candidates/:id/resume', requireAuth, upload.single('file'), async (req: AuthenticatedRequest, res) => {
  try {
    const candidateId = Number(req.params.id);
    const { cand, allowed } = await ensureCandidateAccess(req.authUser!, candidateId);
    if (!cand) return res.status(404).json({ error: 'Candidate not found.' });
    if (!allowed) return res.status(403).json({ error: 'Access denied.' });
    if (!req.file) return res.status(400).json({ error: 'No resume file provided.' });

    const allowedMimes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowedMimes.includes(req.file.mimetype) || !validateFileMagicBytes(req.file.buffer, req.file.mimetype)) {
      return res.status(400).json({ error: 'Resume must be a valid PDF, JPG, or PNG file.' });
    }

    const [resumeCat] = await db
      .select()
      .from(documentCategories)
      .where(eq(documentCategories.code, 'OTHER_RESUME'));
    if (!resumeCat) return res.status(500).json({ error: 'Resume document category missing.' });

    await fs.mkdir(ENCRYPTED_STORAGE_DIR, { recursive: true });
    const { encrypted, ivHex, tagHex } = encryptBuffer(req.file.buffer);
    const fileKey = `cand_${cand.id}_resume_${generateRandomToken(8)}.enc`;
    const fullPath = path.join(ENCRYPTED_STORAGE_DIR, fileKey);
    await fs.writeFile(fullPath, encrypted);

    const [doc] = await db
      .insert(candidateDocuments)
      .values({
        candidateId: cand.id,
        categoryId: resumeCat.id,
        documentName: 'Candidate Resume / CV',
        originalFileName: req.file.originalname,
        mimeType: req.file.mimetype,
        fileSizeBytes: req.file.size,
        encryptedStoragePath: fileKey,
        encryptionIv: ivHex,
        encryptionTag: tagHex,
        version: 1,
        verificationStatus: 'APPROVED',
        uploadedByRole: req.authUser!.roleName,
        verifiedBy: req.authUser!.id,
        verifiedAt: new Date(),
      })
      .returning();

    await db.update(candidates).set({ resumeFileId: doc.id }).where(eq(candidates.id, cand.id));
    res.status(201).json({ documentId: doc.id });
  } catch (error) {
    console.error('Resume upload error:', error);
    res.status(500).json({ error: 'Failed to store encrypted resume.' });
  }
});

// ---------------- INTERVIEWS ----------------
router.get('/interviews', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const authUser = req.authUser!;
    const rows = await db
      .select({
        id: interviews.id,
        candidateId: interviews.candidateId,
        candidateName: candidates.fullName,
        candidateCode: candidates.candidateCode,
        assignedRecruiterId: candidates.assignedRecruiterId,
        jobId: interviews.jobId,
        jobTitle: jobs.title,
        roundName: interviews.roundName,
        scheduledAt: interviews.scheduledAt,
        durationMinutes: interviews.durationMinutes,
        mode: interviews.mode,
        meetingLinkOrVenue: interviews.meetingLinkOrVenue,
        interviewerName: interviews.interviewerName,
        interviewerEmail: interviews.interviewerEmail,
        status: interviews.status,
      })
      .from(interviews)
      .innerJoin(candidates, eq(interviews.candidateId, candidates.id))
      .leftJoin(jobs, eq(interviews.jobId, jobs.id))
      .orderBy(desc(interviews.scheduledAt));

    const filtered =
      authUser.roleName === 'RECRUITER'
        ? rows.filter((r) => authUser.recruiterId && r.assignedRecruiterId === authUser.recruiterId)
        : rows;

    const ids = filtered.map((r) => r.id);
    const feedbacks = ids.length
      ? await db.select().from(interviewFeedback).where(inArray(interviewFeedback.interviewId, ids))
      : [];

    res.json({
      interviews: filtered.map((r) => ({
        ...r,
        feedback: feedbacks.filter((f) => f.interviewId === r.id),
      })),
    });
  } catch (error) {
    console.error('List interviews error:', error);
    res.status(500).json({ error: 'Failed to load interviews.' });
  }
});

router.post('/interviews', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const schema = z.object({
      candidateId: z.coerce.number().int(),
      roundName: z.string().min(2).max(120),
      scheduledAt: z.string().min(8),
      durationMinutes: z.coerce.number().int().min(15).max(240).default(45),
      mode: z.enum(['VIDEO', 'IN_PERSON', 'PHONE']).default('VIDEO'),
      meetingLinkOrVenue: z.string().min(2).max(300),
      interviewerName: z.string().min(2).max(120),
      interviewerEmail: z.string().email().optional().or(z.literal('')),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid interview details.' });

    const data = parsed.data;
    const { cand, allowed } = await ensureCandidateAccess(req.authUser!, data.candidateId);
    if (!cand) return res.status(404).json({ error: 'Candidate not found.' });
    if (!allowed) return res.status(403).json({ error: 'Access denied.' });

    const [created] = await db
      .insert(interviews)
      .values({
        candidateId: cand.id,
        jobId: cand.jobId,
        roundName: sanitizeText(data.roundName),
        scheduledAt: new Date(data.scheduledAt),
        durationMinutes: data.durationMinutes,
        mode: data.mode,
        meetingLinkOrVenue: sanitizeText(data.meetingLinkOrVenue),
        interviewerName: sanitizeText(data.interviewerName),
        interviewerEmail: data.interviewerEmail || null,
        status: 'SCHEDULED',
        createdBy: req.authUser!.id,
      })
      .returning();

    if (cand.currentStatus !== 'INTERVIEW_SCHEDULED') {
      await db
        .update(candidates)
        .set({ currentStatus: 'INTERVIEW_SCHEDULED', updatedAt: new Date() })
        .where(eq(candidates.id, cand.id));
      await db.insert(recruitmentStatusHistory).values({
        candidateId: cand.id,
        fromStatus: cand.currentStatus,
        toStatus: 'INTERVIEW_SCHEDULED',
        remarks: `Scheduled ${data.roundName} with ${data.interviewerName}`,
        changedBy: req.authUser!.id,
      });
    }

    await notifyRecruiterById(cand.assignedRecruiterId, {
      title: 'Interview Scheduled',
      message: `${data.roundName} scheduled for ${cand.fullName} with ${data.interviewerName}.`,
      eventType: 'INTERVIEW_SCHEDULED',
      entityType: 'INTERVIEW',
      entityId: created.id,
    });

    res.status(201).json({ interview: created });
  } catch (error) {
    console.error('Schedule interview error:', error);
    res.status(500).json({ error: 'Failed to schedule interview.' });
  }
});

router.post('/interviews/:id/feedback', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const interviewId = Number(req.params.id);
    const [iv] = await db.select().from(interviews).where(eq(interviews.id, interviewId));
    if (!iv) return res.status(404).json({ error: 'Interview not found.' });

    const { cand, allowed } = await ensureCandidateAccess(req.authUser!, iv.candidateId);
    if (!cand || !allowed) return res.status(403).json({ error: 'Access denied.' });

    const schema = z.object({
      technicalRating: z.coerce.number().int().min(1).max(5),
      communicationRating: z.coerce.number().int().min(1).max(5),
      cultureRating: z.coerce.number().int().min(1).max(5),
      recommendation: z.enum(['STRONG_HIRE', 'HIRE', 'HOLD', 'REJECT']),
      comments: z.string().min(3).max(2000),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Provide valid interview ratings and comments.' });

    const [fb] = await db
      .insert(interviewFeedback)
      .values({
        interviewId,
        ...parsed.data,
        comments: sanitizeText(parsed.data.comments),
        submittedBy: req.authUser!.id,
      })
      .returning();

    await db.update(interviews).set({ status: 'COMPLETED' }).where(eq(interviews.id, interviewId));
    const nextCandStatus =
      parsed.data.recommendation === 'REJECT' ? 'REJECTED' : 'INTERVIEW_COMPLETED';
    await db
      .update(candidates)
      .set({ currentStatus: nextCandStatus, updatedAt: new Date() })
      .where(eq(candidates.id, cand.id));

    await db.insert(recruitmentStatusHistory).values({
      candidateId: cand.id,
      fromStatus: cand.currentStatus,
      toStatus: nextCandStatus,
      remarks: `Interview feedback: ${parsed.data.recommendation}`,
      changedBy: req.authUser!.id,
    });

    res.status(201).json({ feedback: fb });
  } catch (error) {
    console.error('Interview feedback error:', error);
    res.status(500).json({ error: 'Failed to submit interview feedback.' });
  }
});

router.patch('/interviews/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const interviewId = Number(req.params.id);
    if (!Number.isInteger(interviewId)) return res.status(400).json({ error: 'Invalid interview ID.' });

    const [iv] = await db.select().from(interviews).where(eq(interviews.id, interviewId));
    if (!iv) return res.status(404).json({ error: 'Interview not found.' });

    const { cand, allowed } = await ensureCandidateAccess(req.authUser!, iv.candidateId);
    if (!cand || !allowed) return res.status(403).json({ error: 'Access denied.' });

    const { status, scheduledAt, mode, meetingLinkOrVenue, interviewerName } = req.body as Record<string, any>;
    if (status && !['SCHEDULED', 'COMPLETED', 'RESCHEDULED', 'CANCELLED', 'NO_SHOW'].includes(String(status))) {
      return res.status(400).json({ error: 'Invalid interview status.' });
    }

    await db
      .update(interviews)
      .set({
        ...(status ? { status: String(status) } : {}),
        ...(scheduledAt ? { scheduledAt: new Date(String(scheduledAt)) } : {}),
        ...(mode && ['VIDEO', 'IN_PERSON', 'PHONE'].includes(String(mode)) ? { mode: String(mode) } : {}),
        ...(typeof meetingLinkOrVenue === 'string' && meetingLinkOrVenue.trim()
          ? { meetingLinkOrVenue: sanitizeText(meetingLinkOrVenue) }
          : {}),
        ...(typeof interviewerName === 'string' && interviewerName.trim()
          ? { interviewerName: sanitizeText(interviewerName) }
          : {}),
      })
      .where(eq(interviews.id, interviewId));

    await recordAuditLog({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.roleName,
      action: 'INTERVIEW_UPDATED',
      targetType: 'INTERVIEW',
      targetId: interviewId,
      details: { status, scheduledAt },
      ipAddress: getClientIp(req),
    });

    res.json({ updated: true });
  } catch (error) {
    console.error('Update interview error:', error);
    res.status(500).json({ error: 'Failed to update interview.' });
  }
});

// ---------------- OFFERS ----------------
router.get('/offers', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const authUser = req.authUser!;
    const rows = await db
      .select({
        id: offers.id,
        candidateId: offers.candidateId,
        candidateName: candidates.fullName,
        candidateCode: candidates.candidateCode,
        assignedRecruiterId: candidates.assignedRecruiterId,
        jobTitle: jobs.title,
        offeredCtc: offers.offeredCtc,
        designation: offers.designation,
        joiningDate: offers.joiningDate,
        offerStatus: offers.offerStatus,
        releasedAt: offers.releasedAt,
        respondedAt: offers.respondedAt,
        remarks: offers.remarks,
      })
      .from(offers)
      .innerJoin(candidates, eq(offers.candidateId, candidates.id))
      .leftJoin(jobs, eq(offers.jobId, jobs.id))
      .orderBy(desc(offers.releasedAt));

    const filtered =
      authUser.roleName === 'RECRUITER'
        ? rows.filter((r) => authUser.recruiterId && r.assignedRecruiterId === authUser.recruiterId)
        : rows;

    res.json({ offers: filtered });
  } catch (error) {
    console.error('List offers error:', error);
    res.status(500).json({ error: 'Failed to load offers.' });
  }
});

router.post('/offers', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const schema = z.object({
      candidateId: z.coerce.number().int(),
      offeredCtc: z.string().min(2).max(80),
      designation: z.string().min(2).max(120),
      joiningDate: z.string().min(4).max(30),
      remarks: z.string().max(500).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Provide CTC, designation, and joining date.' });

    const { cand, allowed } = await ensureCandidateAccess(req.authUser!, parsed.data.candidateId);
    if (!cand) return res.status(404).json({ error: 'Candidate not found.' });
    if (!allowed) return res.status(403).json({ error: 'Access denied.' });

    const [created] = await db
      .insert(offers)
      .values({
        candidateId: cand.id,
        jobId: cand.jobId,
        offeredCtc: sanitizeText(parsed.data.offeredCtc),
        designation: sanitizeText(parsed.data.designation),
        joiningDate: parsed.data.joiningDate,
        offerStatus: 'RELEASED',
        remarks: parsed.data.remarks ? sanitizeText(parsed.data.remarks) : null,
        createdBy: req.authUser!.id,
      })
      .returning();

    await db
      .update(candidates)
      .set({
        currentStatus: 'OFFER_RELEASED',
        joiningDate: parsed.data.joiningDate,
        updatedAt: new Date(),
      })
      .where(eq(candidates.id, cand.id));

    await db.insert(recruitmentStatusHistory).values({
      candidateId: cand.id,
      fromStatus: cand.currentStatus,
      toStatus: 'OFFER_RELEASED',
      remarks: `Offer released: ${parsed.data.designation} (${parsed.data.offeredCtc})`,
      changedBy: req.authUser!.id,
    });

    res.status(201).json({ offer: created });
  } catch (error) {
    console.error('Release offer error:', error);
    res.status(500).json({ error: 'Failed to release offer.' });
  }
});

router.patch('/offers/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const offerId = Number(req.params.id);
    const [offerRow] = await db.select().from(offers).where(eq(offers.id, offerId));
    if (!offerRow) return res.status(404).json({ error: 'Offer not found.' });

    const { cand, allowed } = await ensureCandidateAccess(req.authUser!, offerRow.candidateId);
    if (!cand || !allowed) return res.status(403).json({ error: 'Access denied.' });

    const { offerStatus } = req.body as { offerStatus?: string };
    if (!['ACCEPTED', 'DECLINED', 'EXPIRED'].includes(String(offerStatus))) {
      return res.status(400).json({ error: 'Invalid offer status update.' });
    }

    await db
      .update(offers)
      .set({ offerStatus: offerStatus!, respondedAt: new Date() })
      .where(eq(offers.id, offerId));

    const candStatus = offerStatus === 'ACCEPTED' ? 'OFFER_ACCEPTED' : 'CANDIDATE_WITHDRAWN';
    await db
      .update(candidates)
      .set({ currentStatus: candStatus, updatedAt: new Date() })
      .where(eq(candidates.id, cand.id));

    await db.insert(recruitmentStatusHistory).values({
      candidateId: cand.id,
      fromStatus: cand.currentStatus,
      toStatus: candStatus,
      remarks: `Offer marked ${offerStatus}`,
      changedBy: req.authUser!.id,
    });

    if (offerStatus === 'ACCEPTED') {
      await notifyRoles(['ADMIN', 'SUPER_ADMIN'], {
        title: 'Offer Accepted',
        message: `${cand.fullName} accepted the offer for ${offerRow.designation}.`,
        eventType: 'OFFER_ACCEPTED',
        entityType: 'OFFER',
        entityId: offerRow.id,
      });
    }

    res.json({ updated: true });
  } catch (error) {
    console.error('Update offer error:', error);
    res.status(500).json({ error: 'Failed to update offer status.' });
  }
});

export default router;
