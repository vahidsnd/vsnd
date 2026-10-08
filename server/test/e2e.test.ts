import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-'));
const srv = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir }, stdio: 'pipe' });
after(() => srv.kill());

const base = `http://localhost:${PORT}`;
async function waitUp() {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/health')).ok) return; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 200)); }
  throw new Error('server did not start');
}
async function api(method: string, p: string, token = '', body?: unknown) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: (await r.json()) as any };
}
function client(token: string) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const msgs: any[] = [];
  const waiters: { t: string; res: (m: any) => void }[] = [];
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    msgs.push(m);
    for (const w of [...waiters]) if (w.t === m.t) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  });
  const next = (t: string, ms = 20000) => new Promise<any>((res, rej) => {
    const found = msgs.find((m) => m.t === t && !m._seen);
    if (found) { found._seen = true; return res(found); }
    waiters.push({ t, res: (m) => { m._seen = true; res(m); } });
    setTimeout(() => rej(new Error('timeout waiting for ' + t)), ms);
  });
  const open = new Promise<void>((r) => ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', token, v: 1 })); r(); }));
  return { ws, msgs, next, open, send: (m: unknown) => ws.send(JSON.stringify(m)) };
}

test('guest profile, shop and sandbox IAP', async () => {
  await waitUp();
  const g = await api('POST', '/api/guest', '', { name: 'Tester' });
  assert.equal(g.status, 200);
  const tok = g.json.token;
  assert.equal(g.json.profile.name, 'Tester');
  const buy = await api('POST', '/api/shop/buy', tok, { itemId: 'fighter:pip:coins' });
  assert.equal(buy.json.result.ok, false);
  const iap = await api('POST', '/api/iap/verify', tok, { market: 'web', productId: 'gems_500', purchaseToken: 'sandbox-x1' });
  assert.equal(iap.json.ok, true);
  assert.equal(iap.json.profile.gems, 30 + 500);
  const dup = await api('POST', '/api/iap/verify', tok, { market: 'web', productId: 'gems_500', purchaseToken: 'sandbox-x1' });
  assert.equal(dup.json.duplicate, true);
  assert.equal(dup.json.profile.gems, 530);
  const bad = await api('POST', '/api/iap/verify', tok, { market: 'googleplay', productId: 'gems_500', purchaseToken: 'forged' });
  assert.equal(bad.status, 402);
  const unauth = await api('GET', '/api/profile', 'nope');
  assert.equal(unauth.status, 401);
});

test('two players get matched, play, one forfeits, both get results', async () => {
  await waitUp();
  const [a, b] = await Promise.all([api('POST', '/api/guest', '', { name: 'A' }), api('POST', '/api/guest', '', { name: 'B' })]);
  const ca = client(a.json.token), cb = client(b.json.token);
  await Promise.all([ca.open, cb.open]);
  await Promise.all([ca.next('welcome'), cb.next('welcome')]);
  ca.send({ t: 'queue', mode: 'ranked', format: '1v1', fighter: 'blaze', skin: 0 });
  cb.send({ t: 'queue', mode: 'ranked', format: '1v1', fighter: 'blaze', skin: 0 });
  const [ma, mb] = await Promise.all([ca.next('match'), cb.next('match')]);
  assert.equal(ma.matchId, mb.matchId);
  assert.notEqual(ma.slot, mb.slot);
  // send a few inputs, expect snapshots acking them
  for (let s = 1; s <= 30; s++) { ca.send({ t: 'in', s, b: [2] }); await new Promise((r) => setTimeout(r, 16)); }
  let snap: any;
  for (let i = 0; i < 40; i++) { snap = await ca.next('snap'); if (snap.ack > 0) break; }
  assert.ok(snap.ack > 0, 'server acknowledged inputs');
  cb.send({ t: 'forfeit' });
  const [ea, eb] = await Promise.all([ca.next('end', 15000), cb.next('end', 15000)]);
  assert.equal(ea.info.winnerTeam, ma.slot);
  assert.ok(ea.info.mmrDelta > 0 && eb.info.mmrDelta < 0);
  assert.ok(ea.info.reward.coins >= 0);
  ca.ws.close(); cb.ws.close();
});

test('private room with a bot starts a match', async () => {
  await waitUp();
  const a = await api('POST', '/api/guest', '', { name: 'Host' });
  const ca = client(a.json.token);
  await ca.open; await ca.next('welcome');
  ca.send({ t: 'room_create', fighter: 'blaze', skin: 0 });
  const r = await ca.next('room');
  assert.equal(r.room.code.length, 5);
  ca.send({ t: 'room_update', bots: 1, stocks: 1 });
  await ca.next('room');
  ca.send({ t: 'room_start' });
  const m = await ca.next('match');
  assert.equal(m.cfg.players.length, 2);
  assert.equal(m.cfg.stocks, 1);
  ca.ws.close();
});
