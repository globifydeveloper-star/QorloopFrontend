// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, onSessionExpired } from '../client';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); document.cookie = 'qorloop.csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'; });
afterEach(() => vi.unstubAllGlobals());

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
});
