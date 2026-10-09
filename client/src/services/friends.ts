import {
  FIGHTERS, FriendError, ReferralError, NOTIF_TEXT, FRIENDS, dayKey, randomCode, normalizeCode,
  newFriendsDb, friendRequest, friendRespond, friendRemove, friendCancel, giftSend, giftCollect, friendsView, friendsOf, areFriends, giftSentTo,
  newReferralDb, referralRedeem, referralView, sendMail, REFERRAL,
  type FriendsDb, type FriendsView, type PlayerBrief, type ReferralDb, type ReferralView, type Granted, type Profile,
} from '@nb/shared';
import { backend } from './backend.ts';
import { store } from './platform.ts';
import { net } from '../net/net.ts';
import { notifs } from './notifs.ts';

/**
 * Friends + referral behind one interface.
 *  - ServerFriends: REST routes + websocket "friends" refresh pushes.
 *  - DemoFriends: the offline build runs the same shared rules against computer players that
 *    accept requests after a few seconds, send gifts and the occasional match invite.
 */
export interface FriendsService {
  readonly demo: boolean;
  myCode(): Promise<string>;
  view(): Promise<FriendsView>;
  add(code: string): Promise<'sent' | 'accepted'>;
  respond(uid: string, accept: boolean): Promise<void>;
  cancel(uid: string): Promise<void>;
  remove(uid: string): Promise<void>;
  gift(uid: string): Promise<void>;
  collect(): Promise<{ n: number; coins: number }>;
  /** online: sends the room code; demo: the computer friend accepts (returns its fighter) */
  invite(uid: string, room: string): Promise<{ online: boolean }>;
  referral(): Promise<ReferralView>;
  redeemReferral(code: string): Promise<Granted>;
  /** demo only: players that can be added (with their codes) */
  suggestions(): PlayerBrief[];
  onChange(fn: () => void): () => void;
}

export function deviceId() {
  let d = store.get<string>('device', '');
  if (!d) { d = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); store.set('device', d); }
  return d;
}
const err = (e: unknown) => (e instanceof FriendError || e instanceof ReferralError ? new Error(e.code) : e);

// ---- server ---------------------------------------------------------------------------------------------
class ServerFriends implements FriendsService {
  readonly demo = false;
  private code = '';
  private changeL = new Set<() => void>();
  constructor() {
    net.on('social', (m) => { if (m.kind === 'friends') this.changeL.forEach((f) => f()); });
    notifs().onNew((n) => { if (n.kind.startsWith('friend') || n.kind.startsWith('referral')) this.changeL.forEach((f) => f()); });
  }
  private api<T = any>(m: string, p: string, b?: unknown) { return backend.api<T>(m, p, b); }
  async myCode() {
    if (!this.code) this.code = (await this.api('POST', '/api/me/hello', { device: deviceId() })).code;
    return this.code;
  }
  async view() { void net.connect(); const j = await this.api('GET', '/api/friends'); this.code = j.code; return j.friends as FriendsView; }
  async add(code: string) { return (await this.api('POST', '/api/friends/add', { code })).result; }
  async respond(uid: string, accept: boolean) { await this.api('POST', '/api/friends/respond', { uid, accept }); }
  async cancel(uid: string) { await this.api('POST', '/api/friends/cancel', { uid }); }
  async remove(uid: string) { await this.api('POST', '/api/friends/remove', { uid }); }
  async gift(uid: string) { await this.api('POST', '/api/friends/gift', { uid }); }
  async collect() { const j = await this.api('POST', '/api/friends/collect', {}); if (j.profile) backend.applyServerProfile(j.profile); return { n: j.n, coins: j.coins }; }
  async invite(uid: string, room: string) { const j = await this.api('POST', '/api/friends/invite', { uid, room }); return { online: !!j.online }; }
  async referral() { return (await this.api('GET', '/api/referral')).referral as ReferralView; }
  async redeemReferral(code: string) { const j = await this.api('POST', '/api/referral/redeem', { code, device: deviceId() }); if (j.profile) backend.applyServerProfile(j.profile); return j.granted as Granted; }
  suggestions() { return []; }
  onChange(fn: () => void) { this.changeL.add(fn); return () => this.changeL.delete(fn); }
}

