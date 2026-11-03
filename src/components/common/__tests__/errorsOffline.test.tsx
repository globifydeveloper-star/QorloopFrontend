// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { ApiError, api, apiBlob } from '../../../api/client';
import { connectionReached, connectionUnavailable } from '../../../api/connectivity';
import { ErrorState } from '../States';
import { OfflineBanner, connectionTiming } from '../OfflineBanner';

let clients: QueryClient[] = [];
let online = true;
const defaultRetryMs = connectionTiming.retryMs;
beforeEach(() => { online = true; Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online }); connectionReached(); });
afterEach(() => { cleanup(); clients.forEach(q => q.clear()); clients = []; connectionTiming.retryMs = defaultRetryMs; connectionReached(); vi.unstubAllGlobals(); });
const mount = (ui = <OfflineBanner />) => { const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(qc); return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>); };
const ReadQuery = () => { const q = useQuery({ queryKey: ['safe-read'], queryFn: () => api<{ message: string }>('/api/read'), retry: false }); return <div>{q.data?.message}</div>; };

describe('friendly errors with Request IDs', () => {
  it('shows the exact connection message without Request ID advice or Copy when no response was received', () => {
    const retry = vi.fn(); render(<ErrorState error={new ApiError(0, 'NETWORK', 'Failed to fetch')} onRetry={retry} />);
    expect(screen.getByText("Qorloop can't reach the server. Check your connection and try again")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Request ID/i); expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' })); expect(retry).toHaveBeenCalledTimes(1);
  });
  it('does not mention a Request ID when an HTTP server error omitted it', () => {
    render(<ErrorState error={new ApiError(500, 'INTERNAL_ERROR', 'Internal server error')} />);
    expect(screen.getByText('Qorloop could not complete this request')).toBeTruthy(); expect(document.body.textContent).not.toMatch(/Request ID/i);
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull(); expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
  it.each([[500, 'INTERNAL_ERROR', 'Qorloop could not complete this request'], [403, 'FORBIDDEN', 'You do not have permission'], [404, 'NOT_FOUND', 'We could not find this page'], [0, 'NETWORK', 'We could not reach Qorloop']] as const)('shows a plain %s screen, retry and copy', async (status, code, title) => {
    const retry = vi.fn(); const copy = vi.fn(async () => undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
    render(<ErrorState error={new ApiError(status, code, 'Internal technical message', [], 'request-123')} onRetry={retry} />);
    expect(screen.getByText(title)).toBeTruthy(); expect(screen.queryByText('Internal technical message')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' })); expect(await screen.findByText('Copied')).toBeTruthy(); expect(copy).toHaveBeenCalledWith('request-123');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' })); expect(retry).toHaveBeenCalledTimes(1);
  });
  it('handles unavailable clipboard without falsely claiming a copy', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }); render(<ErrorState error={new ApiError(500, 'INTERNAL_ERROR', 'Error', [], 'copy-by-hand')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' })); expect(await screen.findByText('Select the Request ID above and copy it.')).toBeTruthy(); expect(screen.queryByText('Copied')).toBeNull();
  });
});

describe('offline and connection recovery', () => {
  it('shows the banner for browser offline and clears it when online', async () => {
    mount(); expect(screen.queryByText(/You are offline/)).toBeNull();
    act(() => { online = false; window.dispatchEvent(new Event('offline')); }); expect(screen.getByText(/You are offline/)).toBeTruthy();
    act(() => { online = true; window.dispatchEvent(new Event('online')); }); await waitFor(() => expect(screen.queryByText(/You are offline/)).toBeNull());
  });
  it.each([400, 401, 403, 404, 500, 503])('does not call HTTP %s offline', async status => {
    mount(); vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'ERROR', message: 'HTTP error' } }), { status })));
    await act(async () => { await api('/api/error').catch(() => undefined); }); expect(connectionUnavailable()).toBe(false); expect(screen.queryByRole('status')).toBeNull();
  });
  it('retries active reads on online, clears the banner and never replays a failed mutation', async () => {
    let reachable = true;
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => { if (!reachable) throw new TypeError('Failed to fetch'); return new Response(JSON.stringify({ data: { message: 'Recovered data' } }), { status: 200 }); }); vi.stubGlobal('fetch', fetchMock);
    mount(<><OfflineBanner /><ReadQuery /></>); await screen.findByText('Recovered data'); reachable = false;
    await act(async () => { await api('/api/mutation', { method: 'PUT', body: {} }).catch(() => undefined); }); expect(screen.getByText(/We could not connect to Qorloop/)).toBeTruthy();
    reachable = true; act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(screen.queryByText(/We could not connect to Qorloop/)).toBeNull());
    expect(fetchMock.mock.calls.filter(([u]) => u === '/api/mutation')).toHaveLength(1); expect(fetchMock.mock.calls.filter(([u]) => u === '/api/read')).toHaveLength(2);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/health/ready'))).toBe(false);
  });
  it('automatically detects a recovered server while navigator still reports online', async () => {
    connectionTiming.retryMs = 15; let attempts = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { if (++attempts === 1) throw new TypeError('Failed to fetch'); return new Response(JSON.stringify({ data: { message: 'Recovered automatically' } }), { status: 200 }); }));
    mount(<><OfflineBanner /><ReadQuery /></>); expect(await screen.findByText('Recovered automatically')).toBeTruthy(); expect(connectionUnavailable()).toBe(false);
  });
  it('does not treat cancellation as offline and detects binary connection failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('Aborted', 'AbortError'); }));
    await expect(api('/api/cancel')).rejects.toMatchObject({ name: 'AbortError' }); expect(connectionUnavailable()).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); })); await expect(apiBlob('/api/file')).rejects.toMatchObject({ status: 0, code: 'NETWORK' }); expect(connectionUnavailable()).toBe(true);
  });
});
