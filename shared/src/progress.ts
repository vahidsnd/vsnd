import { FIGHTERS, getFighter } from './fighters.ts';
import { STAGES } from './stages.ts';
import { getSpell, SPELLS, SPELL_MAX_LEVEL } from './spells.ts';
import { leagueSteps, promotionReward, SEASON_REWARDS, tierFor, type LeagueId } from './rank.ts';
import { addXp, openCrate, type CrateResult, type LevelUp, type Profile } from './economy.ts';
import type { FighterMods } from './types.ts';
import { migrateLiveops, useVipSpin, vipSpinAvailable } from './liveops.ts';

// =====================================================================================
//  Progression systems layered on top of the core economy:
//   • Runes (3rd currency) → learn / level spells (the magic attack)
//   • Fighter cards → upgrade Attack / Defense / Health per fighter
//   • World map (offline campaign) → gates online play
//   • Daily fight milestones, lucky wheel, inbox, league promotions
//  Pure functions on the profile so the server and the offline client share the rules.
// =====================================================================================

// ---- generic reward ---------------------------------------------------------------------------
export interface Reward {
  coins?: number; gems?: number; runes?: number; xp?: number;
  fighters?: string[]; skins?: string[];
  cards?: Record<string, number>;   // fighter id -> cards
  anyCards?: number;                // cards for random owned fighters
  crates?: number;
  spells?: string[];
}
export interface Granted { reward: Reward; cards: Record<string, number>; crates: CrateResult[]; levelUps: LevelUp[] }

export function grantReward(p: Profile, r: Reward, rand: () => number = Math.random): Granted {
  migrateProgress(p);
  const cards: Record<string, number> = {};
  if (r.coins) p.coins += r.coins;
  if (r.gems) p.gems += r.gems;
  if (r.runes) p.runes += r.runes;
  for (const f of r.fighters ?? []) if (FIGHTERS.some((x) => x.id === f) && !p.fighters.includes(f)) p.fighters.push(f);
  for (const s of r.skins ?? []) if (!p.skins.includes(s)) p.skins.push(s);
  for (const s of r.spells ?? []) if (getSpell(s) && !p.spells[s]) p.spells[s] = 1;
  for (const [f, n] of Object.entries(r.cards ?? {})) { if (FIGHTERS.some((x) => x.id === f)) { p.cards[f] = (p.cards[f] ?? 0) + n; cards[f] = (cards[f] ?? 0) + n; } }
  if (r.anyCards) {
    // split into up to 3 piles for owned fighters
    const piles = Math.min(3, r.anyCards);
    let left = r.anyCards;
    for (let i = 0; i < piles; i++) {
      const n = i === piles - 1 ? left : Math.max(1, Math.round(r.anyCards / piles));
      left -= n;
      const f = p.fighters[Math.floor(rand() * p.fighters.length)];
      p.cards[f] = (p.cards[f] ?? 0) + n; cards[f] = (cards[f] ?? 0) + n;
    }
  }
  const crates: CrateResult[] = [];
  for (let i = 0; i < Math.min(10, r.crates ?? 0); i++) crates.push(openCrate(p, rand));
  const levelUps = r.xp ? addXp(p, r.xp) : [];
  return { reward: r, cards, crates, levelUps };
}

export function rewardEmpty(r: Reward) {
  return !r.coins && !r.gems && !r.runes && !r.xp && !r.fighters?.length && !r.skins?.length && !r.anyCards && !r.crates && !r.spells?.length && !Object.keys(r.cards ?? {}).length;
}

