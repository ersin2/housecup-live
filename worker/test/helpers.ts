import { exports } from 'cloudflare:workers';
import { expect } from 'vitest';
import type { AdminEventDTO, PublicScoreboard } from '@housecup/shared/types';

let host = 'https://hc.test';
export function newHost() {
  host = `https://hc-${crypto.randomUUID().slice(0, 8)}.test`;
}
export const origin = () => host;

export interface CallInit {
  method?: string;
  json?: unknown;
  cookie?: string;
  headers?: Record<string, string>;
}

export async function call<T = any>(path: string, init: CallInit = {}) {
  const headers: Record<string, string> = { ...init.headers };
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  if (init.cookie) headers['Cookie'] = init.cookie;
  const res = await (exports as any).default.fetch(
    new Request(host + path, {
      method: init.method ?? (init.json !== undefined ? 'POST' : 'GET'),
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    }),
  );
  const text = res.status === 101 || res.status === 304 ? '' : await res.text();
  let body: any = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON (CSV)
  }
  return { status: res.status as number, body: body as T, text, res: res as Response };
}

export async function rawBytes(path: string, cookie?: string): Promise<Uint8Array> {
  const res = await (exports as any).default.fetch(new Request(host + path, { headers: cookie ? { Cookie: cookie } : {} }));
  return new Uint8Array(await res.arrayBuffer());
}

export function cookieFrom(res: Response): string {
  const parts = res.headers.getSetCookie().map((c) => c.split(';')[0]!);
  expect(parts.length).toBeGreaterThan(0);
  return parts.join('; ');
}

export async function adminCookie(): Promise<string> {
  const r = await call('/api/admin/login', { json: { passcode: 'test-admin-passcode' } });
  expect(r.status).toBe(200);
  return cookieFrom(r.res);
}

export const HOUSES = [
  { name: 'Phoenix', color_hex: '#E63946' },
  { name: 'Titans', color_hex: '#1D4ED8' },
  { name: 'Orion', color_hex: '#F59E0B' },
  { name: 'Zephyr', color_hex: '#10B981' },
];

export async function seedHouses(admin: string) {
  const ids: number[] = [];
  for (const h of HOUSES) {
    const r = await call('/api/admin/houses', { json: h, cookie: admin });
    expect(r.status).toBe(201);
    ids.push(r.body.house.id);
  }
  return ids;
}

export async function createEvent(admin: string, body: Record<string, unknown>): Promise<AdminEventDTO> {
  const r = await call('/api/admin/events', { json: body, cookie: admin });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.event as AdminEventDTO;
}

export async function judgeCookie(token: string): Promise<string> {
  const r = await call('/api/judge/session', { json: { token, judge_name: 'Ms. Tan' } });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return cookieFrom(r.res);
}

export async function save(judge: string, awards: [number, number][], label: string | null = null, batch_id = crypto.randomUUID()) {
  return call('/api/judge/batches', {
    cookie: judge,
    json: { batch_id, label, awards: awards.map(([event_team_id, points]) => ({ event_team_id, points })) },
  });
}

/** Standard fixture: 4 houses, one house-mode event, judge session. */
export async function sportsDay() {
  const admin = await adminCookie();
  const houseIds = await seedHouses(admin);
  const event = await createEvent(admin, { name: 'Sports Day', category: 'sports', teams: { mode: 'houses' } });
  const judge = await judgeCookie(event.judge_token);
  const [a, b, c, d] = event.teams.map((t) => t.id) as [number, number, number, number];
  return { admin, houseIds, event, judge, teams: { a, b, c, d } };
}

export async function publicBoard(slug: string) {
  const r = await call<PublicScoreboard>(`/api/public/scoreboard?event=${slug}`);
  expect(r.status).toBe(200);
  return r.body;
}

export async function seasonBoard() {
  const r = await call<PublicScoreboard>('/api/public/scoreboard?scope=season');
  expect(r.status).toBe(200);
  return r.body;
}

export const totalOf = (sb: PublicScoreboard, teamId: number) => sb.standings.find((s) => s.team_id === teamId)?.total;

export async function rowCount(sql = 'SELECT COUNT(*) AS n FROM score_events'): Promise<number> {
  const { env } = await import('cloudflare:workers');
  return ((await env.DB.prepare(sql).first<{ n: number }>())?.n ?? 0) as number;
}
