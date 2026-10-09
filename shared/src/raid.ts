import type { Profile } from './economy.ts';
import type { FighterMods } from './types.ts';
import { getFighter } from './fighters.ts';
import { noteRaidStars } from './cosmetics.ts';
import { fighterMods, sendMail, type Reward } from './progress.ts';
import {
  clanLog, clanOf, fail, memberOf, myClan, ROLE_RANK, sysMsg, uid,
  type Clan, type ClanRaidState, type SocialCtx,
} from './social.ts';

// =====================================================================================
//  Clan attacks ("raids")
//
//  A clan's leader or deputy declares an attack on another clan for a chosen time, at least
//  one hour ahead, so the defenders can prepare (pick their 5 defenders, fortify with gems,
//  call allies for help). When the hour comes the raid opens for one hour: every attacker
//  member gets two attacks against the defenders' fighters (the defender's own fighter,
//  upgrades and spell, played by the AI and boosted by fortifications). Each defender has
//  three stars; the attacker wins by taking at least half of all stars.
//
//  Declaring is deliberately expensive and rare, so nobody can spam wars:
//   • a war banner is needed (one regenerates per day, max two stored)
//   • a fee from the clan treasury that grows with the target's level
//   • attacker needs clan level 2+ and at least 3 members; leader/deputy only
//   • target must be within 60%–180% of the attacker's power (no bullying tiny clans)
//   • one outgoing and one incoming raid at a time, no allies
//   • 12 h attacker cooldown after a raid, 72 h before hitting the same clan again
//   • defenders get a 24 h shield after a raid, new clans 48 h protection
//   • a declaration can be withdrawn before it starts, but the banner and fee are lost
// =====================================================================================

const H = 3600_000;
export const RAID = {
  minLead: H, maxLead: 48 * H, duration: H,
  slots: 5, helperSlots: 2, attacksPerMember: 2,
  minMembers: 3, minLevel: 2,
  bannerEvery: 24 * H, maxBanners: 2,
  powerBand: [0.6, 1.8] as const,
  shieldAfter: 24 * H, newClanProtect: 48 * H, sameTargetCd: 72 * H, attackerCd: 12 * H,
  winRatio: 0.5, fortMax: 3,
  fightMaxMs: 20 * 60_000,
};
export const raidFee = (defLevel: number) => 100 + 50 * defLevel;
export const fortCost = (lvl: number) => 150 * (lvl + 1);

export interface DefSlot {
  uid: string; name: string; fighter: string; skin: number; mmr: number; level: number;
  mods: FighterMods; stars: number; helper?: string; // helper = ally clan tag
}
export interface RaidAttack { uid: string; name: string; slot: number; stars: number; t: number }
export interface Raid {
  id: string;
  att: string; attName: string; attTag: string; attBadge: number;
  def: string; defName: string; defTag: string; defBadge: number;
  declared: number; start: number; end: number;
  status: 'declared' | 'live' | 'done';
  slots: DefSlot[];
  fort: number;
  attacks: RaidAttack[];
  used: Record<string, number>;   // attacker uid -> attacks used
  result?: { stars: number; max: number; won: boolean; loot: number };
}
export interface RaidFight { id: string; raid: string; uid: string; slot: number; seed: number; issued: number; foe: { charId: string; skin: number; lv: number; mods: FighterMods; name: string }; stage: string }

/** Timing overrides for the offline demo (minutes instead of hours). */
export interface RaidTiming { minLead: number; duration: number }

export function raidState(c: Clan): ClanRaidState {
  c.rd ??= { banners: 1, bannerAt: c.created, shieldUntil: c.created + RAID.newClanProtect, cdUntil: 0, hits: {}, out: null, in: null, trophies: 0, log: [] };
  return c.rd;
}
function regenBanners(c: Clan, now: number) {
  const rd = raidState(c);
  while (rd.banners < RAID.maxBanners && now - rd.bannerAt >= RAID.bannerEvery) { rd.banners++; rd.bannerAt += RAID.bannerEvery; }
  if (rd.banners >= RAID.maxBanners) rd.bannerAt = now;
  return rd;
}
const raids = (ctx: SocialCtx) => (ctx.db.raids ??= {});

/** Strength used for matchmaking raids: the five strongest members (= the defense lineup size). */
export function raidPower(c: Clan) { return [...c.members].map((m) => m.mmr).sort((a, b) => b - a).slice(0, RAID.slots).reduce((a, b) => a + b, 0); }

