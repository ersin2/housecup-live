// Fixed-window attempt counters for PIN and passcode logins (SQLite-backed Durable Object).
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env.ts';

export interface Rule {
  key: string;
  limit: number;
  windowMs: number;
}

export interface GuardResult {
  ok: boolean;
  retry_after_ms: number;
}

export class Guard extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS hits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL)',
    );
  }

  private current(rule: Rule, now: number): { count: number; window_start: number } {
    const row = this.ctx.storage.sql
      .exec<{ count: number; window_start: number }>('SELECT count, window_start FROM hits WHERE key = ?', rule.key)
      .toArray()[0];
    if (!row || now - row.window_start >= rule.windowMs) return { count: 0, window_start: now };
    return row;
  }

  /** Blocked if any rule is at its limit; otherwise counts one hit against each rule in `record`. */
  async attempt(check: Rule[], record: Rule[] = check): Promise<GuardResult> {
    const now = Date.now();
    for (const rule of check) {
      const cur = this.current(rule, now);
      if (cur.count >= rule.limit) {
        return { ok: false, retry_after_ms: Math.max(1000, cur.window_start + rule.windowMs - now) };
      }
    }
    this.hit(record, now);
    return { ok: true, retry_after_ms: 0 };
  }

  /** Count a hit without checking (e.g. global failure counters). */
  async record(rules: Rule[]): Promise<void> {
    this.hit(rules, Date.now());
  }

  private hit(rules: Rule[], now: number) {
    for (const rule of rules) {
      const cur = this.current(rule, now);
      this.ctx.storage.sql.exec(
        'INSERT INTO hits (key, count, window_start) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET count = excluded.count, window_start = excluded.window_start',
        rule.key,
        cur.count + 1,
        cur.window_start,
      );
    }
    // Opportunistic cleanup of stale windows (all our windows are ≤ 1 hour).
    this.ctx.storage.sql.exec('DELETE FROM hits WHERE window_start < ?', now - 2 * 60 * 60 * 1000);
  }
}

export const guardStub = (env: Env) => env.GUARD.get(env.GUARD.idFromName('guard-v1'));
