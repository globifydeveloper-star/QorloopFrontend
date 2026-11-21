// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, api, onAuthIssue } from '../../api/client';
import { authApi } from '../../api/auth';
import { AuthProvider, loadSession, sessionErrorState, useAuth } from '../AuthContext';

const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const fail = (status: number, code: string) => new Response(JSON.stringify({ error: { code, message: code }, requestId: 'session-request' }), { status });
const ME = { user: { id: 'user', name: 'Sara', email: 'sara@example.test' }, role: 'owner', permissions: ['settings.view'], tenant: { id: 'tenant', name: 'Store', slug: 'store' }, mfaEnabled: true, expiresAt: '2026-11-04T09:00:00Z' };
const SESSION = { state: 'authenticated', nextAction: 'none', expiresAt: '2026-11-04T09:00:00Z', idleExpiresAt: '2026-11-03T10:00:00Z' };
let handler: (url: string) => Response | Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn>;
let clients: QueryClient[] = [];
beforeEach(() => {
  handler = u => u === '/api/auth/session' ? ok(SESSION) : u === '/api/auth/me' ? ok(ME) : ok({});
  fetchMock = vi.fn((u: string) => handler(u)); vi.stubGlobal('fetch', fetchMock); sessionStorage.clear();
});
afterEach(() => { cleanup(); clients.forEach(q => q.clear()); clients = []; vi.unstubAllGlobals(); });
const Probe = () => { const a = useAuth(); return <><div data-testid="status">{a.status}</div><div>{a.me?.user.name}</div><div>{a.can('settings.view') ? 'Can view settings' : 'No permissions'}</div><button onClick={() => void api('/api/protected', { method: 'PUT', body: {} }).catch(() => undefined)}>Protected request</button><button onClick={a.retry}>Refresh</button><button onClick={() => void a.logout()}>Logout</button></>; };
const mount = () => { const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(qc); render(<QueryClientProvider client={qc}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>); return qc; };

