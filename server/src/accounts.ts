import fs from 'node:fs';
import path from 'node:path';
import type http from 'node:http';
import {
  AccountError, FriendError, ReferralError, featureUnlocked,
  newAccountsDb, newOtpState, normalizePhone, maskPhone, otpRequest, otpVerify, OTP, playerCode, userByCode, issueTransfer, redeemTransfer,
  linkIdentity, formatTransfer,
  newFriendsDb, friendRequest, friendRespond, friendRemove, friendCancel, giftSend, giftCollect, friendsView, areFriends, friendsOf, FRIENDS,
  newReferralDb, referralRedeem, referralMilestones, referralView, noteDevice,
  newNotifDb, notifPush, notifList, notifUnread, notifRead, scanNotifs, NOTIF_TEXT, notifText,
  type AccountsDb, type FriendsDb, type ReferralDb, type NotifDb, type Notif, type NotifInput, type PlayerBrief, type Profile,
} from '@nb/shared';
import { config } from './config.ts';
import { allProfiles, createGuest, markDirty, socialDb, userById, type UserRec } from './db.ts';
import { isOnline, sendTo } from './sockets.ts';
import { HttpError, need } from './social.ts';
import { echoOtp, gpgConfigured, pushProvider, smsProvider, verifyPlayGames } from './providers.ts';

// =====================================================================================
//  Accounts & recovery (phone OTP, transfer codes, Play Games), friends, referrals and the
//  notification center. Rules live in @nb/shared; this module persists their state in its own
//  file (DATA_DIR/accounts.json), exposes the HTTP routes and runs the reminder tick.
// =====================================================================================

interface Store { accounts: AccountsDb; friends: FriendsDb; referral: ReferralDb; notifs: NotifDb; push: Record<string, string[]> }
const file = () => path.join(config.dataDir, 'accounts.json');
let st: Store | null = null;
let dirty = false;
const otp = newOtpState();
// test/staging override of the one-SMS-per-minute rule
if (process.env.OTP_RESEND_MS !== undefined) OTP.resendMs = Math.max(0, Number(process.env.OTP_RESEND_MS) || 0);

function store(): Store {
  if (st) return st;
  let raw: Partial<Store> = {};
  try { if (fs.existsSync(file())) raw = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch (e) { console.error('[accounts] could not read', file(), (e as Error).message); }
  st = {
    accounts: { ...newAccountsDb(), ...raw.accounts }, friends: { ...newFriendsDb(), ...raw.friends },
    referral: { ...newReferralDb(), ...raw.referral }, notifs: { ...newNotifDb(), ...raw.notifs }, push: raw.push ?? {},
  };
  setInterval(flushAccounts, 5000).unref();
  process.on('exit', flushAccounts);
  return st;
}
const touch = () => { dirty = true; };
export function flushAccounts() {
  if (!dirty || !st) return;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(st));
  fs.renameSync(tmp, file());
  dirty = false;
}

