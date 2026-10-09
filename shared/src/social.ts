import type { Profile, ClanRef } from './economy.ts';
import {
  CLAN_LEVEL_COST, CLAN_MAX_LEVEL, CLAN_MAX_MEMBERS, clanBonus, cleanReward, grantReward, migrateProgress, sendMail,
  type Granted, type Reward,
} from './progress.ts';
import { getFighter } from './fighters.ts';

// =====================================================================================
//  Social engine: clans (roles, gem upgrades, card donations, alliances, wars), chat
//  (global / clan / alliance / private between clan members), moderation ("game police")
//  and promo codes.  It mutates a plain SocialDb object, so the server persists it to
//  disk and the offline demo keeps it in localStorage — both run identical rules.
// =====================================================================================

export type ClanRole = 'leader' | 'co' | 'elder' | 'member';
export const ROLE_RANK: Record<ClanRole, number> = { leader: 3, co: 2, elder: 1, member: 0 };
export const ROLE_NAMES: Record<ClanRole, { en: string; fa: string }> = {
  leader: { en: 'Leader', fa: 'رئیس' },
  co: { en: 'Deputy', fa: 'معاون' },
  elder: { en: 'Officer', fa: 'زیردست ارشد' },
  member: { en: 'Member', fa: 'عضو' },
};
export const MAX_DEPUTIES = 3;
export const MAX_ALLIES = 3;
export const CLAN_CREATE_COST = 1000;      // coins
export const WAR_HOURS = 24;
export const WAR_MIN_MEMBERS = 1;
export const CARD_REQUEST_SIZE = 10;
export const CARD_DONATE_DAILY = 30;
export const CHAT_HISTORY = 60;
export const CHAT_MAX_LEN = 200;
export const CHAT_COOLDOWN_MS = 2000;

export interface ClanMember {
  id: string; name: string; role: ClanRole; joined: number;
  mmr: number; level: number; fighter: string;
  donated: number; gemsGiven: number; warPts: number; seen: number; bot?: boolean;
}
export interface CardRequest { id: string; uid: string; name: string; fighter: string; need: number; got: number; t: number; donors: Record<string, number> }
export interface ClanWar {
  id: string; vs: string; vsName: string; vsTag: string; vsBadge: number;
  start: number; end: number;
  pts: Record<string, number>;        // our members' points
  vsPts: number;                      // only used against bot clans
  vsPower: number;
  vsBot: boolean;
}
export interface WarLog { t: number; vsName: string; vsTag: string; our: number; their: number; won: boolean }
export interface Clan {
  id: string; name: string; tag: string; badge: number; desc: string;
  type: 'open' | 'invite' | 'closed'; minMmr: number;
  members: ClanMember[];
  level: number; bank: number; created: number;
  requests: { uid: string; name: string; mmr: number; level: number; t: number }[];
  cardReqs: CardRequest[];
  allies: string[]; allyIn: string[]; allyOut: string[];
  war: ClanWar | null; warLog: WarLog[]; warWins: number; searching: boolean;
  log: { t: number; en: string; fa: string }[];
  bot?: boolean;
}
export interface ChatMsg { id: string; ch: string; uid: string; name: string; tag?: string; role?: ClanRole; lvl?: number; text: string; t: number; sys?: boolean }
export interface Report {
  id: string; t: number; by: string; byName: string; target: string; targetName: string;
  msgId?: string; text?: string; ch?: string; reason: string; status: 'open' | 'done'; action?: string;
}
export interface Promo { code: string; reward: Reward; maxUses: number; uses: number; expires: number; minLevel: number; created: number; by: string; note?: string; off?: boolean }
export type StaffRole = 'mod' | 'admin';
export interface SocialDb {
  clans: Record<string, Clan>;
  userClan: Record<string, string>;
  chats: Record<string, ChatMsg[]>;
  reports: Report[];
  mutes: Record<string, number>;
  bans: Record<string, string>;
  warns: Record<string, number>;
  promos: Record<string, Promo>;
  redeemed: Record<string, string[]>;
  roles: Record<string, StaffRole>;
  warQueue: string[];
  modlog: { t: number; by: string; action: string; target: string; note?: string }[];
  seq: number;
  rate?: Record<string, { t: number; last: string; rep: number }>;
}
export function newSocialDb(): SocialDb {
  return { clans: {}, userClan: {}, chats: {}, reports: [], mutes: {}, bans: {}, warns: {}, promos: {}, redeemed: {}, roles: {}, warQueue: [], modlog: [], seq: 1 };
}

export class SocialError extends Error { constructor(public code: string) { super(code); } }
const fail = (code: string): never => { throw new SocialError(code); };

export interface SocialCtx {
  db: SocialDb;
  now: number;
  rand: () => number;
  /** profile of another user, when available (server: everyone; offline demo: only self) */
  profileOf: (uid: string) => Profile | null;
  /** war length override (offline demo uses short wars) */
  warMs?: number;
}

const uid = (ctx: SocialCtx, prefix: string) => `${prefix}${(ctx.db.seq++).toString(36)}${Math.floor(ctx.rand() * 1e5).toString(36)}`;

