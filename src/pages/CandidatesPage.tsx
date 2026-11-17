import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  FileSpreadsheet,
  FileUp,
  Link2,
  Mail,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  UserPlus,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiFetch, ApiError } from '../lib/api';
import { downloadCandidateImportTemplate } from '../lib/exportUtils';
import { Modal } from '../components/Modal';
import { StatusText } from '../components/StatusText';
import { TableSkeleton } from '../components/Skeletons';

export function CandidatesPage() {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [stages, setStages] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [recruiters, setRecruiters] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Add Candidate Modal
  const [addOpen, setAddOpen] = useState(false);
  const [dupWarning, setDupWarning] = useState<string | null>(null);
  const [form, setForm] = useState({
    fullName: '',
    mobile: '',
    email: '',
    dob: '',
    gender: '',
    currentAddress: '',
    educationSummary: '',
    totalExperienceYears: '3',
    currentCompany: '',
    previousCompany: '',
    currentSalary: '',
    expectedSalary: '',
    noticePeriodDays: 30,
    skills: '',
    source: 'LinkedIn',
    jobId: '',
    assignedRecruiterId: '',
  });

  // Bulk Import Modal
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importJobId, setImportJobId] = useState('');
  const [importResult, setImportResult] = useState<{ imported: number; skipped: string[] } | null>(null);

  // Candidate Profile Drawer/Modal
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [nextStatus, setNextStatus] = useState('');
  const [statusRemark, setStatusRemark] = useState('');

  // Quick Sub-modals inside Profile
  const [generatedLink, setGeneratedLink] = useState<{ id: number; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [interviewForm, setInterviewForm] = useState({
    roundName: 'Technical Round 1',
    scheduledAt: '',
    mode: 'VIDEO',
    meetingLinkOrVenue: 'https://meet.9hrindia.com/room',
    interviewerName: '',
  });
  const [offerForm, setOfferForm] = useState({
    offeredCtc: '',
    designation: '',
    joiningDate: '',
  });
  const [editingProfile, setEditingProfile] = useState(false);
  const [editForm, setEditForm] = useState({
    fullName: '',
    mobile: '',
    skills: '',
    currentCompany: '',
    expectedSalary: '',
    joiningDate: '',
    jobId: '',
  });

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search) qs.set('search', search);
      if (statusFilter) qs.set('status', statusFilter);
      const [candRes, jobRes, recRes] = await Promise.all([
        apiFetch(`/api/candidates?${qs.toString()}`),
        apiFetch('/api/jobs'),
        apiFetch('/api/recruiters'),
      ]);
      setCandidates(candRes.candidates || []);
      setStages(candRes.stages || []);
      setJobs(jobRes.jobs || []);
      setRecruiters(recRes.recruiters || []);
    } catch (err: any) {
      showToast('Failed to load candidates', 'error', err.message);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, showToast]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const openProfile = async (id: number) => {
    setSelectedId(id);
    setProfileLoading(true);
    setGeneratedLink(null);
    setEditingProfile(false);
    try {
      const res = await apiFetch(`/api/candidates/${id}`);
      setProfile(res);
      setNextStatus(res.candidate.currentStatus);
      setEditForm({
        fullName: res.candidate.fullName || '',
        mobile: res.candidate.mobile || '',
        skills: res.candidate.skills || '',
        currentCompany: res.candidate.currentCompany || '',
        expectedSalary: res.candidate.expectedSalary || '',
        joiningDate: res.candidate.joiningDate || '',
        jobId: res.candidate.jobId ? String(res.candidate.jobId) : '',
      });
    } catch (err: any) {
      showToast('Unable to open profile', 'error', err.message);
      setSelectedId(null);
    } finally {
      setProfileLoading(false);
    }
  };

  const handleCreateCandidate = async (e: React.FormEvent, forceDuplicate = false) => {
    e.preventDefault();
    try {
      await apiFetch('/api/candidates', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          jobId: form.jobId ? Number(form.jobId) : undefined,
          assignedRecruiterId: form.assignedRecruiterId ? Number(form.assignedRecruiterId) : undefined,
          forceDuplicate,
        }),
      });
      showToast('Candidate Created', 'success');
      setAddOpen(false);
      setDupWarning(null);
      setForm({
        fullName: '', mobile: '', email: '', dob: '', gender: '', currentAddress: '',
        educationSummary: '', totalExperienceYears: '3', currentCompany: '', previousCompany: '',
        currentSalary: '', expectedSalary: '', noticePeriodDays: 30, skills: '',
        source: 'LinkedIn', jobId: '', assignedRecruiterId: '',
      });
      loadList();
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409) {
        setDupWarning(err.message);
      } else {
        showToast('Create Failed', 'error', err.message);
      }
    }
  };

  const handleBulkImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importFile) return;
    try {
      const fd = new FormData();
      fd.append('file', importFile);
      if (importJobId) fd.append('jobId', importJobId);
      const res = await apiFetch<{ imported: number; skipped: string[] }>('/api/candidates/import', {
        method: 'POST',
        body: fd,
        isFormData: true,
      });
      setImportResult(res);
      showToast(`Imported ${res.imported} candidate(s)`, 'success');
      loadList();
    } catch (err: any) {
      showToast('Import Failed', 'error', err.message);
    }
  };

  const handleStatusUpdate = async () => {
    if (!selectedId) return;
    try {
      await apiFetch(`/api/candidates/${selectedId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: nextStatus, remarks: statusRemark }),
      });
      setStatusRemark('');
      showToast('Pipeline Status Updated', 'success');
      openProfile(selectedId);
      loadList();
    } catch (err: any) {
      showToast('Status Update Failed', 'error', err.message);
    }
  };

  const handleReassignRecruiter = async (recId: string) => {
    if (!selectedId || !recId) return;
    try {
      await apiFetch(`/api/candidates/${selectedId}`, {
        method: 'PATCH',
        body: JSON.stringify({ assignedRecruiterId: Number(recId) }),
      });
      showToast('Candidate Reassigned', 'success');
      openProfile(selectedId);
      loadList();
    } catch (err: any) {
      showToast('Reassignment Failed', 'error', err.message);
    }
  };

  const handleResumeUpload = async (file: File) => {
    if (!selectedId) return;
    try {
      const fd = new FormData();
      fd.append('file', file);
      await apiFetch(`/api/candidates/${selectedId}/resume`, {
        method: 'POST',
        body: fd,
        isFormData: true,
      });
      showToast('Encrypted Resume Uploaded', 'success');
      openProfile(selectedId);
    } catch (err: any) {
      showToast('Resume Upload Error', 'error', err.message);
    }
  };

  const handlePreviewDoc = async (docId: number) => {
    try {
      const { url } = await apiFetch<{ url: string }>(`/api/documents/${docId}/download-token`, {
        method: 'POST',
      });
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      showToast('Preview Denied', 'error', err.message);
    }
  };

  const handleGenerateOnboardingLink = async () => {
    if (!selectedId) return;
    try {
      const res = await apiFetch<{ link: any; rawToken: string; onboardingPath: string }>(
        '/api/onboarding/links',
        {
          method: 'POST',
          body: JSON.stringify({ candidateId: selectedId }),
        },
      );
      const fullUrl = `${window.location.origin}${res.onboardingPath}`;
      setGeneratedLink({ id: res.link.id, url: fullUrl });
      showToast('Secure Onboarding Link Generated', 'success');
      openProfile(selectedId);
    } catch (err: any) {
      showToast('Link Generation Error', 'error', err.message);
    }
  };

  const handleShareLink = async (channel: 'WHATSAPP' | 'EMAIL' | 'COPY') => {
    if (!generatedLink || !profile) return;
    await apiFetch(`/api/onboarding/links/${generatedLink.id}/share`, {
      method: 'POST',
      body: JSON.stringify({ channel, onboardingUrl: generatedLink.url }),
    });
    if (channel === 'COPY') {
      await navigator.clipboard.writeText(generatedLink.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      showToast('Onboarding Link Copied', 'success');
    } else if (channel === 'WHATSAPP') {
      const msg = encodeURIComponent(
        `Hello ${profile.candidate.fullName}, welcome to 9HR India Private Limited! Please complete your secure candidate onboarding here: ${generatedLink.url}`,
      );
      window.open(`https://wa.me/?text=${msg}`, '_blank', 'noopener,noreferrer');
      showToast('WhatsApp Share Opened', 'info');
    } else {
      showToast('Email Dispatch Recorded', 'success', 'Sent via configured SMTP or logged locally.');
    }
  };

  const handleScheduleInterview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) return;
    try {
      await apiFetch('/api/interviews', {
        method: 'POST',
        body: JSON.stringify({ candidateId: selectedId, ...interviewForm }),
      });
      showToast('Interview Scheduled', 'success');
      openProfile(selectedId);
      loadList();
    } catch (err: any) {
      showToast('Interview Schedule Failed', 'error', err.message);
    }
  };

  const handleReleaseOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) return;
    try {
      await apiFetch('/api/offers', {
        method: 'POST',
        body: JSON.stringify({ candidateId: selectedId, ...offerForm }),
      });
      showToast('Offer Released', 'success');
      openProfile(selectedId);
      loadList();
    } catch (err: any) {
      showToast('Offer Failed', 'error', err.message);
    }
  };

  const handleSaveCandidateEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) return;
    try {
      await apiFetch(`/api/candidates/${selectedId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fullName: editForm.fullName,
          mobile: editForm.mobile,
          skills: editForm.skills,
          currentCompany: editForm.currentCompany,
          expectedSalary: editForm.expectedSalary,
          joiningDate: editForm.joiningDate,
          jobId: editForm.jobId ? Number(editForm.jobId) : undefined,
        }),
      });
      showToast('Candidate Details Updated', 'success');
      setEditingProfile(false);
      openProfile(selectedId);
      loadList();
    } catch (err: any) {
      showToast('Update Failed', 'error', err.message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            {user?.roleName === 'RECRUITER' ? 'My Assigned Candidates' : 'Candidate Database'}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {candidates.length} candidate profile(s) · Encrypted document vault &amp; 15-stage tracking
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => { setImportResult(null); setImportOpen(true); }}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#101820] text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#079B35]" /> Bulk CSV / Excel Import
          </button>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0863E8] hover:bg-[#0652c2] text-white text-xs font-semibold whitespace-nowrap"
          >
            <UserPlus className="w-4 h-4" /> Add Candidate
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Candidate ID, name, email, or skill..."
            className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] pl-9 pr-3 py-2 text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] px-3 py-2 text-sm"
        >
          <option value="">All 15 Pipeline Stages</option>
          {stages.map((s) => (
            <option key={s.code} value={s.code}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Data Table */}
      {loading ? (
        <TableSkeleton rows={6} cols={6} />
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 bg-slate-50/70 dark:bg-slate-900/40">
                <th className="text-left px-4 py-3 font-medium">Candidate ID</th>
                <th className="text-left px-4 py-3 font-medium">Candidate</th>
                <th className="text-left px-4 py-3 font-medium">Job Applied</th>
                <th className="text-left px-4 py-3 font-medium">Exp / CTC</th>
                <th className="text-left px-4 py-3 font-medium">Recruiter</th>
                <th className="text-left px-4 py-3 font-medium">Stage</th>
                <th className="text-right px-4 py-3 font-medium">Profile</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {candidates.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-[#0863E8] whitespace-nowrap">
                    {c.candidateCode}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{c.fullName}</p>
                    <p className="text-xs text-slate-500">{c.email} · {c.mobile}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs font-medium text-slate-800 dark:text-slate-200">{c.jobTitle || 'General Pool'}</p>
                    <p className="text-xs text-slate-500">{c.skills}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums whitespace-nowrap">
                    {c.totalExperienceYears} yrs · {c.expectedSalary || 'TBD'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                    {c.recruiterName || 'Unassigned'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusText status={c.currentStatus} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => openProfile(c.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Eye className="w-3.5 h-3.5" /> Open
                    </button>
                  </td>
                </tr>
              ))}
              {candidates.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">
                    No candidates match your current filters. Click &ldquo;Add Candidate&rdquo; to create a profile.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Candidate Modal */}
      <Modal open={addOpen} onClose={() => { setAddOpen(false); setDupWarning(null); }} title="Add New Candidate" subtitle="Auto-generates unique 9HR Candidate ID and checks duplicates">
        <form onSubmit={(e) => handleCreateCandidate(e, false)} className="space-y-4">
          {dupWarning && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-200 flex items-center justify-between gap-3">
              <span>{dupWarning}</span>
              <button
                type="button"
                onClick={(e) => handleCreateCandidate(e, true)}
                className="px-3 py-1 rounded bg-amber-600 text-white font-semibold shrink-0"
              >
                Create Anyway
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Full Name *</label>
              <input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Email Address *</label>
              <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Mobile Number *</label>
              <input required value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} placeholder="+91 98..." className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Key Skills *</label>
              <input required value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} placeholder="React, TypeScript, SQL" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Job Opening</label>
              <select value={form.jobId} onChange={(e) => setForm({ ...form, jobId: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
                <option value="">Select Job Opening</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.jobCode} · {j.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Source</label>
              <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
                <option>LinkedIn</option>
                <option>Naukri</option>
                <option>Employee Referral</option>
                <option>Direct Career Portal</option>
                <option>Campus / Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Total Experience (Years)</label>
              <input value={form.totalExperienceYears} onChange={(e) => setForm({ ...form, totalExperienceYears: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Current Company</label>
              <input value={form.currentCompany} onChange={(e) => setForm({ ...form, currentCompany: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Current CTC</label>
              <input value={form.currentSalary} onChange={(e) => setForm({ ...form, currentSalary: e.target.value })} placeholder="₹15 LPA" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Expected CTC</label>
              <input value={form.expectedSalary} onChange={(e) => setForm({ ...form, expectedSalary: e.target.value })} placeholder="₹20 LPA" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Education Summary</label>
              <input value={form.educationSummary} onChange={(e) => setForm({ ...form, educationSummary: e.target.value })} placeholder="B.Tech CSE" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            {user?.roleName !== 'RECRUITER' && (
              <div>
                <label className="block text-xs font-medium mb-1">Assign Recruiter</label>
                <select value={form.assignedRecruiterId} onChange={(e) => setForm({ ...form, assignedRecruiterId: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
                  <option value="">Select Recruiter</option>
                  {recruiters.map((r) => (
                    <option key={r.id} value={r.id}>{r.fullName}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setAddOpen(false)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-[#0863E8] text-white text-xs font-semibold">Create Candidate</button>
          </div>
        </form>
      </Modal>

      {/* Bulk Import Modal */}
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Bulk CSV / Excel Candidate Import" subtitle="Supports .xlsx, .xls, and .csv spreadsheets with automatic duplicate skipping">
        <form onSubmit={handleBulkImport} className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-slate-50 dark:bg-slate-900/50">
            <span className="text-xs text-slate-600 dark:text-slate-300">Need the required column format?</span>
            <button type="button" onClick={downloadCandidateImportTemplate} className="text-xs font-semibold text-[#0863E8] hover:underline">
              Download Sample Excel Template
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Assign to Job Opening (Optional)</label>
            <select value={importJobId} onChange={(e) => setImportJobId(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
              <option value="">No specific job</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>{j.jobCode} · {j.title}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Select CSV or Excel File</label>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              required
              onChange={(e) => setImportFile(e.target.files?.[0] || null)}
              className="w-full text-xs"
            />
          </div>

          {importResult && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 text-xs space-y-1">
              <p className="font-semibold text-[#079B35]">Imported: {importResult.imported} candidate(s)</p>
              {importResult.skipped.length > 0 && (
                <p className="text-amber-600">Skipped ({importResult.skipped.length}): {importResult.skipped.join(', ')}</p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setImportOpen(false)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium">Close</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-[#0863E8] text-white text-xs font-semibold">Run Import</button>
          </div>
        </form>
      </Modal>

      {/* Full Candidate Profile Modal */}
      <Modal
        open={selectedId !== null}
        onClose={() => { setSelectedId(null); setProfile(null); }}
        title={profile ? `${profile.candidate.fullName} · ${profile.candidate.candidateCode}` : 'Loading Profile...'}
        subtitle={profile ? `${profile.candidate.email} · ${profile.candidate.mobile}` : ''}
        size="xl"
      >
        {profileLoading || !profile ? (
          <div className="py-12 text-center text-sm text-slate-500">Loading candidate dossier...</div>
        ) : (
          <div className="space-y-6">
            {/* Pipeline Transition & Recruiter Assignment */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50/60 dark:bg-slate-900/40">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
                  Update Recruitment Pipeline Status
                </label>
                <div className="flex gap-2">
                  <select
                    value={nextStatus}
                    onChange={(e) => setNextStatus(e.target.value)}
                    className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs"
                  >
                    {stages.map((s) => (
                      <option key={s.code} value={s.code}>{s.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleStatusUpdate}
                    className="px-3 py-1.5 rounded-lg bg-[#0863E8] text-white text-xs font-semibold"
                  >
                    Save
                  </button>
                </div>
                <input
                  value={statusRemark}
                  onChange={(e) => setStatusRemark(e.target.value)}
                  placeholder="Optional transition remarks..."
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Onboarding Link &amp; Resume</span>
                  <StatusText status={profile.candidate.currentStatus} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleGenerateOnboardingLink}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#079B35] hover:bg-[#067e2b] text-white text-xs font-semibold"
                  >
                    <Link2 className="w-3.5 h-3.5" /> Generate Onboarding Link
                  </button>
                  <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-white dark:hover:bg-slate-800">
                    <FileUp className="w-3.5 h-3.5" /> Upload Encrypted Resume
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleResumeUpload(f);
                      }}
                    />
                  </label>
                </div>

                {user?.roleName !== 'RECRUITER' && (
                  <select
                    value={profile.candidate.assignedRecruiterId || ''}
                    onChange={(e) => handleReassignRecruiter(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs"
                  >
                    <option value="">Assign / Reassign Recruiter...</option>
                    {recruiters.map((r) => (
                      <option key={r.id} value={r.id}>{r.fullName}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Generated Onboarding Share Box */}
            {generatedLink && (
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 p-4 space-y-2.5">
                <p className="text-xs font-semibold text-[#079B35] dark:text-emerald-400">
                  Unique Secure Candidate Onboarding Link Ready
                </p>
                <p className="font-mono text-xs break-all bg-white dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-800">
                  {generatedLink.url}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => handleShareLink('COPY')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium">
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} Copy Link
                  </button>
                  <button type="button" onClick={() => handleShareLink('WHATSAPP')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#079B35] text-white text-xs font-medium">
                    <MessageSquare className="w-3.5 h-3.5" /> Share via WhatsApp
                  </button>
                  <button type="button" onClick={() => handleShareLink('EMAIL')} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0863E8] text-white text-xs font-medium">
                    <Mail className="w-3.5 h-3.5" /> Email Candidate
                  </button>
                </div>
              </div>
            )}

            {/* Key Profile Attributes + Inline Edit */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Candidate Dossier Details</p>
                <button
                  type="button"
                  onClick={() => setEditingProfile((prev) => !prev)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Pencil className="w-3 h-3" /> {editingProfile ? 'Cancel Edit' : 'Edit Profile'}
                </button>
              </div>
              {editingProfile ? (
                <form onSubmit={handleSaveCandidateEdit} className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="block text-slate-500 mb-1">Full Name</label>
                    <input required value={editForm.fullName} onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5" />
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-1">Mobile</label>
                    <input required value={editForm.mobile} onChange={(e) => setEditForm({ ...editForm, mobile: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5" />
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-1">Key Skills</label>
                    <input required value={editForm.skills} onChange={(e) => setEditForm({ ...editForm, skills: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5" />
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-1">Current Company</label>
                    <input value={editForm.currentCompany} onChange={(e) => setEditForm({ ...editForm, currentCompany: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5" />
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-1">Expected CTC</label>
                    <input value={editForm.expectedSalary} onChange={(e) => setEditForm({ ...editForm, expectedSalary: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5" />
                  </div>
                  <div>
                    <label className="block text-slate-500 mb-1">Joining Date</label>
                    <input type="date" value={editForm.joiningDate} onChange={(e) => setEditForm({ ...editForm, joiningDate: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5" />
                  </div>
                  <div className="sm:col-span-2 flex items-end justify-between gap-3">
                    <div className="flex-1">
                      <label className="block text-slate-500 mb-1">Job Opening</label>
                      <select value={editForm.jobId} onChange={(e) => setEditForm({ ...editForm, jobId: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5">
                        <option value="">General Pool</option>
                        {jobs.map((j) => (
                          <option key={j.id} value={j.id}>{j.jobCode} · {j.title}</option>
                        ))}
                      </select>
                    </div>
                    <button type="submit" className="px-4 py-1.5 rounded-lg bg-[#0863E8] text-white font-semibold">
                      Save Changes
                    </button>
                  </div>
                </form>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                  <div><p className="text-slate-500">Experience</p><p className="font-semibold mt-0.5">{profile.candidate.totalExperienceYears} Years</p></div>
                  <div><p className="text-slate-500">Current Company</p><p className="font-semibold mt-0.5">{profile.candidate.currentCompany || '—'}</p></div>
                  <div><p className="text-slate-500">Current / Expected CTC</p><p className="font-semibold mt-0.5">{profile.candidate.currentSalary || '—'} / {profile.candidate.expectedSalary || '—'}</p></div>
                  <div><p className="text-slate-500">Notice / Joining Date</p><p className="font-semibold mt-0.5">{profile.candidate.noticePeriodDays ?? 30} Days · {profile.candidate.joiningDate || 'TBD'}</p></div>
                </div>
              )}
            </div>

            {/* Quick Interview & Offer Forms */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <form onSubmit={handleScheduleInterview} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2.5">
                <p className="text-xs font-semibold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5 text-[#0863E8]" /> Schedule Interview</p>
                <input required value={interviewForm.roundName} onChange={(e) => setInterviewForm({ ...interviewForm, roundName: e.target.value })} placeholder="Round Name" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs" />
                <div className="grid grid-cols-2 gap-2">
                  <input required type="datetime-local" value={interviewForm.scheduledAt} onChange={(e) => setInterviewForm({ ...interviewForm, scheduledAt: e.target.value })} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs" />
                  <input required value={interviewForm.interviewerName} onChange={(e) => setInterviewForm({ ...interviewForm, interviewerName: e.target.value })} placeholder="Interviewer Name" className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs" />
                </div>
                <button type="submit" className="w-full py-1.5 rounded-lg bg-slate-900 dark:bg-[#0863E8] text-white text-xs font-medium">Schedule Interview</button>
              </form>

              <form onSubmit={handleReleaseOffer} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2.5">
                <p className="text-xs font-semibold flex items-center gap-1.5"><Plus className="w-3.5 h-3.5 text-[#079B35]" /> Release Job Offer</p>
                <input required value={offerForm.designation} onChange={(e) => setOfferForm({ ...offerForm, designation: e.target.value })} placeholder="Offered Designation" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs" />
                <div className="grid grid-cols-2 gap-2">
                  <input required value={offerForm.offeredCtc} onChange={(e) => setOfferForm({ ...offerForm, offeredCtc: e.target.value })} placeholder="Offered CTC (e.g. ₹26 LPA)" className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs" />
                  <input required type="date" value={offerForm.joiningDate} onChange={(e) => setOfferForm({ ...offerForm, joiningDate: e.target.value })} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs" />
                </div>
                <button type="submit" className="w-full py-1.5 rounded-lg bg-[#079B35] text-white text-xs font-medium">Release Offer</button>
              </form>
            </div>

            {/* Uploaded Encrypted Documents */}
            <div>
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">
                Encrypted Documents ({profile.documents.length})
              </h3>
              {profile.documents.length === 0 ? (
                <p className="text-xs text-slate-500">No documents uploaded yet.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
                  {profile.documents.map((d: any) => (
                    <div key={d.id} className="p-3 flex items-center justify-between gap-3 text-xs">
                      <div>
                        <p className="font-semibold">{d.documentName} · v{d.version}</p>
                        <p className="text-slate-500">{d.originalFileName}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusText status={d.verificationStatus} />
                        <button type="button" onClick={() => handlePreviewDoc(d.id)} className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">
                          Authorized View
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Timestamped Status History */}
            <div>
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2">
                Recruitment Status Audit Timeline
              </h3>
              <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                {profile.statusHistory.map((h: any) => (
                  <div key={h.id} className="text-xs flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800/60 pb-2">
                    <div>
                      <p className="font-medium">
                        {h.fromStatus ? `${h.fromStatus.replace(/_/g, ' ')} → ` : ''}
                        <span className="text-[#0863E8] font-semibold">{h.toStatus.replace(/_/g, ' ')}</span>
                      </p>
                      {h.remarks && <p className="text-slate-500 mt-0.5">{h.remarks}</p>}
                    </div>
                    <span className="font-mono text-[11px] text-slate-400 whitespace-nowrap tabular-nums">
                      {new Date(h.changedAt).toLocaleString('en-IN')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