/** Why a clan can't be attacked right now (null = it can). Used for the UI and declare(). */
export function raidBlock(ctx: SocialCtx, att: Clan, def: Clan): string | null {
  const a = regenBanners(att, ctx.now), d = raidState(def);
  if (att.id === def.id) return 'self';
  if (att.allies.includes(def.id)) return 'ally';
  if (att.level < RAID.minLevel) return 'level';
  if (att.members.length < RAID.minMembers) return 'members';
  if (a.out) return 'busy';
  if (ctx.now < a.cdUntil) return 'cooldown';
  if (a.banners <= 0) return 'banner';
  if (d.in) return 'target-busy';
  if (ctx.now < d.shieldUntil) return 'shield';
  if (a.hits[def.id] && ctx.now - a.hits[def.id] < RAID.sameTargetCd) return 'recent';
  const ratio = raidPower(def) / Math.max(1, raidPower(att));
  if (ratio < RAID.powerBand[0]) return 'weak';
  if (ratio > RAID.powerBand[1]) return 'strong';
  if (att.bank < raidFee(def.level)) return 'funds';
  return null;
}

/** Leader/deputy declares an attack starting at `start` (≥ 1 h from now). */
export function raidDeclare(ctx: SocialCtx, p: Profile, targetId: string, start: number, timing?: RaidTiming): Raid {
  const { c } = myClan(ctx, p, 'co');
  const def = ctx.db.clans[targetId] ?? fail('not-found');
  const block = raidBlock(ctx, c, def);
  if (block) fail('raid-' + block);
  const minLead = timing?.minLead ?? RAID.minLead;
  if (!(start >= ctx.now + minLead - 1000 && start <= ctx.now + RAID.maxLead)) fail('raid-time');
  const a = raidState(c), d = raidState(def);
  a.banners--; if (a.banners < RAID.maxBanners) a.bannerAt = a.bannerAt || ctx.now;
  c.bank -= raidFee(def.level);
  const r: Raid = {
    id: uid(ctx, 'x'),
    att: c.id, attName: c.name, attTag: c.tag, attBadge: c.badge,
    def: def.id, defName: def.name, defTag: def.tag, defBadge: def.badge,
    declared: ctx.now, start, end: start + (timing?.duration ?? RAID.duration),
    status: 'declared', slots: autoLineup(ctx, def), fort: 0, attacks: [], used: {},
  };
  raids(ctx)[r.id] = r;
  a.out = r.id; d.in = r.id;
  clanLog(c, `Declared an attack on [${def.tag}] ${def.name}`, `به قبیله [${def.tag}] ${def.name} اعلام حمله کردیم`, ctx.now);
  clanLog(def, `[${c.tag}] ${c.name} declared an attack on us!`, `قبیله [${c.tag}] ${c.name} به ما اعلام حمله کرد!`, ctx.now);
  sysMsg(ctx, `clan:${c.id}`, `⚔ → [${def.tag}]`);
  sysMsg(ctx, `clan:${def.id}`, `⚠ [${c.tag}] ⚔`);
  for (const m of def.members) {
    const pr = ctx.profileOf(m.id);
    if (pr) sendMail(pr, { title: `[${c.tag}] declared an attack`, titleFa: `قبیله [${c.tag}] اعلام حمله کرد`, body: 'Prepare your defense before the attack starts.', bodyFa: 'قبل از شروع حمله دفاع را آماده کنید.' }, ctx.now);
  }
  return r;
}

/** Defenders: by default the 5 strongest members (trophies + level). */
function autoLineup(ctx: SocialCtx, def: Clan): DefSlot[] {
  return [...def.members].sort((a, b) => (b.mmr + b.level * 20) - (a.mmr + a.level * 20)).slice(0, RAID.slots).map((m) => slotFor(ctx, m.id, m.name, m.fighter, m.mmr, m.level));
}
function slotFor(ctx: SocialCtx, id: string, name: string, fighter: string, mmr: number, level: number, helper?: string): DefSlot {
  const pr = ctx.profileOf(id);
  const fid = getFighter(pr?.selFighter ?? fighter).id;
  // a real defender brings their own upgrades + spell; computer members get a level-based kit
  const mods: FighterMods = pr ? fighterMods(pr, fid) : { atk: 1 + Math.min(10, level / 3) * 0.02, def: 1 - Math.min(10, level / 3) * 0.015, hp: 1 + Math.min(10, level / 3) * 0.02, spell: ['nova', 'frost', 'thunder', 'heal'][level % 4], spellLv: Math.min(5, 1 + Math.floor(level / 8)) };
  return { uid: id, name, fighter: fid, skin: pr?.selSkin?.[fid] ?? (level % 3), mmr, level, mods, stars: 0, helper };
}

