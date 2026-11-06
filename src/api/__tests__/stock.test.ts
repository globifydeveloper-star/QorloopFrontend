// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../client';
import { stockApi, type ProductStockChange, type StockConflictsPage, type UploadChangesPage } from '../stock';

/**
 * The ADR 017 endpoints against the shapes the backend returns (docs/catalogue-stock-api.md,
 * apps/api/src/catalogue/catalogue-stock.service.ts) and its error envelope ({ error: { code, message, details? }, requestId }).
 */

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let fetchMock: ReturnType<typeof vi.fn>;
const req = (n = 0) => {
  const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit];
  return { url, method: init.method, headers: init.headers as Record<string, string>, body: init.body === undefined ? undefined : JSON.parse(String(init.body)) };
};
const PID = '7d1f3c2e-0000-4000-8000-000000000001';

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  document.cookie = 'qorloop.csrf=csrf-token-1; path=/';
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'qorloop.csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
});

const STOCK: ProductStockChange = {
  productId: PID, erpStock: 12, catalogueStock: 5, source: 'owner',
  conflict: { ownerStock: 5, erpStock: 12, erpStockAtEdit: 8, inEffect: 'owner' },
  edit: { stock: 5, erpStockAtEdit: 8, state: 'conflict', reason: 'Counted', setBy: { id: 'u1', name: 'Amal' }, setAt: '2026-11-05T07:00:00.123Z', updatedAt: '2026-11-06T05:00:00.456Z' },
  changed: true,
};

describe('change review', () => {
  it('GET /api/uploads/:id/changes with kind, conflict and paging; "all" and no conflict are left off the query', async () => {
    const page: UploadChangesPage = {
      upload: { id: 'up_1' } as UploadChangesPage['upload'], changesRecorded: true, kind: 'stock', conflictOnly: true, page: 2, pageSize: 50, total: 51,
      counts: { all: 60, new: 1, price: 4, stock: 51, name: 1, active: 1, missing: 1, returned: 0, other: 1, stockConflicts: 3 },
      rows: [{
        productId: PID, barcode: '628', rowNumber: 7, kind: 'stock', field: 'erpStock', old: 8, new: 12, stockConflict: true,
        product: { nameEn: 'Milk', nameAr: null, status: 'active' }, fixedPriceRule: null,
        catalogueStock: { erpStock: 12, catalogueStock: 5, source: 'owner', conflict: { ownerStock: 5, erpStock: 12, erpStockAtEdit: 8, inEffect: 'owner' } },
      }],
    };
    fetchMock.mockResolvedValueOnce(json(200, { data: page })).mockResolvedValueOnce(json(200, { data: { ...page, kind: 'all' } }));
    expect(await stockApi.uploadChanges('up 1', { kind: 'stock', conflict: true, page: 2, pageSize: 50 })).toEqual(page);
    expect(req().url).toBe('/api/uploads/up%201/changes?kind=stock&conflict=true&page=2&pageSize=50');
    expect(req().method).toBe('GET');
    await stockApi.uploadChanges('up_1', { kind: 'all', conflict: false });
    expect(req(1).url).toBe('/api/uploads/up_1/changes');
  });

  it('a 409 for an upload that is not applied keeps the server message', async () => {
    fetchMock.mockResolvedValueOnce(json(409, { error: { code: 'CONFLICT', message: 'This upload has not been applied; its proposed changes are under /review' }, requestId: 'r1' }));
    const e = await stockApi.uploadChanges('up_1').catch(x => x) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect([e.status, e.message, e.requestId]).toEqual([409, 'This upload has not been applied; its proposed changes are under /review', 'r1']);
  });
});

