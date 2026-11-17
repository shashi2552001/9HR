import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  KeyRound,
  Lock,
  Mail,
  Moon,
  ShieldCheck,
  Sun,
  UserCheck,
} from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';
import { ThreeSpatialBackdrop } from '../components/ThreeSpatialBackdrop';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { apiFetch, setSessionToken } from '../lib/api';

type AuthView = 'LOGIN' | '2FA' | 'FORGOT' | 'RESET';

export function LoginPage({ initialResetToken }: { initialResetToken?: string }) {
  const { setupRequired, refreshAuth, signInWithGoogle } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { showToast } = useToast();

  const [view, setView] = useState<AuthView>(initialResetToken ? 'RESET' : 'LOGIN');
  const [busy, setBusy] = useState(false);

  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // 2FA state
  const [challengeToken, setChallengeToken] = useState('');
  const [twoFaMethods, setTwoFaMethods] = useState<string[]>(['TOTP', 'EMAIL_OTP']);
  const [twoFaMethod, setTwoFaMethod] = useState<'TOTP' | 'EMAIL_OTP' | 'BACKUP_CODE'>('TOTP');
  const [twoFaCode, setTwoFaCode] = useState('');
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);

  // Forgot / Reset state
  const [resetToken, setResetToken] = useState(initialResetToken || '');
  const [newPassword, setNewPassword] = useState('');
  const [devResetHint, setDevResetHint] = useState<string | null>(null);

  // Initial Setup state (when DB has 0 users)
  const [setupFullName, setSetupFullName] = useState('');
  const [setupEmail, setSetupEmail] = useState('');
  const [setupPhone, setSetupPhone] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [initSampleData, setInitSampleData] = useState(true);
  const [createTeamAccounts, setCreateTeamAccounts] = useState(true);
  const [teamPassword, setTeamPassword] = useState('');

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiFetch<{
        requires2fa: boolean;
        challengeToken?: string;
        methods?: string[];
        devOtpPreview?: string;
        sessionToken?: string;
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      if (res.requires2fa && res.challengeToken) {
        setChallengeToken(res.challengeToken);
        const methods = res.methods || ['TOTP', 'EMAIL_OTP'];
        setTwoFaMethods(methods);
        setTwoFaMethod(methods.includes('TOTP') ? 'TOTP' : 'EMAIL_OTP');
        setDevOtpHint(res.devOtpPreview || null);
        setView('2FA');
        showToast('Two-Factor Verification Required', 'info');
      } else {
        if (res.sessionToken) setSessionToken(res.sessionToken);
        const authedUser = await refreshAuth();
        if (authedUser) {
          showToast('Welcome to 9HR India Portal', 'success');
        } else {
          showToast('Session could not be verified', 'error', 'Please refresh the page or retry signing in.');
        }
      }
    } catch (err: any) {
      showToast('Sign-In Failed', 'error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handle2faSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiFetch<{ verified: boolean; sessionToken?: string }>('/api/auth/2fa/verify', {
        method: 'POST',
        body: JSON.stringify({ challengeToken, code: twoFaCode, method: twoFaMethod }),
      });
      if (res.sessionToken) setSessionToken(res.sessionToken);
      const authedUser = await refreshAuth();
      if (authedUser) {
        showToast('2FA Verified', 'success');
      } else {
        showToast('Session could not be verified', 'error', 'Please retry signing in.');
      }
    } catch (err: any) {
      showToast('Verification Failed', 'error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSendEmailOtp = async () => {
    setBusy(true);
    try {
      const res = await apiFetch<{ devOtpPreview?: string }>('/api/auth/2fa/send-email-otp', {
        method: 'POST',
        body: JSON.stringify({ challengeToken }),
      });
      setTwoFaMethod('EMAIL_OTP');
      if (res.devOtpPreview) setDevOtpHint(res.devOtpPreview);
      showToast('Verification OTP Issued', 'success', 'Check your registered corporate email.');
    } catch (err: any) {
      showToast('Failed to send OTP', 'error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiFetch<{ message: string; devResetToken?: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      if (res.devResetToken) {
        setDevResetHint(res.devResetToken);
        setResetToken(res.devResetToken);
      }
      showToast('Reset Request Processed', 'success', res.message);
    } catch (err: any) {
      showToast('Request Failed', 'error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: resetToken, newPassword }),
      });
      showToast('Password Updated', 'success', 'You may now sign in with your new password.');
      setView('LOGIN');
      window.history.replaceState({}, '', '/');
    } catch (err: any) {
      showToast('Password Reset Failed', 'error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleInitialSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiFetch<{ sessionToken?: string }>('/api/auth/initial-setup', {
        method: 'POST',
        body: JSON.stringify({
          fullName: setupFullName,
          email: setupEmail,
          phone: setupPhone,
          password: setupPassword,
          initializeSampleData: initSampleData,
          createDemoTeamAccounts: createTeamAccounts,
          demoTeamPassword: createTeamAccounts ? teamPassword : undefined,
        }),
      });
      if (res.sessionToken) setSessionToken(res.sessionToken);
      await refreshAuth();
      showToast('Enterprise Workspace Initialized', 'success');
    } catch (err: any) {
      showToast('Setup Error', 'error', err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setBusy(true);
    try {
      const authedUser = await signInWithGoogle();
      if (authedUser) {
        showToast('Signed in with Google', 'success');
      } else {
        showToast('Session could not be verified', 'error', 'Please retry signing in.');
      }
    } catch (err: any) {
      showToast('Google Sign-In Failed', 'error', err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-slate-50 dark:bg-[#0b1118] transition-colors">
      {/* Left Brand & 3D Architectural Canvas */}
      <div className="relative lg:w-[52%] bg-[#101820] text-white p-8 lg:p-14 flex flex-col justify-between overflow-hidden min-h-[300px] lg:min-h-screen">
        <ThreeSpatialBackdrop className="absolute inset-0 opacity-85" />
        <div className="absolute inset-0 bg-gradient-to-br from-[#0863E8]/20 via-transparent to-[#079B35]/15 pointer-events-none" />

        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-full bg-white p-0.5 shadow-md flex items-center justify-center overflow-hidden">
              <img
                src="/assets/aistudio/image_0ecd2493.png"
                alt="9HR India Private Limited"
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold tracking-tight text-white">
                9HR India Private Limited
              </h1>
              <p className="text-xs text-slate-300">Your Trusted HR Partner · portal.9hrindia.com</p>
            </div>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            className="p-2.5 rounded-xl border border-white/15 bg-white/10 hover:bg-white/20 transition-colors text-white"
            aria-label="Toggle color theme"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        <div className="relative z-10 my-10 lg:my-auto max-w-xl">
          <p className="text-xs font-medium tracking-wide text-[#F4BD16] mb-3">
            Enterprise HRMS · Recruitment · Candidate Onboarding
          </p>
          <h2 className="font-display text-3xl lg:text-5xl font-bold leading-[1.12] text-white [text-wrap:balance]">
            Unified talent lifecycle &amp; encrypted onboarding governance.
          </h2>
          <p className="mt-4 text-sm lg:text-base text-slate-300 leading-relaxed max-w-lg">
            End-to-end recruitment pipelines, role-based operations for Super Admin, HR Admin, and
            Recruiters, and DPDP-compliant candidate document verification.
          </p>

          <div className="mt-8 grid grid-cols-3 gap-4 border-t border-white/10 pt-6">
            <div>
              <p className="font-mono text-xl font-semibold text-white tabular-nums">15 Stages</p>
              <p className="text-xs text-slate-400 mt-0.5">Audited Hiring Pipeline</p>
            </div>
            <div>
              <p className="font-mono text-xl font-semibold text-[#079B35] tabular-nums">AES-256</p>
              <p className="text-xs text-slate-400 mt-0.5">Encrypted Vault</p>
            </div>
            <div>
              <p className="font-mono text-xl font-semibold text-[#F4BD16] tabular-nums">TOTP + OTP</p>
              <p className="text-xs text-slate-400 mt-0.5">Zero-Trust Access</p>
            </div>
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-between text-xs text-slate-400">
          <span>9HR India Private Limited</span>
          <span>https://9hrindia.com</span>
        </div>
      </div>

      {/* Right Authentication / Setup Panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 lg:p-16">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-7 sm:p-8 shadow-xl"
        >
          {setupRequired ? (
            <form onSubmit={handleInitialSetup} className="space-y-4">
              <div className="flex items-center justify-between">
                <BrandLogo size="sm" subtitle="Initial Enterprise Setup" />
              </div>
              <div>
                <h3 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                  Provision Super Admin Account
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Create the primary Super Admin credentials to initialize the 9HR India database.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Full Name
                  </label>
                  <input
                    required
                    value={setupFullName}
                    onChange={(e) => setSetupFullName(e.target.value)}
                    placeholder="e.g. Vikram Singhania"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0863E8]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Corporate Email
                  </label>
                  <input
                    required
                    type="email"
                    value={setupEmail}
                    onChange={(e) => setSetupEmail(e.target.value)}
                    placeholder="superadmin@9hrindia.com"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0863E8]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Mobile Number (Optional)
                  </label>
                  <input
                    value={setupPhone}
                    onChange={(e) => setSetupPhone(e.target.value)}
                    placeholder="+91 98200 10001"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0863E8]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Super Admin Password (min 8 chars)
                  </label>
                  <input
                    required
                    type="password"
                    minLength={8}
                    value={setupPassword}
                    onChange={(e) => setSetupPassword(e.target.value)}
                    placeholder="Strong passphrase"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0863E8]"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2.5 bg-slate-50 dark:bg-slate-900/50">
                <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={initSampleData}
                    onChange={(e) => setInitSampleData(e.target.checked)}
                    className="rounded border-slate-300 text-[#0863E8]"
                  />
                  Populate sample jobs, candidates, interviews &amp; onboarding workflow
                </label>
                <label className="flex items-center gap-2.5 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createTeamAccounts}
                    onChange={(e) => setCreateTeamAccounts(e.target.checked)}
                    className="rounded border-slate-300 text-[#0863E8]"
                  />
                  Also provision Admin (`admin@9hrindia.com`) &amp; Recruiter (`recruiter@9hrindia.com`)
                </label>
                {createTeamAccounts && (
                  <input
                    required
                    type="password"
                    minLength={8}
                    value={teamPassword}
                    onChange={(e) => setTeamPassword(e.target.value)}
                    placeholder="Password for Admin & Recruiter accounts (min 8 chars)"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs"
                  />
                )}
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 px-4 rounded-lg bg-[#0863E8] hover:bg-[#0652c2] text-white font-medium text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
              >
                {busy ? 'Provisioning...' : 'Initialize Enterprise Portal'}
                <ArrowRight className="w-4 h-4" />
              </button>

              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200 dark:border-slate-800" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white dark:bg-[#101820] px-2 text-slate-500">or</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={busy}
                className="w-full py-2.5 px-4 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 font-medium text-sm transition-colors"
              >
                Sign in with Google Workspace
              </button>
            </form>
          ) : view === 'LOGIN' ? (
            <div className="space-y-5">
              <div>
                <h3 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
                  Sign in to 9HR Portal
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Authorized internal access for Super Admin, HR Admin &amp; Recruiters.
                </p>
              </div>

              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Corporate Email Address
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      required
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@9hrindia.com"
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0863E8]"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => setView('FORGOT')}
                      className="text-xs font-medium text-[#0863E8] hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      required
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0863E8]"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#0863E8] hover:bg-[#0652c2] text-white font-medium text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                >
                  {busy ? 'Authenticating...' : 'Sign In'}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200 dark:border-slate-800" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white dark:bg-[#101820] px-2.5 text-slate-500">
                    Single Sign-On
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={busy}
                className="w-full py-2.5 px-4 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/70 text-slate-800 dark:text-slate-100 font-medium text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <UserCheck className="w-4 h-4 text-[#0863E8]" />
                Continue with Google Workspace
              </button>
            </div>
          ) : view === '2FA' ? (
            <form onSubmit={handle2faSubmit} className="space-y-4">
              <div className="flex items-center gap-2.5 text-[#0863E8]">
                <ShieldCheck className="w-6 h-6" />
                <h3 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                  Two-Factor Verification
                </h3>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Verify your identity using Google/Microsoft Authenticator, Email OTP, or a Backup Recovery Code.
              </p>

              <div className="flex gap-1.5 p-1 rounded-lg bg-slate-100 dark:bg-slate-900">
                {twoFaMethods.includes('TOTP') && (
                  <button
                    type="button"
                    onClick={() => setTwoFaMethod('TOTP')}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      twoFaMethod === 'TOTP'
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-500'
                    }`}
                  >
                    Authenticator
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSendEmailOtp}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    twoFaMethod === 'EMAIL_OTP'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-500'
                  }`}
                >
                  Email OTP
                </button>
                {twoFaMethods.includes('BACKUP_CODE') && (
                  <button
                    type="button"
                    onClick={() => setTwoFaMethod('BACKUP_CODE')}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      twoFaMethod === 'BACKUP_CODE'
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-500'
                    }`}
                  >
                    Recovery Code
                  </button>
                )}
              </div>

              {devOtpHint && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-2.5 text-xs text-amber-800 dark:text-amber-300">
                  SMTP not configured in preview · Verification OTP: <span className="font-mono font-bold">{devOtpHint}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {twoFaMethod === 'BACKUP_CODE' ? '8-Character Recovery Code' : '6-Digit Verification Code'}
                </label>
                <input
                  required
                  value={twoFaCode}
                  onChange={(e) => setTwoFaCode(e.target.value)}
                  placeholder={twoFaMethod === 'BACKUP_CODE' ? 'ABCD1234' : '000000'}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 font-mono text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-[#0863E8]"
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 px-4 rounded-lg bg-[#0863E8] hover:bg-[#0652c2] text-white font-medium text-sm"
              >
                {busy ? 'Verifying...' : 'Verify & Continue'}
              </button>
              <button
                type="button"
                onClick={() => setView('LOGIN')}
                className="w-full text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              >
                Back to Sign In
              </button>
            </form>
          ) : view === 'FORGOT' ? (
            <form onSubmit={handleForgotSubmit} className="space-y-4">
              <div className="flex items-center gap-2 text-[#0863E8]">
                <KeyRound className="w-5 h-5" />
                <h3 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                  Reset Password
                </h3>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Enter your registered 9HR India email address to receive an expiring reset token.
              </p>
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@9hrindia.com"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              />
              {devResetHint && (
                <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-3 text-xs space-y-2">
                  <p className="text-blue-900 dark:text-blue-200">
                    SMTP not configured in preview. Generated reset token:
                  </p>
                  <code className="block font-mono text-[11px] break-all text-[#0863E8]">{devResetHint}</code>
                  <button
                    type="button"
                    onClick={() => setView('RESET')}
                    className="text-xs font-semibold text-[#0863E8] underline"
                  >
                    Proceed to Reset Password
                  </button>
                </div>
              )}
              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 px-4 rounded-lg bg-[#0863E8] hover:bg-[#0652c2] text-white font-medium text-sm"
              >
                {busy ? 'Processing...' : 'Send Reset Link'}
              </button>
              <button
                type="button"
                onClick={() => setView('LOGIN')}
                className="w-full text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              >
                Back to Sign In
              </button>
            </form>
          ) : (
            <form onSubmit={handleResetSubmit} className="space-y-4">
              <h3 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                Set New Password
              </h3>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Reset Token
                </label>
                <input
                  required
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  New Password (min 8 chars)
                </label>
                <input
                  required
                  type="password"
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full py-2.5 px-4 rounded-lg bg-[#0863E8] hover:bg-[#0652c2] text-white font-medium text-sm"
              >
                {busy ? 'Updating...' : 'Confirm New Password'}
              </button>
              <button
                type="button"
                onClick={() => setView('LOGIN')}
                className="w-full text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              >
                Return to Sign In
              </button>
            </form>
          )}
        </motion.div>
      </div>
    </div>
  );
}
