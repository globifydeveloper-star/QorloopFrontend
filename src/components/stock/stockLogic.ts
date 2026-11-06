import { ApiError } from '../../api/client';
import { friendlyError } from '../../api/errors';
import {
  STOCK_BULK_LIMIT, STOCK_MAX, STOCK_PRODUCT_IDS_MAX, STOCK_REASON_MAX,
  type ErpChangeField, type ErpChangeKind, type StockBulkRequest, type UploadChangeRow,
} from '../../api/stock';
import { count, isStale, priceText } from '../pricing/priceChange';

/**
 * Catalogue stock (ADR 017) without React: typed values checked in plain words before any call, API errors as plain
 * sentences, labels for the change list, and the preview → confirm → apply state machine shared by the bulk stock edit
 * and the bulk conflict resolution (the same rules as the bulk price change, ADR 013).
 */

export const productsText = (n: number) => `${count(n)} ${n === 1 ? 'product' : 'products'}`;

// ───────── Values typed by the user ─────────

/** A whole number 0..STOCK_MAX, or the reason it cannot be sent. */
export function readStock(text: string): { value: number; error?: undefined } | { value?: undefined; error: string } {
  const t = text.trim();
  if (!t) return { error: 'Enter a stock quantity' };
  if (!/^\d+$/.test(t)) return { error: 'Enter a whole number of 0 or more' };
  const n = Number(t);
  if (!Number.isSafeInteger(n) || n > STOCK_MAX) return { error: `Enter at most ${count(STOCK_MAX)}` };
  return { value: n };
}

export function readReason(text: string): { value: string | undefined; error?: string } {
  const t = text.trim();
  if (t.length > STOCK_REASON_MAX) return { value: undefined, error: `Use at most ${STOCK_REASON_MAX} characters` };
  return { value: t || undefined };
}

// ───────── Errors ─────────

export const STALE_STOCK = 'Someone changed this stock after you opened it. The newer values are shown now; check them and try again.';

/**
 * Field messages from a 400 (stock, reason), and everything else as one plain sentence. 409 is `stale` (reload and
 * show the newer values). Sign-in, connection and server problems use the shared error helper's words.
 */
export function stockErrors(e: unknown, fields: readonly string[] = ['stock', 'reason']): { fields: Record<string, string>; general?: string; stale?: boolean } {
  if (!e) return { fields: {} };
  if (!(e instanceof ApiError) || e.status === 0 || e.status === 401 || e.status >= 500 || e.code === 'CSRF_REQUIRED') {
    const f = friendlyError(e);
    return { fields: {}, general: `${f.title}. ${f.message}${f.requestId ? ` (Request ID ${f.requestId})` : ''}` };
  }
  if (isStale(e)) return { fields: {}, general: e.message && e.message !== 'Conflict' ? `${STALE_STOCK} (${e.message})` : STALE_STOCK, stale: true };
  if (e.status === 403) return { fields: {}, general: 'You do not have permission to change the catalogue stock. Ask your store Owner or an Admin.' };
  if (e.status === 404) return { fields: {}, general: 'This product was not found. It may have been removed; reload the page.' };
  const out: Record<string, string> = {};
  const rest: string[] = [];
  for (const d of e.details) {
    if (!d.message) continue;
    if (d.path && fields.includes(d.path)) { if (!out[d.path]) out[d.path] = d.message; } else if (!rest.includes(d.message)) rest.push(d.message);
  }
  if (rest.length) return { fields: out, general: rest.join(' ') };
  if (Object.keys(out).length) return { fields: out };
  return { fields: out, general: e.message === 'Validation failed' ? 'Some values were not accepted. Check them and try again.' : e.message };
}

// ───────── Change list ─────────

export const CHANGE_KIND_LABELS: Record<ErpChangeKind, string> = {
  new: 'New products',
  price: 'Price',
  cost: 'Cost',
  stock: 'Stock',
  name: 'Name',
  active: 'Active in ERP',
  missing: 'Missing from file',
  returned: 'Back in file',
  other: 'Other details',
};

