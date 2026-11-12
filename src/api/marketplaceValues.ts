import { api } from './client';
import type { ReconMarketplaceId, ReconReference, ReconRowType, ReconStatus } from './recon';

/**
 * Marketplace export values (ADR 018, "Update marketplace files").
 *
 * NOT A COMMITTED BACKEND API. The backend has only the PROPOSAL, not approved or implemented:
 *   Qorloop-backend, branch feature/marketplace-export-values:
 *   docs/reports/2026-11-09-marketplace-export-overrides-step-0.md §5 (endpoints) and
 *   docs/reports/2026-11-10-marketplace-export-values-step-0-addendum.md §3, §5, §7a (persistent, exportState, marketplaceSource).
 * Where the two reports differ, the 10 Nov addendum wins. Every shape the reports leave open is marked ASSUMPTION; the
 * readers below treat anything not shaped as expected as "not available", so a backend without the feature (or with a
 * changed one) shows nothing wrong. Screens using this module run only with VITE_REAL_MARKETPLACE_VALUES=true.
 */

const enc = encodeURIComponent;

export type ValueField = 'availability' | 'price';
export const VALUE_FIELDS: readonly ValueField[] = ['availability', 'price'];

/** Optimistic concurrency: the override row as last seen; null = no row was seen. */
export type ValueVersion = { id: string; version: number } | null;

export type ExportState = 'catalogue' | 'waiting_for_export' | 'pinned' | 'blocked' | 'cleared';
export const EXPORT_STATES: readonly ExportState[] = ['catalogue', 'waiting_for_export', 'pinned', 'blocked', 'cleared'];
export type FieldState = 'waiting_for_export' | 'pinned' | 'blocked';

export type BlockedReason = 'inactive' | 'erp_inactive' | 'missing_from_erp' | 'not_listed' | 'marketplace_disabled' | 'ambiguous_listings';
/** The addendum's plain words (§3); the server's blockedReasonLabel wins when it sends one. */
export const BLOCKED_REASON_LABELS: Record<BlockedReason, string> = {
  inactive: 'Product is inactive',
  erp_inactive: 'Inactive in the ERP',
  missing_from_erp: 'Not in the latest ERP file',
  not_listed: 'Not listed on this marketplace',
  marketplace_disabled: 'Marketplace is switched off',
  ambiguous_listings: 'Listed twice on this marketplace with different values',
};
const BLOCKED_REASONS = Object.keys(BLOCKED_REASON_LABELS) as BlockedReason[];

export interface FieldMeta<V> {
  value: V;
  state: 'pending' | 'cleared';
  /** false = fix once (clears when the marketplace file matches); true = pinned ("Keep until I remove it"). */
  persistent: boolean;
  fieldState: FieldState | null;
  setAt: string;
  reason: string | null;
  clearedAt: string | null;
}

export interface MarketplaceValueItem {
  productId: string;
  marketplaceId: string;
  version: ValueVersion;
  catalogue: { available: boolean; price: number };
  /** From the marketplace file; null when the product is not in it. */
  marketplaceCurrent: { available: boolean | null; price: number | null };
  /** What the generated file writes for this product on this marketplace. */
  export: { available: boolean; price: number; availabilitySource: 'catalogue' | 'override' | 'eligibility_guard'; priceSource: 'catalogue' | 'override' };
  overrides: { availability: FieldMeta<boolean> | null; price: FieldMeta<number> | null };
  exportState: ExportState;
  exportStateLabel: string | null;
  blockedReason: BlockedReason | null;
  blockedReasonLabel: string | null;
  /**
   * ASSUMPTION: the addendum says "MarketplaceValueItem.price adds: rulePrice, differsFromRulePrice" but the item has no
   * `price` object; read here from the item itself, or from `export`. Undefined when absent.
   */
  rulePrice?: number;
  differsFromRulePrice?: boolean;
}

/** The last marketplace file that carried this listing (addendum §5); null when unknown. */
export interface MarketplaceSource {
  uploadId: string;
  fileName: string;
  uploadedAt: string;
  appliedAt: string | null;
  isLatestFile: boolean;
}

// ───────── Readers: trust only what is shaped like the contract ─────────

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null => ((allowed as readonly unknown[]).includes(v) ? (v as T) : null);

function readVersion(v: unknown): ValueVersion | undefined {
  if (v === null) return null;
  if (isObj(v) && typeof v.id === 'string' && Number.isInteger(v.version)) return { id: v.id, version: v.version as number };
  return undefined;
}

