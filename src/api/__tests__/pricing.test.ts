// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../client';
import { pricingApi, type BulkApplyResult, type BulkPreview, type InlinePricing } from '../pricing';

/**
 * The P2 pricing endpoints, against the shapes the backend returns (apps/api/src/pricing/pricing.data.ts
 * marketplacePricingView, bulk-pricing.ts bulkPreview / bulkCounts, bulk-pricing.service.ts apply) and its error envelope
 * ({ error: { code, message, details? }, requestId }, apps/api/src/app.ts).
 */

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;
const req = (n = 0) => {
  const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit];
  return { url, method: init.method, headers: init.headers as Record<string, string>, body: init.body === undefined ? undefined : JSON.parse(String(init.body)), credentials: init.credentials };
};

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  document.cookie = 'qorloop.csrf=csrf-token-1; path=/';
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'qorloop.csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
});

const INLINE: InlinePricing = {
  productId: '7d1f3c2e-0000-4000-8000-000000000001', marketplaceId: 'talabat', erpPrice: 10,
  previous: { price: 11, source: 'default' },
  resolved: { price: 12.5, source: 'product' },
  rule: { mode: 'fixed', value: 12.5, updatedAt: '2026-11-02T06:00:00.000Z' },
  chain: [
    { source: 'offer', status: 'not_set' },
    { source: 'product', status: 'applied', price: 12.5, rule: { mode: 'fixed', value: 12.5 } },
    { source: 'subcategory', status: 'not_set' },
    { source: 'category', status: 'not_set' },
    { source: 'marketplace', status: 'disabled' },
    { source: 'default', status: 'overridden', price: 11, rule: { mode: 'percent', value: 10 }, rounding: 'exact' },
  ],
  marketplaces: [{ marketplaceId: 'talabat', price: 12.5, source: 'product' }, { marketplaceId: 'snoonu', price: 12.5, source: 'product' }],
  changed: true,
};

const row = {
  productId: '7d1f3c2e-0000-4000-8000-000000000002', nameEn: 'Milk 1L', barcode: '6281000000012', marketplaceId: 'talabat' as const,
  oldPrice: 4.4, oldSource: 'default' as const, newPrice: 4.6, newSource: 'product' as const, difference: 0.2,
  previousRule: null, rule: { mode: 'fixed' as const, value: 4.6 },
};
const COUNTS = {
  selected: 3, willChange: 1, unchanged: 1, blocked: 1,
  blockedReasons: [{ reason: 'not_active' as const, message: 'Not active (only active products can be priced)', count: 1 }],
  otherMarketplaces: [{ marketplaceId: 'snoonu' as const, products: 1 }],
};
const PREVIEW: BulkPreview = {
  marketplaceId: 'talabat', action: { type: 'increase_percent', percent: 5, rounding: '0.05' },
  selection: { productIds: [row.productId] }, limit: 5000, ...COUNTS,
  largestIncrease: row, largestDecrease: null, rows: [row], previewToken: 'a'.repeat(64),
};
const APPLIED: BulkApplyResult = {
  operationId: '7d1f3c2e-0000-4000-8000-0000000000aa', replayed: false, appliedAt: '2026-11-02T06:01:00.000Z', ...COUNTS, created: 1, replaced: 0, removed: 0,
};

