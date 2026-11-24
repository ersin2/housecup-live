// After any write that can change public data: refresh the Cache API entry and push a
// snapshot to the ScoreHub Durable Object(s), which fan it out to connected screens.
import type { Context } from 'hono';
import type { LiveMessage, PublicScoreboard } from '@housecup/shared/types';
import type { AppEnv, Env } from '../env.ts';
import { buildEventScoreboard, buildSeasonScoreboard } from './scoreboard.ts';
import { getEventById, type EventRow } from './rows.ts';

export const SEASON_HUB = 'season';
export const eventHubName = (eventId: number) => `event:${eventId}`;

export const PUBLIC_CACHE_CONTROL = 'public, max-age=2, s-maxage=3, stale-while-revalidate=5';

export const eventCacheKey = (origin: string, slug: string) =>
  new Request(`${origin}/api/public/scoreboard?event=${encodeURIComponent(slug)}`);
export const seasonCacheKey = (origin: string) => new Request(`${origin}/api/public/scoreboard?scope=season`);

export function scoreboardResponse(sb: PublicScoreboard): Response {
  return new Response(JSON.stringify(sb), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': PUBLIC_CACHE_CONTROL,
      ETag: `"${sb.etag}"`,
    },
  });
}

async function cachePut(key: Request, sb: PublicScoreboard) {
  try {
    await caches.default.put(key, scoreboardResponse(sb));
  } catch {
    // Cache API is best-effort (no-op on some hostnames); D1 remains the source of truth.
  }
}

async function pushHub(env: Env, name: string, sb: PublicScoreboard) {
  const msg: LiveMessage = { t: 'snapshot', data: sb };
  await env.SCORE_HUB.get(env.SCORE_HUB.idFromName(name)).publish(JSON.stringify(msg));
}

export async function publishEventRow(env: Env, origin: string, event: EventRow) {
  const sb = await buildEventScoreboard(env.DB, event);
  await Promise.all([cachePut(eventCacheKey(origin, event.slug), sb), pushHub(env, eventHubName(event.id), sb)]);
}

export async function publishSeason(env: Env, origin: string) {
  const sb = await buildSeasonScoreboard(env.DB);
  await Promise.all([cachePut(seasonCacheKey(origin), sb), pushHub(env, SEASON_HUB, sb)]);
}

export async function publish(env: Env, origin: string, eventId: number | null, opts: { season?: boolean } = {}) {
  const event = eventId === null ? null : await getEventById(env.DB, eventId);
  const jobs: Promise<void>[] = [];
  if (event) jobs.push(publishEventRow(env, origin, event));
  if (opts.season ?? event?.counts_toward_season === 1) jobs.push(publishSeason(env, origin));
  await Promise.all(jobs);
}

/** Run publishing after the response (waitUntil); inline in tests for determinism. */
export async function schedulePublish(c: Context<AppEnv>, eventId: number | null, opts: { season?: boolean } = {}) {
  const origin = new URL(c.req.url).origin;
  const job = publish(c.env, origin, eventId, opts).catch((err) => console.error('publish failed', err));
  if (c.env.SYNC_PUBLISH === '1') await job;
  else c.executionCtx.waitUntil(job);
}