export function raidOf(ctx: SocialCtx, id: string) { return raids(ctx)[id] ?? null; }
function myRaidAsDefender(ctx: SocialCtx, p: Profile, raidId: string) {
  const { c } = myClan(ctx, p, 'co');
  const r = raids(ctx)[raidId] ?? fail('not-found');
  if (r.def !== c.id) fail('perm');
  if (r.status !== 'declared') fail('raid-started');
  return { c, r };
}

/** Defender leader/deputy picks who defends (members only; helpers are added by allies). */
export function raidSetLineup(ctx: SocialCtx, p: Profile, raidId: string, uids: string[]) {
  const { c, r } = myRaidAsDefender(ctx, p, raidId);
  const picked = [...new Set(uids)].slice(0, RAID.slots).map((id) => memberOf(c, id) ?? fail('not-found'));
  if (!picked.length) fail('bad-input');
  const helpers = r.slots.filter((s) => s.helper);
  r.slots = [...picked.map((m) => slotFor(ctx, m.id, m.name, m.fighter, m.mmr, m.level)), ...helpers];
  return r;
}
/** Defender spends treasury gems on walls: each level = −5% damage taken and +5% knockback resistance. */
export function raidFortify(ctx: SocialCtx, p: Profile, raidId: string) {
  const { c, r } = myRaidAsDefender(ctx, p, raidId);
  if (r.fort >= RAID.fortMax) fail('max');
  const cost = fortCost(r.fort);
  if (c.bank < cost) fail('funds');
  c.bank -= cost; r.fort++;
  clanLog(c, `Fortified the defense (level ${r.fort})`, `دفاع تقویت شد (سطح ${r.fort})`, ctx.now);
  return r;
}
/** A member of an allied clan volunteers as an extra defender (max 2 helpers). */
export function raidHelp(ctx: SocialCtx, p: Profile, raidId: string) {
  const { c, m } = myClan(ctx, p);
  const r = raids(ctx)[raidId] ?? fail('not-found');
  if (r.status !== 'declared') fail('raid-started');
  const def = ctx.db.clans[r.def];
  if (!def || !def.allies.includes(c.id)) fail('perm');
  if (r.slots.some((s) => s.uid === p.id)) fail('already');
  if (r.slots.filter((s) => s.helper).length >= RAID.helperSlots) fail('limit');
  r.slots.push(slotFor(ctx, p.id, p.name, p.selFighter, p.rank.mmr, p.level, c.tag));
  sysMsg(ctx, `clan:${def.id}`, `🛡 +${m.name} [${c.tag}]`);
  return r;
}
export function raidWithdraw(ctx: SocialCtx, p: Profile) {
  const { c } = myClan(ctx, p, 'co');
  const a = raidState(c);
  const r = a.out ? raids(ctx)[a.out] : null;
  if (!r || r.status !== 'declared') return fail('raid-started');
  r.status = 'done'; r.result = { stars: 0, max: 0, won: false, loot: 0 };
  a.out = null; a.cdUntil = ctx.now + RAID.attackerCd;
  const d = ctx.db.clans[r.def]; if (d) raidState(d).in = null;
  clanLog(c, `Withdrew the attack on [${r.defTag}]`, `حمله به [${r.defTag}] لغو شد`, ctx.now);
  return r;
}

const defMods = (s: DefSlot, fort: number): FighterMods => ({ ...s.mods, def: s.mods.def * (1 - 0.05 * fort), hp: s.mods.hp * (1 + 0.05 * fort) });

/** Attacker member starts a fight against a defender slot; the server keeps the ticket. */
export function raidFightStart(ctx: SocialCtx, p: Profile, raidId: string, slot: number): RaidFight {
  const { c } = myClan(ctx, p);
  const r = raids(ctx)[raidId] ?? fail('not-found');
  if (r.att !== c.id) fail('perm');
  if (r.status !== 'live' || ctx.now < r.start || ctx.now >= r.end) fail('raid-closed');
  if ((r.used[p.id] ?? 0) >= RAID.attacksPerMember) fail('limit');
  const s = r.slots[slot] ?? fail('bad-input');
  if (s.stars >= 3) fail('raid-cleared');
  const fights = (ctx.db.fights ??= {});
  for (const [k, f] of Object.entries(fights)) if (ctx.now - f.issued > RAID.fightMaxMs) delete fights[k];
  if (Object.values(fights).some((f) => f.uid === p.id)) fail('raid-in-fight');
  r.used[p.id] = (r.used[p.id] ?? 0) + 1;  // an abandoned fight still costs the attack
  const lv = Math.max(3, Math.min(9, Math.round((s.mmr - 700) / 150) + 1 + r.fort));
  const stages = ['persepolis', 'cathedral', 'forge', 'glacier', 'garden', 'canyon'];
  const f: RaidFight = {
    id: uid(ctx, 'f'), raid: r.id, uid: p.id, slot, seed: Math.floor(ctx.rand() * 1e9), issued: ctx.now,
    foe: { charId: s.fighter, skin: s.skin, lv, mods: defMods(s, r.fort), name: s.name }, stage: stages[slot % stages.length],
  };
  fights[f.id] = f;
  return f;
}

