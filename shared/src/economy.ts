import { FIGHTERS, getFighter } from './fighters.ts';
import { clanBonus, migrateProgress, trackLeague, leagueSeasonRollover, MAP_SIZE, type Mail } from './progress.ts';
import { grantLiveopsIap, liveopsAfterMatch } from './liveops.ts';
import { matchCoinMultiplier, remoteConfig } from './remoteconfig.ts';

// =====================================================================================
//  Economy design
//  - Coins  (soft currency): earned by playing, quests, login streak, crates, pass.
//  - Gems   (hard currency): IAP, small amounts from pass / streak / level-ups.
//  - XP → Player level (unlocks stages, rewards) and Season Pass tiers.
//  All functions are pure-ish (mutate the profile passed in) so the authoritative server
//  and the offline client run exactly the same rules.
// =====================================================================================

export type Market = 'googleplay' | 'myket' | 'web';

export interface Quest {
  id: string;
  kind: QuestKind;
  target: number;
  progress: number;
  reward: { coins: number; gems: number };
  claimed: boolean;
  param?: string;
}
export type QuestKind = 'play' | 'win' | 'ko' | 'dmg' | 'smashko' | 'combo' | 'online' | 'winwith';

export interface HistoryEntry { t: number; mode: string; won: boolean; fighter: string; kos: number; falls: number; dmg: number; place: number; players: number; coins: number; mmr?: number }

export interface Profile {
  id: string;
  name: string;
  createdAt: number;
  coins: number;
  gems: number;
  xp: number;           // xp inside current level
  level: number;
  fighters: string[];
  skins: string[];
  selFighter: string;
  selSkin: Record<string, number>;
  noAds: boolean;
  payer: boolean;
  rank: { mmr: number; peak: number; wins: number; losses: number; season: number; streak: number };
  stats: { matches: number; wins: number; kos: number; falls: number; dmg: number; online: number; bestCombo: number; flawless: number; leagueWins?: number };
  fstats: Record<string, { m: number; w: number }>;
  history: HistoryEntry[];
  ach: string[];          // claimed achievement ids
  tutorial: string[];     // completed tutorials / seen feature intros
  daily: { day: string; quests: Quest[]; firstWin: boolean; rerolls: number; ads: number; crateAt: number; fights: number; ms: number[]; cardReq: number; donated: number };
  login: { lastDay: string; streak: number; claimed: boolean };
  pass: { season: number; xp: number; premium: boolean; free: number[]; prem: number[] };
  offers: { starter: boolean };
  lastReward: { id: string; coins: number; doubled: boolean } | null;
  settings: { lang: 'fa' | 'en'; sfx: boolean; music: boolean; controls: 'buttons' | 'gestures' };
  // ---- progression (see progress.ts) ----
  runes: number;
  cards: Record<string, number>;
  upg: Record<string, { atk: number; def: number; hp: number }>;
  spells: Record<string, number>;          // spell id -> level
  equip: Record<string, string>;           // fighter id -> spell id
  map: { cleared: number; stars: number[]; chests: number[] };
  league: { season: number; best: number; claimed: string[] };
  inbox: Mail[];
  wheel: { day: string; free: boolean; ads: number };
  clan: ClanRef | null;
  lweek?: import('./league.ts').WeekStats;
  trophies: import('./league.ts').Trophy[];
  /** test builds only: unlock every feature locally */
  dev?: boolean;
  // ---- live ops (see liveops.ts / cosmetics.ts) ----
  deals?: import('./liveops.ts').DealsState;
  smart?: import('./liveops.ts').SmartState;
  vip?: import('./liveops.ts').VipState;
  cos?: import('./cosmetics.ts').CosState;
  mastery?: Record<string, import('./cosmetics.ts').MasteryState>;
}

export interface ClanRef { id: string; name: string; tag: string; level: number; role: 'leader' | 'co' | 'elder' | 'member'; badge: number }

// ---- catalog ------------------------------------------------------------------------
export const STARTER_FIGHTERS = FIGHTERS.filter((f) => f.price.coins === 0 && f.price.gems === 0).map((f) => f.id);

export interface IapProduct {
  id: string;
  name: string; nameFa: string;
  gems?: number; coins?: number;
  fighters?: string[]; skins?: string[];
  noAds?: boolean; pass?: boolean;
  oneTime?: boolean;
  consumable: boolean;
  badge?: string; badgeFa?: string;
  // display fallback (the store provides localised prices at runtime)
  price: { googleplay: string; myket: string; web: string };
}

