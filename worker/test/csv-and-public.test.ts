import { env } from 'cloudflare:workers';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { deriveShortName, slugify } from '@housecup/shared/naming';
import { HEARTBEAT_MS } from '../src/hub/ScoreHub.ts';
import { eventHubName } from '../src/services/publish.ts';
import { call, rawBytes, save, sportsDay } from './helpers.ts';

describe('CSV export', () => {
  it('event CSV: BOM, CRLF, standings + chronological ledger, formula-safe', async () => {
    const { admin, event, judge, teams } = await sportsDay();
    await save(judge, [[teams.a, 10], [teams.b, -3]], '=HYPERLINK("http://x")');
    await save(judge, [[teams.c, 5]], 'Relay, "final"');
    const r = await call(`/api/admin/events/${event.id}/export.csv`, { cookie: admin });
    expect(r.status).toBe(200);
    expect(r.res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(r.res.headers.get('Content-Disposition')).toMatch(/attachment; filename="sports-day-\d{4}-\d{2}-\d{2}\.csv"/);
    // Response.text() strips a BOM while decoding, so inspect the raw bytes.
    const bytes = await rawBytes(`/api/admin/events/${event.id}/export.csv`, admin);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(r.text).toContain('\r\n');
    expect(r.text).toContain('# Standings');
    expect(r.text).toContain('1,Phoenix,PHN,10,0');
    expect(r.text).toContain(`"'=HYPERLINK(""http://x"")"`); // neutralised + quoted
    expect(r.text).toContain('"Relay, ""final"""');
    expect(r.text).toMatch(/,Titans,-3,/); // negative numbers stay numeric
    expect(r.text).not.toMatch(/,'-3,/);
  });

  it('season CSV includes breakdown per event', async () => {
    const { admin, judge, teams } = await sportsDay();
    await save(judge, [[teams.a, 4]]);
    const r = await call('/api/admin/season/export.csv', { cookie: admin });
    expect(r.status).toBe(200);
    expect(r.text).toContain('# Season Cup standings');
    expect(r.text).toContain('Sports Day,Phoenix,4');
  });

  it('requires admin', async () => {
    const { event } = await sportsDay();
    expect((await call(`/api/admin/events/${event.id}/export.csv`)).status).toBe(401);
  });
});

describe('public scoreboard caching contract', () => {
  it('sends edge cache headers, an ETag, and 304s on If-None-Match', async () => {
    const { event, judge, teams } = await sportsDay();
    const a = await call(`/api/public/scoreboard?event=${event.slug}`);
    expect(a.res.headers.get('Cache-Control')).toBe('public, max-age=2, s-maxage=3, stale-while-revalidate=5');
    const etag = a.res.headers.get('ETag')!;
    expect(etag).toMatch(/^"[0-9a-f]{20}"$/);
    const b = await call(`/api/public/scoreboard?event=${event.slug}`, { headers: { 'If-None-Match': etag } });
    expect(b.status).toBe(304);
    // A save refreshes the cached entry immediately (no 3s staleness for viewers).
    await save(judge, [[teams.a, 1]]);
    const c = await call(`/api/public/scoreboard?event=${event.slug}`, { headers: { 'If-None-Match': etag } });
    expect(c.status).toBe(200);
    expect(c.res.headers.get('ETag')).not.toBe(etag);
  });

  it('never exposes judge names, tokens or PINs publicly', async () => {
    const { event, judge, teams } = await sportsDay();
    await save(judge, [[teams.a, 1]], 'Heat 1');
    const r = await call(`/api/public/scoreboard?event=${event.slug}`);
    expect(r.text).not.toContain('Ms. Tan');
    expect(r.text).not.toContain(event.judge_token);
    expect(r.text).not.toContain('judge_pin');
    const list = await call('/api/public/events');
    expect(list.body.featured_slug).toBe(event.slug);
    expect(JSON.stringify(list.body)).not.toContain(event.judge_token);
  });

  it('defaults to the featured event, and 404s unknown slugs', async () => {
    const { event } = await sportsDay();
    expect((await call('/api/public/scoreboard')).body.event.slug).toBe(event.slug);
    expect((await call('/api/public/scoreboard?event=nope')).status).toBe(404);
    expect((await call('/api/public/live?event=nope', { headers: { Upgrade: 'websocket' } })).status).toBe(404);
  });
});

describe('ScoreHub idle discipline', () => {
  it('heartbeat alarm runs only while viewers are connected', async () => {
    const { event } = await sportsDay();
    const stub = env.SCORE_HUB.get(env.SCORE_HUB.idFromName(eventHubName(event.id)));
    const r = await call(`/api/public/live?event=${event.slug}`, { headers: { Upgrade: 'websocket' } });
    const ws = r.res.webSocket!;
    ws.accept();
    const alarm = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm());
    expect(alarm).not.toBeNull();
    expect(alarm! - Date.now()).toBeLessThanOrEqual(HEARTBEAT_MS);

    expect(await runDurableObjectAlarm(stub)).toBe(true); // heartbeat sent, rescheduled
    expect(await runInDurableObject(stub, (_i, state) => state.storage.getAlarm())).not.toBeNull();

    ws.close(1000, 'bye');
    await new Promise((res) => setTimeout(res, 50));
    expect(await stub.connectionCount()).toBe(0);
    await runDurableObjectAlarm(stub); // fires once more, sees no viewers…
    expect(await runInDurableObject(stub, (_i, state) => state.storage.getAlarm())).toBeNull(); // …and stops
  });

  it('answers "ping" via auto-response', async () => {
    const { event } = await sportsDay();
    const r = await call(`/api/public/live?event=${event.slug}`, { headers: { Upgrade: 'websocket' } });
    const ws = r.res.webSocket!;
    const got: string[] = [];
    ws.accept();
    ws.addEventListener('message', (e) => got.push(e.data as string));
    ws.send('ping');
    await new Promise((res) => setTimeout(res, 50));
    expect(got).toContain('pong');
    ws.close();
  });
});

describe('short-name derivation (Event Builder auto-fill)', () => {
  it.each([
    ['Phoenix', 'PHN'],
    ['Titans', 'TTN'],
    ['Nightfall', 'NGH'],
    ['Cobalt Club', 'CC'],
    ['Grade 10 Strategists', 'G10S'],
    ['Team Alpha', 'TA'],
    ['Ox', 'OX'],
    ['  élan  ', 'ELN'],
    ['!!!', 'T'],
  ])('%s → %s', (name, short) => {
    const s = deriveShortName(name);
    expect(s).toBe(short);
    expect(s).toMatch(/^[\p{Lu}\p{N}]{1,4}$/u);
  });

  it('avoids codes already used in the event', () => {
    expect(deriveShortName('Phoenix', ['PHN'])).toBe('PHN2');
  });

  it('slugify', () => {
    expect(slugify('Esports & Chess Invitational')).toBe('esports-and-chess-invitational');
    expect(slugify('   ')).toBe('event');
  });
});
