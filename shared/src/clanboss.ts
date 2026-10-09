import { getFighter } from './fighters.ts';
import { dayKey, type Profile } from './economy.ts';
import { fighterMods, sendMail, type Reward } from './progress.ts';
import { weekId, weekWindow } from './league.ts';
import { clanOf, fail, memberOf, uid, type Clan, type SocialCtx, type SocialDb } from './social.ts';
import type { MatchConfig } from './types.ts';

// =====================================================================================
//  Clan co-op boss (weekly)
//  Every league week a giant boss (a real fighter with a huge size / HP / armor kit) attacks.
//  Each clan member gets 2 attempts per day: a PvE fight (90 s) against the boss. All damage
//  dealt adds up to the clan's total for the week. At the thresholds the clan unlocks reward
//  tiers; when the week ends every member who took part gets the tiers reached by mail.
//  The clan screen shows the total, the tiers and the top damage dealers. Reset weekly.
// =====================================================================================

declare module './social.ts' {
  interface SocialDb {
    cboss?: Record<string, ClanBossState>;
    cbossFights?: Record<string, BossFight>;
  }
}

export interface ClanBossState {
  week: number;
  total: number;
  dmg: Record<string, number>;        // member id -> damage this week
  names: Record<string, string>;
  att: Record<string, { day: string; n: number }>;
  fights: number;
}
export interface BossDef { id: string; charId: string; name: string; nameFa: string; title: string; titleFa: string; stage: string; color: string }
export interface BossFight { id: string; uid: string; clan: string; week: number; seed: number; issued: number; boss: string }

export const CLAN_BOSS = { attemptsPerDay: 2, fightSec: 90, hpMax: 900, scale: 2.1, weight: 3.2, atk: 1.35 };
export const BOSSES: BossDef[] = [
  { id: 'colossus', charId: 'boulder', name: 'The Colossus', nameFa: 'غول سنگی', title: 'Mountain that walks', titleFa: 'کوهی که راه می‌رود', stage: 'canyon', color: '#ffb347' },
  { id: 'wyrm', charId: 'azhi', name: 'Azhdaha', nameFa: 'اژدها', title: 'Serpent of the deep', titleFa: 'مار ژرفا', stage: 'temple', color: '#2ee6a6' },
  { id: 'warlord', charId: 'azar', name: 'Fire Warlord', nameFa: 'سردار آتش', title: 'Lord of the forge', titleFa: 'ارباب کوره', stage: 'forge', color: '#ff7a2a' },
  { id: 'ursa', charId: 'ursa', name: 'Frost Ursa', nameFa: 'خرس یخی', title: 'Glacier guardian', titleFa: 'نگهبان یخچال', stage: 'glacier', color: '#9ad8ff' },
];
export const BOSS_TIERS: { dmg: number; reward: Reward }[] = [
  { dmg: 1500, reward: { coins: 500, runes: 20 } },
  { dmg: 4000, reward: { coins: 800, anyCards: 6 } },
  { dmg: 8000, reward: { gems: 20, runes: 40 } },
  { dmg: 14000, reward: { crates: 1, runes: 60 } },
  { dmg: 22000, reward: { gems: 50, runes: 100, anyCards: 12 } },
];

export function bossForWeek(week: number): BossDef { return BOSSES[((week % BOSSES.length) + BOSSES.length) % BOSSES.length]; }
export function tiersReached(total: number) { return BOSS_TIERS.filter((t) => total >= t.dmg).length; }

/** Sum of the tier rewards reached (paid to every participant). */
export function tierRewards(n: number): Reward {
  const r: Reward = {};
  for (const t of BOSS_TIERS.slice(0, n)) for (const [k, v] of Object.entries(t.reward) as [keyof Reward, number][]) (r as any)[k] = ((r as any)[k] ?? 0) + v;
  return r;
}

function states(db: SocialDb) { return (db.cboss ??= {}); }

/** The clan's boss state for this week (settles + resets a finished week first). */
export function clanBossState(ctx: SocialCtx, clanId: string): ClanBossState {
  const all = states(ctx.db);
  const week = weekId(ctx.now);
  let s = all[clanId];
  if (s && s.week !== week) { settleClanBoss(ctx, clanId, s); s = undefined as unknown as ClanBossState; }
  if (!s) s = all[clanId] = { week, total: 0, dmg: {}, names: {}, att: {}, fights: 0 };
  return s;
}

/** Mails the reached tiers to every participant of a finished week. */
export function settleClanBoss(ctx: SocialCtx, clanId: string, s: ClanBossState) {
  const n = tiersReached(s.total);
  const boss = bossForWeek(s.week);
  if (n > 0) {
    for (const id of Object.keys(s.dmg)) {
      if (!(s.dmg[id] > 0)) continue;
      const p = ctx.profileOf(id);
      if (!p) continue;
      sendMail(p, {
        title: `Clan boss: ${boss.name} — tier ${n}`, titleFa: `رئیس قبیله: ${boss.nameFa} — مرحله ${n}`,
        body: `Clan damage ${Math.round(s.total)}`, bodyFa: `آسیب قبیله ${Math.round(s.total)}`,
        reward: tierRewards(n),
      }, ctx.now);
    }
  }
  delete states(ctx.db)[clanId];
}

export function bossAttemptsLeft(s: ClanBossState, userId: string, now: number) {
  const a = s.att[userId];
  const today = dayKey(now);
  return CLAN_BOSS.attemptsPerDay - (a && a.day === today ? a.n : 0);
}

