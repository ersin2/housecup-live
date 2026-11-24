# Deploying HouseCup Live ($0) and running event day

Everything runs on one Cloudflare Worker on the Workers Free plan:

- the React app, served as free static files;
- the API;
- a D1 database;
- two SQLite-backed Durable Objects.

No card or custom domain is needed. You get `https://housecup-live.<your-subdomain>.workers.dev`.

Run commands from the repo root unless a step says `cd worker`. They work in PowerShell and Git Bash.

---

## 1. First deployment (about 10 minutes, once)

```bash
# 0. Install (once per machine)
npm install
npm approve-scripts workerd esbuild

cd worker

# 1. Log in to Cloudflare (opens your browser; approve, then return here)
npx wrangler login
npx wrangler whoami                     # shows the account you are deploying to

# 2. Create the production database close to Malaysia
npx wrangler d1 create housecup --location apac
```

Wrangler prints a block containing `"database_id": "xxxxxxxx-xxxx-…"`. If it offers to add the binding to your config, answer **No**; the binding already exists. Put the ID into `worker/wrangler.jsonc` in place of `00000000-0000-0000-0000-000000000000`, either by hand or with this one-liner:

```bash
node -e "const f='wrangler.jsonc',fs=require('fs');fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace('00000000-0000-0000-0000-000000000000',process.argv[1]))" PASTE-DATABASE-ID-HERE
```

The database ID is not a secret; commit it.

```bash
# 3. Create the tables in the production database
npx wrangler d1 migrations apply housecup --remote

# 4. Build the web app and deploy everything (from the repo root)
cd ..
npm run deploy
```

On a brand-new account, Wrangler asks you to choose a `workers.dev` subdomain; pick something short. The output ends with your URL, for example `https://housecup-live.myschool.workers.dev`.

```bash
# 5. Set the production secrets (never stored in the repo)
cd worker
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"   # copy this value
npx wrangler secret put SESSION_SECRET        # paste the value from the line above
npx wrangler secret put ADMIN_PASSCODE        # a long passphrase, e.g. four random words
npx wrangler secret list                      # both names should be listed
```

Secrets take effect immediately; no redeploy is needed. Until both are set, admin and judge sign-in return a "not configured" error. That is expected for the minute between steps 4 and 5.

**Verify:** open `https://<your-url>/api/health` and expect `{"ok":true}`. Then open `/admin` and sign in with your passcode.

**Later deploys:** `npm run deploy` from the repo root. Add `npx wrangler d1 migrations apply housecup --remote` first if a new migration file was added.

---

## 2. Remote database workflows

### A. Load demo data on the live URL (for the real-phone demo)

```bash
cd worker
npx wrangler d1 execute housecup --remote --file=seed/seed.sql        # answer "y" if asked
npx wrangler d1 execute housecup --remote --command "SELECT slug, judge_pin FROM events"
```

This loads:

- four houses (Phoenix, Titans, Orion, Zephyr);
- **Annual Sports Day** (Daylight theme, counts toward the Season Cup);
- **Esports & Chess Invitational** (Arena theme, six custom teams);
- about 27 realistic score batches, timed over the last few hours.

Judge tokens and PINs are random; see `/admin` → event → Judge access. The seed only works on an empty database: it refuses to run twice, so it can never overwrite real data.

**What to show PE teachers and Marketing (all over HTTPS on real phones):**

| Show | Where |
|---|---|
| Live board with count-up, rank swaps and celebration toasts | Phone A on `/event/annual-sports-day`, phone B as the judge (scan the judge card QR) |
| Arena theme and TV mode | Projector or laptop: `/event/esports-chess-invitational?tv=1`, then F11 |
| Season Cup | `/season` (only Sports Day counts; Esports is set to "not in Season Cup") |
| Houses Manager | `/admin/houses`: rename a house and watch the board update live |
| Print dialog | `/admin` → event → **Print judge card** → Print. Check A4, one page, and that the QR scans from paper |
| Mystery mode | `/admin` → event → Mystery mode on, score on the judge phone, reveal |

### B. Wipe demo data before the real event (keeps your School Houses)

Configure your real houses first in `/admin/houses` (rename, recolour or delete the demo ones). Then:

```bash
cd worker
mkdir ../backups                                                   # once; this folder is git-ignored
npx wrangler d1 export housecup --remote --output=../backups/before-wipe.sql
npx wrangler d1 execute housecup --remote --file=scripts/wipe-demo-events.sql
npx wrangler d1 execute housecup --remote --command "SELECT (SELECT COUNT(*) FROM events) AS events, (SELECT COUNT(*) FROM score_events) AS scores, (SELECT COUNT(*) FROM default_houses) AS houses"
```

Expect `events 0, scores 0, houses <your count>`. Then:

1. Open `/admin` and click **Refresh all live screens**. This clears demo totals still cached in the live-screen hubs.
2. Create the real events.
3. Print fresh judge cards. Old demo cards stop working because their events no longer exist.

**Variant: you already built the real events and only ran a rehearsal on them.** Keep events and teams, delete only the scores, and lift any freeze:

```bash
npx wrangler d1 execute housecup --remote --file=scripts/reset-scores-only.sql
```

Then click **Refresh all live screens**.

**Undo a wipe:**

- D1 Time Travel keeps 7 days of history on the Free plan. List restore points with `npx wrangler d1 time-travel info housecup`, then restore with `npx wrangler d1 time-travel restore housecup --timestamp=<ISO time before the wipe>`.
- Or restore the SQL backup into an empty database.

---

## 3. Free-tier budget (why one event day fits)