function readMeta<V>(v: unknown, value: (x: unknown) => V | null): FieldMeta<V> | null {
  if (!isObj(v)) return null;
  const val = value(v.value);
  const state = oneOf(v.state, ['pending', 'cleared'] as const);
  if (val === null || !state) return null;
  return {
    value: val, state, persistent: v.persistent === true,
    fieldState: oneOf(v.fieldState, ['waiting_for_export', 'pinned', 'blocked'] as const),
    setAt: str(v.setAt) ?? '', reason: str(v.reason), clearedAt: str(v.clearedAt),
  };
}

export function readValueItem(v: unknown): MarketplaceValueItem | undefined {
  if (!isObj(v) || typeof v.productId !== 'string' || typeof v.marketplaceId !== 'string') return undefined;
  const version = readVersion(v.version);
  const exportState = oneOf(v.exportState, EXPORT_STATES);
  const cat = isObj(v.catalogue) ? v.catalogue : null;
  const exp = isObj(v.export) ? v.export : null;
  if (version === undefined || !exportState || !cat || !exp) return undefined;
  const catAvailable = bool(cat.available); const catPrice = num(cat.price);
  const expAvailable = bool(exp.available); const expPrice = num(exp.price);
  if (catAvailable === null || catPrice === null || expAvailable === null || expPrice === null) return undefined;
  const cur = isObj(v.marketplaceCurrent) ? v.marketplaceCurrent : {};
  const ov = isObj(v.overrides) ? v.overrides : {};
  const blockedReason = oneOf(v.blockedReason, BLOCKED_REASONS);
  const rulePrice = num(v.rulePrice) ?? num(exp.rulePrice);
  const differs = bool(v.differsFromRulePrice) ?? bool(exp.differsFromRulePrice);
  return {
    productId: v.productId, marketplaceId: v.marketplaceId, version,
    catalogue: { available: catAvailable, price: catPrice },
    marketplaceCurrent: { available: bool(cur.available), price: num(cur.price) },
    export: {
      available: expAvailable, price: expPrice,
      availabilitySource: oneOf(exp.availabilitySource, ['catalogue', 'override', 'eligibility_guard'] as const) ?? 'catalogue',
      priceSource: oneOf(exp.priceSource, ['catalogue', 'override'] as const) ?? 'catalogue',
    },
    overrides: { availability: readMeta(ov.availability, bool), price: readMeta(ov.price, num) },
    exportState,
    exportStateLabel: str(v.exportStateLabel),
    blockedReason,
    blockedReasonLabel: str(v.blockedReasonLabel) ?? (blockedReason ? BLOCKED_REASON_LABELS[blockedReason] : null),
    ...(rulePrice !== null ? { rulePrice } : {}),
    ...(differs !== null ? { differsFromRulePrice: differs } : {}),
  };
}

export function readMarketplaceSource(v: unknown): MarketplaceSource | null {
  if (!isObj(v) || typeof v.uploadId !== 'string' || typeof v.uploadedAt !== 'string' || Number.isNaN(Date.parse(v.uploadedAt))) return null;
  return { uploadId: v.uploadId, fileName: str(v.fileName) ?? '', uploadedAt: v.uploadedAt, appliedAt: str(v.appliedAt), isLatestFile: v.isLatestFile === true };
}

/** Summary counts per marketplace (addendum §3 and 9 Nov §5); undefined when the server does not send them. */
export interface ExportCounts { waitingForExport?: number; pinned?: number; blocked?: number }
export function readExportCounts(m: unknown): ExportCounts {
  if (!isObj(m)) return {};
  const n = (k: string) => (typeof m[k] === 'number' && Number.isInteger(m[k]) ? (m[k] as number) : undefined);
  // ASSUMPTION: only the 9 Nov report names a blocked count (blockedExportProducts); the addendum names none.
  return { waitingForExport: n('waitingForExport'), pinned: n('pinned'), blocked: n('blockedExportProducts') ?? n('blocked') };
}

// ───────── Single product ─────────

export interface SetFieldValue<V> { value: V; persistent?: boolean }
export interface SetValues { availability?: SetFieldValue<boolean>; price?: SetFieldValue<number> }

export interface ValueChange { changed: boolean; operationId: string | null; item: MarketplaceValueItem }

function readChange(v: unknown): ValueChange {
  const o = isObj(v) ? v : {};
  const item = readValueItem(o.item);
  // A success the client cannot read is treated as "reload": the caller refetches the list.
  if (!item) throw new Error('UNREADABLE_VALUE_CHANGE');
  return { changed: o.changed === true, operationId: str(o.operationId), item };
}

// ───────── Bulk ─────────

