import React, { useCallback, useEffect, useState } from 'react';
import { GripVertical, RefreshCw, Search } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useToast } from '../context/ToastContext';

export function PipelinePage() {
  const { showToast } = useToast();
  const [candidates, setCandidates] = useState<any[]>([]);
  const [stages, setStages] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [jobFilter, setJobFilter] = useState('');
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dropStage, setDropStage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPipeline = useCallback(async () => {
    setLoading(true);
    try {
      const [candRes, jobRes] = await Promise.all([
        apiFetch('/api/candidates'),
        apiFetch('/api/jobs'),
      ]);
      setCandidates(candRes.candidates || []);
      setStages(candRes.stages || []);
      setJobs(jobRes.jobs || []);
    } catch (err: any) {
      showToast('Failed to load pipeline', 'error', err.message);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadPipeline();
  }, [loadPipeline]);

  const moveCandidate = async (candidateId: number, status: string) => {
    const existing = candidates.find((c) => c.id === candidateId);
    if (!existing || existing.currentStatus === status) return;
    try {
      await apiFetch(`/api/candidates/${candidateId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status, remarks: 'Moved on visual recruitment pipeline board' }),
      });
      showToast('Stage Updated', 'success');
      loadPipeline();
    } catch (err: any) {
      showToast('Failed to move candidate', 'error', err.message);
    }
  };

  const filteredCandidates = candidates.filter((c) => {
    if (jobFilter && String(c.jobId || '') !== jobFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        c.fullName.toLowerCase().includes(q) ||
        c.candidateCode.toLowerCase().includes(q) ||
        (c.skills || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const activeTotal = filteredCandidates.filter((c) => !['JOINED', 'REJECTED', 'CANDIDATE_WITHDRAWN'].includes(c.currentStatus)).length;
  const selectedTotal = filteredCandidates.filter((c) => ['SELECTED', 'OFFER_RELEASED', 'OFFER_ACCEPTED', 'ONBOARDING_PENDING', 'DOCUMENTS_SUBMITTED', 'DOCUMENTS_VERIFIED'].includes(c.currentStatus)).length;
  const joinedTotal = filteredCandidates.filter((c) => c.currentStatus === 'JOINED').length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            15-Stage Recruitment Pipeline
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Drag cards across stages or select a target stage · Active {activeTotal} · Offer/Onboarding {selectedTotal} · Joined {joinedTotal}
          </p>
        </div>
        <button
          type="button"
          onClick={loadPipeline}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#101820] text-xs font-medium w-fit"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Pipeline Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter pipeline by candidate name, ID, or skill..."
            className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] pl-9 pr-3 py-2 text-sm"
          />
        </div>
        <select
          value={jobFilter}
          onChange={(e) => setJobFilter(e.target.value)}
          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] px-3 py-2 text-sm"
        >
          <option value="">All Job Openings</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>{j.jobCode} · {j.title}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-12 text-center text-sm text-slate-500">
          Loading 15-stage recruitment board...
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {stages.map((stage) => {
            const stageCands = filteredCandidates.filter((c) => c.currentStatus === stage.code);
            const isOver = dropStage === stage.code;
            return (
              <div
                key={stage.code}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropStage(stage.code);
                }}
                onDragLeave={() => setDropStage(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropStage(null);
                  if (draggedId !== null) {
                    moveCandidate(draggedId, stage.code);
                    setDraggedId(null);
                  }
                }}
                className={`w-72 shrink-0 rounded-xl border transition-colors flex flex-col max-h-[70vh] ${
                  isOver
                    ? 'border-[#0863E8] bg-blue-50/60 dark:bg-blue-950/30'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-[#101820]/70'
                }`}
              >
                <div className="px-3.5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                    {stage.order}. {stage.label}
                  </span>
                  <span className="font-mono text-xs font-semibold text-[#0863E8] tabular-nums">
                    {stageCands.length}
                  </span>
                </div>

                <div className="p-2.5 space-y-2.5 overflow-y-auto flex-1">
                  {stageCands.map((cand) => (
                    <div
                      key={cand.id}
                      draggable
                      onDragStart={() => setDraggedId(cand.id)}
                      onDragEnd={() => { setDraggedId(null); setDropStage(null); }}
                      className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 space-y-2 shadow-xs cursor-grab active:cursor-grabbing"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono text-[11px] text-[#0863E8] font-semibold">
                            {cand.candidateCode}
                          </p>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                            {cand.fullName}
                          </p>
                          <p className="text-xs text-slate-500 truncate">
                            {cand.jobTitle || 'General Pool'} · {cand.totalExperienceYears}y
                          </p>
                        </div>
                        <GripVertical className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                      </div>
                      <select
                        value={cand.currentStatus}
                        onChange={(e) => moveCandidate(cand.id, e.target.value)}
                        aria-label={`Move ${cand.fullName} stage`}
                        className="w-full rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1 text-xs"
                      >
                        {stages.map((opt) => (
                          <option key={opt.code} value={opt.code}>
                            Move to: {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                  {stageCands.length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-6">Drop candidate here</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
