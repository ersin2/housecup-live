import { Hono } from 'hono';
import { ScoreboardQuery } from '@housecup/shared/schemas';
import type { PublicEventsResponse, PublicScoreboard } from '@housecup/shared/types';
import type { AppEnv } from '../env.ts';
import { notFound, zv } from '../lib/http.ts';
import { getEventBySlug, getFeaturedEvent, type EventRow } from '../services/rows.ts';
import { buildEventScoreboard, buildSeasonScoreboard } from '../services/scoreboard.ts';
import {
  eventCacheKey,
  eventHubName,
  scoreboardResponse,
  SEASON_HUB,
  seasonCacheKey,
} from '../services/publish.ts';

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.get('/events', async (c) => {
  const db = c.env.DB;
  const [events, houses] = await db.batch<unknown>([
    db.prepare(
      `SELECT slug, name, category, theme_mode, is_frozen, is_featured FROM events
       WHERE status = 'active' ORDER BY is_featured DESC, created_at DESC`,
    ),
    db.prepare('SELECT COUNT(*) AS n FROM default_houses'),
  ]);
  type Row = Pick<EventRow, 'slug' | 'name' | 'category' | 'theme_mode' | 'is_frozen' | 'is_featured'>;
  const rows = (events!.results as Row[]) ?? [];
  const body: PublicEventsResponse = {
    featured_slug: rows.find((r) => r.is_featured === 1)?.slug ?? null,
    season_available: ((houses!.results as { n: number }[])[0]?.n ?? 0) > 0,
    events: rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      category: r.category,
      theme_mode: r.theme_mode,
      is_frozen: r.is_frozen === 1,
      is_featured: r.is_featured === 1,
    })),
  };
  c.header('Cache-Control', 'public, max-age=10, s-maxage=30');
  return c.json(body);
});

/** Resolve ?event / ?scope=season / (default → featured event, else season). */
async function resolveScope(db: D1Database, q: { event?: string | undefined; scope?: 'season' | undefined }) {
  if (q.event) return { kind: 'event' as const, slug: q.event };
  if (q.scope === 'season') return { kind: 'season' as const };
  const featured = await getFeaturedEvent(db);
  return featured ? { kind: 'event' as const, slug: featured.slug, event: featured } : { kind: 'season' as const };
}

publicRoutes.get('/scoreboard', zv('query', ScoreboardQuery), async (c) => {
  const db = c.env.DB;
  const origin = new URL(c.req.url).origin;
  const scope = await resolveScope(db, c.req.valid('query'));
  const key = scope.kind === 'event' ? eventCacheKey(origin, scope.slug) : seasonCacheKey(origin);

  let cached: Response | undefined;
  try {
    cached = await caches.default.match(key);
  } catch {
    cached = undefined;
  }

  let res: Response;
  if (cached) {
    res = new Response(cached.body, cached); // mutable copy
  } else {
    let sb: PublicScoreboard;
    if (scope.kind === 'event') {
      const event = ('event' in scope && scope.event) || (await getEventBySlug(db, scope.slug));
      if (!event) throw notFound('Event');
      sb = await buildEventScoreboard(db, event);
    } else {
      sb = await buildSeasonScoreboard(db);
    }
    res = scoreboardResponse(sb);
    try {
      await caches.default.put(key, res.clone());
    } catch {
      // best-effort
    }
  }

  const etag = res.headers.get('ETag');
  const inm = c.req.header('If-None-Match');
  if (etag && inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': res.headers.get('Cache-Control') ?? '' } });
  }
  return res;
});

publicRoutes.get('/live', zv('query', ScoreboardQuery), async (c) => {
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    return c.json({ error: { code: 'UPGRADE_REQUIRED', message: 'Connect with a WebSocket' } }, 426);
  }
  const db = c.env.DB;
  const scope = await resolveScope(db, c.req.valid('query'));
  let hubName = SEASON_HUB;
  if (scope.kind === 'event') {
    const event = ('event' in scope && scope.event) || (await getEventBySlug(db, scope.slug));
    if (!event) throw notFound('Event'); // never create hubs for arbitrary names
    hubName = eventHubName(event.id);
  }
  const stub = c.env.SCORE_HUB.get(c.env.SCORE_HUB.idFromName(hubName));
  return stub.fetch(`https://hub/connect?scope=${encodeURIComponent(hubName)}`, { headers: { Upgrade: 'websocket' } });
});