/** Recon-row filters the bulk selection and the Adjust list share (9 Nov §5 Selection, addendum §7a). */
export interface ValueFilter {
  type?: ReconRowType;
  reference?: ReconReference;
  status?: ReconStatus;
  exportState?: ExportState;
  persistent?: boolean;
}

export type BulkSelection = { productIds: string[] } | { filter: ValueFilter };
export type BulkAction = { type: 'set'; values: SetValues } | { type: 'use_catalogue'; fields: ValueField[] };

export interface BulkRequest {
  marketplaceId: ReconMarketplaceId;
  selection: BulkSelection;
  action: BulkAction;
  reason?: string;
}

export interface BulkPreviewRow { productId: string; before: MarketplaceValueItem | undefined; after: MarketplaceValueItem | undefined; blockedReason: BlockedReason | null }

export interface BulkCounts { selected: number; willChange: number; unchanged: number; blocked: number; blockedByReason: Record<string, number> }

export interface BulkPreview extends BulkCounts {
  limit: number;
  rows: BulkPreviewRow[];
  /** 64 lowercase hex; required by apply. */
  previewToken: string;
}

export interface BulkResult extends BulkCounts {
  operationId: string;
  replayed: boolean;
  appliedAt: string;
  created: number;
  updated: number;
  clearedFields: number;
}

/** At most this many products in one bulk change (selected, not changed); more is rejected, never truncated. */
export const VALUES_BULK_LIMIT = 5_000;
/** Ticked rows are sent as ids; the 32 KB body limit allows 500. Use the filter for more. */
export const VALUES_PRODUCT_IDS_MAX = 500;
export const VALUES_REASON_MAX = 500;

const counts = (o: Obj): BulkCounts => ({
  selected: num(o.selected) ?? 0, willChange: num(o.willChange) ?? 0, unchanged: num(o.unchanged) ?? 0, blocked: num(o.blocked) ?? 0,
  blockedByReason: isObj(o.blockedByReason) ? Object.fromEntries(Object.entries(o.blockedByReason).filter(([, n]) => typeof n === 'number')) as Record<string, number> : {},
});

function readPreview(v: unknown): BulkPreview {
  const o = isObj(v) ? v : {};
  return {
    ...counts(o), limit: num(o.limit) ?? VALUES_BULK_LIMIT, previewToken: str(o.previewToken) ?? '',
    rows: Array.isArray(o.rows) ? o.rows.filter(isObj).map(r => ({
      productId: str(r.productId) ?? '', before: readValueItem(r.before), after: readValueItem(r.after),
      blockedReason: oneOf(r.blockedReason, BLOCKED_REASONS),
    })) : [],
  };
}

function readResult(v: unknown): BulkResult {
  const o = isObj(v) ? v : {};
  return {
    ...counts(o), operationId: str(o.operationId) ?? '', replayed: o.replayed === true, appliedAt: str(o.appliedAt) ?? '',
    created: num(o.created) ?? 0, updated: num(o.updated) ?? 0, clearedFields: num(o.clearedFields) ?? 0,
  };
}

const deleteQuery = (fields: ValueField[] | 'all', expected: ValueVersion) => ({
  fields: fields === 'all' || fields.length === 2 ? 'all' : fields[0],
  ...(expected ? { expectedId: expected.id, expectedVersion: expected.version } : { expectedAbsent: 'true' }),
});

export const marketplaceValuesApi = {
  /** marketplace.values_edit. Partial field update; `expected` is the version last seen (409 when it moved). */
  set: async (marketplaceId: string, productId: string, body: { values: SetValues; reason?: string; expected: ValueVersion }) =>
    readChange(await api<unknown>(`/api/marketplace-values/${enc(marketplaceId)}/products/${enc(productId)}`, { method: 'PUT', body })),
  /** marketplace.values_edit. "Use catalogue value" for one or both fields; never deletes the product. */
  useCatalogue: async (marketplaceId: string, productId: string, fields: ValueField[] | 'all', expected: ValueVersion) =>
    readChange(await api<unknown>(`/api/marketplace-values/${enc(marketplaceId)}/products/${enc(productId)}`, { method: 'DELETE', query: deleteQuery(fields, expected) })),
  /** marketplace.values_edit. Read-only; the first 10 rows and a token that apply needs. */
  bulkPreview: async (body: BulkRequest) => readPreview(await api<unknown>('/api/marketplace-values/bulk/preview', { method: 'POST', body })),
  /** marketplace.values_edit. One idempotency key per confirmation, sent again on every retry of it. */
  bulkApply: async (body: BulkRequest & { previewToken: string; idempotencyKey: string }) =>
    readResult(await api<unknown>('/api/marketplace-values/bulk/apply', { method: 'POST', body })),
};
