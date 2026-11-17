import React from 'react';
import { CheckCircle2, Clock, AlertTriangle, XCircle, CircleDot } from 'lucide-react';

export function StatusText({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  const label = normalized.replace(/_/g, ' ');

  if (['JOINED', 'APPROVED', 'ACCEPTED', 'SELECTED', 'COMPLETED', 'DOCUMENTS_VERIFIED', 'OPEN', 'CONNECTED'].includes(normalized)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#079B35] dark:text-emerald-400 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
        {label}
      </span>
    );
  }
  if (['REJECTED', 'DECLINED', 'REVOKED', 'EXPIRED', 'CLOSED'].includes(normalized)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 whitespace-nowrap">
        <XCircle className="w-3.5 h-3.5 shrink-0" />
        {label}
      </span>
    );
  }
  if (
    ['PENDING', 'ONBOARDING_PENDING', 'REUPLOAD_REQUESTED', 'INTERVIEW_SCHEDULED', 'OFFER_RELEASED', 'PAUSED', 'ON_HOLD'].includes(
      normalized,
    )
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-[#F4BD16] whitespace-nowrap">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        {label}
      </span>
    );
  }
  if (['CANDIDATE_WITHDRAWN', 'CHANGES_REQUESTED'].includes(normalized)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 whitespace-nowrap">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        {label}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0863E8] dark:text-blue-400 whitespace-nowrap">
      <CircleDot className="w-3.5 h-3.5 shrink-0" />
      {label}
    </span>
  );
}