/** Validates/clamps an untrusted reward (promo codes made by admins). */
export function cleanReward(x: any): Reward {
  const n = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
  const r: Reward = {};
  if (x?.coins) r.coins = n(x.coins, 1_000_000);
  if (x?.gems) r.gems = n(x.gems, 100_000);
  if (x?.runes) r.runes = n(x.runes, 100_000);
  if (x?.xp) r.xp = n(x.xp, 100_000);
  if (x?.anyCards) r.anyCards = n(x.anyCards, 1000);
  if (x?.crates) r.crates = n(x.crates, 10);
  const ids = new Set(FIGHTERS.map((f) => f.id));
  const skins = new Set(FIGHTERS.flatMap((f) => f.skins.map((s) => s.id)));
  if (Array.isArray(x?.fighters)) r.fighters = x.fighters.map(String).filter((f: string) => ids.has(f)).slice(0, 30);
  if (Array.isArray(x?.skins)) r.skins = x.skins.map(String).filter((s: string) => skins.has(s)).slice(0, 100);
  if (Array.isArray(x?.spells)) r.spells = x.spells.map(String).filter((s: string) => getSpell(s)).slice(0, 10);
  if (x?.cards && typeof x.cards === 'object') {
    r.cards = {};
    for (const [k, v] of Object.entries(x.cards)) if (ids.has(k)) r.cards[k] = n(v, 1000);
  }
  return r;
}

// ---- migration -------------------------------------------------------------------------------
export function migrateProgress(p: Profile): Profile {
  p.runes ??= 0;
  p.cards ??= {};
  p.upg ??= {};
  p.spells ??= { nova: 1 };
  p.equip ??= {};
  p.map ??= { cleared: 0, stars: [], chests: [] };
  p.league ??= { season: p.rank.season, best: 0, claimed: [] };
  p.inbox ??= [];
  p.wheel ??= { day: '', free: false, ads: 0 };
  p.clan ??= null;
  p.trophies ??= [];
  p.stats.leagueWins ??= 0;
  p.daily.fights ??= 0;
  p.daily.ms ??= [];
  p.daily.cardReq ??= 0;
  p.daily.donated ??= 0;
  migrateLiveops(p);
  return p;
}

// ---- cards & upgrades ------------------------------------------------------------------------
export type StatKey = 'atk' | 'def' | 'hp';
export const STAT_KEYS: StatKey[] = ['atk', 'def', 'hp'];
export const UPGRADE_MAX = 10;
export function upgradeCost(level: number) {
  return { cards: 2 + level * 2, coins: 150 * (level + 1) };
}
export function upgLevels(p: Profile, fid: string) {
  return p.upg[fid] ?? { atk: 0, def: 0, hp: 0 };
}
export function upgradeStat(p: Profile, fid: string, stat: StatKey): boolean {
  migrateProgress(p);
  if (!p.fighters.includes(fid) || !STAT_KEYS.includes(stat)) return false;
  const u = (p.upg[fid] ??= { atk: 0, def: 0, hp: 0 });
  if (u[stat] >= UPGRADE_MAX) return false;
  const c = upgradeCost(u[stat]);
  if ((p.cards[fid] ?? 0) < c.cards || p.coins < c.coins) return false;
  p.cards[fid] -= c.cards; p.coins -= c.coins;
  u[stat]++;
  return true;
}
/** Gameplay effect of upgrade levels (kept modest so skill still wins). */
export const statEffect = {
  atk: (l: number) => 1 + l * 0.02,    // +2% damage per level (max +20%)
  def: (l: number) => 1 - l * 0.015,   // -1.5% damage taken per level (max -15%)
  hp: (l: number) => 1 + l * 0.02,     // +2% knockback resistance per level (max +20%)
};
export function fighterPower(p: Profile, fid: string) {
  const u = upgLevels(p, fid);
  return 100 + (u.atk + u.def + u.hp) * 10 + ((p.spells[p.equip[fid] ?? ''] ?? 0) * 8);
}
export function fighterMods(p: Profile, fid: string): FighterMods {
  migrateProgress(p);
  const u = upgLevels(p, fid);
  const spell = p.equip[fid];
  const lv = spell ? p.spells[spell] ?? 0 : 0;
  return {
    atk: statEffect.atk(u.atk), def: statEffect.def(u.def), hp: statEffect.hp(u.hp),
    ...(lv > 0 ? { spell, spellLv: lv } : {}),
  };
}

