// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectUploadError, UploadStepError, putFile, uploadFile } from '../directUpload';
import type { UploadTarget } from '../directUpload';

/** Minimal XMLHttpRequest stand-in that records what was sent and lets each test decide the outcome. */
class FakeXHR {
  static last: FakeXHR;
  static respond: (x: FakeXHR) => void = x => x.finish(200);
  method = ''; url = ''; body: unknown; withCredentials = false; status = 0; responseText = '';
  headers: Record<string, string> = {};
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null; onerror: (() => void) | null = null; onabort: (() => void) | null = null; onloadend: (() => void) | null = null;
  constructor() { FakeXHR.last = this; }
  open(m: string, u: string) { this.method = m; this.url = u; }
  setRequestHeader(k: string, v: string) { this.headers[k] = v; }
  send(b: unknown) { this.body = b; queueMicrotask(() => FakeXHR.respond(this)); }
  abort() { this.onabort?.(); this.onloadend?.(); }
  finish(status: number, text = '') {
    this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
    this.status = status; this.responseText = text; this.onload?.(); this.onloadend?.();
  }
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const future = () => new Date(Date.now() + 10 * 60_000).toISOString();
const target = (over: Partial<UploadTarget> = {}): UploadTarget => ({
  uploadUrl: 'https://bucket.s3.amazonaws.com/tenant/up_1?X-Amz-Signature=abc',
  uploadMethod: 'PUT',
  uploadHeaders: { 'Content-Type': 'text/csv', 'x-amz-server-side-encryption': 'AES256' },
  uploadUrlExpiresAt: future(),
  ...over,
});
const file = () => new File(['barcode,price\n1,2\n'], 'talabat.csv', { type: 'text/csv' });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  FakeXHR.respond = x => x.finish(200);
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  document.cookie = 'qorloop.csrf=tok; path=/';
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'qorloop.csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
});

