import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newProfile, newOtpState, otpRequest, otpVerify, normalizePhone, maskPhone, OTP, AccountError,
  newAccountsDb, playerCode, userByCode, issueTransfer, redeemTransfer, linkIdentity, normalizeCode, formatTransfer, TRANSFER_LEN,
  newFriendsDb, friendRequest, friendRespond, friendRemove, giftSend, giftCollect, friendsView, FRIENDS, FriendError, type FriendCtx,
  newReferralDb, referralRedeem, referralMilestones, referralEligible, REFERRAL, ReferralError, noteDevice, type ReferralCtx,
  newNotifDb, notifPush, notifRead, notifUnread, scanNotifs, newSocialDb, weekWindow, weekId, type Profile,
} from '../src/index.ts';

const code = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e) { return (e as AccountError | FriendError | ReferralError).code ?? String(e); } };

test('phone numbers are normalised (Persian digits, +98, 0098, 9xx…)', () => {
  assert.equal(normalizePhone('09121234567'), '09121234567');
  assert.equal(normalizePhone('+98 912 123 4567'), '09121234567');
  assert.equal(normalizePhone('00989121234567'), '09121234567');
  assert.equal(normalizePhone('۰۹۱۲۱۲۳۴۵۶۷'), '09121234567');
  assert.equal(normalizePhone('9121234567'), '09121234567');
  assert.equal(normalizePhone('+4915112345678'), '+4915112345678');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone('0812123456'), null);
  assert.equal(maskPhone('09121234567'), '0912***4567');
});

test('one-time codes: expiry, attempts, per-phone and per-IP limits', () => {
  const st = newOtpState();
  let t = 1_000_000;
  const r = otpRequest(st, '09120000001', '1.1.1.1', t, () => 0.5);
  assert.equal(r.code.length, OTP.length);
  assert.equal(code(() => otpRequest(st, '09120000001', '1.1.1.1', t + 1000)), 'cooldown');
  assert.equal(code(() => otpVerify(st, '09120000001', '00000', '1.1.1.1', t + 1)), 'wrong');
  assert.equal(code(() => otpVerify(st, '09120000001', r.code, '1.1.1.1', t + 2)), 'ok');
  assert.equal(code(() => otpVerify(st, '09120000001', r.code, '1.1.1.1', t + 3)), 'no-code', 'codes are single use');
  // expiry (2 minutes)
  t += 61_000;
  const r2 = otpRequest(st, '09120000001', '1.1.1.1', t);
  assert.equal(code(() => otpVerify(st, '09120000001', r2.code, '1.1.1.1', t + OTP.ttlMs + 1)), 'expired');
  // 5 wrong attempts burn the code
  t += 61_000;
  const r3 = otpRequest(st, '09120000001', '1.1.1.1', t);
  for (let i = 0; i < OTP.maxAttempts - 1; i++) assert.equal(code(() => otpVerify(st, '09120000001', 'x', '2.2.2.2', t)), 'wrong');
  assert.equal(code(() => otpVerify(st, '09120000001', 'x', '2.2.2.2', t)), 'attempts');
  assert.equal(code(() => otpVerify(st, '09120000001', r3.code, '2.2.2.2', t)), 'no-code');
  // per-phone hourly cap (5)
  t += 61_000; otpRequest(st, '09120000001', '1.1.1.1', t);
  t += 61_000; otpRequest(st, '09120000001', '1.1.1.1', t);
  t += 61_000;
  assert.equal(code(() => otpRequest(st, '09120000001', '1.1.1.1', t)), 'rate-phone');
  // per-IP hourly cap across many phones
  const st2 = newOtpState();
  for (let i = 0; i < OTP.perIpHour; i++) otpRequest(st2, `0912000010${i}`.slice(0, 11), '9.9.9.9', t);
  assert.equal(code(() => otpRequest(st2, '09129999999', '9.9.9.9', t)), 'rate-ip');
});

test('transfer codes: single use, regenerate invalidates, player codes and identity links', () => {
  const db = newAccountsDb();
  const c1 = issueTransfer(db, 'u1');
  assert.equal(c1.length, TRANSFER_LEN);
  const c2 = issueTransfer(db, 'u1');
  assert.equal(code(() => redeemTransfer(db, c1)), 'not-found', 'old code stops working');
  assert.equal(redeemTransfer(db, formatTransfer(c2).toLowerCase()), 'u1');
  assert.equal(code(() => redeemTransfer(db, c2)), 'not-found', 'a code works once');
  assert.ok(db.userTransfer.u1 && db.userTransfer.u1 !== c2, 'a fresh code was issued');
  const pc = playerCode(db, 'u1');
  assert.equal(playerCode(db, 'u1'), pc);
  assert.equal(userByCode(db, pc.toLowerCase()), 'u1');
  assert.equal(normalizeCode(' ab-cd '), 'ABCD');
  // phone linking: first link binds, another guest verifying the same phone switches to the owner
  assert.deepEqual(linkIdentity(db, 'phone', '0912', 'u1'), { uid: 'u1', switched: false, linked: true });
  assert.deepEqual(linkIdentity(db, 'phone', '0912', 'u2'), { uid: 'u1', switched: true, linked: false });
  assert.deepEqual(linkIdentity(db, 'phone', '0913', 'u1'), { uid: 'u1', switched: false, linked: true });
  assert.equal(db.phones['0912'], undefined, 're-linking replaces the old number');
});

