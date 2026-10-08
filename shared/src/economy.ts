import { FIGHTERS, getFighter } from './fighters.ts';

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
  stats: { matches: number; wins: number; kos: number; falls: number; dmg: number; online: number };
  daily: { day: string; quests: Quest[]; firstWin: boolean; rerolls: number; ads: number; crateAt: number };
  login: { lastDay: string; streak: number; claimed: boolean };
  pass: { season: number; xp: number; premium: boolean; free: number[]; prem: number[] };
  offers: { starter: boolean };
  lastReward: { id: string; coins: number; doubled: boolean } | null;
  settings: { lang: 'fa' | 'en'; sfx: boolean; music: boolean; controls: 'buttons' | 'gestures' };
}

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
  items.push({ id: 'crate', kind: 'crate', cost: { gems: 90 } });
  return items;
}

// ---- crates (odds are disclosed in the UI, required by Google Play policy) --------------
export const CRATE_ODDS = [
  { kind: 'coins', min: 400, max: 1200, weight: 55 },
  { kind: 'gems', min: 15, max: 40, weight: 20 },
  { kind: 'skin', weight: 20 },
  { kind: 'fighter', weight: 5 },
] as const;
export const FREE_CRATE_COOLDOWN = 4 * 3600 * 1000;

export type CrateResult =
  | { kind: 'coins'; amount: number }
  | { kind: 'gems'; amount: number }
  | { kind: 'skin'; id: string; dupCoins?: number }
  | { kind: 'fighter'; id: string; dupCoins?: number };

export function openCrate(p: Profile, rand: () => number = Math.random): CrateResult {
  const total = CRATE_ODDS.reduce((a, o) => a + o.weight, 0);
  let roll = rand() * total;
  let pick: (typeof CRATE_ODDS)[number] = CRATE_ODDS[0];
  for (const o of CRATE_ODDS) { if ((roll -= o.weight) < 0) { pick = o; break; } }
  if (pick.kind === 'coins' || pick.kind === 'gems') {
    const amount = Math.round(pick.min + rand() * (pick.max - pick.min));
    if (pick.kind === 'coins') p.coins += amount; else p.gems += amount;
    return { kind: pick.kind, amount };
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
    stats: { matches: 0, wins: 0, kos: 0, falls: 0, dmg: 0, online: 0 },
    daily: { day: '', quests: [], firstWin: false, rerolls: 1, ads: 0, crateAt: 0 },
    login: { lastDay: '', streak: 0, claimed: false },
    pass: { season: currentSeason(now), xp: 0, premium: false, free: [], prem: [] },
    offers: { starter: false },
    lastReward: null,
    settings: { lang: 'fa', sfx: true, music: true, controls: 'buttons' },
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
export function refreshDaily(p: Profile, now = Date.now(), rand: () => number = Math.random) {
  const today = dayKey(now);
  if (p.daily.day !== today) {
    p.daily = { day: today, quests: rollQuests(p, rand), firstWin: false, rerolls: 1, ads: 0, crateAt: p.daily.crateAt };
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
  p.payer = true;
  return true;
}

// ---- match rewards ---------------------------------------------------------------------------
export interface MatchSummary {
  matchId: string;
  mode: 'ranked' | 'casual' | 'cpu' | 'private' | 'training';
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
}

export function applyMatch(p: Profile, m: MatchSummary, now = Date.now()): RewardResult {
  refreshDaily(p, now);
  if (m.mode === 'training') return { coins: 0, gems: 0, xp: 0, firstWin: false, levelUps: [], questsDone: [], canDouble: false };
  const online = m.mode === 'ranked' || m.mode === 'casual';
  const mult = m.mode === 'ranked' ? 1.25 : m.mode === 'cpu' ? 0.6 : 1;
  const shortGame = m.durationSec < 25; // anti-farm: very short games give little
  let coins = (m.won ? 45 : 18) + m.kos * 6 + Math.max(0, m.players - m.placement) * 5;
  coins = Math.round(coins * mult * (shortGame ? 0.2 : 1));
  let gems = 0;
  let xp = Math.round(((m.won ? 60 : 35) + m.kos * 5) * (shortGame ? 0.2 : 1) * (m.mode === 'cpu' ? 0.7 : 1));
  let firstWin = false;
  if (m.won && !p.daily.firstWin && !shortGame) {
    p.daily.firstWin = true; firstWin = true; coins += 100; gems += 5; xp += 50;
  }
  p.coins += coins; p.gems += gems;
  const levelUps = addXp(p, xp);

  p.stats.matches++;
  if (m.won) p.stats.wins++;
  p.stats.kos += m.kos; p.stats.falls += m.falls; p.stats.dmg += Math.round(m.dmg);
  if (online) p.stats.online++;

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
  return { coins, gems, xp, firstWin, levelUps, questsDone, canDouble: coins > 0 };
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
