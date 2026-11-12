/**
 * Advanced options (the ERP price comparison) live behind a small "Advanced" disclosure. Its state is in the URL as
 * ?advanced=1 so a link opens it too. A link that already names the ERP price (?reference=erp) opens it as well,
 * because that choice is only shown inside it. Without Advanced, the daily screens compare with My pricing.
 */
export const ADVANCED_PARAM = 'advanced';

export function advancedOpen(search: string | URLSearchParams): boolean {
  const p = typeof search === 'string' ? new URLSearchParams(search) : search;
  return p.get(ADVANCED_PARAM) === '1' || p.get('reference') === 'erp';
}

/** The URL parameters with Advanced opened or closed. Closing it also drops a reference chosen inside it. */
export function withAdvanced(search: URLSearchParams, open: boolean): URLSearchParams {
  const next = new URLSearchParams(search);
  if (open) next.set(ADVANCED_PARAM, '1');
  else {
    next.delete(ADVANCED_PARAM);
    next.delete('reference');
  }
  return next;
}
