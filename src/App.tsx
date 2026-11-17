import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';
import { LoginPage } from './pages/LoginPage';
import { PublicOnboardingPage } from './pages/PublicOnboardingPage';
import { AppShell } from './components/AppShell';
import { DashboardPage } from './pages/DashboardPage';
import { CandidatesPage } from './pages/CandidatesPage';
import { PipelinePage } from './pages/PipelinePage';
import { JobsPage } from './pages/JobsPage';
import { InterviewsOffersPage } from './pages/InterviewsOffersPage';
import { OnboardingOpsPage } from './pages/OnboardingOpsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SecurityAccountPage } from './pages/SecurityAccountPage';
import { AdminGovernancePage } from './pages/AdminGovernancePage';

function PortalRouter() {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState('dashboard');

  const path = window.location.pathname;
  const onboardingMatch = path.match(/^\/onboarding\/([a-zA-Z0-9_-]+)/);
  if (onboardingMatch) {
    return <PublicOnboardingPage token={onboardingMatch[1]} />;
  }

  const resetToken =
    path === '/reset-password'
      ? new URLSearchParams(window.location.search).get('token') || undefined
      : undefined;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0b1118]">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-full border-2 border-[#0863E8] border-t-transparent animate-spin mx-auto" />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
            Loading 9HR India Enterprise Portal...
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage initialResetToken={resetToken} />;
  }

  return (
    <AppShell activeTab={activeTab} onSelectTab={setActiveTab}>
      {activeTab === 'dashboard' && <DashboardPage onNavigate={setActiveTab} />}
      {activeTab === 'candidates' && <CandidatesPage />}
      {activeTab === 'pipeline' && <PipelinePage />}
      {activeTab === 'jobs' && <JobsPage />}
      {activeTab === 'interviews' && <InterviewsOffersPage />}
      {activeTab === 'onboarding' && <OnboardingOpsPage />}
      {activeTab === 'reports' && <ReportsPage />}
      {activeTab === 'governance' && user.roleName !== 'RECRUITER' && <AdminGovernancePage />}
      {activeTab === 'security' && <SecurityAccountPage />}
    </AppShell>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <PortalRouter />
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