// ---- helpers -----------------------------------------------------------------------------------
export function clanOf(db: SocialDb, userId: string): Clan | null {
  const id = db.userClan[userId];
  return (id && db.clans[id]) || null;
}
function memberOf(c: Clan, userId: string) { return c.members.find((m) => m.id === userId) ?? null; }
function myClan(ctx: SocialCtx, p: Profile, minRole: ClanRole = 'member') {
  const c = clanOf(ctx.db, p.id) ?? fail('no-clan');
  const m = memberOf(c, p.id) ?? fail('no-clan');
  if (ROLE_RANK[m.role] < ROLE_RANK[minRole]) fail('perm');
  return { c, m };
}
export function clanPower(c: Clan) { return c.members.reduce((a, m) => a + m.mmr, 0); }
function clanRef(c: Clan, role: ClanRole): ClanRef { return { id: c.id, name: c.name, tag: c.tag, level: c.level, role, badge: c.badge }; }
/** Refreshes the denormalised clan info on member profiles (perks use the clan level). */
function syncProfiles(ctx: SocialCtx, c: Clan) {
  for (const m of c.members) { const pr = ctx.profileOf(m.id); if (pr) pr.clan = clanRef(c, m.role); }
}
function clanLog(c: Clan, en: string, fa: string, now: number) {
  c.log.unshift({ t: now, en, fa });
  if (c.log.length > 30) c.log.length = 30;
}
function sysMsg(ctx: SocialCtx, ch: string, text: string) {
  pushMsg(ctx, { id: uid(ctx, 'c'), ch, uid: 'sys', name: 'System', text, t: ctx.now, sys: true });
}
function memberFromProfile(p: Profile, role: ClanRole, now: number): ClanMember {
  return { id: p.id, name: p.name, role, joined: now, mmr: p.rank.mmr, level: p.level, fighter: p.selFighter, donated: 0, gemsGiven: 0, warPts: 0, seen: now };
}

const cleanText = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001f‎‏‪-‮]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanTag = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

// ---- clans: lifecycle ------------------------------------------------------------------------------
export interface ClanInput { name: string; tag: string; badge: number; desc: string; type: Clan['type']; minMmr: number }
export function clanCreate(ctx: SocialCtx, p: Profile, inp: ClanInput): Clan {
  migrateProgress(p);
  if (clanOf(ctx.db, p.id)) fail('in-clan');
  const name = filterText(cleanText(inp.name, 20)).text;
  const tag = cleanTag(inp.tag);
  if (name.length < 3 || tag.length < 2) fail('bad-input');
  if (Object.values(ctx.db.clans).some((c) => c.tag === tag || c.name.toLowerCase() === name.toLowerCase())) fail('exists');
  if (p.coins < CLAN_CREATE_COST) fail('funds');
  p.coins -= CLAN_CREATE_COST;
  const c: Clan = {
    id: uid(ctx, 'k'), name, tag, badge: Math.max(0, Math.min(63, inp.badge | 0)), desc: filterText(cleanText(inp.desc, 120)).text,
    type: ['open', 'invite', 'closed'].includes(inp.type) ? inp.type : 'open', minMmr: Math.max(0, Math.min(3000, inp.minMmr | 0)),
    members: [memberFromProfile(p, 'leader', ctx.now)], level: 1, bank: 0, created: ctx.now,
    requests: [], cardReqs: [], allies: [], allyIn: [], allyOut: [], war: null, warLog: [], warWins: 0, searching: false, log: [],
  };
  ctx.db.clans[c.id] = c;
  ctx.db.userClan[p.id] = c.id;
  p.clan = clanRef(c, 'leader');
  clanLog(c, `${p.name} founded the clan`, `${p.name} قبیله را ساخت`, ctx.now);
  return c;
}

export function clanEdit(ctx: SocialCtx, p: Profile, inp: Partial<ClanInput>) {
  const { c } = myClan(ctx, p, 'co');
  if (inp.desc !== undefined) c.desc = filterText(cleanText(inp.desc, 120)).text;
  if (inp.type && ['open', 'invite', 'closed'].includes(inp.type)) c.type = inp.type;
  if (inp.minMmr !== undefined) c.minMmr = Math.max(0, Math.min(3000, inp.minMmr | 0));
  if (inp.badge !== undefined) c.badge = Math.max(0, Math.min(63, inp.badge | 0));
  syncProfiles(ctx, c);
  return c;
}

export function clanSearch(db: SocialDb, q = '', limit = 30) {
  const s = q.trim().toLowerCase();
  return Object.values(db.clans)
    .filter((c) => !s || c.name.toLowerCase().includes(s) || c.tag.toLowerCase().includes(s.replace('#', '')))
    .sort((a, b) => clanPower(b) - clanPower(a))
    .slice(0, limit)
    .map(clanSummary);
}
export function clanSummary(c: Clan) {
  return { id: c.id, name: c.name, tag: c.tag, badge: c.badge, desc: c.desc, type: c.type, minMmr: c.minMmr, members: c.members.length, level: c.level, power: clanPower(c), warWins: c.warWins };
}
export type ClanSummary = ReturnType<typeof clanSummary>;

export function clanJoin(ctx: SocialCtx, p: Profile, clanId: string): 'joined' | 'requested' {
  if (clanOf(ctx.db, p.id)) fail('in-clan');
  const c = ctx.db.clans[clanId] ?? fail('not-found');
  if (c.members.length >= CLAN_MAX_MEMBERS) fail('full');
  if (p.rank.mmr < c.minMmr) fail('mmr');
  if (c.type === 'closed') fail('closed');
  if (c.type === 'invite') {
    if (!c.requests.some((r) => r.uid === p.id)) c.requests.push({ uid: p.id, name: p.name, mmr: p.rank.mmr, level: p.level, t: ctx.now });
    if (c.requests.length > 30) c.requests.shift();
    return 'requested';
  }
  addMember(ctx, c, p);
  return 'joined';
}
function addMember(ctx: SocialCtx, c: Clan, p: Profile) {
  c.members.push(memberFromProfile(p, 'member', ctx.now));
  ctx.db.userClan[p.id] = c.id;
  c.requests = c.requests.filter((r) => r.uid !== p.id);
  for (const other of Object.values(ctx.db.clans)) other.requests = other.requests.filter((r) => r.uid !== p.id);
  p.clan = clanRef(c, 'member');
  clanLog(c, `${p.name} joined`, `${p.name} عضو شد`, ctx.now);
  sysMsg(ctx, `clan:${c.id}`, `+ ${p.name}`);
}

