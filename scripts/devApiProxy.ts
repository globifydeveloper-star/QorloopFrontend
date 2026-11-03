import type { ProxyOptions } from 'vite';
import { NETWORK_MESSAGE, UPSTREAM_UNREACHABLE } from '../src/api/network.ts';

const CONNECTION_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT']);

/** Mark failure to obtain an upstream response; never reclassify an upstream HTTP 5xx. */
export const devApiProxy = (target: string): ProxyOptions => ({
  target, changeOrigin: false,
  configure(proxy) {
    proxy.on('error', (error, _request, response) => {
      if (!CONNECTION_CODES.has((error as NodeJS.ErrnoException).code ?? '') || !('writeHead' in response) || response.headersSent || response.writableEnded) return;
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { code: UPSTREAM_UNREACHABLE, message: NETWORK_MESSAGE } }));
    });
  },
});
