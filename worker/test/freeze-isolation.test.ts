import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { LiveMessage } from '@housecup/shared/types';
import { eventHubName } from '../src/services/publish.ts';
import { call, publicBoard, save, seasonBoard, sportsDay, totalOf } from './helpers.ts';

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

async function freeze(admin: string, id: number, frozen: boolean) {
  const r = await call(`/api/admin/events/${id}/freeze`, { json: { frozen }, cookie: admin });
  expect(r.status).toBe(200);
  return r.body.event;
}

async function connect(slug: string) {
  const r = await call(`/api/public/live?event=${slug}`, { headers: { Upgrade: 'websocket' } });
  expect(r.status).toBe(101);
  const ws = r.res.webSocket!;
  const messages: LiveMessage[] = [];
  ws.accept();
  ws.addEventListener('message', (e) => messages.push(JSON.parse(e.data as string)));
  await tick();
  return { ws, messages };
}

describe('API-level Freeze / Mystery Mode', () => {
  it('public JSON never contains post-freeze points, labels or batch ids', async () => {
    const { admin, event, judge, teams } = await sportsDay();
    await save(judge, [[teams.a, 10], [teams.b, 5]], 'Heats');
    await tick(5);
    const frozenEvent = await freeze(admin, event.id, true);
    expect(frozenEvent.is_frozen).toBe(true);
    await tick(5);

    const secret = await save(judge, [[teams.b, 50]], 'SECRET-FINAL');
    expect(secret.status).toBe(201); // judges keep scoring normally
    const secretId = secret.body.batch.batch_id;

    const raw = await call(`/api/public/scoreboard?event=${event.slug}`);
    expect(raw.text).not.toContain('SECRET-FINAL');
    expect(raw.text).not.toContain(secretId);
    const sb = raw.body;
    expect(sb.display.is_frozen).toBe(true);
    expect(sb.event.frozen_at).toBe(frozenEvent.frozen_at);
    expect(totalOf(sb, teams.a)).toBe(10);
    expect(totalOf(sb, teams.b)).toBe(5);
    expect(sb.standings[0].team_id).toBe(teams.a);

    // Judges/admin see the live truth.
    const state = await call('/api/judge/state', { cookie: judge });
    expect(state.body.teams.find((t: any) => t.id === teams.b).total).toBe(55);
    expect(state.body.event.is_frozen).toBe(true);
  });

  it('the Season Cup also stops at the freeze point', async () => {
    const { admin, event, judge, teams, houseIds } = await sportsDay();
    await save(judge, [[teams.a, 10]]);
    await tick(5);
    await freeze(admin, event.id, true);
    await tick(5);
    await save(judge, [[teams.b, 99]], 'hidden');
    const season = await seasonBoard();
    expect(season.display.is_frozen).toBe(true);
    expect(totalOf(season, houseIds[0]!)).toBe(10);
    expect(totalOf(season, houseIds[1]!)).toBe(0);
    expect(JSON.stringify(season)).not.toContain('hidden');
  });

  it('pre-freeze batches are locked while frozen; post-freeze batches can be undone', async () => {
    const { admin, event, judge, teams } = await sportsDay();
    const before = (await save(judge, [[teams.a, 10]])).body.batch.batch_id;
    await tick(5);
    await freeze(admin, event.id, true);
    await tick(5);
    const after = (await save(judge, [[teams.b, 3]])).body.batch.batch_id;

    const locked = await call(`/api/judge/batches/${before}/revert`, { method: 'POST', cookie: judge });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('FROZEN_LOCKED');
    const lockedAdmin = await call(`/api/admin/batches/${before}/revert`, { method: 'POST', cookie: admin });
    expect(lockedAdmin.status).toBe(409);

    const ok = await call(`/api/judge/batches/${after}/revert`, { method: 'POST', cookie: judge });
    expect(ok.status).toBe(200);
  });

  it('unfreezing reveals everything; re-freezing is idempotent', async () => {
    const { admin, event, judge, teams } = await sportsDay();
    await save(judge, [[teams.a, 10]]);
    await tick(5);
    const f1 = await freeze(admin, event.id, true);
    await tick(5);
    const f2 = await freeze(admin, event.id, true);
    expect(f2.frozen_at).toBe(f1.frozen_at);
    await save(judge, [[teams.b, 20]], 'Reveal');
    expect(totalOf(await publicBoard(event.slug), teams.b)).toBe(0);
    await freeze(admin, event.id, false);
    const sb = await publicBoard(event.slug);
    expect(sb.display.is_frozen).toBe(false);
    expect(totalOf(sb, teams.b)).toBe(20);
    expect(sb.standings[0]!.team_id).toBe(teams.b);
  });

  it('WebSocket viewers get no snapshot (not even a timing signal) for post-freeze saves', async () => {
    const { admin, event, judge, teams } = await sportsDay();
    const { ws, messages } = await connect(event.slug);
    expect(messages[0]?.t).toBe('snapshot');

    await save(judge, [[teams.a, 10]], 'Visible');
    await tick();
    const afterVisible = messages.length;
    expect(afterVisible).toBe(2);

    await tick(5);
    await freeze(admin, event.id, true);
    await tick();
    expect(messages.length).toBe(3);
    const frozenMsg = messages[2] as Extract<LiveMessage, { t: 'snapshot' }>;
    expect(frozenMsg.data.display.is_frozen).toBe(true);

    await tick(5);
    await save(judge, [[teams.b, 40]], 'SECRET-WS');
    await tick();
    expect(messages.length).toBe(3);
    expect(JSON.stringify(messages)).not.toContain('SECRET-WS');

    // The hub's stored snapshot (sent to new viewers) is also clean.
    const stub = env.SCORE_HUB.get(env.SCORE_HUB.idFromName(eventHubName(event.id)));
    const stored = await runInDurableObject(stub, (_i, state) => state.storage.kv.get<string>('snapshot'));
    expect(stored).toContain('"is_frozen":true');
    expect(stored).not.toContain('SECRET-WS');
    ws.close();
  });
});