export function clanRespond(ctx: SocialCtx, p: Profile, userId: string, accept: boolean) {
  const { c } = myClan(ctx, p, 'elder');
  const req = c.requests.find((r) => r.uid === userId) ?? fail('not-found');
  c.requests = c.requests.filter((r) => r !== req);
  if (!accept) return c;
  if (c.members.length >= CLAN_MAX_MEMBERS) fail('full');
  if (clanOf(ctx.db, userId)) return c;
  const other = ctx.profileOf(userId);
  if (other) addMember(ctx, c, other);
  else {
    c.members.push({ id: userId, name: req.name, role: 'member', joined: ctx.now, mmr: req.mmr, level: req.level, fighter: 'blaze', donated: 0, gemsGiven: 0, warPts: 0, seen: ctx.now });
    ctx.db.userClan[userId] = c.id;
  }
  return c;
}

export function clanLeave(ctx: SocialCtx, p: Profile) {
  const { c, m } = myClan(ctx, p);
  removeMember(ctx, c, m.id);
  p.clan = null;
  clanLog(c, `${p.name} left`, `${p.name} قبیله را ترک کرد`, ctx.now);
}
function removeMember(ctx: SocialCtx, c: Clan, userId: string) {
  const m = memberOf(c, userId);
  c.members = c.members.filter((x) => x.id !== userId);
  delete ctx.db.userClan[userId];
  c.cardReqs = c.cardReqs.filter((r) => r.uid !== userId);
  const pr = ctx.profileOf(userId); if (pr) pr.clan = null;
  if (!c.members.length) { disbandClan(ctx, c); return; }
  if (m?.role === 'leader') {
    // hand over to the highest role, then the longest-standing member
    const next = [...c.members].sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.joined - b.joined)[0];
    next.role = 'leader';
    clanLog(c, `${next.name} is the new leader`, `${next.name} رئیس جدید است`, ctx.now);
  }
  syncProfiles(ctx, c);
}
function disbandClan(ctx: SocialCtx, c: Clan) {
  for (const a of c.allies) { const o = ctx.db.clans[a]; if (o) o.allies = o.allies.filter((x) => x !== c.id); }
  for (const o of Object.values(ctx.db.clans)) { o.allyIn = o.allyIn.filter((x) => x !== c.id); o.allyOut = o.allyOut.filter((x) => x !== c.id); }
  ctx.db.warQueue = ctx.db.warQueue.filter((x) => x !== c.id);
  delete ctx.db.clans[c.id];
  delete ctx.db.chats[`clan:${c.id}`];
  delete ctx.db.chats[`ally:${c.id}`];
}

export function clanKick(ctx: SocialCtx, p: Profile, userId: string) {
  const { c, m } = myClan(ctx, p, 'elder');
  const t = memberOf(c, userId) ?? fail('not-found');
  if (t.id === m.id || ROLE_RANK[t.role] >= ROLE_RANK[m.role]) fail('perm');
  removeMember(ctx, c, userId);
  clanLog(c, `${m.name} removed ${t.name}`, `${m.name}، ${t.name} را اخراج کرد`, ctx.now);
  sysMsg(ctx, `clan:${c.id}`, `− ${t.name}`);
}

/** Leader picks deputies (co) and officers (elder); a deputy can promote members to officer. */
export function clanSetRole(ctx: SocialCtx, p: Profile, userId: string, role: ClanRole) {
  const { c, m } = myClan(ctx, p, 'co');
  const t = memberOf(c, userId) ?? fail('not-found');
  if (t.id === m.id || !(role in ROLE_RANK)) fail('perm');
  if (m.role === 'co' && (ROLE_RANK[t.role] >= ROLE_RANK.co || ROLE_RANK[role] >= ROLE_RANK.co)) fail('perm');
  if (role === 'leader') {
    if (m.role !== 'leader') fail('perm');
    m.role = 'co';
  }
  if (role === 'co' && t.role !== 'co' && c.members.filter((x) => x.role === 'co').length >= MAX_DEPUTIES) fail('limit');
  t.role = role;
  syncProfiles(ctx, c);
  const rn = ROLE_NAMES[role];
  clanLog(c, `${t.name} is now ${rn.en}`, `${t.name} اکنون ${rn.fa} است`, ctx.now);
  sysMsg(ctx, `clan:${c.id}`, `${t.name} → ${rn.fa} / ${rn.en}`);
  return c;
}

// ---- clans: gems, levels & perks ----------------------------------------------------------------------
export function clanDonateGems(ctx: SocialCtx, p: Profile, amount: number) {
  const { c, m } = myClan(ctx, p);
  const n = Math.floor(amount);
  if (!(n >= 10 && n <= 100000)) fail('bad-input');
  if (p.gems < n) fail('funds');
  p.gems -= n; c.bank += n; m.gemsGiven += n;
  clanLog(c, `${p.name} added ${n} gems`, `${p.name} ${n} الماس به خزانه داد`, ctx.now);
  return c;
}
export function clanUpgradeCost(c: Clan) { return c.level >= CLAN_MAX_LEVEL ? null : CLAN_LEVEL_COST[c.level - 1]; }
export function clanUpgrade(ctx: SocialCtx, p: Profile) {
  const { c } = myClan(ctx, p, 'co');
  const cost = clanUpgradeCost(c) ?? fail('max');
  if (c.bank < cost) fail('funds');
  c.bank -= cost; c.level++;
  syncProfiles(ctx, c);
  clanLog(c, `Clan reached level ${c.level}`, `قبیله به سطح ${c.level} رسید`, ctx.now);
  sysMsg(ctx, `clan:${c.id}`, `★ Lv ${c.level}`);
  return c;
}