export const IAP_PRODUCTS: IapProduct[] = [
  { id: 'gems_80', name: 'Pouch of Gems', nameFa: 'کیسه الماس', gems: 80, consumable: true, price: { googleplay: '$0.99', myket: '۲۹٬۰۰۰ تومان', web: '$0.99' } },
  { id: 'gems_500', name: 'Box of Gems', nameFa: 'جعبه الماس', gems: 500, consumable: true, badge: 'Popular', badgeFa: 'محبوب', price: { googleplay: '$4.99', myket: '۱۴۹٬۰۰۰ تومان', web: '$4.99' } },
  { id: 'gems_1200', name: 'Chest of Gems', nameFa: 'صندوق الماس', gems: 1200, consumable: true, badge: '+20%', badgeFa: '۲۰٪ بیشتر', price: { googleplay: '$9.99', myket: '۲۹۹٬۰۰۰ تومان', web: '$9.99' } },
  { id: 'gems_2600', name: 'Vault of Gems', nameFa: 'گاوصندوق الماس', gems: 2600, consumable: true, badge: '+30%', badgeFa: '۳۰٪ بیشتر', price: { googleplay: '$19.99', myket: '۵۹۹٬۰۰۰ تومان', web: '$19.99' } },
  { id: 'gems_7000', name: 'Mountain of Gems', nameFa: 'کوه الماس', gems: 7000, consumable: true, badge: 'Best value', badgeFa: 'بهترین ارزش', price: { googleplay: '$49.99', myket: '۱٬۴۹۹٬۰۰۰ تومان', web: '$49.99' } },
  {
    id: 'starter_pack', name: 'Starter Pack', nameFa: 'بسته شروع', gems: 300, coins: 5000, fighters: ['zephyr'], skins: ['blaze1'],
    consumable: true, oneTime: true, badge: '-80%', badgeFa: '۸۰٪ تخفیف', price: { googleplay: '$2.99', myket: '۸۹٬۰۰۰ تومان', web: '$2.99' },
  },
  { id: 'no_ads', name: 'Remove Ads', nameFa: 'حذف تبلیغات', noAds: true, gems: 100, consumable: false, price: { googleplay: '$3.99', myket: '۱۱۹٬۰۰۰ تومان', web: '$3.99' } },
  { id: 'season_pass', name: 'Season Pass', nameFa: 'پاس فصل', pass: true, consumable: true, price: { googleplay: '$7.99', myket: '۲۳۹٬۰۰۰ تومان', web: '$7.99' } },
  {
    id: 'all_fighters', name: 'Legends Bundle', nameFa: 'بسته اسطوره‌ها', fighters: FIGHTERS.map((f) => f.id), gems: 500,
    consumable: false, badge: 'All fighters', badgeFa: 'همه مبارزها', price: { googleplay: '$14.99', myket: '۴۴۹٬۰۰۰ تومان', web: '$14.99' },
  },
  // live ops (granted by grantLiveopsIap in liveops.ts)
  { id: 'vip_month', name: 'VIP – 30 days', nameFa: 'VIP – ۳۰ روز', consumable: true, badge: 'VIP', badgeFa: 'VIP', price: { googleplay: '$2.99', myket: '۸۹٬۰۰۰ تومان', web: '$2.99' } },
  { id: 'comeback_pack', name: 'Comeback Pack', nameFa: 'بسته بازگشت', consumable: true, oneTime: true, price: { googleplay: '$0.99', myket: '۲۹٬۰۰۰ تومان', web: '$0.99' } },
  { id: 'rune_pack', name: 'Rune Pack', nameFa: 'بسته رون', consumable: true, oneTime: true, price: { googleplay: '$1.99', myket: '۵۹٬۰۰۰ تومان', web: '$1.99' } },
  { id: 'veteran_pack', name: 'Veteran Pack', nameFa: 'بسته کهنه‌کار', consumable: true, oneTime: true, price: { googleplay: '$4.99', myket: '۱۴۹٬۰۰۰ تومان', web: '$4.99' } },
];

export interface ShopItem {
  id: string;
  kind: 'fighter' | 'skin' | 'coins' | 'crate';
  ref?: string;
  cost: { coins?: number; gems?: number };
  amount?: number;
}

export function skinPrice(skinIdx: number): { coins?: number; gems?: number } | null {
  if (skinIdx === 0) return null;       // default
  if (skinIdx === 1) return { coins: 3000 };
  if (skinIdx === 2) return { gems: 200 };
  return null;                          // idx 3 = season pass exclusive
}

export function shopCatalog(): ShopItem[] {
  const items: ShopItem[] = [];
  for (const f of FIGHTERS) {
    if (f.price.coins || f.price.gems) {
      items.push({ id: `fighter:${f.id}:coins`, kind: 'fighter', ref: f.id, cost: { coins: f.price.coins } });
      items.push({ id: `fighter:${f.id}:gems`, kind: 'fighter', ref: f.id, cost: { gems: f.price.gems } });
    }
    f.skins.forEach((s, i) => {
      const p = skinPrice(i);
      if (p) items.push({ id: `skin:${s.id}`, kind: 'skin', ref: s.id, cost: p });
    });
  }
  items.push({ id: 'coins:1000', kind: 'coins', amount: 1000, cost: { gems: 50 } });
  items.push({ id: 'coins:5000', kind: 'coins', amount: 5000, cost: { gems: 220 } });
  items.push({ id: 'coins:12000', kind: 'coins', amount: 12000, cost: { gems: 480 } });
  items.push({ id: 'crate', kind: 'crate', cost: { gems: Math.max(1, Math.round(90 * remoteConfig().economy.cratePriceMult)) } });
  return items;
}

