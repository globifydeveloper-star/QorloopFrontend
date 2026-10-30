/**
 * Request/response types for the Qorloop API.
 *
 * Source of truth: the backend repository (QorLoopBackend) —
 *   packages/shared/src/contracts.ts   (request bodies, Zod)
 *   apps/api/src/auth/*.controller.ts  (responses)
 * They are mirrored here by hand and verified by the Playwright suite in e2e/ against a real backend.
 * Do not add a type here for an endpoint the backend does not have yet.
 */

export type Role = 'owner' | 'admin' | 'catalogue_manager' | 'analyst';
export const ROLES: readonly Role[] = ['owner', 'admin', 'catalogue_manager', 'analyst'];
export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  catalogue_manager: 'Catalogue Manager',
  analyst: 'Analyst',
};

/** Permission names are defined by the backend (packages/core/src/roles.ts). The UI only checks membership. */
export type Permission = string;

export type AuthState = 'authenticated' | 'mfa_setup_required' | 'mfa_required';

export interface SessionResponse {
  state: AuthState;
  csrfToken: string;
  expiresAt: string;
  /** Returned once, after MFA enrollment is verified. Never stored by the app. */
  recoveryCodes?: string[];
}

export interface Me {
  user: { id: string; email: string; name: string };
  role: Role;
  permissions: Permission[];
  tenant: { id: string; name: string; slug: string };
  mfaEnabled: boolean;
  expiresAt: string;
}

export interface TeamMember {
  id: string;
  role: Role;
  active: boolean;
  createdAt: string;
  user: { id: string; email: string; name: string; mfaEnabled: boolean };
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  createdAt?: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string | string[]; details?: { path?: string; message: string }[] };
  requestId?: string;
}

// ---- Uploads (POST/GET /api/uploads…). Mirrors the backend's upload routes; see its uploads module.

export type UploadSource = 'erp' | 'talabat' | 'snoonu' | 'rafeeq' | 'keeta';
export const UPLOAD_SOURCES: readonly UploadSource[] = ['erp', 'talabat', 'snoonu', 'rafeeq', 'keeta'];
export type UploadContains = 'full' | 'partial';
export type UploadStatus = 'uploading' | 'processing' | 'needs_mapping' | 'needs_review' | 'rejected' | 'failed' | 'discarded';
/** The backend accepts 1 byte .. 25 MB (exact bytes). */
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

export interface CreateUploadRequest {
  source: UploadSource;
  fileName: string;
  size: number;
  contains: UploadContains;
}

/** Set once the file has been read (needs_review onwards). */
export interface UploadSummary {
  rowsRead: number;
  matched: number;
  newProducts: number;
  rowsWithErrors: number;
  priceChanges: number;
  stockChanges: number;
  missingFromFile: number;
  unmatched: number;
  contains: UploadContains;
  firstImport: boolean;
  /** A few of the catalogue products missing from a full file. Element shape is not part of this contract yet. */
  missingSample: unknown[];
}

export interface UploadRecord {
  id: string;
  source: UploadSource;
  fileName: string;
  size: number;
  contains: UploadContains;
  status: UploadStatus;
  step: string | null;
  /** 0..100 while processing. */
  progress: number | null;
  summary: UploadSummary | null;
  errorMessage: string | null;
  uploadedById: string;
  createdAt: string;
  updatedAt: string;
  appliedAt: string | null;
}

/** Where the browser PUTs the file bytes. */
export interface UploadTarget {
  uploadUrl: string;
  uploadMethod: 'PUT';
  uploadHeaders: { 'Content-Type': string; 'x-amz-server-side-encryption': string };
  uploadUrlExpiresAt: string;
}

/**
 * POST /api/uploads: the upload record with the storage target fields alongside it (flat). A nested
 * `{ upload, ...target }` reply is also accepted; uploadsApi.create normalises both to `CreatedUpload`.
 */
export type CreateUploadResponse = UploadRecord & UploadTarget;

export interface CreatedUpload {
  upload: UploadRecord;
  target: UploadTarget;
}

export interface MappingField {
  key: string;
  label: string;
  required: boolean;
}

export interface MappingSuggestion {
  /** { <qorloopFieldKey>: "<column header>" } */
  fields: Record<string, string>;
  /** Required field keys the backend could not match to any column. */
  missingRequired: string[];
  /** 0..1 */
  confidence: number;
}

/** GET /api/uploads/:id. `headers`, `mappingSuggestion` and `fields` are present only when status is needs_mapping. */
export interface UploadDetail extends UploadRecord {
  headers?: string[];
  mappingSuggestion?: MappingSuggestion;
  fields?: MappingField[];
}

export type ReviewTab = 'price' | 'stock' | 'availability' | 'new' | 'unmatched' | 'all';
export const REVIEW_TABS: readonly ReviewTab[] = ['price', 'stock', 'availability', 'new', 'unmatched', 'all'];

export type ChangeType = 'new' | 'price' | 'stock' | 'price_stock' | 'availability' | 'price_availability' | 'none' | 'unmatched';

export type ChangeValue = string | number | boolean | null;
export interface ValueChange {
  old: ChangeValue;
  new: ChangeValue;
}

export interface ReviewRow {
  rowNumber: number;
  changeType: ChangeType;
  matchProductId: string | null;
  parsed: {
    /** The parsed file row, keyed by Qorloop field. */
    data: Record<string, unknown>;
    change: { price?: ValueChange; stock?: ValueChange; availability?: ValueChange };
  };
}

export interface UploadReviewPage {
  upload: UploadRecord;
  tab: ReviewTab;
  page: number;
  pageSize: number;
  total: number;
  errorCount: number;
  rows: ReviewRow[];
}

export interface UploadRowError {
  row: number;
  column: string | null;
  value: string | null;
  reason: string;
}

/** Fixed server-side page size of GET /api/uploads/:id/errors. */
export const UPLOAD_ERRORS_PAGE_SIZE = 200;

export interface UploadErrorsPage {
  page: number;
  total: number;
  errors: UploadRowError[];
}

export interface SaveMappingRequest {
  /** { <qorloopFieldKey>: "<column header>" } */
  fields: Record<string, string>;
  saveAs?: string;
}
