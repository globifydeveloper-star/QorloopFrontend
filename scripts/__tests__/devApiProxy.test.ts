import { EventEmitter } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import { devApiProxy } from '../devApiProxy';
import { NETWORK_MESSAGE } from '../../src/api/network';

const configuredProxy = () => {
  const proxy = new EventEmitter();
  const options = devApiProxy('http://localhost:4000');
  options.configure!(proxy as never, options);
  return proxy;
};
describe('dev API proxy connection failures', () => {
  it.each(['127.0.0.1', 'localhost'])('passes through a real 500 and marks connection refusal through %s after the upstream server stops', async targetHost => {
    const upstream = createHttpServer((_request, response) => {
      response.writeHead(500, { 'Content-Type': 'application/json', 'X-Request-ID': 'upstream-request' });
      response.end(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }, requestId: 'upstream-request' }));
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamPort = (upstream.address() as { port: number }).port;
    const vite = await createViteServer({ configFile: false, logLevel: 'silent', server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false, watch: null, proxy: { '/api': devApiProxy(`http://${targetHost}:${upstreamPort}`) } } });
    try {
      await vite.listen();
      const proxyPort = (vite.httpServer!.address() as { port: number }).port;
      const url = `http://127.0.0.1:${proxyPort}/api/activity`;
      const serverError = await fetch(url);
      expect(serverError.status).toBe(500); expect(serverError.headers.get('X-Request-ID')).toBe('upstream-request');
      expect(await serverError.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR' }, requestId: 'upstream-request' });
      await new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
      const disconnected = await fetch(url);
      expect(disconnected.status).toBe(503); expect(disconnected.headers.has('X-Request-ID')).toBe(false);
      expect(await disconnected.json()).toEqual({ error: { code: 'UPSTREAM_UNREACHABLE', message: NETWORK_MESSAGE } });
    } finally {
      if (upstream.listening) await new Promise<void>(resolve => upstream.close(() => resolve()));
      await vite.close();
    }
  }, 15_000);
  it.each(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT'])('marks %s without inventing a backend Request ID', code => {
    const proxy = configuredProxy();
    const response = { headersSent: false, writableEnded: false, writeHead: vi.fn(), end: vi.fn() };
    proxy.emit('error', Object.assign(new Error('Not displayed'), { code }), {}, response);
    expect(response.writeHead).toHaveBeenCalledWith(503, { 'Content-Type': 'application/json' });
    expect(JSON.parse(response.end.mock.calls[0][0])).toEqual({ error: { code: 'UPSTREAM_UNREACHABLE', message: NETWORK_MESSAGE } });
  });
  it('marks an aggregated localhost refusal without an outer code', () => {
    const proxy = configuredProxy();
    const response = { headersSent: false, writableEnded: false, writeHead: vi.fn(), end: vi.fn() };
    const error = new AggregateError([
      Object.assign(new Error('IPv6 refused'), { code: 'ECONNREFUSED' }),
      Object.assign(new Error('IPv4 refused'), { code: 'ECONNREFUSED' }),
    ]);
    proxy.emit('error', error, {}, response);
    expect(response.writeHead).toHaveBeenCalledWith(503, { 'Content-Type': 'application/json' });
    expect(JSON.parse(response.end.mock.calls[0][0]).error.code).toBe('UPSTREAM_UNREACHABLE');
  });
  it.each([new AggregateError([]), new AggregateError([new Error('Other failure')]), new AggregateError([Object.assign(new Error('Refused'), { code: 'ECONNREFUSED' }), new Error('Other failure')])])('does not label unknown aggregate failures as network errors', error => {
    const proxy = configuredProxy();
    const response = { headersSent: false, writableEnded: false, writeHead: vi.fn(), end: vi.fn() };
    proxy.emit('error', error, {}, response);
    expect(response.writeHead).not.toHaveBeenCalled(); expect(response.end).not.toHaveBeenCalled();
  });
  it('does not rewrite other errors, responses already started, or normal upstream HTTP responses', () => {
    const proxy = configuredProxy();
    const response = { headersSent: false, writableEnded: false, writeHead: vi.fn(), end: vi.fn() };
    proxy.emit('error', Object.assign(new Error('Other failure'), { code: 'OTHER' }), {}, response);
    proxy.emit('error', Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' }), {}, { ...response, headersSent: true });
    proxy.emit('proxyRes', { statusCode: 500 }, {}, response);
    expect(response.writeHead).not.toHaveBeenCalled(); expect(response.end).not.toHaveBeenCalled();
  });
});