// ---- crates (odds are disclosed in the UI, required by Google Play policy) --------------
export const CRATE_ODDS = [
  { kind: 'coins', min: 400, max: 1200, weight: 40 },
  { kind: 'gems', min: 15, max: 40, weight: 12 },
  { kind: 'cards', min: 5, max: 15, weight: 22 },
  { kind: 'runes', min: 10, max: 30, weight: 10 },
  { kind: 'skin', weight: 12 },
  { kind: 'fighter', weight: 4 },
] as const;
export const FREE_CRATE_COOLDOWN = 4 * 3600 * 1000;

export type CrateResult =
  | { kind: 'coins'; amount: number }
  | { kind: 'gems'; amount: number }
  | { kind: 'runes'; amount: number }
  | { kind: 'cards'; amount: number; id: string }
  | { kind: 'skin'; id: string; dupCoins?: number }
  | { kind: 'fighter'; id: string; dupCoins?: number };

export function openCrate(p: Profile, rand: () => number = Math.random): CrateResult {
  const total = CRATE_ODDS.reduce((a, o) => a + o.weight, 0);
  let roll = rand() * total;
  let pick: (typeof CRATE_ODDS)[number] = CRATE_ODDS[0];
  for (const o of CRATE_ODDS) { if ((roll -= o.weight) < 0) { pick = o; break; } }
  if (pick.kind === 'coins' || pick.kind === 'gems' || pick.kind === 'runes') {
    const amount = Math.round(pick.min + rand() * (pick.max - pick.min));
    if (pick.kind === 'coins') p.coins += amount; else if (pick.kind === 'gems') p.gems += amount; else p.runes = (p.runes ?? 0) + amount;
    return { kind: pick.kind, amount };
  }
  if (pick.kind === 'cards') {
    const amount = Math.round(pick.min + rand() * (pick.max - pick.min));
    const id = p.fighters[Math.floor(rand() * p.fighters.length)];
    p.cards ??= {};
    p.cards[id] = (p.cards[id] ?? 0) + amount;
    return { kind: 'cards', amount, id };
  }
  if (pick.kind === 'skin') {
    const pool = FIGHTERS.flatMap((f) => f.skins.slice(1, 3).map((s) => s.id)).filter((id) => !p.skins.includes(id));
    if (!pool.length) { p.coins += 800; return { kind: 'skin', id: '', dupCoins: 800 }; }
    const id = pool[Math.floor(rand() * pool.length)];
    p.skins.push(id);
    return { kind: 'skin', id };
  }
  const pool = FIGHTERS.map((f) => f.id).filter((id) => !p.fighters.includes(id));
  if (!pool.length) { p.coins += 1500; return { kind: 'fighter', id: '', dupCoins: 1500 }; }
  const id = pool[Math.floor(rand() * pool.length)];
  p.fighters.push(id);
  return { kind: 'fighter', id };
}

// ---- profile -------------------------------------------------------------------------
export function newProfile(id: string, name: string, now = Date.now()): Profile {
  const p: Profile = {
    id, name, createdAt: now,
    coins: 500, gems: 30, xp: 0, level: 1,
    fighters: [...STARTER_FIGHTERS],
    skins: FIGHTERS.map((f) => f.skins[0].id),
    selFighter: STARTER_FIGHTERS[0], selSkin: {},
    noAds: false, payer: false,
    rank: { mmr: 1000, peak: 1000, wins: 0, losses: 0, season: currentSeason(now), streak: 0 },
    stats: { matches: 0, wins: 0, kos: 0, falls: 0, dmg: 0, online: 0, bestCombo: 0, flawless: 0 },
    fstats: {}, history: [], ach: [], tutorial: [],
    daily: { day: '', quests: [], firstWin: false, rerolls: 1, ads: 0, crateAt: 0, fights: 0, ms: [], cardReq: 0, donated: 0 },
    login: { lastDay: '', streak: 0, claimed: false },
    pass: { season: currentSeason(now), xp: 0, premium: false, free: [], prem: [] },
    offers: { starter: false },
    lastReward: null,
    settings: { lang: 'fa', sfx: true, music: true, controls: 'buttons' },
    runes: 0, cards: {}, upg: {}, spells: { nova: 1 }, equip: {},
    map: { cleared: 0, stars: [], chests: [] },
    league: { season: currentSeason(now), best: 0, claimed: [] },
    inbox: [], wheel: { day: '', free: false, ads: 0 }, clan: null, trophies: [],
  };
  refreshDaily(p, now);
  return p;
}

export function dayKey(now: number) {
  // Tehran-ish day boundary (UTC+3:30) so the daily reset lands at midnight for most players
  return new Date(now + 3.5 * 3600 * 1000).toISOString().slice(0, 10);
}
export const SEASON_LENGTH_DAYS = 30;
const SEASON_EPOCH = Date.UTC(2026, 0, 1);
export function currentSeason(now: number) {
  return Math.floor((now - SEASON_EPOCH) / (SEASON_LENGTH_DAYS * 86400000)) + 1;
}
export function seasonEndsAt(now: number) {
  return SEASON_EPOCH + currentSeason(now) * SEASON_LENGTH_DAYS * 86400000;
}

