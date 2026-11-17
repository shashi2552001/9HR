import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  FileCog,
  KeyRound,
  Laptop,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Shield,
  Trash2,
  UserCog,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiFetch } from '../lib/api';
import { Modal } from '../components/Modal';
import { StatusText } from '../components/StatusText';

type GovernanceTab = 'USERS' | 'RBAC' | 'DOCS_CONFIG' | 'SETTINGS' | 'SESSIONS' | 'AUDIT' | 'ALERTS' | 'HEALTH';

const SECURITY_ALERT_ACTIONS = new Set([
  'ACCOUNT_LOCKED',
  'FAILED_LOGIN',
  'SESSION_REVOKED',
  'ONBOARDING_LINK_REVOKED',
  'DOCUMENT_REJECTED',
  '2FA_DISABLED',
  'ROLE_PERMISSIONS_UPDATED',
  'USER_DELETED',
  'MISSING_DOCUMENTS_REQUESTED',
  'ONBOARDING_CHANGES_REQUESTED',
]);

export function AdminGovernancePage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const isSuper = user?.roleName === 'SUPER_ADMIN';

  const [tab, setTab] = useState<GovernanceTab>('USERS');
  const [usersList, setUsersList] = useState<any[]>([]);
  const [rolesData, setRolesData] = useState<{ roles: any[]; permissions: any[] }>({ roles: [], permissions: [] });
  const [docCats, setDocCats] = useState<any[]>([]);
  const [settings, setSettings] = useState<any[]>([]);
  const [sessionsList, setSessionsList] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [alertFilter, setAlertFilter] = useState('');
  const [health, setHealth] = useState<any>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [userForm, setUserForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    roleName: 'RECRUITER' as 'SUPER_ADMIN' | 'ADMIN' | 'RECRUITER',
    department: 'Talent Acquisition',
    specialization: 'Full-Cycle Hiring',
    targetMonthlyHires: 6,
  });

  const [editUserTarget, setEditUserTarget] = useState<any>(null);
  const [editUserForm, setEditUserForm] = useState({
    fullName: '',
    phone: '',
    roleName: 'RECRUITER' as 'SUPER_ADMIN' | 'ADMIN' | 'RECRUITER',
    department: 'Talent Acquisition',
    specialization: 'Full-Cycle Hiring',
    targetMonthlyHires: 6,
    canExportSensitive: false,
  });

  // Create Document Category Modal
  const [catOpen, setCatOpen] = useState(false);
  const [catForm, setCatForm] = useState({
    code: '',
    name: '',
    groupName: 'IDENTITY' as 'IDENTITY' | 'EDUCATION' | 'EMPLOYMENT' | 'BANKING' | 'OTHER',
    isRequired: false,
    allowMasked: false,
    legalNote: '',
  });

  const loadTab = useCallback(async () => {
    try {
      if (tab === 'USERS') {
        const res = await apiFetch('/api/users');
        setUsersList(res.users || []);
      } else if (tab === 'RBAC' && isSuper) {
        const res = await apiFetch('/api/roles');
        setRolesData(res);
      } else if (tab === 'DOCS_CONFIG' && isSuper) {
        const res = await apiFetch('/api/document-categories');
        setDocCats(res.categories || []);
      } else if (tab === 'SETTINGS' && isSuper) {
        const res = await apiFetch('/api/settings');
        setSettings(res.settings || []);
      } else if (tab === 'SESSIONS' && isSuper) {
        const res = await apiFetch('/api/auth/sessions?scope=all');
        setSessionsList(res.sessions || []);
      } else if ((tab === 'AUDIT' || tab === 'ALERTS') && isSuper) {
        const res = await apiFetch('/api/audit-logs');
        setAuditLogs(res.logs || []);
      } else if (tab === 'HEALTH' && isSuper) {
        const res = await apiFetch('/api/system-health');
        setHealth(res.health);
      }
    } catch (err: any) {
      showToast('Governance Load Error', 'error', err.message);
    }
  }, [tab, isSuper, showToast]);

  useEffect(() => {
    loadTab();
  }, [loadTab]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/users', { method: 'POST', body: JSON.stringify(userForm) });
      showToast('User Account Created', 'success');
      setCreateOpen(false);
      setUserForm({
        fullName: '', email: '', phone: '', password: '', roleName: 'RECRUITER',
        department: 'Talent Acquisition', specialization: 'Full-Cycle Hiring', targetMonthlyHires: 6,
      });
      loadTab();
    } catch (err: any) {
      showToast('Create User Failed', 'error', err.message);
    }
  };

  const openEditUser = (u: any) => {
    setEditUserTarget(u);
    setEditUserForm({
      fullName: u.fullName || '',
      phone: u.phone || '',
      roleName: u.roleName || 'RECRUITER',
      department: u.department || 'Talent Acquisition',
      specialization: u.specialization || 'Full-Cycle Hiring',
      targetMonthlyHires: Number(u.targetMonthlyHires) || 6,
      canExportSensitive: Boolean(u.canExportSensitive),
    });
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUserTarget) return;
    try {
      await apiFetch(`/api/users/${editUserTarget.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fullName: editUserForm.fullName,
          phone: editUserForm.phone,
          ...(isSuper ? { roleName: editUserForm.roleName } : {}),
          department: editUserForm.department,
          specialization: editUserForm.specialization,
          targetMonthlyHires: Number(editUserForm.targetMonthlyHires),
          ...(isSuper ? { canExportSensitive: editUserForm.canExportSensitive } : {}),
        }),
      });
      showToast('User Account Updated', 'success');
      setEditUserTarget(null);
      loadTab();
    } catch (err: any) {
      showToast('Update User Failed', 'error', err.message);
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/document-categories', {
        method: 'POST',
        body: JSON.stringify(catForm),
      });
      showToast('Document Category Added', 'success');
      setCatOpen(false);
      setCatForm({
        code: '',
        name: '',
        groupName: 'IDENTITY',
        isRequired: false,
        allowMasked: false,
        legalNote: '',
      });
      loadTab();
    } catch (err: any) {
      showToast('Create Category Failed', 'error', err.message);
    }
  };

  const toggleUserActive = async (u: any) => {
    try {
      await apiFetch(`/api/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !u.isActive }),
      });
      showToast(u.isActive ? 'Account Deactivated' : 'Account Activated', 'info');
      loadTab();
    } catch (err: any) {
      showToast('Update Failed', 'error', err.message);
    }
  };

  const deleteUser = async (u: any) => {
    try {
      await apiFetch(`/api/users/${u.id}`, { method: 'DELETE' });
      showToast('User Deleted', 'info');
      loadTab();
    } catch (err: any) {
      showToast('Delete Failed', 'error', err.message);
    }
  };

  const revokeSession = async (sessionId: number) => {
    try {
      await apiFetch(`/api/auth/sessions/${sessionId}`, { method: 'DELETE' });
      showToast('Session Revoked', 'info');
      loadTab();
    } catch (err: any) {
      showToast('Revoke Failed', 'error', err.message);
    }
  };

  const toggleRolePermission = async (role: any, permId: number) => {
    const has = role.permissionIds.includes(permId);
    const nextIds = has ? role.permissionIds.filter((id: number) => id !== permId) : [...role.permissionIds, permId];
    try {
      await apiFetch(`/api/roles/${role.id}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ permissionIds: nextIds }),
      });
      showToast('Permissions Updated', 'success');
      loadTab();
    } catch (err: any) {
      showToast('RBAC Error', 'error', err.message);
    }
  };

  const toggleDocCat = async (cat: any, field: 'isRequired' | 'isEnabled') => {
    try {
      await apiFetch(`/api/document-categories/${cat.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: !cat[field] }),
      });
      showToast('Document Category Updated', 'success');
      loadTab();
    } catch (err: any) {
      showToast('Update Error', 'error', err.message);
    }
  };

  const saveSettings = async () => {
    try {
      await apiFetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings: settings.map((s) => ({ key: s.key, value: s.value })) }),
      });
      showToast('System Policies Saved', 'success');
    } catch (err: any) {
      showToast('Save Failed', 'error', err.message);
    }
  };

  const securityAlerts = auditLogs.filter(
    (l) =>
      SECURITY_ALERT_ACTIONS.has(l.action) &&
      (!alertFilter ||
        l.action.toLowerCase().includes(alertFilter.toLowerCase()) ||
        l.actorEmail.toLowerCase().includes(alertFilter.toLowerCase())),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            {isSuper ? 'Enterprise Administration & Governance' : 'Recruiter Team Management'}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {isSuper
              ? 'Manage Admins, Recruiters, RBAC matrix, active sessions, security alerts, and platform health'
              : 'Provision and monitor your assigned recruitment team'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {tab === 'USERS' && (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0863E8] text-white text-xs font-semibold whitespace-nowrap"
            >
              <Plus className="w-4 h-4" /> Provision {isSuper ? 'User' : 'Recruiter'}
            </button>
          )}
          {tab === 'DOCS_CONFIG' && isSuper && (
            <button
              type="button"
              onClick={() => setCatOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#0863E8] text-white text-xs font-semibold whitespace-nowrap"
            >
              <Plus className="w-4 h-4" /> Add Document Category
            </button>
          )}
          {tab === 'SESSIONS' && isSuper && (
            <button
              type="button"
              onClick={loadTab}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh Sessions
            </button>
          )}
        </div>
      </div>

      {/* Sub-navigation */}
      <div className="flex flex-wrap gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-900 w-fit">
        <button type="button" onClick={() => setTab('USERS')} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${tab === 'USERS' ? 'bg-white dark:bg-slate-800 shadow-xs text-[#0863E8]' : 'text-slate-500'}`}>
          <UserCog className="w-3.5 h-3.5" /> {isSuper ? 'Users & Accounts' : 'Recruiters'}
        </button>
        {isSuper && (
          <>
            <button type="button" onClick={() => setTab('RBAC')} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${tab === 'RBAC' ? 'bg-white dark:bg-slate-800 shadow-xs text-[#0863E8]' : 'text-slate-500'}`}>
              <KeyRound className="w-3.5 h-3.5" /> Roles &amp; Permissions
            </button>
            <button type="button" onClick={() => setTab('DOCS_CONFIG')} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${tab === 'DOCS_CONFIG' ? 'bg-white dark:bg-slate-800 shadow-xs text-[#0863E8]' : 'text-slate-500'}`}>
              <FileCog className="w-3.5 h-3.5" /> Document Categories
            </button>
            <button type="button" onClick={() => setTab('SETTINGS')} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${tab === 'SETTINGS' ? 'bg-white dark:bg-slate-800 shadow-xs text-[#0863E8]' : 'text-slate-500'}`}>
              <Settings className="w-3.5 h-3.5" /> System Policies
            </button>
            <button type="button" onClick={() => setTab('SESSIONS')} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${tab === 'SESSIONS' ? 'bg-white dark:bg-slate-800 shadow-xs text-[#0863E8]' : 'text-slate-500'}`}>
              <Laptop className="w-3.5 h-3.5" /> Global Sessions
            </button>
            <button type="button" onClick={() => setTab('AUDIT')} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${tab === 'AUDIT' ? 'bg-white dark:bg-slate-800 shadow-xs text-[#0863E8]' : 'text-slate-500'}`}>
              <Shield className="w-3.5 h-3.5" /> Audit Logs
            </button>
            <button type="button" onClick={() => setTab('ALERTS')} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${tab === 'ALERTS' ? 'bg-white dark:bg-slate-800 shadow-xs text-[#0863E8]' : 'text-slate-500'}`}>
              <AlertTriangle className="w-3.5 h-3.5" /> Security Alerts
            </button>
            <button type="button" onClick={() => setTab('HEALTH')} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${tab === 'HEALTH' ? 'bg-white dark:bg-slate-800 shadow-xs text-[#0863E8]' : 'text-slate-500'}`}>
              <Activity className="w-3.5 h-3.5" /> System Health
            </button>
          </>
        )}
      </div>

      {/* USERS TAB */}
      {tab === 'USERS' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 bg-slate-50/70 dark:bg-slate-900/40">
                <th className="text-left px-4 py-3 font-medium">User</th>
                <th className="text-left px-4 py-3 font-medium">Role</th>
                <th className="text-left px-4 py-3 font-medium">2FA</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Controls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {usersList.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{u.fullName}</p>
                    <p className="text-xs text-slate-500">
                      {u.email}
                      {u.employeeCode ? ` · ${u.employeeCode}` : ''}
                      {u.department ? ` · ${u.department}` : ''}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold">
                    {u.roleDisplayName}
                    {u.roleName === 'RECRUITER' && u.canExportSensitive && (
                      <span className="block text-[11px] font-normal text-[#079B35]">Sensitive Export Allowed</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">{u.twoFactorEnabled ? 'Enabled' : 'Optional'}</td>
                  <td className="px-4 py-3"><StatusText status={u.isActive ? 'OPEN' : 'CLOSED'} /></td>
                  <td className="px-4 py-3 text-right">
                    {u.id !== user?.id && (
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditUser(u)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                          <Pencil className="w-3 h-3" /> Edit
                        </button>
                        <button type="button" onClick={() => toggleUserActive(u)} className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 text-xs font-medium">
                          {u.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        {isSuper && (
                          <button type="button" onClick={() => deleteUser(u)} className="p-1.5 rounded border border-rose-300 text-rose-600 inline-flex items-center">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* RBAC TAB */}
      {tab === 'RBAC' && isSuper && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {rolesData.roles.map((r) => (
            <div key={r.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-5 space-y-3">
              <div>
                <h3 className="font-display font-bold text-base">{r.displayName}</h3>
                <p className="text-xs text-slate-500">{r.description}</p>
              </div>
              <div className="space-y-1.5 border-t border-slate-100 dark:border-slate-800 pt-3 max-h-96 overflow-y-auto">
                {rolesData.permissions.map((p) => {
                  const checked = r.permissionIds.includes(p.id);
                  return (
                    <label key={p.id} className="flex items-start gap-2 text-xs cursor-pointer py-1">
                      <input
                        type="checkbox"
                        disabled={r.name === 'SUPER_ADMIN'}
                        checked={checked}
                        onChange={() => toggleRolePermission(r, p.id)}
                        className="mt-0.5 rounded border-slate-300 text-[#0863E8]"
                      />
                      <span>
                        <strong className="font-mono">{p.code}</strong>
                        <span className="block text-slate-500">{p.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* DOCUMENT CATEGORIES TAB */}
      {tab === 'DOCS_CONFIG' && isSuper && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 text-slate-500">
                <th className="text-left px-4 py-3">Group</th>
                <th className="text-left px-4 py-3">Document Name</th>
                <th className="text-left px-4 py-3">Legal / Compliance Note</th>
                <th className="text-center px-4 py-3">Mandatory</th>
                <th className="text-center px-4 py-3">Enabled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {docCats.map((cat) => (
                <tr key={cat.id}>
                  <td className="px-4 py-3 font-mono font-semibold">{cat.groupName}</td>
                  <td className="px-4 py-3 font-medium">
                    {cat.name}
                    <span className="block font-mono text-[10px] text-slate-400">{cat.code}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{cat.legalNote || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <input type="checkbox" checked={cat.isRequired} onChange={() => toggleDocCat(cat, 'isRequired')} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input type="checkbox" checked={cat.isEnabled} onChange={() => toggleDocCat(cat, 'isEnabled')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* SYSTEM SETTINGS TAB */}
      {tab === 'SETTINGS' && isSuper && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">Security, Retention &amp; Onboarding Policies</h2>
            <button type="button" onClick={saveSettings} className="px-4 py-2 rounded-lg bg-[#0863E8] text-white text-xs font-semibold">
              Save All Policies
            </button>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {settings.map((s, idx) => (
              <div key={s.key} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold font-mono">{s.key}</p>
                  <p className="text-xs text-slate-500">{s.description}</p>
                </div>
                <input
                  value={s.value}
                  onChange={(e) => {
                    const next = [...settings];
                    next[idx].value = e.target.value;
                    setSettings(next);
                  }}
                  className="w-full sm:w-64 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-mono"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* GLOBAL SESSIONS TAB */}
      {tab === 'SESSIONS' && isSuper && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-4">
              <p className="text-xs text-slate-500">Tracked Sessions</p>
              <p className="font-mono text-2xl font-bold mt-1 tabular-nums">{sessionsList.length}</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-4">
              <p className="text-xs text-slate-500">Currently Active</p>
              <p className="font-mono text-2xl font-bold mt-1 text-[#079B35] tabular-nums">
                {sessionsList.filter((s) => s.isActive).length}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-4">
              <p className="text-xs text-slate-500">Revoked / Closed</p>
              <p className="font-mono text-2xl font-bold mt-1 text-slate-500 tabular-nums">
                {sessionsList.filter((s) => !s.isActive).length}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 text-slate-500">
                  <th className="text-left px-4 py-3">User</th>
                  <th className="text-left px-4 py-3">Device / Browser</th>
                  <th className="text-left px-4 py-3">IP Address</th>
                  <th className="text-left px-4 py-3">Last Active</th>
                  <th className="text-left px-4 py-3">State</th>
                  <th className="text-right px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {sessionsList.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{s.userName || 'User'}</p>
                      <p className="text-slate-500">{s.userEmail}</p>
                    </td>
                    <td className="px-4 py-3 max-w-[260px] truncate" title={s.deviceInfo}>{s.deviceInfo || 'Unknown Client'}</td>
                    <td className="px-4 py-3 font-mono">{s.ipAddress || '—'}</td>
                    <td className="px-4 py-3 font-mono tabular-nums whitespace-nowrap">
                      {s.lastActiveAt ? new Date(s.lastActiveAt).toLocaleString('en-IN') : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusText status={s.isActive ? 'OPEN' : 'CLOSED'} />
                      {s.isCurrent && <span className="ml-1.5 text-[11px] font-semibold text-[#0863E8]">(Current)</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {s.isActive && !s.isCurrent ? (
                        <button
                          type="button"
                          onClick={() => revokeSession(s.id)}
                          className="px-2.5 py-1 rounded border border-rose-300 text-rose-600 font-medium hover:bg-rose-50 dark:hover:bg-rose-950/30"
                        >
                          Force Revoke
                        </button>
                      ) : (
                        <span className="text-slate-400">{s.isCurrent ? 'This Device' : 'Ended'}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {sessionsList.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-500">No active login sessions recorded.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* AUDIT LOGS TAB */}
      {tab === 'AUDIT' && isSuper && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 text-slate-500">
                <th className="text-left px-4 py-3">Timestamp</th>
                <th className="text-left px-4 py-3">Actor</th>
                <th className="text-left px-4 py-3">Role</th>
                <th className="text-left px-4 py-3">Action</th>
                <th className="text-left px-4 py-3">Target</th>
                <th className="text-left px-4 py-3">IP Address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
              {auditLogs.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2.5 font-mono tabular-nums whitespace-nowrap">{new Date(l.createdAt).toLocaleString('en-IN')}</td>
                  <td className="px-4 py-2.5">{l.actorEmail}</td>
                  <td className="px-4 py-2.5 font-semibold">{l.actorRole}</td>
                  <td className="px-4 py-2.5 font-mono text-[#0863E8]">{l.action}</td>
                  <td className="px-4 py-2.5">{l.targetType} {l.targetId ? `#${l.targetId}` : ''}</td>
                  <td className="px-4 py-2.5 font-mono">{l.ipAddress}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* SECURITY ALERTS TAB */}
      {tab === 'ALERTS' && isSuper && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-4">
              <p className="text-xs text-slate-500">Security Events Detected</p>
              <p className="font-mono text-2xl font-bold mt-1 tabular-nums">{securityAlerts.length}</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-4">
              <p className="text-xs text-slate-500">High Severity (Lockouts / Revocations)</p>
              <p className="font-mono text-2xl font-bold mt-1 text-rose-600 tabular-nums">
                {securityAlerts.filter((a) => ['ACCOUNT_LOCKED', 'SESSION_REVOKED', '2FA_DISABLED', 'USER_DELETED'].includes(a.action)).length}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-4 flex items-center">
              <input
                value={alertFilter}
                onChange={(e) => setAlertFilter(e.target.value)}
                placeholder="Filter by action or actor email..."
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 text-slate-500">
                  <th className="text-left px-4 py-3">Timestamp</th>
                  <th className="text-left px-4 py-3">Severity</th>
                  <th className="text-left px-4 py-3">Security Event</th>
                  <th className="text-left px-4 py-3">Actor</th>
                  <th className="text-left px-4 py-3">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                {securityAlerts.map((a) => {
                  const isHigh = ['ACCOUNT_LOCKED', 'SESSION_REVOKED', '2FA_DISABLED', 'USER_DELETED'].includes(a.action);
                  return (
                    <tr key={a.id}>
                      <td className="px-4 py-2.5 font-mono tabular-nums whitespace-nowrap">{new Date(a.createdAt).toLocaleString('en-IN')}</td>
                      <td className={`px-4 py-2.5 font-semibold ${isHigh ? 'text-rose-600' : 'text-amber-600'}`}>
                        {isHigh ? 'HIGH' : 'MEDIUM'}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-slate-900 dark:text-slate-100">{a.action}</td>
                      <td className="px-4 py-2.5">{a.actorEmail} · {a.actorRole}</td>
                      <td className="px-4 py-2.5 font-mono">{a.ipAddress}</td>
                    </tr>
                  );
                })}
                {securityAlerts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                      No high-priority security alerts recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SYSTEM HEALTH TAB */}
      {tab === 'HEALTH' && isSuper && health && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-5">
            <p className="text-xs text-slate-500">PostgreSQL Health</p>
            <div className="mt-2"><StatusText status={health.databaseStatus} /></div>
            <p className="text-xs font-mono text-slate-500 mt-1 tabular-nums">Query Latency: {health.dbLatencyMs} ms</p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-5">
            <p className="text-xs text-slate-500">Document Vault Encryption</p>
            <p className="font-mono text-xl font-bold mt-1">{health.encryptionAlgorithm}</p>
            <p className="text-xs text-slate-500 mt-1 tabular-nums">{health.counts.documents} encrypted files stored</p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-5">
            <p className="text-xs text-slate-500">Active Records</p>
            <p className="font-mono text-xl font-bold mt-1 tabular-nums">{health.counts.candidates} Candidates</p>
            <p className="text-xs text-slate-500 mt-1 tabular-nums">{health.counts.jobs} Jobs · {health.counts.activeSessions} Active Sessions</p>
          </div>
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] p-5">
            <p className="text-xs text-slate-500">External Channels</p>
            <p className="font-mono text-sm font-semibold mt-1">SMTP: {health.smtpConfigured ? 'Configured' : 'Log Fallback'}</p>
            <p className="text-xs text-slate-500 mt-1">WhatsApp: {health.whatsappMode}</p>
          </div>
        </div>
      )}

      {/* Provision User Modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Provision Enterprise User Account">
        <form onSubmit={handleCreateUser} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Full Name *</label>
              <input required value={userForm.fullName} onChange={(e) => setUserForm({ ...userForm, fullName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Corporate Email *</label>
              <input required type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Temporary Password (min 8 chars) *</label>
              <input required type="password" minLength={8} value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Role *</label>
              <select
                value={userForm.roleName}
                onChange={(e) => setUserForm({ ...userForm, roleName: e.target.value as any })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              >
                <option value="RECRUITER">Recruiter</option>
                {isSuper && <option value="ADMIN">Admin (HR Operations)</option>}
                {isSuper && <option value="SUPER_ADMIN">Super Admin</option>}
              </select>
            </div>
          </div>
          {userForm.roleName === 'RECRUITER' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Department</label>
                <input value={userForm.department} onChange={(e) => setUserForm({ ...userForm, department: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Monthly Target Hires</label>
                <input type="number" min={1} value={userForm.targetMonthlyHires} onChange={(e) => setUserForm({ ...userForm, targetMonthlyHires: Number(e.target.value) })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCreateOpen(false)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-[#0863E8] text-white text-xs font-semibold">Create Account</button>
          </div>
        </form>
      </Modal>

      {/* Edit User Modal */}
      <Modal
        open={Boolean(editUserTarget)}
        onClose={() => setEditUserTarget(null)}
        title="Edit Enterprise Account"
        subtitle={editUserTarget ? `${editUserTarget.email}${editUserTarget.employeeCode ? ` · ${editUserTarget.employeeCode}` : ''}` : ''}
      >
        <form onSubmit={handleEditUser} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Full Name *</label>
              <input
                required
                value={editUserForm.fullName}
                onChange={(e) => setEditUserForm({ ...editUserForm, fullName: e.target.value })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Mobile / Phone</label>
              <input
                value={editUserForm.phone}
                onChange={(e) => setEditUserForm({ ...editUserForm, phone: e.target.value })}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              />
            </div>
            {isSuper && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">Assigned Role</label>
                <select
                  value={editUserForm.roleName}
                  onChange={(e) => setEditUserForm({ ...editUserForm, roleName: e.target.value as any })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
                >
                  <option value="RECRUITER">Recruiter</option>
                  <option value="ADMIN">Admin (HR Operations)</option>
                  <option value="SUPER_ADMIN">Super Admin</option>
                </select>
              </div>
            )}
          </div>
          {editUserForm.roleName === 'RECRUITER' && (
            <div className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Department</label>
                  <input
                    value={editUserForm.department}
                    onChange={(e) => setEditUserForm({ ...editUserForm, department: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Specialization</label>
                  <input
                    value={editUserForm.specialization}
                    onChange={(e) => setEditUserForm({ ...editUserForm, specialization: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Monthly Target Hires</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={editUserForm.targetMonthlyHires}
                    onChange={(e) => setEditUserForm({ ...editUserForm, targetMonthlyHires: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
                  />
                </div>
              </div>
              {isSuper && (
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editUserForm.canExportSensitive}
                    onChange={(e) => setEditUserForm({ ...editUserForm, canExportSensitive: e.target.checked })}
                    className="rounded border-slate-300 text-[#0863E8]"
                  />
                  <span>Authorize sensitive candidate report exports (CSV/Excel/PDF)</span>
                </label>
              )}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditUserTarget(null)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-[#0863E8] text-white text-xs font-semibold">Save Changes</button>
          </div>
        </form>
      </Modal>

      {/* Create Document Category Modal */}
      <Modal open={catOpen} onClose={() => setCatOpen(false)} title="Add Onboarding Document Category" subtitle="Configures candidate upload requirements across the onboarding portal">
        <form onSubmit={handleCreateCategory} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Category Code *</label>
              <input required value={catForm.code} onChange={(e) => setCatForm({ ...catForm, code: e.target.value })} placeholder="POLICE_VERIFICATION" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Group *</label>
              <select value={catForm.groupName} onChange={(e) => setCatForm({ ...catForm, groupName: e.target.value as any })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
                <option value="IDENTITY">IDENTITY</option>
                <option value="EDUCATION">EDUCATION</option>
                <option value="EMPLOYMENT">EMPLOYMENT</option>
                <option value="BANKING">BANKING</option>
                <option value="OTHER">OTHER</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Display Name *</label>
            <input required value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} placeholder="Police Clearance Certificate" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Legal / Compliance Note</label>
            <input value={catForm.legalNote} onChange={(e) => setCatForm({ ...catForm, legalNote: e.target.value })} placeholder="Optional compliance notice shown to candidates" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
          </div>
          <div className="flex items-center gap-6 text-xs">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={catForm.isRequired} onChange={(e) => setCatForm({ ...catForm, isRequired: e.target.checked })} />
              <span>Mandatory for Submission</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={catForm.allowMasked} onChange={(e) => setCatForm({ ...catForm, allowMasked: e.target.checked })} />
              <span>Allow Masked Copy</span>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCatOpen(false)} className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium">Cancel</button>
            <button type="submit" className="px-4 py-2 rounded-lg bg-[#0863E8] text-white text-xs font-semibold">Add Category</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
