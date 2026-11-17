import React, { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CheckCircle, Eye, MessageSquarePlus, Pencil, Plus } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { Modal } from '../components/Modal';
import { StatusText } from '../components/StatusText';
import { TableSkeleton } from '../components/Skeletons';

function toLocalDateTimeInput(value: string | Date | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function InterviewsOffersPage() {
  const { showToast } = useToast();
  const [tab, setTab] = useState<'INTERVIEWS' | 'OFFERS'>('INTERVIEWS');
  const [loading, setLoading] = useState(true);
  const [interviews, setInterviews] = useState<any[]>([]);
  const [offers, setOffers] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    candidateId: '',
    roundName: 'Technical Round 1',
    scheduledAt: '',
    durationMinutes: 45,
    mode: 'VIDEO',
    meetingLinkOrVenue: 'https://meet.9hrindia.com/panel',
    interviewerName: '',
    interviewerEmail: '',
  });

  const [editInterviewTarget, setEditInterviewTarget] = useState<any>(null);
  const [editInterviewForm, setEditInterviewForm] = useState({
    status: 'RESCHEDULED',
    scheduledAt: '',
    mode: 'VIDEO',
    meetingLinkOrVenue: '',
    interviewerName: '',
  });

  const [feedbackTarget, setFeedbackTarget] = useState<any>(null);
  const [viewFeedbackTarget, setViewFeedbackTarget] = useState<any>(null);
  const [feedbackForm, setFeedbackForm] = useState({
    technicalRating: 4,
    communicationRating: 4,
    cultureRating: 4,
    recommendation: 'HIRE',
    comments: '',
  });

  const [offerOpen, setOfferOpen] = useState(false);
  const [offerForm, setOfferForm] = useState({
    candidateId: '',
    designation: '',
    offeredCtc: '',
    joiningDate: '',
    remarks: '',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [ivRes, ofRes, candRes] = await Promise.all([
        apiFetch('/api/interviews'),
        apiFetch('/api/offers'),
        apiFetch('/api/candidates'),
      ]);
      setInterviews(ivRes.interviews || []);
      setOffers(ofRes.offers || []);
      setCandidates(candRes.candidates || []);
    } catch (err: any) {
      showToast('Failed to load interviews & offers', 'error', err.message);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/interviews', {
        method: 'POST',
        body: JSON.stringify({ ...scheduleForm, candidateId: Number(scheduleForm.candidateId) }),
      });
      showToast('Interview Scheduled', 'success');
      setScheduleOpen(false);
      loadData();
    } catch (err: any) {
      showToast('Schedule Error', 'error', err.message);
    }
  };

  const openEditInterview = (iv: any) => {
    setEditInterviewTarget(iv);
    setEditInterviewForm({
      status: iv.status || 'SCHEDULED',
      scheduledAt: toLocalDateTimeInput(iv.scheduledAt),
      mode: iv.mode || 'VIDEO',
      meetingLinkOrVenue: iv.meetingLinkOrVenue || '',
      interviewerName: iv.interviewerName || '',
    });
  };

  const handleUpdateInterview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editInterviewTarget) return;
    try {
      await apiFetch(`/api/interviews/${editInterviewTarget.id}`, {
        method: 'PATCH',
        body: JSON.stringify(editInterviewForm),
      });
      showToast('Interview Updated', 'success');
      setEditInterviewTarget(null);
      loadData();
    } catch (err: any) {
      showToast('Update Interview Failed', 'error', err.message);
    }
  };

  const handleFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackTarget) return;
    try {
      await apiFetch(`/api/interviews/${feedbackTarget.id}/feedback`, {
        method: 'POST',
        body: JSON.stringify(feedbackForm),
      });
      showToast('Interview Feedback Recorded', 'success');
      setFeedbackTarget(null);
      setFeedbackForm({
        technicalRating: 4,
        communicationRating: 4,
        cultureRating: 4,
        recommendation: 'HIRE',
        comments: '',
      });
      loadData();
    } catch (err: any) {
      showToast('Feedback Failed', 'error', err.message);
    }
  };

  const handleCreateOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/offers', {
        method: 'POST',
        body: JSON.stringify({ ...offerForm, candidateId: Number(offerForm.candidateId) }),
      });
      showToast('Offer Released', 'success');
      setOfferOpen(false);
      loadData();
    } catch (err: any) {
      showToast('Offer Error', 'error', err.message);
    }
  };

  const handleOfferDecision = async (offerId: number, offerStatus: 'ACCEPTED' | 'DECLINED') => {
    try {
      await apiFetch(`/api/offers/${offerId}`, {
        method: 'PATCH',
        body: JSON.stringify({ offerStatus }),
      });
      showToast(`Offer Marked ${offerStatus}`, 'success');
      loadData();
    } catch (err: any) {
      showToast('Update Failed', 'error', err.message);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Interviews &amp; Offer Management
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Schedule panel interviews, capture structured feedback, and manage released offers
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex p-1 rounded-lg bg-slate-100 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setTab('INTERVIEWS')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${tab === 'INTERVIEWS' ? 'bg-white dark:bg-slate-800 shadow-xs text-[#0863E8]' : 'text-slate-500'}`}
            >
              Interviews ({interviews.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('OFFERS')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${tab === 'OFFERS' ? 'bg-white dark:bg-slate-800 shadow-xs text-[#0863E8]' : 'text-slate-500'}`}
            >
              Offers ({offers.length})
            </button>
          </div>
          {tab === 'INTERVIEWS' ? (
            <button type="button" onClick={() => setScheduleOpen(true)} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#0863E8] text-white text-xs font-semibold whitespace-nowrap">
              <CalendarClock className="w-4 h-4" /> Schedule Interview
            </button>
          ) : (
            <button type="button" onClick={() => setOfferOpen(true)} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#079B35] text-white text-xs font-semibold whitespace-nowrap">
              <Plus className="w-4 h-4" /> Release Offer
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={5} cols={5} />
      ) : tab === 'INTERVIEWS' ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 bg-slate-50/70 dark:bg-slate-900/40">
                <th className="text-left px-4 py-3 font-medium">Candidate</th>
                <th className="text-left px-4 py-3 font-medium">Round &amp; Mode</th>
                <th className="text-left px-4 py-3 font-medium">Scheduled Time</th>
                <th className="text-left px-4 py-3 font-medium">Interviewer</th>
                <th className="text-left px-4 py-3 font-medium">Status / Feedback</th>
                <th className="text-right px-4 py-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {interviews.map((iv) => (
                <tr key={iv.id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{iv.candidateName}</p>
                    <p className="font-mono text-xs text-[#0863E8]">{iv.candidateCode}</p>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <p className="font-medium">{iv.roundName}</p>
                    <p className="text-slate-500">{iv.mode} · {iv.durationMinutes} min</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums">
                    {new Date(iv.scheduledAt).toLocaleString('en-IN')}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    <p className="font-medium">{iv.interviewerName}</p>
                    <p className="text-slate-500 truncate max-w-[180px]" title={iv.meetingLinkOrVenue}>{iv.meetingLinkOrVenue}</p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusText status={iv.status} />
                    {iv.feedback?.[0] && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        Rec: {iv.feedback[0].recommendation} · Avg {((iv.feedback[0].technicalRating + iv.feedback[0].communicationRating + iv.feedback[0].cultureRating) / 3).toFixed(1)}/5
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center justify-end gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => openEditInterview(iv)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Update
                      </button>
                      {iv.feedback?.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setViewFeedbackTarget(iv)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-[#0863E8] hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                        >
                          <Eye className="w-3.5 h-3.5" /> Feedback ({iv.feedback.length})
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setFeedbackTarget(iv)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                      >
                        <MessageSquarePlus className="w-3.5 h-3.5" /> Record Feedback
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {interviews.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">No interviews scheduled.</td></tr>
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
                <th className="text-left px-4 py-3 font-medium">Designation</th>
                <th className="text-left px-4 py-3 font-medium">Offered CTC</th>
                <th className="text-left px-4 py-3 font-medium">Joining Date</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Decision</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {offers.map((of) => (
                <tr key={of.id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{of.candidateName}</p>
                    <p className="font-mono text-xs text-[#0863E8]">{of.candidateCode}</p>
                  </td>
                  <td className="px-4 py-3 text-xs font-medium">{of.designation}</td>
                  <td className="px-4 py-3 font-mono text-xs font-semibold tabular-nums">{of.offeredCtc}</td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums">{of.joiningDate}</td>
                  <td className="px-4 py-3"><StatusText status={of.offerStatus} /></td>
                  <td className="px-4 py-3 text-right">
                    {of.offerStatus === 'RELEASED' && (
                      <div className="inline-flex gap-1.5">
                        <button type="button" onClick={() => handleOfferDecision(of.id, 'ACCEPTED')} className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#079B35] text-white text-xs font-medium">
                          <CheckCircle className="w-3 h-3" /> Accept
                        </button>
                        <button type="button" onClick={() => handleOfferDecision(of.id, 'DECLINED')} className="px-2.5 py-1 rounded border border-rose-300 text-rose-600 text-xs font-medium">
                          Decline
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {offers.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">No offers released yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Schedule Modal */}
      <Modal open={scheduleOpen} onClose={() => setScheduleOpen(false)} title="Schedule Candidate Interview">
        <form onSubmit={handleSchedule} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Candidate *</label>
            <select required value={scheduleForm.candidateId} onChange={(e) => setScheduleForm({ ...scheduleForm, candidateId: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
              <option value="">Select Candidate</option>
              {candidates.map((c) => <option key={c.id} value={c.id}>{c.candidateCode} · {c.fullName}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Round Name *</label>
              <input required value={scheduleForm.roundName} onChange={(e) => setScheduleForm({ ...scheduleForm, roundName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Date &amp; Time *</label>
              <input required type="datetime-local" value={scheduleForm.scheduledAt} onChange={(e) => setScheduleForm({ ...scheduleForm, scheduledAt: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Mode</label>
              <select value={scheduleForm.mode} onChange={(e) => setScheduleForm({ ...scheduleForm, mode: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
                <option value="VIDEO">Video Call</option>
                <option value="IN_PERSON">In Person</option>
                <option value="PHONE">Phone Screen</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Interviewer Name *</label>
              <input required value={scheduleForm.interviewerName} onChange={(e) => setScheduleForm({ ...scheduleForm, interviewerName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Meeting Link or Office Venue *</label>
            <input required value={scheduleForm.meetingLinkOrVenue} onChange={(e) => setScheduleForm({ ...scheduleForm, meetingLinkOrVenue: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setScheduleOpen(false)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-[#0863E8] text-white text-xs font-semibold">Confirm Schedule</button>
          </div>
        </form>
      </Modal>

      {/* Reschedule / Update Interview Modal */}
      <Modal
        open={Boolean(editInterviewTarget)}
        onClose={() => setEditInterviewTarget(null)}
        title="Reschedule or Update Interview"
        subtitle={editInterviewTarget ? `${editInterviewTarget.candidateName} · ${editInterviewTarget.roundName}` : ''}
      >
        <form onSubmit={handleUpdateInterview} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Interview Status *</label>
              <select
                value={editInterviewForm.status}
                onChange={(e) => setEditInterviewForm({ ...editInterviewForm, status: e.target.value })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              >
                <option value="SCHEDULED">Scheduled</option>
                <option value="RESCHEDULED">Rescheduled</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
                <option value="NO_SHOW">Candidate No Show</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Date &amp; Time *</label>
              <input
                required
                type="datetime-local"
                value={editInterviewForm.scheduledAt}
                onChange={(e) => setEditInterviewForm({ ...editInterviewForm, scheduledAt: e.target.value })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Mode</label>
              <select
                value={editInterviewForm.mode}
                onChange={(e) => setEditInterviewForm({ ...editInterviewForm, mode: e.target.value })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              >
                <option value="VIDEO">Video Call</option>
                <option value="IN_PERSON">In Person</option>
                <option value="PHONE">Phone Screen</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Interviewer Name *</label>
              <input
                required
                value={editInterviewForm.interviewerName}
                onChange={(e) => setEditInterviewForm({ ...editInterviewForm, interviewerName: e.target.value })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Meeting Link or Office Venue *</label>
            <input
              required
              value={editInterviewForm.meetingLinkOrVenue}
              onChange={(e) => setEditInterviewForm({ ...editInterviewForm, meetingLinkOrVenue: e.target.value })}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditInterviewTarget(null)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-[#0863E8] text-white text-xs font-semibold">Save Changes</button>
          </div>
        </form>
      </Modal>

      {/* Feedback Modal */}
      <Modal open={Boolean(feedbackTarget)} onClose={() => setFeedbackTarget(null)} title="Record Interview Feedback" subtitle={feedbackTarget ? `${feedbackTarget.candidateName} · ${feedbackTarget.roundName}` : ''}>
        <form onSubmit={handleFeedback} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Technical (1–5)</label>
              <input type="number" min={1} max={5} value={feedbackForm.technicalRating} onChange={(e) => setFeedbackForm({ ...feedbackForm, technicalRating: Number(e.target.value) })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Communication (1–5)</label>
              <input type="number" min={1} max={5} value={feedbackForm.communicationRating} onChange={(e) => setFeedbackForm({ ...feedbackForm, communicationRating: Number(e.target.value) })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Culture Fit (1–5)</label>
              <input type="number" min={1} max={5} value={feedbackForm.cultureRating} onChange={(e) => setFeedbackForm({ ...feedbackForm, cultureRating: Number(e.target.value) })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Recommendation</label>
            <select value={feedbackForm.recommendation} onChange={(e) => setFeedbackForm({ ...feedbackForm, recommendation: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
              <option value="STRONG_HIRE">Strong Hire</option>
              <option value="HIRE">Hire</option>
              <option value="HOLD">Hold</option>
              <option value="REJECT">Reject</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Panel Remarks *</label>
            <textarea required rows={3} value={feedbackForm.comments} onChange={(e) => setFeedbackForm({ ...feedbackForm, comments: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setFeedbackTarget(null)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-[#0863E8] text-white text-xs font-semibold">Submit Feedback</button>
          </div>
        </form>
      </Modal>

      {/* View Feedback Details Modal */}
      <Modal
        open={Boolean(viewFeedbackTarget)}
        onClose={() => setViewFeedbackTarget(null)}
        title="Interview Evaluation Summary"
        subtitle={viewFeedbackTarget ? `${viewFeedbackTarget.candidateName} (${viewFeedbackTarget.candidateCode}) · ${viewFeedbackTarget.roundName}` : ''}
      >
        <div className="space-y-4">
          {viewFeedbackTarget?.feedback?.map((fb: any) => (
            <div key={fb.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3 bg-slate-50/70 dark:bg-slate-900/40">
              <div className="flex items-center justify-between gap-2">
                <StatusText status={fb.recommendation} />
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  {fb.createdAt ? new Date(fb.createdAt).toLocaleString('en-IN') : ''}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="rounded-lg bg-white dark:bg-[#101820] border border-slate-200 dark:border-slate-800 p-2.5">
                  <p className="text-slate-500">Technical</p>
                  <p className="font-mono text-base font-bold tabular-nums mt-0.5">{fb.technicalRating} / 5</p>
                </div>
                <div className="rounded-lg bg-white dark:bg-[#101820] border border-slate-200 dark:border-slate-800 p-2.5">
                  <p className="text-slate-500">Communication</p>
                  <p className="font-mono text-base font-bold tabular-nums mt-0.5">{fb.communicationRating} / 5</p>
                </div>
                <div className="rounded-lg bg-white dark:bg-[#101820] border border-slate-200 dark:border-slate-800 p-2.5">
                  <p className="text-slate-500">Culture Fit</p>
                  <p className="font-mono text-base font-bold tabular-nums mt-0.5">{fb.cultureRating} / 5</p>
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 mb-1">Panel Remarks</p>
                <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{fb.comments}</p>
              </div>
            </div>
          ))}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setViewFeedbackTarget(null)}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium"
            >
              Close
            </button>
          </div>
        </div>
      </Modal>

      {/* Release Offer Modal */}
      <Modal open={offerOpen} onClose={() => setOfferOpen(false)} title="Release Candidate Offer">
        <form onSubmit={handleCreateOffer} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Candidate *</label>
            <select required value={offerForm.candidateId} onChange={(e) => setOfferForm({ ...offerForm, candidateId: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
              <option value="">Select Candidate</option>
              {candidates.map((c) => <option key={c.id} value={c.id}>{c.candidateCode} · {c.fullName}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Designation *</label>
              <input required value={offerForm.designation} onChange={(e) => setOfferForm({ ...offerForm, designation: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Offered CTC *</label>
              <input required value={offerForm.offeredCtc} onChange={(e) => setOfferForm({ ...offerForm, offeredCtc: e.target.value })} placeholder="₹24 LPA" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Expected Joining Date *</label>
            <input required type="date" value={offerForm.joiningDate} onChange={(e) => setOfferForm({ ...offerForm, joiningDate: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOfferOpen(false)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-[#079B35] text-white text-xs font-semibold">Release Offer</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