// ---- spells -----------------------------------------------------------------------------------
export function learnSpell(p: Profile, id: string): boolean {
  migrateProgress(p);
  const s = getSpell(id);
  if (!s || p.spells[id] || p.runes < s.unlock) return false;
  p.runes -= s.unlock; p.spells[id] = 1;
  return true;
}
export function upgradeSpell(p: Profile, id: string): boolean {
  migrateProgress(p);
  const s = getSpell(id);
  const lv = p.spells[id] ?? 0;
  if (!s || lv < 1 || lv >= SPELL_MAX_LEVEL) return false;
  const cost = s.upgrade[lv - 1];
  if (p.runes < cost) return false;
  p.runes -= cost; p.spells[id] = lv + 1;
  return true;
}
export function equipSpell(p: Profile, fid: string, id: string | null): boolean {
  migrateProgress(p);
  if (!p.fighters.includes(fid)) return false;
  if (id === null || id === '') { delete p.equip[fid]; return true; }
  if (!p.spells[id]) return false;
  p.equip[fid] = id;
  return true;
}

// ---- daily fight milestones ----------------------------------------------------------------------
export const MILESTONES: { fights: number; reward: Reward }[] = [
  { fights: 1, reward: { coins: 100 } },
  { fights: 3, reward: { runes: 15, anyCards: 3 } },
  { fights: 5, reward: { coins: 250, anyCards: 5 } },
  { fights: 8, reward: { gems: 10, runes: 20 } },
  { fights: 12, reward: { coins: 400, anyCards: 8 } },
  { fights: 16, reward: { crates: 1, runes: 30 } },
  { fights: 20, reward: { gems: 25, runes: 50 } },
];
export function claimMilestone(p: Profile, idx: number, rand: () => number = Math.random): Granted | null {
  migrateProgress(p);
  const m = MILESTONES[idx];
  if (!m || p.daily.ms.includes(idx) || p.daily.fights < m.fights) return null;
  p.daily.ms.push(idx);
  return grantReward(p, m.reward, rand);
}
export function claimableMilestones(p: Profile) {
  migrateProgress(p);
  return MILESTONES.filter((m, i) => p.daily.fights >= m.fights && !p.daily.ms.includes(i)).length;
}

// ---- world map (offline campaign) -------------------------------------------------------------------
export type NodeKind = 'duel' | 'team' | 'ffa' | 'boss';
export interface MapNode {
  i: number; region: number;
  kind: NodeKind;
  stage: string;
  foes: { charId: string; lv: number; mods?: FighterMods }[];
  ally?: { charId: string; lv: number };
  stocks: number;
  reward: Reward;               // first clear
  x: number; y: number;         // position on the map (0..1)
}
export const REGIONS = [
  { name: 'Neon Outskirts', nameFa: 'حومه نئون', color: '#29e3f0' },
  { name: 'Ember Wastes', nameFa: 'بیابان اخگر', color: '#ff8a3d' },
  { name: 'Frost Peaks', nameFa: 'قله‌های یخ', color: '#9ad8ff' },
  { name: 'Shadow Citadel', nameFa: 'دژ سایه', color: '#b48cff' },
];
export const NODES_PER_REGION = 5;
export const MAP_SIZE = REGIONS.length * NODES_PER_REGION;

