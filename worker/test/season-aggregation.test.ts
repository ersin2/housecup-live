import { describe, expect, it } from 'vitest';
import { call, createEvent, judgeCookie, publicBoard, save, seasonBoard, sportsDay, totalOf } from './helpers.ts';

describe('custom per-event teams vs Season Cup aggregation', () => {
  it('rolls house-mode teams and house-linked custom teams into the Season Cup', async () => {
    const { admin, houseIds, judge, teams } = await sportsDay();
    const [phoenix, titans, orion, zephyr] = houseIds as [number, number, number, number];

    // Esports event: two squads belong to Phoenix, one to Titans, one visiting team linked to nobody.
    const esports = await createEvent(admin, {
      name: 'Valorant Cup',
      category: 'esports',
      theme_mode: 'arena',
      teams: {
        mode: 'custom',
        teams: [
          { name: 'Phoenix Valorant A', color_hex: '#E63946', house_id: phoenix },
          { name: 'Phoenix Valorant B', color_hex: '#F97316', house_id: phoenix },
          { name: 'Titans Valorant', color_hex: '#1D4ED8', house_id: titans },
          { name: 'Riverside High', color_hex: '#14B8A6' },
        ],
      },
    });
    const [pa, pb, tv, visitor] = esports.teams.map((t) => t.id) as [number, number, number, number];
    const ej = await judgeCookie(esports.judge_token);

    await save(judge, [[teams.a, 10], [teams.b, 7], [teams.c, 5], [teams.d, 3]], '100m');
    await save(ej, [[pa, 3], [pb, 2], [tv, 1], [visitor, 50]], 'Group stage');
    const reverted = await save(judge, [[teams.d, 100]], 'mistake');
    await call(`/api/judge/batches/${reverted.body.batch.batch_id}/revert`, { method: 'POST', cookie: judge });

    // Not counted toward the season at all.
    const friendly = await createEvent(admin, {
      name: 'Staff Friendly',
      counts_toward_season: false,
      teams: { mode: 'houses' },
    });
    const fj = await judgeCookie(friendly.judge_token);
    await save(fj, [[friendly.teams[2]!.id, 500]]);

    const season = await seasonBoard();
    expect(season.scope).toBe('season');
    expect(season.standings.map((s) => s.team_id)).toEqual([phoenix, titans, orion, zephyr]);
    expect(totalOf(season, phoenix)).toBe(15); // 10 + 3 + 2
    expect(totalOf(season, titans)).toBe(8); // 7 + 1
    expect(totalOf(season, orion)).toBe(5); // friendly excluded
    expect(totalOf(season, zephyr)).toBe(3); // reverted 100 excluded
    expect(season.standings[1]!.gap_to_leader).toBe(7);

    // Season feed maps awards to houses and merges same-house squads in one batch.
    const group = season.feed.find((f) => f.label === 'Group stage')!;
    expect(group.event_name).toBe('Valorant Cup');
    expect(group.awards).toEqual([
      { team_id: phoenix, points: 5 },
      { team_id: titans, points: 1 },
    ]);

    // The event board itself shows the custom teams, visitor included.
    const eb = await publicBoard(esports.slug);
    expect(eb.standings[0]).toMatchObject({ team_id: visitor, total: 50, rank: 1 });
  });

  it('live renames/recolors keep score history and propagate from houses', async () => {
    const { admin, houseIds, event, judge, teams } = await sportsDay();
    await save(judge, [[teams.a, 10]]);
    const rename = await call(`/api/admin/teams/${teams.a}`, {
      method: 'PATCH',
      json: { name: 'Phoenix Rising', color_hex: '#ff0000' },
      cookie: admin,
    });
    expect(rename.status).toBe(200);
    let sb = await publicBoard(event.slug);
    expect(sb.standings[0]).toMatchObject({ team_id: teams.a, name: 'Phoenix Rising', color_hex: '#FF0000', total: 10 });

    // Renaming a house syncs linked teams in active events (and the season board).
    await call(`/api/admin/houses/${houseIds[1]}`, { method: 'PATCH', json: { name: 'Titans United' }, cookie: admin });
    sb = await publicBoard(event.slug);
    expect(sb.standings.find((s) => s.team_id === teams.b)!.name).toBe('Titans United');
    expect((await seasonBoard()).standings.find((s) => s.team_id === houseIds[1])!.name).toBe('Titans United');
  });

  it('late-entry teams join mid-event and the 12-team cap is enforced', async () => {
    const { admin, event } = await sportsDay();
    const late = await call(`/api/admin/events/${event.id}/teams`, {
      json: { name: 'Visiting Lions', color_hex: '#84CC16' },
      cookie: admin,
    });
    expect(late.status).toBe(201);
    const added = late.body.event.teams.find((t: any) => t.name === 'Visiting Lions');
    expect(added).toMatchObject({ short_name: 'VL', house_id: null, total: 0 });
    for (let i = 0; i < 7; i++) {
      expect((await call(`/api/admin/events/${event.id}/teams`, { json: { name: `Team ${i}`, color_hex: '#6B7280' }, cookie: admin })).status).toBe(201);
    }
    const over = await call(`/api/admin/events/${event.id}/teams`, { json: { name: 'One Too Many', color_hex: '#6B7280' }, cookie: admin });
    expect(over.status).toBe(422);
  });

  it('teams with score history cannot be deleted; empty ones can', async () => {
    const { admin, judge, teams } = await sportsDay();
    await save(judge, [[teams.a, 1]]);
    expect((await call(`/api/admin/teams/${teams.a}`, { method: 'DELETE', cookie: admin })).status).toBe(409);
    expect((await call(`/api/admin/teams/${teams.d}`, { method: 'DELETE', cookie: admin })).status).toBe(200);
  });

  it('custom events validate team counts, unique names and auto-derive short codes', async () => {
    const { admin } = await sportsDay();
    const one = await call('/api/admin/events', {
      json: { name: 'Solo', teams: { mode: 'custom', teams: [{ name: 'Only', color_hex: '#111827' }] } },
      cookie: admin,
    });
    expect(one.status).toBe(400);
    const dup = await call('/api/admin/events', {
      json: { name: 'Dup', teams: { mode: 'custom', teams: [{ name: 'Owls', color_hex: '#111827' }, { name: 'owls', color_hex: '#7C3AED' }] } },
      cookie: admin,
    });
    expect(dup.status).toBe(400);
    const ev = await createEvent(admin, {
      name: 'Grade Clash',
      teams: { mode: 'custom', teams: [{ name: 'Grade 9', color_hex: '#111827' }, { name: 'Grade 10', color_hex: '#7C3AED' }, { name: 'Nightfall', color_hex: '#0EA5E9' }] },
    });
    expect(ev.teams.map((t) => t.short_name)).toEqual(['G9', 'G10', 'NGH']);
    // Slugs stay unique.
    const again = await createEvent(admin, { name: 'Grade Clash', teams: { mode: 'houses' } });
    expect(again.slug).toBe('grade-clash-2');
  });
});