export interface FightResult { won: boolean; falls: number; kos: number; durationSec: number; dmg: number }
/** Stars: win = 1, + no falls, + under two minutes. */
export function raidStars(r: FightResult) { return r.won ? 1 + (r.falls === 0 ? 1 : 0) + (r.durationSec <= 120 ? 1 : 0) : 0; }

/** Reports a raid fight. Rejects reports that don't fit the ticket (time, duration, stats). */
export function raidFightEnd(ctx: SocialCtx, p: Profile, fightId: string, res: FightResult): { stars: number; raid: Raid } {
  const fights = (ctx.db.fights ??= {});
  const f = fights[fightId] ?? fail('not-found');
  if (f.uid !== p.id) fail('perm');
  delete fights[fightId];
  const r = raids(ctx)[f.raid] ?? fail('not-found');
  const elapsed = (ctx.now - f.issued) / 1000;
  // the claimed match can't be longer than the real time since the ticket, nor absurdly short
  const suspicious = res.durationSec > elapsed + 5 || (res.won && res.durationSec < 15) || res.dmg > res.durationSec * 30 || elapsed * 1000 > RAID.fightMaxMs;
  if (suspicious) { flagCheat(ctx, p, 'raid', `claimed ${Math.round(res.durationSec)}s in ${Math.round(elapsed)}s, dmg ${Math.round(res.dmg)}`, 4); fail('cheat'); }
  if (r.status !== 'live' && ctx.now > r.end + 5 * 60_000) fail('raid-closed'); // small grace for fights started in time
  const stars = raidStars(res);
  noteRaidStars(p, stars);
  const s = r.slots[f.slot];
  if (s) s.stars = Math.max(s.stars, stars);
  r.attacks.unshift({ uid: p.id, name: p.name, slot: f.slot, stars, t: ctx.now });
  return { stars, raid: r };
}

/** Moves raids through declared → live → done and pays out. Call periodically. */
export function raidTick(ctx: SocialCtx) {
  for (const r of Object.values(raids(ctx))) {
    if (r.status === 'declared' && ctx.now >= r.start) {
      r.status = 'live';
      sysMsg(ctx, `clan:${r.att}`, `⚔ LIVE → [${r.defTag}]`);
      sysMsg(ctx, `clan:${r.def}`, `🛡 LIVE ← [${r.attTag}]`);
    }
    if (r.status === 'live' && ctx.now >= r.end) finishRaid(ctx, r);
    // keep a week of history
    if (r.status === 'done' && ctx.now - r.end > 7 * 24 * H) delete raids(ctx)[r.id];
  }
}

