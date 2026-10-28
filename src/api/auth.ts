import { api } from './client';
import type { Me, SessionResponse } from './types';

export const authApi = {
  me: () => api<Me>('/api/auth/me', { expectUnauthorized: true }),
  login: (email: string, password: string) =>
    api<SessionResponse>('/api/auth/login', { method: 'POST', body: { email, password }, expectUnauthorized: true }),
  logout: () => api<{ success: boolean }>('/api/auth/logout', { method: 'POST', expectUnauthorized: true }),
  acceptInvitation: (token: string, name: string, password: string) =>
    api<SessionResponse>('/api/auth/invitations/accept', { method: 'POST', body: { token, name, password }, expectUnauthorized: true }),
  forgotPassword: (email: string) =>
    api<{ success: boolean }>('/api/auth/password/forgot', { method: 'POST', body: { email }, expectUnauthorized: true }),
  resetPassword: (token: string, password: string) =>
    api<{ success: boolean }>('/api/auth/password/reset', { method: 'POST', body: { token, password }, expectUnauthorized: true }),
  mfaSetup: (password: string) =>
    api<{ totpUri: string; expiresIn: number }>('/api/auth/mfa/setup', { method: 'POST', body: { password }, expectUnauthorized: true }),
  mfaVerify: (code: string) =>
    api<SessionResponse>('/api/auth/mfa/verify', { method: 'POST', body: { code }, expectUnauthorized: true }),
  mfaRecovery: (code: string) =>
    api<SessionResponse>('/api/auth/mfa/recovery', { method: 'POST', body: { code }, expectUnauthorized: true }),
};
