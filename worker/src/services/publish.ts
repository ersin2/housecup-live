// After any write that can change public data: drop the Cache API entry and signal the
// ScoreHub Durable Object, which rebuilds the snapshot from D1 and fans it out to screens.
import type { Context } from 'hono';
import type { PublicScoreboard } from '@housecup/shared/types';
import type { AppEnv, Env } from '../env.ts';
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

async function purge(key: Request) {
  try {
    await caches.default.delete(key);
  } catch {
    // Cache API is best-effort (no-op on some hostnames); entries also expire after 3 s.
  }
}

const hub = (env: Env, name: string) => env.SCORE_HUB.get(env.SCORE_HUB.idFromName(name));

export async function publishEventRow(env: Env, origin: string, event: EventRow) {
  const name = eventHubName(event.id);
  await Promise.all([purge(eventCacheKey(origin, event.slug)), hub(env, name).refresh(name)]);
}

export async function publishSeason(env: Env, origin: string) {
  await Promise.all([purge(seasonCacheKey(origin)), hub(env, SEASON_HUB).refresh(SEASON_HUB)]);
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
