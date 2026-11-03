import type { ProxyOptions } from 'vite';
import { NETWORK_MESSAGE, UPSTREAM_UNREACHABLE } from '../src/api/network.ts';

const CONNECTION_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT']);

/** Dual-stack localhost failures can contain individual connection errors in an AggregateError. */
function isConnectionFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const failure = error as { code?: string; errors?: unknown[] };
  if (failure.code && CONNECTION_CODES.has(failure.code)) return true;
  return Array.isArray(failure.errors) && failure.errors.length > 0 && failure.errors.every(isConnectionFailure);
}

/** Mark failure to obtain an upstream response; never reclassify an upstream HTTP 5xx. */
export const devApiProxy = (target: string): ProxyOptions => ({
  target, changeOrigin: false,
  configure(proxy) {
    proxy.on('error', (error, _request, response) => {
      if (!isConnectionFailure(error) || !('writeHead' in response) || response.headersSent || response.writableEnded) return;
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { code: UPSTREAM_UNREACHABLE, message: NETWORK_MESSAGE } }));
    });
  },
});
