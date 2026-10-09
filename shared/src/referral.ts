import type { Profile } from './economy.ts';
import { dayKey } from './economy.ts';
import { grantReward, sendMail, type Granted, type Reward } from './progress.ts';

// =====================================================================================
//  Referral (invite) program — pure rules.
//  Every player's public player code doubles as their referral code. A new player (below
//  level 5 and within 7 days of creating the account) can enter one code, once: both get a
//  reward (the new player instantly, the referrer by inbox mail). The referrer also gets a
//  milestone reward when a referred player reaches level 5 and level 10.
//  Anti-abuse: no self-referral, a referrer is paid for at most 50 players, one referral per
//  device, a few per IP per day and never between two accounts on the same device.
// =====================================================================================

export const REFERRAL = {
  maxLevel: 5,                       // must be below this level to enter a code
  windowMs: 7 * 86400_000,           // …and within 7 days of account creation
  maxCounted: 50,                    // referrer is rewarded for at most 50 players
  perIpPerDay: 3,
  newReward: { coins: 500, gems: 20, anyCards: 3 } as Reward,
  referrerReward: { coins: 300, gems: 10 } as Reward,
  milestones: [
    { level: 5, reward: { gems: 30, runes: 40 } as Reward },
    { level: 10, reward: { gems: 60, runes: 80, crates: 1 } as Reward },
  ],
};

export class ReferralError extends Error { constructor(public code: string) { super(code); } }
const fail = (code: string): never => { throw new ReferralError(code); };

export interface ReferralEntry { uid: string; name: string; t: number; ms: number[]; counted: boolean }
export interface ReferralDb {
  by: Record<string, { ref: string; t: number }>;  // referred uid -> referrer
  refs: Record<string, ReferralEntry[]>;           // referrer uid -> referred players
  devices: Record<string, string>;                 // device id -> uid that redeemed on it
  userDevices: Record<string, string[]>;           // uid -> devices seen (same-device check)
  ips: Record<string, { day: string; n: number }>;
}
export function newReferralDb(): ReferralDb { return { by: {}, refs: {}, devices: {}, userDevices: {}, ips: {} }; }

export interface ReferralCtx { db: ReferralDb; now: number; profileOf: (uid: string) => Profile | null; rand?: () => number }

/** Remembers which devices an account was used on (for the same-device rule). */
export function noteDevice(db: ReferralDb, uid: string, device: string | undefined) {
  if (!device) return;
  const d = String(device).slice(0, 64);
  const list = (db.userDevices[uid] ??= []);
  if (!list.includes(d)) { list.push(d); if (list.length > 5) list.shift(); }
}

export function referralEligible(p: Profile, db: ReferralDb, now: number): { ok: boolean; reason?: string; until: number } {
  const until = (p.createdAt || now) + REFERRAL.windowMs;
  if (db.by[p.id]) return { ok: false, reason: 'already', until };
  if (p.level >= REFERRAL.maxLevel) return { ok: false, reason: 'level', until };
  if (now > until) return { ok: false, reason: 'too-late', until };
  return { ok: true, until };
}

/**
 * The new player `me` enters the code of `refUid`. Grants the new player's reward and mails the
 * referrer (when the referrer is still under the 50-player cap). `device` / `ip` are optional
 * (the offline demo has neither).
 */