// ---- offline demo ---------------------------------------------------------------------------------------
const NAMES = ['Arman', 'Setareh', 'Kian', 'Niloofar', 'Dariush', 'Mahsa', 'Reza', 'Ava', 'Omid', 'Yasaman', 'Bardia', 'Leila', 'Farzad', 'Parisa', 'Navid', 'Roya'];
interface Bot { id: string; name: string; code: string; fighter: string; level: number; mmr: number }
interface DemoState {
  v: 1; fdb: FriendsDb; rdb: ReferralDb; bots: Bot[]; code: string;
  accept: { uid: string; at: number }[];      // outgoing requests the computer players will accept
  giftBack: { uid: string; at: number }[];
  sim: { uid: string; name: string; lv: number }[];   // computer players that joined with our code
  lastInvite: number; giftDay: string;
}

class DemoFriends implements FriendsService {
  readonly demo = true;
  private st: DemoState;
  private changeL = new Set<() => void>();
  constructor() {
    const saved = store.get<DemoState | null>('friendsDemo', null);
    this.st = saved ?? this.seed();
    if (!saved) {
      // the seeded request and gift also show up in the notification center
      setTimeout(() => { this.note('friend-request', this.st.bots[2]); this.note('friend-gift', this.st.bots[0]); }, 800);
    }
    window.setInterval(() => this.tick(), 4000);
  }
  private get me(): Profile { return backend.profile; }
  private ctx() { return { db: this.st.fdb, now: Date.now() }; }
  private save() { store.set('friendsDemo', this.st); }
  private changed() { this.save(); this.changeL.forEach((f) => f()); }
  private seed(): DemoState {
    let s = 7;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const bots: Bot[] = NAMES.map((name, i) => ({
      id: 'fbot' + i, name, code: randomCode(8, rnd), fighter: FIGHTERS[(i * 3 + 1) % FIGHTERS.length].id,
      level: 3 + Math.floor(rnd() * 30), mmr: 950 + Math.floor(rnd() * 900),
    }));
    const st: DemoState = { v: 1, fdb: newFriendsDb(), rdb: newReferralDb(), bots, code: randomCode(8), accept: [], giftBack: [], sim: [], lastInvite: 0, giftDay: '' };
    const now = Date.now();
    // two computer friends already, one waiting request, one friend already sent today's gift
    const ctx = { db: st.fdb, now };
    for (const b of bots.slice(0, 2)) { friendRequest(ctx, b, this.meId()); friendRespond(ctx, { id: this.meId(), name: 'me' }, b.id, true); }
    friendRequest(ctx, bots[2], this.meId());
    giftSend(ctx, bots[0], this.meId());
    store.set('friendsDemo', st);
    return st;
  }
  private meId() { return backend.profile?.id ?? 'local'; }
  private bot(id: string) { return this.st.bots.find((b) => b.id === id) ?? null; }
  /** computer players' presence changes every few minutes, deterministically */
  private brief = (id: string): PlayerBrief | null => {
    const b = this.bot(id);
    if (!b) return null;
    const slot = Math.floor(Date.now() / 300_000);
    const h = (Number(b.id.slice(4)) * 7919 + slot * 104729) % 100;
    const online = h < 40;
    return { id: b.id, name: b.name, code: b.code, fighter: b.fighter, level: b.level, mmr: b.mmr, online, seen: online ? Date.now() : Date.now() - (5 + h * 37) * 60_000, bot: true };
  };
  /** runs a rule; mutations notify listeners, reads only persist (listeners re-read → no loops) */
  private wrap<T>(fn: () => T, mutates = true): Promise<T> {
    try { const r = fn(); if (mutates) this.changed(); else this.save(); return Promise.resolve(r); } catch (e) { return Promise.reject(err(e)); }
  }
  private note(kind: 'friend-request' | 'friend-accept' | 'friend-gift' | 'friend-invite', b: Bot, extra: Record<string, string | number> = {}) {
    const txt = kind === 'friend-request' ? NOTIF_TEXT.friendRequest(b.name) : kind === 'friend-accept' ? NOTIF_TEXT.friendAccept(b.name)
      : kind === 'friend-gift' ? NOTIF_TEXT.friendGift(b.name, FRIENDS.giftCoins) : NOTIF_TEXT.friendInvite(b.name);
    notifs().add({ kind, ...txt, key: `${kind}:${b.id}:${Date.now()}`, data: { from: b.id, name: b.name, ...extra } });
  }

