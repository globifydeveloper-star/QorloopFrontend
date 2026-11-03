// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ApiError } from '../../../api/client';
import type { AuthStatus } from '../../../auth/AuthContext';
import { RequireAuth, Guest } from '../AuthGate';
import { SessionExpiredPage } from '../SystemPages';
import { homeFor } from '../LoginPage';
import { safeReturnTo } from '../../../lib/returnTo';

const auth = { status: 'unauthenticated' as AuthStatus, error: null as ApiError | null, retry: vi.fn(), logout: vi.fn(async () => undefined) };
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => auth }));
const Where = () => { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; };
beforeEach(() => { auth.status = 'unauthenticated'; auth.error = null; auth.retry.mockClear(); auth.logout.mockClear(); });
afterEach(cleanup);
const mount = () => render(<MemoryRouter initialEntries={['/reports/price?marketplace=talabat']}><Where /><Routes>
  <Route path="/reports/price" element={<RequireAuth><div>Protected content</div></RequireAuth>} />
  <Route path="/session-expired" element={<SessionExpiredPage />} />
  <Route path="/login" element={<div>Sign-in form</div>} />
  <Route path="/mfa/setup" element={<div>Enroll MFA</div>} /><Route path="/mfa/verify" element={<div>Verify MFA</div>} />
</Routes></MemoryRouter>);
describe('auth guards and return path', () => {
  it.each([['unauthenticated', '/login'], ['expired', '/session-expired'], ['mfa_required', '/mfa/verify'], ['mfa_setup_required', '/mfa/setup']] as const)('routes %s to %s with the original page', async (state, path) => {
    auth.status = state; mount(); await waitFor(() => expect(screen.getByTestId('where').textContent).toBe(path + '?next=%2Freports%2Fprice%3Fmarketplace%3Dtalabat')); expect(screen.queryByText('Protected content')).toBeNull();
  });
  it('carries the expired page through sign-in and both MFA steps', async () => {
    auth.status = 'expired'; mount(); fireEvent.click(await screen.findByRole('button', { name: 'Sign in again' }));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/login?next=%2Freports%2Fprice%3Fmarketplace%3Dtalabat'));
    const next = '/reports/price?marketplace=talabat';
    expect(homeFor('mfa_setup_required', next)).toBe('/mfa/setup?next=' + encodeURIComponent(next));
    expect(homeFor('mfa_required', next)).toBe('/mfa/verify?next=' + encodeURIComponent(next)); expect(homeFor('authenticated', next)).toBe(next);
  });
  it('returns an already authenticated guest to the requested page', async () => {
    auth.status = 'authenticated'; render(<MemoryRouter initialEntries={['/login?next=%2Factivity']}><Where /><Routes><Route path="/login" element={<Guest><div>Login</div></Guest>} /><Route path="/activity" element={<div>Activity destination</div>} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Activity destination')).toBeTruthy();
  });
  it('preserves the me 500 unreachable screen with retry and Request ID copy', async () => {
    auth.status = 'error'; auth.error = new ApiError(500, 'INTERNAL_ERROR', 'Internal server error', [], 'me-request');
    const copy = vi.fn(async () => undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } }); mount();
    expect(screen.getByText('We could not reach Qorloop')).toBeTruthy(); expect(screen.queryByText('Sign-in form')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' })); await waitFor(() => expect(copy).toHaveBeenCalledWith('me-request'));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' })); expect(auth.retry).toHaveBeenCalledTimes(1);
  });
  it.each(['https://example.test', '//example.test', '/\\example.test', '/\nexample.test'])('rejects an unsafe return path', path => { expect(safeReturnTo(path)).toBe('/'); });
});
