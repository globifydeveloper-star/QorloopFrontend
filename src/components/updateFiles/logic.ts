import { AlertOctagon, Ban, CheckCircle2, Clock, Pin, RotateCcw, XCircle } from 'lucide-react';
import { ApiError } from '../../api/client';
import { friendlyError } from '../../api/errors';
import type { ReconRow } from '../../api/recon';
import {
  readValueItem, type FieldMeta, type MarketplaceValueItem, type SetValues, type ValueField,
} from '../../api/marketplaceValues';
import { PRICE, count, isStale, readNumber } from '../pricing/priceChange';

/**
 * "Update marketplace files" without React: the row's state in words, the optimistic version of a save, and API errors as
 * plain sentences. Comparisons are in integer fils, as the backend compares.
 */

export const fils = (n: number) => Math.round(n * 1000);
export const samePrice = (a: number | null | undefined, b: number | null | undefined) => a != null && b != null && fils(a) === fils(b);

/** The export value of a row, or undefined on a backend without it (then nothing can be edited). */
export const valuesOf = (row: ReconRow): MarketplaceValueItem | undefined => readValueItem(row.marketplaceValues);

// ───────── State badge ─────────

export type RowStateKey = 'needs_fix' | 'in_sync' | 'waiting' | 'pinned' | 'blocked' | 'cleared' | 'unknown';
type IconT = typeof CheckCircle2;
export interface RowStateMeta { key: RowStateKey; label: string; tone: string; Icon: IconT; detail?: string }

const TONES = {
  red: 'bg-red-50 text-red-700 border-red-200',
  blue: 'bg-blue-50 text-blue-800 border-blue-200',
  violet: 'bg-violet-50 text-violet-800 border-violet-200',
  amber: 'bg-amber-50 text-amber-900 border-amber-300',
  green: 'bg-[#E3FAF3] text-[#027864] border-[#027864]/30',
  gray: 'bg-gray-100 text-gray-700 border-gray-300',
};

/** The words the owner chose (addendum §3); the server's own label wins when it sends one. */
export const STATE_WORDS = {
  needs_fix: 'Needs fix', in_sync: 'In sync', waiting: 'Adjusted, waiting for export', pinned: 'Pinned', blocked: 'Blocked', cleared: 'Cleared',
} as const;

export function rowState(row: ReconRow, item = valuesOf(row)): RowStateMeta {
  const mismatch = row.status === 'mismatch';
  if (!item) return mismatch ? { key: 'needs_fix', label: STATE_WORDS.needs_fix, tone: TONES.red, Icon: XCircle } : { key: 'unknown', label: '—', tone: TONES.gray, Icon: CheckCircle2 };
  switch (item.exportState) {
    case 'blocked':
      return { key: 'blocked', label: STATE_WORDS.blocked, tone: TONES.amber, Icon: Ban, detail: item.blockedReasonLabel ?? 'It cannot be exported' };
    case 'waiting_for_export':
      return { key: 'waiting', label: item.exportStateLabel ?? STATE_WORDS.waiting, tone: TONES.blue, Icon: Clock };
    case 'pinned':
      return { key: 'pinned', label: item.exportStateLabel ?? STATE_WORDS.pinned, tone: TONES.violet, Icon: Pin };
    case 'cleared':
      return mismatch ? { key: 'needs_fix', label: STATE_WORDS.needs_fix, tone: TONES.red, Icon: XCircle, detail: 'Your earlier adjustment was cleared' }
        : { key: 'cleared', label: STATE_WORDS.cleared, tone: TONES.gray, Icon: RotateCcw };
    case 'catalogue':
    default:
      return mismatch ? { key: 'needs_fix', label: STATE_WORDS.needs_fix, tone: TONES.red, Icon: AlertOctagon } : { key: 'in_sync', label: STATE_WORDS.in_sync, tone: TONES.green, Icon: CheckCircle2 };
  }
}