let mapCache: MapNode[] | null = null;
export function mapNodes(): MapNode[] {
  if (mapCache && mapCache.length === MAP_SIZE) return mapCache;
  const nodes: MapNode[] = [];
  const fid = (k: number) => FIGHTERS[k % FIGHTERS.length].id;
  for (let i = 0; i < MAP_SIZE; i++) {
    const region = Math.floor(i / NODES_PER_REGION);
    const k = i % NODES_PER_REGION;
    const kind: NodeKind = k === 4 ? 'boss' : k === 2 && region > 0 ? 'team' : k === 3 && region > 1 ? 'ffa' : 'duel';
    const lv = Math.min(9, 1 + Math.floor(i * 0.42));
    const foeA = fid(i * 7 + 1), foeB = fid(i * 5 + 3);
    let foes: MapNode['foes'];
    if (kind === 'boss') {
      const boost = 1.2 + region * 0.1;
      foes = [{ charId: fid(6 + region * 3), lv: Math.min(9, lv + 1), mods: { atk: boost, def: 1 / boost, hp: 1.3 + region * 0.15, spell: SPELLS[(region * 2 + 1) % SPELLS.length].id, spellLv: 1 + region } }];
    } else if (kind === 'team') foes = [{ charId: foeA, lv }, { charId: foeB, lv: Math.max(1, lv - 1) }];
    else if (kind === 'ffa') foes = [{ charId: foeA, lv }, { charId: foeB, lv }];
    else foes = [{ charId: foeA, lv }];
    const reward: Reward = {
      coins: 150 + i * 25, xp: 60 + i * 6, runes: 10 + i * 2, anyCards: 2 + Math.floor(i / 3),
      ...(kind === 'boss' ? { gems: 20 + region * 10, fighters: [fid(6 + region * 3)], crates: 1 } : {}),
      ...(i === 1 ? { spells: ['frost'] } : {}),
    };
    // winding path: each region is a column band, nodes zig-zag inside it
    const x = (region + 0.12 + (k / (NODES_PER_REGION - 1)) * 0.76) / REGIONS.length;
    const y = 0.25 + (k % 2 === 0 ? 0.42 : 0) + Math.sin(i * 1.7) * 0.08;
    nodes.push({
      i, region, kind, stage: STAGES[i % STAGES.length].id, foes, stocks: kind === 'boss' ? 3 : 2,
      ...(kind === 'team' ? { ally: { charId: fid(i * 3 + 2), lv: Math.max(1, lv - 1) } } : {}),
      reward, x, y,
    });
  }
  mapCache = nodes;
  return nodes;
}
/** Stars: 1 = win, 2 = win with at most one fall, 3 = win without falling. */
export function starsFor(won: boolean, falls: number) { return !won ? 0 : falls === 0 ? 3 : falls <= 1 ? 2 : 1; }
export function totalStars(p: Profile) { migrateProgress(p); return p.map.stars.reduce((a, b) => a + (b || 0), 0); }
export const STAR_CHESTS: { stars: number; reward: Reward }[] = [
  { stars: 10, reward: { gems: 20, runes: 30 } },
  { stars: 20, reward: { crates: 1, anyCards: 10 } },
  { stars: 30, reward: { gems: 40, runes: 60 } },
  { stars: 45, reward: { crates: 2, runes: 80 } },
  { stars: 60, reward: { gems: 100, runes: 150, anyCards: 20 } },
];
export interface MapClear { stars: number; firstClear: boolean; granted: Granted | null; best: number }
export function clearMapNode(p: Profile, i: number, won: boolean, falls: number, rand: () => number = Math.random): MapClear | null {
  migrateProgress(p);
  if (!Number.isInteger(i) || i < 0 || i >= MAP_SIZE || i > p.map.cleared) return null;
  const stars = starsFor(won, falls);
  const prev = p.map.stars[i] ?? 0;
  if (stars > prev) p.map.stars[i] = stars;
  let firstClear = false, granted: Granted | null = null;
  if (won && i === p.map.cleared) {
    firstClear = true;
    p.map.cleared = i + 1;
    granted = grantReward(p, mapNodes()[i].reward, rand);
  }
  return { stars, firstClear, granted, best: Math.max(stars, prev) };
}
export function claimStarChest(p: Profile, idx: number, rand: () => number = Math.random): Granted | null {
  migrateProgress(p);
  const c = STAR_CHESTS[idx];
  if (!c || p.map.chests.includes(idx) || totalStars(p) < c.stars) return null;
  p.map.chests.push(idx);
  return grantReward(p, c.reward, rand);
}
/** Arenas open up as the map is explored (node i's arena once node i is reachable). */
export function stageUnlocked(p: Profile, stageId: string) {
  migrateProgress(p);
  if (p.dev) return true;
  const idx = STAGES.findIndex((s) => s.id === stageId);
  return idx <= Math.max(0, p.map.cleared) || idx < 0 ? true : false;
}

