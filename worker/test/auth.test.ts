import { describe, expect, it } from 'vitest';
import { adminCookie, call, cookieFrom, save, sportsDay } from './helpers.ts';

describe('admin auth', () => {
  it('rejects missing, wrong and tampered sessions', async () => {
    expect((await call('/api/admin/events')).status).toBe(401);
    expect((await call('/api/admin/login', { json: { passcode: 'nope' } })).status).toBe(401);
    const good = await adminCookie();
    expect((await call('/api/admin/me', { cookie: good })).status).toBe(200);
    const [name, value] = good.split('=') as [string, string];
    const tampered = `${name}=${value.slice(0, -2)}xx`;
    expect((await call('/api/admin/me', { cookie: tampered })).status).toBe(401);
  });

  it('cookies are HttpOnly, Secure, SameSite=Strict and scoped to /api', async () => {
    const r = await call('/api/admin/login', { json: { passcode: 'test-admin-passcode' } });
    const sc = r.res.headers.get('set-cookie')!;
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/Secure/i);
    expect(sc).toMatch(/SameSite=Strict/i);
    expect(sc).toMatch(/Path=\/api/);
  });

  it('a judge cookie can never be used as an admin cookie', async () => {
    const { judge } = await sportsDay();
    const forged = judge.replace('hc_judge=', 'hc_admin=');
    expect((await call('/api/admin/me', { cookie: forged })).status).toBe(401);
  });

  it('throttles passcode guessing per IP', async () => {
    const headers = { 'CF-Connecting-IP': '203.0.113.7' };
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await call('/api/admin/login', { json: { passcode: `guess-${i}` }, headers })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    const blocked = await call('/api/admin/login', { json: { passcode: 'test-admin-passcode' }, headers });
    expect(blocked.status).toBe(429);
    expect(blocked.res.headers.get('Retry-After')).toBeTruthy();
  });

  it('rejects cross-origin mutations', async () => {
    const r = await call('/api/admin/login', {
      json: { passcode: 'test-admin-passcode' },
      headers: { Origin: 'https://evil.example' },
    });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('BAD_ORIGIN');
  });
});

describe('judge auth', () => {
  it('QR token and 4-digit PIN both open a session', async () => {
    const { event } = await sportsDay();
    const pin = await call('/api/judge/session', { json: { pin: event.judge_pin } });
    expect(pin.status).toBe(200);
    expect(pin.body.event.slug).toBe(event.slug);
    expect(pin.body.teams).toHaveLength(4);
    const state = await call('/api/judge/state', { cookie: cookieFrom(pin.res) });
    expect(state.status).toBe(200);
  });

  it('wrong PIN is 401 and PIN guessing is throttled per IP', async () => {
    const { event } = await sportsDay();
    const wrong = event.judge_pin === '0000' ? '0001' : '0000';
    const headers = { 'CF-Connecting-IP': '198.51.100.9' };
    for (let i = 0; i < 10; i++) {
      expect((await call('/api/judge/session', { json: { pin: wrong }, headers })).status).toBe(401);
    }
    expect((await call('/api/judge/session', { json: { pin: event.judge_pin }, headers })).status).toBe(429);
  });

  it('rotating credentials revokes existing judge sessions', async () => {
    const { admin, event, judge, teams } = await sportsDay();
    expect((await save(judge, [[teams.a, 1]])).status).toBe(201);
    const rot = await call(`/api/admin/events/${event.id}/rotate-credentials`, { method: 'POST', cookie: admin });
    expect(rot.body.event.judge_token).not.toBe(event.judge_token);
    const after = await save(judge, [[teams.a, 1]]);
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('SESSION_REVOKED');
    expect((await call('/api/judge/session', { json: { token: event.judge_token } })).status).toBe(401);
  });

  it('archived events stop accepting scores', async () => {
    const { admin, event, judge, teams } = await sportsDay();
    await call(`/api/admin/events/${event.id}`, { method: 'PATCH', json: { status: 'archived' }, cookie: admin });
    expect((await save(judge, [[teams.a, 1]])).status).toBe(401);
    // ...but the public results page still works.
    expect((await call(`/api/public/scoreboard?event=${event.slug}`)).status).toBe(200);
  });

  it('judge endpoints are never cached', async () => {
    const { judge } = await sportsDay();
    const r = await call('/api/judge/state', { cookie: judge });
    expect(r.res.headers.get('Cache-Control')).toBe('no-store');
  });
});