describe('inline price edit', () => {
  it('PUT /api/pricing/products/:id with the body as given, CSRF and cookies, and unwraps { data }', async () => {
    fetchMock.mockResolvedValue(json(200, { data: INLINE }));
    const r = await pricingApi.setInlinePrice('a b', { marketplaceId: 'talabat', mode: 'fixed', value: 12.5, expectedRuleUpdatedAt: null });
    expect(r).toEqual(INLINE);
    expect(req()).toMatchObject({ url: '/api/pricing/products/a%20b', method: 'PUT', credentials: 'include' });
    expect(req().body).toEqual({ marketplaceId: 'talabat', mode: 'fixed', value: 12.5, expectedRuleUpdatedAt: null });
    expect(req().headers['X-CSRF-Token']).toBe('csrf-token-1');
    expect(req().headers['Content-Type']).toBe('application/json');
  });

  it('a percent with the rule version seen', async () => {
    fetchMock.mockResolvedValue(json(200, { data: { ...INLINE, changed: false } }));
    const r = await pricingApi.setInlinePrice('p1', { marketplaceId: 'snoonu', mode: 'percent', value: -10, expectedRuleUpdatedAt: '2026-11-01T18:30:00.000Z' });
    expect(r.changed).toBe(false);
    expect(req().body).toEqual({ marketplaceId: 'snoonu', mode: 'percent', value: -10, expectedRuleUpdatedAt: '2026-11-01T18:30:00.000Z' });
  });

  it('DELETE sends the marketplace and the version on the query string, no body; no version when none was seen', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { data: { ...INLINE, rule: null, changed: true } })));
    await pricingApi.removeInlinePrice('p1', { marketplaceId: 'keeta', expectedRuleUpdatedAt: '2026-11-01T18:30:00.000Z' });
    expect(req()).toMatchObject({ method: 'DELETE', body: undefined, url: '/api/pricing/products/p1?marketplaceId=keeta&expectedRuleUpdatedAt=2026-11-01T18%3A30%3A00.000Z' });
    expect(req().headers['X-CSRF-Token']).toBe('csrf-token-1');
    expect(req().headers['Content-Type']).toBeUndefined();

    await pricingApi.removeInlinePrice('p1', { marketplaceId: 'keeta' });
    expect(req(1).url).toBe('/api/pricing/products/p1?marketplaceId=keeta');
  });

  it('409 stale and 400 with details come back as ApiError with the plain message, details and request ID', async () => {
    fetchMock.mockResolvedValueOnce(json(409, { error: { code: 'CONFLICT', message: 'This price was changed by someone else; reload it and try again' }, requestId: 'r-1' }));
    const stale = await pricingApi.setInlinePrice('p1', { marketplaceId: 'talabat', mode: 'fixed', value: 1 }).catch((e: unknown) => e) as ApiError;
    expect(stale).toBeInstanceOf(ApiError);
    expect(stale).toMatchObject({ status: 409, code: 'CONFLICT', message: 'This price was changed by someone else; reload it and try again', requestId: 'r-1' });

    fetchMock.mockResolvedValueOnce(json(400, {
      error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: [{ path: 'offer', message: 'A current offer sets this price; change or remove the offer first' }] }, requestId: 'r-2',
    }));
    const bad = await pricingApi.setInlinePrice('p1', { marketplaceId: 'talabat', mode: 'fixed', value: 1 }).catch((e: unknown) => e) as ApiError;
    expect(bad).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(bad.fieldErrors).toEqual({ offer: 'A current offer sets this price; change or remove the offer first' });
  });
});

describe('bulk price change', () => {
  it('preview POSTs the request and answers the preview', async () => {
    fetchMock.mockResolvedValue(json(200, { data: PREVIEW }));
    const body = { marketplaceId: 'talabat' as const, selection: { filter: { q: 'milk', categoryId: '7d1f3c2e-0000-4000-8000-0000000000c1' } }, action: { type: 'set_fixed' as const, price: 5 } };
    expect(await pricingApi.bulkPreview(body)).toEqual(PREVIEW);
    expect(req()).toMatchObject({ url: '/api/pricing/bulk/preview', method: 'POST', body });
    expect(req().headers['X-CSRF-Token']).toBe('csrf-token-1');
  });

  it('apply POSTs the request with the idempotency key and the preview token', async () => {
    fetchMock.mockResolvedValue(json(200, { data: APPLIED }));
    const body = {
      marketplaceId: 'talabat' as const, selection: { productIds: [row.productId] }, action: { type: 'match_erp' as const },
      idempotencyKey: '2c5b7e0a-1f7e-4d0c-9a51-3f2b8d6c4e10', previewToken: 'a'.repeat(64),
    };
    expect(await pricingApi.bulkApply(body)).toEqual(APPLIED);
    expect(req()).toMatchObject({ url: '/api/pricing/bulk/apply', method: 'POST', body });
  });

  it('a 409 on apply is an ApiError with the server message', async () => {
    fetchMock.mockResolvedValue(json(409, { error: { code: 'CONFLICT', message: 'Prices or rules changed since the preview; preview again before applying' }, requestId: 'r-3' }));
    const { marketplaceId, selection, action, previewToken } = PREVIEW;
    await expect(pricingApi.bulkApply({ marketplaceId, selection, action, previewToken, idempotencyKey: 'abcdefgh' }))
      .rejects.toMatchObject({ status: 409, message: 'Prices or rules changed since the preview; preview again before applying' });
  });
});
