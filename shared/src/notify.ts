import type { Profile } from './economy.ts';
import type { SocialDb } from './social.ts';
import { weekInfo } from './league.ts';
import { TIERS } from './rank.ts';

// =====================================================================================
//  Notification center (pure rules).
//  Notifications are stored per user with both languages, deduplicated by a key (so the
//  periodic scan can run every few seconds without repeating itself), delivered live by the
//  server over the websocket (+ push) and generated locally by the offline demo world.
// =====================================================================================

export type NotifKind =
  | 'raid-declared' | 'raid-soon' | 'raid-live' | 'clan-war-ended'
  | 'league-ending' | 'league-top3'
  | 'friend-request' | 'friend-accept' | 'friend-invite' | 'friend-gift'
  | 'free-crate' | 'referral' | 'referral-milestone' | 'system';

export interface Notif {
  id: string; kind: NotifKind; t: number;
  title: string; titleFa: string; body: string; bodyFa: string;
  read: boolean;
  key?: string;
  /** extra payload: room code for invites, sender id, … */
  data?: Record<string, string | number>;
}
export interface NotifDb {
  inbox: Record<string, Notif[]>;
  keys: Record<string, string[]>;   // dedupe keys already used per user
  seq: number;
}
export const NOTIF_MAX = 60;
const KEYS_MAX = 300;

export function newNotifDb(): NotifDb { return { inbox: {}, keys: {}, seq: 1 }; }

export type NotifInput = Omit<Notif, 'id' | 't' | 'read'>;

/** Adds a notification unless its key was already used for this user. Returns the stored notification. */
export function notifPush(db: NotifDb, uid: string, n: NotifInput, now: number): Notif | null {
  if (n.key) {
    const keys = (db.keys[uid] ??= []);
    if (keys.includes(n.key)) return null;
    keys.push(n.key);
    if (keys.length > KEYS_MAX) keys.splice(0, keys.length - KEYS_MAX);
  }
  const full: Notif = { ...n, id: 'n' + (db.seq++).toString(36) + now.toString(36).slice(-4), t: now, read: false };
  const list = (db.inbox[uid] ??= []);
  list.unshift(full);
  if (list.length > NOTIF_MAX) list.length = NOTIF_MAX;
  return full;
}
export function notifList(db: NotifDb, uid: string) { return db.inbox[uid] ?? []; }
export function notifUnread(db: NotifDb, uid: string) { return notifList(db, uid).filter((n) => !n.read).length; }
/** Marks some (or all, with 'all') notifications read. Returns how many changed. */
export function notifRead(db: NotifDb, uid: string, ids: string[] | 'all') {
  let n = 0;
  for (const x of notifList(db, uid)) if (!x.read && (ids === 'all' || ids.includes(x.id))) { x.read = true; n++; }
  return n;
}
export function notifClear(db: NotifDb, uid: string) { db.inbox[uid] = []; }

