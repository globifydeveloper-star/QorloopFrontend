/** Display helpers for the real (server-backed) screens: times in Asia/Qatar, money to 2 decimals. */

const TZ = 'Asia/Qatar';
/** Qatar has no daylight saving time: always UTC+3. */
const QATAR_OFFSET = '+03:00';
const QATAR_OFFSET_MS = 3 * 3_600_000;

const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});
/** "01 Nov 2026, 21:30" in Asia/Qatar, whatever the browser's time zone. */
export const qatarDateTime = (iso: string | null | undefined) => (iso ? DATE_TIME.format(new Date(iso)) : '—');

/** Money cell: 2 decimals, no currency (the column header or label carries "QAR"). */
export const money2 = (n: number | null | undefined) => (n === null || n === undefined || Number.isNaN(n) ? '—' : n.toFixed(2));

/** An ISO instant as a `<input type="datetime-local">` value in Qatar time ("2026-11-05T10:00"). */
export function toQatarInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : new Date(t + QATAR_OFFSET_MS).toISOString().slice(0, 16);
}

/** A datetime-local value read as Qatar time, as ISO with the +03:00 offset; '' gives null. */
export function fromQatarInput(value: string): string | null {
  return value ? `${value.length === 16 ? `${value}:00` : value}${QATAR_OFFSET}` : null;
}
