import { api } from './client';
import type { ReconMarketplaceId, ReconReference } from './recon';

/**
 * Generated marketplace files API (/api/generated-files…). Mirrors the backend's G1 module:
 *   packages/shared/src/contracts.ts (generateMarketplaceFile: the same strict body for preview and generate)
 *   packages/shared/src/generated-files.ts (GenerationJobStatus, GENERATION_FAILURE_MESSAGE)
 *   apps/api/src/generated-files/generated-files.service.ts and generated-files.controller.ts (responses)
 * A blocked selection answers 409 with a plain-words reason in error.message (packages/core/src/generated-files.ts).
 */

/** new_products exists in the database column but is not generated yet (needs the category mapping, G2). */
export const FILE_KINDS = ['stock', 'price', 'stock_price'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const FILE_SCOPES = ['mismatches', 'all'] as const;
export type FileScope = (typeof FILE_SCOPES)[number];

export interface FileSelection {
  marketplaceId: ReconMarketplaceId;
  kind: FileKind;
  scope: FileScope;
  /** Omitted: the backend uses the store's compareReferenceDefault and names it in referenceUsed. */
  reference?: ReconReference;
}

/** One preview cell: the plain value that will be written (formulas, hyperlinks and rich text are flattened). */
export type PlainCell = string | number | boolean | null;

export interface FilePreview {
  /** Products in the file (each counted once). */
  productCount: number;
  /** Data rows written; larger than productCount when a product appears on several rows of the marketplace file. */
  rowsToWrite: number;
  priceChanges: number;
  availabilityChanges: number;
  /** Selected recon rows whose product is not in the marketplace's latest file; they are skipped. */
  notInFile: number;
  /** Numeric prices. */
  largestPriceChange: { name: string; from: number; to: number } | null;
  /** Up to ten rows keyed by the source file's own column headers, in the source column order. */
  firstRows: Record<string, PlainCell>[];
  /** The marketplace's latest applied upload, which the file is built from. */
  sourceFile: { name: string; uploadedAt: string };
  /**
   * Plain messages, e.g. "The marketplace file is 3 days old" or "N products appear on more than one row of the
   * <Marketplace> file; all their rows are updated".
   */
  warnings: string[];
  referenceUsed: ReconReference;
}

export type GenerationState = 'queued' | 'running' | 'done' | 'failed';
export interface GenerationJob {
  state: GenerationState;
  /** Set when done. */
  fileId?: string;
  /** Set when failed: a generic message, never the raw failure. */
  message?: string;
}

export interface GeneratedFile {
  id: string;
  marketplaceId: ReconMarketplaceId;
  kind: FileKind;
  scope: FileScope;
  reference: ReconReference;
  fileName: string;
  productCount: number;
  generatedAt: string;
  /** Display name of the person who generated it. */
  generatedBy: string;
  expiresAt: string;
}

/** A short-lived signed URL (at most 5 minutes): use it at once, never keep it. */
export interface FileDownload { url: string; fileName: string; expiresAt: string }

const body = (s: FileSelection) => ({ marketplaceId: s.marketplaceId, kind: s.kind, scope: s.scope, ...(s.reference ? { reference: s.reference } : {}) });

export const generatedFilesApi = {
  /** files.preview. Writes nothing; 409 with the reason when the selection is blocked. */
  preview: (s: FileSelection) => api<FilePreview>('/api/generated-files/preview', { method: 'POST', body: body(s) }),
  /** files.generate. 202 with the job; the same selection within a minute shares one job. */
  generate: (s: FileSelection) => api<{ jobId: string }>('/api/generated-files', { method: 'POST', body: body(s) }),
  /** files.view. 404 for an unknown job. */
  job: (jobId: string, signal?: AbortSignal) => api<GenerationJob>(`/api/generated-files/jobs/${encodeURIComponent(jobId)}`, { signal }),
  /** files.view. The last 30 days, newest first; expired files are not listed. */
  history: (signal?: AbortSignal) => api<GeneratedFile[]>('/api/generated-files', { signal }),
  /** files.download. 404 when the file expired or is gone from storage. */
  download: (id: string) => api<FileDownload>(`/api/generated-files/${encodeURIComponent(id)}/download`),
};
