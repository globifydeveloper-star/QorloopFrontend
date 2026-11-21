import React from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { UNSUPPORTED_SIGN_IN, useAuth } from '../../auth/AuthContext';
import { ErrorState, LoadingState } from '../common/States';
import { returnQuery, safeReturnTo } from '../../lib/returnTo';

const FullPage: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen flex items-center justify-center bg-[#F2F7F6]">{children}</div>
);

/** Only when the store requires an authenticator app for everyone and this user has none yet. */
export const AUTHENTICATOR_SETUP_PATH = '/authenticator/setup';

/** Sends a visitor to the right step for their session state. Pages behind this never render for anyone else. */
export const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { status, error, retry } = useAuth();
  const location = useLocation();
  const here = returnQuery(location.pathname + location.search + location.hash);
  switch (status) {
    case 'loading': return <FullPage><LoadingState label="Loading your workspace…" /></FullPage>;
    case 'error': return <FullPage><ErrorState error={error} onRetry={retry} title={error?.status === 404 ? 'We could not find this store' : error?.status === 500 || error?.status === 0 ? 'We could not reach Qorloop' : error?.code === UNSUPPORTED_SIGN_IN ? 'Sign-in could not be completed' : undefined} /></FullPage>;
    case 'expired': return <Navigate to={'/session-expired' + here} replace />;
    case 'authenticator_setup_required': return <Navigate to={AUTHENTICATOR_SETUP_PATH + here} replace />;
    case 'authenticated': return <>{children}</>;
    // Fail closed: only a known, complete sign-in opens the app.
    default: return <Navigate to={'/login' + here} replace />;
  }
};

/** Pages for visitors who are not fully signed in. A signed-in user is sent to the app instead. */
export const Guest: React.FC<{ children: React.ReactNode; allow?: 'authenticator_setup_required' }> = ({ children, allow }) => {
  const { status, error, retry } = useAuth();
  const [params] = useSearchParams();
  const next = params.get('next');
  if (status === 'loading') return <FullPage><LoadingState /></FullPage>;
  if (status === 'error') return <FullPage><ErrorState error={error} onRetry={retry} title={error?.status === 500 || error?.status === 0 ? 'We could not reach Qorloop' : undefined} /></FullPage>;
  if (status === 'authenticated') return <Navigate to={safeReturnTo(next)} replace />;
  if (allow) {
    if (status === allow) return <>{children}</>;
    return <Navigate to={(status === 'expired' ? '/session-expired' : '/login') + returnQuery(next)} replace />;
  }
  if (status === 'authenticator_setup_required') return <Navigate to={AUTHENTICATOR_SETUP_PATH + returnQuery(next)} replace />;
  return <>{children}</>;
};