// ---- leagues ---------------------------------------------------------------------------------------
export function leagueIndex(mmr: number) {
  const steps = leagueSteps();
  let i = 0;
  while (i + 1 < steps.length && mmr >= steps[i + 1].min) i++;
  return i;
}
/** Call after the mmr changes. Tracks the season best for end-of-season rewards. */
export function trackLeague(p: Profile) {
  migrateProgress(p);
  p.league.best = Math.max(p.league.best, leagueIndex(p.rank.mmr));
}
export function claimLeague(p: Profile, key: string, rand: () => number = Math.random): Granted | null {
  migrateProgress(p);
  const steps = leagueSteps();
  const idx = steps.findIndex((s) => s.key === key);
  if (idx < 0 || idx > leagueIndex(p.rank.peak) || p.league.claimed.includes(key)) return null;
  p.league.claimed.push(key);
  const r = promotionReward(key);
  return grantReward(p, { coins: r.coins, gems: r.gems, runes: r.runes, crates: r.crates }, rand);
}
export function claimableLeague(p: Profile) {
  migrateProgress(p);
  const top = leagueIndex(p.rank.peak);
  return leagueSteps().filter((s, i) => i <= top && i > 0 && !p.league.claimed.includes(s.key)).length;
}
/** Season rollover: mails the season reward for the best league reached. */
export function leagueSeasonRollover(p: Profile, season: number, now: number) {
  migrateProgress(p);
  if (p.league.season === season) return;
  const played = p.rank.wins + p.rank.losses > 0;
  if (played) {
    const best = leagueSteps()[p.league.best];
    const r = SEASON_REWARDS[best.tier.id as LeagueId];
    sendMail(p, { title: `Season ${p.league.season} rewards`, titleFa: `جوایز فصل ${p.league.season}`, body: `Best league: ${best.tier.name}`, bodyFa: `بهترین لیگ: ${best.tier.nameFa}`, reward: { coins: r.coins, gems: r.gems, runes: r.runes, crates: r.crates } }, now);
  }
  p.league = { season, best: leagueIndex(p.rank.mmr), claimed: p.league.claimed };
}
export { tierFor };

// ---- inbox ------------------------------------------------------------------------------------------
export interface Mail { id: string; t: number; title: string; titleFa: string; body?: string; bodyFa?: string; reward?: Reward; claimed: boolean }
export function sendMail(p: Profile, m: Omit<Mail, 'id' | 't' | 'claimed'>, now = Date.now()) {
  migrateProgress(p);
  p.inbox.unshift({ ...m, id: 'm' + now.toString(36) + Math.floor(Math.random() * 1e6).toString(36), t: now, claimed: !m.reward || rewardEmpty(m.reward) });
  if (p.inbox.length > 30) p.inbox.length = 30;
}
export function claimMail(p: Profile, id: string, rand: () => number = Math.random): Granted | null {
  migrateProgress(p);
  const m = p.inbox.find((x) => x.id === id);
  if (!m || m.claimed || !m.reward) return null;
  m.claimed = true;
  return grantReward(p, m.reward, rand);
}
export function unreadMail(p: Profile) { migrateProgress(p); return p.inbox.filter((m) => !m.claimed).length; }

