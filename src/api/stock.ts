import { api } from './client';
import type { UploadRecord } from './types';

/**
 * ERP change review and catalogue stock (ADR 017). Mirrors the backend:
 *   docs/catalogue-stock-api.md and docs/decisions/017-erp-changes-catalogue-stock.md
 *   packages/shared/src/contracts.ts (uploadChangesQuery, stockConflictsQuery, setProductStock, resetProductStock,
 *   resolveProductStock, stockBulkPreview/Apply, conflictsResolvePreview/Apply)
 *   packages/core/src/catalogue-stock.ts (STOCK_MAX, STOCK_REASON_MAX, STOCK_BULK_LIMIT, CONFLICT_CHOICES)
 *   apps/api/src/catalogue/catalogue-stock.service.ts (responses)
 */

const enc = encodeURIComponent;

/** core catalogue-stock.ts STOCK_MAX (Postgres int). */
export const STOCK_MAX = 2_147_483_647;
export const STOCK_REASON_MAX = 500;
/** Products one bulk stock change or one bulk conflict resolution may touch. */
export const STOCK_BULK_LIMIT = 5_000;
/** Explicit ids per bulk request. */
export const STOCK_PRODUCT_IDS_MAX = 500;
/** GET /api/uploads/:id/changes and /api/catalogue/stock/conflicts accept 1..200 (default 50). */
export const STOCK_PAGE_SIZE = 50;

export type StockSource = 'erp' | 'owner';
export type ConflictChoice = 'erp' | 'keep';

export interface StockView {
  erpStock: number;
  /** What recon and generated files use: the owner value while an edit exists, else the ERP stock. */
  catalogueStock: number;
  source: StockSource;
  conflict: null | { ownerStock: number; erpStock: number; erpStockAtEdit: number; inEffect: 'owner' | 'erp' };
}

export interface StockEdit {
  stock: number;
  erpStockAtEdit: number;
  state: 'active' | 'conflict';
  reason: string | null;
  setBy: { id: string; name: string };
  /** ISO UTC, millisecond precision. */
  setAt: string;
  updatedAt: string;
}

export interface ProductStock extends StockView {
  productId: string;
  edit: StockEdit | null;
}

/** PUT and DELETE answers: changed false = it already had this value; nothing was written. */
export type ProductStockChange = ProductStock & { changed: boolean };

// ── Change review of an applied ERP upload ──

export const ERP_CHANGE_KINDS = ['new', 'price', 'cost', 'stock', 'name', 'active', 'missing', 'returned', 'other'] as const;
export type ErpChangeKind = (typeof ERP_CHANGE_KINDS)[number];
export type ChangeKindFilter = ErpChangeKind | 'all';

export type ErpChangeField =
  | 'erpPrice' | 'costPrice' | 'erpStock' | 'nameEn' | 'erpActive' | 'inLatestErpFile' | 'sku' | 'brand' | 'erpCategory' | 'nameAr';

export interface UploadChangeRow {
  productId: string;
  barcode: string;
  /** File row; null for missing products. */
  rowNumber: number | null;
  kind: ErpChangeKind;
  /** null for new products. */
  field: ErpChangeField | null;
  old: string | number | boolean | null;
  new: string | number | boolean | null;
  /** This stock change met an owner-edited catalogue stock. */
  stockConflict: boolean;
  product: { nameEn: string; nameAr: string | null; status: 'new' | 'active' | 'inactive' };
  /** Price rows: true = the product's own fixed price rule still applies (D6). null on other rows. */
  fixedPriceRule: boolean | null;
  /** Stock rows: the catalogue stock now. null on other rows. */
  catalogueStock: StockView | null;
}

export type UploadChangeCounts = { all: number; cost?: number; stockConflicts: number } & Record<Exclude<ErpChangeKind, 'cost'>, number>;

export interface UploadChangesPage {
  upload: UploadRecord;
  /** false: applied before ADR 017 (no rows exist). */
  changesRecorded: boolean;
  kind: ChangeKindFilter;
  conflictOnly: boolean;
  page: number;
  pageSize: number;
  total: number;
  /** cost is present only for roles with pricing.edit. */
  counts: UploadChangeCounts;
  /** File order; missing products last. */
  rows: UploadChangeRow[];
}

export interface UploadChangesQuery {
  kind?: ChangeKindFilter;
  /** true: only stock changes that raised a conflict. */
  conflict?: boolean;
  page?: number;
  pageSize?: number;
}

// ── Stock conflicts ──

export interface StockConflictRow {
  productId: string;
  barcode: string;
  nameEn: string;
  nameAr: string | null;
  status: string;
  erpStock: number;
  ownerStock: number;
  erpStockAtEdit: number;
  catalogueStock: number;
  reason: string | null;
  setBy: { id: string; name: string };
  setAt: string;
  conflictUploadId: string;
  conflictAt: string;
  updatedAt: string;
}

export interface StockConflictsPage {
  /** 'owner' (D1): while a conflict is open, the owner's value is in effect. */
  inEffect: 'owner' | 'erp';
  page: number;
  pageSize: number;
  total: number;
  /** Newest conflict first. */
  rows: StockConflictRow[];
}

// ── Bulk ──

/** Applied answer of every bulk apply. operationId = the audit event id. */
export interface Applied { operationId: string; replayed: boolean; appliedAt: string }