const FIELD_LABELS: Record<ErpChangeField, string> = {
  erpPrice: 'ERP price', costPrice: 'Cost price', erpStock: 'ERP stock', nameEn: 'English name', erpActive: 'Active in ERP',
  inLatestErpFile: 'In the ERP file', sku: 'SKU', brand: 'Brand', erpCategory: 'ERP category', nameAr: 'Arabic name',
};

export const changeFieldLabel = (r: Pick<UploadChangeRow, 'kind' | 'field'>) => (r.field ? FIELD_LABELS[r.field] ?? r.field : CHANGE_KIND_LABELS[r.kind]);

/** One side of a change in words: prices to 3 decimals as stored, yes/no fields in words, blanks as a dash. */
export function changeValue(field: ErpChangeField | null, v: UploadChangeRow['old']): string {
  if (v === null || v === undefined || v === '') return '—';
  if (field === 'erpActive' && typeof v === 'boolean') return v ? 'Active' : 'Inactive';
  if (field === 'inLatestErpFile' && typeof v === 'boolean') return v ? 'In the file' : 'Not in the file';
  if ((field === 'erpPrice' || field === 'costPrice') && typeof v === 'number') return `${priceText(v)} QAR`;
  if (typeof v === 'number') return count(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}

// ───────── Bulk stock edit: the form → the request ─────────

export interface StockBulkForm {
  scope: 'ticked' | 'filter';
  tickedIds: readonly string[];
  filter: { q?: string; categoryId?: string; subcategoryId?: string };
  /** Products of any status matching the filter (the list's "All" count); undefined while not known. */
  filterCount?: number;
  mode: 'set' | 'erp';
  value: string;
  reason: string;
}

/** Why this selection cannot be sent, before calling the API (the server checks the same limits). */
export function stockSelectionProblem(f: Pick<StockBulkForm, 'scope' | 'tickedIds' | 'filterCount'>): string | undefined {
  if (f.scope === 'ticked') {
    const n = f.tickedIds.length;
    if (n === 0) return 'Tick at least one product in the list.';
    if (n > STOCK_PRODUCT_IDS_MAX) return `You ticked ${count(n)} products. A change of ticked rows can include at most ${count(STOCK_PRODUCT_IDS_MAX)}; use the search and category filter instead (up to ${count(STOCK_BULK_LIMIT)} products).`;
    return undefined;
  }
  if (f.filterCount === undefined) return undefined;
  if (f.filterCount === 0) return 'No products match the current search and category.';
  if (f.filterCount > STOCK_BULK_LIMIT) return `The current search and category match ${count(f.filterCount)} products. One stock change can include at most ${count(STOCK_BULK_LIMIT)}; narrow the search or category.`;
  return undefined;
}

export function buildStockBulkRequest(f: StockBulkForm): { request: StockBulkRequest; errors?: undefined } | { request?: undefined; errors: { selection?: string; value?: string; reason?: string } } {
  const errors: { selection?: string; value?: string; reason?: string } = {};
  const sel = stockSelectionProblem(f);
  if (sel) errors.selection = sel;
  let stock: number | undefined;
  if (f.mode === 'set') {
    const r = readStock(f.value);
    if (r.error !== undefined) errors.value = r.error; else stock = r.value;
  }
  const reason = readReason(f.reason);
  if (reason.error) errors.reason = reason.error;
  if (errors.selection || errors.value || errors.reason) return { errors };
  const filter = {
    ...(f.filter.q?.trim() ? { q: f.filter.q.trim() } : {}),
    ...(f.filter.categoryId ? { categoryId: f.filter.categoryId } : {}),
    ...(f.filter.subcategoryId ? { subcategoryId: f.filter.subcategoryId } : {}),
  };
  return {
    request: {
      selection: f.scope === 'ticked' ? { productIds: [...new Set(f.tickedIds)] } : { filter },
      action: f.mode === 'set' ? { mode: 'set', stock: stock! } : { mode: 'erp' },
      ...(reason.value ? { reason: reason.value } : {}),
    },
  };
}

// ───────── Preview → confirm → apply (shared by both bulk dialogs) ─────────

export type BulkPhase = 'choose' | 'previewing' | 'preview' | 'confirm' | 'applying' | 'done';

export interface BulkMachine<Req, Prev, Res> {
  phase: BulkPhase;
  /** The request that was previewed; apply sends exactly this. */
  request?: Req;
  preview?: Prev;
  /**
   * One per intended change: made at the first Apply of this preview and sent again on every retry of it, so a lost
   * answer is replayed by the server instead of applied twice. Cleared by a new preview or a 409.
   */
  idempotencyKey?: string;
  result?: Res;
  error?: unknown;
  /** Apply answered 409: the data moved since the preview; only a new preview can go on. */
  stale?: boolean;
}

export type BulkMachineEvent<Req, Prev, Res> =
  | { type: 'preview'; request: Req }
  | { type: 'previewed'; preview: Prev }
  | { type: 'previewFailed'; error: unknown }
  | { type: 'edit' }
  | { type: 'confirm' }
  | { type: 'cancel' }
  | { type: 'apply'; newKey: () => string }
  | { type: 'applied'; result: Res }
  | { type: 'applyFailed'; error: unknown };

/** Pure transitions; an event that does not fit the phase changes nothing (a double click, a late answer). */
export function bulkMachine<Req, Prev, Res>(actionable: (p: Prev) => number) {
  return (s: BulkMachine<Req, Prev, Res>, e: BulkMachineEvent<Req, Prev, Res>): BulkMachine<Req, Prev, Res> => {
    switch (e.type) {
      case 'preview':
        return s.phase === 'choose' || s.phase === 'preview' ? { phase: 'previewing', request: e.request } : s;
      case 'previewed':
        return s.phase === 'previewing' ? { phase: 'preview', request: s.request, preview: e.preview } : s;
      case 'previewFailed':
        return s.phase === 'previewing' ? { phase: 'choose', error: e.error } : s;
      case 'edit':
        return s.phase === 'preview' || s.phase === 'confirm' ? { phase: 'choose' } : s;
      case 'confirm':
        return s.phase === 'preview' && !s.stale && s.preview && actionable(s.preview) > 0 ? { ...s, phase: 'confirm', error: undefined } : s;
      case 'cancel':
        return s.phase === 'confirm' ? { ...s, phase: 'preview' } : s;
      case 'apply':
        return s.phase === 'confirm' ? { ...s, phase: 'applying', idempotencyKey: s.idempotencyKey ?? e.newKey(), error: undefined } : s;
      case 'applied':
        return s.phase === 'applying' ? { ...s, phase: 'done', result: e.result, error: undefined } : s;
      case 'applyFailed':
        if (s.phase !== 'applying') return s;
        // 409: the plan changed since the preview (or the key belongs to another change): preview again, with a new key.
        if (isStale(e.error)) return { ...s, phase: 'preview', stale: true, idempotencyKey: undefined, error: e.error };
        // Anything else may or may not have been applied: stay on the confirmation and retry with the same key.
        return { ...s, phase: 'confirm', error: e.error };
    }
  };
}

/** "Not active", "not active in the ERP", "not in the latest ERP file": why stock cannot make this product available (D4). */
export function unavailableReasons(p: { status: string; erpActive?: boolean; inLatestErpFile?: boolean }): string[] {
  return [
    p.status !== 'active' && (p.status === 'new' ? 'it is new and not active yet' : 'it is inactive in Qorloop'),
    p.erpActive === false && 'it is inactive in the ERP',
    p.inLatestErpFile === false && 'it is missing from the latest ERP file',
  ].filter((x): x is string => Boolean(x));
}
