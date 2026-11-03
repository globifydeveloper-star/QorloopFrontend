import React from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { ErrorState, LoadingState } from '../common/States';
import { returnQuery, safeReturnTo } from '../../lib/returnTo';

const FullPage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen flex items-center justify-center bg-[#F2F7F6]">{children}</div>
);

/** Sends a visitor to the right step for their session state. Pages behind this never render for anyone else. */
export const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { status, error, retry } = useAuth();
  const location = useLocation();
  switch (status) {
    case 'loading': return <FullPage><LoadingState label="Loading your workspace…" /></FullPage>;
    case 'error': return <FullPage><ErrorState error={error} onRetry={retry} title={error?.status === 404 ? 'We could not find this store' : error?.status === 500 || error?.status === 0 ? 'We could not reach Qorloop' : undefined} /></FullPage>;
    case 'unauthenticated': return <Navigate to={'/login' + returnQuery(location.pathname + location.search + location.hash)} replace />;
    case 'expired': return <Navigate to={'/session-expired' + returnQuery(location.pathname + location.search + location.hash)} replace />;
    case 'mfa_setup_required': return <Navigate to={'/mfa/setup' + returnQuery(location.pathname + location.search + location.hash)} replace />;
    case 'mfa_required': return <Navigate to={'/mfa/verify' + returnQuery(location.pathname + location.search + location.hash)} replace />;
    default: return <>{children}</>;
  }
};

/** Pages for visitors who are not fully signed in. A signed-in user is sent to the app instead. */
export const Guest: React.FC<{ children: React.ReactNode; allow?: 'mfa_setup_required' | 'mfa_required' }> = ({ children, allow }) => {
  const { status, error, retry } = useAuth();
  const [params] = useSearchParams();
  const next = params.get('next');
  if (status === 'loading') return <FullPage><LoadingState /></FullPage>;
  if (status === 'error') return <FullPage><ErrorState error={error} onRetry={retry} title={error?.status === 500 || error?.status === 0 ? 'We could not reach Qorloop' : undefined} /></FullPage>;
  if (status === 'authenticated') return <Navigate to={safeReturnTo(next)} replace />;
  if (allow) {
    if (status === allow) return <>{children}</>;
    if (status === 'mfa_setup_required') return <Navigate to={'/mfa/setup' + returnQuery(next)} replace />;
    if (status === 'mfa_required') return <Navigate to={'/mfa/verify' + returnQuery(next)} replace />;
    return <Navigate to={(status === 'expired' ? '/session-expired' : '/login') + returnQuery(next)} replace />;
  }
  if (status === 'mfa_setup_required') return <Navigate to={'/mfa/setup' + returnQuery(next)} replace />;
  if (status === 'mfa_required') return <Navigate to={'/mfa/verify' + returnQuery(next)} replace />;
  return <>{children}</>;
};
