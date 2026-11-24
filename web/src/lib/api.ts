import type { ApiErrorBody } from '@housecup/shared/types';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

/** The request never reached the server (offline, DNS, dropped stadium 4G). */
export class NetworkError extends Error {
  constructor() {
    super('No connection');
  }
}

/** Worth retrying later with the same idempotency key. */
export function isRetryable(err: unknown): boolean {
  return err instanceof NetworkError || (err instanceof HttpError && (err.status >= 500 || err.status === 429));
}

export interface ApiInit {
  method?: string;
  json?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 12_000);
  init.signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.json === undefined ? 'GET' : 'POST'),
      headers: init.json === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
      credentials: 'same-origin',
      signal: ctrl.signal,
    });
  } catch {
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const e = (data as ApiErrorBody | null)?.error;
    throw new HttpError(res.status, e?.code ?? `HTTP_${res.status}`, e?.message ?? res.statusText, e?.details);
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof NetworkError) return 'No connection. Check your signal and try again.';
  if (err instanceof HttpError) return err.message;
  return 'Something went wrong.';
}