function finishRaid(ctx: SocialCtx, r: Raid) {
  r.status = 'done';
  const stars = r.slots.reduce((a, s) => a + s.stars, 0);
  const max = r.slots.length * 3;
  const won = max > 0 && stars / max >= RAID.winRatio;
  const att = ctx.db.clans[r.att], def = ctx.db.clans[r.def];
  let loot = 0;
  if (won && def && att) { loot = Math.min(400, Math.floor(def.bank * 0.1)); def.bank -= loot; att.bank += loot; }
  r.result = { stars, max, won, loot };
  const pay = (ids: string[], reward: Reward, title: string, titleFa: string) => {
    for (const id of ids) { const pr = ctx.profileOf(id); if (pr) sendMail(pr, { title, titleFa, body: `${stars}/${max} ★`, bodyFa: `${stars}/${max} ★`, reward }, ctx.now); }
  };
  const attackers = [...new Set(r.attacks.map((a) => a.uid))];
  const defenders = r.slots.map((s) => s.uid);
  if (att) {
    const a = raidState(att);
    a.out = null; a.cdUntil = ctx.now + RAID.attackerCd; a.hits[r.def] = ctx.now;
    a.trophies = Math.max(0, a.trophies + (won ? 30 : -15));
    a.log.unshift({ t: ctx.now, raid: r.id, vsName: r.defName, vsTag: r.defTag, attacker: true, our: stars, max, won });
    a.log.length = Math.min(a.log.length, 15);
    clanLog(att, won ? `Raid on [${r.defTag}] won ${stars}/${max}★ (+${loot} gems)` : `Raid on [${r.defTag}] failed ${stars}/${max}★`, won ? `حمله به [${r.defTag}] پیروز شد ${stars}/${max}★ (+${loot} الماس)` : `حمله به [${r.defTag}] شکست خورد ${stars}/${max}★`, ctx.now);
    pay(attackers, won ? { runes: 80, coins: 1000, gems: 20 } : { runes: 20, coins: 300 }, won ? `Raid victory vs [${r.defTag}]` : `Raid lost vs [${r.defTag}]`, won ? `پیروزی در حمله به [${r.defTag}]` : `شکست در حمله به [${r.defTag}]`);
  }
  if (def) {
    const d = raidState(def);
    d.in = null; d.shieldUntil = ctx.now + RAID.shieldAfter;
    d.trophies = Math.max(0, d.trophies + (won ? -15 : 30));
    d.log.unshift({ t: ctx.now, raid: r.id, vsName: r.attName, vsTag: r.attTag, attacker: false, our: max - stars, max, won: !won });
    d.log.length = Math.min(d.log.length, 15);
    clanLog(def, won ? `[${r.attTag}] broke our defense ${stars}/${max}★` : `We held off [${r.attTag}] (${stars}/${max}★)`, won ? `[${r.attTag}] دفاع ما را شکست ${stars}/${max}★` : `حمله [${r.attTag}] را دفع کردیم (${stars}/${max}★)`, ctx.now);
    pay(defenders.filter((id) => memberOf(def, id)), won ? { runes: 15, coins: 200 } : { runes: 60, coins: 800, gems: 15 }, won ? `Defense lost vs [${r.attTag}]` : `Defense held vs [${r.attTag}]`, won ? `دفاع در برابر [${r.attTag}] شکست خورد` : `دفاع موفق در برابر [${r.attTag}]`);
  }
  // allied helpers are thanked either way
  for (const s of r.slots.filter((x) => x.helper)) { const pr = ctx.profileOf(s.uid); if (pr) sendMail(pr, { title: `Thanks for defending [${r.defTag}]`, titleFa: `ممنون از کمک به دفاع [${r.defTag}]`, reward: { runes: 25, coins: 300 } }, ctx.now); }
}

/** Raid info for a clan screen. */
export function raidView(ctx: SocialCtx, c: Clan) {
  const rd = regenBanners(c, ctx.now);
  const out = rd.out ? raids(ctx)[rd.out] ?? null : null;
  const inc = rd.in ? raids(ctx)[rd.in] ?? null : null;
  const helping = Object.values(raids(ctx)).filter((r) => r.status === 'declared' && c.allies.includes(r.def));
  return { banners: rd.banners, nextBanner: rd.banners >= RAID.maxBanners ? 0 : rd.bannerAt + RAID.bannerEvery, shieldUntil: rd.shieldUntil, cdUntil: rd.cdUntil, trophies: rd.trophies, log: rd.log, out, inc, helping };
}
export type RaidView = ReturnType<typeof raidView>;

/** Targets list with the reason each one is (not) attackable. */
export function raidTargets(ctx: SocialCtx, p: Profile, q = '') {
  const c = clanOf(ctx.db, p.id) ?? fail('no-clan');
  const s = q.trim().toLowerCase();
  return Object.values(ctx.db.clans)
    .filter((x) => x.id !== c.id && (!s || x.name.toLowerCase().includes(s) || x.tag.toLowerCase().includes(s)))
    .map((x) => ({ id: x.id, name: x.name, tag: x.tag, badge: x.badge, level: x.level, members: x.members.length, power: raidPower(x), trophies: raidState(x).trophies, fee: raidFee(x.level), block: raidBlock(ctx, c, x) }))
    .sort((a, b) => Number(!!a.block) - Number(!!b.block) || Math.abs(a.power - raidPower(c)) - Math.abs(b.power - raidPower(c)))
    .slice(0, 40);
}

/** Can this member attack in the raid (role check is in raidFightStart). */
export function raidAttacksLeft(r: Raid, userId: string) { return Math.max(0, RAID.attacksPerMember - (r.used[userId] ?? 0)); }
export { ROLE_RANK };

// anti-cheat hook (implemented in anticheat.ts; imported lazily to avoid a cycle at load time)
import { flagCheat } from './anticheat.ts';
