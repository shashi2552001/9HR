import { Router } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  auditLogs,
  candidateDocuments,
  candidates,
  documentCategories,
  interviews,
  jobs,
  notifications,
  offers,
  onboardingLinks,
  recruiters,
  recruitmentStatusHistory,
  users,
} from '../../db/schema.ts';
import { type AuthenticatedRequest, getClientIp, requireAuth } from '../middleware.ts';
import { recordAuditLog } from '../audit.ts';

const router = Router();

// ---------------- NOTIFICATIONS ----------------
router.get('/notifications', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, req.authUser!.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50);

    res.json({
      notifications: rows,
      unreadCount: rows.filter((n) => !n.isRead).length,
    });
  } catch (error) {
    console.error('Notifications fetch error:', error);
    res.status(500).json({ error: 'Failed to load notifications.' });
  }
});

router.post('/notifications/:id/read', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const id = Number(req.params.id);
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, id), eq(notifications.userId, req.authUser!.id)));
    res.json({ updated: true });
  } catch (error) {
    console.error('Read notification error:', error);
    res.status(500).json({ error: 'Failed to mark notification read.' });
  }
});

router.post('/notifications/read-all', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.userId, req.authUser!.id));
    res.json({ updated: true });
  } catch (error) {
    console.error('Read all notifications error:', error);
    res.status(500).json({ error: 'Failed to mark notifications read.' });
  }
});