/** Rotates daily quests, login streak and season. Call on every session/profile load. */
/** Adds fields introduced after a profile was created (old saves / server records). */
export function migrateProfile(p: Profile): Profile {
  p.stats.bestCombo ??= 0; p.stats.flawless ??= 0;
  p.fstats ??= {}; p.history ??= []; p.ach ??= []; p.tutorial ??= [];
  return migrateProgress(p);
}

export function refreshDaily(p: Profile, now = Date.now(), rand: () => number = Math.random) {
  migrateProfile(p);
  const today = dayKey(now);
  if (p.daily.day !== today) {
    p.daily = { day: today, quests: rollQuests(p, rand), firstWin: false, rerolls: 1, ads: 0, crateAt: p.daily.crateAt, fights: 0, ms: [], cardReq: 0, donated: 0 };
  }
  if (p.login.lastDay !== today) {
    const yesterday = dayKey(now - 86400000);
    p.login.streak = p.login.lastDay === yesterday ? (p.login.streak % 7) + 1 : 1;
    p.login.lastDay = today;
    p.login.claimed = false;
  }
  const season = currentSeason(now);
  if (p.pass.season !== season) {
    p.pass = { season, xp: 0, premium: false, free: [], prem: [] };
  }
  leagueSeasonRollover(p, season, now);
  if (p.rank.season !== season) {
    // soft reset towards 1000
    p.rank.mmr = Math.round(1000 + (p.rank.mmr - 1000) * 0.5);
    p.rank.season = season;
    p.rank.streak = 0;
  }
}

const QUEST_POOL: { kind: QuestKind; targets: number[]; coins: number; gems?: number }[] = [
  { kind: 'play', targets: [3, 5], coins: 120 },
  { kind: 'win', targets: [2, 3], coins: 180 },
  { kind: 'ko', targets: [8, 12], coins: 150 },
  { kind: 'dmg', targets: [400, 700], coins: 130 },
  { kind: 'smashko', targets: [2, 3], coins: 170 },
  { kind: 'combo', targets: [3, 4], coins: 150 },
  { kind: 'online', targets: [2, 3], coins: 200, gems: 5 },
  { kind: 'winwith', targets: [1, 2], coins: 160 },
];

function rollQuests(p: Profile, rand: () => number): Quest[] {
  const pool = [...QUEST_POOL];
  const out: Quest[] = [];
  for (let i = 0; i < 3; i++) {
    const q = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    out.push(makeQuest(p, q, rand, i));
  }
  return out;
}

function makeQuest(p: Profile, q: (typeof QUEST_POOL)[number], rand: () => number, i: number): Quest {
  const target = q.targets[Math.floor(rand() * q.targets.length)];
  const scale = target / q.targets[0];
  return {
    id: `${q.kind}-${i}-${Math.floor(rand() * 1e6)}`, kind: q.kind, target, progress: 0, claimed: false,
    reward: { coins: Math.round(q.coins * scale), gems: q.gems ?? 0 },
    param: q.kind === 'winwith' ? p.fighters[Math.floor(rand() * p.fighters.length)] : undefined,
  };
}

export function rerollQuest(p: Profile, idx: number, rand: () => number = Math.random): boolean {
  const q = p.daily.quests[idx];
  if (!q || q.claimed) return false;
  const kinds = new Set(p.daily.quests.map((x) => x.kind));
  const pool = QUEST_POOL.filter((x) => !kinds.has(x.kind));
  p.daily.quests[idx] = makeQuest(p, pool[Math.floor(rand() * pool.length)], rand, idx);
  return true;
}

export function claimQuest(p: Profile, idx: number): Quest | null {
  const q = p.daily.quests[idx];
  if (!q || q.claimed || q.progress < q.target) return null;
  q.claimed = true;
  p.coins += q.reward.coins;
  p.gems += q.reward.gems;
  addXp(p, 40);
  return q;
}

export const LOGIN_REWARDS = [
  { coins: 100, gems: 0 }, { coins: 150, gems: 0 }, { coins: 0, gems: 10 }, { coins: 250, gems: 0 },
  { coins: 300, gems: 0 }, { coins: 0, gems: 20 }, { coins: 500, gems: 40 },
];
export function claimLogin(p: Profile) {
  if (p.login.claimed) return null;
  const r = LOGIN_REWARDS[(p.login.streak - 1 + 7) % 7];
  p.coins += r.coins; p.gems += r.gems; p.login.claimed = true;
  return r;
}

// ---- levels ---------------------------------------------------------------------------
export function xpForLevel(level: number) { return 120 + level * 60; }
export interface LevelUp { level: number; coins: number; gems: number }
export function addXp(p: Profile, amount: number): LevelUp[] {
  const ups: LevelUp[] = [];
  p.xp += amount;
  p.pass.xp += amount;
  while (p.xp >= xpForLevel(p.level)) {
    p.xp -= xpForLevel(p.level);
    p.level++;
    const r = { level: p.level, coins: 150 + p.level * 10, gems: p.level % 5 === 0 ? 25 : 0 };
    p.coins += r.coins; p.gems += r.gems;
    ups.push(r);
  }
  return ups;
}

