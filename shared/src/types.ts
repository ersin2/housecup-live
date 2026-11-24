// Shared DTOs between the Worker API and the web app.
// Timestamps are unix epoch milliseconds.

export type Category = 'sports' | 'esports' | 'chess' | 'academic' | 'general';
export type ThemeMode = 'daylight' | 'arena';
export type EventStatus = 'active' | 'archived';

export interface HouseDTO {
  id: number;
  name: string;
  short_name: string;
  color_hex: string;
  icon_key: string | null;
  sort_order: number;
}

export interface TeamDTO {
  id: number;
  event_id: number;
  house_id: number | null;
  name: string;
  short_name: string;
  color_hex: string;
  sort_order: number;
}

export interface TeamWithTotalDTO extends TeamDTO {
  total: number;
}

export interface StandingDTO {
  /** event_team_id for event scope, house id for season scope */
  team_id: number;
  house_id: number | null;
  name: string;
  short_name: string;
  color_hex: string;
  total: number;
  /** Competition ranking: ties share a rank (1, 1, 3). */
  rank: number;
  gap_to_leader: number;
  /** 0–100, relative to the leader's total. */
  bar_pct: number;
}

export interface AwardDTO {
  team_id: number;
  points: number;
}

export interface FeedItemDTO {
  batch_id: string;
  label: string | null;
  created_at: number;
  awards: AwardDTO[];
  /** Season scope only: which event the batch came from. */
  event_name?: string;
}

export interface PublicEventDTO {
  slug: string;
  name: string;
  category: Category;
  theme_mode: ThemeMode;
  announcement_text: string | null;
  is_frozen: boolean;
  frozen_at: number | null;
  status: EventStatus;
}

export interface DisplayDTO {
  title: string;
  theme_mode: ThemeMode;
  announcement_text: string | null;
  /** Event scope: the event is frozen. Season scope: at least one counted event is frozen. */
  is_frozen: boolean;
}

export interface PublicScoreboard {
  v: 1;
  scope: 'event' | 'season';
  generated_at: number;
  /** Content hash (excludes generated_at). Used for ETag and client de-duplication. */
  etag: string;
  display: DisplayDTO;
  event: PublicEventDTO | null;
  standings: StandingDTO[];
  feed: FeedItemDTO[];
}

export interface PublicEventListItem {
  slug: string;
  name: string;
  category: Category;
  theme_mode: ThemeMode;
  is_frozen: boolean;
  is_featured: boolean;
}

export interface PublicEventsResponse {
  featured_slug: string | null;
  season_available: boolean;
  events: PublicEventListItem[];
}

export type LiveMessage = { t: 'snapshot'; data: PublicScoreboard } | { t: 'hb'; ts: number };

export interface BatchAwardDTO {
  event_team_id: number;
  points: number;
}

export interface BatchDTO {
  batch_id: string;
  event_id: number;
  label: string | null;
  judge_name: string | null;
  created_at: number;
  is_reverted: boolean;
  reverted_at: number | null;
  awards: BatchAwardDTO[];
}

export interface JudgeEventDTO {
  id: number;
  slug: string;
  name: string;
  category: Category;
  is_frozen: boolean;
  frozen_at: number | null;
}

export interface JudgeState {
  event: JudgeEventDTO;
  judge_name: string | null;
  teams: TeamWithTotalDTO[];
  recent_labels: string[];
}

export interface SaveBatchResponse {
  batch: BatchDTO;
  replayed: boolean;
  totals: Record<number, number>;
}

export interface ChangeResponse {
  batch: BatchDTO;
  changed: boolean;
  totals: Record<number, number>;
}

export interface AdminEventDTO {
  id: number;
  name: string;
  slug: string;
  category: Category;
  status: EventStatus;
  is_featured: boolean;
  counts_toward_season: boolean;
  theme_mode: ThemeMode;
  is_frozen: boolean;
  frozen_at: number | null;
  announcement_text: string | null;
  judge_token: string;
  judge_pin: string;
  created_at: number;
  teams: TeamWithTotalDTO[];
}

export interface LedgerPage {
  batches: BatchDTO[];
  next_cursor: string | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