Assumptions: 1,000 spectator phones, 10 judges, 300 saves, 2 TVs, an 8-hour day.

| Resource (daily limit) | Expected | Why it stays low |
|---|---|---|
| Worker requests (100,000) | ~30,000 | A phone costs 2 requests per page open or return from background (event list + live socket). Static files are free. |
| Durable Object requests (100,000) | ~15,000 | 1 per socket connection, 2 per save, plus a heartbeat every 50 s per hub. Outgoing pushes are free. |
| D1 rows read (5,000,000) | ~0.6 M | Snapshots are rebuilt once per save, not per viewer. New viewers get the hub's stored snapshot with no D1 read. The Judge Pad doesn't poll. |
| D1 rows written (100,000) | ~5,000 | Only score entries and admin edits. |

**Quotas reset at 00:00 UTC, which is 08:00 Malaysia time.** An event running 07:00–15:00 spans two quota days, which only helps.

Check usage in the Cloudflare dashboard → **Workers & Pages → housecup-live → Metrics**, and **Storage & Databases → D1 → housecup → Metrics**. If a limit is ever hit, the API returns errors until the reset. Judges' unsaved entries wait on their phones and send automatically afterwards.

---

## 4. Stress test (on the live URL, with demo data, never during a real event)

```bash
node scripts/stress.mjs --url https://<your-url> --event annual-sports-day --token <judge token> --viewers 300 --judges 4 --seconds 120
```

Get the token from `/admin` → Annual Sports Day → Judge access; it's the part after `token=` in the judge link.

The script:

1. opens 300 live viewers;
2. has 4 judges save every ~4 s, including deliberate duplicate taps;
3. checks that every viewer received every update and that public totals moved by exactly what was saved;
4. undoes its own entries.

It costs roughly 300 Worker requests + 300 Durable Object requests: well under 1% of the day's quota.

**Pass:** `PASS` with 0 failed connections, 0 save errors, all double-taps "replayed safely", totals `EXACT`, and push fan-out p95 under 2 s.

Local results for reference: 150 viewers, p95 79 ms. Expect a few hundred ms over the internet.

---

## 5. Pre-event checklist

### One week before

- [ ] Deployed; `/api/health` OK; admin passcode stored in the school's password manager.
- [ ] **School network check:** open the URL on the school Wi-Fi *and* on mobile data at the venue. Some school web filters block `*.workers.dev`. If yours does, ask IT to allow it, or tell spectators to use mobile data.
- [ ] Demo shown to PE and Marketing (section 2A); stress test passed (section 4).
- [ ] Real School Houses configured; demo data wiped (section 2B); real events created; judge cards printed.

### Day before: 10-minute smoke test (2 phones + laptop + TV)

- [ ] **Judge sign-in:** scan the printed QR with phone A's camera. The pad opens, and the address bar no longer shows the token.
- [ ] **PIN fallback:** in a private tab on phone A, open `/judge` and type the PIN. The pad opens.
- [ ] **Multi-team save:** give two teams points and Save. Phone B's board and the TV update within ~2 s, with a celebration toast and the rows re-ordering.
- [ ] **Undo:** tap Undo in the green toast. Both boards go back.
- [ ] **Weak signal:** put phone A in airplane mode and Save. The amber "Not saved yet" bar appears. Turn airplane mode off: the green toast appears, and `/admin` → Audit ledger shows the entry **once**.
- [ ] **Backgrounded tab (the 1-minute disconnect):**
  1. On phone B, open the board, then lock the phone or switch apps for **at least 90 seconds**.
  2. Meanwhile, save points on phone A.
  3. Unlock phone B. Within about 2 seconds, the status reads **Live**, the new total and the feed entry appear, and up to 3 celebration toasts show what you missed. No reload needed.
- [ ] **Mystery mode:** turn it on and save on phone A. Phone B and the TV don't change, and the judge pad shows `••` instead of totals. Turn it off (the reveal): everything updates at once.
- [ ] **TV:** `?tv=1`, press F11, set the display to never sleep. The corner QR scans and opens the board on a phone.
- [ ] **CSV:** download from `/admin` → event and open it in Excel. Names and points read correctly.
- [ ] **Reset:** reset scores on the real events if you scored during the test (section 2B variant), then click **Refresh all live screens**.

### On the day

- [ ] **T-60 min:**
  - Open `/admin`. Mark the main event **Show on the main screen** and set the ticker text.
  - Open TVs on `https://<your-url>/?tv=1` (they follow the main-screen event). Use F11 or `chrome --kiosk`.
- [ ] **Judges:** hand out cards. Each judge scans once and types their name (it's shown in the audit log).
- [ ] **If something goes wrong:**
  - **Wrong points:** the judge taps Undo, or the admin uses the Audit ledger (Undo/Restore).
  - **Judge card lost or leaked:** use **Reset judge access**. This signs out *all* judges of that event; reprint and hand out the new card.
  - **Venue internet drops:** judges keep scoring; entries queue on their phones and send when the signal returns. Boards show "Offline. Showing the last scores received."
  - **Live logs:** `cd worker && npx wrangler tail`.
  - **Bad deploy:** `npx wrangler deployments list`, then `npx wrangler rollback`.
- [ ] **After:** download the event CSV and the Season Cup CSV, then **Archive** the event. It stops accepting scores; results stay public and still count toward the Season Cup.

### Secrets later

- **Change the admin passcode:** `npx wrangler secret put ADMIN_PASSCODE`.
- **Sign out every admin and judge at once:** set a new `SESSION_SECRET` the same way. Judges must rescan their cards afterwards.
