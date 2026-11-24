import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { SEASON_HUB } from '../src/services/publish.ts';
import { call, save, seasonBoard, sportsDay } from './helpers.ts';
// The same SQL that DEPLOY.md runs against the remote database before event day.
import wipeSql from '../scripts/wipe-demo-events.sql?raw';

async function runSqlFile(sql: string) {
  const statements = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of statements) await env.DB.prepare(s).run();
}

describe('pre-event demo wipe', () => {
  it('removes events, teams and scores but keeps school houses; republish clears stale screens', async () => {
    const { admin, judge, teams, houseIds } = await sportsDay();
    await save(judge, [[teams.a, 25]], 'Demo heat');
    expect((await seasonBoard()).standings[0]!.total).toBe(25);

    const sql = wipeSql;
    expect(sql).toContain('DELETE FROM score_events');
    await runSqlFile(sql);

    const count = async (t: string) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{ n: number }>())!.n;
    expect(await count('score_events')).toBe(0);
    expect(await count('event_teams')).toBe(0);
    expect(await count('events')).toBe(0);
    expect(await count('default_houses')).toBe(houseIds.length);

    // The Season Cup hub still holds the demo snapshot until republished.
    const hub = env.SCORE_HUB.get(env.SCORE_HUB.idFromName(SEASON_HUB));
    const stale = await runInDurableObject(hub, (_i, s) => s.storage.kv.get<string>('snapshot'));
    expect(stale).toContain('"total":25');

    const r = await call('/api/admin/republish', { method: 'POST', cookie: admin });
    expect(r.status).toBe(200);
    const fresh = await runInDurableObject(hub, (_i, s) => s.storage.kv.get<string>('snapshot'));
    expect(fresh).not.toContain('"total":25');
    expect(fresh).not.toContain('Demo heat');
    expect((await seasonBoard()).standings.every((s) => s.total === 0)).toBe(true);
  });

  it('simultaneous saves never leave live screens on an older snapshot', async () => {
    const { event, judge, teams } = await sportsDay();
    const ids = [teams.a, teams.b, teams.c, teams.d];
    await Promise.all(Array.from({ length: 8 }, (_, i) => save(judge, [[ids[i % 4]!, i + 1]], `Heat ${i + 1}`)));
    const hubSnap = await runInDurableObject(
      env.SCORE_HUB.get(env.SCORE_HUB.idFromName(`event:${event.id}`)),
      (_i, s) => JSON.parse(s.storage.kv.get<string>('snapshot')!) as { data: { standings: { team_id: number; total: number }[] } },
    );
    const truth = await env.DB.prepare('SELECT event_team_id AS id, SUM(points) AS total FROM score_events GROUP BY event_team_id').all<{ id: number; total: number }>();
    for (const t of truth.results) {
      expect(hubSnap.data.standings.find((s) => s.team_id === t.id)!.total).toBe(t.total);
    }
    expect(truth.results.reduce((n, t) => n + t.total, 0)).toBe(36); // 1+2+…+8
  });

  it('republish requires admin', async () => {
    expect((await call('/api/admin/republish', { method: 'POST' })).status).toBe(401);
  });
});

