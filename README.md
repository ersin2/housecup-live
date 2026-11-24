# HouseCup Live

A real-time scoreboard and judging platform for school houses and tournaments, built to run on the Cloudflare free tier ($0/month).

```
shared/   Types, Zod schemas, ranking, colors, short-name/slug helpers (used by both the API and the web app)
worker/   Hono API + D1 + Durable Objects (ScoreHub live fan-out, Guard login throttling), plus tests
web/      React SPA (Phase 3). The Worker serves web/dist as free static assets.
```

## Local development

```bash
npm install
npm approve-scripts workerd esbuild   # npm 11 blocks install scripts by default
cp worker/.dev.vars.example worker/.dev.vars   # then set ADMIN_PASSCODE and SESSION_SECRET

npm run db:migrate:local -w worker
npm run db:seed:local -w worker    # demo data: 4 houses, Sports Day (Daylight), Esports & Chess (Arena)

# Terminal 1: API + Durable Objects
npm run dev                         # Wrangler on http://127.0.0.1:8787

# Terminal 2: React app with hot reload
npm run dev:web                     # Vite on http://localhost:5173 (proxies /api, including WebSockets)
```

Open <http://localhost:5173> for the scoreboard, `/judge` for the Judge Pad, and `/admin` for the Control Center (passcode from `.dev.vars`).

The Vite proxy rewrites `Origin` to the Worker's own origin. That makes the Worker's same-origin check, the `SameSite=Strict` cookies and the WebSocket upgrade behave exactly as they do in production.

### Testing on a real phone over Wi-Fi

1. Run `npm run dev:web -- --host`.
2. Open `http://<your-PC-LAN-IP>:5173/judge` on the phone.

The judge cookie is `Secure`, so most phone browsers only keep it over HTTPS or on `localhost`. To test fully on a phone, use the deployed `*.workers.dev` URL (Phase 4), or a tunnel such as `cloudflared tunnel --url http://localhost:5173`.

### Production build

```bash
npm run build      # typechecks, then writes the SPA to web/dist
npm run dev        # Wrangler now also serves web/dist on :8787 (one origin, like production)
npm test           # 56 Worker tests inside the Workers runtime against real D1
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
