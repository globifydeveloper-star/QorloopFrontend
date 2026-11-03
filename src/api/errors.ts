import { ApiError } from './client';
import { NETWORK_MESSAGE } from './network';

export interface ErrorPresentation {
  kind: 'network' | 'session' | 'forbidden' | 'not_found' | 'server' | 'other';
  title: string;
  message: string;
  requestId?: string;
}

/** Shared by all page data-error states. Session transitions remain owned by AuthContext. */
export function friendlyError(error: unknown): ErrorPresentation {
  const rawNetwork = error instanceof Error && (error.name === 'NetworkError' || error instanceof TypeError && /fetch|network|load failed|connection/i.test(error.message));
  if (rawNetwork || error instanceof ApiError && error.status === 0)
    return { kind: 'network', title: 'We could not reach Qorloop', message: NETWORK_MESSAGE };
  if (!(error instanceof ApiError)) return { kind: 'other', title: 'Something went wrong', message: 'Please try again.' };
  const requestId = error.requestId;
  if (error.status === 401 || error.status === 403 && ['MFA_REQUIRED', 'MFA_SETUP_REQUIRED'].includes(error.code))
    return { kind: 'session', title: 'Please sign in again', message: 'Your sign-in needs attention. Please complete the sign-in steps.', requestId };
  if (error.code === 'CSRF_REQUIRED') return { kind: 'other', title: 'Please try saving again', message: 'We are refreshing your sign-in status. Review your changes and try again. If this continues, sign in again.', requestId };
  if (error.status === 403) return { kind: 'forbidden', title: 'You do not have permission', message: 'Ask your store Owner or an Admin if you need access.', requestId };
  if (error.status === 404) return { kind: 'not_found', title: 'We could not find this page', message: 'It may have moved or may no longer be available.', requestId };
  if (error.status >= 500) return { kind: 'server', title: 'Qorloop could not complete this request', message: requestId ? 'Please try again. If this continues, share the Request ID with support.' : 'Please try again. If this continues, contact support.', requestId };
  return { kind: 'other', title: 'Something went wrong', message: error.message, requestId };
}
