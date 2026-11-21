// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, apiBlob, isStepUpRequired, onSessionExpired, setStepUpHandler } from '../client';
import { connectionReached, connectionUnavailable } from '../connectivity';
import { NETWORK_MESSAGE } from '../network';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); document.cookie = 'qorloop.csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'; });
afterEach(() => { connectionReached(); vi.unstubAllGlobals(); });

describe('api client', () => {
  it('unwraps the { data } envelope and always sends cookies', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { data: { hello: 'world' } })));
    expect(await api('/api/x')).toEqual({ hello: 'world' });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'include' });
  });

  it('sends the CSRF token on mutations only, and never a tenant ID', async () => {
    document.cookie = 'qorloop.csrf=abc123; path=/';
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { data: {} })));
    await api('/api/x');
    await api('/api/x', { method: 'POST', body: { a: 1 } });
    const [get, post] = fetchMock.mock.calls.map(c => c[1].headers as Record<string, string>);
    expect(get['X-CSRF-Token']).toBeUndefined();
    expect(post['X-CSRF-Token']).toBe('abc123');
    expect(post['Content-Type']).toBe('application/json');
    expect(JSON.stringify(fetchMock.mock.calls)).not.toMatch(/tenant/i);
  });

  it('sets no JSON content type on bodyless requests', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { data: {} })));
    await api('/api/x', { method: 'DELETE' });
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });

  it('maps server errors, validation details and the request ID', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(400, { error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: [{ path: 'email', message: 'Invalid email' }] }, requestId: 'req-1' })));
    const err = (await api('/api/x', { method: 'POST', body: {} }).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', requestId: 'req-1' });
    expect(err.fieldErrors).toEqual({ email: 'Invalid email' });
  });

  it('announces an expired session on 401, except where 401 means "wrong password"', async () => {
    const listener = vi.fn();
    const off = onSessionExpired(listener);
    fetchMock.mockImplementation(() => Promise.resolve(json(401, { error: { code: 'UNAUTHENTICATED', message: 'Session expired or invalid' } })));
    await api('/api/team/members').catch(() => undefined);
    expect(listener).toHaveBeenCalledTimes(1);
    await api('/api/auth/login', { method: 'POST', body: {}, expectUnauthorized: true }).catch(() => undefined);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it('reports a friendly message when the server is unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api('/api/x')).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
  });

  it('survives non-JSON error bodies (e.g. a proxy 502)', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response('<html>Bad gateway</html>', { status: 502 })));
    await expect(api('/api/x')).rejects.toMatchObject({ status: 502, message: 'Request failed (502)' });
  });
  it.each([api, apiBlob])('normalizes an explicitly marked upstream connection failure for JSON and binary requests', async request => {
    fetchMock.mockResolvedValue(json(503, { error: { code: 'UPSTREAM_UNREACHABLE', message: 'Connection unavailable' }, requestId: 'proxy-id-is-not-an-api-request-id' }));
    await expect(request('/api/x')).rejects.toMatchObject({ status: 0, code: 'NETWORK', message: NETWORK_MESSAGE, requestId: undefined });
    expect(connectionUnavailable()).toBe(true);
  });
  it('keeps genuine 5xx responses as server errors even without a Request ID or body', async () => {
    fetchMock.mockResolvedValueOnce(json(503, { error: { code: 'UNAVAILABLE', message: 'Service unavailable' }, requestId: 'backend-id' })).mockResolvedValueOnce(new Response(null, { status: 502 }));
    await expect(api('/api/x')).rejects.toMatchObject({ status: 503, code: 'UNAVAILABLE', requestId: 'backend-id' });
    await expect(api('/api/x')).rejects.toMatchObject({ status: 502, code: 'ERROR' });
    expect(connectionUnavailable()).toBe(false);
  });
  it('normalizes connection loss while reading a response body', async () => {
    const response = new Response(null, { status: 200 });
    vi.spyOn(response, 'text').mockRejectedValue(new TypeError('Failed to fetch'));
    fetchMock.mockResolvedValue(response);
    await expect(api('/api/x')).rejects.toMatchObject({ status: 0, code: 'NETWORK', message: NETWORK_MESSAGE });
  });
});

