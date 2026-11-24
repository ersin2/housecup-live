// Unsent judge batches survive flaky 4G and page reloads. Each keeps its batch_id, so a
// retry is idempotent on the server: points can never be awarded twice.
import { store } from './util.ts';

export interface PendingBatch {
  batch_id: string;
  event_id: number;
  label: string | null;
  judge_name: string | null;
  awards: { event_team_id: number; points: number }[];
  queued_at: number;
  attempts: number;
  /** Set when the server rejected the batch for a reason a retry will not fix. */
  fatal?: string;
}

const KEY = 'hc.outbox.v1';

export function loadOutbox(): PendingBatch[] {
  const list = store.get<PendingBatch[]>(KEY, []);
  return Array.isArray(list) ? list : [];
}

export function saveOutbox(list: PendingBatch[]) {
  if (list.length) store.set(KEY, list);
  else store.remove(KEY);
}