/** Runs a rule and maps its error code to HTTP 400. */
function rule<T>(fn: () => T): T {
  try { const r = fn(); touch(); return r; } catch (e) {
    if (e instanceof AccountError || e instanceof FriendError || e instanceof ReferralError) throw new HttpError(400, e.code);
    throw e;
  }
}
function clientIp(req?: http.IncomingMessage) {
  const fwd = process.env.TRUST_PROXY === '1' ? String(req?.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
  return fwd || req?.socket?.remoteAddress || '?';
}
const gate = (p: Profile) => { if (!config.unlockAll && !featureUnlocked(p, 'friends')) throw new HttpError(403, 'locked'); };

// ---- notifications --------------------------------------------------------------------------------------
function deliver(uid: string, n: Notif) {
  const s = store();
  sendTo(uid, { t: 'notif', notif: n, unread: notifUnread(s.notifs, uid) });
  // the websocket covers players in the game; push reaches the others
  const tokens = s.push[uid];
  if (!isOnline(uid) && tokens?.length) {
    const fa = (userById(uid)?.profile.settings.lang ?? 'fa') === 'fa';
    const txt = notifText(n, fa);
    const data: Record<string, string> = { kind: n.kind, id: n.id };
    for (const [k, v] of Object.entries(n.data ?? {})) data[k] = String(v);
    void pushProvider().send(tokens, { title: txt.title, body: txt.body, data }).then((r) => {
      if (r.invalid.length) { s.push[uid] = (s.push[uid] ?? []).filter((t) => !r.invalid.includes(t)); touch(); }
    }).catch(() => {});
  }
}
/** Stores a notification for a user and delivers it live (websocket) or by push. */
export function notify(uid: string, input: NotifInput, now = Date.now()) {
  const n = notifPush(store().notifs, uid, input, now);
  if (!n) return null;
  touch();
  deliver(uid, n);
  return n;
}

/** Periodic reminders + referral milestones. `now` can be overridden (operator/test route). */
export function accountsTick(now = Date.now()) {
  const s = store();
  const profiles = allProfiles();
  const made = scanNotifs({ db: s.notifs, now, social: socialDb(), profiles });
  for (const m of made) deliver(m.uid, m.notif);
  if (made.length) touch();
  // referral milestones: referred players reaching level 5 / 10 pay their referrer
  let paid = 0;
  for (const referrer of Object.keys(s.referral.refs)) {
    const ms = referralMilestones({ db: s.referral, now, profileOf: (id) => userById(id)?.profile ?? null }, referrer, (id) => userById(id)?.profile.level ?? null);
    for (const m of ms) {
      paid++;
      notify(referrer, { kind: 'referral-milestone', ...NOTIF_TEXT.referralMilestone(m.name, m.level), key: `rm:${m.uid}:${m.level}` }, now);
    }
    if (ms.length) { const r = userById(referrer); if (r) sendTo(referrer, { t: 'profile', profile: r.profile }); }
  }
  if (paid) { markDirty(); touch(); }
  return made.length + paid;
}

// ---- presence ---------------------------------------------------------------------------------------------
function friendsChanged(uid: string) { for (const f of friendsOf(store().friends, uid)) sendTo(f, { t: 'social', kind: 'friends' }); }
export function presenceOnline(uid: string) { const s = store(); s.friends.seen[uid] = Date.now(); touch(); friendsChanged(uid); }
export function presenceOffline(uid: string) { const s = store(); s.friends.seen[uid] = Date.now(); touch(); friendsChanged(uid); }

// ---- helpers ------------------------------------------------------------------------------------------
function brief(uid: string): PlayerBrief | null {
  const u = userById(uid);
  if (!u) return null;
  const p = u.profile, s = store();
  return { id: p.id, name: p.name, code: playerCode(s.accounts, p.id), fighter: p.selFighter, level: p.level, mmr: p.rank.mmr, online: isOnline(p.id), seen: s.friends.seen[p.id] ?? p.createdAt };
}
const fctx = () => ({ db: store().friends, now: Date.now() });
const friendsOut = (u: UserRec) => ({ friends: friendsView(fctx(), u.profile.id, brief), code: playerCode(store().accounts, u.profile.id) });
/** Logs the caller in to another account (phone / transfer code / Play Games owner). */
function session(rec: UserRec, extra: object = {}) { return { token: rec.token, profile: rec.profile, ...extra }; }

type Handler = (body: any, user: UserRec | null, req?: http.IncomingMessage) => Promise<unknown> | unknown;

export const accountRoutes: Record<string, Handler> = {
  // ---- session bootstrap: device id + player code + unread count ----
  'POST /api/me/hello': (b, u) => {
    const r = need(u); const s = store();
    noteDevice(s.referral, r.profile.id, typeof b.device === 'string' ? b.device : undefined);
    s.friends.seen[r.profile.id] = Date.now();
    touch();
    return { code: playerCode(s.accounts, r.profile.id), unread: notifUnread(s.notifs, r.profile.id) };
  },

  // ---- account ----
  'GET /api/account': (_b, u) => {
    const r = need(u); const s = store(); const id = r.profile.id;
    const phone = s.accounts.userPhone[id];
    const tr = s.accounts.userTransfer[id];
    return { code: playerCode(s.accounts, id), phone: phone ? maskPhone(phone) : null, transfer: tr ? formatTransfer(tr) : null, gpg: !!s.accounts.userGpg[id], gpgConfigured: gpgConfigured(), sms: smsProvider().name };
  },
  'POST /api/auth/otp/request': async (b, _u, req) => {
    const phone = normalizePhone(b.phone);
    if (!phone) throw new HttpError(400, 'bad-phone');
    const r = rule(() => otpRequest(otp, phone, clientIp(req), Date.now()));
    const sent = await smsProvider().sendOtp(phone, r.code);
    if (!sent.ok) { delete otp.codes[phone]; throw new HttpError(502, sent.error ?? 'sms-failed'); }
    return { ok: true, phone: maskPhone(phone), ttl: OTP.ttlMs, retryIn: r.retryIn, ...(echoOtp() ? { devCode: r.code } : {}) };
  },
  'POST /api/auth/otp/verify': (b, u, req) => {
    const phone = normalizePhone(b.phone);
    if (!phone) throw new HttpError(400, 'bad-phone');
    rule(() => otpVerify(otp, phone, String(b.code ?? ''), clientIp(req), Date.now()));
    const s = store();
    const owner = s.accounts.phones[phone];
    const me = u ?? (owner ? null : createGuest());
    const res = rule(() => linkIdentity(s.accounts, 'phone', phone, me?.profile.id ?? null));
    const rec = userById(res.uid);
    if (!rec) throw new HttpError(404, 'not-found');
    return session(rec, { switched: res.switched, linked: res.linked, phone: maskPhone(phone) });
  },
  'POST /api/account/transfer/new': (_b, u) => {
    const r = need(u);
    return { code: formatTransfer(rule(() => issueTransfer(store().accounts, r.profile.id))) };
  },
  'POST /api/auth/transfer': (b) => {
    const uid = rule(() => redeemTransfer(store().accounts, String(b.code ?? '')));
    const rec = userById(uid);
    if (!rec) throw new HttpError(404, 'not-found');
    return session(rec, { switched: true });
  },
  'POST /api/auth/gpg': async (b, u) => {
    const v = await verifyPlayGames(String(b.serverAuthCode ?? ''));
    if (!v.ok) throw new HttpError(v.reason === 'not-configured' ? 501 : 401, v.reason ?? 'gpg-failed');
    const s = store();
    const me = u ?? (s.accounts.gpg[v.playerId!] ? null : createGuest(v.name));
    const res = rule(() => linkIdentity(s.accounts, 'gpg', v.playerId!, me?.profile.id ?? null));
    const rec = userById(res.uid);
    if (!rec) throw new HttpError(404, 'not-found');
    return session(rec, { switched: res.switched, linked: res.linked });
  },

  // ---- push device tokens ----
  'POST /api/push/register': (b, u) => {
    const r = need(u);
    const tok = String(b.token ?? '').slice(0, 512);
    if (tok.length < 20) throw new HttpError(400, 'bad-token');
    const list = (store().push[r.profile.id] ??= []);
    if (!list.includes(tok)) { list.push(tok); if (list.length > 5) list.shift(); touch(); }
    return { ok: true, provider: pushProvider().name };
  },

  // ---- notifications ----
  'GET /api/notifs': (_b, u) => { const r = need(u); const s = store(); return { list: notifList(s.notifs, r.profile.id), unread: notifUnread(s.notifs, r.profile.id) }; },
  'POST /api/notifs/read': (b, u) => {
    const r = need(u); const s = store();
    notifRead(s.notifs, r.profile.id, b.ids === 'all' ? 'all' : Array.isArray(b.ids) ? b.ids.map(String) : []);
    touch();
    return { unread: notifUnread(s.notifs, r.profile.id) };
  },

  // ---- friends ----
  'GET /api/friends': (_b, u) => friendsOut(need(u)),
  'POST /api/friends/add': (b, u) => {
    const r = need(u); gate(r.profile);
    const target = userByCode(store().accounts, String(b.code ?? ''));
    if (!target || !userById(target)) throw new HttpError(404, 'not-found');
    const res = rule(() => friendRequest(fctx(), r.profile, target));
    if (res === 'accepted') notify(target, { kind: 'friend-accept', ...NOTIF_TEXT.friendAccept(r.profile.name), key: `fa:${r.profile.id}:${Date.now()}`, data: { from: r.profile.id } });
    else notify(target, { kind: 'friend-request', ...NOTIF_TEXT.friendRequest(r.profile.name), key: `fr:${r.profile.id}:${Date.now()}`, data: { from: r.profile.id } });
    sendTo(target, { t: 'social', kind: 'friends' });
    return { result: res, ...friendsOut(r) };
  },
  'POST /api/friends/respond': (b, u) => {
    const r = need(u); const from = String(b.uid);
    const ok = rule(() => friendRespond(fctx(), r.profile, from, !!b.accept));
    if (ok) notify(from, { kind: 'friend-accept', ...NOTIF_TEXT.friendAccept(r.profile.name), key: `fa:${r.profile.id}:${Date.now()}`, data: { from: r.profile.id } });
    sendTo(from, { t: 'social', kind: 'friends' });
    return friendsOut(r);
  },
  'POST /api/friends/cancel': (b, u) => { const r = need(u); rule(() => friendCancel(fctx(), r.profile, String(b.uid))); sendTo(String(b.uid), { t: 'social', kind: 'friends' }); return friendsOut(r); },
  'POST /api/friends/remove': (b, u) => { const r = need(u); rule(() => friendRemove(fctx(), r.profile, String(b.uid))); sendTo(String(b.uid), { t: 'social', kind: 'friends' }); return friendsOut(r); },
  'POST /api/friends/gift': (b, u) => {
    const r = need(u); const to = String(b.uid);
    rule(() => giftSend(fctx(), r.profile, to));
    notify(to, { kind: 'friend-gift', ...NOTIF_TEXT.friendGift(r.profile.name, FRIENDS.giftCoins), key: `fg:${r.profile.id}:${Date.now()}`, data: { from: r.profile.id } });
    sendTo(to, { t: 'social', kind: 'friends' });
    return friendsOut(r);
  },
  'POST /api/friends/collect': (_b, u) => {
    const r = need(u);
    const g = rule(() => giftCollect(fctx(), r.profile));
    markDirty();
    return { ...g, profile: r.profile, ...friendsOut(r) };
  },
  'POST /api/friends/invite': (b, u) => {
    const r = need(u); gate(r.profile);
    const to = String(b.uid), room = String(b.room ?? '').toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(room)) throw new HttpError(400, 'bad-room');
    if (!areFriends(store().friends, r.profile.id, to)) throw new HttpError(400, 'not-friend');
    const n = notify(to, { kind: 'friend-invite', ...NOTIF_TEXT.friendInvite(r.profile.name), key: `inv:${r.profile.id}:${room}`, data: { room, from: r.profile.id, name: r.profile.name } });
    return { ok: true, sent: !!n, online: isOnline(to) };
  },

  // ---- referral ----
  'GET /api/referral': (_b, u) => {
    const r = need(u); const s = store();
    return { referral: referralView({ db: s.referral, now: Date.now(), profileOf: (id) => userById(id)?.profile ?? null }, r.profile, playerCode(s.accounts, r.profile.id), (id) => userById(id)?.profile.name ?? null, (id) => userById(id)?.profile.level ?? null) };
  },
  'POST /api/referral/redeem': (b, u, req) => {
    const r = need(u); const s = store();
    const ref = userByCode(s.accounts, String(b.code ?? ''));
    if (!ref || !userById(ref)) throw new HttpError(404, 'not-found');
    const out = rule(() => referralRedeem({ db: s.referral, now: Date.now(), profileOf: (id) => userById(id)?.profile ?? null }, r.profile, ref, { device: typeof b.device === 'string' ? b.device : undefined, ip: clientIp(req) }));
    markDirty();
    if (out.counted) {
      notify(ref, { kind: 'referral', ...NOTIF_TEXT.referral(r.profile.name), key: `ref:${r.profile.id}` });
      const rr = userById(ref); if (rr) sendTo(ref, { t: 'profile', profile: rr.profile });
    }
    return { granted: out.granted, profile: r.profile };
  },

  // ---- operator: run the reminder tick (optionally at a simulated time, for testing) ----
  'POST /api/admin/tick': (b) => ({ created: accountsTick(Number.isFinite(Number(b.at)) && b.at ? Number(b.at) : Date.now()) }),
};

/** Tick interval (env NOTIFY_TICK_MS, default 30 s). */
export function startAccountsTick() {
  store();
  const ms = Math.max(200, Number(process.env.NOTIFY_TICK_MS ?? 30_000));
  setInterval(() => { try { accountsTick(); } catch (e) { console.error('[accounts] tick', e); } }, ms).unref();
}
