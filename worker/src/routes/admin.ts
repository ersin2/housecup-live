import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import {
  AdminLoginInput,
  BatchId,
  CreateEventInput,
  DeleteEventInput,
  FeatureInput,
  FreezeInput,
  HouseInput,
  HousePatch,
  LedgerQuery,
  MAX_TEAMS,
  OrderInput,
  PatchEventInput,
  TeamInput,
  TeamPatch,
} from '@housecup/shared/schemas';
import { deriveShortName, slugify } from '@housecup/shared/naming';
import type { AdminEventDTO } from '@housecup/shared/types';
import type { AppEnv } from '../env.ts';
import { ApiError, clientIp, noStore, notFound, parseId, sameOrigin, zv } from '../lib/http.ts';
import { randomPin, randomToken, safeEqual } from '../lib/crypto.ts';
import { ADMIN_COOKIE, ADMIN_TTL_MS, clearSessionCookie, readCookie, setSessionCookie, verify } from '../lib/session.ts';
import { guardStub } from '../hub/Guard.ts';
import { getEventById, teamTotals, toHouseDTO, type EventRow, type HouseRow, type TeamRow } from '../services/rows.ts';
import { getBatch, listBatches, restoreBatch, revertBatch } from '../services/ledger.ts';
import { csvFilename, eventCsv, seasonCsv } from '../services/csv.ts';
import { schedulePublish } from '../services/publish.ts';

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use('*', noStore, sameOrigin);

const MIN = 60_000;
export const ADMIN_RULES = {
  perIp: (ip: string) => ({ key: `admin-ip:${ip}`, limit: 10, windowMs: 10 * MIN }),
  globalFail: { key: 'admin-fail:global', limit: 50, windowMs: 60 * MIN },
};

const isUnique = (e: unknown, needle: string) =>
  e instanceof Error && /UNIQUE constraint failed/i.test(e.message) && e.message.includes(needle);

// ---------------------------------------------------------------- auth

adminRoutes.post('/login', zv('json', AdminLoginInput), async (c) => {
  const expected = c.env.ADMIN_PASSCODE;
  if (!expected || expected.length < 8) throw new ApiError(500, 'MISCONFIGURED', 'ADMIN_PASSCODE is not set (min 8 chars)');
  const guard = guardStub(c.env);
  const ipRule = ADMIN_RULES.perIp(clientIp(c));
  const r = await guard.attempt([ipRule, ADMIN_RULES.globalFail], [ipRule]);
  if (!r.ok) {
    c.header('Retry-After', String(Math.ceil(r.retry_after_ms / 1000)));
    throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts — try again later', { retry_after_ms: r.retry_after_ms });
  }
  if (!(await safeEqual(c.req.valid('json').passcode, expected))) {
    await guard.record([ADMIN_RULES.globalFail]);
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Wrong passcode');
  }
  await setSessionCookie(c, ADMIN_COOKIE, 'admin', { r: 'admin', x: Date.now() + ADMIN_TTL_MS }, ADMIN_TTL_MS);
  return c.json({ ok: true });
});

adminRoutes.post('/logout', (c) => {
  clearSessionCookie(c, ADMIN_COOKIE);
  return c.json({ ok: true });
});

const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const s = await verify<{ r: string; x: number }>(c, 'admin', readCookie(c, ADMIN_COOKIE));
  if (!s || s.r !== 'admin') throw new ApiError(401, 'NO_SESSION', 'Admin login required');
  await next();
};
adminRoutes.use('*', async (c, next) => {
  const p = new URL(c.req.url).pathname;
  if (p.endsWith('/admin/login') || p.endsWith('/admin/logout')) return next();
  return requireAdmin(c, next);
});

adminRoutes.get('/me', (c) => c.json({ ok: true }));

// ---------------------------------------------------------------- helpers

async function adminEvent(db: D1Database, e: EventRow): Promise<AdminEventDTO> {
  return {
    id: e.id,
    name: e.name,
    slug: e.slug,
    category: e.category,
    status: e.status,
    is_featured: e.is_featured === 1,
    counts_toward_season: e.counts_toward_season === 1,
    theme_mode: e.theme_mode,
    is_frozen: e.is_frozen === 1,
    frozen_at: e.frozen_at,
    announcement_text: e.announcement_text,
    judge_token: e.judge_token,
    judge_pin: e.judge_pin,
    created_at: e.created_at,
    teams: await teamTotals(db, e.id, null),
  };
}