// ---------------- REAL-TIME DASHBOARD ANALYTICS ----------------
router.get('/analytics/dashboard', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const authUser = req.authUser!;
    const fromDateStr = String(req.query.fromDate || '').trim();
    const toDateStr = String(req.query.toDate || '').trim();
    const fromDate = fromDateStr ? new Date(fromDateStr) : null;
    const toDate = toDateStr ? new Date(`${toDateStr}T23:59:59`) : null;

    const allCandidates = await db.select().from(candidates);
    const scopedCandidates = allCandidates.filter((c) => {
      if (authUser.roleName === 'RECRUITER') {
        if (!authUser.recruiterId || c.assignedRecruiterId !== authUser.recruiterId) return false;
      }
      if (fromDate && c.createdAt < fromDate) return false;
      if (toDate && c.createdAt > toDate) return false;
      return true;
    });

    const allJobs = await db.select().from(jobs);
    const allInterviews = await db.select().from(interviews);
    const allOffers = await db.select().from(offers);
    const allDocs = await db.select().from(candidateDocuments);
    const allLinks = await db.select().from(onboardingLinks);
    const allRecruiters = await db
      .select({
        id: recruiters.id,
        userId: users.id,
        fullName: users.fullName,
        isActive: users.isActive,
        targetMonthlyHires: recruiters.targetMonthlyHires,
      })
      .from(recruiters)
      .innerJoin(users, eq(recruiters.userId, users.id));

    const scopedCandIds = new Set(scopedCandidates.map((c) => c.id));
    const scopedInterviews = allInterviews.filter((i) => scopedCandIds.has(i.candidateId));
    const scopedOffers = allOffers.filter((o) => scopedCandIds.has(o.candidateId));
    const scopedDocs = allDocs.filter((d) => scopedCandIds.has(d.candidateId));
    const scopedLinks = allLinks.filter((l) => scopedCandIds.has(l.candidateId));

    const statusCounts: Record<string, number> = {};
    const sourceCounts: Record<string, number> = {};
    for (const c of scopedCandidates) {
      statusCounts[c.currentStatus] = (statusCounts[c.currentStatus] || 0) + 1;
      sourceCounts[c.source] = (sourceCounts[c.source] || 0) + 1;
    }

    const totalCandidates = scopedCandidates.length;
    const joinedCount = statusCounts['JOINED'] || 0;
    const selectedCount =
      (statusCounts['SELECTED'] || 0) +
      (statusCounts['OFFER_RELEASED'] || 0) +
      (statusCounts['OFFER_ACCEPTED'] || 0) +
      (statusCounts['ONBOARDING_PENDING'] || 0) +
      (statusCounts['DOCUMENTS_SUBMITTED'] || 0) +
      (statusCounts['DOCUMENTS_VERIFIED'] || 0) +
      joinedCount;

    const metrics = {
      totalCandidates,
      screened: (statusCounts['SCREENING'] || 0) + (statusCounts['SHORTLISTED'] || 0),
      shortlisted: statusCounts['SHORTLISTED'] || 0,
      interviewsScheduled: scopedInterviews.filter((i) => i.status === 'SCHEDULED').length,
      selected: selectedCount,
      offersReleased: scopedOffers.filter((o) => o.offerStatus === 'RELEASED').length,
      offersAccepted: scopedOffers.filter((o) => o.offerStatus === 'ACCEPTED').length,
      joined: joinedCount,
      onboardingPending: scopedLinks.filter((l) => !l.isRevoked && l.status !== 'COMPLETED').length,
      documentsPendingVerification: scopedDocs.filter((d) => d.verificationStatus === 'PENDING').length,
      conversionRate: totalCandidates > 0 ? Number(((selectedCount / totalCandidates) * 100).toFixed(1)) : 0,
      activeJobs: allJobs.filter((j) => j.status === 'OPEN').length,
      totalRecruiters: allRecruiters.length,
      activeRecruiters: allRecruiters.filter((r) => r.isActive).length,
      inactiveRecruiters: allRecruiters.filter((r) => !r.isActive).length,
    };

    // Pipeline distribution chart
    const pipelineChart = Object.entries(statusCounts).map(([stage, count]) => ({
      stage: stage.replace(/_/g, ' '),
      code: stage,
      count,
    }));

    // Source analysis chart
    const sourceChart = Object.entries(sourceCounts).map(([source, count]) => ({
      source,
      count,
    }));

    // Recruiter productivity chart
    const recruiterPerformance = allRecruiters
      .filter((r) => authUser.roleName !== 'RECRUITER' || r.id === authUser.recruiterId)
      .map((r) => {
        const cands = allCandidates.filter((c) => c.assignedRecruiterId === r.id);
        const hires = cands.filter((c) => c.currentStatus === 'JOINED').length;
        const activePipeline = cands.filter((c) => !['JOINED', 'REJECTED', 'CANDIDATE_WITHDRAWN'].includes(c.currentStatus)).length;
        return {
          name: r.fullName.split(' (')[0],
          candidates: cands.length,
          hires,
          activePipeline,
          target: r.targetMonthlyHires,
        };
      });

    // Job-wise progress chart
    const jobProgress = allJobs.slice(0, 8).map((j) => {
      const jobCands = scopedCandidates.filter((c) => c.jobId === j.id);
      return {
        jobCode: j.jobCode,
        title: j.title.length > 24 ? `${j.title.slice(0, 22)}...` : j.title,
        vacancies: j.vacancies,
        applicants: jobCands.length,
        joined: jobCands.filter((c) => c.currentStatus === 'JOINED').length,
      };
    });

    // Daily / Monthly activity trend from real candidate creation & status timestamps
    const dayBuckets = new Map<string, { date: string; added: number; interviews: number; joined: number }>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400 * 1000);
      const iso = d.toISOString().slice(0, 10);
      dayBuckets.set(iso, { date: iso.slice(5), added: 0, interviews: 0, joined: 0 });
    }
    for (const c of scopedCandidates) {
      const key = c.createdAt.toISOString().slice(0, 10);
      if (dayBuckets.has(key)) {
        dayBuckets.get(key)!.added += 1;
        if (c.currentStatus === 'JOINED') dayBuckets.get(key)!.joined += 1;
      }
    }
    for (const iv of scopedInterviews) {
      const key = iv.createdAt.toISOString().slice(0, 10);
      if (dayBuckets.has(key)) dayBuckets.get(key)!.interviews += 1;
    }

    res.json({
      metrics,
      charts: {
        pipelineChart,
        sourceChart,
        recruiterPerformance,
        jobProgress,
        activitySeries: Array.from(dayBuckets.values()),
      },
    });
  } catch (error) {
    console.error('Dashboard analytics error:', error);
    res.status(500).json({ error: 'Failed to compute analytics metrics.' });
  }
});