// ---- texts --------------------------------------------------------------------------------------------
type Txt = Pick<Notif, 'title' | 'titleFa' | 'body' | 'bodyFa'>;
const faNum = (n: number | string) => String(n).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
export const NOTIF_TEXT = {
  raidDeclared: (tag: string, name: string): Txt => ({
    title: 'Your clan is under attack', titleFa: 'به قبیله‌ات اعلام حمله شد',
    body: `[${tag}] ${name} declared an attack. Pick your defenders and fortify.`, bodyFa: `[${tag}] ${name} اعلام حمله کرد. مدافع‌ها را انتخاب کن و استحکامات بساز.`,
  }),
  raidSoon: (vsTag: string, attacker: boolean): Txt => ({
    title: 'Clan attack in 10 minutes', titleFa: 'حمله قبیله ۱۰ دقیقه دیگر',
    body: attacker ? `Your attack on [${vsTag}] opens soon. Get ready to fight.` : `[${vsTag}] attacks your clan soon. Check your defense.`,
    bodyFa: attacker ? `حمله شما به [${vsTag}] به‌زودی شروع می‌شود. آماده نبرد باش.` : `[${vsTag}] به‌زودی به قبیله‌تان حمله می‌کند. دفاع را بررسی کن.`,
  }),
  raidLive: (vsTag: string): Txt => ({ title: 'Clan attack is live', titleFa: 'حمله قبیله شروع شد', body: `The attack vs [${vsTag}] is open for one hour.`, bodyFa: `نبرد با [${vsTag}] تا یک ساعت باز است.` }),
  warEnded: (vsTag: string, won: boolean, our: number, their: number): Txt => ({
    title: won ? 'Clan war won' : 'Clan war ended', titleFa: won ? 'جنگ قبیله را بردید' : 'جنگ قبیله تمام شد',
    body: `vs [${vsTag}] ${our} - ${their}. Rewards are in your inbox.`, bodyFa: `مقابل [${vsTag}] ${faNum(our)} - ${faNum(their)}. جایزه‌ها در صندوق پیام است.`,
  }),
  leagueEnding: (): Txt => ({ title: 'Weekly league ends in 1 hour', titleFa: 'لیگ هفتگی یک ساعت دیگر تمام می‌شود', body: 'Last chance to climb into the top 3.', bodyFa: 'آخرین فرصت برای رسیدن به سه نفر اول.' }),
  leagueTop3: (place: number, tier: number): Txt => {
    const pl = [['Champion', 'قهرمان'], ['Runner-up', 'نایب‌قهرمان'], ['Third place', 'نفر سوم']][place - 1] ?? ['Top 3', 'سه نفر اول'];
    const tt = TIERS[tier];
    return { title: `${pl[0]} of the week!`, titleFa: `${pl[1]} هفته شدی!`, body: `${tt?.name ?? ''} league — a trophy and prize are in your inbox.`, bodyFa: `لیگ ${tt?.nameFa ?? ''} — جام و جایزه در صندوق پیام است.` };
  },
  freeCrate: (): Txt => ({ title: 'Free crate ready', titleFa: 'جعبه رایگان آماده است', body: 'Open it in the shop.', bodyFa: 'در فروشگاه بازش کن.' }),
  friendRequest: (name: string): Txt => ({ title: 'Friend request', titleFa: 'درخواست دوستی', body: `${name} wants to be your friend.`, bodyFa: `${name} می‌خواهد با تو دوست شود.` }),
  friendAccept: (name: string): Txt => ({ title: 'New friend', titleFa: 'دوست جدید', body: `${name} accepted your friend request.`, bodyFa: `${name} درخواست دوستی‌ات را قبول کرد.` }),
  friendInvite: (name: string): Txt => ({ title: 'Match invite', titleFa: 'دعوت به بازی', body: `${name} invites you to a private room.`, bodyFa: `${name} تو را به اتاق خصوصی دعوت کرد.` }),
  friendGift: (name: string, coins: number): Txt => ({ title: 'Gift from a friend', titleFa: 'هدیه از دوست', body: `${name} sent you ${coins} coins.`, bodyFa: `${name} برایت ${faNum(coins)} سکه فرستاد.` }),
  referral: (name: string): Txt => ({ title: 'Invite reward', titleFa: 'جایزه دعوت', body: `${name} joined with your code. Your reward is in the inbox.`, bodyFa: `${name} با کد تو وارد بازی شد. جایزه‌ات در صندوق پیام است.` }),
  referralMilestone: (name: string, level: number): Txt => ({ title: 'Invite milestone', titleFa: 'مرحله دعوت', body: `${name} reached level ${level}. Bonus reward in your inbox.`, bodyFa: `${name} به سطح ${faNum(level)} رسید. جایزه ویژه در صندوق پیام است.` }),
};

// ---- periodic scan (time-based reminders) ---------------------------------------------------------------
export interface ScanInput {
  db: NotifDb;
  now: number;
  social: SocialDb | null;
  /** players to generate for (server: every profile; offline demo: the tester) */
  profiles: Profile[];
  /** free-crate cooldown end is in profile.daily.crateAt */
}
const MIN = 60_000;
export const RAID_SOON_MS = 10 * MIN;
export const LEAGUE_END_WARN_MS = 60 * MIN;

