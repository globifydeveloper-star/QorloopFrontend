import { ApiError, api, apiBlob } from './client';
import type {
  CreateUploadRequest, CreateUploadResponse, CreatedUpload, ReviewTab, SaveMappingRequest, UploadDetail, UploadErrorsPage,
  UploadRecord, UploadReviewPage, UploadStatus, UploadTarget,
} from './types';

const enc = encodeURIComponent;

/**
 * Splits the POST /api/uploads reply into the record and the storage target. The reply is flat (record fields next
 * to uploadUrl…); a nested `{ upload, …target }` reply is accepted too. Reading `reply.upload.id` from a flat reply
 * used to throw after the PUT had already succeeded, so complete was never sent.
 */
export function splitCreated(reply: CreateUploadResponse | ({ upload: UploadRecord } & UploadTarget)): CreatedUpload {
  const { uploadUrl, uploadMethod, uploadHeaders, uploadUrlExpiresAt, ...rest } = reply ?? ({} as CreateUploadResponse);
  const upload = 'upload' in rest && rest.upload ? rest.upload : (rest as UploadRecord);
  if (!upload?.id || !uploadUrl || !uploadHeaders) {
    throw new ApiError(0, 'BAD_RESPONSE', 'The server did not return an upload ID and storage address.');
  }
  return { upload, target: { uploadUrl, uploadMethod: uploadMethod ?? 'PUT', uploadHeaders, uploadUrlExpiresAt } };
}

export const uploadsApi = {
  create: async (body: CreateUploadRequest) =>
    splitCreated(await api<CreateUploadResponse>('/api/uploads', { method: 'POST', body })),
  /** Idempotent; only the user who created the upload may call it. */
  complete: (id: string) => api<UploadRecord>(`/api/uploads/${enc(id)}/complete`, { method: 'POST' }),
  list: () => api<UploadRecord[]>('/api/uploads'),
  get: (id: string, signal?: AbortSignal) => api<UploadDetail>(`/api/uploads/${enc(id)}`, { signal }),
  /** Only valid while the upload is needs_review. */
  review: (id: string, tab: ReviewTab, page = 1, pageSize = 50) =>
    api<UploadReviewPage>(`/api/uploads/${enc(id)}/review`, { query: { tab, page, pageSize } }),
  errors: (id: string, page = 1) => api<UploadErrorsPage>(`/api/uploads/${enc(id)}/errors`, { query: { page } }),
  saveMapping: (id: string, body: SaveMappingRequest) =>
    api<UploadRecord>(`/api/uploads/${enc(id)}/mapping`, { method: 'POST', body }),
  /**
   * Starts writing a needs_review upload to the catalogue (needs uploads.apply). Replies with the upload in `applying`;
   * poll get() until `applied`, or `needs_review` with errorMessage (failed and rolled back).
   */
  apply: (id: string) => api<UploadRecord>(`/api/uploads/${enc(id)}/apply`, { method: 'POST' }),
  discard: (id: string) => api<UploadRecord>(`/api/uploads/${enc(id)}/discard`, { method: 'POST' }),
  /** The row errors as an .xlsx (the backend caps it at ERRORS_XLSX_LIMIT rows). */
  downloadErrors: async (id: string): Promise<{ blob: Blob; fileName: string }> => {
    const { blob, headers } = await apiBlob(`/api/uploads/${enc(id)}/errors.xlsx`);
    return { blob, fileName: fileNameFrom(headers.get('Content-Disposition')) ?? 'row-errors.xlsx' };
  },
};

/** Rows the errors.xlsx export holds at most. */
export const ERRORS_XLSX_LIMIT = 5000;

/** File name from a Content-Disposition header: RFC 5987 `filename*=UTF-8''…` first, then `filename="…"`. */
export function fileNameFrom(header: string | null): string | undefined {
  if (!header) return undefined;
  const star = /filename\*\s*=\s*(?:[\w-]+)?'[^']*'([^;]+)/i.exec(header);
  if (star) {
    try { return clean(decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''))); } catch { /* fall through */ }
  }
  const plain = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i.exec(header);
  return plain ? clean((plain[1] ?? plain[2]).replace(/\\(.)/g, '$1').trim()) : undefined;
}
// Never let a header choose a folder.
const clean = (name: string) => name.replace(/[/\\]/g, '_') || undefined;

/** Statuses after which the backend will not move on by itself: polling stops here. */
export const isSettled = (s: UploadStatus | undefined) =>
  s !== undefined && s !== 'uploading' && s !== 'processing' && s !== 'applying';

/** Poll interval for GET /api/uploads/:id while the backend is working. */
export const UPLOAD_POLL_MS = 2000;
