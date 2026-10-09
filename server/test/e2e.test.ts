import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-'));
const srv = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, UNLOCK_ALL: '1', ADMIN_KEY: 'test-admin', WAR_BOT_AFTER_MS: '0', TOURNEY_TEST: '1', EVENT_BOT_AFTER_MS: '300' }, stdio: 'pipe' });
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
  const open = new Promise<void>((r) => ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', token, v: 2 })); r(); }));
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

test('clans, roles, chat, war, police and promo codes', async () => {
  await waitUp();
  const L = await api('POST', '/api/guest', '', { name: 'Leader' });
  const M = await api('POST', '/api/guest', '', { name: 'Member' });
  const lt = L.json.token, mt = M.json.token;
  const lid = L.json.profile.id, mid = M.json.profile.id;
  await api('POST', '/api/iap/verify', lt, { productId: 'gems_500', purchaseToken: 'sandbox-clan-1', market: 'googleplay' });
  await api('POST', '/api/shop/buy', lt, { itemId: 'coins:1000' });
  const c = await api('POST', '/api/clan/create', lt, { name: 'Night Owls', tag: 'OWL', badge: 3, desc: 'hi', type: 'open', minMmr: 0 });
  assert.equal(c.status, 200, JSON.stringify(c.json));
  assert.equal(c.json.clan.members.length, 1);
  assert.equal(c.json.profile.clan.role, 'leader');
  const j = await api('POST', '/api/clan/join', mt, { id: c.json.clan.id });
  assert.equal(j.json.result, 'joined');
  // leader appoints a deputy; deputy cannot appoint another deputy
  const r = await api('POST', '/api/clan/role', lt, { uid: mid, role: 'co' });
  assert.equal(r.json.clan.members.find((m: any) => m.id === mid).role, 'co');
  // gems → clan level
  await api('POST', '/api/clan/donate', lt, { amount: 300 });
  const up = await api('POST', '/api/clan/upgrade', mt, {});
  assert.equal(up.json.clan.level, 2);
  // chat: clan + private, profanity filtered
  const cm = client(mt); await cm.open; await cm.next('welcome');
  const post = await api('POST', '/api/chat/post', lt, { ch: 'clan', text: 'hello fuck team' });
  assert.equal(post.status, 200);
  assert.ok(!post.json.msg.text.includes('fuck'));
  const pushed = await cm.next('chat');
  assert.equal(pushed.msg.uid, lid);
  await new Promise((res) => setTimeout(res, 2100));
  const dm = await api('POST', '/api/chat/post', lt, { ch: 'dm:' + mid, text: 'psst' });
  assert.equal(dm.status, 200);
  const hist = await api('POST', '/api/chat/history', mt, { ch: 'dm:' + lid });
  assert.equal(hist.json.msgs.at(-1).text, 'psst');
  // war vs computer rival
  const w = await api('POST', '/api/clan/war/search', lt, {});
  assert.equal(w.status, 200);
  // police: operator makes the leader an admin, admin creates a promo, member redeems it once
  const adm = await fetch(base + '/api/admin/staff', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': 'test-admin' }, body: JSON.stringify({ target: lid, role: 'admin' }) });
  assert.equal(adm.status, 200);
  const promo = await api('POST', '/api/police/promo', lt, { code: 'GIFT2026', reward: { gems: 50, fighters: ['volt'] }, maxUses: 10 });
  assert.equal(promo.status, 200, JSON.stringify(promo.json));
  const red = await api('POST', '/api/redeem', mt, { code: 'gift2026' });
  assert.equal(red.status, 200);
  assert.ok(red.json.profile.fighters.includes('volt'));
  assert.equal((await api('POST', '/api/redeem', mt, { code: 'GIFT2026' })).json.error, 'already');
  // report → police queue → mute
  await api('POST', '/api/report', mt, { target: lid, reason: 'abuse' });
  const pv = await api('GET', '/api/police', lt);
  assert.ok(pv.json.reports.length >= 1);
  const nonStaff = await api('GET', '/api/police', mt);
  assert.equal(nonStaff.status, 400);
  await api('POST', '/api/police/act', lt, { action: 'mute', target: mid, minutes: 5 });
  const muted = await api('POST', '/api/chat/post', mt, { ch: 'global', text: 'hi' });
  assert.equal(muted.json.error, 'muted');
  // leaderboards, weekly league, clan attack info
  for (const path of ['/api/leaderboard/wins', '/api/clan/leaderboard', '/api/alliance/leaderboard']) assert.equal((await api('GET', path, lt)).status, 200, path);
  const wk = await api('GET', '/api/league/week', lt);
  assert.equal(wk.status, 200); assert.ok(wk.json.week > 0);
  const rv = await api('GET', '/api/raid', lt);
  assert.equal(rv.status, 200); assert.equal(rv.json.raid.banners, 1);
  const tg = await api('POST', '/api/raid/targets', lt, {});
  assert.equal(tg.status, 200);
  // the request flood limiter answers 429 instead of serving forever
  let limited = false;
  for (let i = 0; i < 12 && !limited; i++) limited = (await api('POST', '/api/redeem', mt, { code: 'NOPE' + i })).status === 429;
  assert.ok(limited, 'redeem attempts are rate limited');
  cm.ws.close();
});

async function admin(p: string, body: unknown = {}) {
  const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': 'test-admin' }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as any };
}

test('event queue: the timed event rules, a bot fills in, the match counts for the event', async () => {
  await waitUp();
  const a = await api('POST', '/api/guest', '', { name: 'Evie' });
  const tok = a.json.token;
  const ev = await api('GET', '/api/event', tok);
  assert.equal(ev.status, 200);
  assert.ok(ev.json.event.def.id && ev.json.track.length >= 3);
  assert.equal(ev.json.progress.played, 0);
  const ca = client(tok);
  await ca.open; await ca.next('welcome');
  ca.send({ t: 'queue', mode: 'event', format: 'ffa', fighter: 'blaze', skin: 0 });
  const q = await ca.next('queued');
  assert.equal(q.mode, 'event');
  assert.equal(q.format, '1v1', 'the event queue is always 1v1');
  const m = await ca.next('match', 15000);
  assert.equal(m.mode, 'event');
  assert.ok(m.cfg.rules, 'event rules are sent with the match config');
  assert.ok(ev.json.event.def.stages.includes(m.cfg.stageId));
  assert.equal(m.cfg.players.length, 2);
  assert.ok(m.cfg.players.some((p: any) => p.bot));
  ca.send({ t: 'forfeit' });
  const e = await ca.next('end', 15000);
  assert.notEqual(e.info.winnerTeam, m.slot);
  const after = await api('GET', '/api/event', tok);
  assert.equal(after.json.progress.played, 1);
  assert.equal(after.json.progress.wins, 0);
  // nothing to claim yet
  const cl = await api('POST', '/api/event/claim', tok, { idx: 0 });
  assert.equal(cl.json.result, null);
  ca.ws.close();
});

test('private room with custom rules', async () => {
  await waitUp();
  const a = await api('POST', '/api/guest', '', { name: 'Rules' });
  const ca = client(a.json.token);
  await ca.open; await ca.next('welcome');
  ca.send({ t: 'room_create', fighter: 'blaze', skin: 0 });
  await ca.next('room');
  ca.send({ t: 'room_update', rules: 'nope', bots: 1 });
  assert.equal((await ca.next('room')).room.rules, undefined, 'unknown rule sets are ignored');
  ca.send({ t: 'room_update', rules: 'giant' });
  assert.equal((await ca.next('room')).room.rules, 'giant');
  ca.send({ t: 'room_start' });
  const m = await ca.next('match');
  assert.equal(m.cfg.rules.giant, true);
  assert.equal(m.cfg.rules.items, true);
  ca.ws.close();
});

test('tournament: sign-up, fee and refund, lock with bots, ready → real match, result in the bracket', async () => {
  await waitUp();
  const [a, b] = await Promise.all([api('POST', '/api/guest', '', { name: 'Cup A' }), api('POST', '/api/guest', '', { name: 'Cup B' })]);
  const ta = a.json.token, tb = b.json.token;
  for (const [t, id] of [[ta, 'ta1'], [tb, 'tb1']]) await api('POST', '/api/iap/verify', t, { market: 'web', productId: 'gems_500', purchaseToken: `sandbox-${id}` });
  const info = await api('GET', '/api/tourney', ta);
  assert.equal(info.json.phase, 'signup');
  assert.equal(info.json.bracket, null);
  const s1 = await api('POST', '/api/tourney/signup', ta, { tier: 'gems' });
  assert.equal(s1.status, 200);
  assert.equal(s1.json.profile.gems, 530 - 60, 'gem fee paid');
  assert.equal(s1.json.bracket.seats.length, 1);
  const again = await api('POST', '/api/tourney/signup', ta, { tier: 'gems' });
  assert.equal(again.status, 400);
  assert.equal(again.json.error, 'already');
  const s2 = await api('POST', '/api/tourney/signup', tb, { tier: 'gems' });
  assert.equal(s2.json.bracket.id, s1.json.bracket.id, 'second entrant joins the same bracket');
  assert.equal(s2.json.bracket.seats.length, 2);
  const lv = await api('POST', '/api/tourney/leave', tb);
  assert.equal(lv.json.profile.gems, 530 - 60 + 30, 'leaving refunds half the fee');
  // lock: bots fill the bracket, bot-vs-bot quarter-finals are simulated right away
  const st = await admin('/api/admin/tourney/start');
  assert.equal(st.status, 200);
  const live = (await api('GET', '/api/tourney', ta)).json;
  assert.equal(live.phase, 'live');
  assert.equal(live.bracket.status, 'live');
  assert.equal(live.bracket.seats.length, 8);
  assert.equal(live.bracket.seats.filter((x: any) => !x.bot).length, 1);
  assert.equal(live.bracket.rounds[0].filter((x: any) => x.status === 'done').length, 3, 'the three bot pairings are simulated');
  assert.ok(live.bracket.mine && live.bracket.mine.foe.bot);
  // ready → a real online tournament match against the bot
  const ca = client(ta);
  await ca.open; await ca.next('welcome');
  const rd = await api('POST', '/api/tourney/ready', ta);
  assert.equal(rd.json.started, true);
  const m = await ca.next('match');
  assert.equal(m.mode, 'tourney');
  assert.equal(m.cfg.stocks, 3);
  ca.send({ t: 'forfeit' });
  await ca.next('end', 15000);
  let done: any;
  for (let i = 0; i < 20; i++) {
    done = (await api('GET', '/api/tourney', ta)).json;
    if (done.bracket?.round >= 1 || done.bracket?.status === 'done' || done.last) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  const br = done.bracket ?? done.last;
  const myIdx = br.seats.findIndex((x: any) => !x.bot);
  const qf = br.rounds[0].find((x: any) => x.a === myIdx || x.b === myIdx);
  assert.equal(qf.status, 'done');
  assert.equal(qf.how, 'played');
  assert.notEqual(qf.winner, myIdx, 'forfeit loses the quarter-final');
  assert.ok(br.round >= 1, 'the round advanced');
  ca.ws.close();
});
