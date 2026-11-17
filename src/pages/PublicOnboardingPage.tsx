import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  FileUp,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
  AlertCircle,
  Moon,
  Sun,
} from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';
import { StatusText } from '../components/StatusText';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/api';

interface OnboardingInfo {
  candidateName: string;
  candidateCode: string;
  maskedEmail: string;
  status: string;
  expiresAt: string;
  otpVerified: boolean;
}

interface DocCategory {
  id: number;
  code: string;
  name: string;
  groupName: string;
  isRequired: boolean;
  allowMasked: boolean;
  legalNote: string | null;
}

interface UploadedDoc {
  id: number;
  categoryId: number;
  documentName: string;
  originalFileName: string;
  fileSizeBytes: number;
  version: number;
  verificationStatus: string;
  rejectionRemarks: string | null;
  uploadedAt: string;
}

export function PublicOnboardingPage({ token }: { token: string }) {
  const { theme, toggleTheme } = useTheme();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [info, setInfo] = useState<OnboardingInfo | null>(null);

  // OTP state
  const [otpSent, setOtpSent] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Workspace state
  const [step, setStep] = useState(1); // 1: Personal, 2: Edu/Emp, 3: Docs & Banking, 4: Review & Consent, 5: Confirmation
  const [categories, setCategories] = useState<DocCategory[]>([]);
  const [documents, setDocuments] = useState<UploadedDoc[]>([]);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);

  const [personal, setPersonal] = useState({
    fullName: '',
    mobile: '',
    email: '',
    dob: '',
    gender: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    currentAddress: '',
    city: '',
    state: '',
    pincode: '',
    permanentAddress: '',
  });

  const [educationList, setEducationList] = useState([
    { level: 'Graduation', institution: '', boardOrUniversity: '', yearOfPassing: '', percentageOrCgpa: '' },
  ]);

  const [employmentList, setEmploymentList] = useState([
    { companyName: '', designation: '', startDate: '', endDate: '', lastCtc: '', reasonForLeaving: '' },
  ]);

  const [banking, setBanking] = useState({
    accountHolderName: '',
    bankName: '',
    accountNumber: '',
    ifscCode: '',
    branchName: '',
    panNumber: '',
    uanNumber: '',
  });

  const [consentAccepted, setConsentAccepted] = useState(false);
  const [uploadingCatId, setUploadingCatId] = useState<number | null>(null);

  const loadWorkspace = useCallback(async () => {
    const ws = await apiFetch<any>(`/api/public/onboarding/${token}/workspace`);
    setCategories(ws.categories || []);
    setDocuments(ws.documents || []);
    setSubmittedAt(ws.submittedAt || null);

    if (ws.submission?.reviewStatus === 'SUBMITTED' || ws.submission?.reviewStatus === 'APPROVED') {
      setStep(5);
    } else if (ws.submission?.draftStep) {
      setStep(Math.min(Math.max(ws.submission.draftStep, 1), 4));
    }

    const p = ws.submission?.personalInfoJson || {};
    setPersonal({
      fullName: p.fullName || ws.candidate?.fullName || '',
      mobile: p.mobile || ws.candidate?.mobile || '',
      email: p.email || ws.candidate?.email || '',
      dob: p.dob || ws.candidate?.dob || '',
      gender: p.gender || ws.candidate?.gender || '',
      emergencyContactName: p.emergencyContactName || '',
      emergencyContactPhone: p.emergencyContactPhone || '',
      currentAddress: p.currentAddress || '',
      city: p.city || '',
      state: p.state || '',
      pincode: p.pincode || '',
      permanentAddress: p.permanentAddress || '',
    });

    if (Array.isArray(ws.submission?.educationInfoJson) && ws.submission.educationInfoJson.length > 0) {
      setEducationList(ws.submission.educationInfoJson);
    }
    if (Array.isArray(ws.submission?.employmentInfoJson) && ws.submission.employmentInfoJson.length > 0) {
      setEmploymentList(ws.submission.employmentInfoJson);
    }
    if (ws.submission?.bankingInfoJson && Object.keys(ws.submission.bankingInfoJson).length > 0) {
      setBanking((prev) => ({ ...prev, ...ws.submission.bankingInfoJson }));
    }
  }, [token]);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<OnboardingInfo>(`/api/public/onboarding/${token}`);
      setInfo(data);
      if (data.otpVerified) {
        await loadWorkspace();
      }
    } catch (err: any) {
      setLinkError(err.message || 'Onboarding link unavailable.');
    } finally {
      setLoading(false);
    }
  }, [token, loadWorkspace]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  const handleSendOtp = async () => {
    setBusy(true);
    try {
      const res = await apiFetch<{ devOtpPreview?: string }>(`/api/public/onboarding/${token}/send-otp`, {
        method: 'POST',
      });
      setOtpSent(true);
      if (res.devOtpPreview) setDevOtpHint(res.devOtpPreview);
      showToast('OTP Sent', 'success', 'Check your registered email for the 6-digit OTP.');
    } catch (err: any) {
      showToast('Failed to send OTP', 'error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch(`/api/public/onboarding/${token}/verify-otp`, {
        method: 'POST',
        body: JSON.stringify({ otp: otpInput }),
      });
      showToast('Identity Verified', 'success');
      await loadInitial();
    } catch (err: any) {
      showToast('Invalid OTP', 'error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async (nextStep = step) => {
    setBusy(true);
    try {
      await apiFetch(`/api/public/onboarding/${token}/draft`, {
        method: 'PUT',
        body: JSON.stringify({
          personalInfo: personal,
          educationInfo: educationList,
          employmentInfo: employmentList,
          bankingInfo: banking,
          draftStep: nextStep,
        }),
      });
      setStep(nextStep);
      showToast('Draft Saved', 'success');
    } catch (err: any) {
      showToast('Failed to save draft', 'error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDocumentUpload = async (categoryId: number, file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      showToast('File Too Large', 'error', 'Maximum file size is 10 MB.');
      return;
    }
    setUploadingCatId(categoryId);
    try {
      const fd = new FormData();
      fd.append('categoryId', String(categoryId));
      fd.append('file', file);
      await apiFetch(`/api/public/onboarding/${token}/documents`, {
        method: 'POST',
        body: fd,
        isFormData: true,
      });
      showToast('Document Encrypted & Uploaded', 'success');
      await loadWorkspace();
    } catch (err: any) {
      showToast('Upload Rejected', 'error', err.message);
    } finally {
      setUploadingCatId(null);
    }
  };

  const handlePreviewDoc = async (docId: number) => {
    try {
      const { url } = await apiFetch<{ url: string }>(
        `/api/public/onboarding/${token}/documents/${docId}/download-token`,
        { method: 'POST' },
      );
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
      showToast('Preview Failed', 'error', err.message);
    }
  };

  const handleFinalSubmit = async () => {
    setBusy(true);
    try {
      await saveDraft(4);
      const res = await apiFetch<{ submittedAt: string }>(`/api/public/onboarding/${token}/submit`, {
        method: 'POST',
        body: JSON.stringify({ consentAccepted }),
      });
      setSubmittedAt(res.submittedAt);
      setStep(5);
      showToast('Onboarding Application Submitted', 'success');
    } catch (err: any) {
      showToast('Submission Blocked', 'error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const groupedCategories = ['IDENTITY', 'EDUCATION', 'EMPLOYMENT', 'BANKING', 'OTHER'].map((group) => ({
    group,
    items: categories.filter((c) => c.groupName === group),
  }));

  const latestDocForCategory = (catId: number) => documents.find((d) => d.categoryId === catId);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0b1118] text-slate-900 dark:text-slate-100">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-[#101820]/90 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-6">
          <BrandLogo size="sm" subtitle="Candidate Onboarding Portal" />
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Lock className="w-3.5 h-3.5 text-[#079B35]" />
              AES-256 Encrypted · DPDP Compliant
            </span>
            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-10 text-center text-sm text-slate-500">
            Validating secure onboarding token...
          </div>
        ) : linkError || !info ? (
          <div className="max-w-lg mx-auto rounded-2xl border border-rose-200 dark:border-rose-900 bg-white dark:bg-[#101820] p-8 text-center space-y-3">
            <AlertCircle className="w-10 h-10 text-rose-600 mx-auto" />
            <h1 className="font-display text-xl font-bold">Onboarding Link Unavailable</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">{linkError}</p>
            <p className="text-xs text-slate-500">
              Please contact your 9HR India recruiter to request a regenerated link.
            </p>
          </div>
        ) : !info.otpVerified ? (
          <div className="max-w-md mx-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-7 shadow-lg space-y-5">
            <div>
              <p className="text-xs font-medium text-[#0863E8]">
                {info.candidateCode} · Identity Verification
              </p>
              <h1 className="font-display text-2xl font-bold mt-1">
                Welcome, {info.candidateName}
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1.5">
                Verify your registered email ({info.maskedEmail}) with a one-time passcode to unlock
                your onboarding forms and document vault.
              </p>
            </div>

            {!otpSent ? (
              <button
                type="button"
                onClick={handleSendOtp}
                disabled={busy}
                className="w-full py-2.5 px-4 rounded-lg bg-[#0863E8] hover:bg-[#0652c2] text-white font-medium text-sm transition-colors"
              >
                {busy ? 'Dispatching OTP...' : 'Send 6-Digit Verification OTP'}
              </button>
            ) : (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                {devOtpHint && (
                  <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-300">
                    SMTP not configured in preview · Candidate OTP:{' '}
                    <span className="font-mono font-bold">{devOtpHint}</span>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Enter 6-Digit OTP
                  </label>
                  <input
                    required
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value)}
                    placeholder="000000"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 font-mono text-center text-lg tracking-widest"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#0863E8] hover:bg-[#0652c2] text-white font-medium text-sm"
                >
                  {busy ? 'Verifying...' : 'Verify & Unlock Onboarding'}
                </button>
                <button
                  type="button"
                  onClick={handleSendOtp}
                  className="w-full text-xs text-[#0863E8] hover:underline"
                >
                  Resend OTP
                </button>
              </form>
            )}
          </div>
        ) : step === 5 ? (
          <div className="max-w-2xl mx-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-8 shadow-sm space-y-6">
            <div className="flex items-start gap-4">
              <CheckCircle2 className="w-10 h-10 text-[#079B35] shrink-0" />
              <div>
                <h1 className="font-display text-2xl font-bold">
                  Onboarding Application Submitted
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  Thank you, {personal.fullName}. Your details and encrypted documents have been
                  submitted to the 9HR India HR Verification Team.
                </p>
                {submittedAt && (
                  <p className="text-xs font-mono text-slate-500 mt-2 tabular-nums">
                    Submitted Timestamp: {new Date(submittedAt).toLocaleString('en-IN')}
                  </p>
                )}
              </div>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-800 pt-5">
              <h2 className="text-sm font-semibold mb-3">Submitted Document Verification Status</h2>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {documents.map((d) => (
                  <div key={d.id} className="py-2.5 flex items-center justify-between gap-4 text-sm">
                    <div>
                      <p className="font-medium">{d.documentName}</p>
                      <p className="text-xs text-slate-500">
                        {d.originalFileName} · v{d.version}
                      </p>
                      {d.rejectionRemarks && (
                        <p className="text-xs text-rose-600 mt-0.5">{d.rejectionRemarks}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusText status={d.verificationStatus} />
                      {(d.verificationStatus === 'REJECTED' || d.verificationStatus === 'REUPLOAD_REQUESTED') && (
                        <label className="cursor-pointer px-2.5 py-1 rounded-md bg-[#0863E8] text-white text-xs font-medium">
                          Re-upload
                          <input
                            type="file"
                            accept=".pdf,.jpg,.jpeg,.png"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleDocumentUpload(d.categoryId, file);
                            }}
                          />
                        </label>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Step Progress Navigation */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs text-slate-500">
                  {info.candidateCode} · {info.candidateName}
                </p>
                <h1 className="font-display text-lg font-bold">Pre-Joining Onboarding Wizard</h1>
              </div>
              <div className="flex items-center gap-1.5 p-1 rounded-lg bg-slate-100 dark:bg-slate-900">
                {[
                  { id: 1, label: '1. Personal' },
                  { id: 2, label: '2. Edu & Work' },
                  { id: 3, label: '3. Docs & Bank' },
                  { id: 4, label: '4. Review & Consent' },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStep(tab.id)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                      step === tab.id
                        ? 'bg-white dark:bg-slate-800 text-[#0863E8] dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {step === 1 && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-6 space-y-5">
                <h2 className="font-display text-lg font-bold">Personal &amp; Address Details</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Full Legal Name</label>
                    <input value={personal.fullName} onChange={(e) => setPersonal({ ...personal, fullName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Mobile Number</label>
                    <input value={personal.mobile} onChange={(e) => setPersonal({ ...personal, mobile: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Email Address</label>
                    <input value={personal.email} onChange={(e) => setPersonal({ ...personal, email: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Date of Birth</label>
                    <input type="date" value={personal.dob} onChange={(e) => setPersonal({ ...personal, dob: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Emergency Contact Name</label>
                    <input value={personal.emergencyContactName} onChange={(e) => setPersonal({ ...personal, emergencyContactName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Emergency Contact Phone</label>
                    <input value={personal.emergencyContactPhone} onChange={(e) => setPersonal({ ...personal, emergencyContactPhone: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Current Residential Address</label>
                    <input value={personal.currentAddress} onChange={(e) => setPersonal({ ...personal, currentAddress: e.target.value })} placeholder="House No, Street, Locality" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">City</label>
                      <input value={personal.city} onChange={(e) => setPersonal({ ...personal, city: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">State</label>
                      <input value={personal.state} onChange={(e) => setPersonal({ ...personal, state: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">PIN Code</label>
                      <input value={personal.pincode} onChange={(e) => setPersonal({ ...personal, pincode: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono" />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => saveDraft(1)} disabled={busy} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium">
                    Save Draft
                  </button>
                  <button type="button" onClick={() => saveDraft(2)} disabled={busy} className="px-4 py-2 rounded-lg bg-[#0863E8] text-white text-sm font-medium">
                    Save &amp; Continue
                  </button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-lg font-bold">Education History</h2>
                    <button
                      type="button"
                      onClick={() =>
                        setEducationList([
                          ...educationList,
                          { level: '', institution: '', boardOrUniversity: '', yearOfPassing: '', percentageOrCgpa: '' },
                        ])
                      }
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#0863E8] hover:underline"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Qualification
                    </button>
                  </div>
                  {educationList.map((edu, idx) => (
                    <div key={idx} className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end border-b border-slate-100 dark:border-slate-800 pb-4">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Level</label>
                        <input value={edu.level} onChange={(e) => { const next = [...educationList]; next[idx].level = e.target.value; setEducationList(next); }} placeholder="10th / 12th / B.Tech" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Institution</label>
                        <input value={edu.institution} onChange={(e) => { const next = [...educationList]; next[idx].institution = e.target.value; setEducationList(next); }} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Board / University</label>
                        <input value={edu.boardOrUniversity} onChange={(e) => { const next = [...educationList]; next[idx].boardOrUniversity = e.target.value; setEducationList(next); }} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Passing Year &amp; %</label>
                        <input value={edu.yearOfPassing} onChange={(e) => { const next = [...educationList]; next[idx].yearOfPassing = e.target.value; setEducationList(next); }} placeholder="2018 · 84%" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                      </div>
                      <div className="flex justify-end">
                        {educationList.length > 1 && (
                          <button type="button" onClick={() => setEducationList(educationList.filter((_, i) => i !== idx))} className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-lg font-bold">Previous Employment</h2>
                    <button
                      type="button"
                      onClick={() =>
                        setEmploymentList([
                          ...employmentList,
                          { companyName: '', designation: '', startDate: '', endDate: '', lastCtc: '', reasonForLeaving: '' },
                        ])
                      }
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#0863E8] hover:underline"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Employer
                    </button>
                  </div>
                  {employmentList.map((emp, idx) => (
                    <div key={idx} className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end border-b border-slate-100 dark:border-slate-800 pb-4">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Company Name</label>
                        <input value={emp.companyName} onChange={(e) => { const next = [...employmentList]; next[idx].companyName = e.target.value; setEmploymentList(next); }} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Designation</label>
                        <input value={emp.designation} onChange={(e) => { const next = [...employmentList]; next[idx].designation = e.target.value; setEmploymentList(next); }} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Start Date</label>
                        <input type="date" value={emp.startDate} onChange={(e) => { const next = [...employmentList]; next[idx].startDate = e.target.value; setEmploymentList(next); }} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Last CTC</label>
                        <input value={emp.lastCtc} onChange={(e) => { const next = [...employmentList]; next[idx].lastCtc = e.target.value; setEmploymentList(next); }} placeholder="₹14 LPA" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                      </div>
                      <div className="flex justify-end">
                        {employmentList.length > 1 && (
                          <button type="button" onClick={() => setEmploymentList(employmentList.filter((_, i) => i !== idx))} className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-lg">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-between">
                  <button type="button" onClick={() => setStep(1)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium">
                    Previous
                  </button>
                  <button type="button" onClick={() => saveDraft(3)} disabled={busy} className="px-4 py-2 rounded-lg bg-[#0863E8] text-white text-sm font-medium">
                    Save &amp; Proceed to Documents
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6">
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-6 space-y-4">
                  <h2 className="font-display text-lg font-bold">Payroll &amp; Banking Details</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Account Holder Name</label>
                      <input value={banking.accountHolderName} onChange={(e) => setBanking({ ...banking, accountHolderName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Bank Name</label>
                      <input value={banking.bankName} onChange={(e) => setBanking({ ...banking, bankName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Account Number</label>
                      <input value={banking.accountNumber} onChange={(e) => setBanking({ ...banking, accountNumber: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">IFSC Code</label>
                      <input value={banking.ifscCode} onChange={(e) => setBanking({ ...banking, ifscCode: e.target.value.toUpperCase() })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">PAN Number</label>
                      <input value={banking.panNumber} onChange={(e) => setBanking({ ...banking, panNumber: e.target.value.toUpperCase() })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">PF / UAN (If applicable)</label>
                      <input value={banking.uanNumber} onChange={(e) => setBanking({ ...banking, uanNumber: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono" />
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-6 space-y-6">
                  <div>
                    <h2 className="font-display text-lg font-bold">Encrypted Document Vault (PDF, JPG, PNG · Max 10 MB)</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      All uploads are encrypted at rest with AES-256-GCM and accessible only to authorized 9HR India reviewers.
                    </p>
                  </div>

                  {groupedCategories.map(({ group, items }) =>
                    items.length > 0 ? (
                      <div key={group} className="space-y-3">
                        <h3 className="text-xs font-semibold tracking-wide text-slate-500 border-b border-slate-100 dark:border-slate-800 pb-1.5">
                          {group} DOCUMENTS
                        </h3>
                        <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
                          {items.map((cat) => {
                            const existing = latestDocForCategory(cat.id);
                            return (
                              <div key={cat.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                                    {cat.name}{' '}
                                    <span className="text-xs text-slate-500">
                                      · {cat.isRequired ? 'Mandatory' : 'Optional'}
                                    </span>
                                  </p>
                                  {cat.legalNote && (
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{cat.legalNote}</p>
                                  )}
                                  {existing && (
                                    <div className="mt-1.5 flex items-center gap-3 text-xs">
                                      <span className="font-mono text-slate-600 dark:text-slate-300">
                                        {existing.originalFileName} (v{existing.version})
                                      </span>
                                      <StatusText status={existing.verificationStatus} />
                                    </div>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  {existing && (
                                    <button
                                      type="button"
                                      onClick={() => handlePreviewDoc(existing.id)}
                                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                                    >
                                      <Eye className="w-3.5 h-3.5" /> View
                                    </button>
                                  )}
                                  <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0863E8] hover:bg-[#0652c2] text-white text-xs font-medium transition-colors">
                                    <FileUp className="w-3.5 h-3.5" />
                                    {uploadingCatId === cat.id
                                      ? 'Encrypting...'
                                      : existing
                                        ? 'Upload New Version'
                                        : 'Upload File'}
                                    <input
                                      type="file"
                                      accept=".pdf,.jpg,.jpeg,.png"
                                      className="hidden"
                                      onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) handleDocumentUpload(cat.id, file);
                                        e.target.value = '';
                                      }}
                                    />
                                  </label>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null,
                  )}
                </div>

                <div className="flex justify-between">
                  <button type="button" onClick={() => setStep(2)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium">
                    Previous
                  </button>
                  <button type="button" onClick={() => saveDraft(4)} disabled={busy} className="px-4 py-2 rounded-lg bg-[#0863E8] text-white text-sm font-medium">
                    Review &amp; Finalize
                  </button>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-6 space-y-5">
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="w-6 h-6 text-[#079B35]" />
                  <h2 className="font-display text-xl font-bold">Review &amp; DPDP Consent Declaration</h2>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm border-y border-slate-200 dark:border-slate-800 py-4">
                  <div>
                    <p className="text-xs text-slate-500">Candidate Name</p>
                    <p className="font-medium">{personal.fullName}</p>
                    <p className="text-xs text-slate-500 mt-2">Email &amp; Mobile</p>
                    <p className="font-medium">{personal.email} · {personal.mobile}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Documents Uploaded</p>
                    <p className="font-mono font-semibold tabular-nums">{documents.length} Encrypted File(s)</p>
                    <p className="text-xs text-slate-500 mt-2">Mandatory Categories</p>
                    <p className="font-medium">
                      {categories.filter((c) => c.isRequired && !latestDocForCategory(c.id)).length === 0
                        ? 'All Mandatory Documents Attached'
                        : `${categories.filter((c) => c.isRequired && !latestDocForCategory(c.id)).length} Mandatory Document(s) Missing`}
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-4 text-xs text-slate-600 dark:text-slate-300 space-y-2 leading-relaxed">
                  <p className="font-semibold text-slate-900 dark:text-white">
                    Digital Personal Data Protection (DPDP) Act Privacy Notice &amp; Consent
                  </p>
                  <p>
                    I hereby authorize 9HR India Private Limited to collect, store securely, and verify the personal,
                    academic, employment, banking, and identity records provided in this onboarding portal solely for
                    employment verification, payroll onboarding, and statutory compliance. I confirm that all uploaded
                    documents are genuine and accurate.
                  </p>
                </div>

                <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={consentAccepted}
                    onChange={(e) => setConsentAccepted(e.target.checked)}
                    className="mt-1 rounded border-slate-300 text-[#0863E8]"
                  />
                  <span>
                    I accept the DPDP Act Privacy Notice and declare that all submitted details and documents are accurate.
                  </span>
                </label>

                <div className="flex justify-between pt-2">
                  <button type="button" onClick={() => setStep(3)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium">
                    Back to Documents
                  </button>
                  <button
                    type="button"
                    onClick={handleFinalSubmit}
                    disabled={busy || !consentAccepted}
                    className="px-5 py-2.5 rounded-lg bg-[#079B35] hover:bg-[#067e2b] text-white text-sm font-semibold disabled:opacity-50"
                  >
                    {busy ? 'Submitting...' : 'Submit Final Onboarding Application'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