describe('putFile', () => {
  it('PUTs the file with exactly the signed headers, no credentials, and reports progress', async () => {
    const progress: number[] = [];
    const f = file();
    await putFile(target(), f, { onProgress: p => progress.push(p) });
    const x = FakeXHR.last;
    expect(x.method).toBe('PUT');
    expect(x.url).toBe(target().uploadUrl);
    expect(x.headers).toEqual({ 'Content-Type': 'text/csv', 'x-amz-server-side-encryption': 'AES256' });
    expect(Object.keys(x.headers).map(h => h.toLowerCase())).not.toContain('authorization');
    expect(Object.keys(x.headers).map(h => h.toLowerCase())).not.toContain('x-csrf-token');
    expect(Object.keys(x.headers).map(h => h.toLowerCase())).not.toContain('content-length');
    expect(x.withCredentials).toBe(false);
    expect(x.body).toBe(f);
    expect(progress).toEqual([0.5, 1]);
  });

  it('rejects an already-expired URL without sending anything', async () => {
    const sent = vi.spyOn(FakeXHR.prototype, 'send');
    await expect(putFile(target({ uploadUrlExpiresAt: new Date(Date.now() - 1000).toISOString() }), file()))
      .rejects.toMatchObject({ code: 'URL_EXPIRED' });
    expect(sent).not.toHaveBeenCalled();
  });

  it('maps a storage 403 "Request has expired" to URL_EXPIRED', async () => {
    FakeXHR.respond = x => x.finish(403, '<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>');
    await expect(putFile(target(), file())).rejects.toMatchObject({ code: 'URL_EXPIRED', status: 403 });
  });

  it('maps other failed PUTs to PUT_FAILED with the status', async () => {
    FakeXHR.respond = x => x.finish(500, 'InternalError');
    const err = await putFile(target(), file()).catch(e => e);
    expect(err).toBeInstanceOf(DirectUploadError);
    expect(err).toMatchObject({ code: 'PUT_FAILED', status: 500 });
  });

  it('maps a dropped connection to NETWORK', async () => {
    FakeXHR.respond = x => x.onerror?.();
    await expect(putFile(target(), file())).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('can be cancelled', async () => {
    FakeXHR.respond = () => undefined; // never finishes on its own
    const ctrl = new AbortController();
    const p = putFile(target(), file(), { signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('uses fetch with credentials "omit" when the URL is same-origin (XHR would attach cookies)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    await putFile(target({ uploadUrl: `${location.origin}/storage/up_1` }), file());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${location.origin}/storage/up_1`);
    expect(init).toMatchObject({ method: 'PUT', credentials: 'omit', headers: { 'Content-Type': 'text/csv', 'x-amz-server-side-encryption': 'AES256' } });
  });
});

describe('uploadFile', () => {
  const record = {
    id: 'up_1', source: 'snoonu', fileName: 'talabat.csv', size: 18, contains: 'partial', status: 'uploading',
    step: null, progress: 0, summary: null, errorMessage: null, uploadedById: 'usr_1', createdAt: '', updatedAt: '', appliedAt: null,
  };
  /** POST /api/uploads reply: the record with the storage target fields alongside it. */
  const flat = (over: Partial<UploadTarget> = {}) => ({ ...record, ...target(over) });
  const nested = () => ({ upload: record, ...target() });
  const fail = (status: number, code: string, message: string) => json(status, { error: { code, message } });
  const run = () => uploadFile({ source: 'snoonu', contains: 'partial', file: file() });
  const step = (e: unknown) => e as UploadStepError;

  // Regression: the PUT returned 200 but complete was never sent. With a flat create reply, `reply.upload.id` threw a
  // TypeError after the PUT, which the modal showed as "Something went wrong. Please try again."
  it.each([['flat', flat], ['nested', nested]])('a %s create reply + 200 PUT with empty body and no ETag calls complete', async (_n, reply) => {
    FakeXHR.respond = x => x.finish(200, '');
    fetchMock
      .mockResolvedValueOnce(json(201, { data: reply() }))
      .mockResolvedValueOnce(new Response(null, { status: 204 })); // complete may answer with no body at all
    const f = file();
    await expect(uploadFile({ source: 'snoonu', contains: 'partial', file: f })).resolves.toBe('up_1');
    expect(fetchMock.mock.calls.map(c => [c[0], (c[1] as RequestInit).method])).toEqual([
      ['/api/uploads', 'POST'],
      ['/api/uploads/up_1/complete', 'POST'],
    ]);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ source: 'snoonu', fileName: 'talabat.csv', size: f.size, contains: 'partial' });
    expect(FakeXHR.last.url).toBe(target().uploadUrl);
  });

  it('create failed: names the step and keeps the API message; nothing is PUT', async () => {
    const sent = vi.spyOn(FakeXHR.prototype, 'send');
    fetchMock.mockResolvedValueOnce(fail(400, 'VALIDATION_ERROR', 'File must be at most 25 MB'));
    const e = step(await run().catch(x => x));
    expect(e).toBeInstanceOf(UploadStepError);
    expect(e).toMatchObject({ step: 'create', message: 'Could not start the upload: File must be at most 25 MB' });
    expect(sent).not.toHaveBeenCalled();
  });

  it('create reply without an ID or storage URL is a create failure, not a crash after the PUT', async () => {
    fetchMock.mockResolvedValueOnce(json(201, { data: { status: 'uploading' } }));
    const e = step(await run().catch(x => x));
    expect(e).toMatchObject({ step: 'create', message: 'Could not start the upload: The server did not return an upload ID and storage address.' });
  });

  it('storage failed: reports the HTTP status and does not call complete', async () => {
    fetchMock.mockResolvedValueOnce(json(201, { data: flat() }));
    FakeXHR.respond = x => x.finish(503, 'SlowDown');
    const onCreated = vi.fn();
    const e = step(await uploadFile({ source: 'snoonu', contains: 'partial', file: file(), onCreated }).catch(x => x));
    expect(e).toMatchObject({ step: 'storage', uploadId: 'up_1', message: 'Storage upload failed (HTTP 503). Please try again.' });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'up_1' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('storage: an already-expired URL is reported as such and complete is not called', async () => {
    fetchMock.mockResolvedValueOnce(json(201, { data: flat({ uploadUrlExpiresAt: new Date(0).toISOString() }) }));
    const e = step(await run().catch(x => x));
    expect(e.step).toBe('storage');
    expect(e.message).toMatch(/upload link expired/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('complete failed: names the step, keeps the API message, and carries the ID for a retry', async () => {
    fetchMock
      .mockResolvedValueOnce(json(201, { data: flat() }))
      .mockResolvedValueOnce(fail(409, 'INVALID_STATE', 'Upload object not found in storage'));
    const e = step(await run().catch(x => x));
    expect(e).toMatchObject({ step: 'complete', uploadId: 'up_1', message: 'The file was uploaded, but the server could not start processing it: Upload object not found in storage' });
  });

  it('rejects empty and >25 MB files before calling the API', async () => {
    await expect(uploadFile({ source: 'erp', contains: 'full', file: new File([], 'empty.csv') })).rejects.toMatchObject({ step: 'validate' });
    const big = new File(['x'], 'big.csv');
    Object.defineProperty(big, 'size', { value: 25 * 1024 * 1024 + 1 });
    await expect(uploadFile({ source: 'erp', contains: 'full', file: big })).rejects.toMatchObject({ step: 'validate' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