export function referralRedeem(ctx: ReferralCtx, me: Profile, refUid: string | null, opts: { device?: string; ip?: string } = {}): { granted: Granted; referrer: string; counted: boolean } {
  const { db, now } = ctx;
  if (!refUid) fail('not-found');
  if (refUid === me.id) fail('self');
  const el = referralEligible(me, db, now);
  if (!el.ok) fail(el.reason!);
  if (db.by[refUid!]?.ref === me.id) fail('circular');
  const dev = opts.device ? String(opts.device).slice(0, 64) : '';
  if (dev) {
    if (db.devices[dev] && db.devices[dev] !== me.id) fail('device-used');
    if ((db.userDevices[refUid!] ?? []).includes(dev)) fail('same-device');
  }
  if (opts.ip) {
    const day = dayKey(now);
    const r = db.ips[opts.ip];
    if (r && r.day === day && r.n >= REFERRAL.perIpPerDay) fail('rate-ip');
  }
  const ref = ctx.profileOf(refUid!);
  const list = (db.refs[refUid!] ??= []);
  const counted = list.filter((x) => x.counted).length < REFERRAL.maxCounted;
  // commit
  db.by[me.id] = { ref: refUid!, t: now };
  list.unshift({ uid: me.id, name: me.name, t: now, ms: [], counted });
  if (list.length > 500) list.length = 500;
  if (dev) { db.devices[dev] = me.id; noteDevice(db, me.id, dev); }
  if (opts.ip) {
    const day = dayKey(now);
    const r = db.ips[opts.ip];
    db.ips[opts.ip] = r && r.day === day ? { day, n: r.n + 1 } : { day, n: 1 };
  }
  const granted = grantReward(me, REFERRAL.newReward, ctx.rand);
  if (ref && counted) {
    sendMail(ref, {
      title: 'Invite reward', titleFa: 'جایزه دعوت',
      body: `${me.name} joined with your code.`, bodyFa: `${me.name} با کد دعوت تو وارد بازی شد.`,
      reward: REFERRAL.referrerReward,
    }, now);
  }
  return { granted, referrer: refUid!, counted };
}

/**
 * Checks the players a referrer brought in and mails milestone rewards (level 5 and 10).
 * `level(uid)` returns a referred player's current level (null when unknown).
 */
export function referralMilestones(ctx: ReferralCtx, referrer: string, level: (uid: string) => number | null): { uid: string; name: string; level: number }[] {
  const out: { uid: string; name: string; level: number }[] = [];
  const ref = ctx.profileOf(referrer);
  if (!ref) return out;
  for (const e of ctx.db.refs[referrer] ?? []) {
    if (!e.counted) continue;
    const lv = level(e.uid);
    if (lv === null) continue;
    for (const m of REFERRAL.milestones) {
      if (lv < m.level || e.ms.includes(m.level)) continue;
      e.ms.push(m.level);
      sendMail(ref, {
        title: `Invite milestone: level ${m.level}`, titleFa: `مرحله دعوت: سطح ${m.level}`,
        body: `${e.name} reached level ${m.level}.`, bodyFa: `${e.name} به سطح ${m.level} رسید.`,
        reward: m.reward,
      }, ctx.now);
      out.push({ uid: e.uid, name: e.name, level: m.level });
    }
  }
  return out;
}

export interface ReferralView {
  code: string;
  eligible: boolean; reason?: string; until: number;
  referredBy: string | null;
  invited: { name: string; t: number; ms: number[]; counted: boolean; level: number | null }[];
  counted: number; max: number;
  newReward: Reward; referrerReward: Reward; milestones: { level: number; reward: Reward }[];
}
export function referralView(ctx: ReferralCtx, p: Profile, code: string, nameOf: (uid: string) => string | null, level: (uid: string) => number | null): ReferralView {
  const el = referralEligible(p, ctx.db, ctx.now);
  const list = ctx.db.refs[p.id] ?? [];
  const by = ctx.db.by[p.id];
  return {
    code, eligible: el.ok, reason: el.reason, until: el.until,
    referredBy: by ? nameOf(by.ref) ?? '?' : null,
    invited: list.slice(0, 50).map((e) => ({ name: e.name, t: e.t, ms: e.ms, counted: e.counted, level: level(e.uid) })),
    counted: list.filter((x) => x.counted).length, max: REFERRAL.maxCounted,
    newReward: REFERRAL.newReward, referrerReward: REFERRAL.referrerReward, milestones: REFERRAL.milestones,
  };
}