test('friends: requests, accept, gifts once per friend per day, daily caps', () => {
  const ctx: FriendCtx = { db: newFriendsDb(), now: Date.UTC(2026, 5, 1, 12) };
  const A = { id: 'a', name: 'A' }, B = { id: 'b', name: 'B' };
  assert.equal(code(() => friendRequest(ctx, A, 'a')), 'self');
  assert.equal(friendRequest(ctx, A, 'b'), 'sent');
  assert.equal(code(() => friendRequest(ctx, A, 'b')), 'already-sent');
  assert.equal(code(() => giftSend(ctx, A, 'b')), 'not-friend');
  assert.equal(friendRespond(ctx, B, 'a', true), true);
  assert.equal(code(() => friendRequest(ctx, B, 'a')), 'already-friends');
  giftSend(ctx, A, 'b');
  assert.equal(code(() => giftSend(ctx, A, 'b')), 'already-gifted');
  giftSend(ctx, B, 'a'); // both ways
  const pb = newProfile('b', 'B'); const coins = pb.coins;
  assert.deepEqual(giftCollect(ctx, pb), { n: 1, coins: FRIENDS.giftCoins });
  assert.equal(pb.coins, coins + FRIENDS.giftCoins);
  // 20 sends a day max, 20 collects a day max
  for (let i = 0; i < 25; i++) { const f = { id: 'f' + i, name: 'F' + i }; friendRequest(ctx, f, 'b'); friendRespond(ctx, B, f.id, true); }
  for (let i = 0; i < FRIENDS.giftsPerDay - 1; i++) giftSend(ctx, B, 'f' + i);
  assert.equal(code(() => giftSend(ctx, B, 'f24')), 'gift-limit');
  for (let i = 0; i < 25; i++) giftSend(ctx, { id: 'f' + i, name: 'F' + i }, 'b');
  assert.equal(giftCollect(ctx, pb).n, FRIENDS.giftsPerDay - 1);
  assert.equal(giftCollect(ctx, pb).n, 0, 'cap reached today');
  ctx.now += 86400_000;
  assert.equal(giftCollect(ctx, pb).n, 6, 'the rest can be collected tomorrow');
  // view + remove
  const v = friendsView(ctx, 'b', (id) => ({ id, name: id, code: id, fighter: 'blaze', level: 1, mmr: 1000, online: id === 'a', seen: 0 }));
  assert.equal(v.friends.length, 26);
  assert.equal(v.friends[0].id, 'a', 'online friends first');
  friendRemove(ctx, B, 'a');
  assert.equal(code(() => giftSend(ctx, B, 'a')), 'not-friend');
  // decline
  friendRequest(ctx, { id: 'z', name: 'Z' }, 'a');
  assert.equal(friendRespond(ctx, A, 'z', false), false);
  assert.equal(code(() => friendRespond(ctx, A, 'z', true)), 'no-request');
});

