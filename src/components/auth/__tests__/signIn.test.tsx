// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { onAuthIssue, onSessionExpired } from '../../../api/client';
import { AuthProvider } from '../../../auth/AuthContext';
import { LoginPage } from '../LoginPage';

/** Sign-in with emailed codes, authenticator codes, recovery codes and the shared-computer option (ADR 021). */
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const fail = (status: number, code: string, meta?: Record<string, unknown>) =>
  new Response(JSON.stringify({ error: { code, message: code, ...(meta ? { meta } : {}) }, requestId: 'req' }), { status });
const later = (s: number) => new Date(Date.now() + s * 1000).toISOString();
const OTP = { state: 'otp_required', challengeExpiresAt: later(600), resendAvailableAt: later(-1), maskedEmail: 's***@example.test' };
const TOTP = { ...OTP, state: 'totp_required', resendAvailableAt: null, maskedEmail: null };
const SESSION = { state: 'authenticated', csrfToken: 'csrf', expiresAt: later(86400) };
const ME = { user: { id: 'u', name: 'Sara', email: 'sara@example.test' }, role: 'owner', permissions: [], tenant: { id: 't', name: 'Store', slug: 'store' }, mfaEnabled: false, expiresAt: later(86400) };

type Reply = Response | ((body: unknown) => Response);
let routes: Record<string, Reply[]>;
let signedIn = false;
let fetchMock: ReturnType<typeof vi.fn>;
const bodies = (url: string) => fetchMock.mock.calls.filter(([u]) => u === url).map(([, init]) => (init?.body ? JSON.parse(init.body as string) : undefined));
beforeEach(() => {
  signedIn = false; routes = {};
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/session') return signedIn ? ok({ state: 'authenticated', nextAction: 'none', expiresAt: later(86400), idleExpiresAt: later(3600), securityValidUntil: null, workValidUntil: null }) : fail(401, 'UNAUTHENTICATED');
    if (url === '/api/auth/me') return ok(ME);
    const queue = routes[url];
    const next = queue?.length ? (queue.length > 1 ? queue.shift()! : queue[0]) : fail(404, 'NOT_FOUND');
    const res = typeof next === 'function' ? next(init?.body ? JSON.parse(init.body as string) : undefined) : next.clone();
    if (res.ok && url !== '/api/auth/otp/resend' && (url !== '/api/auth/login' || !String(await res.clone().text()).includes('_required'))) signedIn = true;
    return res;
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const mount = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={qc}><AuthProvider><MemoryRouter initialEntries={['/login?next=%2Factivity']}><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/activity" element={<div>Activity page</div>} />
    <Route path="/authenticator/setup" element={<div>Authenticator setup page</div>} />
  </Routes></MemoryRouter></AuthProvider></QueryClientProvider>);
};
const signIn = async (shared = false) => {
  fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'sara@example.test' } });
  fireEvent.change(screen.getByLabelText('Password', { exact: true }), { target: { value: 'correct horse battery' } });
  if (shared) fireEvent.click(screen.getByLabelText(/This is a shared computer/));
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
};
const enter = (code: string) => {
  fireEvent.change(screen.getByLabelText(/6-digit code|Recovery code/), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
};

describe('sign-in', () => {
  it('goes straight in on a trusted browser, to the page asked for', async () => {
    routes['/api/auth/login'] = [ok(SESSION)];
    mount(); await signIn();
    expect(await screen.findByText('Activity page')).toBeTruthy();
    expect(bodies('/api/auth/login')).toEqual([{ email: 'sara@example.test', password: 'correct horse battery' }]);
  });

  it('sends sharedDevice: true only when "This is a shared computer" is ticked', async () => {
    routes['/api/auth/login'] = [ok(SESSION)];
    mount(); await signIn(true);
    await screen.findByText('Activity page');
    expect(bodies('/api/auth/login')[0]).toEqual({ email: 'sara@example.test', password: 'correct horse battery', sharedDevice: true });
  });

  it('asks for the emailed code, then signs in with it', async () => {
    routes['/api/auth/login'] = [ok(OTP)]; routes['/api/auth/otp/verify'] = [ok(SESSION)];
    mount(); await signIn();
    expect(await screen.findByText('Enter the 6-digit code we emailed to s***@example.test.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use a recovery code' })).toBeNull();
    enter('123456');
    expect(await screen.findByText('Activity page')).toBeTruthy();
    expect(bodies('/api/auth/otp/verify')).toEqual([{ code: '123456' }]);
  });

  it('sends a user whose store requires an authenticator app (and who has none) to the setup screen', async () => {
    routes['/api/auth/login'] = [ok({ ...SESSION, state: 'authenticator_setup_required' })];
    mount(); await signIn();
    expect(await screen.findByText('Authenticator setup page')).toBeTruthy();
  });

  it('shows the tries left for a wrong code and stays on the code step, without the session-expired flow', async () => {
    const issue = vi.fn(); const offIssue = onAuthIssue(issue); const expired = vi.fn(); const offExpired = onSessionExpired(expired);
    routes['/api/auth/login'] = [ok(OTP)]; routes['/api/auth/otp/verify'] = [fail(401, 'OTP_INVALID', { attemptsLeft: 2 })];
    mount(); await signIn(); await screen.findByLabelText('6-digit code');
    enter('000000');
    expect(await screen.findByText('Wrong code, 2 tries left.')).toBeTruthy();
    expect(screen.getByLabelText('6-digit code')).toBeTruthy();
    expect(issue).not.toHaveBeenCalled(); expect(expired).not.toHaveBeenCalled(); offIssue(); offExpired();
  });

  it.each([
    ['OTP_LOCKED', 'Too many wrong codes. Enter your password to sign in again.'],
    ['CHALLENGE_EXPIRED', 'This sign-in expired. Enter your password to sign in again.'],
  ])('%s goes back to the password step with a message', async (code, message) => {
    routes['/api/auth/login'] = [ok(OTP)]; routes['/api/auth/otp/verify'] = [fail(401, code)];
    mount(); await signIn(); await screen.findByLabelText('6-digit code');
    enter('000000');
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByLabelText('Work email')).toHaveProperty('value', 'sara@example.test');
    expect(screen.getByLabelText('Password', { exact: true })).toHaveProperty('value', '');
  });

  it('keeps "Send a new code" disabled until resendAvailableAt, then sends one', async () => {
    routes['/api/auth/login'] = [ok({ ...OTP, resendAvailableAt: later(45) })];
    routes['/api/auth/otp/resend'] = [ok({ challengeExpiresAt: later(600), resendAvailableAt: later(60) })];
    mount(); await signIn();
    const wait = await screen.findByRole('button', { name: /Send a new code in \d+ s/ });
    expect(wait).toHaveProperty('disabled', true);
    cleanup();
    routes['/api/auth/login'] = [ok(OTP)];
    mount(); await signIn();
    fireEvent.click(await screen.findByRole('button', { name: 'Send a new code' }));
    expect(await screen.findByText('We sent a new code. The previous one no longer works.')).toBeTruthy();
    expect(await screen.findByRole('button', { name: /Send a new code in \d+ s/ })).toHaveProperty('disabled', true);
    expect(fetchMock.mock.calls.filter(([u]) => u === '/api/auth/otp/resend')).toHaveLength(1);
  });

  it('says no more codes can be sent when resendAvailableAt is null', async () => {
    routes['/api/auth/login'] = [ok({ ...OTP, resendAvailableAt: null })];
    mount(); await signIn();
    expect(await screen.findByText('No more codes can be sent for this sign-in.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Send a new code/ })).toBeNull();
  });

  it('shows the wait from 429 OTP_SEND_LIMIT on resend, and on sign-in itself', async () => {
    routes['/api/auth/login'] = [ok(OTP)]; routes['/api/auth/otp/resend'] = [fail(429, 'OTP_SEND_LIMIT', { retryAfterSeconds: 120 })];
    mount(); await signIn();
    fireEvent.click(await screen.findByRole('button', { name: 'Send a new code' }));
    expect(await screen.findByText('Too many codes sent, try again in 120 s.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Send a new code in 1[12]\d s/ })).toHaveProperty('disabled', true);
    cleanup();
    routes['/api/auth/login'] = [fail(429, 'OTP_SEND_LIMIT', { retryAfterSeconds: 30 })];
    mount(); await signIn();
    expect(await screen.findByText('Too many codes sent, try again in 30 s.')).toBeTruthy();
  });

  it('asks an authenticator user for the app code, with "Use a recovery code"', async () => {
    const recovery = 'A'.repeat(43);
    routes['/api/auth/login'] = [ok(TOTP)]; routes['/api/auth/otp/recovery'] = [ok(SESSION)];
    mount(); await signIn();
    expect(await screen.findByText('Enter the code from your authenticator app.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Send a new code/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code' }));
    enter(recovery);
    expect(await screen.findByText('Activity page')).toBeTruthy();
    expect(bodies('/api/auth/otp/recovery')).toEqual([{ code: recovery }]);
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/auth/otp/verify')).toBe(false);
  });

  it('never calls the removed MFA routes', async () => {
    routes['/api/auth/login'] = [ok(TOTP)]; routes['/api/auth/otp/verify'] = [ok(SESSION)];
    mount(); await signIn(); await screen.findByLabelText('6-digit code'); enter('123456');
    await screen.findByText('Activity page');
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/mfa/'))).toEqual([]);
  });

  it('does not go in when an older server answers with a sign-in step this app does not know (mfa_required)', async () => {
    routes['/api/auth/login'] = [ok({ state: 'mfa_required', csrfToken: 'csrf', expiresAt: later(3600) })];
    mount(); await signIn();
    expect(await screen.findByText(/sign-in step this version of Qorloop does not support \(mfa_required\)/)).toBeTruthy();
    expect(screen.queryByText('Activity page')).toBeNull();
    expect(screen.getByLabelText('Work email')).toBeTruthy();
  });

  it('"Back to sign in" returns to the password step', async () => {
    routes['/api/auth/login'] = [ok(OTP)];
    mount(); await signIn(); await screen.findByLabelText('6-digit code');
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    await waitFor(() => expect(screen.getByLabelText('Work email')).toBeTruthy());
  });
});
