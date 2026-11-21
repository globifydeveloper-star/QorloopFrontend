// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, api } from '../../../api/client';
import { friendlyError } from '../../../api/errors';
import { StepUpDialog } from '../StepUpDialog';

/** The shared "Confirm it's you" dialog: opened by the API client on 403 STEP_UP_REQUIRED, then the request is retried. */
const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const fail = (status: number, code: string, meta?: Record<string, unknown>) =>
  new Response(JSON.stringify({ error: { code, message: code, ...(meta ? { meta } : {}) }, requestId: 'req' }), { status });
const later = (s: number) => new Date(Date.now() + s * 1000).toISOString();
const EMAIL = { method: 'email', expiresAt: later(600), resendAvailableAt: later(-1), maskedEmail: 's***@example.test' };

let replies: Record<string, Response[]>;
let fetchMock: ReturnType<typeof vi.fn>;
const calls = (url: string) => fetchMock.mock.calls.filter(([u]) => u === url);
beforeEach(() => {
  replies = {};
  fetchMock = vi.fn(async (url: string) => {
    const q = replies[url];
    return (q?.length ? (q.length > 1 ? q.shift()! : q[0]) : fail(404, 'NOT_FOUND')).clone();
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** A screen with a sensitive action, and the dialog mounted once beside it, as in App. */
const Action: React.FC = () => {
  const [result, setResult] = useState('');
  return <>
    <button onClick={() => api<{ done: boolean }>('/api/pricing/bulk/apply', { method: 'POST', body: { x: 1 } }).then(() => setResult('Saved'), e => setResult(friendlyError(e).title))}>Apply prices</button>
    <output>{result}</output>
  </>;
};
const mount = () => {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(<QueryClientProvider client={qc}><StepUpDialog /><Action /></QueryClientProvider>);
};
const needsStepUp = (window = 'work') => { replies['/api/pricing/bulk/apply'] = [fail(403, 'STEP_UP_REQUIRED', { window }), ok({ done: true })]; };

describe("Confirm it's you", () => {
  it('emails a code, verifies it, then repeats the original request', async () => {
    needsStepUp(); replies['/api/auth/step-up/start'] = [ok(EMAIL)]; replies['/api/auth/step-up/verify'] = [ok({ securityValidUntil: later(600), workValidUntil: later(1800) })];
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Apply prices' }));
    const dialog = await screen.findByRole('dialog', { name: "Confirm it's you" });
    await waitFor(() => expect(dialog.textContent).toContain('Enter the 6-digit code we emailed to s***@example.test.'));
    expect(dialog.textContent).toContain('will not ask again for 30 minutes');
    fireEvent.change(await screen.findByLabelText('6-digit code'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls('/api/auth/step-up/start')).toHaveLength(1);
    expect(JSON.parse(calls('/api/auth/step-up/verify')[0][1].body)).toEqual({ code: '654321' });
    expect(calls('/api/pricing/bulk/apply')).toHaveLength(2);
    expect(calls('/api/pricing/bulk/apply')[1][1].body).toBe(JSON.stringify({ x: 1 }));
  });

  it('closes with Escape: the request stays refused and says why, not "no permission"', async () => {
    needsStepUp(); replies['/api/auth/step-up/start'] = [ok(EMAIL)];
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Apply prices' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(await screen.findByText("Confirm it's you to continue")).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls('/api/pricing/bulk/apply')).toHaveLength(1);
  });

  it('shows the tries left for a wrong code and lets the user try again', async () => {
    needsStepUp('security'); replies['/api/auth/step-up/start'] = [ok(EMAIL)];
    replies['/api/auth/step-up/verify'] = [fail(401, 'OTP_INVALID', { attemptsLeft: 4 }), ok({ securityValidUntil: later(600), workValidUntil: later(1800) })];
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Apply prices' }));
    expect((await screen.findByRole('dialog')).textContent).toContain('10 minutes');
    fireEvent.change(await screen.findByLabelText('6-digit code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Wrong code, 4 tries left.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '111111' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Saved')).toBeTruthy();
  });

  it('after too many wrong codes asks for a new one (emailed users resend)', async () => {
    needsStepUp(); replies['/api/auth/step-up/start'] = [ok(EMAIL)]; replies['/api/auth/step-up/verify'] = [fail(401, 'OTP_LOCKED')];
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Apply prices' }));
    fireEvent.change(await screen.findByLabelText('6-digit code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Too many wrong codes. Ask for a new code.')).toBeTruthy();
    expect(screen.queryByLabelText('6-digit code')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }));
    await waitFor(() => expect(calls('/api/auth/step-up/start')).toHaveLength(2));
    expect(await screen.findByLabelText('6-digit code')).toBeTruthy();
  });

  it('offers a recovery code to authenticator users', async () => {
    const recovery = 'b'.repeat(43);
    needsStepUp(); replies['/api/auth/step-up/start'] = [ok({ method: 'totp', expiresAt: later(600), resendAvailableAt: null, maskedEmail: null })];
    replies['/api/auth/step-up/verify'] = [ok({ securityValidUntil: later(600), workValidUntil: later(1800) })];
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Apply prices' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.textContent).toContain('Enter the code from your authenticator app.'));
    expect(screen.queryByRole('button', { name: /Send a new code/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code' }));
    fireEvent.change(screen.getByLabelText('Recovery code'), { target: { value: recovery } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(JSON.parse(calls('/api/auth/step-up/verify')[0][1].body)).toEqual({ recoveryCode: recovery });
  });

  it('shows the wait when no code may be sent (429 OTP_SEND_LIMIT)', async () => {
    needsStepUp(); replies['/api/auth/step-up/start'] = [fail(429, 'OTP_SEND_LIMIT', { retryAfterSeconds: 90 })];
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Apply prices' }));
    expect(await screen.findByText('Too many codes sent, try again in 90 s.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('maps a cancelled confirmation to its own friendly error', () => {
    expect(friendlyError(new ApiError(403, 'STEP_UP_REQUIRED', 'x'))).toMatchObject({ kind: 'other', title: "Confirm it's you to continue" });
    expect(friendlyError(new ApiError(403, 'FORBIDDEN', 'x')).kind).toBe('forbidden');
  });
});
