# HouseCup Live

A real-time scoreboard and judging platform for school houses and tournaments, built to run on the Cloudflare free tier ($0/month).

```
shared/   Types, Zod schemas, ranking, colors, short-name/slug helpers (used by both the API and the web app)
worker/   Hono API + D1 + Durable Objects (ScoreHub live fan-out, Guard login throttling), plus tests
web/      React SPA (Phase 3). The Worker serves web/dist as free static assets.
```

## Local development (backend)

```bash
npm install
npm approve-scripts workerd esbuild   # npm 11 blocks install scripts by default
cp worker/.dev.vars.example worker/.dev.vars   # then set ADMIN_PASSCODE and SESSION_SECRET

cd worker
npm run db:migrate:local
npm run db:seed:local        # demo data: 4 houses, Sports Day (daylight), Esports & Chess (arena)
npm run dev                  # http://localhost:8787/api/health
npm test                     # 56 tests, run inside the Workers runtime against real D1
```

To find the demo judge PINs:

```bash
npx wrangler d1 execute housecup --local --command "SELECT slug, judge_pin, judge_token FROM events"
```

## Key guarantees

- **Append-only ledger.** No stored totals: every total is `SUM(points) WHERE is_reverted = 0`.
- **Idempotent saves.** The client sends a UUID `batch_id`. Each row's `request_id = batch_id:team_id` is `UNIQUE`, and the whole batch is written in one `db.batch()` transaction.
- **Freeze is enforced in the API.** Every public read goes through `worker/src/services/scoreboard.ts` with `publicCutoff(event)`. While an event is frozen, batches created before the freeze cannot be reverted or restored.
- **Live push.** Updates go out through hibernating WebSockets (`ScoreHub`). The 50 s heartbeat alarm runs only while viewers are connected, and client `ping` frames are answered by `setWebSocketAutoResponse`.
- **Polling fallback.** `GET /api/public/scoreboard` returns an ETag and `304`, plus a Cache API entry that is refreshed on every write.
