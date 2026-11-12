import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from '../api/client';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<User>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) { setLoading(false); return; }
    api<{ user: User }>('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const d = await api<{ token: string; user: User }>('/auth/login', { method: 'POST', body: { username, password } });
    setToken(d.token);
    setUser(d.user);
    return d.user;
  };

  const logout = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* 会话可能已失效 */ }
    setToken(null);
    setUser(null);
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    const d = await api<{ user: User }>('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
    setUser(d.user);
    return d.user;
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}