/**
 * Creates the time-based notifications that are due. Safe to call as often as you like:
 * every notification has a dedupe key. Returns what was created (for live delivery / push).
 */
export function scanNotifs(inp: ScanInput): { uid: string; notif: Notif }[] {
  const { db, now, social } = inp;
  const out: { uid: string; notif: Notif }[] = [];
  const byId = new Map(inp.profiles.map((p) => [p.id, p]));
  const push = (uid: string, kind: NotifKind, txt: Txt, key: string, data?: Notif['data']) => {
    if (!byId.has(uid)) return;
    const n = notifPush(db, uid, { kind, ...txt, key, ...(data ? { data } : {}) }, now);
    if (n) out.push({ uid, notif: n });
  };

  if (social) {
    // clan attacks: declared on you, starting in 10 minutes, live
    for (const r of Object.values(social.raids ?? {})) {
      if (r.status === 'done') continue;
      const def = social.clans[r.def], att = social.clans[r.att];
      if (r.status === 'declared') {
        for (const m of def?.members ?? []) push(m.id, 'raid-declared', NOTIF_TEXT.raidDeclared(r.attTag, r.attName), `rd:${r.id}`, { raid: r.id });
        if (r.start - now <= RAID_SOON_MS && r.start > now) {
          for (const m of def?.members ?? []) push(m.id, 'raid-soon', NOTIF_TEXT.raidSoon(r.attTag, false), `rs:${r.id}`, { raid: r.id });
          for (const m of att?.members ?? []) push(m.id, 'raid-soon', NOTIF_TEXT.raidSoon(r.defTag, true), `rs:${r.id}`, { raid: r.id });
        }
      }
      if (r.status === 'live') {
        for (const m of def?.members ?? []) push(m.id, 'raid-live', NOTIF_TEXT.raidLive(r.attTag), `rl:${r.id}`, { raid: r.id });
        for (const m of att?.members ?? []) push(m.id, 'raid-live', NOTIF_TEXT.raidLive(r.defTag), `rl:${r.id}`, { raid: r.id });
      }
    }
    // clan wars that just ended (only recent ones, so old logs are not replayed)
    for (const c of Object.values(social.clans)) {
      const w = c.warLog?.[0];
      if (!w || now - w.t > 6 * 60 * MIN) continue;
      for (const m of c.members) push(m.id, 'clan-war-ended', NOTIF_TEXT.warEnded(w.vsTag, w.won, w.our, w.their), `war:${c.id}:${w.t}`);
    }
  }

  const wk = weekInfo(now);
  for (const p of inp.profiles) {
    // weekly league ends in an hour (for players racing this week)
    if (!wk.inBreak && wk.left <= LEAGUE_END_WARN_MS && p.lweek?.id === wk.id && p.lweek.w + p.lweek.l > 0) {
      push(p.id, 'league-ending', NOTIF_TEXT.leagueEnding(), `le:${wk.id}`);
    }
    // podium finish (trophy handed out by the weekly settlement)
    const tr = p.trophies?.[0];
    if (tr && now - tr.t < 3 * 24 * 60 * MIN) push(p.id, 'league-top3', NOTIF_TEXT.leagueTop3(tr.place, tr.tier), `top:${tr.week}`);
    // free crate cooled down (only after the player opened one, so new players aren't nagged)
    const ca = p.daily?.crateAt ?? 0;
    if (ca > 0 && now >= ca && now - ca < 12 * 60 * MIN) push(p.id, 'free-crate', NOTIF_TEXT.freeCrate(), `crate:${ca}`);
  }
  return out;
}

/** Text for the reader's language. */
export function notifText(n: Notif, fa: boolean) { return fa ? { title: n.titleFa, body: n.bodyFa } : { title: n.title, body: n.body }; }
