import React, { useCallback, useEffect, useState } from 'react';
import { Briefcase, MapPin, Pencil, Plus, Search, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/api';
import { Modal } from '../components/Modal';
import { StatusText } from '../components/StatusText';
import { TableSkeleton } from '../components/Skeletons';

export function JobsPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const canManage = user?.roleName === 'SUPER_ADMIN' || user?.roleName === 'ADMIN';

  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<any[]>([]);
  const [recruiters, setRecruiters] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    title: '',
    department: 'Engineering',
    clientCompany: '9HR India Private Limited',
    location: 'Bengaluru, Karnataka',
    employmentType: 'Full-Time',
    experienceMin: 2,
    experienceMax: 6,
    salaryRange: '₹12 LPA – ₹18 LPA',
    vacancies: 2,
    requiredSkills: '',
    description: '',
    closingDate: '2027-01-31',
    recruiterIds: [] as number[],
  });

  // Edit Job Modal
  const [editJob, setEditJob] = useState<any>(null);
  const [editForm, setEditForm] = useState({
    title: '',
    department: '',
    clientCompany: '',
    location: '',
    employmentType: 'Full-Time',
    salaryRange: '',
    vacancies: 1,
    requiredSkills: '',
    description: '',
    closingDate: '',
    status: 'OPEN',
    recruiterIds: [] as number[],
  });

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const [jobsRes, recRes] = await Promise.all([apiFetch('/api/jobs'), apiFetch('/api/recruiters')]);
      setJobs(jobsRes.jobs || []);
      setRecruiters(recRes.recruiters || []);
    } catch (err: any) {
      showToast('Failed to load jobs', 'error', err.message);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/jobs', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      showToast('Job Opening Created', 'success');
      setCreateOpen(false);
      setForm({
        title: '', department: 'Engineering', clientCompany: '9HR India Private Limited',
        location: 'Bengaluru, Karnataka', employmentType: 'Full-Time', experienceMin: 2,
        experienceMax: 6, salaryRange: '₹12 LPA – ₹18 LPA', vacancies: 2, requiredSkills: '',
        description: '', closingDate: '2027-01-31', recruiterIds: [],
      });
      loadJobs();
    } catch (err: any) {
      showToast('Create Job Failed', 'error', err.message);
    }
  };

  const openEditModal = (job: any) => {
    setEditJob(job);
    setEditForm({
      title: job.title || '',
      department: job.department || '',
      clientCompany: job.clientCompany || '',
      location: job.location || '',
      employmentType: job.employmentType || 'Full-Time',
      salaryRange: job.salaryRange || '',
      vacancies: job.vacancies || 1,
      requiredSkills: job.requiredSkills || '',
      description: job.description || '',
      closingDate: job.closingDate || '',
      status: job.status || 'OPEN',
      recruiterIds: (job.assignedRecruiters || []).map((r: any) => r.recruiterId),
    });
  };

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editJob) return;
    try {
      await apiFetch(`/api/jobs/${editJob.id}`, {
        method: 'PATCH',
        body: JSON.stringify(editForm),
      });
      showToast('Job Mandate Updated', 'success');
      setEditJob(null);
      loadJobs();
    } catch (err: any) {
      showToast('Update Failed', 'error', err.message);
    }
  };

  const handleStatusChange = async (jobId: number, status: string) => {
    try {
      await apiFetch(`/api/jobs/${jobId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      showToast('Job Status Updated', 'success');
      loadJobs();
    } catch (err: any) {
      showToast('Update Failed', 'error', err.message);
    }
  };

  const toggleRecruiter = (id: number) => {
    setForm((prev) => ({
      ...prev,
      recruiterIds: prev.recruiterIds.includes(id)
        ? prev.recruiterIds.filter((r) => r !== id)
        : [...prev.recruiterIds, id],
    }));
  };

  const toggleEditRecruiter = (id: number) => {
    setEditForm((prev) => ({
      ...prev,
      recruiterIds: prev.recruiterIds.includes(id)
        ? prev.recruiterIds.filter((r) => r !== id)
        : [...prev.recruiterIds, id],
    }));
  };

  const filteredJobs = jobs.filter((job) => {
    if (statusFilter && job.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        job.title.toLowerCase().includes(q) ||
        job.jobCode.toLowerCase().includes(q) ||
        job.clientCompany.toLowerCase().includes(q) ||
        job.requiredSkills.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Job Openings &amp; Client Mandates
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {filteredJobs.length} of {jobs.length} requisitions · {jobs.filter((j) => j.status === 'OPEN').length} open mandates
          </p>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#0863E8] hover:bg-[#0652c2] text-white text-xs font-semibold whitespace-nowrap"
          >
            <Plus className="w-4 h-4" /> Create Job Opening
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Job ID, role title, client company, or skill..."
            className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] pl-9 pr-3 py-2 text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] px-3 py-2 text-sm"
        >
          <option value="">All Job Statuses</option>
          <option value="OPEN">OPEN</option>
          <option value="PAUSED">PAUSED</option>
          <option value="FILLED">FILLED</option>
          <option value="CLOSED">CLOSED</option>
        </select>
      </div>

      {loading ? (
        <TableSkeleton rows={4} cols={5} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredJobs.map((job) => (
            <div
              key={job.id}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-5 space-y-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-xs text-[#0863E8] font-semibold">
                    {job.jobCode} · {job.clientCompany}
                  </p>
                  <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                    {job.title}
                  </h2>
                </div>
                <StatusText status={job.status} />
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {job.description}
              </p>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                Skills: <span className="text-slate-700 dark:text-slate-200 font-medium">{job.requiredSkills}</span>
              </p>

              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-3">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" /> {job.location}
                </span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <Briefcase className="w-3.5 h-3.5" /> {job.employmentType} ({job.experienceMin}–{job.experienceMax} yrs)
                </span>
                <span>·</span>
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{job.salaryRange}</span>
              </div>

              {job.assignedRecruiters?.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Users className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Recruiters: {job.assignedRecruiters.map((r: any) => r.recruiterName).join(' · ')}
                  </span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
                <span className="text-slate-500 tabular-nums">
                  Vacancies: <strong className="font-mono text-slate-900 dark:text-white">{job.vacancies}</strong> · Applicants:{' '}
                  <strong className="font-mono text-[#0863E8]">{job.applicantCount}</strong> · Closes {job.closingDate}
                </span>

                {canManage && (
                  <div className="inline-flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEditModal(job)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                    <select
                      value={job.status}
                      onChange={(e) => handleStatusChange(job.id, e.target.value)}
                      aria-label={`Change status for ${job.title}`}
                      className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                    >
                      <option value="OPEN">OPEN</option>
                      <option value="PAUSED">PAUSED</option>
                      <option value="FILLED">FILLED</option>
                      <option value="CLOSED">CLOSED</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
          ))}
          {filteredJobs.length === 0 && (
            <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-10 text-center text-sm text-slate-500">
              No job openings match your search criteria.
            </div>
          )}
        </div>
      )}

      {/* Create Job Modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Job Opening" subtitle="Assign client mandate, vacancies, and recruiters">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Job Title *</label>
              <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Client / Company Name *</label>
              <input required value={form.clientCompany} onChange={(e) => setForm({ ...form, clientCompany: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Department</label>
              <input required value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Location</label>
              <input required value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Employment Type</label>
              <select value={form.employmentType} onChange={(e) => setForm({ ...form, employmentType: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
                <option>Full-Time</option>
                <option>Hybrid</option>
                <option>Contract</option>
                <option>Remote</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Salary Range *</label>
              <input required value={form.salaryRange} onChange={(e) => setForm({ ...form, salaryRange: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Vacancies</label>
              <input type="number" min={1} required value={form.vacancies} onChange={(e) => setForm({ ...form, vacancies: Number(e.target.value) })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Closing Date</label>
              <input type="date" required value={form.closingDate} onChange={(e) => setForm({ ...form, closingDate: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Required Skills *</label>
            <input required value={form.requiredSkills} onChange={(e) => setForm({ ...form, requiredSkills: e.target.value })} placeholder="React, TypeScript, PostgreSQL" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Job Description *</label>
            <textarea required rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
          </div>

          {recruiters.length > 0 && (
            <div>
              <label className="block text-xs font-medium mb-1.5">Assign Recruiters</label>
              <div className="flex flex-wrap gap-2">
                {recruiters.map((r) => (
                  <label key={r.id} className="inline-flex items-center gap-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 cursor-pointer">
                    <input type="checkbox" checked={form.recruiterIds.includes(r.id)} onChange={() => toggleRecruiter(r.id)} />
                    {r.fullName}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCreateOpen(false)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-[#0863E8] text-white text-xs font-semibold">Publish Job Opening</button>
          </div>
        </form>
      </Modal>

      {/* Edit Job Mandate Modal */}
      <Modal
        open={Boolean(editJob)}
        onClose={() => setEditJob(null)}
        title="Edit Job Opening"
        subtitle={editJob ? `${editJob.jobCode} · ${editJob.clientCompany}` : ''}
      >
        <form onSubmit={handleEditSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Job Title *</label>
              <input required value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Location *</label>
              <input required value={editForm.location} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Salary Range *</label>
              <input required value={editForm.salaryRange} onChange={(e) => setEditForm({ ...editForm, salaryRange: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Vacancies *</label>
              <input type="number" min={1} required value={editForm.vacancies} onChange={(e) => setEditForm({ ...editForm, vacancies: Number(e.target.value) })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Closing Date *</label>
              <input type="date" required value={editForm.closingDate} onChange={(e) => setEditForm({ ...editForm, closingDate: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Status</label>
              <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
                <option value="OPEN">OPEN</option>
                <option value="PAUSED">PAUSED</option>
                <option value="FILLED">FILLED</option>
                <option value="CLOSED">CLOSED</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Required Skills *</label>
            <input required value={editForm.requiredSkills} onChange={(e) => setEditForm({ ...editForm, requiredSkills: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Job Description *</label>
            <textarea required rows={3} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
          </div>

          {recruiters.length > 0 && (
            <div>
              <label className="block text-xs font-medium mb-1.5">Assigned Recruiters</label>
              <div className="flex flex-wrap gap-2">
                {recruiters.map((r) => (
                  <label key={r.id} className="inline-flex items-center gap-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 cursor-pointer">
                    <input type="checkbox" checked={editForm.recruiterIds.includes(r.id)} onChange={() => toggleEditRecruiter(r.id)} />
                    {r.fullName}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditJob(null)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-[#0863E8] text-white text-xs font-semibold">Save Mandate Changes</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