// ---------------- 12 ENTERPRISE REPORTS ----------------
router.get('/reports/:reportType', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const authUser = req.authUser!;
    const reportType = req.params.reportType;
    const isAdminOrSuper = authUser.roleName === 'SUPER_ADMIN' || authUser.roleName === 'ADMIN';

    if (reportType === 'audit-trail' && authUser.roleName !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Audit Trail Report is restricted to Super Admin.' });
    }
    if (
      ['recruiter-activity', 'document-verification', 'pending-documents'].includes(reportType) &&
      !isAdminOrSuper &&
      !authUser.canExportSensitive
    ) {
      // Recruiters can still view personal scoped candidate/onboarding reports
      if (reportType === 'recruiter-activity') {
        return res.status(403).json({ error: 'Recruiter Activity Report requires Admin or Super Admin access.' });
      }
    }

    const allCandidates = await db
      .select({
        id: candidates.id,
        candidateCode: candidates.candidateCode,
        fullName: candidates.fullName,
        email: candidates.email,
        mobile: candidates.mobile,
        skills: candidates.skills,
        totalExperienceYears: candidates.totalExperienceYears,
        currentCompany: candidates.currentCompany,
        expectedSalary: candidates.expectedSalary,
        source: candidates.source,
        currentStatus: candidates.currentStatus,
        assignedRecruiterId: candidates.assignedRecruiterId,
        joiningDate: candidates.joiningDate,
        createdAt: candidates.createdAt,
        jobTitle: jobs.title,
      })
      .from(candidates)
      .leftJoin(jobs, eq(candidates.jobId, jobs.id))
      .orderBy(desc(candidates.createdAt));

    const scopedCands =
      authUser.roleName === 'RECRUITER'
        ? allCandidates.filter((c) => authUser.recruiterId && c.assignedRecruiterId === authUser.recruiterId)
        : allCandidates;
    const scopedCandIds = new Set(scopedCands.map((c) => c.id));

    let title = 'Report';
    let columns: string[] = [];
    let rows: Record<string, string | number>[] = [];

    switch (reportType) {
      case 'candidate-master': {
        title = 'Candidate Master Report';
        columns = ['Candidate ID', 'Full Name', 'Email', 'Mobile', 'Job Applied', 'Experience (Yrs)', 'Source', 'Status'];
        rows = scopedCands.map((c) => ({
          'Candidate ID': c.candidateCode,
          'Full Name': c.fullName,
          Email: c.email,
          Mobile: authUser.canExportSensitive || isAdminOrSuper ? c.mobile : 'Protected',
          'Job Applied': c.jobTitle || 'Unassigned',
          'Experience (Yrs)': c.totalExperienceYears,
          Source: c.source,
          Status: c.currentStatus,
        }));
        break;
      }
      case 'recruiter-performance': {
        title = 'Recruiter Performance Report';
        const recs = await db
          .select({
            id: recruiters.id,
            employeeCode: recruiters.employeeCode,
            fullName: users.fullName,
            department: recruiters.department,
            target: recruiters.targetMonthlyHires,
          })
          .from(recruiters)
          .innerJoin(users, eq(recruiters.userId, users.id));
        const filteredRecs =
          authUser.roleName === 'RECRUITER' ? recs.filter((r) => r.id === authUser.recruiterId) : recs;
        columns = ['Employee Code', 'Recruiter', 'Department', 'Total Assigned', 'Selected', 'Joined', 'Monthly Target'];
        rows = filteredRecs.map((r) => {
          const mine = allCandidates.filter((c) => c.assignedRecruiterId === r.id);
          return {
            'Employee Code': r.employeeCode,
            Recruiter: r.fullName,
            Department: r.department,
            'Total Assigned': mine.length,
            Selected: mine.filter((c) => ['SELECTED', 'OFFER_RELEASED', 'OFFER_ACCEPTED', 'JOINED'].includes(c.currentStatus)).length,
            Joined: mine.filter((c) => c.currentStatus === 'JOINED').length,
            'Monthly Target': r.target,
          };
        });
        break;
      }
      case 'job-opening': {
        title = 'Job Opening Report';
        const jobRows = await db.select().from(jobs).orderBy(desc(jobs.createdAt));
        columns = ['Job Code', 'Title', 'Client', 'Department', 'Location', 'Vacancies', 'Salary Range', 'Status'];
        rows = jobRows.map((j) => ({
          'Job Code': j.jobCode,
          Title: j.title,
          Client: j.clientCompany,
          Department: j.department,
          Location: j.location,
          Vacancies: j.vacancies,
          'Salary Range': j.salaryRange,
          Status: j.status,
        }));
        break;
      }
      case 'interview': {
        title = 'Interview Report';
        const ivRows = await db
          .select({
            candidateCode: candidates.candidateCode,
            candidateName: candidates.fullName,
            candidateId: interviews.candidateId,
            roundName: interviews.roundName,
            scheduledAt: interviews.scheduledAt,
            mode: interviews.mode,
            interviewerName: interviews.interviewerName,
            status: interviews.status,
          })
          .from(interviews)
          .innerJoin(candidates, eq(interviews.candidateId, candidates.id))
          .orderBy(desc(interviews.scheduledAt));
        columns = ['Candidate ID', 'Candidate', 'Round', 'Scheduled Date', 'Mode', 'Interviewer', 'Status'];
        rows = ivRows
          .filter((r) => scopedCandIds.has(r.candidateId))
          .map((r) => ({
            'Candidate ID': r.candidateCode,
            Candidate: r.candidateName,
            Round: r.roundName,
            'Scheduled Date': r.scheduledAt.toISOString().slice(0, 16).replace('T', ' '),
            Mode: r.mode,
            Interviewer: r.interviewerName,
            Status: r.status,
          }));
        break;
      }
      case 'selection': {
        title = 'Selection Report';
        const sel = scopedCands.filter((c) =>
          ['SELECTED', 'OFFER_RELEASED', 'OFFER_ACCEPTED', 'ONBOARDING_PENDING', 'DOCUMENTS_SUBMITTED', 'DOCUMENTS_VERIFIED', 'JOINED'].includes(c.currentStatus),
        );
        columns = ['Candidate ID', 'Candidate', 'Job Applied', 'Expected CTC', 'Current Stage', 'Joining Date'];
        rows = sel.map((c) => ({
          'Candidate ID': c.candidateCode,
          Candidate: c.fullName,
          'Job Applied': c.jobTitle || 'N/A',
          'Expected CTC': c.expectedSalary || 'N/A',
          'Current Stage': c.currentStatus,
          'Joining Date': c.joiningDate || 'TBD',
        }));
        break;
      }
      case 'offer-management': {
        title = 'Offer Management Report';
        const offerRows = await db
          .select({
            candidateId: offers.candidateId,
            candidateCode: candidates.candidateCode,
            candidateName: candidates.fullName,
            designation: offers.designation,
            offeredCtc: offers.offeredCtc,
            joiningDate: offers.joiningDate,
            offerStatus: offers.offerStatus,
          })
          .from(offers)
          .innerJoin(candidates, eq(offers.candidateId, candidates.id));
        columns = ['Candidate ID', 'Candidate', 'Designation', 'Offered CTC', 'Joining Date', 'Offer Status'];
        rows = offerRows
          .filter((o) => scopedCandIds.has(o.candidateId))
          .map((o) => ({
            'Candidate ID': o.candidateCode,
            Candidate: o.candidateName,
            Designation: o.designation,
            'Offered CTC': o.offeredCtc,
            'Joining Date': o.joiningDate,
            'Offer Status': o.offerStatus,
          }));
        break;
      }
      case 'joining': {
        title = 'Joining Report';
        const joined = scopedCands.filter((c) => c.currentStatus === 'JOINED' || Boolean(c.joiningDate));
        columns = ['Candidate ID', 'Candidate', 'Job Title', 'Joining Date', 'Status'];
        rows = joined.map((c) => ({
          'Candidate ID': c.candidateCode,
          Candidate: c.fullName,
          'Job Title': c.jobTitle || 'N/A',
          'Joining Date': c.joiningDate || 'Scheduled',
          Status: c.currentStatus,
        }));
        break;
      }
      case 'onboarding-status': {
        title = 'Onboarding Status Report';
        const links = await db
          .select({
            candidateId: onboardingLinks.candidateId,
            candidateCode: candidates.candidateCode,
            candidateName: candidates.fullName,
            status: onboardingLinks.status,
            sharedChannel: onboardingLinks.sharedChannel,
            openedAt: onboardingLinks.openedAt,
            submittedAt: onboardingLinks.submittedAt,
            expiresAt: onboardingLinks.expiresAt,
          })
          .from(onboardingLinks)
          .innerJoin(candidates, eq(onboardingLinks.candidateId, candidates.id));
        columns = ['Candidate ID', 'Candidate', 'Link Status', 'Channel', 'Opened', 'Submitted', 'Expires'];
        rows = links
          .filter((l) => scopedCandIds.has(l.candidateId))
          .map((l) => ({
            'Candidate ID': l.candidateCode,
            Candidate: l.candidateName,
            'Link Status': l.status,
            Channel: l.sharedChannel || 'Pending Share',
            Opened: l.openedAt ? l.openedAt.toISOString().slice(0, 10) : 'No',
            Submitted: l.submittedAt ? l.submittedAt.toISOString().slice(0, 10) : 'No',
            Expires: l.expiresAt.toISOString().slice(0, 10),
          }));
        break;
      }
      case 'document-verification': {
        title = 'Document Verification Report';
        const docs = await db
          .select({
            candidateId: candidateDocuments.candidateId,
            candidateCode: candidates.candidateCode,
            candidateName: candidates.fullName,
            documentName: candidateDocuments.documentName,
            version: candidateDocuments.version,
            verificationStatus: candidateDocuments.verificationStatus,
            uploadedAt: candidateDocuments.uploadedAt,
          })
          .from(candidateDocuments)
          .innerJoin(candidates, eq(candidateDocuments.candidateId, candidates.id));
        columns = ['Candidate ID', 'Candidate', 'Document', 'Version', 'Verification Status', 'Uploaded At'];
        rows = docs
          .filter((d) => scopedCandIds.has(d.candidateId))
          .map((d) => ({
            'Candidate ID': d.candidateCode,
            Candidate: d.candidateName,
            Document: d.documentName,
            Version: `v${d.version}`,
            'Verification Status': d.verificationStatus,
            'Uploaded At': d.uploadedAt.toISOString().slice(0, 10),
          }));
        break;
      }
      case 'pending-documents': {
        title = 'Pending Documents Report';
        const reqCats = await db
          .select()
          .from(documentCategories)
          .where(and(eq(documentCategories.isEnabled, true), eq(documentCategories.isRequired, true)));
        const allDocs = await db.select().from(candidateDocuments);
        const onboardingCands = scopedCands.filter((c) =>
          ['ONBOARDING_PENDING', 'DOCUMENTS_SUBMITTED'].includes(c.currentStatus),
        );
        columns = ['Candidate ID', 'Candidate', 'Missing Mandatory Documents', 'Current Status'];
        rows = onboardingCands.map((c) => {
          const uploadedCatIds = new Set(allDocs.filter((d) => d.candidateId === c.id).map((d) => d.categoryId));
          const missing = reqCats.filter((cat) => !uploadedCatIds.has(cat.id)).map((cat) => cat.name);
          return {
            'Candidate ID': c.candidateCode,
            Candidate: c.fullName,
            'Missing Mandatory Documents': missing.length ? missing.join('; ') : 'None (All Uploaded)',
            'Current Status': c.currentStatus,
          };
        });
        break;
      }
      case 'recruiter-activity': {
        title = 'Recruiter Activity Report';
        const hist = await db
          .select({
            candidateCode: candidates.candidateCode,
            candidateName: candidates.fullName,
            fromStatus: recruitmentStatusHistory.fromStatus,
            toStatus: recruitmentStatusHistory.toStatus,
            actorName: users.fullName,
            changedAt: recruitmentStatusHistory.changedAt,
          })
          .from(recruitmentStatusHistory)
          .innerJoin(candidates, eq(recruitmentStatusHistory.candidateId, candidates.id))
          .leftJoin(users, eq(recruitmentStatusHistory.changedBy, users.id))
          .orderBy(desc(recruitmentStatusHistory.changedAt))
          .limit(200);
        columns = ['Timestamp', 'Actor', 'Candidate ID', 'Candidate', 'From Stage', 'To Stage'];
        rows = hist.map((h) => ({
          Timestamp: h.changedAt.toISOString().slice(0, 16).replace('T', ' '),
          Actor: h.actorName || 'System',
          'Candidate ID': h.candidateCode,
          Candidate: h.candidateName,
          'From Stage': h.fromStatus || 'Initial',
          'To Stage': h.toStatus,
        }));
        break;
      }
      case 'audit-trail': {
        title = 'Enterprise Audit Trail Report';
        const logs = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(250);
        columns = ['Timestamp', 'Actor Email', 'Role', 'Action', 'Target Type', 'Target ID', 'IP Address'];
        rows = logs.map((l) => ({
          Timestamp: l.createdAt.toISOString().slice(0, 19).replace('T', ' '),
          'Actor Email': l.actorEmail,
          Role: l.actorRole,
          Action: l.action,
          'Target Type': l.targetType,
          'Target ID': l.targetId || '-',
          'IP Address': l.ipAddress,
        }));
        break;
      }
      default:
        return res.status(404).json({ error: 'Unknown report type.' });
    }

    await recordAuditLog({
      actorUserId: authUser.id,
      actorEmail: authUser.email,
      actorRole: authUser.roleName,
      action: 'REPORT_GENERATED',
      targetType: 'REPORT',
      targetId: reportType,
      details: { rowCount: rows.length },
      ipAddress: getClientIp(req),
    });

    res.json({ title, columns, rows, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Report generation error:', error);
    res.status(500).json({ error: 'Failed to generate report.' });
  }
});

export default router;
