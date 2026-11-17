import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Ban,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  FileSearch,
  Link2,
  Mail,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/api';
import { Modal } from '../components/Modal';
import { StatusText } from '../components/StatusText';
import { TableSkeleton } from '../components/Skeletons';

export function OnboardingOpsPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const isVerifier = user?.roleName === 'SUPER_ADMIN' || user?.roleName === 'ADMIN';

  const [tab, setTab] = useState<'TRACKING' | 'DOCUMENTS'>('TRACKING');
  const [loading, setLoading] = useState(true);
  const [links, setLinks] = useState<any[]>([]);
  const [docs, setDocs] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [docCategories, setDocCategories] = useState<any[]>([]);

  // Generate / Regenerate link modal
  const [genOpen, setGenOpen] = useState(false);
  const [selectedCandId, setSelectedCandId] = useState('');
  const [expiryDays, setExpiryDays] = useState(7);
  const [freshLink, setFreshLink] = useState<{ id: number; url: string; candName: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Request Missing Docs Modal
  const [missingLink, setMissingLink] = useState<any>(null);
  const [selectedMissingCats, setSelectedMissingCats] = useState<string[]>([]);
  const [missingRemarks, setMissingRemarks] = useState('');

  // Inspect Submission Modal
  const [inspectData, setInspectData] = useState<any>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [changeRemarks, setChangeRemarks] = useState('');

  // Document Verify Modal
  const [verifyDoc, setVerifyDoc] = useState<any>(null);
  const [verifyAction, setVerifyAction] = useState<'APPROVED' | 'REJECTED' | 'REUPLOAD_REQUESTED'>('APPROVED');
  const [verifyRemarks, setVerifyRemarks] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [linksRes, docsRes, candRes, catRes] = await Promise.all([
        apiFetch('/api/onboarding/links'),
        apiFetch('/api/documents/queue'),
        apiFetch('/api/candidates'),
        apiFetch('/api/document-categories'),
      ]);
      setLinks(linksRes.links || []);
      setDocs(docsRes.documents || []);
      setCandidates(candRes.candidates || []);
      setDocCategories(catRes.categories || []);
    } catch (err: any) {
      showToast('Failed to load onboarding data', 'error', err.message);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ link: any; onboardingPath: string }>('/api/onboarding/links', {
        method: 'POST',
        body: JSON.stringify({ candidateId: Number(selectedCandId), expiryDays }),
      });
      const cand = candidates.find((c) => c.id === Number(selectedCandId));
      setFreshLink({
        id: res.link.id,
        url: `${window.location.origin}${res.onboardingPath}`,
        candName: cand?.fullName || 'Candidate',
      });
      showToast('Secure Onboarding Link Generated', 'success');
      loadAll();
    } catch (err: any) {
      showToast('Generation Failed', 'error', err.message);
    }
  };

  const handleRegenerate = async (linkRow: any) => {
    try {
      const res = await apiFetch<{ link: any; onboardingPath: string }>(
        `/api/onboarding/links/${linkRow.id}/regenerate`,
        {
          method: 'POST',
          body: JSON.stringify({ expiryDays }),
        },
      );
      setFreshLink({
        id: res.link.id,
        url: `${window.location.origin}${res.onboardingPath}`,
        candName: linkRow.candidateName || 'Candidate',
      });
      setGenOpen(true);
      showToast('Fresh Onboarding Link Issued', 'success', 'Previous token has been revoked.');
      loadAll();
    } catch (err: any) {
      showToast('Regeneration Failed', 'error', err.message);
    }
  };

  const handleShare = async (channel: 'WHATSAPP' | 'EMAIL' | 'COPY') => {
    if (!freshLink) return;
    await apiFetch(`/api/onboarding/links/${freshLink.id}/share`, {
      method: 'POST',
      body: JSON.stringify({ channel, onboardingUrl: freshLink.url }),
    });
    if (channel === 'COPY') {
      await navigator.clipboard.writeText(freshLink.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      showToast('Link Copied to Clipboard', 'success');
    } else if (channel === 'WHATSAPP') {
      const msg = encodeURIComponent(
        `Hello ${freshLink.candName}, welcome to 9HR India Private Limited! Complete your onboarding securely here: ${freshLink.url}`,
      );
      window.open(`https://wa.me/?text=${msg}`, '_blank', 'noopener,noreferrer');
    } else {
      showToast('Email Notification Dispatched', 'success');
    }
    loadAll();
  };

  const handleRevoke = async (linkId: number) => {
    try {
      await apiFetch(`/api/onboarding/links/${linkId}/revoke`, { method: 'POST' });
      showToast('Onboarding Link Revoked', 'info');
      loadAll();
    } catch (err: any) {
      showToast('Revoke Failed', 'error', err.message);
    }
  };

  const handleMissingDocsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!missingLink) return;
    try {
      await apiFetch(`/api/onboarding/links/${missingLink.id}/request-missing-docs`, {
        method: 'POST',
        body: JSON.stringify({
          categories: selectedMissingCats,
          remarks: missingRemarks,
        }),
      });
      showToast('Missing Document Request Sent', 'success');
      setMissingLink(null);
      setSelectedMissingCats([]);
      setMissingRemarks('');
      loadAll();
    } catch (err: any) {
      showToast('Request Failed', 'error', err.message);
    }
  };

  const handleInspectSubmission = async (submissionId: number) => {
    setInspectLoading(true);
    setInspectData(null);
    setChangeRemarks('');
    try {
      const res = await apiFetch(`/api/onboarding/submissions/${submissionId}`);
      setInspectData(res);
    } catch (err: any) {
      showToast('Unable to inspect submission', 'error', err.message);
    } finally {
      setInspectLoading(false);
    }
  };

  const handleApproveOnboarding = async (submissionId: number, markJoined: boolean) => {
    try {
      await apiFetch(`/api/onboarding/submissions/${submissionId}/approve`, {
        method: 'POST',
        body: JSON.stringify({ markJoined }),
      });
      showToast('Final Onboarding Approved', 'success');
      setInspectData(null);
      loadAll();
    } catch (err: any) {
      showToast('Approval Error', 'error', err.message);
    }
  };

  const handleRequestChanges = async () => {
    if (!inspectData?.submission?.id) return;
    if (!changeRemarks.trim()) {
      showToast('Remarks Required', 'error', 'Provide details on what needs correction.');
      return;
    }
    try {
      await apiFetch(`/api/onboarding/submissions/${inspectData.submission.id}/request-changes`, {
        method: 'POST',
        body: JSON.stringify({ remarks: changeRemarks }),
      });
      showToast('Changes Requested from Candidate', 'info');
      setInspectData(null);
      setChangeRemarks('');
      loadAll();
    } catch (err: any) {
      showToast('Request Changes Failed', 'error', err.message);
    }
  };

  const handleAuthorizedView = async (docId: number) => {
    try {
      const { url } = await apiFetch<{ url: string }>(`/api/documents/${docId}/download-token`, {
        method: 'POST',
      });
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      showToast('Document Access Denied', 'error', err.message);
    }
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyDoc) return;
    try {
      await apiFetch(`/api/documents/${verifyDoc.id}/verify`, {
        method: 'POST',
        body: JSON.stringify({ action: verifyAction, remarks: verifyRemarks }),
      });
      showToast(`Document ${verifyAction}`, 'success');
      setVerifyDoc(null);
      setVerifyRemarks('');
      loadAll();
    } catch (err: any) {
      showToast('Verification Failed', 'error', err.message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Candidate Onboarding &amp; Document Verification
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Generate secure OTP-gated onboarding links, track candidate progress, and verify encrypted documents
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex p-1 rounded-lg bg-slate-100 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setTab('TRACKING')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${tab === 'TRACKING' ? 'bg-white dark:bg-slate-800 shadow-xs text-[#0863E8]' : 'text-slate-500'}`}
            >
              Onboarding Links ({links.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('DOCUMENTS')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${tab === 'DOCUMENTS' ? 'bg-white dark:bg-slate-800 shadow-xs text-[#0863E8]' : 'text-slate-500'}`}
            >
              Document Queue ({docs.filter((d) => d.verificationStatus === 'PENDING').length} pending)
            </button>
          </div>
          <button
            type="button"
            onClick={() => { setFreshLink(null); setGenOpen(true); }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0863E8] hover:bg-[#0652c2] text-white text-xs font-semibold whitespace-nowrap"
          >
            <Link2 className="w-4 h-4" /> Generate Onboarding Link
          </button>
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={5} cols={6} />
      ) : tab === 'TRACKING' ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 bg-slate-50/70 dark:bg-slate-900/40">
                <th className="text-left px-4 py-3 font-medium">Candidate</th>
                <th className="text-left px-4 py-3 font-medium">Token &amp; Expiry</th>
                <th className="text-left px-4 py-3 font-medium">Milestone Status</th>
                <th className="text-left px-4 py-3 font-medium">Activity Timeline</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {links.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
                  <td className="px-4 py-3">
                    <p className="font-semibold">{l.candidateName}</p>
                    <p className="font-mono text-xs text-[#0863E8]">{l.candidateCode}</p>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <p className="font-mono text-slate-700 dark:text-slate-300">{l.tokenPreview}</p>
                    <p className="text-slate-500 tabular-nums">
                      Expires: {new Date(l.expiresAt).toLocaleDateString('en-IN')} {l.isRevoked ? '· REVOKED' : ''}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusText status={l.isRevoked ? 'REVOKED' : l.status} />
                    {l.sharedChannel && (
                      <p className="text-[11px] text-slate-500 mt-0.5">Shared via {l.sharedChannel}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[11px] text-slate-500 space-y-0.5 tabular-nums">
                    <p>Opened: {l.openedAt ? new Date(l.openedAt).toLocaleString('en-IN') : 'Not yet'}</p>
                    <p>OTP Verified: {l.otpVerifiedAt ? 'Yes' : 'Pending'} · Submitted: {l.submittedAt ? 'Yes' : 'No'}</p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                      {l.submissionId && (
                        <button
                          type="button"
                          onClick={() => handleInspectSubmission(l.submissionId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                        >
                          <FileSearch className="w-3 h-3" /> Inspect
                        </button>
                      )}
                      {!l.isRevoked && l.status !== 'COMPLETED' && (
                        <button
                          type="button"
                          onClick={() => {
                            setMissingLink(l);
                            setSelectedMissingCats([]);
                            setMissingRemarks('');
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-xs font-medium whitespace-nowrap"
                        >
                          <AlertCircle className="w-3 h-3" /> Request Docs
                        </button>
                      )}
                      {l.status !== 'COMPLETED' && (
                        <button
                          type="button"
                          onClick={() => handleRegenerate(l)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                        >
                          <RotateCcw className="w-3 h-3" /> Regenerate
                        </button>
                      )}
                      {!l.isRevoked && l.status !== 'COMPLETED' && (
                        <button
                          type="button"
                          onClick={() => handleRevoke(l.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-rose-300 text-rose-600 text-xs font-medium whitespace-nowrap"
                        >
                          <Ban className="w-3 h-3" /> Revoke
                        </button>
                      )}
                      {isVerifier && l.submissionId && l.reviewStatus === 'SUBMITTED' && (
                        <button
                          type="button"
                          onClick={() => handleApproveOnboarding(l.submissionId, true)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#079B35] text-white text-xs font-medium whitespace-nowrap"
                        >
                          <CheckCircle2 className="w-3 h-3" /> Finalize &amp; Mark Joined
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {links.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">No onboarding links generated yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 bg-slate-50/70 dark:bg-slate-900/40">
                <th className="text-left px-4 py-3 font-medium">Candidate</th>
                <th className="text-left px-4 py-3 font-medium">Document Category</th>
                <th className="text-left px-4 py-3 font-medium">File &amp; Version</th>
                <th className="text-left px-4 py-3 font-medium">Verification Status</th>
                <th className="text-right px-4 py-3 font-medium">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {docs.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{d.candidateName}</p>
                    <p className="font-mono text-xs text-[#0863E8]">{d.candidateCode}</p>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <p className="font-medium">{d.categoryName}</p>
                    <p className="text-slate-500">{d.groupName}</p>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <p className="font-mono">{d.originalFileName}</p>
                    <p className="text-slate-500">v{d.version} · {(d.fileSizeBytes / 1024).toFixed(1)} KB</p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusText status={d.verificationStatus} />
                    {d.rejectionRemarks && <p className="text-xs text-rose-600 mt-0.5">{d.rejectionRemarks}</p>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleAuthorizedView(d.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <Eye className="w-3.5 h-3.5" /> View
                      </button>
                      {isVerifier && (
                        <button
                          type="button"
                          onClick={() => { setVerifyDoc(d); setVerifyAction('APPROVED'); setVerifyRemarks(''); }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#0863E8] text-white text-xs font-medium"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" /> Verify
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {docs.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">No encrypted documents uploaded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Generate / Regenerate Link Modal */}
      <Modal open={genOpen} onClose={() => setGenOpen(false)} title="Generate Candidate Onboarding Link" subtitle="Creates a single-use candidate-bound token with OTP authentication">
        {!freshLink ? (
          <form onSubmit={handleGenerate} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1">Select Candidate *</label>
              <select required value={selectedCandId} onChange={(e) => setSelectedCandId(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
                <option value="">Choose Candidate...</option>
                {candidates.map((c) => <option key={c.id} value={c.id}>{c.candidateCode} · {c.fullName} ({c.currentStatus})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Link Validity (Days)</label>
              <input type="number" min={1} max={30} value={expiryDays} onChange={(e) => setExpiryDays(Number(e.target.value))} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setGenOpen(false)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium">Cancel</button>
              <button type="submit" className="px-4 py-2 rounded-lg bg-[#0863E8] text-white text-xs font-semibold">Generate Secure Token</button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 p-4 space-y-2">
              <p className="text-xs font-semibold text-[#079B35]">Secure Link Ready for {freshLink.candName}</p>
              <p className="font-mono text-xs break-all bg-white dark:bg-slate-900 p-2.5 rounded border border-slate-200 dark:border-slate-800">{freshLink.url}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => handleShare('COPY')} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium">
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} Copy Link
              </button>
              <button type="button" onClick={() => handleShare('WHATSAPP')} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#079B35] text-white text-xs font-medium">
                <MessageSquare className="w-3.5 h-3.5" /> Share via WhatsApp
              </button>
              <button type="button" onClick={() => handleShare('EMAIL')} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0863E8] text-white text-xs font-medium">
                <Mail className="w-3.5 h-3.5" /> Send Email Invite
              </button>
              <a href={freshLink.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium">
                <RefreshCw className="w-3.5 h-3.5" /> Open Portal Tab
              </a>
            </div>
          </div>
        )}
      </Modal>

      {/* Request Missing Documents Modal */}
      <Modal
        open={Boolean(missingLink)}
        onClose={() => setMissingLink(null)}
        title="Request Missing Onboarding Documents"
        subtitle={missingLink ? `${missingLink.candidateName} · ${missingLink.candidateCode}` : ''}
      >
        <form onSubmit={handleMissingDocsSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-medium">Select Pending Document Categories</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
              {docCategories.filter((c) => c.isEnabled).map((cat) => {
                const checked = selectedMissingCats.includes(cat.name);
                return (
                  <label key={cat.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setSelectedMissingCats((prev) =>
                          checked ? prev.filter((item) => item !== cat.name) : [...prev, cat.name],
                        )
                      }
                      className="rounded border-slate-300 text-[#0863E8]"
                    />
                    <span>{cat.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Instructions / Remarks</label>
            <textarea
              rows={3}
              value={missingRemarks}
              onChange={(e) => setMissingRemarks(e.target.value)}
              placeholder="Specify missing pages, clearer scan requirement, or submission deadline..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setMissingLink(null)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-[#0863E8] text-white text-xs font-semibold">Notify Candidate &amp; Log Request</button>
          </div>
        </form>
      </Modal>

      {/* Inspect Onboarding Submission Modal */}
      <Modal
        open={inspectLoading || Boolean(inspectData)}
        onClose={() => { setInspectData(null); setInspectLoading(false); }}
        title={inspectData ? `Onboarding Review · ${inspectData.candidate.fullName}` : 'Loading Submission...'}
        subtitle={inspectData ? `${inspectData.candidate.candidateCode} · Status: ${inspectData.submission.reviewStatus}` : ''}
        size="xl"
      >
        {inspectLoading || !inspectData ? (
          <div className="py-10 text-center text-sm text-slate-500">Loading submitted dossier...</div>
        ) : (
          <div className="space-y-5 text-xs">
            {/* Personal & DPDP Consent Summary */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-1.5">
                <p className="font-semibold text-slate-800 dark:text-slate-100">Personal &amp; Emergency Details</p>
                <p className="text-slate-600 dark:text-slate-400">
                  Address: {inspectData.submission.personalInfoJson?.currentAddress || '—'}
                </p>
                <p className="text-slate-600 dark:text-slate-400">
                  City / State: {inspectData.submission.personalInfoJson?.city || '—'}, {inspectData.submission.personalInfoJson?.state || '—'} {inspectData.submission.personalInfoJson?.pincode || ''}
                </p>
                <p className="text-slate-600 dark:text-slate-400">
                  Emergency Contact: {inspectData.submission.personalInfoJson?.emergencyName || '—'} ({inspectData.submission.personalInfoJson?.emergencyPhone || '—'})
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-1.5">
                <p className="font-semibold text-slate-800 dark:text-slate-100">Banking &amp; Statutory Compliance</p>
                <p className="text-slate-600 dark:text-slate-400">
                  Bank: {inspectData.submission.bankingInfoJson?.bankName || '—'} · IFSC: <span className="font-mono">{inspectData.submission.bankingInfoJson?.ifsc || '—'}</span>
                </p>
                <p className="text-slate-600 dark:text-slate-400">
                  Account: <span className="font-mono">{inspectData.submission.bankingInfoJson?.accountNumber || '—'}</span> · PAN: <span className="font-mono">{inspectData.submission.bankingInfoJson?.panNumber || '—'}</span>
                </p>
                <p className="text-slate-600 dark:text-slate-400">
                  DPDP Consent: {inspectData.submission.consentAccepted ? `Accepted (${new Date(inspectData.submission.consentTimestamp).toLocaleString('en-IN')} · IP ${inspectData.submission.consentIp || 'N/A'})` : 'Pending'}
                </p>
              </div>
            </div>

            {/* Education & Employment Records */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2">
                <p className="font-semibold text-slate-800 dark:text-slate-100">Education History</p>
                {Array.isArray(inspectData.submission.educationInfoJson) && inspectData.submission.educationInfoJson.length > 0 ? (
                  inspectData.submission.educationInfoJson.map((ed: any, idx: number) => (
                    <div key={idx} className="border-b border-slate-100 dark:border-slate-800/70 pb-1.5 last:border-0">
                      <p className="font-medium">{ed.level} · {ed.institution}</p>
                      <p className="text-slate-500">{ed.boardOrUniversity} · {ed.yearOfPassing} · {ed.percentageOrCgpa}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-slate-500">No education records entered yet.</p>
                )}
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2">
                <p className="font-semibold text-slate-800 dark:text-slate-100">Prior Employment</p>
                {Array.isArray(inspectData.submission.employmentInfoJson) && inspectData.submission.employmentInfoJson.length > 0 ? (
                  inspectData.submission.employmentInfoJson.map((emp: any, idx: number) => (
                    <div key={idx} className="border-b border-slate-100 dark:border-slate-800/70 pb-1.5 last:border-0">
                      <p className="font-medium">{emp.companyName} · {emp.designation}</p>
                      <p className="text-slate-500">{emp.startDate} to {emp.endDate || 'Present'} · CTC {emp.lastCtc || '—'}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-slate-500">No prior employment records entered.</p>
                )}
              </div>
            </div>

            {/* Uploaded Documents */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2">
              <p className="font-semibold text-slate-800 dark:text-slate-100">Uploaded Encrypted Documents ({inspectData.documents?.length || 0})</p>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {(inspectData.documents || []).map((doc: any) => (
                  <div key={doc.id} className="py-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{doc.categoryName} (v{doc.version})</p>
                      <p className="font-mono text-[11px] text-slate-500">{doc.originalFileName}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusText status={doc.verificationStatus} />
                      <button
                        type="button"
                        onClick={() => handleAuthorizedView(doc.id)}
                        className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        View
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {isVerifier && inspectData.submission.reviewStatus !== 'APPROVED' && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 bg-slate-50/70 dark:bg-slate-900/40">
                <label className="block font-semibold text-slate-700 dark:text-slate-200">
                  HR Verification Remarks (required if requesting corrections)
                </label>
                <textarea
                  rows={2}
                  value={changeRemarks}
                  onChange={(e) => setChangeRemarks(e.target.value)}
                  placeholder="Enter remarks for candidate corrections or final approval..."
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
                />
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={handleRequestChanges}
                    className="px-3.5 py-2 rounded-lg border border-amber-400 text-amber-700 dark:text-amber-300 font-semibold"
                  >
                    Request Corrections
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApproveOnboarding(inspectData.submission.id, false)}
                    className="px-3.5 py-2 rounded-lg bg-[#0863E8] text-white font-semibold"
                  >
                    Approve Documents
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApproveOnboarding(inspectData.submission.id, true)}
                    className="px-3.5 py-2 rounded-lg bg-[#079B35] text-white font-semibold"
                  >
                    Finalize &amp; Mark Joined
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Verify Document Modal */}
      <Modal open={Boolean(verifyDoc)} onClose={() => setVerifyDoc(null)} title="Verify Candidate Document" subtitle={verifyDoc ? `${verifyDoc.candidateName} · ${verifyDoc.documentName}` : ''}>
        <form onSubmit={handleVerifySubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Verification Decision</label>
            <select value={verifyAction} onChange={(e) => setVerifyAction(e.target.value as any)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
              <option value="APPROVED">Approve Document</option>
              <option value="REUPLOAD_REQUESTED">Request Re-upload (Unclear / Incomplete)</option>
              <option value="REJECTED">Reject Document</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              Remarks {verifyAction !== 'APPROVED' ? '*' : '(Optional)'}
            </label>
            <textarea
              required={verifyAction !== 'APPROVED'}
              rows={3}
              value={verifyRemarks}
              onChange={(e) => setVerifyRemarks(e.target.value)}
              placeholder="Provide clear verification notes or re-upload reason..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setVerifyDoc(null)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-[#0863E8] text-white text-xs font-semibold">Save Verification</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
