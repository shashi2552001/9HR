import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import { apiFetch, clearSessionToken, setSessionToken } from '../lib/api';

export type RoleName = 'SUPER_ADMIN' | 'ADMIN' | 'RECRUITER';

export interface PortalUser {
  id: number;
  uid: string;
  email: string;
  fullName: string;
  phone: string | null;
  roleId: number;
  roleName: RoleName;
  roleDisplayName: string;
  recruiterId: number | null;
  canCreateRecruiters: boolean;
  canExportSensitive: boolean;
  permissions: string[];
  twoFactorEnabled: boolean;
  backupCodesRemaining: number;
}

interface AuthContextValue {
  user: PortalUser | null;
  loading: boolean;
  setupRequired: boolean;
  refreshAuth: () => Promise<PortalUser | null>;
  signInWithGoogle: () => Promise<PortalUser | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  setupRequired: false,
  refreshAuth: async () => null,
  signInWithGoogle: async () => null,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PortalUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);

  const refreshAuth = useCallback(async (): Promise<PortalUser | null> => {
    try {
      const status = await apiFetch<{ setupRequired: boolean }>('/api/auth/setup-status');
      setSetupRequired(status.setupRequired);
      if (status.setupRequired) {
        setUser(null);
        return null;
      }
      try {
        const res = await apiFetch<{ user: PortalUser }>('/api/auth/me');
        setUser(res.user);
        return res.user;
      } catch {
        setUser(null);
        return null;
      }
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  const signInWithGoogle = useCallback(async (): Promise<PortalUser | null> => {
    const cred = await signInWithPopup(auth, googleAuthProvider);
    const idToken = await cred.user.getIdToken();
    const res = await apiFetch<{ signedIn: boolean; sessionToken?: string }>('/api/auth/firebase', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    });
    if (res.sessionToken) {
      setSessionToken(res.sessionToken);
    }
    return refreshAuth();
  }, [refreshAuth]);

  const logout = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore if session already expired
    }
    clearSessionToken();
    try {
      await signOut(auth);
    } catch {
      // ignore
    }
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, setupRequired, refreshAuth, signInWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
