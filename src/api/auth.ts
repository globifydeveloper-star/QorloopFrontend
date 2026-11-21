import { OTP_CODES, api } from './client';
import type { ChallengeResponse, LoginResponse, Me, SessionResponse, SessionStatus, StepUpStart, StepUpWindows } from './types';

/**
 * Sign-in (ADR 021). The device (qorloop.device) and challenge (qorloop.challenge) cookies are httpOnly: the browser
 * sends them, this code never reads them. Wrong codes, expired challenges and send limits are answers the code screens
 * show themselves, so they never reach the global session-expired flow (expectUnauthorized / expectedCodes).
 */
export const authApi = {
  session: () => api<SessionStatus>('/api/auth/session', { expectUnauthorized: true }),
  me: () => api<Me>('/api/auth/me', { expectUnauthorized: true }),
  login: (email: string, password: string, sharedDevice = false) =>
    api<LoginResponse>('/api/auth/login', { method: 'POST', body: { email, password, ...(sharedDevice ? { sharedDevice: true } : {}) }, expectUnauthorized: true }),
  /** The emailed code, or the authenticator app's code: both six digits. */
  verifyCode: (code: string) =>
    api<SessionResponse>('/api/auth/otp/verify', { method: 'POST', body: { code }, expectUnauthorized: true }),
  /** Authenticator users only: one recovery code instead (it is used up). */
  verifyRecoveryCode: (code: string) =>
    api<SessionResponse>('/api/auth/otp/recovery', { method: 'POST', body: { code }, expectUnauthorized: true }),
  resendCode: () =>
    api<Pick<ChallengeResponse, 'challengeExpiresAt' | 'resendAvailableAt'>>('/api/auth/otp/resend', { method: 'POST', expectUnauthorized: true }),
  logout: () => api<{ success: boolean }>('/api/auth/logout', { method: 'POST', expectUnauthorized: true }),
  /** Accepting signs the user straight in; this browser becomes a trusted device. */
  acceptInvitation: (token: string, name: string, password: string) =>
    api<SessionResponse>('/api/auth/invitations/accept', { method: 'POST', body: { token, name, password }, expectUnauthorized: true }),
  forgotPassword: (email: string) =>
    api<{ success: boolean }>('/api/auth/password/forgot', { method: 'POST', body: { email }, expectUnauthorized: true }),
  resetPassword: (token: string, password: string) =>
    api<{ success: boolean }>('/api/auth/password/reset', { method: 'POST', body: { token, password }, expectUnauthorized: true }),

  /** "Confirm it's you" inside a session. A real SESSION_EXPIRED still signs the user out; wrong codes do not. */
  startStepUp: () => api<StepUpStart>('/api/auth/step-up/start', { method: 'POST', stepUp: false, expectedCodes: OTP_CODES }),
  verifyStepUp: (answer: { code: string } | { recoveryCode: string }) =>
    api<StepUpWindows>('/api/auth/step-up/verify', { method: 'POST', body: answer, stepUp: false, expectedCodes: OTP_CODES }),

  /**
   * Authenticator app. Optional, except when the store requires one for everyone (session state
   * authenticator_setup_required), which is the only place the app asks for it today.
   */
  setupAuthenticator: (password: string) =>
    api<{ totpUri: string; expiresIn: number }>('/api/account/authenticator/setup', { method: 'POST', body: { password }, expectedCodes: ['UNAUTHENTICATED'] }),
  confirmAuthenticator: (code: string) =>
    api<{ recoveryCodes: string[] }>('/api/account/authenticator/verify', { method: 'POST', body: { code }, expectedCodes: ['UNAUTHENTICATED', ...OTP_CODES] }),
};