// ---- clans: card requests & donations ------------------------------------------------------------------
export function cardRequest(ctx: SocialCtx, p: Profile, fighter: string) {
  const { c } = myClan(ctx, p);
  migrateProgress(p);
  if (!p.fighters.includes(fighter)) fail('bad-input');
  if (p.daily.cardReq >= clanBonus(c.level).cardReq) fail('limit');
  if (c.cardReqs.some((r) => r.uid === p.id && r.got < r.need)) fail('limit');
  p.daily.cardReq++;
  const r: CardRequest = { id: uid(ctx, 'r'), uid: p.id, name: p.name, fighter, need: CARD_REQUEST_SIZE, got: 0, t: ctx.now, donors: {} };
  c.cardReqs.unshift(r);
  if (c.cardReqs.length > 20) c.cardReqs.length = 20;
  return r;
}
export function cardDonate(ctx: SocialCtx, p: Profile, reqId: string) {
  const { c, m } = myClan(ctx, p);
  migrateProgress(p);
  const r = c.cardReqs.find((x) => x.id === reqId) ?? fail('not-found');
  if (r.uid === p.id || r.got >= r.need) fail('perm');
  if ((r.donors[p.id] ?? 0) >= 4 || p.daily.donated >= CARD_DONATE_DAILY) fail('limit');
  if ((p.cards[r.fighter] ?? 0) < 1) fail('funds');
  p.cards[r.fighter]--; p.daily.donated++;
  r.got++; r.donors[p.id] = (r.donors[p.id] ?? 0) + 1;
  m.donated++;
  p.coins += 15;  // donor reward
  const target = ctx.profileOf(r.uid);
  if (target) { migrateProgress(target); target.cards[r.fighter] = (target.cards[r.fighter] ?? 0) + 1; }
  else (r as CardRequest & { pending?: number }).pending = ((r as CardRequest & { pending?: number }).pending ?? 0) + 1;
  return r;
}
/** Delivers donations received while the requester was offline (demo / sharded servers). */
export function collectDonations(ctx: SocialCtx, p: Profile) {
  const c = clanOf(ctx.db, p.id);
  if (!c) return 0;
  let n = 0;
  for (const r of c.cardReqs as (CardRequest & { pending?: number })[]) {
    if (r.uid === p.id && r.pending) { migrateProgress(p); p.cards[r.fighter] = (p.cards[r.fighter] ?? 0) + r.pending; n += r.pending; r.pending = 0; }
  }
  return n;
}

// ---- alliances ----------------------------------------------------------------------------------------
export function allyRequest(ctx: SocialCtx, p: Profile, clanId: string) {
  const { c } = myClan(ctx, p, 'co');
  const o = ctx.db.clans[clanId] ?? fail('not-found');
  if (o.id === c.id || c.allies.includes(o.id)) fail('bad-input');
  if (c.allies.length >= MAX_ALLIES || o.allies.length >= MAX_ALLIES) fail('limit');
  if (c.allyIn.includes(o.id)) return allyRespond(ctx, p, o.id, true);
  if (!c.allyOut.includes(o.id)) c.allyOut.push(o.id);
  if (!o.allyIn.includes(c.id)) o.allyIn.push(c.id);
  clanLog(o, `[${c.tag}] ${c.name} proposed an alliance`, `قبیله [${c.tag}] ${c.name} درخواست اتحاد داد`, ctx.now);
  return c;
}
export function allyRespond(ctx: SocialCtx, p: Profile, clanId: string, accept: boolean) {
  const { c } = myClan(ctx, p, 'co');
  const o = ctx.db.clans[clanId] ?? fail('not-found');
  c.allyIn = c.allyIn.filter((x) => x !== o.id);
  o.allyOut = o.allyOut.filter((x) => x !== c.id);
  if (!accept) return c;
  if (c.allies.length >= MAX_ALLIES || o.allies.length >= MAX_ALLIES) fail('limit');
  if (c.war?.vs === o.id) fail('at-war');
  c.allies.push(o.id); o.allies.push(c.id);
  clanLog(c, `Allied with [${o.tag}] ${o.name}`, `با [${o.tag}] ${o.name} متحد شدیم`, ctx.now);
  clanLog(o, `Allied with [${c.tag}] ${c.name}`, `با [${c.tag}] ${c.name} متحد شدیم`, ctx.now);
  sysMsg(ctx, `ally:${c.id}`, `🤝 [${o.tag}]`); sysMsg(ctx, `ally:${o.id}`, `🤝 [${c.tag}]`);
  return c;
}
export function allyBreak(ctx: SocialCtx, p: Profile, clanId: string) {
  const { c } = myClan(ctx, p, 'co');
  const o = ctx.db.clans[clanId];
  c.allies = c.allies.filter((x) => x !== clanId);
  c.allyOut = c.allyOut.filter((x) => x !== clanId);
  if (o) { o.allies = o.allies.filter((x) => x !== c.id); o.allyIn = o.allyIn.filter((x) => x !== c.id); }
  return c;
}