/** A pending adjustment of the manager on this field (fix once or pinned). */
export const pending = <V>(m: FieldMeta<V> | null): m is FieldMeta<V> => Boolean(m && m.state === 'pending');
export const hasAdjustment = (item: MarketplaceValueItem) => pending(item.overrides.availability) || pending(item.overrides.price);
export const isPinned = (item: MarketplaceValueItem) =>
  (pending(item.overrides.availability) && item.overrides.availability.persistent) || (pending(item.overrides.price) && item.overrides.price.persistent);

/** "Differs from the rule price" for a typed price: the server's flag, or the exact fils comparison it uses. */
export function differsFromRule(item: MarketplaceValueItem): boolean {
  if (!pending(item.overrides.price)) return false;
  if (item.differsFromRulePrice !== undefined) return item.differsFromRulePrice;
  return item.rulePrice !== undefined && !samePrice(item.overrides.price.value, item.rulePrice);
}

// ───────── Where the value to export comes from ─────────

export type ValueSource =
  | { kind: 'catalogue' }
  | { kind: 'marketplace'; name: string }
  | { kind: 'adjusted' }
  /** Availability forced to Unavailable because the product cannot be sold here. */
  | { kind: 'guard' };

/** The copy proposal's default reason: "Copied from <B label>". */
const COPIED_FROM = /^Copied from (.+)$/;

export function fieldSource(item: MarketplaceValueItem, field: ValueField, nameOf: (id: string) => string = id => id): ValueSource {
  const from = field === 'availability' ? item.export.availabilitySource : item.export.priceSource;
  if (from === 'eligibility_guard') return { kind: 'guard' };
  if (from === 'catalogue') return { kind: 'catalogue' };
  const meta = item.overrides[field];
  if (meta?.sourceMarketplaceId) return { kind: 'marketplace', name: nameOf(meta.sourceMarketplaceId) };
  const copied = meta?.reason ? COPIED_FROM.exec(meta.reason.trim()) : null;
  return copied ? { kind: 'marketplace', name: copied[1]! } : { kind: 'adjusted' };
}

export function sourceWords(s: ValueSource): string {
  switch (s.kind) {
    case 'catalogue': return 'from the catalogue';
    case 'marketplace': return `from ${s.name}`;
    case 'adjusted': return 'adjusted by hand';
    case 'guard': return 'unavailable, as it cannot be sold here';
  }
}

/** "Availability and price from the catalogue", or "Availability from the catalogue · price from Talabat". */
export function sourceText(item: MarketplaceValueItem, nameOf?: (id: string) => string): string {
  const a = sourceWords(fieldSource(item, 'availability', nameOf));
  const p = sourceWords(fieldSource(item, 'price', nameOf));
  return a === p ? `Availability and price ${a}` : `Availability ${a} · price ${p}`;
}

// ───────── Optimistic versions of a save (replaced by the server's answer, or rolled back) ─────────

function settle(item: MarketplaceValueItem): MarketplaceValueItem {
  const av = item.overrides.availability; const pr = item.overrides.price;
  const open = pending(av) || pending(pr);
  if (item.exportState === 'blocked' && open) return item;
  if (!open) return { ...item, exportState: item.version ? 'cleared' : 'catalogue', exportStateLabel: null };
  // Pinned only when every pending field is pinned and the marketplace already shows it; otherwise waiting for export.
  const avOk = !pending(av) || (av.persistent && av.value === item.marketplaceCurrent.available);
  const prOk = !pending(pr) || (pr.persistent && samePrice(pr.value, item.marketplaceCurrent.price));
  const allPinnedAndShown = avOk && prOk;
  return { ...item, exportState: allPinnedAndShown ? 'pinned' : 'waiting_for_export', exportStateLabel: null };
}

export function applySet(item: MarketplaceValueItem, values: SetValues, now = new Date().toISOString()): MarketplaceValueItem {
  const meta = <V>(v: V, persistent: boolean | undefined): FieldMeta<V> =>
    ({ value: v, state: 'pending', persistent: persistent ?? false, fieldState: null, setAt: now, reason: null, clearedAt: null });
  const next: MarketplaceValueItem = { ...item, export: { ...item.export }, overrides: { ...item.overrides } };
  if (values.availability) {
    next.overrides.availability = meta(values.availability.value, values.availability.persistent);
    next.export.available = values.availability.value;
    next.export.availabilitySource = 'override';
  }
  if (values.price) {
    next.overrides.price = meta(values.price.value, values.price.persistent);
    next.export.price = values.price.value;
    next.export.priceSource = 'override';
    if (item.rulePrice !== undefined) next.differsFromRulePrice = !samePrice(values.price.value, item.rulePrice);
  }
  return settle(next);
}

