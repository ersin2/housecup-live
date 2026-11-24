import { describe, expect, it } from 'vitest';
import { adminCookie, call, createEvent, judgeCookie, publicBoard, save, sportsDay, totalOf } from './helpers.ts';

describe('atomic batch Undo / Restore', () => {
  it('reverts and restores every row of a batch together, idempotently', async () => {
    const { event, judge, teams } = await sportsDay();
    await save(judge, [[teams.a, 2]], 'Warm-up');
    const r = await save(
      judge,
      [
        [teams.a, 10],
        [teams.b, 7],
        [teams.c, 5],
      ],
      'Relay',
    );
    const id = r.body.batch.batch_id;

    const undo = await call(`/api/judge/batches/${id}/revert`, { method: 'POST', cookie: judge });
    expect(undo.status).toBe(200);
    expect(undo.body.changed).toBe(true);
    expect(undo.body.batch.is_reverted).toBe(true);
    expect(undo.body.totals).toMatchObject({ [teams.a]: 2, [teams.b]: 0, [teams.c]: 0 });

    let sb = await publicBoard(event.slug);
    expect(totalOf(sb, teams.a)).toBe(2);
    expect(sb.feed.map((f) => f.batch_id)).not.toContain(id);

    const undoAgain = await call(`/api/judge/batches/${id}/revert`, { method: 'POST', cookie: judge });
    expect(undoAgain.body.changed).toBe(false);

    const restore = await call(`/api/judge/batches/${id}/restore`, { method: 'POST', cookie: judge });
    expect(restore.body.changed).toBe(true);
    expect(restore.body.batch.is_reverted).toBe(false);
    expect(restore.body.batch.reverted_at).not.toBeNull(); // audit trail kept
    sb = await publicBoard(event.slug);
    expect(totalOf(sb, teams.a)).toBe(12);
    expect(totalOf(sb, teams.b)).toBe(7);
  });

  it('a judge cannot undo batches of another event', async () => {
    const { judge, teams } = await sportsDay();
    const r = await save(judge, [[teams.a, 10]]);
    const admin = await adminCookie();
    const other = await createEvent(admin, {
      name: 'Debate',
      teams: {
        mode: 'custom',
        teams: [
          { name: 'Affirmative', color_hex: '#10B981' },
          { name: 'Negative', color_hex: '#E63946' },
        ],
      },
    });
    const otherJudge = await judgeCookie(other.judge_token);
    const x = await call(`/api/judge/batches/${r.body.batch.batch_id}/revert`, { method: 'POST', cookie: otherJudge });
    expect(x.status).toBe(404);
  });

  it('admin ledger filters, paginates and can revert', async () => {
    const { admin, event, judge, teams } = await sportsDay();
    const b1 = (
      await save(
        judge,
        [
          [teams.a, 10],
          [teams.b, 5],
        ],
        'Long Jump',
      )
    ).body.batch.batch_id;
    await save(judge, [[teams.c, 3]], 'Shot Put');
    expect((await call(`/api/admin/batches/${b1}/revert`, { method: 'POST', cookie: admin })).status).toBe(200);

    const all = await call(`/api/admin/events/${event.id}/ledger`, { cookie: admin });
    expect(all.body.batches).toHaveLength(2);
    const reverted = await call(`/api/admin/events/${event.id}/ledger?state=reverted`, { cookie: admin });
    expect(reverted.body.batches.map((b: any) => b.batch_id)).toEqual([b1]);
    const byTeam = await call(`/api/admin/events/${event.id}/ledger?team=${teams.c}`, { cookie: admin });
    expect(byTeam.body.batches).toHaveLength(1);
    const byLabel = await call(`/api/admin/events/${event.id}/ledger?label=Long%20Jump`, { cookie: admin });
    expect(byLabel.body.batches[0].awards).toHaveLength(2);

    const page1 = await call(`/api/admin/events/${event.id}/ledger?limit=1`, { cookie: admin });
    expect(page1.body.next_cursor).toBeTruthy();
    const page2 = await call(`/api/admin/events/${event.id}/ledger?limit=1&cursor=${page1.body.next_cursor}`, {
      cookie: admin,
    });
    expect(page2.body.batches).toHaveLength(1);
    expect(page2.body.batches[0].batch_id).not.toBe(page1.body.batches[0].batch_id);
  });

  it('recent labels feed the judge pad chips (reverted labels excluded)', async () => {
    const { judge, teams } = await sportsDay();
    await save(judge, [[teams.a, 1]], '100m Sprint');
    const r = await save(judge, [[teams.a, 1]], 'Typo Label');
    await call(`/api/judge/batches/${r.body.batch.batch_id}/revert`, { method: 'POST', cookie: judge });
    await new Promise((res) => setTimeout(res, 5));
    await save(judge, [[teams.b, 1]], 'Long Jump');
    const state = await call('/api/judge/state', { cookie: judge });
    expect(state.body.recent_labels).toEqual(['Long Jump', '100m Sprint']);
  });
});