// ---- clan wars ----------------------------------------------------------------------------------------
export function warSearch(ctx: SocialCtx, p: Profile) {
  const { c } = myClan(ctx, p, 'co');
  if (c.war) fail('at-war');
  if (c.members.length < WAR_MIN_MEMBERS) fail('members');
  c.searching = true;
  if (!ctx.db.warQueue.includes(c.id)) ctx.db.warQueue.push(c.id);
  matchWars(ctx);
  return c;
}
export function warCancel(ctx: SocialCtx, p: Profile) {
  const { c } = myClan(ctx, p, 'co');
  c.searching = false;
  ctx.db.warQueue = ctx.db.warQueue.filter((x) => x !== c.id);
  return c;
}
function startWar(ctx: SocialCtx, a: Clan, b: Clan | null, bot?: { name: string; tag: string; badge: number; power: number }) {
  const end = ctx.now + (ctx.warMs ?? WAR_HOURS * 3600_000);
  const mk = (vs: { id: string; name: string; tag: string; badge: number }, power: number, isBot: boolean): ClanWar =>
    ({ id: uid(ctx, 'w'), vs: vs.id, vsName: vs.name, vsTag: vs.tag, vsBadge: vs.badge, start: ctx.now, end, pts: {}, vsPts: 0, vsPower: power, vsBot: isBot });
  if (b) {
    a.war = mk(b, clanPower(b), false); b.war = mk(a, clanPower(a), false);
    b.searching = false;
    sysMsg(ctx, `clan:${b.id}`, `⚔ [${a.tag}] ${a.name}`);
  } else if (bot) a.war = mk({ id: 'bot:' + bot.tag, name: bot.name, tag: bot.tag, badge: bot.badge }, bot.power, true);
  a.searching = false;
  for (const m of a.members) m.warPts = 0;
  if (b) for (const m of b.members) m.warPts = 0;
  ctx.db.warQueue = ctx.db.warQueue.filter((x) => x !== a.id && x !== b?.id);
  sysMsg(ctx, `clan:${a.id}`, `⚔ [${a.war!.vsTag}] ${a.war!.vsName}`);
}
/** Pairs queued clans of similar power that aren't allied. */
export function matchWars(ctx: SocialCtx) {
  const q = ctx.db.warQueue.map((id) => ctx.db.clans[id]).filter((c): c is Clan => !!c && !c.war);
  q.sort((x, y) => clanPower(x) - clanPower(y));
  const used = new Set<string>();
  for (let i = 0; i < q.length; i++) {
    if (used.has(q[i].id)) continue;
    for (let j = i + 1; j < q.length; j++) {
      if (used.has(q[j].id) || q[i].allies.includes(q[j].id)) continue;
      startWar(ctx, q[i], q[j]); used.add(q[i].id); used.add(q[j].id); break;
    }
  }
  ctx.db.warQueue = ctx.db.warQueue.filter((id) => !used.has(id) && ctx.db.clans[id] && !ctx.db.clans[id].war);
}
/** If nobody is searching, pairs a clan with a computer-run rival so wars never stall. */
export function warVsBot(ctx: SocialCtx, clanId: string) {
  const c = ctx.db.clans[clanId];
  if (!c || c.war) return;
  const names = [['Iron Wolves', 'گرگ‌های آهنین', 'IRON'], ['Crimson Oath', 'پیمان سرخ', 'OATH'], ['Night Hawks', 'شاهین‌های شب', 'HAWK'], ['Storm Born', 'زادگان طوفان', 'STRM'], ['Ashen Crown', 'تاج خاکستر', 'ASH']];
  const n = names[Math.floor(ctx.rand() * names.length)];
  startWar(ctx, c, null, { name: n[0], tag: n[2], badge: Math.floor(ctx.rand() * 64), power: Math.round(clanPower(c) * (0.85 + ctx.rand() * 0.3)) });
}
export function warScore(db: SocialDb, c: Clan) {
  if (!c.war) return { our: 0, their: 0 };
  const our = Object.values(c.war.pts).reduce((a, b) => a + b, 0);
  let their = c.war.vsPts;
  if (!c.war.vsBot) { const o = db.clans[c.war.vs]; if (o?.war?.vs === c.id) their = Object.values(o.war.pts).reduce((a, b) => a + b, 0); }
  return { our, their };
}
/** Online match result → war points for the player's clan. */
export function warReport(ctx: SocialCtx, userId: string, won: boolean, kos: number) {
  const c = clanOf(ctx.db, userId);
  if (!c?.war || ctx.now > c.war.end) return 0;
  const pts = (won ? 3 : 1) + Math.min(3, kos);
  c.war.pts[userId] = (c.war.pts[userId] ?? 0) + pts;
  const m = memberOf(c, userId); if (m) m.warPts += pts;
  return pts;
}
/** Bot rivals score over time; finished wars pay out by mail. Call periodically. */
export function warTick(ctx: SocialCtx) {
  for (const c of Object.values(ctx.db.clans)) {
    const w = c.war;
    if (!w) continue;
    if (w.vsBot && ctx.now < w.end) {
      // expected bot pace: ~38 points per member over the war, scaled by relative power
      const progress = (ctx.now - w.start) / Math.max(1, w.end - w.start);
      const target = progress * 38 * Math.max(1, c.members.length) * (w.vsPower / Math.max(1, clanPower(c)));
      w.vsPts = Math.max(w.vsPts, Math.floor(target * (0.8 + ctx.rand() * 0.15)));
    }
    if (ctx.now < w.end) continue;
    const { our, their } = warScore(ctx.db, c);
    const won = our > their;
    const bonus = 1 + clanBonus(c.level).war;
    const reward: Reward = won
      ? { coins: Math.round(800 * bonus), gems: Math.round(30 * bonus), runes: Math.round(60 * bonus) }
      : { coins: Math.round(300 * bonus), runes: Math.round(20 * bonus) };
    for (const m of c.members) {
      const pr = ctx.profileOf(m.id);
      if (!pr || !(w.pts[m.id] > 0)) continue; // only members who fought
      sendMail(pr, {
        title: won ? `War won vs [${w.vsTag}]` : `War lost vs [${w.vsTag}]`, titleFa: won ? `پیروزی در جنگ مقابل [${w.vsTag}]` : `شکست در جنگ مقابل [${w.vsTag}]`,
        body: `${our} - ${their}`, bodyFa: `${our} - ${their}`, reward,
      }, ctx.now);
    }
    if (won) { c.warWins++; c.bank += 150; }
    c.warLog.unshift({ t: ctx.now, vsName: w.vsName, vsTag: w.vsTag, our, their, won });
    if (c.warLog.length > 10) c.warLog.length = 10;
    clanLog(c, won ? `Won the war vs [${w.vsTag}] ${our}-${their}` : `Lost the war vs [${w.vsTag}] ${our}-${their}`, won ? `جنگ با [${w.vsTag}] را بردیم ${our}-${their}` : `جنگ با [${w.vsTag}] را باختیم ${our}-${their}`, ctx.now);
    c.war = null;
  }
}

