// The ONLY code path that produces public scoreboard data (HTTP polling, Cache API and
// WebSocket snapshots all come from here), so the freeze cutoff cannot be bypassed.
import type { AwardDTO, DisplayDTO, FeedItemDTO, PublicScoreboard } from '@housecup/shared/types';
import { rankStandings } from '@housecup/shared/ranking';
import { sha256Hex } from '../lib/crypto.ts';
import { getFeaturedEvent, publicCutoff, TOTALS_SQL, toPublicEvent, type EventRow, type TeamRow } from './rows.ts';

const FEED_LIMIT = 20;

const EVENT_FEED_SQL = `
SELECT batch_id, MIN(created_at) AS created_at, MAX(label) AS label,
       json_group_array(json_object('team_id', event_team_id, 'points', points)) AS awards
FROM score_events
WHERE event_id = ?1 AND is_reverted = 0 AND (?2 IS NULL OR created_at <= ?2)
GROUP BY batch_id
ORDER BY created_at DESC, batch_id DESC
LIMIT ${FEED_LIMIT}`;

export const SEASON_TOTALS_SQL = `
SELECT h.id, h.name, h.short_name, h.color_hex, h.sort_order, COALESCE(SUM(s.points), 0) AS total
FROM default_houses h
LEFT JOIN event_teams  t ON t.house_id = h.id
LEFT JOIN events       e ON e.id = t.event_id AND e.counts_toward_season = 1
LEFT JOIN score_events s ON s.event_team_id = t.id AND s.event_id = e.id AND s.is_reverted = 0
                        AND (?1 = 1 OR e.is_frozen = 0 OR s.created_at <= e.frozen_at)
GROUP BY h.id
ORDER BY h.sort_order, h.id`;

const SEASON_FEED_SQL = `
SELECT s.batch_id, MIN(s.created_at) AS created_at, MAX(s.label) AS label, MAX(e.name) AS event_name,
       json_group_array(json_object('team_id', t.house_id, 'points', s.points)) AS awards
FROM score_events s
JOIN event_teams t ON t.id = s.event_team_id
JOIN events      e ON e.id = s.event_id
WHERE e.counts_toward_season = 1 AND s.is_reverted = 0 AND t.house_id IS NOT NULL
  AND (e.is_frozen = 0 OR s.created_at <= e.frozen_at)
GROUP BY s.batch_id
ORDER BY created_at DESC, s.batch_id DESC
LIMIT ${FEED_LIMIT}`;

interface FeedRow {
  batch_id: string;
  created_at: number;
  label: string | null;
  awards: string;
  event_name?: string;
}

function parseFeed(rows: FeedRow[], withEvent: boolean): FeedItemDTO[] {
  return rows.map((r) => {
    // Merge duplicate recipients (two teams of the same house in one season batch).
    const merged = new Map<number, number>();
    for (const a of JSON.parse(r.awards) as AwardDTO[]) merged.set(a.team_id, (merged.get(a.team_id) ?? 0) + a.points);
    const awards = [...merged].map(([team_id, points]) => ({ team_id, points })).filter((a) => a.points !== 0);
    awards.sort((a, b) => b.points - a.points || a.team_id - b.team_id);
    const item: FeedItemDTO = { batch_id: r.batch_id, label: r.label, created_at: r.created_at, awards };
    if (withEvent && r.event_name) item.event_name = r.event_name;
    return item;
  });
}

async function finalize(sb: Omit<PublicScoreboard, 'etag' | 'generated_at'>, now: number): Promise<PublicScoreboard> {
  const etag = (await sha256Hex(JSON.stringify(sb))).slice(0, 20);
  return { ...sb, etag, generated_at: now };
}

export async function buildEventScoreboard(db: D1Database, event: EventRow, now = Date.now()): Promise<PublicScoreboard> {
  const cutoff = publicCutoff(event);
  const [teams, feed] = await db.batch<unknown>([
    db.prepare(TOTALS_SQL).bind(event.id, cutoff),
    db.prepare(EVENT_FEED_SQL).bind(event.id, cutoff),
  ]);
  const teamRows = (teams!.results as (TeamRow & { total: number })[]) ?? [];
  const display: DisplayDTO = {
    title: event.name,
    theme_mode: event.theme_mode,
    announcement_text: event.announcement_text,
    is_frozen: event.is_frozen === 1,
  };
  return finalize(
    {
      v: 1,
      scope: 'event',
      display,
      event: toPublicEvent(event),
      standings: rankStandings(
        teamRows.map((t) => ({
          team_id: t.id,
          house_id: t.house_id,
          name: t.name,
          short_name: t.short_name,
          color_hex: t.color_hex,
          total: t.total,
          sort_order: t.sort_order,
        })),
      ),
      feed: parseFeed((feed!.results as FeedRow[]) ?? [], false),
    },
    now,
  );
}

export async function buildSeasonScoreboard(db: D1Database, now = Date.now()): Promise<PublicScoreboard> {
  const [houses, feed, frozen] = await db.batch<unknown>([
    db.prepare(SEASON_TOTALS_SQL).bind(0),
    db.prepare(SEASON_FEED_SQL),
    db.prepare('SELECT COUNT(*) AS n FROM events WHERE counts_toward_season = 1 AND is_frozen = 1'),
  ]);
  const featured = await getFeaturedEvent(db);
  type HouseTotal = { id: number; name: string; short_name: string; color_hex: string; sort_order: number; total: number };
  const display: DisplayDTO = {
    title: 'Season Cup',
    theme_mode: featured?.theme_mode ?? 'daylight',
    announcement_text: featured?.announcement_text ?? null,
    is_frozen: ((frozen!.results as { n: number }[])[0]?.n ?? 0) > 0,
  };
  return finalize(
    {
      v: 1,
      scope: 'season',
      display,
      event: null,
      standings: rankStandings(
        ((houses!.results as HouseTotal[]) ?? []).map((h) => ({
          team_id: h.id,
          house_id: h.id,
          name: h.name,
          short_name: h.short_name,
          color_hex: h.color_hex,
          total: h.total,
          sort_order: h.sort_order,
        })),
      ),
      feed: parseFeed((feed!.results as FeedRow[]) ?? [], true),
    },
    now,
  );
}

/** Admin/CSV only: season totals ignoring freeze. */
export async function seasonTotalsLive(db: D1Database) {
  const { results } = await db
    .prepare(SEASON_TOTALS_SQL)
    .bind(1)
    .all<{ id: number; name: string; short_name: string; color_hex: string; sort_order: number; total: number }>();
  return results;
}