async function mustEvent(db: D1Database, rawId: string | undefined): Promise<EventRow> {
  const e = await getEventById(db, parseId(rawId, 'Event'));
  if (!e) throw notFound('Event');
  return e;
}

async function uniqueSlug(db: D1Database, base: string): Promise<string> {
  const { results } = await db
    .prepare('SELECT slug FROM events WHERE slug = ? OR slug LIKE ?')
    .bind(base, `${base}-%`)
    .all<{ slug: string }>();
  const taken = new Set(results.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

async function uniqueActivePin(db: D1Database, excludeEventId?: number): Promise<string> {
  const { results } = await db
    .prepare("SELECT judge_pin FROM events WHERE status = 'active' AND id IS NOT ?")
    .bind(excludeEventId ?? null)
    .all<{ judge_pin: string }>();
  const taken = new Set(results.map((r) => r.judge_pin));
  if (taken.size >= 9000) throw new ApiError(409, 'PIN_SPACE_EXHAUSTED', 'Archive some events first');
  for (;;) {
    const pin = randomPin();
    if (!taken.has(pin)) return pin;
  }
}

async function assertHousesExist(db: D1Database, ids: (number | null | undefined)[]) {
  const wanted = [...new Set(ids.filter((x): x is number => typeof x === 'number'))];
  if (!wanted.length) return;
  const { results } = await db
    .prepare(`SELECT id FROM default_houses WHERE id IN (${wanted.map(() => '?').join(',')})`)
    .bind(...wanted)
    .all<{ id: number }>();
  if (results.length !== wanted.length) throw new ApiError(422, 'UNKNOWN_HOUSE', 'Linked house does not exist');
}

// ---------------------------------------------------------------- houses

adminRoutes.get('/houses', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM default_houses ORDER BY sort_order, id').all<HouseRow>();
  return c.json({ houses: results.map(toHouseDTO) });
});

adminRoutes.post('/houses', zv('json', HouseInput), async (c) => {
  const db = c.env.DB;
  const body = c.req.valid('json');
  const { results: existing } = await db.prepare('SELECT short_name, sort_order FROM default_houses').all<HouseRow>();
  if (existing.length >= 24) throw new ApiError(422, 'TOO_MANY_HOUSES', 'Up to 24 houses are supported');
  const short = body.short_name ?? deriveShortName(body.name, existing.map((h) => h.short_name));
  const order = body.sort_order ?? existing.reduce((m, h) => Math.max(m, h.sort_order + 1), 0);
  const row = await db
    .prepare(
      'INSERT INTO default_houses (name, short_name, color_hex, icon_key, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
    )
    .bind(body.name, short, body.color_hex, body.icon_key ?? null, order, Date.now())
    .first<HouseRow>();
  await schedulePublish(c, null, { season: true });
  return c.json({ house: toHouseDTO(row!) }, 201);
});

adminRoutes.patch('/houses/:id', zv('json', HousePatch), async (c) => {
  const db = c.env.DB;
  const id = parseId(c.req.param('id'), 'House');
  const body = c.req.valid('json');
  const house = await db.prepare('SELECT * FROM default_houses WHERE id = ?').bind(id).first<HouseRow>();
  if (!house) throw notFound('House');

  const sets: string[] = [];
  const vals: unknown[] = [];
  const teamSets: string[] = [];
  const teamVals: unknown[] = [];
  for (const k of ['name', 'short_name', 'color_hex'] as const) {
    if (body[k] !== undefined) {
      sets.push(`${k} = ?`);
      vals.push(body[k]);
      teamSets.push(`${k} = ?`);
      teamVals.push(body[k]);
    }
  }
  if (body.icon_key !== undefined) {
    sets.push('icon_key = ?');
    vals.push(body.icon_key);
  }
  if (body.sort_order !== undefined) {
    sets.push('sort_order = ?');
    vals.push(body.sort_order);
  }
  if (!sets.length) throw new ApiError(400, 'VALIDATION', 'Nothing to update');

  const stmts = [db.prepare(`UPDATE default_houses SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id)];
  const syncTeams = body.sync_teams !== false && teamSets.length > 0;
  if (syncTeams) {
    stmts.push(
      db
        .prepare(
          `UPDATE event_teams SET ${teamSets.join(', ')}
           WHERE house_id = ? AND event_id IN (SELECT id FROM events WHERE status = 'active')`,
        )
        .bind(...teamVals, id),
    );
  }
  try {
    await db.batch(stmts);
  } catch (e) {
    if (isUnique(e, 'event_teams')) throw new ApiError(409, 'DUPLICATE_NAME', 'An event already has a team with that name');
    throw e;
  }

  const { results: affected } = await db
    .prepare(
      "SELECT DISTINCT t.event_id FROM event_teams t JOIN events e ON e.id = t.event_id WHERE t.house_id = ? AND e.status = 'active'",
    )
    .bind(id)
    .all<{ event_id: number }>();
  await schedulePublish(c, null, { season: true });
  if (syncTeams) for (const a of affected) await schedulePublish(c, a.event_id, { season: false });

  const updated = await db.prepare('SELECT * FROM default_houses WHERE id = ?').bind(id).first<HouseRow>();
  return c.json({ house: toHouseDTO(updated!) });
});

adminRoutes.put('/houses/order', zv('json', OrderInput), async (c) => {
  const db = c.env.DB;
  const { ids } = c.req.valid('json');
  const { results } = await db.prepare('SELECT id FROM default_houses').all<{ id: number }>();
  const all = new Set(results.map((r) => r.id));
  if (ids.length !== all.size || !ids.every((i) => all.has(i)) || new Set(ids).size !== ids.length) {
    throw new ApiError(422, 'ORDER_MISMATCH', 'ids must list every house exactly once');
  }
  await db.batch(ids.map((id, i) => db.prepare('UPDATE default_houses SET sort_order = ? WHERE id = ?').bind(i, id)));
  await schedulePublish(c, null, { season: true });
  return c.json({ ok: true });
});

adminRoutes.delete('/houses/:id', async (c) => {
  const db = c.env.DB;
  const id = parseId(c.req.param('id'), 'House');
  const used = await db.prepare('SELECT COUNT(*) AS n FROM event_teams WHERE house_id = ?').bind(id).first<{ n: number }>();
  if ((used?.n ?? 0) > 0) {
    throw new ApiError(409, 'HOUSE_IN_USE', 'This house is linked to event teams; unlink or delete those events first');
  }
  const res = await db.prepare('DELETE FROM default_houses WHERE id = ?').bind(id).run();
  if (!res.meta.changes) throw notFound('House');
  await schedulePublish(c, null, { season: true });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- events

adminRoutes.get('/events', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM events ORDER BY status, created_at DESC').all<EventRow>();
  return c.json({ events: await Promise.all(results.map((e) => adminEvent(c.env.DB, e))) });
});

adminRoutes.get('/events/:id', async (c) => c.json({ event: await adminEvent(c.env.DB, await mustEvent(c.env.DB, c.req.param('id'))) }));

adminRoutes.post('/events', zv('json', CreateEventInput), async (c) => {
  const db = c.env.DB;
  const body = c.req.valid('json');
  const now = Date.now();

  let teamRows: { house_id: number | null; name: string; short_name: string; color_hex: string }[];
  if (body.teams.mode === 'houses') {
    const { results } = await db.prepare('SELECT * FROM default_houses ORDER BY sort_order, id').all<HouseRow>();
    if (results.length < 2) throw new ApiError(422, 'NOT_ENOUGH_HOUSES', 'Add at least 2 school houses first');
    if (results.length > MAX_TEAMS) throw new ApiError(422, 'TOO_MANY_TEAMS', `An event supports up to ${MAX_TEAMS} teams`);
    teamRows = results.map((h) => ({ house_id: h.id, name: h.name, short_name: h.short_name, color_hex: h.color_hex }));
  } else {
    await assertHousesExist(db, body.teams.teams.map((t) => t.house_id));
    const used: string[] = [];
    teamRows = body.teams.teams.map((t) => {
      const short = t.short_name ?? deriveShortName(t.name, used);
      used.push(short);
      return { house_id: t.house_id ?? null, name: t.name, short_name: short, color_hex: t.color_hex };
    });
  }

  const featured = await db.prepare('SELECT id FROM events WHERE is_featured = 1').first();
  const baseSlug = slugify(body.name);

  for (let attempt = 0; attempt < 4; attempt++) {
    const slug = await uniqueSlug(db, baseSlug);
    const pin = await uniqueActivePin(db);
    const teamStmt = db.prepare(
      `INSERT INTO event_teams (event_id, house_id, name, short_name, color_hex, sort_order, created_at)
       VALUES ((SELECT id FROM events WHERE slug = ?), ?, ?, ?, ?, ?, ?)`,
    );
    try {
      await db.batch([
        db
          .prepare(
            `INSERT INTO events (name, slug, category, status, is_featured, counts_toward_season, theme_mode,
                                 announcement_text, judge_token, judge_pin, created_at)
             VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            body.name,
            slug,
            body.category,
            featured ? 0 : 1,
            body.counts_toward_season ? 1 : 0,
            body.theme_mode,
            body.announcement_text,
            randomToken(),
            pin,
            now,
          ),
        ...teamRows.map((t, i) => teamStmt.bind(slug, t.house_id, t.name, t.short_name, t.color_hex, i, now)),
      ]);
      const event = (await db.prepare('SELECT * FROM events WHERE slug = ?').bind(slug).first<EventRow>())!;
      await schedulePublish(c, event.id, { season: true });
      return c.json({ event: await adminEvent(db, event) }, 201);
    } catch (e) {
      // Lost a race on slug / PIN / featured uniqueness: retry with fresh values.
      if (isUnique(e, 'events.') || isUnique(e, 'judge_pin') || isUnique(e, 'is_featured')) continue;
      if (isUnique(e, 'event_teams')) throw new ApiError(409, 'DUPLICATE_NAME', 'Team names must be unique');
      throw e;
    }
  }
  throw new ApiError(503, 'RETRY', 'Could not allocate a unique slug/PIN, please retry');
});

