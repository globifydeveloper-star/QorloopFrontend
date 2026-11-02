import { ApiError } from '../../api/client';
import { INLINE_PERCENT_MAX, INLINE_PERCENT_MIN, PRICE_CHANGE_MAX, type InlinePriceMode } from '../../api/pricing';

/**
 * Pure helpers shared by the inline price edit and the bulk price change (ADR 013): prices to 3 decimals, numbers
 * checked in plain words before any call, and API errors as plain sentences.
 */

export const count = (n: number) => n.toLocaleString('en-US');

/** A price as the API stores it (whole fils): 2 decimals, or 3 when the third one is not 0 (6.325 stays 6.325). */
export function priceText(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const fils = Math.round(n * 1000);
  return (fils / 1000).toFixed(fils % 10 === 0 ? 2 : 3);
}
/** "+1.50", "−0.25", "0.00". */
export function signedPrice(n: number): string {
  const fils = Math.round(n * 1000);
  return fils === 0 ? '0.00' : `${fils > 0 ? '+' : '−'}${priceText(Math.abs(fils) / 1000)}`;
}

// ───────── Numbers typed by the user ─────────

const threeDecimals = (n: number) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;

/** The number in a text field, or the reason it cannot be sent (same bounds as the contract, in plain words). */
export function readNumber(text: string, what: { empty: string; min: number; minInclusive: boolean; max: number; range: string }):
  { value: number; error?: undefined } | { value?: undefined; error: string } {
  const t = text.trim();
  if (!t) return { error: what.empty };
  const n = Number(t);
  if (!Number.isFinite(n)) return { error: 'Enter a number' };
  if (what.minInclusive ? n < what.min : n <= what.min) return { error: what.range };
  if (n > what.max) return { error: what.range };
  if (!threeDecimals(n)) return { error: 'Use at most 3 decimal places' };
  return { value: n };
}

export const PRICE = { empty: 'Enter a price', min: 0, minInclusive: false, max: PRICE_CHANGE_MAX, range: `Enter a price above 0 and at most ${count(PRICE_CHANGE_MAX)} QAR` };

/** Inline edit: a fixed price, or a percent over the ERP price (-90..1000). */
export function readInlineValue(mode: InlinePriceMode, text: string) {
  return mode === 'fixed'
    ? readNumber(text, PRICE)
    : readNumber(text, {
      empty: 'Enter a percent', min: INLINE_PERCENT_MIN, minInclusive: true, max: INLINE_PERCENT_MAX,
      range: `Enter a percent from ${INLINE_PERCENT_MIN} to ${count(INLINE_PERCENT_MAX)}`,
    });
}

// ───────── Errors ─────────

/**
 * Field messages from a 400's details (by path), and everything else as one plain sentence: unmatched detail messages
 * instead of the bare "Validation failed", 403 and 404 in words, other statuses with the server's own message (409s
 * from the pricing endpoints are written for people).
 */
export function changeErrors(e: unknown, fields: readonly string[] = []): { fields: Record<string, string>; general?: string } {
  if (!e) return { fields: {} };
  if (!(e instanceof ApiError)) return { fields: {}, general: 'Something went wrong. Please try again.' };
  if (e.status === 403) return { fields: {}, general: 'You do not have permission to change prices.' };
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

export const isStale = (e: unknown) => e instanceof ApiError && e.status === 409;

