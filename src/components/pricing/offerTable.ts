import type { ProductItem, ProductOfferSummary, ProductStatus } from '../../api/products';
import type { BulkOfferItem, BulkOfferOutcome, BulkOfferPreview, BulkOfferPreviewRow, BulkOfferApplyResult, BulkOfferWarning } from '../../api/pricing';
import { PRICE_CHANGE_MAX } from '../../api/pricing';
import { toQatarInput } from '../../lib/format';
import { priceText } from './priceChange';

/**
 * Pure helpers of the "Bulk offer" table: one editable row per ticked product, checked in the browser before anything
 * is sent; Qatar calendar dates turned into instants; the preview and apply answers read defensively (the bulk offers
 * API is not in the backend yet).
 *
 * Dates follow the offers v1 decision (step-0 report, D.3): start day D = D 00:00:00.000+03:00, end day E =
 * E 23:59:59.999+03:00 (the whole end day, inclusive). Qatar is UTC+3 all year.
 */

const QATAR_OFFSET_MS = 3 * 3_600_000;

/** Today's calendar date in Qatar, "2026-11-17". */
export const qatarToday = (now: number = Date.now()): string => new Date(now + QATAR_OFFSET_MS).toISOString().slice(0, 10);
/** A real calendar date written YYYY-MM-DD (not 2026-02-30). */
export const isCalendarDate = (s: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
export const startOfQatarDay = (d: string): string => `${d}T00:00:00.000+03:00`;
export const endOfQatarDay = (d: string): string => `${d}T23:59:59.999+03:00`;
/** The Qatar calendar date of an instant, '' for none. */
export const qatarDateOf = (iso: string | null | undefined): string => toQatarInput(iso).slice(0, 10);

export interface OfferRow {
  id: string;
  nameEn: string;
  barcode: string;
  status: ProductStatus;
  /** The price without any offer; null when the server did not say (the preview checks it). */
  normalPrice: number | null;
  /** The current offer; null = none; undefined = not known (an older backend). */
  offer: ProductOfferSummary | null | undefined;
  /** As typed. */
  price: string;
  start: string;
  end: string;
}

/** The normal price: the backend's normalPrice, else the resolved price when no offer sets it. */
export function normalPriceOf(p: ProductItem): number | null {
  if (typeof p.normalPrice === 'number' && Number.isFinite(p.normalPrice)) return p.normalPrice;
  if (p.marketplacePrice && p.marketplacePrice.source !== 'offer' && Number.isFinite(p.marketplacePrice.price)) return p.marketplacePrice.price;
  return null;
}

export function rowFrom(p: ProductItem, today: string): OfferRow {
  return {
    id: p.id, nameEn: p.nameEn, barcode: p.barcode, status: p.status, normalPrice: normalPriceOf(p),
    offer: p.offer, price: '', start: today, end: '',
  };
}

/** The discount in percent of the normal price, one decimal; null when it cannot be worked out. */
export function offPercent(normal: number | null, priceTyped: string): number | null {
  const t = priceTyped.trim();
  const price = Number(t);
  if (!t || !Number.isFinite(price) || normal === null || !(normal > 0)) return null;
  return Math.round(((normal - price) / normal) * 1000) / 10;
}
export const offText = (pct: number | null): string => (pct === null ? '—' : `${pct} %`);

const threeDecimals = (n: number) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;

/** Every reason this row cannot be sent, in plain words; [] = ready. */
export function rowProblems(r: OfferRow, today: string): string[] {
  const out: string[] = [];
  if (r.status !== 'active') out.push('Product is not active');
  const t = r.price.trim();
  const price = Number(t);
  if (!t) out.push('Enter a promo price');
  else if (!Number.isFinite(price)) out.push('Enter a number');
  else if (price <= 0) out.push('Promo price must be above 0');
  else if (!threeDecimals(price)) out.push('Use at most 3 decimals');
  else if (r.normalPrice !== null && price >= r.normalPrice) out.push(`Promo price must be below the normal price (${priceText(r.normalPrice)} QAR)`);
  else if (price > PRICE_CHANGE_MAX) out.push(`Promo price must be at most ${PRICE_CHANGE_MAX.toLocaleString('en-US')} QAR`);
  const startOk = r.start === '' || isCalendarDate(r.start);
  if (!startOk) out.push('Enter a valid start date');
  else if (r.start && r.start < today) out.push('Start date is in the past');
  if (!r.end) out.push('Enter an end date');
  else if (!isCalendarDate(r.end)) out.push('Enter a valid end date');
  else if (r.end < today) out.push('End date is in the past');
  else if (startOk && r.start && r.end < r.start) out.push('End date is before the start date');
  return out;
}

/** The rows that pass every check, as the API items. */
export function itemsOf(rows: readonly OfferRow[], today: string): BulkOfferItem[] {
  return rows.filter(r => rowProblems(r, today).length === 0).map(r => ({
    productId: r.id,
    price: Math.round(Number(r.price.trim()) * 1000) / 1000,
    ...(r.start ? { validFrom: startOfQatarDay(r.start) } : {}),
    validUntil: endOfQatarDay(r.end),
  }));
}

export interface SameForAll { price: string; start: string; end: string }
/** The filled-in "Same … for all" values copied to every row; empty ones leave the rows as they are. */
export function applyToAll(rows: readonly OfferRow[], same: SameForAll): OfferRow[] {
  const price = same.price.trim();
  return rows.map(r => ({ ...r, ...(price ? { price } : {}), ...(same.start ? { start: same.start } : {}), ...(same.end ? { end: same.end } : {}) }));
}

// ───────── Answers ─────────

export const REJECT_LABELS: Record<string, string> = {
  not_found: 'Product not found',
  product_not_active: 'Product is not active',
  not_active: 'Product is not active',
  invalid_price: 'Promo price is not valid',
  price_not_below_normal: 'Promo price is not below the normal price',
  invalid_date: 'A date is not valid',
  end_required: 'End date is required',
  end_before_start: 'End date is before the start date',
  already_ended: 'End date is in the past',
  duplicate_row: 'Product appears more than once',
};
export const rejectText = (r: BulkOfferPreviewRow): string => r.message || (r.reason ? REJECT_LABELS[r.reason] ?? r.reason : 'Rejected');

const OUTCOMES: Record<string, BulkOfferOutcome> = {
  set: 'set', will_change: 'set', changed: 'set', unchanged: 'unchanged', rejected: 'rejected', blocked: 'rejected',
};
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (...vs: unknown[]): number | undefined => vs.find((v): v is number => typeof v === 'number' && Number.isFinite(v));

function readWarning(v: unknown): BulkOfferWarning | undefined {
  if (typeof v === 'string' && v) return { code: v };
  if (!v || typeof v !== 'object') return undefined;
  const w = v as Record<string, unknown>;
  const code = str(w.code);
  return code ? { code, message: str(w.message), marketplaceId: str(w.marketplaceId) } : undefined;
}
function readRow(v: unknown): BulkOfferPreviewRow | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const productId = str(r.productId);
  const outcome = OUTCOMES[String(r.outcome ?? r.status ?? '')];
  if (!productId || !outcome) return undefined;
  return {
    productId, outcome, nameEn: str(r.nameEn), barcode: str(r.barcode), reason: str(r.reason), message: str(r.message),
    warnings: Array.isArray(r.warnings) ? r.warnings.map(readWarning).filter((w): w is BulkOfferWarning => Boolean(w)) : [],
  };
}

