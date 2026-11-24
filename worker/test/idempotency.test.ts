import { describe, expect, it } from 'vitest';
import { adminCookie, createEvent, judgeCookie, publicBoard, rowCount, save, sportsDay, totalOf } from './helpers.ts';

describe('request_id idempotency', () => {
  it('a retried Save with the same batch_id replays instead of double-awarding', async () => {
    const { event, judge, teams } = await sportsDay();
    const id = crypto.randomUUID();
    const first = await save(judge, [[teams.a, 10], [teams.b, 5]], 'Relay', id);
    const again = await save(judge, [[teams.a, 10], [teams.b, 5]], 'Relay', id);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect(again.body.batch.batch_id).toBe(id);
    expect(await rowCount()).toBe(2);
    expect(totalOf(await publicBoard(event.slug), teams.a)).toBe(10);
  });

  it('triple-tap on weak 4G: concurrent duplicates commit exactly once', async () => {
    const { judge, teams } = await sportsDay();
    const id = crypto.randomUUID();
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map(() =>
        save(
          judge,
          [
            [teams.a, 3],
            [teams.c, 1],
          ],
          null,
          id,
        ),
      ),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.every((s) => s === 200 || s === 201)).toBe(true);
    expect(await rowCount()).toBe(2);
    for (const r of results) expect(r.body.totals[teams.a]).toBe(3);
  });

  it('upper/lower-case variants of the same UUID are the same request', async () => {
    const { judge, teams } = await sportsDay();
    const id = crypto.randomUUID();
    await save(judge, [[teams.a, 3]], null, id);
    const r = await save(judge, [[teams.a, 3]], null, id.toUpperCase());
    expect(r.body.replayed).toBe(true);
    expect(await rowCount()).toBe(1);
  });

  it('reusing a batch_id with a different payload is a 409, not a silent overwrite', async () => {
    const { judge, teams } = await sportsDay();
    const id = crypto.randomUUID();
    await save(judge, [[teams.a, 3]], null, id);
    const r = await save(judge, [[teams.a, 30]], null, id);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('BATCH_MISMATCH');
    expect(await rowCount()).toBe(1);
  });

  it('reusing a batch_id in another event is a 409', async () => {
    const { judge, teams } = await sportsDay();
    const admin = await adminCookie();
    const other = await createEvent(admin, {
      name: 'Quiz Bowl',
      teams: { mode: 'custom', teams: [{ name: 'Owls', color_hex: '#0EA5E9' }, { name: 'Foxes', color_hex: '#F97316' }] },
    });
    const otherJudge = await judgeCookie(other.judge_token);
    const id = crypto.randomUUID();
    await save(judge, [[teams.a, 3]], null, id);
    const r = await save(otherJudge, [[other.teams[0]!.id, 3]], null, id);
    expect(r.status).toBe(409);
  });
});