export function applyUseCatalogue(item: MarketplaceValueItem, fields: readonly ValueField[], now = new Date().toISOString()): MarketplaceValueItem {
  const next: MarketplaceValueItem = { ...item, export: { ...item.export }, overrides: { ...item.overrides } };
  for (const f of fields) {
    const m = next.overrides[f];
    if (f === 'availability') {
      next.overrides.availability = m ? { ...(m as FieldMeta<boolean>), state: 'cleared', clearedAt: now } : null;
      next.export.available = item.catalogue.available; next.export.availabilitySource = 'catalogue';
    } else {
      next.overrides.price = m ? { ...(m as FieldMeta<number>), state: 'cleared', clearedAt: now } : null;
      next.export.price = item.catalogue.price; next.export.priceSource = 'catalogue';
      next.differsFromRulePrice = false;
    }
  }
  return settle(next);
}

/** The fields this row has a pending adjustment on, so "Keep until I remove it" can re-save them with the new flag. */
export function resaveWithPersistent(item: MarketplaceValueItem, persistent: boolean): SetValues | null {
  const out: SetValues = {};
  if (pending(item.overrides.availability)) out.availability = { value: item.overrides.availability.value, persistent };
  if (pending(item.overrides.price)) out.price = { value: item.overrides.price.value, persistent };
  return out.availability || out.price ? out : null;
}

// ───────── Typed values ─────────

/** A price above 0, at most 100,000 QAR, at most 3 decimals (the proposal's bounds, the same as manual prices). */
export const readExportPrice = (text: string) => readNumber(text, PRICE);

// ───────── Errors in plain words ─────────

export const STALE_VALUE = 'Someone changed this product after you loaded the list. The newer values are shown now; check them and try again.';
export const NO_EDIT_PERMISSION = 'You do not have permission to change the marketplace values. Ask your store Owner or an Admin.';

/**
 * A 400's field message (by detail path ending in availability, price or reason) and everything else as one sentence. 409 is
 * `stale` (reload the list); sign-in, connection and server problems use the shared error helper's words.
 */
export function valueErrors(e: unknown): { fields: Partial<Record<'availability' | 'price' | 'reason', string>>; general?: string; stale?: boolean } {
  if (!e) return { fields: {} };
  if (!(e instanceof ApiError) || e.status === 0 || e.status === 401 || e.status >= 500 || e.code === 'CSRF_REQUIRED') {
    if (e instanceof Error && e.message === 'UNREADABLE_VALUE_CHANGE') return { fields: {}, general: 'Saved, but the answer could not be read. The list is reloading.', stale: true };
    const f = friendlyError(e);
    return { fields: {}, general: `${f.title}. ${f.message}${f.requestId ? ` (Request ID ${f.requestId})` : ''}` };
  }
  if (isStale(e)) return { fields: {}, general: STALE_VALUE, stale: true };
  if (e.status === 403) return { fields: {}, general: NO_EDIT_PERMISSION };
  if (e.status === 404) return { fields: {}, general: 'This product was not found. It may have been removed; reload the page.' };
  const fields: Partial<Record<'availability' | 'price' | 'reason', string>> = {};
  const rest: string[] = [];
  for (const d of e.details) {
    if (!d.message) continue;
    const key = (['availability', 'price', 'reason'] as const).find(k => d.path?.split('.').includes(k));
    if (key) { if (!fields[key]) fields[key] = d.message; } else if (!rest.includes(d.message)) rest.push(d.message);
  }
  if (rest.length) return { fields, general: rest.join(' ') };
  if (Object.keys(fields).length) return { fields };
  return { fields, general: e.message === 'Validation failed' ? 'Some values were not accepted. Check them and try again.' : e.message };
}

export const rowsText = (n: number) => `${count(n)} ${n === 1 ? 'product' : 'products'}`;
