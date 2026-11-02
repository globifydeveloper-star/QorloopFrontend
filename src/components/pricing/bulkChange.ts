import {
  BULK_PERCENT_DECREASE_MAX, BULK_PERCENT_INCREASE_MAX, BULK_PRICE_LIMIT, BULK_PRODUCT_IDS_MAX, PRICE_CHANGE_MAX,
  type BulkAction, type BulkActionType, type BulkApplyResult, type BulkPreview, type BulkPriceRequest, type BulkRounding,
  type PricingMarketplaceId,
} from '../../api/pricing';
import { PRICE, count, isStale, priceText, readNumber } from './priceChange';

/**
 * The bulk price change (ADR 013) without React: the form turned into the preview/apply body (limits checked in plain
 * words before any call), the idempotency key, and the preview → confirm → apply state machine.
 */

const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

// ───────── Idempotency key ─────────

/** A UUID v4 (8-100 of A-Za-z0-9_-, as the apply contract wants), also where crypto.randomUUID is missing (plain http). */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ───────── Bulk: the form → the request ─────────

export const BULK_ACTION_LABELS: Record<BulkActionType, string> = {
  set_fixed: 'Set a fixed price',
  increase_percent: 'Increase by a percent',
  decrease_percent: 'Decrease by a percent',
  increase_amount: 'Increase by an amount',
  decrease_amount: 'Decrease by an amount',
  match_marketplace: 'Match the marketplace price',
  match_erp: 'Go back to the ERP price rules',
};
export const BULK_ROUNDING_LABELS: Record<BulkRounding, string> = { none: 'No rounding', '0.05': 'Round to 0.05', '0.25': 'Round to 0.25' };

/** What the action needs typed in: a price, a percent, an amount, or nothing. */
export function bulkValueKind(type: BulkActionType): 'price' | 'percent' | 'amount' | null {
  if (type === 'set_fixed') return 'price';
  if (type === 'increase_percent' || type === 'decrease_percent') return 'percent';
  if (type === 'increase_amount' || type === 'decrease_amount') return 'amount';
  return null;
}

export interface BulkForm {
  marketplaceId: PricingMarketplaceId;
  /** ticked: the ticked rows; filter: every active product matching the list's current search and category. */
  scope: 'ticked' | 'filter';
  tickedIds: readonly string[];
  filter: { q?: string; categoryId?: string; subcategoryId?: string };
  /** Active products matching the filter (the product list's own count); undefined when not known yet. */
  filterActiveCount?: number;
  action: BulkActionType;
  value: string;
  rounding: BulkRounding;
}

/** Why this selection cannot be sent, before calling the API (the server checks the same limits). */
export function selectionProblem(f: Pick<BulkForm, 'scope' | 'tickedIds' | 'filterActiveCount'>): string | undefined {
  if (f.scope === 'ticked') {
    const n = f.tickedIds.length;
    if (n === 0) return 'Tick at least one product in the list.';
    if (n > BULK_PRODUCT_IDS_MAX) {
      return `You ticked ${count(n)} products. A change of ticked rows can include at most ${count(BULK_PRODUCT_IDS_MAX)}; use the search and category filter instead (up to ${count(BULK_PRICE_LIMIT)} products).`;
    }
    return undefined;
  }
  const n = f.filterActiveCount;
  if (n === 0) return 'No active products match the current search and category.';
  if (n !== undefined && n > BULK_PRICE_LIMIT) {
    return `The current search and category match ${count(n)} active products. One change can price at most ${count(BULK_PRICE_LIMIT)}; narrow the search or category.`;
  }
  return undefined;
}

export type BuiltRequest = { request: BulkPriceRequest; errors?: undefined } | { request?: undefined; errors: { selection?: string; value?: string } };

