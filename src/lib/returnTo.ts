/** Only local application paths may be used after authentication. */
export const safeReturnTo = (next?: string | null): string => next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') && !/[\u0000-\u001f]/.test(next) ? next : '/';
export const returnQuery = (next?: string | null) => `?next=${encodeURIComponent(safeReturnTo(next))}`;
