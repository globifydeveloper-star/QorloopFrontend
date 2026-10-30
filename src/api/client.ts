import type { ApiErrorBody } from './types';

/**
 * Typed fetch wrapper for the Qorloop API.
 *
 * - Same-origin by default (`VITE_API_BASE_URL` empty): the dev server proxies /api and production routes /api
 *   on the store's own host, which is how the backend resolves the tenant. No tenant ID is ever sent.
 * - Session is an HttpOnly cookie (credentials: 'include'); this code never sees or stores the session token.
 * - Mutations send the CSRF token from the readable `*.csrf` cookie the backend sets next to the session.
 * - No secrets live in VITE_ variables: they are public by design.
 */
const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: { path?: string; message: string }[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** Field-level validation messages keyed by field name (from the backend's Zod errors). */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of this.details) if (d.path && !out[d.path]) out[d.path] = d.message;
    return out;
  }
}

type Listener = () => void;
const sessionExpiredListeners = new Set<Listener>();
/** AuthContext subscribes so any 401 on a protected call moves the app to the session-expired screen. */
export function onSessionExpired(fn: Listener) {
  sessionExpiredListeners.add(fn);
  return () => void sessionExpiredListeners.delete(fn);
}

export function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const hit = document.cookie.split('; ').find(c => c.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : undefined;
}
/** `qorloop.csrf` in development, `__Host-qorloop.csrf` in production (backend cookieName()). */
export const csrfToken = () => readCookie('__Host-qorloop.csrf') ?? readCookie('qorloop.csrf');

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
  /** Auth endpoints answer 401 for "wrong password": don't treat that as an expired session. */
  expectUnauthorized?: boolean;
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const qs = opts.query
    ? '?' + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))
    : '';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    const csrf = csrfToken();
    if (csrf) headers['X-CSRF-Token'] = csrf;
  }

  let res: Response;
  try {
    res = await fetch(BASE + path + qs, {
      method, headers, credentials: 'include', signal: opts.signal,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'We could not reach the server. Check your connection and try again.');
  }

  const text = await res.text();
  const json = parseJson(text);
  if (!res.ok) throw failure(res, json, opts.expectUnauthorized);
  return ((json as { data?: T } | undefined)?.data ?? (json as T)) as T;
}

/** GET a binary file (cookies sent, body read as a Blob). Non-2xx is handled exactly like api(), including 401. */
export async function apiBlob(path: string, signal?: AbortSignal): Promise<{ blob: Blob; headers: Headers }> {
  let res: Response;
  try {
    res = await fetch(BASE + path, { method: 'GET', credentials: 'include', signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'We could not reach the server. Check your connection and try again.');
  }
  // Error bodies are JSON ({ error: { code, message } }) when the backend sends them; anything else gets a generic message.
  if (!res.ok) throw failure(res, parseJson(await res.text()));
  return { blob: await res.blob(), headers: res.headers };
}

function parseJson(text: string): unknown {
  try { return text ? JSON.parse(text) : undefined; } catch { return undefined; }
}

function failure(res: Response, json: unknown, expectUnauthorized?: boolean): ApiError {
  const body = (json ?? {}) as Partial<ApiErrorBody>;
  const msg = body.error?.message;
  const message = Array.isArray(msg) ? msg.join(' ') : msg ?? `Request failed (${res.status})`;
  if (res.status === 401 && !expectUnauthorized) sessionExpiredListeners.forEach(fn => fn());
  return new ApiError(res.status, body.error?.code ?? 'ERROR', message, body.error?.details, body.requestId ?? res.headers.get('X-Request-ID') ?? undefined);
}
