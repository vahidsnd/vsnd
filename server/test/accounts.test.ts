import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

// End-to-end: accounts (phone OTP with the mock SMS provider, transfer codes), friends,
// referrals and the notification center (tick + websocket delivery).

const PORT = 19000 + Math.floor(Math.random() * 1000);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-acc-'));
const env: Record<string, string | undefined> = { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, UNLOCK_ALL: '1', ADMIN_KEY: 'test-admin', NOTIFY_TICK_MS: '300', OTP_RESEND_MS: '0', NODE_ENV: 'test' };
delete env.KAVENEGAR_API_KEY; delete env.FCM_SERVICE_ACCOUNT; delete env.GPG_CLIENT_ID;
const srv = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], { env, stdio: 'pipe' });
let log = '';
srv.stdout.on('data', (d) => { log += d; });
after(() => srv.kill());

const base = `http://localhost:${PORT}`;
async function waitUp() {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/health')).ok) return; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 200)); }
  throw new Error('server did not start');
}
async function api(method: string, p: string, token = '', body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: (await r.json()) as any };
}
const guest = async (name: string) => (await api('POST', '/api/guest', '', { name })).json as { token: string; profile: any };
function client(token: string) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const msgs: any[] = [];
  ws.on('message', (d) => msgs.push(JSON.parse(String(d))));
  const until = async (pred: (m: any) => boolean, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const m = msgs.find(pred); if (m) return m; await new Promise((r) => setTimeout(r, 50)); }
    throw new Error('timeout; got ' + JSON.stringify(msgs.map((m) => m.t + ':' + (m.notif?.kind ?? m.kind ?? ''))));
  };
  const open = new Promise<void>((r) => ws.on('open', () => { ws.send(JSON.stringify({ t: 'hello', token, v: 2 })); r(); }));
  return { ws, msgs, until, ready: open.then(() => until((m) => m.t === 'welcome')) };
}

test('phone login with one-time code (mock SMS) and account transfer codes', async () => {
  await waitUp();
  const A = await guest('Alpha');
  const req = await api('POST', '/api/auth/otp/request', A.token, { phone: '+98 912 000 0001' });
  assert.equal(req.status, 200, JSON.stringify(req.json));
  assert.equal(req.json.devCode?.length, 5, 'mock provider echoes the code outside production');
  assert.ok(log.includes(req.json.devCode), 'mock provider logs the code');
  assert.equal((await api('POST', '/api/auth/otp/request', A.token, { phone: '123' })).json.error, 'bad-phone');
  const wrong = await api('POST', '/api/auth/otp/verify', A.token, { phone: '09120000001', code: req.json.devCode === '11111' ? '22222' : '11111' });
  assert.equal(wrong.status, 400); assert.equal(wrong.json.error, 'wrong');
  const ok = await api('POST', '/api/auth/otp/verify', A.token, { phone: '09120000001', code: req.json.devCode });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.linked, true); assert.equal(ok.json.switched, false);
  assert.equal(ok.json.profile.id, A.profile.id);
  assert.equal((await api('POST', '/api/auth/otp/verify', A.token, { phone: '09120000001', code: req.json.devCode })).json.error, 'no-code', 'single use');
  const acc = await api('GET', '/api/account', A.token);
  assert.equal(acc.json.phone, '0912***0001');
  // a second guest (new device) logs in with the same phone → moves to the same account
  const B = await guest('Beta');
  const r2 = await api('POST', '/api/auth/otp/request', B.token, { phone: '09120000001' });
  const v2 = await api('POST', '/api/auth/otp/verify', B.token, { phone: '09120000001', code: r2.json.devCode });
  assert.equal(v2.json.switched, true);
  assert.equal(v2.json.token, A.token);
  assert.equal(v2.json.profile.id, A.profile.id);
  assert.equal(v2.json.profile.name, 'Alpha');
  // five wrong guesses burn the code
  const r3 = await api('POST', '/api/auth/otp/request', B.token, { phone: '09120000002' });
  for (let i = 0; i < 4; i++) assert.equal((await api('POST', '/api/auth/otp/verify', B.token, { phone: '09120000002', code: 'x' })).json.error, 'wrong');
  assert.equal((await api('POST', '/api/auth/otp/verify', B.token, { phone: '09120000002', code: 'x' })).json.error, 'attempts');
  assert.equal((await api('POST', '/api/auth/otp/verify', B.token, { phone: '09120000002', code: r3.json.devCode })).json.error, 'no-code');

  // transfer code: restore on another device; regenerate invalidates; codes are single use
  const t1 = (await api('POST', '/api/account/transfer/new', A.token)).json.code;
  const t2 = (await api('POST', '/api/account/transfer/new', A.token)).json.code;
  assert.match(t2, /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const C = await guest('Gamma');
  assert.equal((await api('POST', '/api/auth/transfer', C.token, { code: t1 })).status, 400, 'old code invalid');
  const tr = await api('POST', '/api/auth/transfer', C.token, { code: t2.toLowerCase() });
  assert.equal(tr.status, 200);
  assert.equal(tr.json.token, A.token);
  assert.equal(tr.json.profile.id, A.profile.id);
  assert.equal((await api('POST', '/api/auth/transfer', '', { code: t2 })).json.error, 'not-found', 'used code is consumed');
  // Play Games without keys
  const g = await api('POST', '/api/auth/gpg', A.token, { serverAuthCode: 'abc' });
  assert.equal(g.status, 501); assert.equal(g.json.error, 'not-configured');
});