test('referral: rewards both, milestones, self / device / IP / window / cap rules', () => {
  const now = Date.UTC(2026, 5, 1);
  const profiles: Record<string, Profile> = {};
  const mk = (id: string, created = now) => (profiles[id] = newProfile(id, id.toUpperCase(), created));
  const ctx: ReferralCtx = { db: newReferralDb(), now, profileOf: (id) => profiles[id] ?? null };
  const R = mk('ref'), N = mk('new');
  noteDevice(ctx.db, 'ref', 'dev-ref');
  assert.equal(code(() => referralRedeem(ctx, R, 'ref')), 'self');
  assert.equal(code(() => referralRedeem(ctx, N, 'ref', { device: 'dev-ref' })), 'same-device');
  const coins = N.coins, mails = R.inbox.length;
  const r = referralRedeem(ctx, N, 'ref', { device: 'dev-new', ip: '5.5.5.5' });
  assert.equal(r.counted, true);
  assert.equal(N.coins, coins + (REFERRAL.newReward.coins ?? 0));
  assert.equal(R.inbox.length, mails + 1, 'referrer gets a mail with the reward');
  assert.equal(code(() => referralRedeem(ctx, N, 'ref')), 'already');
  // a second account on the same device can't redeem again
  const N2 = mk('new2');
  assert.equal(code(() => referralRedeem(ctx, N2, 'ref', { device: 'dev-new' })), 'device-used');
  // level / time window
  const old = mk('old', now - REFERRAL.windowMs - 1);
  assert.equal(referralEligible(old, ctx.db, now).reason, 'too-late');
  const hi = mk('hi'); hi.level = 5;
  assert.equal(code(() => referralRedeem(ctx, hi, 'ref')), 'level');
  // IP limit per day
  for (let i = 0; i < REFERRAL.perIpPerDay - 1; i++) referralRedeem(ctx, mk('ip' + i), 'ref', { ip: '5.5.5.5' });
  assert.equal(code(() => referralRedeem(ctx, mk('ipx'), 'ref', { ip: '5.5.5.5' })), 'rate-ip');
  // milestones once each
  const before = R.inbox.length;
  N.level = 6;
  assert.equal(referralMilestones(ctx, 'ref', (id) => profiles[id]?.level ?? null).length, 1);
  N.level = 11;
  assert.equal(referralMilestones(ctx, 'ref', (id) => profiles[id]?.level ?? null).length, 1);
  assert.equal(referralMilestones(ctx, 'ref', (id) => profiles[id]?.level ?? null).length, 0);
  assert.equal(R.inbox.length, before + 2);
  // cap: only the first 50 referred players are counted
  const ctx2: ReferralCtx = { db: newReferralDb(), now, profileOf: (id) => profiles[id] ?? null };
  for (let i = 0; i < REFERRAL.maxCounted; i++) assert.equal(referralRedeem(ctx2, mk('c' + i), 'ref').counted, true);
  assert.equal(referralRedeem(ctx2, mk('c-over'), 'ref').counted, false);
});

test('notifications: dedupe, read state, time-based scan', () => {
  const db = newNotifDb();
  const n = notifPush(db, 'u', { kind: 'system', title: 'a', titleFa: 'a', body: '', bodyFa: '', key: 'k' }, 1);
  assert.ok(n);
  assert.equal(notifPush(db, 'u', { kind: 'system', title: 'a', titleFa: 'a', body: '', bodyFa: '', key: 'k' }, 2), null);
  assert.equal(notifUnread(db, 'u'), 1);
  assert.equal(notifRead(db, 'u', 'all'), 1);
  assert.equal(notifUnread(db, 'u'), 0);

  // league ends in under an hour → one reminder for players who raced this week
  const wk = weekId(Date.UTC(2026, 5, 3));
  const end = weekWindow(wk).end;
  const p = newProfile('p1', 'P', end - 86400_000 * 3);
  p.lweek = { id: wk, pts: 6, w: 2, l: 0, tier: 0, t: end - 5000_000 };
  const idle = newProfile('p2', 'Q');
  const social = newSocialDb();
  let made = scanNotifs({ db, now: end - 30 * 60_000, social, profiles: [p, idle] });
  assert.deepEqual(made.map((x) => [x.uid, x.notif.kind]), [['p1', 'league-ending']]);
  assert.equal(scanNotifs({ db, now: end - 20 * 60_000, social, profiles: [p, idle] }).length, 0, 'deduplicated');
  // free crate: only once the cooldown elapsed after opening one
  p.daily.crateAt = end - 10 * 60_000;
  made = scanNotifs({ db, now: end - 5 * 60_000, social, profiles: [p] });
  assert.deepEqual(made.map((x) => x.notif.kind), ['free-crate']);
  // raid declared on the clan → defenders notified; 10 minutes before start → both sides
  social.clans.d = { id: 'd', members: [{ id: 'p1' }] } as any;
  social.clans.a = { id: 'a', members: [{ id: 'p2' }] } as any;
  social.raids = { r1: { id: 'r1', att: 'a', def: 'd', attTag: 'ATK', attName: 'Attackers', defTag: 'DEF', status: 'declared', start: end + 3600_000 } as any };
  made = scanNotifs({ db, now: end, social, profiles: [p, idle] });
  assert.deepEqual(made.map((x) => [x.uid, x.notif.kind]), [['p1', 'raid-declared']]);
  made = scanNotifs({ db, now: end + 3600_000 - 5 * 60_000, social, profiles: [p, idle] });
  assert.deepEqual(made.map((x) => [x.uid, x.notif.kind]).sort(), [['p1', 'raid-soon'], ['p2', 'raid-soon']]);
  // clan war ended
  social.clans.d.warLog = [{ t: end, vsName: 'X', vsTag: 'X', our: 10, their: 3, won: true }];
  made = scanNotifs({ db, now: end + 60_000, social, profiles: [p] });
  assert.ok(made.some((x) => x.notif.kind === 'clan-war-ended'));
});