/** The preview/apply body for the form, or the problems to show (nothing is sent while there is one). */
export function buildBulkRequest(f: BulkForm): BuiltRequest {
  const errors: { selection?: string; value?: string } = {};
  const selectionError = selectionProblem(f);
  if (selectionError) errors.selection = selectionError;

  let action: BulkAction | undefined;
  const kind = bulkValueKind(f.action);
  if (kind === null) {
    action = { type: f.action as 'match_marketplace' | 'match_erp' };
  } else {
    const max = kind === 'price' || kind === 'amount' ? PRICE_CHANGE_MAX : f.action === 'decrease_percent' ? BULK_PERCENT_DECREASE_MAX : BULK_PERCENT_INCREASE_MAX;
    const read = readNumber(f.value, kind === 'price' ? PRICE : kind === 'amount'
      ? { empty: 'Enter an amount', min: 0, minInclusive: false, max, range: `Enter an amount above 0 and at most ${count(max)} QAR` }
      : { empty: 'Enter a percent', min: 0, minInclusive: false, max, range: `Enter a percent above 0 and at most ${count(max)}` });
    if (read.error !== undefined) errors.value = read.error;
    else if (f.action === 'set_fixed') action = { type: 'set_fixed', price: read.value };
    else if (kind === 'percent') action = { type: f.action as 'increase_percent' | 'decrease_percent', percent: read.value, rounding: f.rounding };
    else action = { type: f.action as 'increase_amount' | 'decrease_amount', amount: read.value, rounding: f.rounding };
  }
  if (errors.selection || errors.value || !action) return { errors };

  const filter = {
    ...(f.filter.q?.trim() ? { q: f.filter.q.trim() } : {}),
    ...(f.filter.categoryId ? { categoryId: f.filter.categoryId } : {}),
    ...(f.filter.subcategoryId ? { subcategoryId: f.filter.subcategoryId } : {}),
  };
  return {
    request: {
      marketplaceId: f.marketplaceId,
      selection: f.scope === 'ticked' ? { productIds: [...new Set(f.tickedIds)] } : { filter },
      action,
    },
  };
}

/** "Increase by 5 % (round to 0.05)", "Set a fixed price of 12.50 QAR", "Match the Talabat price". */
export function actionText(a: BulkAction, marketplace: string): string {
  switch (a.type) {
    case 'set_fixed': return `Set a fixed price of ${priceText(a.price)} QAR`;
    case 'increase_percent': case 'decrease_percent':
      return `${a.type === 'increase_percent' ? 'Increase' : 'Decrease'} by ${a.percent} %${a.rounding === 'none' ? '' : ` (${BULK_ROUNDING_LABELS[a.rounding].toLowerCase()})`}`;
    case 'increase_amount': case 'decrease_amount':
      return `${a.type === 'increase_amount' ? 'Increase' : 'Decrease'} by ${priceText(a.amount)} QAR${a.rounding === 'none' ? '' : ` (${BULK_ROUNDING_LABELS[a.rounding].toLowerCase()})`}`;
    case 'match_marketplace': return `Match the ${marketplace} price`;
    case 'match_erp': return 'Go back to the ERP price rules (remove the product price rule)';
  }
}

export const productsText = (n: number) => plural(n, 'product', 'products');

// ───────── Bulk: preview → confirm → apply ─────────

export type BulkPhase = 'choose' | 'previewing' | 'preview' | 'confirm' | 'applying' | 'done';

export interface BulkState {
  phase: BulkPhase;
  /** The request that was previewed; apply sends exactly this. */
  request?: BulkPriceRequest;
  preview?: BulkPreview;
  /**
   * One per intended change: created at the first Apply of this preview and sent again on every retry of it, so a
   * request that reached the server but lost its answer is answered from the server's record instead of applied twice.
   * Cleared when the change is edited or previewed again.
   */
  idempotencyKey?: string;
  result?: BulkApplyResult;
  /** The last preview or apply error (shown where it happened). */
  error?: unknown;
  /** Apply answered 409: the prices or rules moved since the preview; only a new preview can go on. */
  stale?: boolean;
}

export type BulkEvent =
  | { type: 'preview'; request: BulkPriceRequest }
  | { type: 'previewed'; preview: BulkPreview }
  | { type: 'previewFailed'; error: unknown }
  | { type: 'edit' }
  | { type: 'confirm' }
  | { type: 'cancel' }
  | { type: 'apply'; newKey: () => string }
  | { type: 'applied'; result: BulkApplyResult }
  | { type: 'applyFailed'; error: unknown };

export const BULK_START: BulkState = { phase: 'choose' };

/** Pure transitions; an event that does not fit the current phase changes nothing (a double click, a late answer). */
export function bulkReducer(s: BulkState, e: BulkEvent): BulkState {
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
      return s.phase === 'preview' && !s.stale && (s.preview?.willChange ?? 0) > 0 ? { ...s, phase: 'confirm', error: undefined } : s;
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
      // Anything else may or may not have been applied (a lost answer): stay on the confirmation and retry with the same key.
      return { ...s, phase: 'confirm', error: e.error };
  }
}