// ---- season pass ------------------------------------------------------------------------
export const PASS_TIERS = 30;
export const PASS_XP_PER_TIER = 350;
export type PassReward = { coins?: number; gems?: number; skin?: string; fighter?: string; crate?: boolean };
export function passReward(tier: number, premium: boolean): PassReward {
  // tier is 1-based
  if (!premium) {
    if (tier % 10 === 0) return { crate: true };
    if (tier % 5 === 0) return { gems: 10 };
    return { coins: 100 + tier * 10 };
  }
  const exclusive = FIGHTERS.map((f) => f.skins[3]?.id).filter(Boolean) as string[];
  const skinTiers = [5, 12, 18, 22, 26, 30];
  const si = skinTiers.indexOf(tier);
  if (si >= 0 && exclusive[si]) return { skin: exclusive[si] };
  if (tier % 4 === 0) return { gems: 40 };
  if (tier % 3 === 0) return { crate: true };
  return { coins: 250 + tier * 15 };
}
export function passTier(p: Profile) { return Math.min(PASS_TIERS, Math.floor(p.pass.xp / PASS_XP_PER_TIER)); }

export function claimPass(p: Profile, tier: number, premium: boolean, rand: () => number = Math.random): { reward: PassReward; crate?: CrateResult } | null {
  if (tier < 1 || tier > passTier(p)) return null;
  if (premium && !p.pass.premium) return null;
  const list = premium ? p.pass.prem : p.pass.free;
  if (list.includes(tier)) return null;
  list.push(tier);
  const reward = passReward(tier, premium);
  let crate: CrateResult | undefined;
  if (reward.coins) p.coins += reward.coins;
  if (reward.gems) p.gems += reward.gems;
  if (reward.skin && !p.skins.includes(reward.skin)) p.skins.push(reward.skin);
  if (reward.fighter && !p.fighters.includes(reward.fighter)) p.fighters.push(reward.fighter);
  if (reward.crate) crate = openCrate(p, rand);
  return { reward, crate };
}

// ---- spending ------------------------------------------------------------------------------
export type BuyResult = { ok: true; crate?: CrateResult } | { ok: false; reason: 'funds' | 'owned' | 'unknown' };

export function buyItem(p: Profile, itemId: string, rand: () => number = Math.random): BuyResult {
  const item = shopCatalog().find((i) => i.id === itemId);
  if (!item) return { ok: false, reason: 'unknown' };
  if (item.kind === 'fighter' && p.fighters.includes(item.ref!)) return { ok: false, reason: 'owned' };
  if (item.kind === 'skin' && p.skins.includes(item.ref!)) return { ok: false, reason: 'owned' };
  const c = item.cost.coins ?? 0, g = item.cost.gems ?? 0;
  if (p.coins < c || p.gems < g) return { ok: false, reason: 'funds' };
  p.coins -= c; p.gems -= g;
  switch (item.kind) {
    case 'fighter': p.fighters.push(item.ref!); break;
    case 'skin': p.skins.push(item.ref!); break;
    case 'coins': p.coins += item.amount!; break;
    case 'crate': return { ok: true, crate: openCrate(p, rand) };
  }
  return { ok: true };
}

export function claimFreeCrate(p: Profile, now = Date.now(), rand: () => number = Math.random): CrateResult | null {
  if (now < p.daily.crateAt) return null;
  p.daily.crateAt = now + FREE_CRATE_COOLDOWN;
  return openCrate(p, rand);
}

/** Grants an IAP product after the store purchase has been verified. */
export function grantIap(p: Profile, productId: string): boolean {
  const prod = IAP_PRODUCTS.find((x) => x.id === productId);
  if (!prod) return false;
  if (prod.oneTime && p.offers.starter && productId === 'starter_pack') return false;
  if (prod.gems) p.gems += prod.gems;
  if (prod.coins) p.coins += prod.coins;
  for (const f of prod.fighters ?? []) if (!p.fighters.includes(f)) p.fighters.push(f);
  for (const s of prod.skins ?? []) if (!p.skins.includes(s)) p.skins.push(s);
  if (prod.noAds) p.noAds = true;
  if (prod.pass) p.pass.premium = true;
  if (productId === 'starter_pack') p.offers.starter = true;
  grantLiveopsIap(p, productId);
  p.payer = true;
  return true;
}

// ---- match rewards ---------------------------------------------------------------------------
export interface MatchSummary {
  matchId: string;
  mode: 'ranked' | 'casual' | 'cpu' | 'private' | 'training' | 'map';
  won: boolean;
  placement: number;     // 1 = first
  players: number;
  kos: number;
  falls: number;
  dmg: number;
  smashKOs: number;
  maxCombo: number;
  fighter: string;
  durationSec: number;
}

