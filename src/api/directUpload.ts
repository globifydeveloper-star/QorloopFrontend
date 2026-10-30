import { ApiError } from './client';
import { uploadsApi } from './uploads';
import { UPLOAD_MAX_BYTES } from './types';
import type { UploadContains, UploadRecord, UploadSource, UploadTarget } from './types';

/**
 * Browser -> object storage upload using the pre-signed URL from POST /api/uploads.
 *
 * - Sends exactly `uploadHeaders` (the signature covers them). The browser sets Content-Length itself.
 * - Never sends Authorization, the CSRF header or cookies: the URL is the only credential.
 * - XMLHttpRequest is used for upload progress (fetch has no portable upload-progress API). Its default
 *   withCredentials=false omits cookies cross-origin; if the URL is ever same-origin, where XHR would attach
 *   cookies anyway, this falls back to fetch with credentials 'omit' and reports progress only at the end.
 */
export type DirectUploadErrorCode = 'URL_EXPIRED' | 'PUT_FAILED' | 'NETWORK' | 'ABORTED' | 'INVALID_FILE';

export class DirectUploadError extends Error {
  constructor(readonly code: DirectUploadErrorCode, message: string, readonly status = 0) {
    super(message);
    this.name = 'DirectUploadError';
  }
}

export type { UploadTarget };

/** Which step of create -> PUT -> complete failed. Carries the original error for logging. */
export type UploadStep = 'validate' | 'create' | 'storage' | 'complete';

export class UploadStepError extends Error {
  constructor(
    readonly step: UploadStep,
    message: string,
    readonly original: unknown,
    /** Set from 'storage' on: the upload record exists. On 'complete', retrying complete is safe (idempotent). */
    readonly uploadId?: string,
  ) {
    super(message);
    this.name = 'UploadStepError';
  }
  get aborted() { return this.original instanceof DirectUploadError && this.original.code === 'ABORTED'; }
}

const reason = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Unknown error.');

const expired = (t: UploadTarget, now = Date.now()) => Date.parse(t.uploadUrlExpiresAt) <= now;

const isSameOrigin = (url: string) => {
  if (typeof location === 'undefined') return false;
  try { return new URL(url, location.href).origin === location.origin; } catch { return false; }
};

/** S3 answers 403 AccessDenied "Request has expired" once a pre-signed URL is past its lifetime. */
function failure(t: UploadTarget, status: number, body: string): DirectUploadError {
  if (status === 403 && (/expired/i.test(body) || expired(t))) {
    return new DirectUploadError('URL_EXPIRED', 'The upload link expired before the file was sent. Please upload the file again.', status);
  }
  return new DirectUploadError('PUT_FAILED', `The file could not be stored (HTTP ${status}). Please try again.`, status);
}

export function putFile(
  target: UploadTarget,
  file: Blob,
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<void> {
  if (expired(target)) {
    return Promise.reject(new DirectUploadError('URL_EXPIRED', 'The upload link expired before the file was sent. Please upload the file again.'));
  }
  if (opts.signal?.aborted) return Promise.reject(new DirectUploadError('ABORTED', 'Upload cancelled.'));
  const headers = { ...target.uploadHeaders };

  if (isSameOrigin(target.uploadUrl)) {
    return fetch(target.uploadUrl, { method: target.uploadMethod, headers, body: file, credentials: 'omit', signal: opts.signal })
      .catch((e: Error) => {
        throw e.name === 'AbortError'
          ? new DirectUploadError('ABORTED', 'Upload cancelled.')
          : new DirectUploadError('NETWORK', 'The connection dropped while sending the file. Please try again.');
      })
      .then(async res => {
        if (!res.ok) throw failure(target, res.status, await res.text().catch(() => ''));
        opts.onProgress?.(1);
      });
  }

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(target.uploadMethod, target.uploadUrl);
    xhr.withCredentials = false;
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = e => { if (e.lengthComputable && e.total > 0) opts.onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { opts.onProgress?.(1); resolve(); }
      else reject(failure(target, xhr.status, typeof xhr.responseText === 'string' ? xhr.responseText : ''));
    };
    xhr.onerror = () => reject(new DirectUploadError('NETWORK', 'The connection dropped while sending the file. Please try again.'));
    xhr.onabort = () => reject(new DirectUploadError('ABORTED', 'Upload cancelled.'));
    const onAbort = () => xhr.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    xhr.onloadend = () => opts.signal?.removeEventListener('abort', onAbort);
    xhr.send(file);
  });
}

export function validateFile(file: File): string | null {
  if (file.size < 1) return 'The file is empty.';
  if (file.size > UPLOAD_MAX_BYTES) return 'The file is larger than 25 MB.';
  return null;
}

/** POST /api/uploads/:id/complete, reporting a failure as the 'complete' step. */
export async function completeUpload(uploadId: string): Promise<void> {
  try {
    await uploadsApi.complete(uploadId);
  } catch (e) {
    const why = e instanceof ApiError && e.status === 403 ? 'You do not have permission to finish this upload.' : reason(e);
    throw new UploadStepError('complete', `The file was uploaded, but the server could not start processing it: ${why}`, e, uploadId);
  }
}

/**
 * Full flow: create the upload record, PUT the bytes, then mark it complete. Resolves with the upload ID (taken from
 * the create reply, so it does not depend on what complete returns). Every failure is an UploadStepError naming the step.
 */
export async function uploadFile(args: {
  source: UploadSource;
  contains: UploadContains;
  file: File;
  onCreated?: (upload: UploadRecord) => void;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const invalid = validateFile(args.file);
  if (invalid) throw new UploadStepError('validate', invalid, new DirectUploadError('INVALID_FILE', invalid));

  let created;
  try {
    created = await uploadsApi.create({ source: args.source, fileName: args.file.name, size: args.file.size, contains: args.contains });
  } catch (e) {
    const why = e instanceof ApiError && e.status === 403 ? 'You do not have permission to upload files.' : reason(e);
    throw new UploadStepError('create', `Could not start the upload: ${why}`, e);
  }
  const id = created.upload.id;
  args.onCreated?.(created.upload);

  try {
    await putFile(created.target, args.file, { onProgress: args.onProgress, signal: args.signal });
  } catch (e) {
    const msg = e instanceof DirectUploadError
      ? e.code === 'PUT_FAILED' ? `Storage upload failed (HTTP ${e.status}). Please try again.` : e.message
      : `Storage upload failed: ${reason(e)}`;
    throw new UploadStepError('storage', msg, e, id);
  }

  await completeUpload(id);
  return id;
}