adminRoutes.patch('/events/:id', zv('json', PatchEventInput), async (c) => {
  const db = c.env.DB;
  const event = await mustEvent(db, c.req.param('id'));
  const body = c.req.valid('json');
  const sets: string[] = [];
  const vals: unknown[] = [];
  const put = (col: string, v: unknown) => {
    sets.push(`${col} = ?`);
    vals.push(v);
  };
  if (body.name !== undefined) put('name', body.name);
  if (body.category !== undefined) put('category', body.category);
  if (body.theme_mode !== undefined) put('theme_mode', body.theme_mode);
  if (body.counts_toward_season !== undefined) put('counts_toward_season', body.counts_toward_season ? 1 : 0);
  if (body.announcement_text !== undefined) put('announcement_text', body.announcement_text);
  if (body.status !== undefined && body.status !== event.status) {
    put('status', body.status);
    if (body.status === 'archived') put('is_featured', 0);
    if (body.status === 'active') {
      const clash = await db
        .prepare("SELECT 1 FROM events WHERE status = 'active' AND judge_pin = ? AND id <> ?")
        .bind(event.judge_pin, event.id)
        .first();
      if (clash) put('judge_pin', await uniqueActivePin(db, event.id));
    }
  }
  if (sets.length) await db.prepare(`UPDATE events SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, event.id).run();
  await schedulePublish(c, event.id, { season: true });
  return c.json({ event: await adminEvent(db, (await getEventById(db, event.id))!) });
});

adminRoutes.post('/events/:id/freeze', zv('json', FreezeInput), async (c) => {
  const db = c.env.DB;
  const event = await mustEvent(db, c.req.param('id'));
  if (c.req.valid('json').frozen) {
    // Idempotent: re-freezing keeps the original frozen_at.
    await db.prepare('UPDATE events SET is_frozen = 1, frozen_at = ? WHERE id = ? AND is_frozen = 0').bind(Date.now(), event.id).run();
  } else {
    await db.prepare('UPDATE events SET is_frozen = 0, frozen_at = NULL WHERE id = ?').bind(event.id).run();
  }
  await schedulePublish(c, event.id, { season: true });
  return c.json({ event: await adminEvent(db, (await getEventById(db, event.id))!) });
});

adminRoutes.post('/events/:id/feature', zv('json', FeatureInput), async (c) => {
  const db = c.env.DB;
  const event = await mustEvent(db, c.req.param('id'));
  const featured = c.req.valid('json').featured;
  if (featured && event.status !== 'active') throw new ApiError(422, 'EVENT_ARCHIVED', 'Only active events can be featured');
  await db.batch(
    featured
      ? [
          db.prepare('UPDATE events SET is_featured = 0 WHERE is_featured = 1 AND id <> ?').bind(event.id),
          db.prepare('UPDATE events SET is_featured = 1 WHERE id = ?').bind(event.id),
        ]
      : [db.prepare('UPDATE events SET is_featured = 0 WHERE id = ?').bind(event.id)],
  );
  await schedulePublish(c, event.id, { season: true });
  return c.json({ event: await adminEvent(db, (await getEventById(db, event.id))!) });
});

adminRoutes.post('/events/:id/rotate-credentials', async (c) => {
  const db = c.env.DB;
  const event = await mustEvent(db, c.req.param('id'));
  const pin = event.status === 'active' ? await uniqueActivePin(db, event.id) : randomPin();
  await db.prepare('UPDATE events SET judge_token = ?, judge_pin = ? WHERE id = ?').bind(randomToken(), pin, event.id).run();
  return c.json({ event: await adminEvent(db, (await getEventById(db, event.id))!) });
});

adminRoutes.delete('/events/:id', zv('json', DeleteEventInput), async (c) => {
  const db = c.env.DB;
  const event = await mustEvent(db, c.req.param('id'));
  if (c.req.valid('json').confirm_slug !== event.slug) {
    throw new ApiError(422, 'CONFIRMATION_MISMATCH', 'Type the event slug to confirm deletion');
  }
  await db.prepare('DELETE FROM events WHERE id = ?').bind(event.id).run();
  await schedulePublish(c, null, { season: true });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- teams

adminRoutes.post('/events/:id/teams', zv('json', TeamInput), async (c) => {
  const db = c.env.DB;
  const event = await mustEvent(db, c.req.param('id'));
  const body = c.req.valid('json');
  const { results: teams } = await db.prepare('SELECT * FROM event_teams WHERE event_id = ?').bind(event.id).all<TeamRow>();
  if (teams.length >= MAX_TEAMS) throw new ApiError(422, 'TOO_MANY_TEAMS', `An event supports up to ${MAX_TEAMS} teams`);
  await assertHousesExist(db, [body.house_id]);
  const short = body.short_name ?? deriveShortName(body.name, teams.map((t) => t.short_name));
  const order = teams.reduce((m, t) => Math.max(m, t.sort_order + 1), 0);
  try {
    await db
      .prepare(
        'INSERT INTO event_teams (event_id, house_id, name, short_name, color_hex, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .bind(event.id, body.house_id ?? null, body.name, short, body.color_hex, order, Date.now())
      .run();
  } catch (e) {
    if (isUnique(e, 'event_teams')) throw new ApiError(409, 'DUPLICATE_NAME', 'A team with that name already exists');
    throw e;
  }
  await schedulePublish(c, event.id);
  return c.json({ event: await adminEvent(db, event) }, 201);
});

async function mustTeam(db: D1Database, raw: string | undefined): Promise<TeamRow> {
  const t = await db.prepare('SELECT * FROM event_teams WHERE id = ?').bind(parseId(raw, 'Team')).first<TeamRow>();
  if (!t) throw notFound('Team');
  return t;
}

adminRoutes.patch('/teams/:id', zv('json', TeamPatch), async (c) => {
  const db = c.env.DB;
  const team = await mustTeam(db, c.req.param('id'));
  const body = c.req.valid('json');
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of ['name', 'short_name', 'color_hex'] as const) {
    if (body[k] !== undefined) {
      sets.push(`${k} = ?`);
      vals.push(body[k]);
    }
  }
  if (body.house_id !== undefined) {
    await assertHousesExist(db, [body.house_id]);
    sets.push('house_id = ?');
    vals.push(body.house_id);
  }
  if (!sets.length) throw new ApiError(400, 'VALIDATION', 'Nothing to update');
  try {
    await db.prepare(`UPDATE event_teams SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, team.id).run();
  } catch (e) {
    if (isUnique(e, 'event_teams')) throw new ApiError(409, 'DUPLICATE_NAME', 'A team with that name already exists');
    throw e;
  }
  // Renames never touch score history: scores reference the team id.
  await schedulePublish(c, team.event_id, { season: body.house_id !== undefined || undefined });
  return c.json({ event: await adminEvent(db, (await getEventById(db, team.event_id))!) });
});

