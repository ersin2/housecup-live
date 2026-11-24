#!/usr/bin/env node
// HouseCup Live stress test: N WebSocket spectators + J judges saving concurrently.
//
//   node scripts/stress.mjs --url https://housecup-live.<you>.workers.dev \
//        --event annual-sports-day --token <judge token from /admin> \
//        [--viewers 200] [--judges 4] [--seconds 120] [--every 4000] [--keep]
//
// Measures: viewer connect success, push fan-out latency (save → every viewer sees it),
// judge save latency, idempotent replays, and exact totals. Afterwards it undoes every
// batch it created (unless --keep), so demo data stays clean.
// Run it against a DEMO event, never during a real event, and never on a frozen event.

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]]);
    return acc;
  }, []),
);
const BASE = String(args.url ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const EVENT = args.event ?? 'annual-sports-day';
const TOKEN = args.token;
const VIEWERS = Number(args.viewers ?? 100);
const JUDGES = Number(args.judges ?? 3);
const SECONDS = Number(args.seconds ?? 60);
const EVERY = Number(args.every ?? 4000);
const KEEP = !!args.keep;
if (!TOKEN) {
  console.error('Missing --token (copy the judge link token from /admin → event → Judge access).');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => (arr.length ? [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))] : NaN);
const fmt = (n) => (Number.isFinite(n) ? `${Math.round(n)} ms` : 'n/a');
const cookieOf = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

async function scoreboard() {
  const r = await fetch(`${BASE}/api/public/scoreboard?event=${EVENT}`, { headers: { 'Cache-Control': 'no-cache' } });
  if (!r.ok) throw new Error(`scoreboard ${r.status}`);
  return r.json();
}

// ---------------------------------------------------------------- setup
const before = await scoreboard();
if (before.display.is_frozen) {
  console.error('This event is in Mystery mode. Unfreeze it first (the stress test checks public totals).');
  process.exit(1);
}
console.log(`Target ${BASE}  event "${before.display.title}"  viewers=${VIEWERS} judges=${JUDGES} ${SECONDS}s, save every ${EVERY} ms per judge`);

const sent = new Map(); // batch_id -> t0
const seenAt = new Map(); // batch_id -> [latency ms per viewer]
let connected = 0;
let connectFailed = 0;
let disconnects = 0;
const sockets = [];

function openViewer(i) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/api/public/live?event=${EVENT}`);
    const known = new Set();
    let opened = false;
    const timer = setTimeout(() => {
      if (!opened) {
        connectFailed++;
        ws.close();
        resolve();
      }
    }, 10_000);
    ws.onopen = () => {
      opened = true;
      connected++;
      clearTimeout(timer);
      resolve();
    };
    ws.onerror = () => {
      if (!opened) {
        connectFailed++;
        clearTimeout(timer);
        resolve();
      }
    };
    ws.onclose = () => opened && disconnects++;
    ws.onmessage = (e) => {
      if (e.data === 'pong') return;
      const msg = JSON.parse(e.data);
      if (msg.t !== 'snapshot') return;
      const now = performance.now();
      for (const f of msg.data.feed) {
        if (known.has(f.batch_id)) continue;
        known.add(f.batch_id);
        const t0 = sent.get(f.batch_id);
        if (t0 !== undefined) {
          if (!seenAt.has(f.batch_id)) seenAt.set(f.batch_id, []);
          seenAt.get(f.batch_id).push(now - t0);
        }
      }
    };
    sockets.push(ws);
    void i;
  });
}

const t0Connect = performance.now();
for (let i = 0; i < VIEWERS; i += 25) {
  await Promise.all(Array.from({ length: Math.min(25, VIEWERS - i) }, (_, k) => openViewer(i + k)));
  await sleep(250); // ramp up ~100 connections/second
}
console.log(`Viewers connected: ${connected}/${VIEWERS} (failed ${connectFailed}) in ${fmt(performance.now() - t0Connect)}`);

// ---------------------------------------------------------------- judges
const teams = before.standings.map((s) => s.team_id);
const expected = new Map(teams.map((t) => [t, 0]));
const saveLatency = [];
const created = [];
let replays = 0;
let replayOk = 0;
let errors = 0;

async function judge(k) {
  const login = await fetch(`${BASE}/api/judge/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN, judge_name: `Stress ${k + 1}` }),
  });
  if (!login.ok) throw new Error(`judge login ${login.status}`);
  const cookie = cookieOf(login);
  const end = performance.now() + SECONDS * 1000;
  await sleep(Math.random() * EVERY);
  while (performance.now() < end) {
    const n = 1 + Math.floor(Math.random() * Math.min(3, teams.length));
    const picked = [...teams].sort(() => Math.random() - 0.5).slice(0, n);
    const awards = picked.map((t) => ({ event_team_id: t, points: [1, 3, 5, 10][Math.floor(Math.random() * 4)] }));
    const batch_id = crypto.randomUUID();
    const body = JSON.stringify({ batch_id, label: 'STRESS TEST', awards });
    const t0 = performance.now();
    sent.set(batch_id, t0);
    try {
      const r = await fetch(`${BASE}/api/judge/batches`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body });
      saveLatency.push(performance.now() - t0);
      if (r.status === 201) {
        created.push({ batch_id, cookie });
        for (const a of awards) expected.set(a.event_team_id, expected.get(a.event_team_id) + a.points);
        if (Math.random() < 0.15) {
          // Simulate a weak-4G double tap: same batch_id again must be a harmless replay.
          replays++;
          const again = await fetch(`${BASE}/api/judge/batches`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body });
          if (again.status === 200 && (await again.json()).replayed) replayOk++;
        }
      } else {
        errors++;
        console.warn(`save ${r.status}: ${await r.text()}`);
      }
    } catch (e) {
      errors++;
      console.warn('save failed:', e.message);
    }
    await sleep(EVERY * (0.7 + Math.random() * 0.6));
  }
}