/** The preview answer as the client may trust it: counts from the answer, else counted from its rows. */
export function readBulkOfferPreview(raw: unknown): BulkOfferPreview {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const c = o.counts && typeof o.counts === 'object' ? o.counts as Record<string, unknown> : {};
  const rows = Array.isArray(o.rows) ? o.rows.map(readRow).filter((r): r is BulkOfferPreviewRow => Boolean(r)) : [];
  const counted = (k: BulkOfferOutcome) => rows.filter(r => r.outcome === k).length;
  return {
    willChange: num(o.willChange, c.willChange, c.toSet) ?? counted('set'),
    unchanged: num(o.unchanged, c.unchanged) ?? counted('unchanged'),
    rejected: num(o.rejected, o.blocked, c.rejected, c.invalid) ?? counted('rejected'),
    rows,
    previewToken: str(o.previewToken),
  };
}
export function readBulkOfferResult(raw: unknown): BulkOfferApplyResult {
  const o = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return { ...readBulkOfferPreview(raw), replayed: o.replayed === true, operationId: str(o.operationId), appliedAt: str(o.appliedAt) };
}

/** The warnings of a preview, grouped: products replacing an offer, products per marketplace whose export price wins. */
export function warningSummary(rows: readonly BulkOfferPreviewRow[]): { replaces: number; outranks: { marketplaceId: string; products: number }[]; other: string[] } {
  let replaces = 0;
  const outranks = new Map<string, number>();
  const other = new Set<string>();
  for (const r of rows) {
    if (r.outcome !== 'set') continue;
    for (const w of r.warnings) {
      if (w.code === 'replaces_offer') replaces++;
      else if (w.code === 'export_value_outranks') { const m = w.marketplaceId ?? ''; outranks.set(m, (outranks.get(m) ?? 0) + 1); }
      else other.add(w.message || w.code);
    }
  }
  return { replaces, outranks: [...outranks].map(([marketplaceId, products]) => ({ marketplaceId, products })), other: [...other] };
}
