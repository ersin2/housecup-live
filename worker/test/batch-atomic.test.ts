import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { insertBatch } from '../src/services/ledger.ts';
import { createEvent, publicBoard, rowCount, save, sportsDay, totalOf } from './helpers.ts';

describe('multi-team atomic batch saves', () => {
  it('commits every award of one Save under a single batch_id', async () => {
    const { event, judge, teams } = await sportsDay();
    const r = await save(judge, [[teams.a, 10], [teams.b, 7], [teams.c, 5]], '4x100m Relay');
    expect(r.status).toBe(201);
    expect(r.body.replayed).toBe(false);
    expect(r.body.batch.awards).toHaveLength(3);
    expect(r.body.totals).toMatchObject({ [teams.a]: 10, [teams.b]: 7, [teams.c]: 5, [teams.d]: 0 });

    const ids = await env.DB.prepare('SELECT DISTINCT batch_id FROM score_events').all();
    expect(ids.results).toHaveLength(1);

    const sb = await publicBoard(event.slug);
    expect(sb.standings[0]).toMatchObject({ team_id: teams.a, rank: 1, total: 10, bar_pct: 100 });
    expect(totalOf(sb, teams.b)).toBe(7);
    expect(sb.feed[0]).toMatchObject({ label: '4x100m Relay' });
    expect(sb.feed[0]!.awards).toHaveLength(3);
  });

  it('single-team save (chess / esports) works, including negative penalties', async () => {
    const { judge, teams } = await sportsDay();
    expect((await save(judge, [[teams.a, 3]], 'Chess Rd 3')).status).toBe(201);
    const pen = await save(judge, [[teams.a, -5]], 'Penalty');
    expect(pen.status).toBe(201);
    expect(pen.body.totals[teams.a]).toBe(-2);
  });

  it('rejects the whole batch when any team belongs to another event (nothing written)', async () => {
    const { admin, judge, teams } = await sportsDay();
    const other = await createEvent(admin, {
      name: 'Chess Open',
      teams: { mode: 'custom', teams: [{ name: 'Knights', color_hex: '#111827' }, { name: 'Rooks', color_hex: '#7C3AED' }] },
    });
    const r = await save(judge, [[teams.a, 10], [other.teams[0]!.id, 5]]);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('UNKNOWN_TEAM');
    expect(await rowCount()).toBe(0);
  });

  it('validates payloads (zero points, duplicate teams, bad uuid, out of range)', async () => {
    const { judge, teams } = await sportsDay();
    expect((await save(judge, [[teams.a, 0]])).status).toBe(400);
    expect((await save(judge, [[teams.a, 1], [teams.a, 2]])).status).toBe(400);
    expect((await save(judge, [[teams.a, 1]], null, 'not-a-uuid')).status).toBe(400);
    expect((await save(judge, [[teams.a, 10001]])).status).toBe(400);
    expect(await rowCount()).toBe(0);
  });

  it('a partially pre-existing batch is a conflict and adds no rows', async () => {
    const { event, teams } = await sportsDay();
    const batchId = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO score_events (event_id, event_team_id, points, batch_id, request_id, created_at) VALUES (?, ?, 1, ?, ?, ?)',
    )
      .bind(event.id, teams.b, batchId, `${batchId}:${teams.b}`, Date.now())
      .run();
    await expect(
      insertBatch(
        env.DB,
        event.id,
        {
          batch_id: batchId,
          label: null,
          judge_name: null,
          awards: [
            { event_team_id: teams.a, points: 10 },
            { event_team_id: teams.b, points: 7 },
          ],
        },
        null,
      ),
    ).rejects.toMatchObject({ code: 'BATCH_MISMATCH' });
    expect(await rowCount()).toBe(1);
  });

  it('a failing statement inside db.batch rolls back earlier statements', async () => {
    const { event, teams } = await sportsDay();
    const id = crypto.randomUUID();
    const stmt = env.DB.prepare(
      'INSERT INTO score_events (event_id, event_team_id, points, batch_id, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    await expect(
      env.DB.batch([
        stmt.bind(event.id, teams.a, 10, id, `${id}:${teams.a}`, Date.now()),
        stmt.bind(event.id, teams.b, 0, id, `${id}:${teams.b}`, Date.now()), // CHECK(points <> 0) fails
      ]),
    ).rejects.toThrow();
    expect(await rowCount()).toBe(0);
  });
});
