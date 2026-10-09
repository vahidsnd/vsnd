import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { decodeReplay, simulateReplay, placements } from '@nb/shared';

// Replays, spectators, remote config, analytics and the admin API against a real server process.
const PORT = 19000 + Math.floor(Math.random() * 1000);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-pro-'));
const srv = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
  env: { ...process.env, DATABASE_URL: '', PORT: String(PORT), DATA_DIR: dataDir, UNLOCK_ALL: '1', ADMIN_KEY: 'pro-admin', SPECTATE_DELAY_MS: '400' }, stdio: 'pipe',
});
after(async () => {
  // the server saves its data on SIGTERM; wait for it to exit before deleting the folder
  await new Promise<void>((res) => { if (srv.exitCode !== null) return res(); srv.once('exit', () => res()); srv.kill(); setTimeout(res, 3000); });
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const base = `http://localhost:${PORT}`;
async function waitUp() {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/health')).ok) return; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 200)); }
  throw new Error('server did not start');
}
async function api(method: string, p: string, token = '', body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: (await r.json()) as any };
}
const admin = (method: string, p: string, body?: unknown, key = 'pro-admin') => api(method, p, '', body, { 'x-admin-key': key });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function client(token: string) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const msgs: any[] = [];
  const waiters: { t: string; res: (m: any) => void }[] = [];
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    msgs.push(m);
    for (const w of [...waiters]) if (w.t === m.t) { waiters.splice(waiters.indexOf(w), 1); m._seen = true; w.res(m); break; }
  });
  const next = (t: string, ms = 20000) => new Promise<any>((res, rej) => {
    const found = msgs.find((m) => m.t === t && !m._seen);
    if (found) { found._seen = true; return res(found); }
    waiters.push({ t, res });
    setTimeout(() => rej(new Error('timeout waiting for ' + t)), ms);
  });
  const open = new Promise<void>((r) => ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', token, v: 2 })); r(); }));
  return { ws, msgs, next, open, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

test('admin endpoints reject requests without the key', async () => {
  await waitUp();
  for (const [m, p] of [['GET', '/api/admin/stats'], ['POST', '/api/admin/config'], ['POST', '/api/admin/mail'], ['POST', '/api/admin/promo/toggle']] as const) {
    assert.equal((await api(m, p, '', m === 'POST' ? {} : undefined)).status, 403, `${m} ${p} without key`);
    assert.equal((await admin(m, p, m === 'POST' ? {} : undefined, 'wrong')).status, 403, `${m} ${p} wrong key`);
  }
  const ok = await admin('GET', '/api/admin/stats');
  assert.equal(ok.status, 200);
  assert.equal(ok.json.storage, 'json');
  assert.equal(ok.json.series.length, 30);
  assert.ok('d1' in ok.json.retention);
  // the panel page itself is served (login happens in the page)
  const page = await fetch(base + '/admin');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<html/i);
});

test('remote config: admin edits are validated, merged and served to clients', async () => {
  await waitUp();
  const r = await admin('POST', '/api/admin/config', { overrides: { economy: { matchCoinMult: 2.5, cratePriceMult: 99 }, flags: { replays: true }, motd: { fa: 'سلام', en: 'Hello', kind: 'event' }, bogus: 1 } });
  assert.equal(r.status, 200);
  assert.equal(r.json.config.economy.cratePriceMult, 10, 'clamped');
  assert.ok(r.json.errors.includes('bogus: unknown'));
  const c = await api('GET', '/api/config');
  assert.equal(c.json.config.economy.matchCoinMult, 2.5);
  assert.equal(c.json.config.motd.en, 'Hello');
  assert.ok(c.json.config.version > 0);
  await admin('POST', '/api/admin/config', { overrides: {} });
  assert.equal((await api('GET', '/api/config')).json.config.economy.matchCoinMult, 1);
});

test('analytics: batched events are aggregated per day without ids', async () => {
  await waitUp();
  const g = await api('POST', '/api/guest', '', { name: 'Counted' });
  await api('GET', '/api/profile', g.json.token);
  const r = await api('POST', '/api/analytics', '', { events: [{ n: 'screen', d: 'home' }, { n: 'screen', d: 'home' }, { n: 'match_end', d: 'cpu' }, { n: 'evil', d: 'x' }, { n: 'screen', d: 'u_123@mail.com' }] });
  assert.equal(r.json.ok, 4);
  const s = await admin('GET', '/api/admin/stats');
  assert.equal(s.json.events['screen:home'], 2);
  assert.equal(s.json.events['match_end:cpu'], 1);
  assert.equal(s.json.events.evil, undefined);
  assert.ok(!JSON.stringify(s.json.events).includes('@'), 'dimension is sanitised');
  assert.ok(s.json.series.at(-1).installs >= 1, 'installs counted');
  assert.ok(s.json.series.at(-1).dau >= 1, 'DAU counted');
});

test('online match: spectator gets delayed snapshots; the end replay replays to the same winner', async () => {
  await waitUp();
  const [a, b, c] = await Promise.all([api('POST', '/api/guest', '', { name: 'Ana' }), api('POST', '/api/guest', '', { name: 'Bob' }), api('POST', '/api/guest', '', { name: 'Cy' })]);
  const ca = client(a.json.token), cb = client(b.json.token), cc = client(c.json.token);
  await Promise.all([ca.open, cb.open, cc.open]);
  await Promise.all([ca.next('welcome'), cb.next('welcome'), cc.next('welcome')]);
  ca.send({ t: 'queue', mode: 'casual', format: '1v1', fighter: 'blaze', skin: 0 });
  cb.send({ t: 'queue', mode: 'casual', format: '1v1', fighter: 'kira', skin: 1 });
  const [ma] = await Promise.all([ca.next('match'), cb.next('match')]);

  // the live list and the friends lookup see the match
  const live = await api('GET', '/api/live', c.json.token);
  assert.ok(live.json.matches.some((m: any) => m.id === ma.matchId), 'match listed as live');
  const find = await api('POST', '/api/live/find', c.json.token, { uids: [a.json.profile.id, 'u_nobody'] });
  assert.equal(find.json.matches[a.json.profile.id], ma.matchId);
  // players cannot spectate their own match
  ca.send({ t: 'spectate', matchId: ma.matchId });
  assert.equal((await ca.next('error')).msg, 'spectate-denied');
  cc.send({ t: 'spectate', matchId: 'nope' });
  assert.equal((await cc.next('error')).msg, 'match-not-found');

  cc.send({ t: 'spectate', matchId: ma.matchId });
  const spec = await cc.next('spec');
  assert.equal(spec.matchId, ma.matchId);
  assert.equal(spec.cfg.players.length, 2);
  assert.equal(spec.delayMs, 400);
  const tSpec = Date.now();

  // play a little: A walks right and attacks
  for (let s = 1; s <= 90; s++) { ca.send({ t: 'in', s, b: [s % 20 < 10 ? 8 : 16] }); await sleep(16); }
  const snap = await cc.next('snap', 5000);
  assert.ok(Date.now() - tSpec >= 350, 'spectator feed is delayed');
  assert.equal(snap.ack, 0, 'spectators get no input acks');
  assert.ok(Array.isArray(snap.d) && snap.d.length === 2);

  cb.send({ t: 'forfeit' });
  const [ea, eb] = await Promise.all([ca.next('end', 15000), cb.next('end', 15000)]);
  assert.equal(ea.info.winnerTeam, ma.slot);
  assert.ok(typeof ea.info.replay === 'string' && ea.info.replay.startsWith('NBR1.'));
  assert.equal(ea.info.replay, eb.info.replay);

  // the server's input log replays to the same result
  const data = decodeReplay(ea.info.replay);
  assert.equal(data.meta.online, true);
  assert.equal(data.marks.length, 1, 'forfeit mark recorded');
  const end = simulateReplay(data);
  assert.equal(end.winnerTeam, ea.info.winnerTeam);
  assert.deepEqual(placements(end), ea.info.placements);

  const se = await cc.next('spec_end', 5000);
  assert.equal(se.winnerTeam, ea.info.winnerTeam);

  // per-player list + fetching the code by id
  await sleep(200);
  const list = await api('GET', '/api/replays', a.json.token);
  assert.equal(list.json.replays[0].id, data.meta.id);
  assert.equal(list.json.replays[0].slot, ma.slot);
  const got = await api('POST', '/api/replay/get', b.json.token, { id: data.meta.id });
  assert.equal(got.json.code, ea.info.replay);
  assert.equal((await api('POST', '/api/replay/get', b.json.token, { id: 'missing' })).status, 404);
  assert.equal((await api('GET', '/api/replays')).status, 401);
  const st = await admin('GET', '/api/admin/stats');
  assert.ok(st.json.live.users >= 3);
  ca.ws.close(); cb.ws.close(); cc.ws.close();
});

test('admin broadcast mail reaches every player', async () => {
  await waitUp();
  const g = await api('POST', '/api/guest', '', { name: 'Mailee' });
  const r = await admin('POST', '/api/admin/mail', { title: 'Patch notes', titleFa: 'یادداشت به‌روزرسانی', body: 'Hi', reward: { gems: 5 } });
  assert.equal(r.status, 200);
  assert.ok(r.json.recipients >= 1);
  const p = await api('GET', '/api/profile', g.json.token);
  assert.ok(p.json.profile.inbox.some((m: any) => m.title === 'Patch notes'));
});