export interface RewardResult {
  coins: number;
  gems: number;
  xp: number;
  firstWin: boolean;
  levelUps: LevelUp[];
  questsDone: string[];
  mmrDelta?: number;
  canDouble: boolean;
  runes: number;
  cards: number;
  /** fighter mastery gained this match (liveops hook) */
  mastery?: { fighter: string; xp: number; level: number; up: boolean };
  /** VIP +10% coins (already included in coins) */
  vipCoins?: number;
  /** cosmetics newly unlocked by this match ("kind:id") */
  unlocked?: string[];
}

export function applyMatch(p: Profile, m: MatchSummary, now = Date.now()): RewardResult {
  refreshDaily(p, now);
  if (m.mode === 'training') return { coins: 0, gems: 0, xp: 0, firstWin: false, levelUps: [], questsDone: [], canDouble: false, runes: 0, cards: 0 };
  const online = m.mode === 'ranked' || m.mode === 'casual';
  const offline = m.mode === 'cpu' || m.mode === 'map';
  const bonus = clanBonus(p.clan?.level ?? 0);
  const mult = (m.mode === 'ranked' ? 1.25 : offline ? 0.6 : 1) * (1 + bonus.coins);
  const shortGame = m.durationSec < 25; // anti-farm: very short games give little
  let coins = (m.won ? 45 : 18) + m.kos * 6 + Math.max(0, m.players - m.placement) * 5;
  coins = Math.round(coins * mult * (shortGame ? 0.2 : 1) * matchCoinMultiplier());
  let gems = 0;
  let xp = Math.round(((m.won ? 60 : 35) + m.kos * 5) * (shortGame ? 0.2 : 1) * (offline ? 0.7 : 1) * (1 + bonus.xp) * remoteConfig().economy.matchXpMult);
  let firstWin = false;
  if (m.won && !p.daily.firstWin && !shortGame) {
    p.daily.firstWin = true; firstWin = true; coins += 100; gems += 5; xp += 50;
  }
  p.coins += coins; p.gems += gems;
  const levelUps = addXp(p, xp);
  // runes & fighter cards
  let runes = 0, cards = 0;
  if (!shortGame) {
    runes = m.won ? (m.mode === 'ranked' ? 5 : online ? 3 : 1) + bonus.runes : online ? 1 : 0;
    cards = m.won ? (online ? 2 : 1) : online ? 1 : 0;
  }
  p.runes += runes;
  if (cards && getFighter(m.fighter).id === m.fighter) p.cards[m.fighter] = (p.cards[m.fighter] ?? 0) + cards;
  p.daily.fights++;

  p.stats.matches++;
  if (m.won) p.stats.wins++;
  p.stats.kos += m.kos; p.stats.falls += m.falls; p.stats.dmg += Math.round(m.dmg);
  if (online) p.stats.online++;
  p.stats.bestCombo = Math.max(p.stats.bestCombo, m.maxCombo);
  if (m.won && m.falls === 0) p.stats.flawless++;
  const fs = (p.fstats[m.fighter] ??= { m: 0, w: 0 });
  fs.m++; if (m.won) fs.w++;
  p.history.unshift({ t: now, mode: m.mode, won: m.won, fighter: m.fighter, kos: m.kos, falls: m.falls, dmg: Math.round(m.dmg), place: m.placement, players: m.players, coins });
  if (p.history.length > 25) p.history.length = 25;

  const questsDone: string[] = [];
  for (const q of p.daily.quests) {
    if (q.claimed || q.progress >= q.target) continue;
    let inc = 0;
    switch (q.kind) {
      case 'play': inc = 1; break;
      case 'win': inc = m.won ? 1 : 0; break;
      case 'ko': inc = m.kos; break;
      case 'dmg': inc = Math.round(m.dmg); break;
      case 'smashko': inc = m.smashKOs; break;
      case 'combo': inc = m.maxCombo >= q.target ? q.target : 0; break;
      case 'online': inc = online ? 1 : 0; break;
      case 'winwith': inc = m.won && m.fighter === q.param ? 1 : 0; break;
    }
    q.progress = Math.min(q.target, q.progress + inc);
    if (q.progress >= q.target) questsDone.push(q.id);
  }
  p.lastReward = { id: m.matchId, coins, doubled: false };
  if (m.mode === 'ranked') trackLeague(p);
  const out: RewardResult = { coins, gems, xp, firstWin, levelUps, questsDone, canDouble: coins > 0, runes, cards };
  liveopsAfterMatch(p, m, out, now);
  return out;
}

/** Rewarded-ad "double coins" on the results screen. */
export function doubleLastReward(p: Profile, matchId: string): number {
  const r = p.lastReward;
  if (!r || r.id !== matchId || r.doubled) return 0;
  r.doubled = true;
  p.coins += r.coins;
  return r.coins;
}

export const MAX_REWARDED_ADS_PER_DAY = 20;

export function fighterOwned(p: Profile, id: string) { return p.fighters.includes(id); }
export function skinOwned(p: Profile, fighterId: string, idx: number) {
  const f = getFighter(fighterId);
  return idx === 0 || p.skins.includes(f.skins[idx]?.id);
}