/** Keeps member cards (trophies, level, fighter) fresh. */
export function clanTouch(ctx: SocialCtx, p: Profile) {
  const c = clanOf(ctx.db, p.id);
  if (!c) { if (p.clan) p.clan = null; return; }
  const m = memberOf(c, p.id);
  if (!m) { delete ctx.db.userClan[p.id]; p.clan = null; return; }
  m.name = p.name; m.mmr = p.rank.mmr; m.level = p.level; m.fighter = getFighter(p.selFighter).id; m.seen = ctx.now;
  p.clan = clanRef(c, m.role);
}

/** Full clan view for the UI (join requests only for officers and up). */
export function clanView(db: SocialDb, c: Clan, viewer: string, isOnline: (id: string) => boolean = () => false) {
  const me = c.members.find((m) => m.id === viewer);
  return {
    ...clanSummary(c),
    bank: c.bank, nextCost: clanUpgradeCost(c), created: c.created,
    members: c.members.map((m) => ({ ...m, online: isOnline(m.id) })).sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || b.mmr - a.mmr),
    requests: me && ROLE_RANK[me.role] >= ROLE_RANK.elder ? c.requests : [],
    cardReqs: me ? c.cardReqs : [],
    allies: c.allies.map((id) => db.clans[id]).filter(Boolean).map((x) => clanSummary(x!)),
    allyIn: c.allyIn.map((id) => db.clans[id]).filter(Boolean).map((x) => clanSummary(x!)),
    allyOut: c.allyOut,
    war: c.war ? { ...c.war, ...warScore(db, c) } : null,
    warLog: c.warLog, searching: c.searching,
    log: c.log, member: !!me, myRole: me?.role ?? null,
  };
}
export type ClanView = ReturnType<typeof clanView>;

export function clanLeaderboard(db: SocialDb, limit = 50) {
  return Object.values(db.clans).sort((a, b) => clanPower(b) - clanPower(a) || b.warWins - a.warWins).slice(0, limit).map((c, i) => ({ pos: i + 1, ...clanSummary(c) }));
}

// ---- chat -------------------------------------------------------------------------------------------
export type ChatKind = 'global' | 'clan' | 'ally' | 'dm';
export function dmChannel(a: string, b: string) { return 'dm:' + [a, b].sort().join('|'); }

/** Resolves a requested channel to the storage keys the user may read/write. */
export function chatAccess(db: SocialDb, userId: string, ch: string): { read: string; write: string[] } | null {
  if (ch === 'global') return { read: 'global', write: ['global'] };
  const c = clanOf(db, userId);
  if (ch === 'clan') return c ? { read: `clan:${c.id}`, write: [`clan:${c.id}`] } : null;
  if (ch === 'ally') return c ? { read: `ally:${c.id}`, write: [`ally:${c.id}`, ...c.allies.map((a) => `ally:${a}`)] } : null;
  if (ch.startsWith('dm:')) {
    const other = ch.slice(3);
    if (!c || !memberOf(c, other) || other === userId) return null; // private chat only between clan mates
    const key = dmChannel(userId, other);
    return { read: key, write: [key] };
  }
  return null;
}

function pushMsg(ctx: SocialCtx, m: ChatMsg) {
  const list = (ctx.db.chats[m.ch] ??= []);
  list.push(m);
  if (list.length > CHAT_HISTORY) list.splice(0, list.length - CHAT_HISTORY);
}

export function isMuted(db: SocialDb, userId: string, now: number) { return (db.mutes[userId] ?? 0) > now; }