test('friends: request, accept, presence, gifts, room invite over the websocket', async () => {
  await waitUp();
  const A = await guest('Ann'), D = await guest('Dan');
  const ca = client(A.token), cd = client(D.token);
  await Promise.all([ca.ready, cd.ready]);
  const codeA = (await api('POST', '/api/me/hello', A.token, { device: 'dev-a' })).json.code;
  assert.equal(codeA.length, 8);
  assert.equal((await api('POST', '/api/friends/add', D.token, { code: 'NOPE2345' })).status, 404);
  const add = await api('POST', '/api/friends/add', D.token, { code: codeA.toLowerCase() });
  assert.equal(add.json.result, 'sent');
  const fr = await ca.until((m) => m.t === 'notif' && m.notif.kind === 'friend-request');
  assert.equal(fr.notif.data.from, D.profile.id);
  assert.equal((await api('POST', '/api/friends/add', D.token, { code: codeA })).json.error, 'already-sent');
  const acc = await api('POST', '/api/friends/respond', A.token, { uid: D.profile.id, accept: true });
  assert.equal(acc.json.friends.friends.length, 1);
  assert.equal(acc.json.friends.friends[0].online, true);
  await cd.until((m) => m.t === 'notif' && m.notif.kind === 'friend-accept');
  // gifts both ways, once per friend per day
  assert.equal((await api('POST', '/api/friends/gift', A.token, { uid: D.profile.id })).status, 200);
  assert.equal((await api('POST', '/api/friends/gift', A.token, { uid: D.profile.id })).json.error, 'already-gifted');
  await api('POST', '/api/friends/gift', D.token, { uid: A.profile.id });
  await ca.until((m) => m.t === 'notif' && m.notif.kind === 'friend-gift');
  const before = (await api('GET', '/api/profile', A.token)).json.profile.coins;
  const col = await api('POST', '/api/friends/collect', A.token);
  assert.equal(col.json.n, 1); assert.equal(col.json.profile.coins, before + 50);
  assert.equal((await api('POST', '/api/friends/collect', A.token)).json.n, 0);
  // invite to a private room
  assert.equal((await api('POST', '/api/friends/invite', A.token, { uid: D.profile.id, room: 'ab' })).json.error, 'bad-room');
  const inv = await api('POST', '/api/friends/invite', A.token, { uid: D.profile.id, room: 'QWERT' });
  assert.equal(inv.json.online, true);
  const n = await cd.until((m) => m.t === 'notif' && m.notif.kind === 'friend-invite');
  assert.equal(n.notif.data.room, 'QWERT');
  // presence: D goes offline → A's friend list shows it
  cd.ws.close();
  await new Promise((r) => setTimeout(r, 300));
  const list = await api('GET', '/api/friends', A.token);
  assert.equal(list.json.friends.friends[0].online, false);
  assert.ok(list.json.friends.friends[0].seen > 0);
  // remove
  await api('POST', '/api/friends/remove', A.token, { uid: D.profile.id });
  assert.equal((await api('POST', '/api/friends/gift', D.token, { uid: A.profile.id })).json.error, 'not-friend');
  ca.ws.close();
});

