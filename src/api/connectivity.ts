/** A failed connection is distinct from an HTTP error response. Never replay mutations. */
let failed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(fn => fn());
export function connectionFailed() { failed = true; notify(); }
export function connectionReached() { if (failed) { failed = false; notify(); } }
export const connectionUnavailable = () => failed || (typeof navigator !== 'undefined' && navigator.onLine === false);
export function subscribeConnection(fn: () => void) {
  listeners.add(fn);
  window.addEventListener('offline', fn);
  window.addEventListener('online', fn);
  return () => { listeners.delete(fn); window.removeEventListener('offline', fn); window.removeEventListener('online', fn); };
}