// ---- lucky wheel --------------------------------------------------------------------------------------
export const WHEEL: { reward: Reward; weight: number; color: string }[] = [
  { reward: { coins: 150 }, weight: 22, color: '#29e3f0' },
  { reward: { runes: 15 }, weight: 18, color: '#b48cff' },
  { reward: { anyCards: 4 }, weight: 18, color: '#2ee6a6' },
  { reward: { coins: 400 }, weight: 12, color: '#ffd23f' },
  { reward: { gems: 8 }, weight: 10, color: '#ff3d7f' },
  { reward: { runes: 40 }, weight: 8, color: '#7f6bff' },
  { reward: { anyCards: 12 }, weight: 8, color: '#5af08c' },
  { reward: { gems: 30, crates: 1 }, weight: 4, color: '#ff8a3d' },
];
export const WHEEL_ADS_PER_DAY = 3;
export function wheelState(p: Profile, today: string) {
  migrateProgress(p);
  if (p.wheel.day !== today) p.wheel = { day: today, free: false, ads: 0 };
  return { free: !p.wheel.free || vipSpinAvailable(p, today), ads: WHEEL_ADS_PER_DAY - p.wheel.ads };
}
export function spinWheel(p: Profile, today: string, viaAd: boolean, rand: () => number = Math.random): { index: number; granted: Granted } | null {
  const st = wheelState(p, today);
  if (viaAd ? st.ads <= 0 : !st.free) return null;
  if (viaAd) p.wheel.ads++; else if (!p.wheel.free) p.wheel.free = true; else useVipSpin(p, today);
  const total = WHEEL.reduce((a, w) => a + w.weight, 0);
  let roll = rand() * total, index = 0;
  for (let i = 0; i < WHEEL.length; i++) { if ((roll -= WHEEL[i].weight) < 0) { index = i; break; } }
  return { index, granted: grantReward(p, WHEEL[index].reward, rand) };
}

// ---- clan perks (levels bought with gems) ------------------------------------------------------------
export const CLAN_MAX_MEMBERS = 15;
export const CLAN_MAX_LEVEL = 10;
/** gems needed in the clan bank to go from level n to n+1 (index n-1) */
export const CLAN_LEVEL_COST = [300, 600, 1000, 1500, 2200, 3000, 4000, 5200, 6500];
export interface ClanPerk { level: number; name: string; nameFa: string; coins?: number; xp?: number; runes?: number; cardReq?: number; war?: number }
export const CLAN_PERKS: ClanPerk[] = [
  { level: 2, name: '+5% match coins', nameFa: '۵٪ سکه بیشتر در هر مسابقه', coins: 0.05 },
  { level: 3, name: '2 card requests a day', nameFa: '۲ درخواست کارت در روز', cardReq: 2 },
  { level: 4, name: '+5% XP', nameFa: '۵٪ تجربه بیشتر', xp: 0.05 },
  { level: 5, name: '+1 rune per win', nameFa: '۱ رون اضافه برای هر برد', runes: 1 },
  { level: 6, name: '+10% match coins', nameFa: '۱۰٪ سکه بیشتر', coins: 0.10 },
  { level: 7, name: '+25% clan war rewards', nameFa: '۲۵٪ جایزه بیشتر جنگ قبیله', war: 0.25 },
  { level: 8, name: '3 card requests a day', nameFa: '۳ درخواست کارت در روز', cardReq: 3 },
  { level: 9, name: '+10% XP, +2 runes per win', nameFa: '۱۰٪ تجربه و ۲ رون بیشتر', xp: 0.10, runes: 2 },
  { level: 10, name: '+15% coins, +50% war rewards', nameFa: '۱۵٪ سکه و ۵۰٪ جایزه جنگ بیشتر', coins: 0.15, war: 0.5 },
];
export function clanBonus(level: number) {
  const out = { coins: 0, xp: 0, runes: 0, cardReq: 1, war: 0 };
  for (const k of CLAN_PERKS) {
    if (level < k.level) continue;
    if (k.coins !== undefined) out.coins = k.coins;
    if (k.xp !== undefined) out.xp = k.xp;
    if (k.runes !== undefined) out.runes = k.runes;
    if (k.cardReq !== undefined) out.cardReq = k.cardReq;
    if (k.war !== undefined) out.war = k.war;
  }
  return out;
}

/** Convenience for UI: owned fighter defs sorted by power. */
export function ownedByPower(p: Profile) {
  return p.fighters.map((id) => getFighter(id)).sort((a, b) => fighterPower(p, b.id) - fighterPower(p, a.id));
}