export type StockBulkSelection =
  | { productIds: string[] }
  /** Every product (any status) matching all given conditions; at most STOCK_BULK_LIMIT. */
  | { filter: { q?: string; categoryId?: string; subcategoryId?: string } };

export type StockBulkAction = { mode: 'set'; stock: number } | { mode: 'erp' };

export interface StockBulkRequest {
  selection: StockBulkSelection;
  action: StockBulkAction;
  reason?: string;
}

export interface StockBulkApplyRequest extends StockBulkRequest {
  /** 8-100 of [A-Za-z0-9_-]. */
  idempotencyKey: string;
  previewToken?: string;
}

export interface StockBulkCounts {
  selected: number;
  willChange: number;
  unchanged: number;
  notFound: number;
  sets: number;
  clears: number;
}

export interface StockBulkRow {
  productId: string;
  nameEn: string;
  barcode: string;
  status: string;
  erpStock: number;
  op: 'set' | 'clear';
  old: { stock: number; source: StockSource; state: 'active' | 'conflict' | null };
  new: { stock: number; source: StockSource };
}

export interface StockBulkPreview extends StockBulkCounts {
  selection: StockBulkSelection;
  action: StockBulkAction;
  reason: string | null;
  limit: number;
  previewToken: string;
  /** The first 10. */
  rows: StockBulkRow[];
}

export type StockBulkResult = Applied & StockBulkCounts;

export interface ConflictsResolveRequest {
  /** explicit products (1..500) or every open conflict (at most STOCK_BULK_LIMIT). */
  selection: { productIds: string[] } | { all: true };
  choice: ConflictChoice;
}

export interface ConflictsResolveApplyRequest extends ConflictsResolveRequest {
  idempotencyKey: string;
  previewToken?: string;
}

export interface ConflictsResolveCounts {
  selected: number;
  willResolve: number;
  notInConflict: number;
  notFound: number;
}

export interface ConflictsResolveRow {
  productId: string;
  nameEn: string;
  barcode: string;
  choice: string;
  ownerStock: number;
  erpStock: number;
  erpStockAtEdit: number;
  catalogueStockAfter: number;
}

export interface ConflictsResolvePreview extends ConflictsResolveCounts {
  selection: ConflictsResolveRequest['selection'];
  choice: ConflictChoice;
  limit: number;
  previewToken: string;
  rows: ConflictsResolveRow[];
}

export type ConflictsResolveResult = Applied & ConflictsResolveCounts;

export const stockApi = {
  /** uploads.view. Applied ERP uploads only: a marketplace upload is 400, one not applied yet is 409. */
  uploadChanges: (id: string, q: UploadChangesQuery = {}, signal?: AbortSignal) =>
    api<UploadChangesPage>(`/api/uploads/${enc(id)}/changes`, {
      signal,
      query: {
        kind: q.kind && q.kind !== 'all' ? q.kind : undefined,
        conflict: q.conflict ? 'true' : undefined,
        page: q.page, pageSize: q.pageSize,
      },
    }),
  /** products.view. Newest conflict first. */
  conflicts: (page = 1, pageSize = STOCK_PAGE_SIZE, signal?: AbortSignal) =>
    api<StockConflictsPage>('/api/catalogue/stock/conflicts', { signal, query: { page, pageSize } }),
  /** products.view. Same number as stockConflicts on GET /api/recon/summary. */
  conflictCount: (signal?: AbortSignal) => api<{ count: number }>('/api/catalogue/stock/conflicts/count', { signal }),

  get: (id: string, signal?: AbortSignal) => api<ProductStock>(`/api/products/${enc(id)}/stock`, { signal }),
  /** catalogue.stock_edit. expected = the stock as last shown: 409 when either value moved. */
  set: (id: string, body: { stock: number; reason?: string; expected: { erpStock: number; catalogueStock: number } }) =>
    api<ProductStockChange>(`/api/products/${enc(id)}/stock`, { method: 'PUT', body }),
  /** catalogue.stock_edit. Back to the ERP stock. */
  reset: (id: string, expected: { erpStock: number; catalogueStock: number }) =>
    api<ProductStockChange>(`/api/products/${enc(id)}/stock`, {
      method: 'DELETE', query: { expectedErpStock: expected.erpStock, expectedCatalogueStock: expected.catalogueStock },
    }),
  /** catalogue.stock_edit. 409 when there is no open conflict or either value moved. */
  resolve: (id: string, body: { choice: ConflictChoice; expected: { erpStock: number; ownerStock: number } }) =>
    api<ProductStock>(`/api/products/${enc(id)}/stock/resolve`, { method: 'POST', body }),

  bulkPreview: (body: StockBulkRequest) => api<StockBulkPreview>('/api/catalogue/stock/bulk/preview', { method: 'POST', body }),
  bulkApply: (body: StockBulkApplyRequest) => api<StockBulkResult>('/api/catalogue/stock/bulk/apply', { method: 'POST', body }),
  conflictsPreview: (body: ConflictsResolveRequest) =>
    api<ConflictsResolvePreview>('/api/catalogue/stock/conflicts/resolve/preview', { method: 'POST', body }),
  conflictsApply: (body: ConflictsResolveApplyRequest) =>
    api<ConflictsResolveResult>('/api/catalogue/stock/conflicts/resolve/apply', { method: 'POST', body }),
};