export function chatPost(ctx: SocialCtx, p: Profile, ch: string, raw: string): ChatMsg[] {
  if (ctx.db.bans[p.id]) fail('banned');
  if (isMuted(ctx.db, p.id, ctx.now)) fail('muted');
  const acc = chatAccess(ctx.db, p.id, ch) ?? fail('perm');
  const text0 = cleanText(raw, CHAT_MAX_LEN);
  if (!text0) fail('bad-input');
  // rate limit + repeated-message spam guard
  const rate = (ctx.db.rate ??= {});
  const r = rate[p.id] ?? { t: 0, last: '', rep: 0 };
  if (ctx.now - r.t < CHAT_COOLDOWN_MS) fail('rate');
  r.rep = text0 === r.last ? r.rep + 1 : 0;
  r.t = ctx.now; r.last = text0; rate[p.id] = r;
  if (r.rep >= 2) { ctx.db.mutes[p.id] = ctx.now + 10 * 60_000; modLog(ctx, 'auto', 'mute', p.id, 'spam'); fail('muted'); }
  const { text, flagged } = filterText(text0);
  if (flagged) ctx.db.warns[p.id] = (ctx.db.warns[p.id] ?? 0) + 0.25;
  const c = clanOf(ctx.db, p.id);
  const m = c ? memberOf(c, p.id) : null;
  const out: ChatMsg[] = [];
  const id = uid(ctx, 'c');
  for (const key of acc.write) {
    const msg: ChatMsg = { id, ch: key, uid: p.id, name: p.name, tag: c?.tag, role: m?.role, lvl: p.level, text, t: ctx.now };
    pushMsg(ctx, msg); out.push(msg);
  }
  return out;
}
export function chatHistory(db: SocialDb, userId: string, ch: string): ChatMsg[] {
  const acc = chatAccess(db, userId, ch);
  return acc ? db.chats[acc.read] ?? [] : [];
}
/** Lists DM threads (clan mates) with the last message. */
export function dmThreads(db: SocialDb, userId: string) {
  const c = clanOf(db, userId);
  if (!c) return [];
  return c.members.filter((m) => m.id !== userId).map((m) => {
    const list = db.chats[dmChannel(userId, m.id)] ?? [];
    return { id: m.id, name: m.name, role: m.role, last: list[list.length - 1] ?? null };
  }).sort((a, b) => (b.last?.t ?? 0) - (a.last?.t ?? 0));
}

// Profanity filter (fa + en). Matching is done on a normalised copy (Arabic → Persian letters,
// no zero-width chars or repeated letters) so simple obfuscation doesn't slip through.
const BAD_WORDS = [
  'fuck', 'fuk', 'shit', 'bitch', 'cunt', 'dick', 'pussy', 'asshole', 'bastard', 'whore', 'slut', 'nigger', 'nigga', 'faggot', 'retard', 'motherfucker',
  'کیر', 'کیری', 'کس', 'کسکش', 'کس‌کش', 'کونی', 'کون', 'جنده', 'جندە', 'گایید', 'بگا', 'گاییدم', 'مادرجنده', 'لاشی', 'حرومزاده', 'حرامزاده', 'سگ‌پدر', 'ننت', 'خارکسده', 'کسخل', 'کصکش', 'کص', 'جاکش', 'دیوث', 'پفیوز',
];
const norm = (s: string) => s.toLowerCase().replace(/[ي]/g, 'ی').replace(/[ك]/g, 'ک').replace(/[‌‍ً-ٟ]/g, '').replace(/(.)\1{2,}/g, '$1');
const LINK = /(https?:\/\/|www\.|t\.me\/|\b[a-z0-9-]+\.(com|ir|net|org|xyz|io|me)\b)/i;
export function filterText(s: string): { text: string; flagged: boolean } {
  let flagged = false;
  const words = s.split(/(\s+)/);
  const out = words.map((w) => {
    if (/^\s+$/.test(w)) return w;
    const n = norm(w).replace(/[^\p{L}\p{N}]/gu, '');
    if (!n) return w;
    if (BAD_WORDS.some((b) => n === b || (b.length >= 4 && n.includes(b)))) { flagged = true; return '*'.repeat(Math.min(6, w.length)); }
    if (LINK.test(w)) { flagged = true; return '[link]'; }
    return w;
  });
  // long digit runs (phone numbers) are blocked to protect players
  const text = out.join('').replace(/(\+?\d[\d\s-]{8,}\d)/g, () => { flagged = true; return '[#]'; });
  return { text, flagged };
}

// ---- reports & moderation ("game police") -----------------------------------------------------------------
export function reportPlayer(ctx: SocialCtx, p: Profile, inp: { target: string; targetName?: string; msgId?: string; ch?: string; reason: string }) {
  if (inp.target === p.id) fail('bad-input');
  const reasons = ['abuse', 'spam', 'cheat', 'name', 'other'];
  const reason = reasons.includes(inp.reason) ? inp.reason : 'other';
  const recent = ctx.db.reports.filter((r) => r.by === p.id && ctx.now - r.t < 3600_000);
  if (recent.length >= 10) fail('rate');
  let text: string | undefined, ch: string | undefined, name = cleanText(inp.targetName, 20);
  if (inp.msgId) {
    for (const [key, list] of Object.entries(ctx.db.chats)) {
      const m = list.find((x) => x.id === inp.msgId && x.uid === inp.target);
      if (m) { text = m.text; ch = key; name = m.name; break; }
    }
  }
  const r: Report = { id: uid(ctx, 'p'), t: ctx.now, by: p.id, byName: p.name, target: inp.target, targetName: name || inp.target, msgId: inp.msgId, text, ch, reason, status: 'open' };
  ctx.db.reports.unshift(r);
  if (ctx.db.reports.length > 500) ctx.db.reports.length = 500;
  // automatic protection: 3 different reporters within an hour → 30 min mute until a moderator reviews
  const reporters = new Set(ctx.db.reports.filter((x) => x.target === inp.target && x.status === 'open' && ctx.now - x.t < 3600_000).map((x) => x.by));
  if (reporters.size >= 3 && !isMuted(ctx.db, inp.target, ctx.now)) { ctx.db.mutes[inp.target] = ctx.now + 30 * 60_000; modLog(ctx, 'auto', 'mute', inp.target, 'reports'); }
  return r;
}

