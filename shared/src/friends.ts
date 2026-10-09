import type { Profile } from './economy.ts';
import { dayKey } from './economy.ts';

// =====================================================================================
//  Friends (pure rules): requests by player code, accept / decline, remove, daily gifts.
//  The server keeps a FriendsDb on disk; the offline demo keeps one in localStorage with
//  computer friends. Gifts: each player may send every friend one gift per day (up to 20
//  a day); the friend collects it (up to 20 a day) for coins.
// =====================================================================================

export const FRIENDS = { max: 100, giftCoins: 50, giftsPerDay: 20, incomingMax: 50, giftKeepDays: 7 };

export class FriendError extends Error { constructor(public code: string) { super(code); } }
const fail = (code: string): never => { throw new FriendError(code); };

export interface FriendReq { from: string; name: string; t: number }
export interface GiftIn { from: string; name: string; t: number; day: string }
export interface FriendsDb {
  links: Record<string, Record<string, number>>;   // uid -> friend uid -> since
  reqs: Record<string, FriendReq[]>;               // incoming requests per uid
  out: Record<string, string[]>;                   // outgoing pending targets per uid
  sent: Record<string, { day: string; to: string[] }>;
  giftsIn: Record<string, GiftIn[]>;
  claimed: Record<string, { day: string; n: number }>;
  seen: Record<string, number>;                    // last activity per uid
}
export function newFriendsDb(): FriendsDb { return { links: {}, reqs: {}, out: {}, sent: {}, giftsIn: {}, claimed: {}, seen: {} }; }

export interface FriendCtx { db: FriendsDb; now: number }
type Who = { id: string; name: string };

export const friendsOf = (db: FriendsDb, uid: string) => Object.keys(db.links[uid] ?? {});
export const areFriends = (db: FriendsDb, a: string, b: string) => !!db.links[a]?.[b];

function link(ctx: FriendCtx, a: string, b: string) {
  (ctx.db.links[a] ??= {})[b] = ctx.now;
  (ctx.db.links[b] ??= {})[a] = ctx.now;
  dropReq(ctx.db, a, b); dropReq(ctx.db, b, a);
}
function dropReq(db: FriendsDb, to: string, from: string) {
  if (db.reqs[to]) db.reqs[to] = db.reqs[to].filter((r) => r.from !== from);
  if (db.out[from]) db.out[from] = db.out[from].filter((x) => x !== to);
}

/** Sends a friend request; if the other player already asked us, it becomes a friendship. */
export function friendRequest(ctx: FriendCtx, me: Who, to: string): 'sent' | 'accepted' {
  const { db } = ctx;
  if (!to || to === me.id) fail('self');
  if (areFriends(db, me.id, to)) fail('already-friends');
  if ((db.reqs[me.id] ?? []).some((r) => r.from === to)) { friendRespond(ctx, me, to, true); return 'accepted'; }
  if ((db.out[me.id] ?? []).includes(to)) fail('already-sent');
  if (friendsOf(db, me.id).length >= FRIENDS.max) fail('max-friends');
  if (friendsOf(db, to).length >= FRIENDS.max) fail('their-max');
  const inc = (db.reqs[to] ??= []);
  if (inc.length >= FRIENDS.incomingMax) fail('their-inbox-full');
  inc.unshift({ from: me.id, name: me.name, t: ctx.now });
  (db.out[me.id] ??= []).push(to);
  return 'sent';
}

export function friendRespond(ctx: FriendCtx, me: Who, from: string, accept: boolean) {
  const { db } = ctx;
  if (!(db.reqs[me.id] ?? []).some((r) => r.from === from)) fail('no-request');
  if (!accept) { dropReq(db, me.id, from); return false; }
  if (friendsOf(db, me.id).length >= FRIENDS.max) fail('max-friends');
  link(ctx, me.id, from);
  return true;
}

export function friendCancel(ctx: FriendCtx, me: Who, to: string) { dropReq(ctx.db, to, me.id); }

export function friendRemove(ctx: FriendCtx, me: Who, other: string) {
  const { db } = ctx;
  if (!areFriends(db, me.id, other)) fail('not-friend');
  delete db.links[me.id][other];
  delete db.links[other]?.[me.id];
  if (db.giftsIn[me.id]) db.giftsIn[me.id] = db.giftsIn[me.id].filter((g) => g.from !== other);
}

