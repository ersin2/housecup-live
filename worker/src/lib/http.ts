import type { Context, MiddlewareHandler } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { ZodType } from 'zod';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AppEnv } from '../env.ts';

export class ApiError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new ApiError(404, 'NOT_FOUND', `${what} not found`);

export function errorBody(code: string, message: string, details?: unknown) {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

/** Zod validation with the standard error envelope. */
export function zv<T extends ZodType>(target: 'json' | 'query' | 'param', schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (!result.success) {
      return c.json(
        errorBody(
          'VALIDATION',
          'Request validation failed',
          result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        ),
        400,
      );
    }
  });
}

export const noStore: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
};

/**
 * CSRF defense in depth (cookies are already SameSite=Strict): reject mutating requests
 * whose Origin is present and not ours, or that the browser marks as cross-site.
 */
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const origin = c.req.header('Origin');
    const site = c.req.header('Sec-Fetch-Site');
    const self = new URL(c.req.url).origin;
    const extra = (c.env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const originOk = !origin || origin === self || extra.includes(origin);
    if (!originOk || site === 'cross-site') {
      throw new ApiError(403, 'BAD_ORIGIN', 'Cross-origin request rejected');
    }
  }
  await next();
};

export function clientIp(c: Context): string {
  return c.req.header('CF-Connecting-IP') ?? 'unknown';
}

export function parseId(raw: string | undefined, what = 'Resource'): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw notFound(what);
  return n;
}
