import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  BarChart3,
  Bell,
  Briefcase,
  CalendarClock,
  CheckCheck,
  FileBarChart2,
  GitBranch,
  Link2,
  LogOut,
  Menu,
  Moon,
  Shield,
  ShieldCheck,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { apiFetch } from '../lib/api';

interface AppShellProps {
  activeTab: string;
  onSelectTab: (tab: string) => void;
  children: React.ReactNode;
}

export function AppShell({ activeTab, onSelectTab, children }: AppShellProps) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await apiFetch<{ notifications: any[]; unreadCount: number }>('/api/notifications');
      setNotifications(res.notifications || []);
      setUnreadCount(res.unreadCount || 0);
    } catch {
      // ignore transient polling failure
    }
  }, []);

  useEffect(() => {
    loadNotifications();
    const timer = setInterval(loadNotifications, 20_000);
    return () => clearInterval(timer);
  }, [loadNotifications]);

  const markAllRead = async () => {
    await apiFetch('/api/notifications/read-all', { method: 'POST' });
    loadNotifications();
  };

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3, roles: ['SUPER_ADMIN', 'ADMIN', 'RECRUITER'] },
    { id: 'candidates', label: user?.roleName === 'RECRUITER' ? 'My Candidates' : 'Candidates', icon: Users, roles: ['SUPER_ADMIN', 'ADMIN', 'RECRUITER'] },
    { id: 'pipeline', label: '15-Stage Pipeline', icon: GitBranch, roles: ['SUPER_ADMIN', 'ADMIN', 'RECRUITER'] },
    { id: 'jobs', label: 'Job Openings', icon: Briefcase, roles: ['SUPER_ADMIN', 'ADMIN', 'RECRUITER'] },
    { id: 'interviews', label: 'Interviews & Offers', icon: CalendarClock, roles: ['SUPER_ADMIN', 'ADMIN', 'RECRUITER'] },
    { id: 'onboarding', label: 'Onboarding & Docs', icon: Link2, roles: ['SUPER_ADMIN', 'ADMIN', 'RECRUITER'] },
    { id: 'reports', label: 'Reports & Exports', icon: FileBarChart2, roles: ['SUPER_ADMIN', 'ADMIN', 'RECRUITER'] },
    { id: 'governance', label: user?.roleName === 'SUPER_ADMIN' ? 'Governance & Users' : 'Recruiter Team', icon: Shield, roles: ['SUPER_ADMIN', 'ADMIN'] },
    { id: 'security', label: '2FA & Sessions', icon: ShieldCheck, roles: ['SUPER_ADMIN', 'ADMIN', 'RECRUITER'] },
  ].filter((item) => user && item.roles.includes(user.roleName));

  const activeLabel = navItems.find((n) => n.id === activeTab)?.label || 'Workspace';

  const SidebarContent = (
    <div className="flex flex-col h-full bg-white dark:bg-[#101820] border-r border-slate-200 dark:border-slate-800">
      <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <BrandLogo size="sm" subtitle="Enterprise HRMS" />
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectTab(item.id);
                setMobileOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'bg-[#0863E8] text-white shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{user?.fullName}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
            {user?.roleDisplayName} · {user?.email}
          </p>
        </div>
        <button
          type="button"
          onClick={logout}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <LogOut className="w-3.5 h-3.5" /> Sign Out Securely
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#0b1118] text-slate-900 dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {SidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="fixed inset-0 bg-slate-950/60" onClick={() => setMobileOpen(false)} />
          <div className="relative z-10 w-64 max-w-[82vw] h-full">{SidebarContent}</div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-[#101820]/90 backdrop-blur-md px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 rounded-lg border border-slate-200 dark:border-slate-700"
              aria-label="Open navigation menu"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-slate-400">9HR Portal</span>
              <span className="text-slate-400">/</span>
              <span className="font-display font-semibold text-slate-900 dark:text-white truncate">
                {activeLabel}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 relative">
            <button
              type="button"
              onClick={() => setNotifOpen(!notifOpen)}
              className="relative p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#0863E8] text-white font-mono text-[10px] font-bold flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label="Toggle color theme"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {notifOpen && (
              <div className="absolute right-0 top-12 w-80 sm:w-96 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#101820] shadow-2xl overflow-hidden z-50">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <span className="text-xs font-bold">Notifications ({unreadCount} unread)</span>
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[#0863E8] hover:underline"
                  >
                    <CheckCheck className="w-3.5 h-3.5" /> Mark all read
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`p-3.5 text-xs ${n.isRead ? 'opacity-70' : 'bg-blue-50/40 dark:bg-blue-950/20'}`}
                    >
                      <p className="font-semibold text-slate-900 dark:text-white">{n.title}</p>
                      <p className="text-slate-600 dark:text-slate-300 mt-0.5">{n.message}</p>
                      <p className="font-mono text-[10px] text-slate-400 mt-1 tabular-nums">
                        {new Date(n.createdAt).toLocaleString('en-IN')}
                      </p>
                    </div>
                  ))}
                  {notifications.length === 0 && (
                    <p className="p-6 text-center text-xs text-slate-500">No notifications yet.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