  /** the simulated social life of the computer friends */
  private tick() {
    const now = Date.now();
    const ctx = this.ctx();
    let dirty = false;
    // accept our requests after a few seconds
    for (const a of [...this.st.accept]) {
      if (now < a.at) continue;
      this.st.accept = this.st.accept.filter((x) => x !== a);
      const b = this.bot(a.uid);
      if (!b || !(this.st.fdb.out[this.meId()] ?? []).includes(b.id)) continue;
      try { friendRespond(ctx, b, this.meId(), true); this.note('friend-accept', b); dirty = true; } catch { /* gone */ }
    }
    // gifts back for our gifts
    for (const g of [...this.st.giftBack]) {
      if (now < g.at) continue;
      this.st.giftBack = this.st.giftBack.filter((x) => x !== g);
      const b = this.bot(g.uid);
      if (b && areFriends(this.st.fdb, b.id, this.meId()) && !giftSentTo(ctx, b.id, this.meId())) { giftSend(ctx, b, this.meId()); this.note('friend-gift', b); dirty = true; }
    }
    // friends send their daily gift at some point of the day
    for (const id of friendsOf(this.st.fdb, this.meId())) {
      const b = this.bot(id);
      if (b && Math.random() < 0.012 && !giftSentTo(ctx, b.id, this.meId())) { giftSend(ctx, b, this.meId()); this.note('friend-gift', b); dirty = true; }
    }
    // now and then a new player asks to be friends
    const incoming = this.st.fdb.reqs[this.meId()] ?? [];
    if (Math.random() < 0.006 && incoming.length < 2) {
      const b = this.st.bots.find((x) => !areFriends(this.st.fdb, x.id, this.meId()) && !incoming.some((r) => r.from === x.id) && !(this.st.fdb.out[this.meId()] ?? []).includes(x.id));
      if (b) { try { friendRequest(ctx, b, this.meId()); this.note('friend-request', b); dirty = true; } catch { /* full */ } }
    }
    // an online friend invites us to a friendly match (at most every 20 minutes)
    if (now - this.st.lastInvite > 20 * 60_000 && Math.random() < 0.01) {
      const on = friendsOf(this.st.fdb, this.meId()).map(this.brief).filter((x) => x?.online);
      const b = on.length ? this.bot(on[Math.floor(Math.random() * on.length)]!.id) : null;
      if (b) { this.st.lastInvite = now; this.note('friend-invite', b, { cpu: b.fighter }); dirty = true; }
    }
    // computer players who joined with our code level up → milestone rewards
    for (const s of this.st.sim) {
      if (s.lv < 12 && Math.random() < 0.08) { s.lv++; dirty = true; this.milestones(); }
    }
    if (dirty) this.changed();
  }
  private milestones() {
    const ctx = { db: this.st.rdb, now: Date.now(), profileOf: (id: string) => (id === this.meId() ? this.me : null) };
    const level = (id: string) => this.st.sim.find((x) => x.uid === id)?.lv ?? null;
    for (const e of this.st.rdb.refs[this.meId()] ?? []) {
      const lv = level(e.uid);
      if (lv === null) continue;
      for (const m of REFERRAL.milestones) {
        if (lv < m.level || e.ms.includes(m.level)) continue;
        e.ms.push(m.level);
        sendMail(this.me, { title: `Invite milestone: level ${m.level}`, titleFa: `مرحله دعوت: سطح ${m.level}`, body: `${e.name} reached level ${m.level}.`, bodyFa: `${e.name} به سطح ${m.level} رسید.`, reward: m.reward }, ctx.now);
        notifs().add({ kind: 'referral-milestone', ...NOTIF_TEXT.referralMilestone(e.name, m.level), key: `rm:${e.uid}:${m.level}` });
        backend.touch();
      }
    }
  }