// ---- achievements ----------------------------------------------------------------------------
export interface Achievement {
  id: string; name: string; nameFa: string; desc: string; descFa: string;
  goal: number; progress: (p: Profile) => number; reward: { coins?: number; gems?: number; runes?: number };
}
const winsWith = (p: Profile) => FIGHTERS.filter((f) => (p.fstats[f.id]?.w ?? 0) > 0).length;
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_win', name: 'First Blood', nameFa: 'اولین پیروزی', desc: 'Win a match', descFa: 'یک مسابقه ببر', goal: 1, progress: (p) => p.stats.wins, reward: { coins: 200 } },
  { id: 'wins_10', name: 'Contender', nameFa: 'مدعی', desc: 'Win 10 matches', descFa: '۱۰ مسابقه ببر', goal: 10, progress: (p) => p.stats.wins, reward: { coins: 500 } },
  { id: 'wins_50', name: 'Veteran', nameFa: 'کهنه‌کار', desc: 'Win 50 matches', descFa: '۵۰ مسابقه ببر', goal: 50, progress: (p) => p.stats.wins, reward: { coins: 1000, gems: 25 } },
  { id: 'kos_50', name: 'Heavy Hitter', nameFa: 'مشت سنگین', desc: 'Score 50 KOs', descFa: '۵۰ ناک‌اوت بزن', goal: 50, progress: (p) => p.stats.kos, reward: { coins: 500 } },
  { id: 'kos_250', name: 'Ring Out King', nameFa: 'سلطان ناک‌اوت', desc: 'Score 250 KOs', descFa: '۲۵۰ ناک‌اوت بزن', goal: 250, progress: (p) => p.stats.kos, reward: { coins: 1500, gems: 40 } },
  { id: 'matches_25', name: 'Regular', nameFa: 'پای ثابت', desc: 'Play 25 matches', descFa: '۲۵ مسابقه بازی کن', goal: 25, progress: (p) => p.stats.matches, reward: { coins: 400 } },
  { id: 'matches_100', name: 'Dedicated', nameFa: 'سخت‌کوش', desc: 'Play 100 matches', descFa: '۱۰۰ مسابقه بازی کن', goal: 100, progress: (p) => p.stats.matches, reward: { coins: 1200, gems: 30 } },
  { id: 'combo_5', name: 'Combo Artist', nameFa: 'هنرمند کمبو', desc: 'Land a 5-hit combo', descFa: 'یک کمبوی ۵ ضربه‌ای بزن', goal: 5, progress: (p) => p.stats.bestCombo, reward: { coins: 400, gems: 10 } },
  { id: 'flawless_3', name: 'Untouchable', nameFa: 'دست‌نیافتنی', desc: 'Win 3 matches without falling', descFa: '۳ برد بدون سقوط', goal: 3, progress: (p) => p.stats.flawless, reward: { coins: 600, gems: 15 } },
  { id: 'online_10', name: 'Netplayer', nameFa: 'بازیکن آنلاین', desc: 'Play 10 online matches', descFa: '۱۰ مسابقه آنلاین', goal: 10, progress: (p) => p.stats.online, reward: { coins: 600 } },
  { id: 'gold_rank', name: 'Golden', nameFa: 'طلایی', desc: 'Reach the Gold league', descFa: 'به لیگ طلایی برس', goal: 1300, progress: (p) => p.rank.peak, reward: { coins: 800, gems: 30 } },
  { id: 'crystal_rank', name: 'Crystal Mind', nameFa: 'ذهن کریستالی', desc: 'Reach the Crystal league', descFa: 'به لیگ کریستالی برس', goal: 1550, progress: (p) => p.rank.peak, reward: { coins: 2000, gems: 80 } },
  { id: 'legend_rank', name: 'Living Legend', nameFa: 'افسانه زنده', desc: 'Reach the Legendary league', descFa: 'به لیگ افسانه‌ای برس', goal: 1800, progress: (p) => p.rank.peak, reward: { coins: 5000, gems: 200 } },
  { id: 'map_5', name: 'Explorer', nameFa: 'کاوشگر', desc: 'Clear 5 map stages', descFa: '۵ مرحله نقشه را تمام کن', goal: 5, progress: (p) => p.map?.cleared ?? 0, reward: { coins: 400, runes: 20 } },
  { id: 'map_all', name: 'World Conqueror', nameFa: 'فاتح جهان', desc: 'Clear the whole world map', descFa: 'کل نقشه جهان را تمام کن', goal: MAP_SIZE, progress: (p) => p.map?.cleared ?? 0, reward: { coins: 2000, gems: 60 } },
  { id: 'stars_45', name: 'Star Hunter', nameFa: 'شکارچی ستاره', desc: 'Collect 45 map stars', descFa: '۴۵ ستاره در نقشه جمع کن', goal: 45, progress: (p) => (p.map?.stars ?? []).reduce((a, b) => a + (b || 0), 0), reward: { gems: 50 } },
  { id: 'upgrade_10', name: 'Forged', nameFa: 'آبدیده', desc: 'Buy 10 fighter upgrades', descFa: '۱۰ ارتقای مبارز بخر', goal: 10, progress: (p) => Object.values(p.upg ?? {}).reduce((a, u) => a + u.atk + u.def + u.hp, 0), reward: { coins: 800, runes: 40 } },
  { id: 'spells_4', name: 'Arcanist', nameFa: 'جادوگر', desc: 'Learn 4 spells', descFa: '۴ جادو یاد بگیر', goal: 4, progress: (p) => Object.keys(p.spells ?? {}).length, reward: { gems: 40 } },
  { id: 'level_10', name: 'Rising Star', nameFa: 'ستاره نوظهور', desc: 'Reach level 10', descFa: 'به سطح ۱۰ برس', goal: 10, progress: (p) => p.level, reward: { coins: 700, gems: 20 } },
  { id: 'all_rounder', name: 'Jack of All Trades', nameFa: 'همه‌فن‌حریف', desc: 'Win with every fighter', descFa: 'با همه مبارزها ببر', goal: FIGHTERS.length, progress: winsWith, reward: { coins: 1500, gems: 50 } },
  { id: 'collector', name: 'Collector', nameFa: 'کلکسیونر', desc: 'Own every fighter', descFa: 'همه مبارزها را داشته باش', goal: FIGHTERS.length, progress: (p) => p.fighters.length, reward: { gems: 60 } },
];

