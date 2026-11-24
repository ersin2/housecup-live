import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv } from '../env.ts';
import { ApiError } from './http.ts';
import { base64url, fromBase64url, hmacSign, hmacVerify, sha256Hex } from './crypto.ts';

export const JUDGE_COOKIE = 'hc_judge';
export const ADMIN_COOKIE = 'hc_admin';
export const JUDGE_TTL_MS = 14 * 60 * 60 * 1000;
export const ADMIN_TTL_MS = 12 * 60 * 60 * 1000;

const dec = new TextDecoder();
const enc = new TextEncoder();

function secret(c: Context<AppEnv>): string {
  const s = c.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new ApiError(500, 'MISCONFIGURED', 'SESSION_SECRET is not set (min 16 chars)');
  return s;
}

/** `<purpose>` is mixed into the MAC so a judge cookie can never be replayed as an admin cookie. */
export async function sign(c: Context<AppEnv>, purpose: string, payload: object): Promise<string> {
  const body = base64url(enc.encode(JSON.stringify(payload)));
  return `${body}.${await hmacSign(secret(c), `${purpose}.${body}`)}`;
}

export async function verify<T extends { x: number }>(
  c: Context<AppEnv>,
  purpose: string,
  value: string | undefined,
): Promise<T | null> {
  if (!value) return null;
  const dot = value.indexOf('.');
  if (dot <= 0) return null;
  const body = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!(await hmacVerify(secret(c), `${purpose}.${body}`, sig))) return null;
  try {
    const payload = JSON.parse(dec.decode(fromBase64url(body))) as T;
    if (typeof payload.x !== 'number' || payload.x < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function cookieOpts(maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict' as const,
    path: '/api',
    maxAge: Math.floor(maxAgeMs / 1000),
  };
}

export async function setSessionCookie(
  c: Context<AppEnv>,
  name: string,
  purpose: string,
  payload: object,
  ttlMs: number,
) {
  setCookie(c, name, await sign(c, purpose, payload), cookieOpts(ttlMs));
}

export function clearSessionCookie(c: Context<AppEnv>, name: string) {
  deleteCookie(c, name, { path: '/api', secure: true });
}

export function readCookie(c: Context<AppEnv>, name: string): string | undefined {
  return getCookie(c, name);
}

/** Short fingerprint of the event's judge token; rotating the token invalidates all judge sessions. */
export async function tokenFingerprint(token: string): Promise<string> {
  return (await sha256Hex(`judge-token:${token}`)).slice(0, 16);
}
