import React, { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, onAuthIssue } from '../api/client';
import { authApi } from '../api/auth';
import type { AuthState, Me, SessionResponse } from '../api/types';

export type AuthStatus = 'loading' | 'unauthenticated' | 'expired' | 'error' | AuthState;
interface AuthValue {
  status: AuthStatus; me: Me | null; error: ApiError | null;
  can: (permission: string) => boolean;
  establish: (session: SessionResponse) => Promise<void>;
  logout: () => Promise<void>; retry: () => void;
}
const AuthContext = createContext<AuthValue | undefined>(undefined);
export type SessionResult = { status: 'authenticated'; me: Me } | { status: 'unauthenticated' | 'expired' | 'mfa_required' | 'mfa_setup_required' };

export function sessionErrorState(e: unknown): Exclude<SessionResult['status'], 'authenticated'> | undefined {
  if (!(e instanceof ApiError)) return undefined;
  if (e.status === 401 && e.code === 'SESSION_EXPIRED') return 'expired';
  if (e.status === 401 && e.code === 'UNAUTHENTICATED') return 'unauthenticated';
  if (e.status === 403 && e.code === 'MFA_REQUIRED') return 'mfa_required';
  if (e.status === 403 && e.code === 'MFA_SETUP_REQUIRED') return 'mfa_setup_required';
  return undefined;
}

/** The API is the authority for expiry and the exact MFA step; no browser hint is used. */
export async function loadSession(): Promise<SessionResult> {
  try {
    const session = await authApi.session();
    if (session.state !== 'authenticated') return { status: session.state };
    return { status: 'authenticated', me: await authApi.me() };
  } catch (e) {
    const status = sessionErrorState(e);
    if (status) return { status };
    throw e;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['me'], queryFn: loadSession, retry: false, staleTime: 60_000, refetchOnWindowFocus: true });
  const status: AuthStatus = query.isError ? 'error' : query.data?.status ?? 'loading';
  const me = query.data?.status === 'authenticated' && status === 'authenticated' ? query.data.me : null;
  const clearWorkspace = useCallback(() => qc.removeQueries({ predicate: q => q.queryKey[0] !== 'me' }), [qc]);

  useEffect(() => onAuthIssue(error => {
    const next = sessionErrorState(error);
    if (next) {
      // Stop in-flight responses for the previous session restoring authenticated UI/data.
      void qc.cancelQueries();
      qc.setQueryData(['me'], { status: next } satisfies SessionResult);
      clearWorkspace();
    } else if (error.code === 'CSRF_REQUIRED') {
      // Refresh session state. Each explicit mutation reads the current CSRF cookie afresh.
      // This read never replays the failed mutation or invents a token refresh endpoint.
      void qc.invalidateQueries({ queryKey: ['me'] });
    }
  }), [qc, clearWorkspace]);

  useEffect(() => {
    if (status !== 'authenticated' && status !== 'loading' && status !== 'error') clearWorkspace();
  }, [status, clearWorkspace]);

  const establish = useCallback(async (_session: SessionResponse) => {
    await qc.cancelQueries({ queryKey: ['me'] });
    clearWorkspace();
    await qc.invalidateQueries({ queryKey: ['me'] });
  }, [qc, clearWorkspace]);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* the cookie may already be gone */ }
    await qc.cancelQueries();
    qc.setQueryData(['me'], { status: 'unauthenticated' } satisfies SessionResult);
    clearWorkspace();
  }, [qc, clearWorkspace]);

  const value = useMemo<AuthValue>(() => ({
    status, me, error: query.error instanceof ApiError ? query.error : null,
    can: p => Boolean(me?.permissions.includes(p)), establish, logout, retry: () => void query.refetch(),
  }), [status, me, query.error, establish, logout, query.refetch]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