export function bossFightStart(ctx: SocialCtx, p: Profile): BossFight {
  const c = clanOf(ctx.db, p.id) ?? fail('no-clan');
  const s = clanBossState(ctx, c.id);
  if (bossAttemptsLeft(s, p.id, ctx.now) <= 0) fail('limit');
  const fights = (ctx.db.cbossFights ??= {});
  for (const [k, f] of Object.entries(fights)) if (ctx.now - f.issued > 15 * 60_000) delete fights[k];
  if (Object.values(fights).some((f) => f.uid === p.id)) fail('boss-in-fight');
  const today = dayKey(ctx.now);
  const a = s.att[p.id];
  s.att[p.id] = { day: today, n: (a && a.day === today ? a.n : 0) + 1 }; // an abandoned fight still costs the attempt
  const f: BossFight = { id: uid(ctx, 'b'), uid: p.id, clan: c.id, week: s.week, seed: Math.floor(ctx.rand() * 1e9), issued: ctx.now, boss: bossForWeek(s.week).id };
  fights[f.id] = f;
  return f;
}

export interface BossResult { dmg: number; durationSec: number; won: boolean }
/** Highest damage a fight can plausibly deal (the boss HP plus ring-outs, and a per-second cap). */
export function bossDamageCap(durationSec: number) { return Math.min(CLAN_BOSS.hpMax, Math.max(30, durationSec * 40)); }

export function bossFightEnd(ctx: SocialCtx, p: Profile, fightId: string, res: BossResult): { dmg: number; total: number; tiers: number; personal: Reward } {
  const fights = (ctx.db.cbossFights ??= {});
  const f = fights[fightId] ?? fail('not-found');
  if (f.uid !== p.id) fail('perm');
  delete fights[fightId];
  const elapsed = (ctx.now - f.issued) / 1000;
  const cap = bossDamageCap(res.durationSec);
  const suspicious = res.durationSec > elapsed + 5 || res.dmg > cap + 1 || res.durationSec > CLAN_BOSS.fightSec + 15;
  if (suspicious) { flagCheat(ctx, p, 'boss', `claimed ${Math.round(res.dmg)} dmg in ${Math.round(res.durationSec)}s (${Math.round(elapsed)}s real)`, 4); fail('cheat'); }
  const c = ctx.db.clans[f.clan];
  if (!c || !memberOf(c, p.id)) fail('no-clan');
  const s = clanBossState(ctx, c.id);
  const dmg = Math.max(0, Math.round(res.dmg));
  if (s.week === f.week) {
    s.total += dmg;
    s.dmg[p.id] = (s.dmg[p.id] ?? 0) + dmg;
    s.names[p.id] = p.name;
    s.fights++;
  }
  // a small personal reward right away (the big ones come with the clan tiers)
  const personal: Reward = { coins: 40 + Math.round(dmg / 5), ...(res.won ? { runes: 15 } : {}) };
  p.coins += personal.coins ?? 0; p.runes += personal.runes ?? 0;
  return { dmg, total: s.total, tiers: tiersReached(s.total), personal };
}

/** Bot clan mates join in (offline demo / computer-run clans). */
export function bossBotHit(ctx: SocialCtx, c: Clan, memberId: string, dmg: number) {
  const s = clanBossState(ctx, c.id);
  const m = memberOf(c, memberId);
  if (!m || bossAttemptsLeft(s, memberId, ctx.now) <= 0) return false;
  const today = dayKey(ctx.now);
  const a = s.att[memberId];
  s.att[memberId] = { day: today, n: (a && a.day === today ? a.n : 0) + 1 };
  s.total += dmg; s.dmg[memberId] = (s.dmg[memberId] ?? 0) + dmg; s.names[memberId] = m.name; s.fights++;
  return true;
}

export function clanBossView(ctx: SocialCtx, c: Clan, viewer: string) {
  const s = clanBossState(ctx, c.id);
  const boss = bossForWeek(s.week);
  const top = Object.entries(s.dmg).map(([id, dmg]) => ({ id, name: s.names[id] ?? memberOf(c, id)?.name ?? id, dmg: Math.round(dmg) }))
    .sort((a, b) => b.dmg - a.dmg).map((x, i) => ({ pos: i + 1, ...x }));
  return {
    week: s.week, boss, total: Math.round(s.total), tiers: BOSS_TIERS, reached: tiersReached(s.total), top,
    attemptsLeft: bossAttemptsLeft(s, viewer, ctx.now), endsAt: weekWindow(s.week).end, fights: s.fights,
    myDmg: Math.round(s.dmg[viewer] ?? 0), members: c.members.length,
  };
}
export type ClanBossView = ReturnType<typeof clanBossView>;

/** Match config for a boss fight: the player (team 0) vs the giant boss (team 1). */
export function bossConfig(f: BossFight, p: Profile): MatchConfig {
  const boss = BOSSES.find((b) => b.id === f.boss) ?? bossForWeek(f.week);
  const fid = getFighter(p.selFighter).id;
  return {
    stageId: boss.stage, stocks: 2, timeLimit: CLAN_BOSS.fightSec, teams: true,
    rules: { boss: 1, seed: f.seed, items: true, itemKinds: ['heal', 'bomb', 'bubble'], itemEvery: 420 },
    players: [
      { charId: fid, skin: p.selSkin?.[fid] ?? 0, team: 0, name: p.name, mods: fighterMods(p, fid) },
      { charId: boss.charId, skin: 3, team: 1, name: boss.name, bot: true, mods: { atk: CLAN_BOSS.atk, def: 1, hp: CLAN_BOSS.weight, scale: CLAN_BOSS.scale, hpMax: CLAN_BOSS.hpMax, armor: true, spell: 'meteor', spellLv: 3 } },
    ],
  };
}

import { flagCheat } from './anticheat.ts';
