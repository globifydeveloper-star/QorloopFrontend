import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, onSessionExpired } from '../api/client';
import { authApi } from '../api/auth';
import type { AuthState, Me, SessionResponse } from '../api/types';

/**
 * Centralised authentication state. The server is the only authority: everything here is derived from
 * GET /api/auth/me (which returns the role and effective permissions), and the session itself is an
 * HttpOnly cookie this code cannot read. Nothing in this file grants access; it only decides what to show.
 */
export type AuthStatus = 'loading' | 'unauthenticated' | 'expired' | 'error' | AuthState;

interface AuthValue {
  status: AuthStatus;
  me: Me | null;
  error: ApiError | null;
  /** UI hint only. The server enforces every permission. */
  can: (permission: string) => boolean;
  /** Call after login / invitation / MFA responses; refreshes /me and remembers the MFA step across reloads. */
  establish: (session: SessionResponse) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => void;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);
const HINT_KEY = 'qorloop.auth-state';

const readHint = (): AuthState | null => {
  try {
    const v = sessionStorage.getItem(HINT_KEY);
    return v === 'mfa_required' || v === 'mfa_setup_required' ? v : null;
  } catch { return null; }
};
const writeHint = (v: AuthState | null) => {
  try { v && v !== 'authenticated' ? sessionStorage.setItem(HINT_KEY, v) : sessionStorage.removeItem(HINT_KEY); } catch { /* storage unavailable */ }
};

type MeResult = { kind: 'ok'; me: Me } | { kind: 'anonymous' } | { kind: 'restricted' };

async function loadMe(): Promise<MeResult> {
  try {
    return { kind: 'ok', me: await authApi.me() };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return { kind: 'anonymous' };
    // 403 "MFA verification required": signed in with a restricted (enrollment/challenge) session.
    if (e instanceof ApiError && e.status === 403) return { kind: 'restricted' };
    throw e;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['me'], queryFn: loadMe, retry: false, staleTime: 60_000, refetchOnWindowFocus: true });
  const wasSignedIn = useRef(false);
  const [expired, setExpired] = useState(false);
  const [hint, setHint] = useState<AuthState | null>(readHint);

  let status: AuthStatus = 'loading';
  let me: Me | null = null;
  if (query.isError) status = 'error';
  else if (query.data?.kind === 'ok') { status = 'authenticated'; me = query.data.me; }
  else if (query.data?.kind === 'restricted') status = hint === 'mfa_setup_required' ? 'mfa_setup_required' : 'mfa_required';
  else if (query.data?.kind === 'anonymous') status = expired || wasSignedIn.current ? 'expired' : 'unauthenticated';

  useEffect(() => { if (status === 'authenticated') { wasSignedIn.current = true; setExpired(false); } }, [status]);

  // A 401 from any protected call means the session ended (idle or absolute timeout).
  useEffect(() => onSessionExpired(() => {
    if (wasSignedIn.current) { setExpired(true); void qc.invalidateQueries({ queryKey: ['me'] }); }
  }), [qc]);

  const establish = useCallback(async (session: SessionResponse) => {
    writeHint(session.state);
    setHint(session.state);
    setExpired(false);
    wasSignedIn.current = false;
    await qc.invalidateQueries({ queryKey: ['me'] });
    await qc.refetchQueries({ queryKey: ['me'] });
  }, [qc]);

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* the cookie may already be gone */ }
    writeHint(null);
    setHint(null);
    wasSignedIn.current = false;
    setExpired(false);
    // Update the observed 'me' query in place (clear() would detach its observer and keep showing the old user),
    // then drop everything else so the next person on this browser cannot see cached store data.
    qc.setQueryData(['me'], { kind: 'anonymous' } satisfies MeResult);
    qc.removeQueries({ predicate: q => q.queryKey[0] !== 'me' });
  }, [qc]);

  const value = useMemo<AuthValue>(() => ({
    status, me,
    error: query.error instanceof ApiError ? query.error : null,
    can: p => Boolean(me?.permissions.includes(p)),
    establish, logout, retry: () => void query.refetch(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [status, me, query.error, establish, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