describe('authoritative session-state branching', () => {
  it('uses session then me for a healthy session and derives permissions from me', async () => {
    mount(); expect(screen.getByTestId('status').textContent).toBe('loading'); await screen.findByText('Sara'); expect(screen.getByText('Can view settings')).toBeTruthy();
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual(['/api/auth/session', '/api/auth/me']);
  });
  it('uses API authenticator_setup_required and ignores an opposite browser hint', async () => {
    sessionStorage.setItem('qorloop.auth-state', 'authenticated');
    handler = () => ok({ ...SESSION, state: 'authenticator_setup_required', nextAction: 'setup_authenticator' });
    mount(); await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('authenticator_setup_required')); expect(fetchMock).toHaveBeenCalledTimes(1); expect(screen.getByText('No permissions')).toBeTruthy();
  });
  it.each(['mfa_required', 'mfa_setup_required', 'something_new'])('fails closed on an unknown session state %s: an error, never a signed-in app without a profile', async state => {
    handler = () => ok({ ...SESSION, state });
    await expect(loadSession()).rejects.toMatchObject({ code: 'UNSUPPORTED_SIGN_IN' });
    mount(); await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'));
    expect(screen.getByText('No permissions')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([u]) => u === '/api/auth/me')).toBe(false);
  });
  it.each([['UNAUTHENTICATED', 'unauthenticated'], ['SESSION_EXPIRED', 'expired']] as const)('distinguishes 401 %s as %s', async (code, state) => {
    handler = () => fail(401, code); expect(await loadSession()).toEqual({ status: state });
  });
  it('handles a protected me AUTHENTICATOR_SETUP_REQUIRED with the authenticator setup step', async () => {
    handler = u => u === '/api/auth/session' ? ok(SESSION) : fail(403, 'AUTHENTICATOR_SETUP_REQUIRED'); expect(await loadSession()).toEqual({ status: 'authenticator_setup_required' });
  });
  it.each(['MFA_REQUIRED', 'MFA_SETUP_REQUIRED', 'STEP_UP_REQUIRED'])('gives 403 %s no session state (the MFA codes are gone; step-up is the dialog)', code => {
    expect(sessionErrorState(new ApiError(403, code, code))).toBeUndefined();
  });
  it.each([[403, 'FORBIDDEN'], [500, 'INTERNAL_ERROR'], [404, 'NOT_FOUND']] as const)('does not mistake %s %s for sign-out or a sign-in step', async (status, code) => {
    handler = u => u === '/api/auth/session' ? ok(SESSION) : fail(status, code);
    await expect(loadSession()).rejects.toMatchObject({ status, code, requestId: 'session-request' });
    expect(sessionErrorState(new ApiError(status, code, 'Error'))).toBeUndefined();
  });
  it('honors protected SESSION_EXPIRED immediately and removes private cached data', async () => {
    const qc = mount(); await screen.findByText('Sara'); qc.setQueryData(['settings'], { private: 'cached store data' });
    handler = () => fail(401, 'SESSION_EXPIRED'); fireEvent.click(screen.getByRole('button', { name: 'Protected request' }));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('expired')); expect(screen.queryByText('Sara')).toBeNull(); expect(qc.getQueryData(['settings'])).toBeUndefined();
  });
  it('refreshes session on CSRF_REQUIRED without replaying the mutation', async () => {
    mount(); await screen.findByText('Sara'); const sessionCalls = () => fetchMock.mock.calls.filter(([u]) => u === '/api/auth/session').length;
    handler = u => u === '/api/protected' ? fail(403, 'CSRF_REQUIRED') : u === '/api/auth/session' ? ok(SESSION) : ok(ME);
    fireEvent.click(screen.getByRole('button', { name: 'Protected request' })); await waitFor(() => expect(sessionCalls()).toBe(2));
    expect(fetchMock.mock.calls.filter(([u]) => u === '/api/protected')).toHaveLength(1); expect(screen.getByTestId('status').textContent).toBe('authenticated');
  });
  it('keeps ordinary forbidden responses out of global sign-in handling', async () => {
    mount(); await screen.findByText('Sara'); handler = () => fail(403, 'FORBIDDEN');
    fireEvent.click(screen.getByRole('button', { name: 'Protected request' })); await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === '/api/protected')).toBe(true));
    expect(screen.getByTestId('status').textContent).toBe('authenticated');
  });
  it('keeps rejected login and sign-in codes out of the global session flow', async () => {
    const listener = vi.fn(); const off = onAuthIssue(listener); handler = () => fail(401, 'UNAUTHENTICATED');
    await authApi.login('fixture@example.test', 'fixture-only').catch(() => undefined); await authApi.verifyCode('000000').catch(() => undefined); await authApi.verifyRecoveryCode('fixture-code').catch(() => undefined);
    for (const [status, code] of [[401, 'OTP_INVALID'], [401, 'OTP_LOCKED'], [401, 'CHALLENGE_EXPIRED'], [429, 'OTP_SEND_LIMIT']] as const) {
      handler = () => fail(status, code);
      await authApi.verifyCode('000000').catch(() => undefined); await authApi.resendCode().catch(() => undefined);
      await authApi.startStepUp().catch(() => undefined); await authApi.verifyStepUp({ code: '000000' }).catch(() => undefined);
    }
    expect(listener).not.toHaveBeenCalled(); off();
  });
  it("still signs out when the session itself ended during \"Confirm it's you\"", async () => {
    const listener = vi.fn(); const off = onAuthIssue(listener); handler = () => fail(401, 'SESSION_EXPIRED');
    await authApi.verifyStepUp({ code: '000000' }).catch(() => undefined);
    expect(listener).toHaveBeenCalledTimes(1); off();
  });
  it('clears the session and store data on logout', async () => {
    const qc = mount(); await screen.findByText('Sara'); qc.setQueryData(['activity'], { items: ['private'] });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Logout' })); });
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unauthenticated')); expect(qc.getQueryData(['activity'])).toBeUndefined();
  });
});
