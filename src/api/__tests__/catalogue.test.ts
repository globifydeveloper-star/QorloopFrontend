// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../client';
import { productsApi, readinessGaps } from '../products';
import { categoriesApi, indexCategories, inUseSummary } from '../categories';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fail = (status: number, message: string, details?: unknown[]) =>
  json(status, { error: { code: status === 409 ? 'CONFLICT' : 'BAD_REQUEST', message, details } });

let fetchMock: ReturnType<typeof vi.fn>;
const call = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined };
};
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  document.cookie = 'qorloop.csrf=tok; path=/';
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'qorloop.csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
});

const page = { items: [], nextCursor: 'c2', counts: { all: 3, active: 1, inactive: 0, new: 2, missing: 0 } };

describe('productsApi', () => {
  it('list sends only the set query parameters and unwraps { data }', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { data: page })));
    expect(await productsApi.list({ q: '  milk ', tab: 'new', categoryId: 'cat_1', cursor: 'c1', limit: 50 })).toEqual(page);
    expect(call().url).toBe('/api/products?q=milk&tab=new&categoryId=cat_1&cursor=c1&limit=50');
    expect(call().init.method).toBe('GET');
    expect(call().headers['X-CSRF-Token']).toBeUndefined();

    await productsApi.list({ q: '   ', subcategoryId: 'sub_1' });
    expect(call(1).url).toBe('/api/products?subcategoryId=sub_1');
  });

  it('get and update use the documented paths; update is a PATCH with CSRF and the exact body', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { data: { id: 'p 1' } })));
    await productsApi.get('p 1');
    await productsApi.update('p 1', { nameAr: 'حليب', categoryId: null, expectedUpdatedAt: '2026-10-30T08:00:00.000Z' });
    expect(call(0).url).toBe('/api/products/p%201');
    expect(call(1)).toMatchObject({ url: '/api/products/p%201', init: { method: 'PATCH', credentials: 'include' } });
    expect(call(1).headers['X-CSRF-Token']).toBe('tok');
    expect(call(1).body).toEqual({ nameAr: 'حليب', categoryId: null, expectedUpdatedAt: '2026-10-30T08:00:00.000Z' });
  });

  it('update surfaces a 409 as an ApiError with status 409, and field errors by path', async () => {
    fetchMock.mockResolvedValueOnce(fail(409, 'This product was changed by someone else; reload it and try again'));
    await expect(productsApi.update('p1', { status: 'inactive' })).rejects.toMatchObject({ status: 409 });

    fetchMock.mockResolvedValueOnce(fail(400, 'Validation failed', [{ path: 'nameAr', message: 'Too long' }]));
    const err = await productsApi.update('p1', { nameAr: 'x' }).catch(e => e as ApiError);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).fieldErrors).toEqual({ nameAr: 'Too long' });
  });

  it('activate POSTs { ids } or { all: true }', async () => {
    const result = { activated: 1, skipped: [{ id: 'p2', reason: 'Arabic name missing' }], skippedCount: 1 };
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { data: result })));
    expect(await productsApi.activate({ ids: ['p1', 'p2'] })).toEqual(result);
    await productsApi.activate({ all: true });
    expect(call(0)).toMatchObject({ url: '/api/products/activate', init: { method: 'POST' } });
    expect(call(0).body).toEqual({ ids: ['p1', 'p2'] });
    expect(call(1).body).toEqual({ all: true });
  });

  it('readinessGaps mirrors the default rule', () => {
    expect(readinessGaps({ nameAr: ' ', categoryId: null })).toEqual(['Arabic name missing', 'Category missing']);
    expect(readinessGaps({ nameAr: 'حليب', categoryId: 'c' })).toEqual([]);
  });
});

describe('categoriesApi', () => {
  it('uses the documented methods and paths', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { data: {} })));
    await categoriesApi.tree();
    await categoriesApi.erpSuggestions();
    await categoriesApi.create({ nameEn: 'Dairy', parentId: 'c1' });
    await categoriesApi.update('c1', { nameEn: 'Dairy & eggs' });
    await categoriesApi.remove('c1');
    await categoriesApi.assignFromErp('c1', ['DAIRY', 'MILK']);
    expect(fetchMock.mock.calls.map((_, i) => [call(i).init.method, call(i).url])).toEqual([
      ['GET', '/api/categories'],
      ['GET', '/api/categories/erp-suggestions'],
      ['POST', '/api/categories'],
      ['PATCH', '/api/categories/c1'],
      ['DELETE', '/api/categories/c1'],
      ['POST', '/api/categories/c1/assign-from-erp'],
    ]);
    expect(call(2).body).toEqual({ nameEn: 'Dairy', parentId: 'c1' });
    expect(call(3).body).toEqual({ nameEn: 'Dairy & eggs' });
    expect(call(4).init.body).toBeUndefined();
    expect(call(4).headers['X-CSRF-Token']).toBe('tok');
    expect(call(5).body).toEqual({ erpCategories: ['DAIRY', 'MILK'] });
  });

  it('inUseSummary reads the 409 counts; other errors give undefined', async () => {
    fetchMock.mockResolvedValueOnce(fail(409, 'This category is still in use', [
      { path: 'products', count: 12 }, { path: 'children', count: 1 }, { path: 'priceRules', count: 2 },
    ]));
    const err = await categoriesApi.remove('c1').catch(e => e);
    expect(inUseSummary(err)).toBe('12 products, 1 subcategory, 2 price rules');

    fetchMock.mockResolvedValueOnce(fail(409, 'A category with this name already exists here'));
    expect(inUseSummary(await categoriesApi.create({ nameEn: 'Dairy' }).catch(e => e))).toBeUndefined();
    expect(inUseSummary(new Error('x'))).toBeUndefined();
  });

  it('indexCategories flattens the two-level tree', () => {
    const sub = { id: 's1', parentId: 'c1', nameEn: 'Milk', nameAr: null, sort: 0, productCount: 2 };
    const map = indexCategories([{ id: 'c1', parentId: null, nameEn: 'Dairy', nameAr: null, sort: 0, productCount: 5, children: [sub] }]);
    expect([...map.keys()]).toEqual(['c1', 's1']);
    expect(map.get('s1')).toBe(sub);
  });
});