describe('"Confirm it\'s you" (403 STEP_UP_REQUIRED)', () => {
  const stepUp = (window = 'work') => json(403, { error: { code: 'STEP_UP_REQUIRED', message: 'Confirm it is you with a fresh code', meta: { window } }, requestId: 'step-up-req' });
  let off: (() => void) | undefined;
  afterEach(() => { off?.(); off = undefined; });

  it('asks once, then sends the original request again and returns its answer', async () => {
    document.cookie = 'qorloop.csrf=abc123; path=/';
    const handler = vi.fn(async () => true); off = setStepUpHandler(handler);
    fetchMock.mockResolvedValueOnce(stepUp('security')).mockResolvedValueOnce(json(200, { data: { saved: true } }));
    expect(await api('/api/pricing/bulk/apply', { method: 'POST', body: { a: 1 } })).toEqual({ saved: true });
    expect(handler).toHaveBeenCalledWith('security');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [first, again] = fetchMock.mock.calls;
    expect(again[0]).toBe(first[0]); expect(again[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ a: 1 }), credentials: 'include' });
    expect((again[1].headers as Record<string, string>)['X-CSRF-Token']).toBe('abc123');
  });

  it('leaves the request refused (with its meta) when the user cancels, without signing out', async () => {
    const expired = vi.fn(); const offExpired = onSessionExpired(expired);
    off = setStepUpHandler(async () => false);
    fetchMock.mockImplementation(() => Promise.resolve(stepUp()));
    const err = (await api('/api/x', { method: 'POST', body: {} }).catch((e: unknown) => e)) as ApiError;
    expect(err).toMatchObject({ status: 403, code: 'STEP_UP_REQUIRED', requestId: 'step-up-req', meta: { window: 'work' } });
    expect(isStepUpRequired(err)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(expired).not.toHaveBeenCalled(); offExpired();
  });

  it('shares one dialog between requests that need it at the same time', async () => {
    let release!: (ok: boolean) => void;
    const handler = vi.fn(() => new Promise<boolean>(r => { release = r; })); off = setStepUpHandler(handler);
    const seen: Record<string, number> = {};
    fetchMock.mockImplementation((u: string) => Promise.resolve((seen[u] = (seen[u] ?? 0) + 1) === 1 ? stepUp() : json(200, { data: u })));
    const both = Promise.all([api('/api/a', { method: 'POST' }), api('/api/b', { method: 'POST' })]);
    await vi.waitFor(() => { expect(Object.keys(seen)).toHaveLength(2); expect(handler).toHaveBeenCalled(); });
    release(true);
    expect(await both).toEqual(['/api/a', '/api/b']);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('works for fetched downloads too', async () => {
    off = setStepUpHandler(async () => true);
    fetchMock.mockResolvedValueOnce(stepUp()).mockResolvedValueOnce(new Response('xyz', { status: 200 }));
    const { blob } = await apiBlob('/api/uploads/up_1/errors.xlsx');
    expect(await blob.text()).toBe('xyz'); expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('asks only once per request, and never for requests that opt out or when no dialog is mounted', async () => {
    const handler = vi.fn(async () => true); off = setStepUpHandler(handler);
    fetchMock.mockImplementation(() => Promise.resolve(stepUp()));
    await expect(api('/api/x', { method: 'POST' })).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    expect(handler).toHaveBeenCalledTimes(1); expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(api('/api/auth/step-up/start', { method: 'POST', stepUp: false })).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
    expect(handler).toHaveBeenCalledTimes(1);
    off(); off = undefined;
    await expect(api('/api/x', { method: 'POST' })).rejects.toMatchObject({ code: 'STEP_UP_REQUIRED' });
  });
});
