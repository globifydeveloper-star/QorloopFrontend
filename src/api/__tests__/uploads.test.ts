// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, onSessionExpired } from '../client';
import { isSettled, uploadsApi } from '../uploads';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fail = (status: number, code: string, message: string, details?: { path?: string; message: string }[]) =>
  json(status, { error: { code, message, details } });

const record = {
  id: 'up_1', source: 'talabat', fileName: 'talabat.xlsx', size: 2048, contains: 'full', status: 'uploading',
  step: null, progress: null, summary: null, errorMessage: null, uploadedById: 'usr_1',
  createdAt: '2026-10-30T08:00:00.000Z', updatedAt: '2026-10-30T08:00:00.000Z', appliedAt: null,
};

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

describe('uploadsApi: success paths', () => {
  const storage = {
    uploadUrl: 'https://bucket.s3.amazonaws.com/k?X-Amz-Signature=s', uploadMethod: 'PUT',
    uploadHeaders: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'x-amz-server-side-encryption': 'AES256' },
    uploadUrlExpiresAt: '2026-10-30T08:15:00.000Z',
  };

  it('create POSTs exactly the documented body with CSRF and cookies, and splits a flat reply into record + target', async () => {
    fetchMock.mockResolvedValue(json(201, { data: { ...record, ...storage } }));
    const res = await uploadsApi.create({ source: 'talabat', fileName: 'talabat.xlsx', size: 2048, contains: 'full' });
    expect(res).toEqual({ upload: record, target: storage });
    const c = call();
    expect(c.url).toBe('/api/uploads');
    expect(c.init).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(c.headers['X-CSRF-Token']).toBe('tok');
    expect(c.body).toEqual({ source: 'talabat', fileName: 'talabat.xlsx', size: 2048, contains: 'full' });
  });

  it('create also accepts a nested { upload, ...target } reply, and rejects one without an ID', async () => {
    fetchMock.mockResolvedValueOnce(json(201, { data: { upload: record, ...storage } }));
    expect(await uploadsApi.create({ source: 'erp', fileName: 'a.csv', size: 1, contains: 'full' })).toEqual({ upload: record, target: storage });
    fetchMock.mockResolvedValueOnce(json(201, { data: { ...storage } }));
    await expect(uploadsApi.create({ source: 'erp', fileName: 'a.csv', size: 1, contains: 'full' })).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('complete, discard and mapping are POSTs to the documented paths', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { data: record })));
    await uploadsApi.complete('up_1');
    await uploadsApi.discard('up_1');
    await uploadsApi.saveMapping('up_1', { fields: { barcode: 'EAN', price: 'Price' }, saveAs: 'Talabat export' });
    expect([0, 1, 2].map(i => [call(i).init.method, call(i).url])).toEqual([
      ['POST', '/api/uploads/up_1/complete'],
      ['POST', '/api/uploads/up_1/discard'],
      ['POST', '/api/uploads/up_1/mapping'],
    ]);
    expect(call(0).init.body).toBeUndefined();
    expect(call(2).body).toEqual({ fields: { barcode: 'EAN', price: 'Price' }, saveAs: 'Talabat export' });
  });

  it('list, get, review and errors are GETs without a CSRF header; review sends tab/page/pageSize', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { data: {} })));
    await uploadsApi.list();
    await uploadsApi.get('up_1');
    await uploadsApi.review('up_1', 'availability', 2, 25);
    await uploadsApi.errors('up_1', 3);
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      '/api/uploads',
      '/api/uploads/up_1',
      '/api/uploads/up_1/review?tab=availability&page=2&pageSize=25',
      '/api/uploads/up_1/errors?page=3',
    ]);
    for (let i = 0; i < 4; i++) {
      expect(call(i).init.method).toBe('GET');
      expect(call(i).headers['X-CSRF-Token']).toBeUndefined();
    }
  });

  it('unwraps the review and errors pages in the backend shapes', async () => {
    const reviewPage = {
      upload: { ...record, status: 'needs_review' }, tab: 'price', page: 1, pageSize: 50, total: 1, errorCount: 2,
      rows: [{ rowNumber: 2, changeType: 'price', matchProductId: 'prd_1', parsed: { data: { barcode: '628100' }, change: { price: { old: 10, new: 12.5 } } } }],
    };
    const errorsPage = { page: 1, total: 2, errors: [{ row: 7, column: 'Price', value: 'abc', reason: 'Not a number' }] };
    fetchMock.mockResolvedValueOnce(json(200, { data: reviewPage })).mockResolvedValueOnce(json(200, { data: errorsPage }));
    const review = await uploadsApi.review('up_1', 'price');
    expect(review.rows[0].parsed.change.price).toEqual({ old: 10, new: 12.5 });
    expect((await uploadsApi.errors('up_1')).errors[0]).toEqual({ row: 7, column: 'Price', value: 'abc', reason: 'Not a number' });
  });

  it('escapes IDs in paths', async () => {
    fetchMock.mockResolvedValue(json(200, { data: record }));
    await uploadsApi.get('a/b?c');
    expect(call().url).toBe('/api/uploads/a%2Fb%3Fc');
  });

  it('only uploading/processing keep polling', () => {
    expect(isSettled('uploading')).toBe(false);
    expect(isSettled('processing')).toBe(false);
    for (const s of ['needs_mapping', 'needs_review', 'rejected', 'failed', 'discarded'] as const) expect(isSettled(s)).toBe(true);
    expect(isSettled(undefined)).toBe(false);
  });
});

describe('uploadsApi: errors', () => {
  it('400 validation exposes field errors', async () => {
    fetchMock.mockResolvedValue(fail(400, 'VALIDATION_ERROR', 'Validation failed', [{ path: 'size', message: 'File must be at most 25 MB' }]));
    const err = (await uploadsApi.create({ source: 'erp', fileName: 'x.xlsx', size: 30_000_000, contains: 'full' }).catch(e => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(err.fieldErrors).toEqual({ size: 'File must be at most 25 MB' });
  });

  it('401 announces an expired session', async () => {
    const listener = vi.fn();
    const off = onSessionExpired(listener);
    fetchMock.mockResolvedValue(fail(401, 'UNAUTHENTICATED', 'Session expired or invalid'));
    await expect(uploadsApi.list()).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it('403 is a permission error, not a session expiry', async () => {
    const listener = vi.fn();
    const off = onSessionExpired(listener);
    fetchMock.mockResolvedValue(fail(403, 'FORBIDDEN', 'Missing permission uploads.discard'));
    await expect(uploadsApi.discard('up_1')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', message: 'Missing permission uploads.discard' });
    expect(listener).not.toHaveBeenCalled();
    off();
  });

  it('409 (wrong state) surfaces the backend code and message', async () => {
    fetchMock.mockResolvedValue(fail(409, 'INVALID_STATE', 'Upload is not awaiting review'));
    await expect(uploadsApi.review('up_1', 'price')).rejects.toMatchObject({ status: 409, code: 'INVALID_STATE', message: 'Upload is not awaiting review' });
  });
});
