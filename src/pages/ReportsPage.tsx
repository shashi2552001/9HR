import React, { useCallback, useEffect, useState } from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/api';
import { exportRowsToCsv, exportRowsToExcel, exportRowsToPdf } from '../lib/exportUtils';
import { TableSkeleton } from '../components/Skeletons';

const REPORT_CATALOG = [
  { key: 'candidate-master', label: '1. Candidate Master Report', minRole: 'RECRUITER' },
  { key: 'recruiter-performance', label: '2. Recruiter Performance Report', minRole: 'RECRUITER' },
  { key: 'job-opening', label: '3. Job Opening Report', minRole: 'RECRUITER' },
  { key: 'interview', label: '4. Interview Report', minRole: 'RECRUITER' },
  { key: 'selection', label: '5. Selection Report', minRole: 'RECRUITER' },
  { key: 'offer-management', label: '6. Offer Management Report', minRole: 'RECRUITER' },
  { key: 'joining', label: '7. Joining Report', minRole: 'RECRUITER' },
  { key: 'onboarding-status', label: '8. Onboarding Status Report', minRole: 'RECRUITER' },
  { key: 'document-verification', label: '9. Document Verification Report', minRole: 'RECRUITER' },
  { key: 'pending-documents', label: '10. Pending Documents Report', minRole: 'RECRUITER' },
  { key: 'recruiter-activity', label: '11. Recruiter Activity Report', minRole: 'ADMIN' },
  { key: 'audit-trail', label: '12. Audit Trail Report', minRole: 'SUPER_ADMIN' },
];

export function ReportsPage() {
  const { user } = useAuth();
  const { showToast } = useToast();

  const visibleReports = REPORT_CATALOG.filter((r) => {
    if (user?.roleName === 'SUPER_ADMIN') return true;
    if (user?.roleName === 'ADMIN') return r.minRole !== 'SUPER_ADMIN';
    return r.minRole === 'RECRUITER';
  });

  const [activeKey, setActiveKey] = useState(visibleReports[0]?.key || 'candidate-master');
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<{ title: string; columns: string[]; rows: any[]; generatedAt: string } | null>(null);

  const loadReport = useCallback(async (key: string) => {
    setLoading(true);
    try {
      const res = await apiFetch<any>(`/api/reports/${key}`);
      setReport(res);
    } catch (err: any) {
      showToast('Report Failed', 'error', err.message);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadReport(activeKey);
  }, [activeKey, loadReport]);

  const safeSlug = `9HR_${activeKey}_${new Date().toISOString().slice(0, 10)}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Enterprise Reports &amp; Exports
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Live database reports with role-enforced field visibility and Excel, CSV &amp; PDF exports
          </p>
        </div>

        {report && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => exportRowsToExcel(safeSlug, report.title, report.columns, report.rows)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#079B35] hover:bg-[#067e2b] text-white text-xs font-semibold"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" /> Excel (.xlsx)
            </button>
            <button
              type="button"
              onClick={() => exportRowsToCsv(safeSlug, report.columns, report.rows)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#101820] text-xs font-semibold"
            >
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
            <button
              type="button"
              onClick={() => exportRowsToPdf(safeSlug, report.title, report.columns, report.rows)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0863E8] hover:bg-[#0652c2] text-white text-xs font-semibold"
            >
              <FileText className="w-3.5 h-3.5" /> PDF
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-2 space-y-1 h-fit">
          {visibleReports.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setActiveKey(r.key)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                activeKey === r.key
                  ? 'bg-[#0863E8] text-white'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="lg:col-span-3 space-y-3">
          {loading || !report ? (
            <TableSkeleton rows={6} cols={5} />
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <h2 className="font-display text-base font-bold">{report.title}</h2>
                  <p className="text-xs text-slate-500 font-mono tabular-nums">
                    {report.rows.length} record(s) · Generated {new Date(report.generatedAt).toLocaleString('en-IN')}
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 text-slate-500">
                      {report.columns.map((col) => (
                        <th key={col} className="text-left px-4 py-2.5 font-semibold whitespace-nowrap">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                    {report.rows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                        {report.columns.map((col) => (
                          <td key={col} className="px-4 py-2.5 whitespace-nowrap tabular-nums">
                            {String(row[col] ?? '—')}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {report.rows.length === 0 && (
                      <tr>
                        <td colSpan={report.columns.length} className="px-4 py-10 text-center text-slate-500">
                          No records found for this report.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
