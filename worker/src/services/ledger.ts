// Append-only score ledger: insert batches atomically and idempotently; revert/restore whole batches.
import type { BatchDTO, LedgerPage } from '@housecup/shared/types';
import type { CreateBatchInput } from '@housecup/shared/schemas';
import { ApiError, notFound } from '../lib/http.ts';
import type { EventRow } from './rows.ts';

interface BatchRowAgg {
  batch_id: string;
  event_id: number;
  created_at: number;
  label: string | null;
  judge_name: string | null;
  is_reverted: number;
  reverted_at: number | null;
  awards: string;
}

const BATCH_SELECT = `
SELECT batch_id, MAX(event_id) AS event_id, MIN(created_at) AS created_at, MAX(label) AS label,
       MAX(judge_name) AS judge_name, MAX(is_reverted) AS is_reverted, MAX(reverted_at) AS reverted_at,
       json_group_array(json_object('event_team_id', event_team_id, 'points', points)) AS awards
FROM score_events`;

function toBatch(r: BatchRowAgg): BatchDTO {
  const awards = (JSON.parse(r.awards) as BatchDTO['awards']).sort((a, b) => a.event_team_id - b.event_team_id);
  return {
    batch_id: r.batch_id,
    event_id: r.event_id,
    label: r.label,
    judge_name: r.judge_name,
    created_at: r.created_at,
    is_reverted: r.is_reverted === 1,
    reverted_at: r.reverted_at,
    awards,
  };
}

export async function getBatch(db: D1Database, batchId: string): Promise<BatchDTO | null> {
  const row = await db
    .prepare(`${BATCH_SELECT} WHERE batch_id = ? GROUP BY batch_id`)
    .bind(batchId)
    .first<BatchRowAgg>();
  return row ? toBatch(row) : null;
}

function samePayload(existing: BatchDTO, eventId: number, input: CreateBatchInput): boolean {
  if (existing.event_id !== eventId) return false;
  if ((existing.label ?? null) !== (input.label ?? null)) return false;
  const a = [...input.awards].sort((x, y) => x.event_team_id - y.event_team_id);
  if (a.length !== existing.awards.length) return false;
  return a.every((x, i) => x.event_team_id === existing.awards[i]!.event_team_id && x.points === existing.awards[i]!.points);
}

function replayOrConflict(existing: BatchDTO, eventId: number, input: CreateBatchInput) {
  if (!samePayload(existing, eventId, input)) {
    throw new ApiError(409, 'BATCH_MISMATCH', 'This batch_id was already used for a different submission');
  }
  return { batch: existing, replayed: true };
}

const isUniqueViolation = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(e.message);

/**
 * Insert all awards of one Save tap in a single D1 transaction (db.batch).
 * Retries with the same batch_id replay the stored result; concurrent duplicates lose the
 * UNIQUE(request_id) race, roll back entirely, and are then answered as replays.
 */
