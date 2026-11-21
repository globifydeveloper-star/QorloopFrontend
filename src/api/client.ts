import type { ApiErrorBody } from './types';
import { connectionFailed, connectionReached } from './connectivity';
import { NETWORK_MESSAGE, UPSTREAM_UNREACHABLE } from './network';

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
    /** Small fixed fields of an actionable code (attemptsLeft, retryAfterSeconds, window). Never free text. */
    readonly meta: Record<string, unknown> = {},
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

const authIssueListeners = new Set<(error: ApiError) => void>();
export function onAuthIssue(fn: (error: ApiError) => void) {
  authIssueListeners.add(fn);
  return () => void authIssueListeners.delete(fn);
}

/**
 * "Confirm it's you" (ADR 021): any request may answer 403 STEP_UP_REQUIRED (error.meta.window: security, work or
 * single). The app registers one handler (the StepUpDialog) that asks for a fresh code and resolves true once it is
 * verified, false when the user cancels. Requests that hit the step-up at the same time share one dialog. The original
 * request is then sent once more: the server refused it before doing anything, so repeating it is safe.
 */
export type StepUpHandler = (window: string | undefined) => Promise<boolean>;
let stepUpHandler: StepUpHandler | null = null;
/** The confirmation in progress. Settled by the handler, or as cancelled when the handler goes away (dialog unmounted). */
let stepUpPending: { promise: Promise<boolean>; settle: (ok: boolean) => void } | null = null;
export function setStepUpHandler(fn: StepUpHandler) {
  stepUpHandler = fn;
  return () => {
    if (stepUpHandler !== fn) return;
    stepUpHandler = null;
    stepUpPending?.settle(false);
  };
}
export const isStepUpRequired = (e: unknown): boolean => e instanceof ApiError && e.status === 403 && e.code === 'STEP_UP_REQUIRED';
/** What a screen says when the user closed "Confirm it's you": not a permission problem, and nothing was changed. */
export const STEP_UP_CANCELLED = "Confirm it's you to continue: this action needs a fresh code. Nothing was changed.";
function confirmIdentity(window: string | undefined): Promise<boolean> {
  if (!stepUpHandler) return Promise.resolve(false);
  if (!stepUpPending) {
    let settle!: (ok: boolean) => void;
    const entry = { promise: new Promise<boolean>(r => { settle = r; }), settle: (ok: boolean) => settle(ok) };
    stepUpPending = entry;
    void entry.promise.then(() => { if (stepUpPending === entry) stepUpPending = null; });
    stepUpHandler(window).then(ok => entry.settle(ok), () => entry.settle(false));
  }
  return stepUpPending.promise;
}
async function withStepUp<T>(send: () => Promise<T>, stepUp: boolean): Promise<T> {
  try { return await send(); } catch (e) {
    if (!stepUp || !isStepUpRequired(e)) throw e;
    const meta = (e as ApiError).meta;
    const window = typeof meta.window === 'string' ? meta.window : undefined;
    if (!(await confirmIdentity(window))) throw e;
    return send();
  }
}

/** Codes the sign-in and code screens show themselves: never the global "session expired" flow. */
export const OTP_CODES = ['OTP_INVALID', 'OTP_LOCKED', 'CHALLENGE_EXPIRED', 'OTP_SEND_LIMIT'] as const;

export function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const hit = document.cookie.split('; ').find(c => c.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : undefined;
}
/** `qorloop.csrf` in development, `__Host-qorloop.csrf` in production (backend cookieName()). */
export const csrfToken = () => readCookie('__Host-qorloop.csrf') ?? readCookie('qorloop.csrf');

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
  /** Auth endpoints answer 401 for "wrong password": don't treat that as an expired session. */
  expectUnauthorized?: boolean;
  /** These error codes are answers the caller shows itself (e.g. OTP_INVALID): no global session handling for them. */
  expectedCodes?: readonly string[];
  /** false: a 403 STEP_UP_REQUIRED is returned to the caller instead of opening the "Confirm it's you" dialog. */
  stepUp?: boolean;
}

export function api<T>(path: string, opts: Options = {}): Promise<T> {
  return withStepUp(() => send<T>(path, opts), opts.stepUp !== false && !opts.expectUnauthorized);
}

async function send<T>(path: string, opts: Options): Promise<T> {
  const method = opts.method ?? 'GET';
  const queryString = opts.query
    ? new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString()
    : '';
  const qs = queryString ? '?' + queryString : '';
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
    connectionFailed();
    throw new ApiError(0, 'NETWORK', NETWORK_MESSAGE);
  }

  const text = await readBody(() => res.text());
  const json = parseJson(text);
  if (!res.ok) throw failure(res, json, opts.expectUnauthorized, opts.expectedCodes);
  connectionReached();
  return ((json as { data?: T } | undefined)?.data ?? (json as T)) as T;
}

/**
 * GET a binary file (cookies sent, body read as a Blob). Non-2xx is handled exactly like api(), including 401 and the
 * step-up dialog: a fetched download can ask "Confirm it's you" and retry, which a plain <a href> could not.
 */
export function apiBlob(path: string, signal?: AbortSignal): Promise<{ blob: Blob; headers: Headers }> {
  return withStepUp(() => sendBlob(path, signal), true);
}

async function sendBlob(path: string, signal?: AbortSignal): Promise<{ blob: Blob; headers: Headers }> {
  let res: Response;
  try {
    res = await fetch(BASE + path, { method: 'GET', credentials: 'include', signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    connectionFailed();
    throw new ApiError(0, 'NETWORK', NETWORK_MESSAGE);
  }
  // Error bodies are JSON ({ error: { code, message } }) when the backend sends them; anything else gets a generic message.
  if (!res.ok) throw failure(res, parseJson(await readBody(() => res.text())));
  const blob = await readBody(() => res.blob());
  connectionReached();
  return { blob, headers: res.headers };
}

async function readBody<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    connectionFailed();
    throw new ApiError(0, 'NETWORK', NETWORK_MESSAGE);
  }
}

function parseJson(text: string): unknown {
  try { return text ? JSON.parse(text) : undefined; } catch { return undefined; }
}

function failure(res: Response, json: unknown, expectUnauthorized?: boolean, expectedCodes?: readonly string[]): ApiError {
  const body = (json ?? {}) as Partial<ApiErrorBody>;
  if ((res.status === 502 || res.status === 503) && body.error?.code === UPSTREAM_UNREACHABLE) {
    connectionFailed();
    return new ApiError(0, 'NETWORK', NETWORK_MESSAGE);
  }
  connectionReached();
  const msg = body.error?.message;
  const message = Array.isArray(msg) ? msg.join(' ') : msg ?? `Request failed (${res.status})`;
  const error = new ApiError(res.status, body.error?.code ?? 'ERROR', message, body.error?.details, body.requestId ?? res.headers.get('X-Request-ID') ?? undefined, body.error?.meta ?? {});
  if (!expectUnauthorized && !expectedCodes?.includes(error.code)) {
    // 401 SESSION_EXPIRED also means "this device's trust ended": either way, sign in again.
    if (res.status === 401) sessionExpiredListeners.forEach(fn => fn());
    if (res.status === 401 || (res.status === 403 && ['AUTHENTICATOR_SETUP_REQUIRED', 'CSRF_REQUIRED'].includes(error.code)))
      authIssueListeners.forEach(fn => fn(error));
  }
  return error;
}