export function staffRole(db: SocialDb, userId: string): StaffRole | null { return db.roles[userId] ?? null; }
function needStaff(ctx: SocialCtx, p: Profile, admin = false) {
  const r = staffRole(ctx.db, p.id);
  if (!r || (admin && r !== 'admin')) fail('perm');
}
function modLog(ctx: SocialCtx, by: string, action: string, target: string, note?: string) {
  ctx.db.modlog.unshift({ t: ctx.now, by, action, target, note });
  if (ctx.db.modlog.length > 300) ctx.db.modlog.length = 300;
}
export type ModAction = 'mute' | 'unmute' | 'ban' | 'unban' | 'warn' | 'delete' | 'dismiss' | 'rename';
export function moderate(ctx: SocialCtx, p: Profile, inp: { action: ModAction; target: string; minutes?: number; msgId?: string; reportId?: string; note?: string }) {
  needStaff(ctx, p);
  const t = inp.target;
  if (staffRole(ctx.db, t) === 'admin' && inp.action !== 'dismiss') fail('perm');
  const note = cleanText(inp.note, 120);
  switch (inp.action) {
    case 'mute': ctx.db.mutes[t] = ctx.now + Math.max(1, Math.min(60 * 24 * 30, inp.minutes ?? 60)) * 60_000; break;
    case 'unmute': delete ctx.db.mutes[t]; break;
    case 'ban': if (staffRole(ctx.db, p.id) !== 'admin' && staffRole(ctx.db, t)) fail('perm'); ctx.db.bans[t] = note || 'rules'; break;
    case 'unban': delete ctx.db.bans[t]; break;
    case 'warn': {
      ctx.db.warns[t] = (ctx.db.warns[t] ?? 0) + 1;
      const pr = ctx.profileOf(t);
      if (pr) sendMail(pr, { title: 'Warning from the Game Police', titleFa: 'اخطار پلیس بازی', body: note || 'Please follow the community rules.', bodyFa: note || 'لطفاً قوانین بازی را رعایت کنید.' }, ctx.now);
      break;
    }
    case 'rename': { const pr = ctx.profileOf(t); if (pr) pr.name = 'Player' + Math.floor(1000 + ctx.rand() * 9000); break; }
    case 'delete': {
      for (const list of Object.values(ctx.db.chats)) {
        for (const m of list) if (m.id === inp.msgId) { m.text = '—'; m.sys = true; }
      }
      break;
    }
    case 'dismiss': break;
    default: fail('bad-input');
  }
  if (inp.reportId || inp.action !== 'delete') {
    for (const r of ctx.db.reports) {
      if ((inp.reportId && r.id === inp.reportId) || (!inp.reportId && r.target === t && r.status === 'open')) { r.status = 'done'; r.action = inp.action; }
    }
  }
  modLog(ctx, p.id, inp.action, t, note);
}
export function setStaff(ctx: SocialCtx, p: Profile | null, target: string, role: StaffRole | null) {
  if (p) needStaff(ctx, p, true);
  if (role) ctx.db.roles[target] = role; else delete ctx.db.roles[target];
  modLog(ctx, p?.id ?? 'console', 'role:' + (role ?? 'none'), target);
}
export function policeView(ctx: SocialCtx, p: Profile) {
  needStaff(ctx, p);
  return {
    role: staffRole(ctx.db, p.id)!,
    reports: ctx.db.reports.filter((r) => r.status === 'open').slice(0, 100),
    mutes: Object.entries(ctx.db.mutes).filter(([, until]) => until > ctx.now).map(([id, until]) => ({ id, until })),
    bans: Object.entries(ctx.db.bans).map(([id, reason]) => ({ id, reason })),
    log: ctx.db.modlog.slice(0, 60),
    promos: staffRole(ctx.db, p.id) === 'admin' ? Object.values(ctx.db.promos) : [],
    staff: Object.entries(ctx.db.roles).map(([id, role]) => ({ id, role })),
  };
}
export type PoliceView = ReturnType<typeof policeView>;

// ---- promo codes ------------------------------------------------------------------------------------------
export function promoCreate(ctx: SocialCtx, p: Profile | null, inp: { code: string; reward: unknown; maxUses?: number; days?: number; minLevel?: number; note?: string }): Promo {
  if (p) needStaff(ctx, p, true);
  const code = String(inp.code ?? '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
  if (code.length < 4) fail('bad-input');
  const reward = cleanReward(inp.reward);
  if (!Object.keys(reward).length) fail('bad-input');
  const promo: Promo = {
    code, reward, maxUses: Math.max(1, Math.min(1_000_000, Math.floor(inp.maxUses ?? 1000))), uses: ctx.db.promos[code]?.uses ?? 0,
    expires: inp.days ? ctx.now + Math.max(1, inp.days) * 86400_000 : 0, minLevel: Math.max(0, Math.floor(inp.minLevel ?? 0)),
    created: ctx.now, by: p?.id ?? 'console', note: cleanText(inp.note, 80),
  };
  ctx.db.promos[code] = promo;
  modLog(ctx, promo.by, 'promo', code, JSON.stringify(reward));
  return promo;
}
export function promoToggle(ctx: SocialCtx, p: Profile, code: string, off: boolean) {
  needStaff(ctx, p, true);
  const pr = ctx.db.promos[code] ?? fail('not-found');
  pr.off = off;
  return pr;
}
export function redeemCode(ctx: SocialCtx, p: Profile, raw: string): Granted {
  const code = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
  const pr = ctx.db.promos[code] ?? fail('not-found');
  if (pr.off || (pr.expires && ctx.now > pr.expires)) fail('expired');
  if (pr.uses >= pr.maxUses) fail('used-up');
  if (p.level < pr.minLevel) fail('level');
  const used = (ctx.db.redeemed[code] ??= []);
  if (used.includes(p.id)) fail('already');
  used.push(p.id); pr.uses++;
  return grantReward(p, pr.reward, ctx.rand);
}