adminRoutes.delete('/teams/:id', async (c) => {
  const db = c.env.DB;
  const team = await mustTeam(db, c.req.param('id'));
  const used = await db.prepare('SELECT COUNT(*) AS n FROM score_events WHERE event_team_id = ?').bind(team.id).first<{ n: number }>();
  if ((used?.n ?? 0) > 0) {
    throw new ApiError(409, 'TEAM_HAS_SCORES', 'This team has score history; revert its entries or keep the team');
  }
  await db.prepare('DELETE FROM event_teams WHERE id = ?').bind(team.id).run();
  await schedulePublish(c, team.event_id);
  return c.json({ event: await adminEvent(db, (await getEventById(db, team.event_id))!) });
});

adminRoutes.put('/events/:id/teams/order', zv('json', OrderInput), async (c) => {
  const db = c.env.DB;
  const event = await mustEvent(db, c.req.param('id'));
  const { ids } = c.req.valid('json');
  const { results } = await db.prepare('SELECT id FROM event_teams WHERE event_id = ?').bind(event.id).all<{ id: number }>();
  const all = new Set(results.map((r) => r.id));
  if (ids.length !== all.size || !ids.every((i) => all.has(i)) || new Set(ids).size !== ids.length) {
    throw new ApiError(422, 'ORDER_MISMATCH', "ids must list every one of the event's teams exactly once");
  }
  await db.batch(ids.map((id, i) => db.prepare('UPDATE event_teams SET sort_order = ? WHERE id = ?').bind(i, id)));
  await schedulePublish(c, event.id);
  return c.json({ event: await adminEvent(db, event) });
});

