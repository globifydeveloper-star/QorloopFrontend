import { ApiError, api } from './client';
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
  discard: (id: string) => api<UploadRecord>(`/api/uploads/${enc(id)}/discard`, { method: 'POST' }),
};

/** Statuses after which the backend will not move on by itself: polling stops here. */
export const isSettled = (s: UploadStatus | undefined) => s !== undefined && s !== 'uploading' && s !== 'processing';

/** Poll interval for GET /api/uploads/:id while the backend is working. */
export const UPLOAD_POLL_MS = 2000;
