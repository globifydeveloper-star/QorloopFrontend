// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settingsApi, type StoreSettings } from '../settings';
import { activityApi } from '../activity';
import { authApi } from '../auth';

const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
const settings: StoreSettings = {
  profile: { name: 'Store' }, timeZone: 'Asia/Qatar', currency: 'QAR', revision: 'a'.repeat(64),
  thresholds: { priceTolerance: 0.125, stockThreshold: 3, staleHours: 12 },
  security: { analystCanExport: true, mfaRequiredForAll: false },
  pricing: { defaultRule: { mode: 'same' }, rounding: 'exact', perMarketplaceEnabled: false, compareReferenceDefault: 'marketplace', marketplaceRules: [], order: ['offer', 'product', 'subcategory', 'category', 'marketplace', 'default'], updatedAt: null },
};
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); document.cookie = 'qorloop.csrf=; Max-Age=0; path=/'; });

describe('settings/activity/session API contracts', () => {
  it('unwraps real settings and marketplace shapes, including null upload age', async () => {
    const marketplaces = { items: [{ marketplaceId: 'keeta', enabled: true, hasData: false, lastUploadAt: null, ageHours: null }] };
    fetchMock.mockResolvedValueOnce(ok(settings)).mockResolvedValueOnce(ok(marketplaces));
    expect(await settingsApi.get()).toEqual(settings);
    expect(await settingsApi.marketplaces()).toEqual(marketplaces);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/settings', '/api/settings/marketplaces']);
  });
  it('sends expectedRevision, changed API fields and CSRF with the session cookie', async () => {
    document.cookie = 'qorloop.csrf=synthetic-csrf; path=/';
    fetchMock.mockResolvedValue(ok(settings));
    const body = { expectedRevision: settings.revision, thresholds: { staleHours: 36 }, pricing: { defaultRule: { mode: 'same' as const } } };
    await settingsApi.update(body);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/settings');
    expect(init).toMatchObject({ method: 'PUT', credentials: 'include', headers: { 'X-CSRF-Token': 'synthetic-csrf' } });
    expect(JSON.parse(init.body)).toEqual(body);
    expect(init.headers.Origin).toBeUndefined(); // Browser supplies Origin; do not fabricate a tenant or Origin header.
  });
  it('preserves conflict codes and Request IDs', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'CONFLICT', message: 'Settings changed; reload them and try again' }, requestId: 'request-conflict' }), { status: 409 }));
    await expect(settingsApi.update({ expectedRevision: settings.revision, profile: { name: 'New name' } })).rejects.toMatchObject({ status: 409, code: 'CONFLICT', requestId: 'request-conflict' });
  });
  it('passes all filters and the opaque cursor unchanged, including timestamp microseconds', async () => {
    const page = { items: [], nextCursor: 'opaque.2026-11-03T09:00:00.123456Z+/=' };
    fetchMock.mockResolvedValue(ok(page));
    const filters = { eventType: 'price' as const, actorId: 'system', productId: '11111111-1111-4111-8111-111111111111', from: '2026-11-01T09:00:00+03:00', to: '2026-11-03T09:00:00+03:00', limit: 25, cursor: page.nextCursor };
    expect(await activityApi.list(filters)).toEqual(page);
    const url = new URL(fetchMock.mock.calls[0][0], 'http://store.localhost');
    expect(Object.fromEntries(url.searchParams)).toEqual({ ...filters, limit: '25' });
  });
  it('uses the history path and retains the coverage notice with missing before/after data', async () => {
    const page = { items: [{ id: 'event-1', time: '2026-11-03T09:00:00.123456Z', actor: { id: null, name: 'system', email: null }, type: 'unknown', group: 'catalogue', summary: 'Activity recorded', beforeAfter: [], scope: 'product', productId: 'product', uploadId: null }], nextCursor: null, coverageNotice: 'Earlier changes were not recorded per product.' };
    fetchMock.mockResolvedValue(ok(page));
    expect(await activityApi.history('a/b', { cursor: 'opaque+/=' })).toEqual(page);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/products/a%2Fb/history?cursor=opaque%2B%2F%3D');
  });
  it('reads session status without requiring a token or calling readiness', async () => {
    const session = { state: 'mfa_setup_required', expiresAt: '2026-11-03T10:00:00Z', idleExpiresAt: '2026-11-03T10:00:00Z', nextAction: 'setup_mfa' };
    fetchMock.mockResolvedValue(ok(session));
    expect(await authApi.session()).toEqual(session);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/session');
  });
});