export function achievementState(p: Profile, a: Achievement) {
  const value = Math.min(a.goal, a.progress(p));
  return { value, done: value >= a.goal, claimed: p.ach.includes(a.id) };
}
export function claimAchievement(p: Profile, id: string): Achievement | null {
  migrateProfile(p);
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  if (!a) return null;
  const st = achievementState(p, a);
  if (!st.done || st.claimed) return null;
  p.ach.push(id);
  p.coins += a.reward.coins ?? 0; p.gems += a.reward.gems ?? 0; p.runes += (a.reward as { runes?: number }).runes ?? 0;
  return a;
}
export function claimableAchievements(p: Profile) {
  migrateProfile(p);
  return ACHIEVEMENTS.filter((a) => { const s = achievementState(p, a); return s.done && !s.claimed; }).length;
}

// ---- tutorials & feature unlocks --------------------------------------------------------------
export const TUTORIAL_REWARD = { coins: 300, gems: 20, xp: 200 };
/** Marks a tutorial done; the basic tutorial pays a one-time reward. */
export function completeTutorial(p: Profile, id: string): { coins: number; gems: number; xp: number } | null {
  migrateProfile(p);
  if (!/^[a-z0-9_:-]{1,40}$/.test(id) || p.tutorial.includes(id)) return null;
  p.tutorial.push(id);
  if (p.tutorial.length > 80) p.tutorial.splice(0, p.tutorial.length - 80);
  if (id !== 'basic') return null;
  p.coins += TUTORIAL_REWARD.coins; p.gems += TUTORIAL_REWARD.gems;
  addXp(p, TUTORIAL_REWARD.xp);
  return TUTORIAL_REWARD;
}

export type FeatureId =
  | 'quests' | 'shop' | 'achievements' | 'pass' | 'crates' | 'milestones' | 'cards' | 'spells' | 'wheel'
  | 'online' | 'friends' | 'ranked' | 'clans' | 'chat' | 'clanwar'
  | 'deals' | 'collection' | 'mastery' | 'vip';
/**
 * Progressive onboarding: features open up as the player plays, each with its own guided intro.
 * Everything online (quick match, league, clans, chat) opens once the whole world map is cleared.
 */
export const FEATURES: { id: FeatureId; level?: number; matches?: number; map?: number }[] = [
  { id: 'quests', matches: 1 },
  { id: 'milestones', matches: 1 },
  { id: 'shop', matches: 1 },
  { id: 'deals', matches: 2 },
  { id: 'collection', matches: 2 },
  { id: 'cards', map: 1 },
  { id: 'mastery', map: 1 },
  { id: 'vip', matches: 3 },
  { id: 'achievements', matches: 2 },
  { id: 'wheel', map: 2 },
  { id: 'spells', map: 3 },
  { id: 'crates', map: 3 },
  { id: 'pass', map: 4 },
  { id: 'online', map: MAP_SIZE },
  { id: 'friends', map: MAP_SIZE },
  { id: 'ranked', map: MAP_SIZE },
  { id: 'chat', map: MAP_SIZE },
  { id: 'clans', map: MAP_SIZE },
  { id: 'clanwar', map: MAP_SIZE },
];
export function featureUnlocked(p: Profile, id: FeatureId) {
  const f = FEATURES.find((x) => x.id === id);
  if (!f || p.dev) return true;
  return p.level >= (f.level ?? 0) && p.stats.matches >= (f.matches ?? 0) && (p.map?.cleared ?? 0) >= (f.map ?? 0);
}
export function featureRequirement(id: FeatureId) { return FEATURES.find((x) => x.id === id)!; }