describe('conflicts', () => {
  it('GET the list with paging, and the badge count', async () => {
    const page: StockConflictsPage = {
      inEffect: 'owner', page: 1, pageSize: 50, total: 1,
      rows: [{ productId: PID, barcode: '628', nameEn: 'Milk', nameAr: null, status: 'active', erpStock: 12, ownerStock: 5, erpStockAtEdit: 8, catalogueStock: 5,
        reason: null, setBy: { id: 'u1', name: 'Amal' }, setAt: '2026-11-05T07:00:00.000Z', conflictUploadId: 'up_2', conflictAt: '2026-11-06T05:00:00.000Z', updatedAt: '2026-11-06T05:00:00.000Z' }],
    };
    fetchMock.mockResolvedValueOnce(json(200, { data: page })).mockResolvedValueOnce(json(200, { data: { count: 4 } }));
    expect(await stockApi.conflicts(1, 50)).toEqual(page);
    expect(req().url).toBe('/api/catalogue/stock/conflicts?page=1&pageSize=50');
    expect(await stockApi.conflictCount()).toEqual({ count: 4 });
    expect(req(1).url).toBe('/api/catalogue/stock/conflicts/count');
  });
});

describe('one product', () => {
  it('GET, PUT with expected values and CSRF, DELETE with the expected values on the query, POST resolve', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { data: STOCK })));
    expect(await stockApi.get(PID)).toEqual(STOCK);
    expect(req(0)).toMatchObject({ url: `/api/products/${PID}/stock`, method: 'GET' });
    expect(req(0).headers['X-CSRF-Token']).toBeUndefined();

    await stockApi.set(PID, { stock: 9, reason: 'Counted', expected: { erpStock: 12, catalogueStock: 5 } });
    expect(req(1)).toMatchObject({ url: `/api/products/${PID}/stock`, method: 'PUT', body: { stock: 9, reason: 'Counted', expected: { erpStock: 12, catalogueStock: 5 } } });
    expect(req(1).headers['X-CSRF-Token']).toBe('csrf-token-1');

    await stockApi.reset(PID, { erpStock: 12, catalogueStock: 5 });
    expect(req(2)).toMatchObject({ url: `/api/products/${PID}/stock?expectedErpStock=12&expectedCatalogueStock=5`, method: 'DELETE', body: undefined });
    expect(req(2).headers['X-CSRF-Token']).toBe('csrf-token-1');

    await stockApi.resolve(PID, { choice: 'keep', expected: { erpStock: 12, ownerStock: 5 } });
    expect(req(3)).toMatchObject({ url: `/api/products/${PID}/stock/resolve`, method: 'POST', body: { choice: 'keep', expected: { erpStock: 12, ownerStock: 5 } } });
  });

  it('a 400 keeps details[].path for the field messages', async () => {
    fetchMock.mockResolvedValueOnce(json(400, { error: { code: 'VALIDATION', message: 'Validation failed', details: [{ path: 'stock', message: 'Too big' }] } }));
    const e = await stockApi.set(PID, { stock: 1, expected: { erpStock: 1, catalogueStock: 1 } }).catch(x => x) as ApiError;
    expect(e.fieldErrors).toEqual({ stock: 'Too big' });
  });
});

describe('bulk', () => {
  it('stock preview and apply send the selection, the action and (apply) the key and token', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { data: {} })));
    const body = { selection: { productIds: [PID] }, action: { mode: 'set' as const, stock: 4 }, reason: 'Count' };
    await stockApi.bulkPreview(body);
    expect(req(0)).toMatchObject({ url: '/api/catalogue/stock/bulk/preview', method: 'POST', body });
    await stockApi.bulkApply({ ...body, idempotencyKey: 'key-12345678', previewToken: 'a'.repeat(64) });
    expect(req(1)).toMatchObject({ url: '/api/catalogue/stock/bulk/apply', method: 'POST', body: { ...body, idempotencyKey: 'key-12345678', previewToken: 'a'.repeat(64) } });
  });

  it('conflict resolve preview and apply', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { data: {} })));
    await stockApi.conflictsPreview({ selection: { all: true }, choice: 'erp' });
    expect(req(0)).toMatchObject({ url: '/api/catalogue/stock/conflicts/resolve/preview', body: { selection: { all: true }, choice: 'erp' } });
    await stockApi.conflictsApply({ selection: { all: true }, choice: 'erp', idempotencyKey: 'key-12345678' });
    expect(req(1)).toMatchObject({ url: '/api/catalogue/stock/conflicts/resolve/apply', body: { selection: { all: true }, choice: 'erp', idempotencyKey: 'key-12345678' } });
  });
});
