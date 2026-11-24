// UTF-8 CSV exports (with BOM for Excel), CRLF line endings, formula-injection safe.
import { rankStandings } from '@housecup/shared/ranking';
import { seasonTotalsLive } from './scoreboard.ts';
import { teamTotals, type EventRow } from './rows.ts';

const BOM = '﻿';
type Cell = string | number | null | undefined;

/** Text cells only: neutralise spreadsheet formulas. Numbers are written as-is (negative points stay numeric). */
export function textCell(v: string | null | undefined): string {
  if (v == null) return '';
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

function quote(v: Cell): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(sections: { title: string; header: string[]; rows: Cell[][] }[]): string {
  const lines: string[] = [];
  sections.forEach((s, i) => {
    if (i > 0) lines.push('');
    lines.push(quote(`# ${s.title}`));
    lines.push(s.header.map(quote).join(','));
    for (const r of s.rows) lines.push(r.map(quote).join(','));
  });
  return BOM + lines.join('\r\n') + '\r\n';
}

function makeLocal(tz: string) {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'medium', hour12: false });
  }
  return (ms: number | null) => (ms == null ? '' : fmt.format(new Date(ms)).replace(',', ''));
}

const iso = (ms: number | null) => (ms == null ? '' : new Date(ms).toISOString());

interface LedgerRow {
  created_at: number;
  batch_id: string;
  event_name: string;
  team: string;
  points: number;
  label: string | null;
  judge_name: string | null;
  is_reverted: number;
  reverted_at: number | null;
}

const LEDGER_HEADER = [
  'created_at_utc',
  'created_at_local',
  'event',
  'batch_id',
  'team',
  'points',
  'label',
  'judge',
  'state',
  'reverted_at_utc',
];

function ledgerRows(rows: LedgerRow[], local: (ms: number | null) => string): Cell[][] {
  return rows.map((r) => [
    iso(r.created_at),
    local(r.created_at),
    textCell(r.event_name),
    r.batch_id,
    textCell(r.team),
    r.points,
    textCell(r.label),
    textCell(r.judge_name),
    r.is_reverted ? 'reverted' : 'active',
    r.is_reverted ? iso(r.reverted_at) : '',
  ]);
}

const LEDGER_SQL = `
SELECT s.created_at, s.batch_id, e.name AS event_name, t.name AS team, s.points, s.label, s.judge_name,
       s.is_reverted, s.reverted_at
FROM score_events s
JOIN event_teams t ON t.id = s.event_team_id
JOIN events e ON e.id = s.event_id`;

export async function eventCsv(db: D1Database, event: EventRow, tz: string): Promise<string> {
  const local = makeLocal(tz);
  const teams = await teamTotals(db, event.id, null);
  const standings = rankStandings(
    teams.map((t) => ({ team_id: t.id, house_id: t.house_id, name: t.name, short_name: t.short_name, color_hex: t.color_hex, total: t.total, sort_order: t.sort_order })),
  );
  const { results } = await db
    .prepare(`${LEDGER_SQL} WHERE s.event_id = ? ORDER BY s.created_at, s.id`)
    .bind(event.id)
    .all<LedgerRow>();
  return toCsv([
    {
      title: `Standings — ${event.name} (live totals, reverted entries excluded)`,
      header: ['rank', 'team', 'short', 'total', 'gap_to_leader'],
      rows: standings.map((s) => [s.rank, textCell(s.name), textCell(s.short_name), s.total, s.gap_to_leader]),
    },
    { title: 'Ledger (chronological)', header: LEDGER_HEADER, rows: ledgerRows(results, local) },
  ]);
}

export async function seasonCsv(db: D1Database, tz: string): Promise<string> {
  const local = makeLocal(tz);
  const houses = await seasonTotalsLive(db);
  const standings = rankStandings(
    houses.map((h) => ({ team_id: h.id, house_id: h.id, name: h.name, short_name: h.short_name, color_hex: h.color_hex, total: h.total, sort_order: h.sort_order })),
  );
  const { results: breakdown } = await db
    .prepare(
      `SELECT e.name AS event_name, h.name AS house, COALESCE(SUM(s.points), 0) AS points
       FROM events e
       JOIN event_teams t ON t.event_id = e.id AND t.house_id IS NOT NULL
       JOIN default_houses h ON h.id = t.house_id
       LEFT JOIN score_events s ON s.event_team_id = t.id AND s.is_reverted = 0
       WHERE e.counts_toward_season = 1
       GROUP BY e.id, h.id
       ORDER BY e.created_at, h.sort_order`,
    )
    .all<{ event_name: string; house: string; points: number }>();
  const { results } = await db
    .prepare(`${LEDGER_SQL} WHERE e.counts_toward_season = 1 AND t.house_id IS NOT NULL ORDER BY s.created_at, s.id`)
    .all<LedgerRow>();
  return toCsv([
    {
      title: 'Season Cup standings (live totals, reverted entries excluded)',
      header: ['rank', 'house', 'short', 'total', 'gap_to_leader'],
      rows: standings.map((s) => [s.rank, textCell(s.name), textCell(s.short_name), s.total, s.gap_to_leader]),
    },
    {
      title: 'Breakdown by event',
      header: ['event', 'house', 'points'],
      rows: breakdown.map((b) => [textCell(b.event_name), textCell(b.house), b.points]),
    },
    { title: 'Ledger (chronological, house-linked teams only)', header: LEDGER_HEADER, rows: ledgerRows(results, local) },
  ]);
}

export function csvFilename(base: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return `${base.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}-${day}.csv`;
}
