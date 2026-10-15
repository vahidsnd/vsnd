// Light load test: N guest players (N/2 pairs) connect, queue up, play for a few seconds and one forfeits.
//   npm run loadtest -w server -- --url http://localhost:8080 --players 100 --secs 20
// Prints connect/match latency percentiles, inputs acked, and every error it saw. No data is kept.
import WebSocket from 'ws';

const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('url', 'http://localhost:8080').replace(/\/$/, '');
const PLAYERS = Math.max(2, Math.floor(Number(arg('players', '100')) / 2) * 2);
const SECS = Number(arg('secs', '20'));
const WS = BASE.replace(/^http/, 'ws') + '/ws';

const errors: string[] = [];
const pct = (xs: number[], p: number) => {
  if (!xs.length) return '—';
  const s = [...xs].sort((a, b) => a - b);
  return `${Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))])} ms`;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function guest(i: number) {
  const t0 = Date.now();
  const r = await fetch(BASE + '/api/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `LT${i}` }) });
  if (!r.ok) throw new Error(`guest http ${r.status}`);
  return { token: ((await r.json()) as { token: string }).token, ms: Date.now() - t0 };
}

function connect(token: string, stats: { welcome: number[]; matched: number[]; snaps: number; acked: number }) {
  return new Promise<{ ws: WebSocket; next: (t: string, ms?: number) => Promise<any> }>((resolve, reject) => {
    const ws = new WebSocket(WS);
    const waiters: { t: string; res: (m: any) => void }[] = [];
    const seen: any[] = [];
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      if (m.t === 'snap') { stats.snaps++; if (m.ack > 0) stats.acked++; }
      const w = waiters.find((x) => x.t === m.t);
      if (w) { waiters.splice(waiters.indexOf(w), 1); w.res(m); } else seen.push(m);
    });
    ws.on('error', (e) => { errors.push('ws: ' + e.message); reject(e); });
    const next = (t: string, ms = 30000) => new Promise<any>((res, rej) => {
      const i = seen.findIndex((m) => m.t === t);
      if (i >= 0) return res(seen.splice(i, 1)[0]);
      waiters.push({ t, res });
      setTimeout(() => rej(new Error('timeout waiting for ' + t)), ms);
    });
    ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', token, v: 2 })); resolve({ ws, next }); });
  });
}

async function player(i: number, stats: { welcome: number[]; matched: number[]; snaps: number; acked: number }, guestMs: number[], partner: boolean) {
  const { token, ms } = await guest(i);
  guestMs.push(ms);
  const t0 = Date.now();
  const c = await connect(token, stats);
  await c.next('welcome');
  stats.welcome.push(Date.now() - t0);
  const q0 = Date.now();
  c.ws.send(JSON.stringify({ t: 'queue', mode: 'casual', format: '1v1', fighter: 'blaze', skin: 0 }));
  const m = await c.next('match', 60000);
  stats.matched.push(Date.now() - q0);
  for (let s = 1; s <= SECS * 30; s++) {
    c.ws.send(JSON.stringify({ t: 'in', s, b: [s % 7 === 0 ? 2 : 0] }));
    await sleep(33);
  }
  if (partner) c.ws.send(JSON.stringify({ t: 'forfeit' }));
  await c.next('end', 60000);
  c.ws.close();
  return m.matchId;
}

async function main() {
  console.log(`load test → ${BASE} · ${PLAYERS} players · ${SECS}s matches`);
  const stats = { welcome: [] as number[], matched: [] as number[], snaps: 0, acked: 0 };
  const guestMs: number[] = [];
  const t0 = Date.now();
  const jobs: Promise<unknown>[] = [];
  for (let i = 0; i < PLAYERS; i++) {
    // stagger joins a little so the server sees a ramp, not one spike
    jobs.push(sleep(i * 40).then(() => player(i, stats, guestMs, i % 2 === 1)).catch((e) => { errors.push(String(e.message ?? e)); }));
  }
  await Promise.all(jobs);
  const took = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`done in ${took}s`);
  console.log(`guest sign-in   p50 ${pct(guestMs, 50)}  p95 ${pct(guestMs, 95)}`);
  console.log(`welcome (ws)    p50 ${pct(stats.welcome, 50)}  p95 ${pct(stats.welcome, 95)}`);
  console.log(`queue → match  p50 ${pct(stats.matched, 50)}  p95 ${pct(stats.matched, 95)}  (${stats.matched.length}/${PLAYERS} matched)`);
  console.log(`snapshots       ${stats.snaps}  · acked inputs ${stats.acked}`);
  console.log(`errors          ${errors.length}`);
  for (const e of [...new Set(errors)].slice(0, 20)) console.log('  -', e);
  process.exit(errors.length ? 1 : 0);
}

main();
