import React, { useCallback, useEffect, useState } from 'react';
import { Laptop, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/api';
import { StatusText } from '../components/StatusText';

export function SecurityAccountPage() {
  const { user, refreshAuth } = useAuth();
  const { showToast } = useToast();

  const [sessions, setSessions] = useState<any[]>([]);
  const [qrData, setQrData] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const scope = user?.roleName === 'SUPER_ADMIN' ? '?scope=all' : '';
      const res = await apiFetch<{ sessions: any[] }>(`/api/auth/sessions${scope}`);
      setSessions(res.sessions || []);
    } catch (err: any) {
      showToast('Failed to load sessions', 'error', err.message);
    }
  }, [user?.roleName, showToast]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const start2faSetup = async () => {
    try {
      const res = await apiFetch<{ secret: string; qrDataUrl: string }>('/api/auth/2fa/setup', {
        method: 'POST',
      });
      setQrData(res);
    } catch (err: any) {
      showToast('2FA Setup Error', 'error', err.message);
    }
  };

  const confirm2faEnable = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ recoveryCodes: string[] }>('/api/auth/2fa/enable', {
        method: 'POST',
        body: JSON.stringify({ code: totpCode }),
      });
      setRecoveryCodes(res.recoveryCodes);
      setQrData(null);
      setTotpCode('');
      await refreshAuth();
      showToast('TOTP 2FA Enabled', 'success');
    } catch (err: any) {
      showToast('Verification Failed', 'error', err.message);
    }
  };

  const disable2fa = async () => {
    try {
      await apiFetch('/api/auth/2fa/disable', { method: 'POST' });
      setRecoveryCodes(null);
      await refreshAuth();
      showToast('2FA Disabled', 'info');
    } catch (err: any) {
      showToast('Action Blocked', 'error', err.message);
    }
  };

  const revokeSession = async (id: number) => {
    try {
      await apiFetch(`/api/auth/sessions/${id}`, { method: 'DELETE' });
      showToast('Session Revoked', 'info');
      loadSessions();
    } catch (err: any) {
      showToast('Failed to revoke session', 'error', err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
          Account Security, 2FA &amp; Active Sessions
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Configure Google/Microsoft Authenticator TOTP 2FA, backup codes, and monitor device sessions
        </p>
      </div>

      {/* 2FA Card */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            {user?.twoFactorEnabled ? (
              <ShieldCheck className="w-7 h-7 text-[#079B35] shrink-0" />
            ) : (
              <ShieldAlert className="w-7 h-7 text-amber-500 shrink-0" />
            )}
            <div>
              <h2 className="font-display text-lg font-bold">
                Two-Factor Authentication (TOTP)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {user?.twoFactorEnabled
                  ? `Active · ${user.backupCodesRemaining} backup recovery code(s) remaining`
                  : 'Not enrolled yet. Recommended for Google Authenticator or Microsoft Authenticator.'}
              </p>
            </div>
          </div>

          {!user?.twoFactorEnabled ? (
            <button
              type="button"
              onClick={start2faSetup}
              className="px-4 py-2 rounded-lg bg-[#0863E8] text-white text-xs font-semibold whitespace-nowrap"
            >
              Enable Authenticator 2FA
            </button>
          ) : (
            <button
              type="button"
              onClick={disable2fa}
              className="px-4 py-2 rounded-lg border border-rose-300 text-rose-600 text-xs font-semibold whitespace-nowrap"
            >
              Disable 2FA
            </button>
          )}
        </div>

        {qrData && (
          <div className="border-t border-slate-200 dark:border-slate-800 pt-5 grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
            <div className="flex flex-col items-center p-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <img src={qrData.qrDataUrl} alt="2FA Authenticator QR Code" className="w-44 h-44 rounded-lg bg-white p-2" />
              <p className="text-[11px] font-mono text-slate-500 mt-2 select-all">
                Manual Key: {qrData.secret}
              </p>
            </div>
            <form onSubmit={confirm2faEnable} className="space-y-3">
              <p className="text-sm font-medium">
                1. Scan the QR code with Google Authenticator or Microsoft Authenticator.
              </p>
              <p className="text-xs text-slate-500">
                2. Enter the 6-digit code shown in your app to verify and generate backup recovery codes.
              </p>
              <input
                required
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder="000000"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 font-mono text-center text-lg tracking-widest"
              />
              <button type="submit" className="w-full py-2 rounded-lg bg-[#079B35] text-white text-xs font-semibold">
                Verify &amp; Activate 2FA
              </button>
            </form>
          </div>
        )}

        {recoveryCodes && (
          <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-4 space-y-2">
            <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
              Save Your One-Time Backup Recovery Codes Securely
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs">
              {recoveryCodes.map((c) => (
                <div key={c} className="bg-white dark:bg-slate-900 px-2.5 py-1.5 rounded border border-amber-200 dark:border-amber-800 text-center">
                  {c}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Active Sessions Table */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <Laptop className="w-5 h-5 text-[#0863E8]" />
          <h2 className="font-display text-base font-bold">
            {user?.roleName === 'SUPER_ADMIN' ? 'Organization Login Sessions' : 'My Active Devices & Sessions'}
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 text-slate-500">
                {user?.roleName === 'SUPER_ADMIN' && <th className="text-left px-4 py-2.5">User</th>}
                <th className="text-left px-4 py-2.5">Device</th>
                <th className="text-left px-4 py-2.5">IP Address</th>
                <th className="text-left px-4 py-2.5">Last Active</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-right px-4 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {sessions.map((s) => (
                <tr key={s.id}>
                  {user?.roleName === 'SUPER_ADMIN' && (
                    <td className="px-4 py-2.5 font-medium">{s.userName} ({s.userEmail})</td>
                  )}
                  <td className="px-4 py-2.5 font-medium">
                    {s.deviceInfo} {s.isCurrent ? '· Current' : ''}
                  </td>
                  <td className="px-4 py-2.5 font-mono">{s.ipAddress}</td>
                  <td className="px-4 py-2.5 font-mono tabular-nums">
                    {new Date(s.lastActiveAt).toLocaleString('en-IN')}
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusText status={s.isActive ? 'OPEN' : 'REVOKED'} />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {s.isActive && !s.isCurrent && (
                      <button
                        type="button"
                        onClick={() => revokeSession(s.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-rose-300 text-rose-600 font-medium"
                      >
                        <Trash2 className="w-3 h-3" /> Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