test('referral: rewards, abuse checks and level milestones paid by the tick', async () => {
  await waitUp();
  const R = await guest('Referrer');
  const cr = client(R.token); await cr.ready;
  const code = (await api('POST', '/api/me/hello', R.token, { device: 'dev-r' })).json.code;
  assert.equal((await api('POST', '/api/referral/redeem', R.token, { code })).json.error, 'self');
  const N = await guest('Newbie');
  assert.equal((await api('POST', '/api/referral/redeem', N.token, { code, device: 'dev-r' })).json.error, 'same-device');
  const coins = N.profile.coins;
  const red = await api('POST', '/api/referral/redeem', N.token, { code, device: 'dev-n' });
  assert.equal(red.status, 200, JSON.stringify(red.json));
  assert.equal(red.json.profile.coins, coins + 500);
  assert.equal((await api('POST', '/api/referral/redeem', N.token, { code })).json.error, 'already');
  const N2 = await guest('Twin');
  assert.equal((await api('POST', '/api/referral/redeem', N2.token, { code, device: 'dev-n' })).json.error, 'device-used');
  await cr.until((m) => m.t === 'notif' && m.notif.kind === 'referral');
  const view = await api('GET', '/api/referral', R.token);
  assert.equal(view.json.referral.counted, 1);
  assert.equal(view.json.referral.invited[0].name, 'Newbie');
  const prof = (await api('GET', '/api/profile', R.token)).json.profile;
  assert.ok(prof.inbox.some((m: any) => m.titleFa === 'جایزه دعوت' && m.reward?.coins === 300));
  // the referred player reaches level 5 → the periodic tick pays the referrer
  await fetch(base + '/api/admin/promo', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': 'test-admin' }, body: JSON.stringify({ code: 'XPBOOST', reward: { xp: 2500 } }) });
  const up = await api('POST', '/api/redeem', N.token, { code: 'XPBOOST' });
  assert.ok(up.json.profile.level >= 5, 'level ' + up.json.profile.level);
  const ms = await cr.until((m) => m.t === 'notif' && m.notif.kind === 'referral-milestone');
  assert.match(ms.notif.body, /level 5/);
  cr.ws.close();
});

test('notifications: tick creates reminders, delivered live; list and mark read', async () => {
  await waitUp();
  const A = await guest('Bell');
  const ca = client(A.token); await ca.ready;
  const crate = await api('POST', '/api/crate/free', A.token);
  assert.equal(crate.status, 200);
  const readyAt = crate.json.profile.daily.crateAt;
  // operator tick at a simulated time after the cooldown
  const noKey = await api('POST', '/api/admin/tick', '', { at: readyAt + 60_000 });
  assert.equal(noKey.status, 403);
  const tk = await api('POST', '/api/admin/tick', '', { at: readyAt + 60_000 }, { 'x-admin-key': 'test-admin' });
  assert.ok(tk.json.created >= 1);
  const n = await ca.until((m) => m.t === 'notif' && m.notif.kind === 'free-crate');
  assert.ok(n.unread >= 1);
  await api('POST', '/api/admin/tick', '', { at: readyAt + 120_000 }, { 'x-admin-key': 'test-admin' });
  const list = await api('GET', '/api/notifs', A.token);
  assert.equal(list.json.list.filter((x: any) => x.kind === 'free-crate').length, 1, 'deduplicated');
  assert.ok(list.json.unread >= 1);
  const rd = await api('POST', '/api/notifs/read', A.token, { ids: 'all' });
  assert.equal(rd.json.unread, 0);
  // push token registration (no provider configured → accepted, nothing sent)
  assert.equal((await api('POST', '/api/push/register', A.token, { token: 'x'.repeat(40) })).json.provider, 'none');
  ca.ws.close();
});
