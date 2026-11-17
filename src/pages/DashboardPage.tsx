import React, { useCallback, useEffect, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/api';
import { MetricsSkeleton } from '../components/Skeletons';
import { exportRowsToCsv } from '../lib/exportUtils';

const CHART_COLORS = ['#0863E8', '#079B35', '#F4BD16', '#101820', '#64748b'];

export function DashboardPage({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [data, setData] = useState<any>(null);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (fromDate) qs.set('fromDate', fromDate);
      if (toDate) qs.set('toDate', toDate);
      const res = await apiFetch(`/api/analytics/dashboard?${qs.toString()}`);
      setData(res);
    } catch (err: any) {
      showToast('Analytics Load Error', 'error', err.message);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, showToast]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  const m = data?.metrics || {};
  const charts = data?.charts || {};

  const kpiCards =
    user?.roleName === 'RECRUITER'
      ? [
          { label: 'My Candidates', value: m.totalCandidates ?? 0, sub: `${m.screened ?? 0} screened · ${m.shortlisted ?? 0} shortlisted` },
          { label: 'Interviews Scheduled', value: m.interviewsScheduled ?? 0, sub: `${m.selected ?? 0} selected · ${m.conversionRate ?? 0}% conv.` },
          { label: 'Offers & Accepted', value: `${m.offersReleased ?? 0} / ${m.offersAccepted ?? 0}`, sub: `${m.joined ?? 0} candidates joined` },
          { label: 'Onboarding & Docs Pending', value: `${m.onboardingPending ?? 0} / ${m.documentsPendingVerification ?? 0}`, sub: 'Active onboarding trackers' },
        ]
      : [
          { label: 'Total Candidates', value: m.totalCandidates ?? 0, sub: `${m.activeJobs ?? 0} active job openings` },
          { label: 'Active / Total Recruiters', value: `${m.activeRecruiters ?? 0} / ${m.totalRecruiters ?? 0}`, sub: `${m.inactiveRecruiters ?? 0} inactive` },
          { label: 'Selections & Placements', value: `${m.selected ?? 0} / ${m.joined ?? 0}`, sub: `${m.conversionRate ?? 0}% pipeline conversion` },
          { label: 'Pending Onboarding & Docs', value: `${m.onboardingPending ?? 0} / ${m.documentsPendingVerification ?? 0}`, sub: `${m.interviewsScheduled ?? 0} interviews scheduled` },
        ];

  const handleExportSummary = () => {
    const rows = [
      { Metric: 'Total Candidates', Value: m.totalCandidates ?? 0 },
      { Metric: 'Screened & Shortlisted', Value: m.screened ?? 0 },
      { Metric: 'Interviews Scheduled', Value: m.interviewsScheduled ?? 0 },
      { Metric: 'Candidates Selected', Value: m.selected ?? 0 },
      { Metric: 'Offers Released', Value: m.offersReleased ?? 0 },
      { Metric: 'Offers Accepted', Value: m.offersAccepted ?? 0 },
      { Metric: 'Candidates Joined', Value: m.joined ?? 0 },
      { Metric: 'Onboarding Pending', Value: m.onboardingPending ?? 0 },
      { Metric: 'Documents Pending Verification', Value: m.documentsPendingVerification ?? 0 },
      { Metric: 'Conversion Rate (%)', Value: m.conversionRate ?? 0 },
    ];
    exportRowsToCsv('9HR_Dashboard_Metrics', ['Metric', 'Value'], rows);
    showToast('Dashboard Metrics Exported', 'success');
  };

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            {user?.roleName === 'SUPER_ADMIN'
              ? 'Enterprise Governance & Analytics'
              : user?.roleName === 'ADMIN'
                ? 'Recruitment Operations Overview'
                : 'Recruiter Performance Workspace'}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Real-time metrics · {user?.roleDisplayName} · {user?.email}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="Filter from date"
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#101820] px-2.5 py-1.5 text-xs"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="Filter to date"
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#101820] px-2.5 py-1.5 text-xs"
          />
          <button
            type="button"
            onClick={loadAnalytics}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#101820] text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <button
            type="button"
            onClick={handleExportSummary}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0863E8] hover:bg-[#0652c2] text-white text-xs font-medium whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      {loading ? (
        <MetricsSkeleton />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpiCards.map((card, idx) => (
            <div
              key={idx}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-5 transition-transform duration-150 hover:-translate-y-0.5"
            >
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{card.label}</p>
              <p className="font-mono text-3xl font-bold text-slate-900 dark:text-white mt-2 tabular-nums">
                {card.value}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">{card.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Interactive Analytics Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-base font-bold">7-Day Recruitment Activity</h2>
              <p className="text-xs text-slate-500">Daily candidate additions, scheduled interviews &amp; joinings</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('candidates')}
              className="text-xs font-medium text-[#0863E8] hover:underline"
            >
              Open Candidates
            </button>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={charts.activitySeries || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Area type="monotone" dataKey="added" name="Candidates Added" stroke="#0863E8" fill="#0863E8" fillOpacity={0.18} />
                <Area type="monotone" dataKey="interviews" name="Interviews" stroke="#F4BD16" fill="#F4BD16" fillOpacity={0.18} />
                <Area type="monotone" dataKey="joined" name="Joined" stroke="#079B35" fill="#079B35" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-5">
          <h2 className="font-display text-base font-bold">Candidate Source Mix</h2>
          <p className="text-xs text-slate-500 mb-4">Acquisition channel distribution</p>
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={charts.sourceChart || []}
                  dataKey="count"
                  nameKey="source"
                  innerRadius={45}
                  outerRadius={78}
                  paddingAngle={3}
                >
                  {(charts.sourceChart || []).map((_: any, i: number) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 space-y-1">
            {(charts.sourceChart || []).map((s: any, i: number) => (
              <div key={s.source} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-xs" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                  {s.source}
                </span>
                <span className="font-mono font-semibold tabular-nums">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pipeline & Job Progress */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-bold">Pipeline Stage Breakdown</h2>
            <button
              type="button"
              onClick={() => onNavigate('pipeline')}
              className="text-xs font-medium text-[#0863E8] hover:underline"
            >
              View 15-Stage Board
            </button>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={charts.pipelineChart || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} />
                <XAxis dataKey="stage" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" height={50} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" name="Candidates" fill="#0863E8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-base font-bold">Recruiter Productivity &amp; Targets</h2>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="text-xs font-medium text-[#0863E8] hover:underline"
            >
              Detailed Reports
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                  <th className="text-left py-2 font-medium">Recruiter</th>
                  <th className="text-right py-2 font-medium">Assigned</th>
                  <th className="text-right py-2 font-medium">Active</th>
                  <th className="text-right py-2 font-medium">Joined</th>
                  <th className="text-right py-2 font-medium">Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {(charts.recruiterPerformance || []).map((rec: any) => (
                  <tr key={rec.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 font-medium">{rec.name}</td>
                    <td className="py-2.5 text-right font-mono tabular-nums">{rec.candidates}</td>
                    <td className="py-2.5 text-right font-mono tabular-nums">{rec.activePipeline}</td>
                    <td className="py-2.5 text-right font-mono font-semibold text-[#079B35] tabular-nums">{rec.hires}</td>
                    <td className="py-2.5 text-right font-mono text-slate-500 tabular-nums">{rec.target}</td>
                  </tr>
                ))}
                {(!charts.recruiterPerformance || charts.recruiterPerformance.length === 0) && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-xs text-slate-500">
                      No recruiter activity recorded in selected range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Job-Wise Hiring Progress & Quick Onboarding Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-display text-base font-bold">Job-Wise Hiring Progress</h2>
              <p className="text-xs text-slate-500">Vacancies vs. active applicants &amp; completed joinings</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('jobs')}
              className="text-xs font-medium text-[#0863E8] hover:underline"
            >
              Manage Job Openings
            </button>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={charts.jobProgress || []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} />
                <XAxis dataKey="jobCode" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="vacancies" name="Vacancies" fill="#101820" radius={[4, 4, 0, 0]} />
                <Bar dataKey="applicants" name="Applicants" fill="#0863E8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="joined" name="Joined" fill="#079B35" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-5 flex flex-col justify-between space-y-4">
          <div>
            <h2 className="font-display text-base font-bold">Onboarding &amp; Verification Summary</h2>
            <p className="text-xs text-slate-500 mt-0.5">Live pre-joining compliance snapshot</p>
            <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              <div className="py-2.5 flex items-center justify-between">
                <span className="text-slate-500">Active Onboarding Trackers</span>
                <span className="font-mono font-bold tabular-nums">{m.onboardingPending ?? 0}</span>
              </div>
              <div className="py-2.5 flex items-center justify-between">
                <span className="text-slate-500">Docs Pending Verification</span>
                <span className="font-mono font-bold text-[#F4BD16] tabular-nums">{m.documentsPendingVerification ?? 0}</span>
              </div>
              <div className="py-2.5 flex items-center justify-between">
                <span className="text-slate-500">Offers Released / Accepted</span>
                <span className="font-mono font-bold tabular-nums">{m.offersReleased ?? 0} / {m.offersAccepted ?? 0}</span>
              </div>
              <div className="py-2.5 flex items-center justify-between">
                <span className="text-slate-500">Total Joined Hires</span>
                <span className="font-mono font-bold text-[#079B35] tabular-nums">{m.joined ?? 0}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              onClick={() => onNavigate('onboarding')}
              className="flex-1 px-3 py-2 rounded-lg bg-[#0863E8] hover:bg-[#0652c2] text-white text-xs font-semibold whitespace-nowrap"
            >
              Open Onboarding Ops
            </button>
            <button
              type="button"
              onClick={() => onNavigate('interviews')}
              className="flex-1 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              Interviews &amp; Offers
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
