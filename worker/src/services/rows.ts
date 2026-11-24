import type {
  Category,
  EventStatus,
  HouseDTO,
  PublicEventDTO,
  TeamDTO,
  TeamWithTotalDTO,
  ThemeMode,
} from '@housecup/shared/types';

export interface EventRow {
  id: number;
  name: string;
  slug: string;
  category: Category;
  status: EventStatus;
  is_featured: number;
  counts_toward_season: number;
  theme_mode: ThemeMode;
  is_frozen: number;
  frozen_at: number | null;
  announcement_text: string | null;
  judge_token: string;
  judge_pin: string;
  created_at: number;
}

export interface TeamRow {
  id: number;
  event_id: number;
  house_id: number | null;
  name: string;
  short_name: string;
  color_hex: string;
  sort_order: number;
}

export interface HouseRow {
  id: number;
  name: string;
  short_name: string;
  color_hex: string;
  icon_key: string | null;
  sort_order: number;
}

export const getEventById = (db: D1Database, id: number) =>
  db.prepare('SELECT * FROM events WHERE id = ?').bind(id).first<EventRow>();

export const getEventBySlug = (db: D1Database, slug: string) =>
  db.prepare('SELECT * FROM events WHERE slug = ?').bind(slug).first<EventRow>();

export const getActiveEventByToken = (db: D1Database, token: string) =>
  db.prepare("SELECT * FROM events WHERE judge_token = ? AND status = 'active'").bind(token).first<EventRow>();

export const getActiveEventByPin = (db: D1Database, pin: string) =>
  db.prepare("SELECT * FROM events WHERE judge_pin = ? AND status = 'active'").bind(pin).first<EventRow>();

export const getFeaturedEvent = (db: D1Database) =>
  db.prepare("SELECT * FROM events WHERE is_featured = 1 AND status = 'active'").first<EventRow>();

/**
 * THE freeze rule. Public reads see only rows created at or before this cutoff.
 * Judge and admin reads always pass `null` (live truth).
 */
export function publicCutoff(e: Pick<EventRow, 'is_frozen' | 'frozen_at'>): number | null {
  return e.is_frozen ? e.frozen_at : null;
}

export const toTeamDTO = (r: TeamRow): TeamDTO => ({
  id: r.id,
  event_id: r.event_id,
  house_id: r.house_id,
  name: r.name,
  short_name: r.short_name,
  color_hex: r.color_hex,
  sort_order: r.sort_order,
});

export const toHouseDTO = (r: HouseRow): HouseDTO => ({
  id: r.id,
  name: r.name,
  short_name: r.short_name,
  color_hex: r.color_hex,
  icon_key: r.icon_key,
  sort_order: r.sort_order,
});

export const toPublicEvent = (e: EventRow): PublicEventDTO => ({
  slug: e.slug,
  name: e.name,
  category: e.category,
  theme_mode: e.theme_mode,
  announcement_text: e.announcement_text,
  is_frozen: e.is_frozen === 1,
  frozen_at: e.frozen_at,
  status: e.status,
});

export const TOTALS_SQL = `
SELECT t.id, t.event_id, t.house_id, t.name, t.short_name, t.color_hex, t.sort_order,
       COALESCE(SUM(s.points), 0) AS total
FROM event_teams t
LEFT JOIN score_events s
       ON s.event_team_id = t.id AND s.is_reverted = 0
      AND (?2 IS NULL OR s.created_at <= ?2)
WHERE t.event_id = ?1
GROUP BY t.id
ORDER BY t.sort_order, t.id`;

export async function teamTotals(db: D1Database, eventId: number, cutoff: number | null): Promise<TeamWithTotalDTO[]> {
  const { results } = await db.prepare(TOTALS_SQL).bind(eventId, cutoff).all<TeamRow & { total: number }>();
  return results.map((r) => ({ ...toTeamDTO(r), total: r.total }));
}

export function totalsMap(teams: TeamWithTotalDTO[]): Record<number, number> {
  return Object.fromEntries(teams.map((t) => [t.id, t.total]));
}
