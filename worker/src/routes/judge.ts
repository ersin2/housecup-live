import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { BatchId, CreateBatchInput, JudgeSessionInput } from '@housecup/shared/schemas';
import type { JudgeState, SaveBatchResponse } from '@housecup/shared/types';
import type { AppEnv, JudgeClaims } from '../env.ts';
import { ApiError, clientIp, noStore, sameOrigin, zv } from '../lib/http.ts';
import {
  clearSessionCookie,
  JUDGE_COOKIE,
  JUDGE_TTL_MS,
  readCookie,
  setSessionCookie,
  tokenFingerprint,
  verify,
} from '../lib/session.ts';
import { guardStub } from '../hub/Guard.ts';
import {
  getActiveEventByPin,
  getActiveEventByToken,
  getEventById,
  teamTotals,
  totalsMap,
  type EventRow,
} from '../services/rows.ts';
import { insertBatch, listBatches, recentLabels, restoreBatch, revertBatch } from '../services/ledger.ts';
import { schedulePublish } from '../services/publish.ts';

export const judgeRoutes = new Hono<AppEnv>();
judgeRoutes.use('*', noStore, sameOrigin);

const MIN = 60_000;
export const PIN_RULES = {
  perIp: (ip: string) => ({ key: `pin-ip:${ip}`, limit: 10, windowMs: 10 * MIN }),
  globalFail: { key: 'pin-fail:global', limit: 200, windowMs: 60 * MIN },
};

async function judgeState(db: D1Database, event: EventRow, judgeName: string | null): Promise<JudgeState> {
  const [teams, labels] = await Promise.all([teamTotals(db, event.id, null), recentLabels(db, event.id)]);
  return {
    event: {
      id: event.id,
      slug: event.slug,
      name: event.name,
      category: event.category,
      is_frozen: event.is_frozen === 1,
      frozen_at: event.frozen_at,
    },
    judge_name: judgeName,
    teams,
    recent_labels: labels,
  };
}

judgeRoutes.post('/session', zv('json', JudgeSessionInput), async (c) => {
  const body = c.req.valid('json');
  const db = c.env.DB;
  let event: EventRow | null;

  if ('token' in body) {
    event = await getActiveEventByToken(db, body.token);
  } else {
    const guard = guardStub(c.env);
    const ipRule = PIN_RULES.perIp(clientIp(c));
    const r = await guard.attempt([ipRule, PIN_RULES.globalFail], [ipRule]);
    if (!r.ok) {
      c.header('Retry-After', String(Math.ceil(r.retry_after_ms / 1000)));
      throw new ApiError(429, 'RATE_LIMITED', 'Too many PIN attempts — wait a few minutes or scan the QR code', {
        retry_after_ms: r.retry_after_ms,
      });
    }
    event = await getActiveEventByPin(db, body.pin);
    if (!event) await guard.record([PIN_RULES.globalFail]);
  }

  if (!event) throw new ApiError(401, 'INVALID_CREDENTIALS', 'That code does not match an active event');

  const claims: JudgeClaims = {
    e: event.id,
    f: await tokenFingerprint(event.judge_token),
    n: body.judge_name,
    x: Date.now() + JUDGE_TTL_MS,
  };
  await setSessionCookie(c, JUDGE_COOKIE, 'judge', claims, JUDGE_TTL_MS);
  return c.json(await judgeState(db, event, claims.n));
});

judgeRoutes.post('/logout', (c) => {
  clearSessionCookie(c, JUDGE_COOKIE);
  return c.json({ ok: true });
});

const requireJudge: MiddlewareHandler<AppEnv> = async (c, next) => {
  const claims = await verify<JudgeClaims>(c, 'judge', readCookie(c, JUDGE_COOKIE));
  if (!claims) throw new ApiError(401, 'NO_SESSION', 'Judge session missing or expired — scan the QR code or enter the PIN');
  const event = await getEventById(c.env.DB, claims.e);
  if (!event || event.status !== 'active') {
    throw new ApiError(401, 'SESSION_REVOKED', 'This event is no longer accepting scores');
  }
  if ((await tokenFingerprint(event.judge_token)) !== claims.f) {
    throw new ApiError(401, 'SESSION_REVOKED', 'Judge access was reset by the admin — scan the new QR code');
  }
  c.set('judge', { claims, event });
  await next();
};

judgeRoutes.use('/state', requireJudge);
judgeRoutes.use('/batches', requireJudge);
judgeRoutes.use('/batches/*', requireJudge);

judgeRoutes.get('/state', async (c) => {
  const { event, claims } = c.get('judge');
  return c.json(await judgeState(c.env.DB, event, claims.n));
});

judgeRoutes.post('/batches', zv('json', CreateBatchInput), async (c) => {
  const { event, claims } = c.get('judge');
  const input = c.req.valid('json');
  const { batch, replayed } = await insertBatch(c.env.DB, event.id, input, input.judge_name ?? claims.n);
  const teams = await teamTotals(c.env.DB, event.id, null);
  // While frozen, new entries are invisible publicly, so don't even emit a timing signal.
  if (!replayed && event.is_frozen !== 1) await schedulePublish(c, event.id);
  const body: SaveBatchResponse = { batch, replayed, totals: totalsMap(teams) };
  return c.json(body, replayed ? 200 : 201);
});

judgeRoutes.get('/batches', zv('query', z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) })), async (c) => {
  const { event } = c.get('judge');
  return c.json(await listBatches(c.env.DB, event.id, { limit: c.req.valid('query').limit }));
});

const BatchParam = z.object({ batchId: BatchId });

for (const action of ['revert', 'restore'] as const) {
  judgeRoutes.post(`/batches/:batchId/${action}`, zv('param', BatchParam), async (c) => {
    const { event } = c.get('judge');
    const { batchId } = c.req.valid('param');
    const fn = action === 'revert' ? revertBatch : restoreBatch;
    const result = await fn(c.env.DB, event, batchId);
    if (result.changed && event.is_frozen !== 1) await schedulePublish(c, event.id);
    const teams = await teamTotals(c.env.DB, event.id, null);
    return c.json({ ...result, totals: totalsMap(teams) });
  });
}