// ---------------------------------------------------------------- live screens

/**
 * Rebuild every public snapshot (Season Cup + each event) from D1 and push it to live screens.
 * Needed after changing data outside the app, e.g. the pre-event demo wipe via `wrangler d1 execute`.
 */
adminRoutes.post('/republish', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id FROM events').all<{ id: number }>();
  for (const e of results) await schedulePublish(c, e.id, { season: false });
  await schedulePublish(c, null, { season: true });
  return c.json({ ok: true, events: results.length });
});

// ---------------------------------------------------------------- ledger & export

adminRoutes.get('/events/:id/ledger', zv('query', LedgerQuery), async (c) => {
  const event = await mustEvent(c.env.DB, c.req.param('id'));
  return c.json(await listBatches(c.env.DB, event.id, c.req.valid('query')));
});

for (const action of ['revert', 'restore'] as const) {
  adminRoutes.post(`/batches/:batchId/${action}`, zv('param', z.object({ batchId: BatchId })), async (c) => {
    const db = c.env.DB;
    const { batchId } = c.req.valid('param');
    const batch = await getBatch(db, batchId);
    if (!batch) throw notFound('Batch');
    const event = (await getEventById(db, batch.event_id))!;
    const result = await (action === 'revert' ? revertBatch : restoreBatch)(db, event, batchId);
    if (result.changed && event.is_frozen !== 1) await schedulePublish(c, event.id);
    return c.json(result);
  });
}

function csvResponse(body: string, filename: string) {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

adminRoutes.get('/events/:id/export.csv', async (c) => {
  const event = await mustEvent(c.env.DB, c.req.param('id'));
  return csvResponse(await eventCsv(c.env.DB, event, c.env.SCHOOL_TZ || 'UTC'), csvFilename(event.slug));
});

adminRoutes.get('/season/export.csv', async (c) =>
  csvResponse(await seasonCsv(c.env.DB, c.env.SCHOOL_TZ || 'UTC'), csvFilename('season-cup')),
);