export async function insertBatch(
  db: D1Database,
  eventId: number,
  input: CreateBatchInput,
  judgeName: string | null,
  now = Date.now(),
): Promise<{ batch: BatchDTO; replayed: boolean }> {
  const existing = await getBatch(db, input.batch_id);
  if (existing) return replayOrConflict(existing, eventId, input);

  const teamIds = input.awards.map((a) => a.event_team_id);
  const placeholders = teamIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT id FROM event_teams WHERE event_id = ? AND id IN (${placeholders})`)
    .bind(eventId, ...teamIds)
    .all<{ id: number }>();
  if (results.length !== teamIds.length) {
    const known = new Set(results.map((r) => r.id));
    throw new ApiError(422, 'UNKNOWN_TEAM', 'One or more teams do not belong to this event', {
      team_ids: teamIds.filter((id) => !known.has(id)),
    });
  }

  const stmt = db.prepare(
    `INSERT INTO score_events (event_id, event_team_id, points, label, judge_name, batch_id, request_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  try {
    await db.batch(
      input.awards.map((a) =>
        stmt.bind(eventId, a.event_team_id, a.points, input.label, judgeName, input.batch_id, `${input.batch_id}:${a.event_team_id}`, now),
      ),
    );
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const winner = await getBatch(db, input.batch_id);
    if (!winner) throw e;
    return replayOrConflict(winner, eventId, input);
  }

  const batch = await getBatch(db, input.batch_id);
  if (!batch) throw new ApiError(500, 'INTERNAL', 'Batch vanished after insert');
  return { batch, replayed: false };
}

async function loadBatchForChange(db: D1Database, event: EventRow, batchId: string): Promise<BatchDTO> {
  const batch = await getBatch(db, batchId);
  if (!batch || batch.event_id !== event.id) throw notFound('Batch');
  // Pre-freeze rows must not change while frozen, so the public cutoff stays a true point-in-time view.
  if (event.is_frozen === 1 && event.frozen_at !== null && batch.created_at <= event.frozen_at) {
    throw new ApiError(409, 'FROZEN_LOCKED', 'Unfreeze the event to change entries recorded before the freeze');
  }
  return batch;
}

export async function revertBatch(db: D1Database, event: EventRow, batchId: string, now = Date.now()) {
  await loadBatchForChange(db, event, batchId);
  const res = await db
    .prepare('UPDATE score_events SET is_reverted = 1, reverted_at = ? WHERE batch_id = ? AND event_id = ? AND is_reverted = 0')
    .bind(now, batchId, event.id)
    .run();
  return { batch: (await getBatch(db, batchId))!, changed: res.meta.changes > 0 };
}

export async function restoreBatch(db: D1Database, event: EventRow, batchId: string) {
  await loadBatchForChange(db, event, batchId);
  // reverted_at is kept as audit history ("last reverted at").
  const res = await db
    .prepare('UPDATE score_events SET is_reverted = 0 WHERE batch_id = ? AND event_id = ? AND is_reverted = 1')
    .bind(batchId, event.id)
    .run();
  return { batch: (await getBatch(db, batchId))!, changed: res.meta.changes > 0 };
}

export interface LedgerFilter {
  team?: number | undefined;
  label?: string | undefined;
  state?: 'active' | 'reverted' | undefined;
  cursor?: string | undefined;
  limit: number;
}

export async function listBatches(db: D1Database, eventId: number, f: LedgerFilter): Promise<LedgerPage> {
  let curTs: number | null = null;
  let curId: string | null = null;
  if (f.cursor) {
    const i = f.cursor.indexOf(':');
    curTs = Number(f.cursor.slice(0, i));
    curId = f.cursor.slice(i + 1);
  }
  const { results } = await db
    .prepare(
      `${BATCH_SELECT}
       WHERE event_id = ?1
         AND (?2 IS NULL OR batch_id IN (SELECT batch_id FROM score_events WHERE event_id = ?1 AND event_team_id = ?2))
         AND (?3 IS NULL OR label = ?3)
         AND (?4 IS NULL OR is_reverted = ?4)
         AND (?5 IS NULL OR created_at < ?5 OR (created_at = ?5 AND batch_id < ?6))
       GROUP BY batch_id
       ORDER BY created_at DESC, batch_id DESC
       LIMIT ?7`,
    )
    .bind(
      eventId,
      f.team ?? null,
      f.label ?? null,
      f.state === undefined ? null : f.state === 'reverted' ? 1 : 0,
      curTs,
      curId,
      f.limit,
    )
    .all<BatchRowAgg>();
  const batches = results.map(toBatch);
  const last = batches[batches.length - 1];
  return { batches, next_cursor: batches.length === f.limit && last ? `${last.created_at}:${last.batch_id}` : null };
}

export async function recentLabels(db: D1Database, eventId: number, limit = 8): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT label FROM score_events WHERE event_id = ? AND label IS NOT NULL AND is_reverted = 0
       GROUP BY label ORDER BY MAX(created_at) DESC LIMIT ?`,
    )
    .bind(eventId, limit)
    .all<{ label: string }>();
  return results.map((r) => r.label);
}