function sentToday(ctx: FriendCtx, uid: string) {
  const day = dayKey(ctx.now);
  const s = ctx.db.sent[uid];
  if (!s || s.day !== day) return (ctx.db.sent[uid] = { day, to: [] });
  return s;
}
export function giftSentTo(ctx: FriendCtx, uid: string, friend: string) { return sentToday(ctx, uid).to.includes(friend); }
export function giftsLeft(ctx: FriendCtx, uid: string) { return Math.max(0, FRIENDS.giftsPerDay - sentToday(ctx, uid).to.length); }

/** Sends today's gift to a friend. */
export function giftSend(ctx: FriendCtx, me: Who, to: string): GiftIn {
  const { db } = ctx;
  if (!areFriends(db, me.id, to)) fail('not-friend');
  const s = sentToday(ctx, me.id);
  if (s.to.includes(to)) fail('already-gifted');
  if (s.to.length >= FRIENDS.giftsPerDay) fail('gift-limit');
  s.to.push(to);
  const g: GiftIn = { from: me.id, name: me.name, t: ctx.now, day: s.day };
  const list = (db.giftsIn[to] ??= []);
  list.unshift(g);
  if (list.length > 100) list.length = 100;
  return g;
}

function claimedToday(ctx: FriendCtx, uid: string) {
  const day = dayKey(ctx.now);
  const c = ctx.db.claimed[uid];
  if (!c || c.day !== day) return (ctx.db.claimed[uid] = { day, n: 0 });
  return c;
}
/** Pending gifts (expired ones are dropped). */
export function giftsPending(ctx: FriendCtx, uid: string) {
  const keep = ctx.now - FRIENDS.giftKeepDays * 86400_000;
  const list = (ctx.db.giftsIn[uid] ?? []).filter((g) => g.t >= keep);
  ctx.db.giftsIn[uid] = list;
  return list;
}
export function giftsCollectable(ctx: FriendCtx, uid: string) {
  return Math.min(giftsPending(ctx, uid).length, FRIENDS.giftsPerDay - claimedToday(ctx, uid).n);
}
/** Collects pending gifts into the wallet (max 20 a day; the rest wait for tomorrow). */
export function giftCollect(ctx: FriendCtx, p: Profile): { n: number; coins: number } {
  const n = giftsCollectable(ctx, p.id);
  if (n <= 0) return { n: 0, coins: 0 };
  const list = giftsPending(ctx, p.id);
  list.splice(list.length - n, n);    // oldest first
  claimedToday(ctx, p.id).n += n;
  const coins = n * FRIENDS.giftCoins;
  p.coins += coins;
  return { n, coins };
}

// ---- view -------------------------------------------------------------------------------------------
export interface PlayerBrief { id: string; name: string; code: string; fighter: string; level: number; mmr: number; online: boolean; seen: number; bot?: boolean }
export interface FriendRow extends PlayerBrief { since: number; gifted: boolean; giftFrom: boolean }
export interface FriendsView {
  friends: FriendRow[];
  incoming: (FriendReq & { brief: PlayerBrief | null })[];
  outgoing: PlayerBrief[];
  giftsPending: number; giftsCollectable: number; giftsLeft: number;
  max: number;
}
export function friendsView(ctx: FriendCtx, uid: string, brief: (id: string) => PlayerBrief | null): FriendsView {
  const { db } = ctx;
  const pend = giftsPending(ctx, uid);
  const friends = friendsOf(db, uid).map((id) => {
    const b = brief(id);
    if (!b) return null;
    return { ...b, since: db.links[uid][id], gifted: giftSentTo(ctx, uid, id), giftFrom: pend.some((g) => g.from === id) };
  }).filter((x): x is FriendRow => !!x)
    .sort((a, b) => Number(b.online) - Number(a.online) || b.seen - a.seen);
  return {
    friends,
    incoming: (db.reqs[uid] ?? []).map((r) => ({ ...r, brief: brief(r.from) })),
    outgoing: (db.out[uid] ?? []).map((id) => brief(id)).filter((x): x is PlayerBrief => !!x),
    giftsPending: pend.length, giftsCollectable: giftsCollectable(ctx, uid), giftsLeft: giftsLeft(ctx, uid),
    max: FRIENDS.max,
  };
}