  async myCode() { return this.st.code; }
  view() { return this.wrap(() => friendsView(this.ctx(), this.meId(), this.brief), false); }
  add(code: string) {
    return this.wrap(() => {
      const c = normalizeCode(code);
      if (c === this.st.code) throw new FriendError('self');
      const b = this.st.bots.find((x) => x.code === c);
      if (!b) throw new FriendError('not-found');
      const r = friendRequest(this.ctx(), this.me, b.id);
      if (r === 'sent') this.st.accept.push({ uid: b.id, at: Date.now() + 3000 + Math.random() * 4000 });
      return r;
    });
  }
  respond(uid: string, accept: boolean) { return this.wrap(() => { friendRespond(this.ctx(), this.me, uid, accept); }); }
  cancel(uid: string) { return this.wrap(() => { friendCancel(this.ctx(), this.me, uid); }); }
  remove(uid: string) { return this.wrap(() => { friendRemove(this.ctx(), this.me, uid); }); }
  gift(uid: string) {
    return this.wrap(() => {
      giftSend(this.ctx(), this.me, uid);
      if (Math.random() < 0.7) this.st.giftBack.push({ uid, at: Date.now() + 4000 + Math.random() * 8000 });
    });
  }
  collect() { return this.wrap(() => { const r = giftCollect(this.ctx(), this.me); backend.touch(); return r; }); }
  invite(uid: string, _room: string) { return this.wrap(() => { if (!areFriends(this.st.fdb, this.meId(), uid)) throw new FriendError('not-friend'); return { online: false }; }); }
  botFighter(uid: string) { return this.bot(uid)?.fighter ?? null; }
  referral() {
    // the first visit simulates a computer player joining with our code, so the referrer side can be seen
    if (!this.st.sim.length) {
      setTimeout(() => {
        if (this.st.sim.length) return;
        const name = NAMES[(Date.now() >> 8) % NAMES.length] + '_' + Math.floor(Math.random() * 90 + 10);
        const uid = 'refbot' + Date.now().toString(36);
        const list = (this.st.rdb.refs[this.meId()] ??= []);
        list.unshift({ uid, name, t: Date.now(), ms: [], counted: true });
        this.st.sim.push({ uid, name, lv: 2 });
        sendMail(this.me, { title: 'Invite reward', titleFa: 'جایزه دعوت', body: `${name} joined with your code.`, bodyFa: `${name} با کد دعوت تو وارد بازی شد.`, reward: REFERRAL.referrerReward });
        backend.touch();
        notifs().add({ kind: 'referral', ...NOTIF_TEXT.referral(name), key: `ref:${uid}` });
        this.changed();
      }, 6000);
    }
    return this.wrap(() => referralView({ db: this.st.rdb, now: Date.now(), profileOf: () => this.me }, this.me, this.st.code,
      (id) => this.bot(id)?.name ?? null, (id) => this.st.sim.find((x) => x.uid === id)?.lv ?? null), false);
  }
  redeemReferral(code: string) {
    return this.wrap(() => {
      const c = normalizeCode(code);
      const b = this.st.bots.find((x) => x.code === c);
      const ref = c === this.st.code ? this.meId() : b?.id ?? null;
      const g = referralRedeem({ db: this.st.rdb, now: Date.now(), profileOf: () => null }, this.me, ref, { device: deviceId() });
      backend.touch();
      return g.granted;
    });
  }
  suggestions() {
    return this.st.bots.filter((b) => !areFriends(this.st.fdb, b.id, this.meId())).slice(0, 8).map((b) => this.brief(b.id)!);
  }
  onChange(fn: () => void) { this.changeL.add(fn); return () => this.changeL.delete(fn); }
}

let instance: FriendsService | null = null;
export function friends(): FriendsService {
  const wantDemo = !backend.online;
  if (!instance || instance.demo !== wantDemo) instance = wantDemo ? new DemoFriends() : new ServerFriends();
  return instance;
}
/** demo: the fighter a computer friend plays (for the friendly match after an invite) */
export function demoFighter(uid: string): string | null {
  const f = friends();
  return f.demo ? (f as DemoFriends).botFighter(uid) : null;
}
void dayKey;