await Promise.all(Array.from({ length: JUDGES }, (_, k) => judge(k)));
await sleep(3000); // let the last pushes arrive

// ---------------------------------------------------------------- report
const fanout = [...seenAt.values()].flat();
const missing = [...sent.keys()].filter((id) => created.some((c) => c.batch_id === id)).reduce((n, id) => n + Math.max(0, connected - (seenAt.get(id)?.length ?? 0)), 0);
const after = await scoreboard();
let totalsOk = true;
for (const s of after.standings) {
  const b = before.standings.find((x) => x.team_id === s.team_id)?.total ?? 0;
  if (s.total - b !== expected.get(s.team_id)) {
    totalsOk = false;
    console.warn(`  total mismatch for ${s.name}: +${s.total - b}, expected +${expected.get(s.team_id)}`);
  }
}

console.log('\nResults');
console.log(`  saves:            ${created.length} ok, ${errors} errors; latency p50 ${fmt(pct(saveLatency, 50))}, p95 ${fmt(pct(saveLatency, 95))}`);
console.log(`  double-tap tests: ${replayOk}/${replays} replayed safely (no double award)`);
console.log(`  push fan-out:     p50 ${fmt(pct(fanout, 50))}, p95 ${fmt(pct(fanout, 95))}, max ${fmt(Math.max(...fanout))} over ${fanout.length} deliveries`);
console.log(`  missed deliveries ${missing}   viewer disconnects ${disconnects}`);
console.log(`  totals:           ${totalsOk ? 'EXACT (public totals moved by exactly what judges saved)' : 'MISMATCH'}`);

for (const ws of sockets) ws.close();

if (!KEEP && created.length) {
  let undone = 0;
  for (const { batch_id, cookie } of created) {
    const r = await fetch(`${BASE}/api/judge/batches/${batch_id}/revert`, { method: 'POST', headers: { Cookie: cookie } });
    if (r.ok) undone++;
  }
  console.log(`  cleanup:          undid ${undone}/${created.length} STRESS TEST batches (they stay in the ledger as undone)`);
}

const pass = connectFailed === 0 && errors === 0 && totalsOk && replayOk === replays && pct(fanout, 95) < 2000;
console.log(`\n${pass ? 'PASS' : 'CHECK THE WARNINGS ABOVE'}`);
process.exit(pass ? 0 : 1);
