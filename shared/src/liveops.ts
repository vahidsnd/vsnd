import { FIGHTERS } from './fighters.ts';
import { SPELLS, SPELL_MAX_LEVEL } from './spells.ts';
import { tierFor } from './rank.ts';
import { grantReward, type Granted, type Reward } from './progress.ts';
import { dayKey, featureUnlocked, openCrate, skinPrice, type CrateResult, type MatchSummary, type Profile, type RewardResult } from './economy.ts';
import {
  addMasteryXp, COSMETICS, cosOwned, grantCosmetic, masteryGain, migrateCosmetics, syncCosmetics, type CosKind,
} from './cosmetics.ts';

// =====================================================================================
//  Live-ops economy: daily shop deals, smart (triggered) offers and the VIP subscription.
//  Pure functions on the profile; the server exposes them as routes and the offline client
//  runs the very same code locally.
// =====================================================================================

const DAY = 86400_000;
const HOUR = 3600_000;

/** Deterministic PRNG seeded by a string (FNV-1a → mulberry32). */
export function seededRand(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  let a = h || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Start of the next game day (the day boundary used by dayKey: UTC+3:30 midnight). */
export function nextDayAt(now: number) {
  return new Date(dayKey(now) + 'T00:00:00Z').getTime() + DAY - 3.5 * HOUR;
}

// =====================================================================================
//  VIP monthly subscription
// =====================================================================================
export const VIP_PRODUCT = 'vip_month';
export const VIP_DAYS = 30;
export const VIP_DAILY_GEMS = 20;
export const VIP_COIN_BONUS = 0.1;
export interface VipState { until: number; claimDay: string; spinDay: string; months: number }

export function vipActive(p: Profile, now = Date.now()) { return (p.vip?.until ?? 0) > now; }
export function vipDaysLeft(p: Profile, now = Date.now()) { return Math.max(0, Math.ceil(((p.vip?.until ?? 0) - now) / DAY)); }
/** Purchase / renewal: 30 more days on top of what is left. */
export function grantVip(p: Profile, now = Date.now()) {
  migrateLiveops(p);
  const v = p.vip!;
  v.until = Math.max(now, v.until) + VIP_DAYS * DAY;
  v.months++;
  return v.until;
}
export function vipCanClaim(p: Profile, now = Date.now()) { return vipActive(p, now) && p.vip!.claimDay !== dayKey(now); }
export function claimVipDaily(p: Profile, now = Date.now()): { gems: number } | null {
  migrateLiveops(p);
  if (!vipCanClaim(p, now)) return null;
  p.vip!.claimDay = dayKey(now);
  p.gems += VIP_DAILY_GEMS;
  return { gems: VIP_DAILY_GEMS };
}
/** VIP: one extra lucky-wheel spin per day (used after the free one). */
export function vipSpinAvailable(p: Profile, today: string, now = Date.now()) { return vipActive(p, now) && (p.vip?.spinDay ?? '') !== today; }
export function useVipSpin(p: Profile, today: string) { migrateLiveops(p); p.vip!.spinDay = today; }
export function adsRemoved(p: Profile, now = Date.now()) { return !!p.noAds || vipActive(p, now); }

// =====================================================================================
//  Daily shop deals
// =====================================================================================
export type DealKind = 'fighter' | 'skin' | 'cards' | 'runes' | 'coins' | 'crates' | 'cosmetic';
export interface Deal {
  kind: DealKind;
  ref?: string;                         // fighter id / skin id / "kind:id" cosmetic
  amount?: number;
  cost: { coins?: number; gems?: number };
  was: { coins?: number; gems?: number };
  off: number;                          // discount percent
}
export interface DealsState { day: string; list: Deal[]; bought: number[] }

const round = (v: number, step: number) => Math.max(step, Math.round(v / step) * step);
function priced(was: { coins?: number; gems?: number }, off: number): Deal['cost'] {
  return was.coins ? { coins: round(was.coins * (1 - off / 100), 10) } : { gems: round((was.gems ?? 0) * (1 - off / 100), 5) };
}
const pick = <T>(rand: () => number, arr: T[]) => arr[Math.floor(rand() * arr.length)];
const offIn = (rand: () => number, lo: number, hi: number) => lo + Math.floor(rand() * ((hi - lo) / 5 + 1)) * 5;

/**
 * Today's deals for this player: 4–6 offers seeded by day + player id, generated once per day
 * (so they stay stable after purchases) and the same on the server and the offline client.
 */
export function dailyDeals(p: Profile, now = Date.now()): DealsState {
  migrateLiveops(p);
  const day = dayKey(now);
  if (p.deals && p.deals.day === day && p.deals.list.length) return p.deals;
  const rand = seededRand(`${day}|${p.id}`);
  const list: Deal[] = [];
  // featured fighter at a discount
  const lockedF = FIGHTERS.filter((f) => !p.fighters.includes(f.id) && (f.price.coins || f.price.gems));
  if (lockedF.length) {
    const f = pick(rand, lockedF);
    const off = offIn(rand, 25, 40);
    const was = rand() < 0.5 ? { gems: f.price.gems } : { coins: f.price.coins };
    list.push({ kind: 'fighter', ref: f.id, was, cost: priced(was, off), off });
  } else {
    const n = 2 + Math.floor(rand() * 2), off = 30;
    const was = { gems: 90 * n };
    list.push({ kind: 'crates', amount: n, was, cost: priced(was, off), off });
  }
  // discounted skin
  const skins: { id: string; idx: number }[] = [];
  for (const f of FIGHTERS) f.skins.forEach((s, i) => { if ((i === 1 || i === 2) && !p.skins.includes(s.id)) skins.push({ id: s.id, idx: i }); });
  if (skins.length) {
    const s = pick(rand, skins);
    const off = offIn(rand, 30, 50);
    const was = skinPrice(s.idx)!;
    list.push({ kind: 'skin', ref: s.id, was, cost: priced(was, off), off });
  }
  // fighter cards bundle for an owned fighter
  {
    const f = pick(rand, p.fighters);
    const n = pick(rand, [15, 20, 30]);
    const off = offIn(rand, 30, 45);
    const was = { coins: n * 60 };
    list.push({ kind: 'cards', ref: f, amount: n, was, cost: priced(was, off), off });
  }
  // runes
  {
    const n = pick(rand, [120, 200, 300]);
    const off = offIn(rand, 25, 40);
    const was = { gems: Math.round(n * 0.6) };
    list.push({ kind: 'runes', amount: n, was, cost: priced(was, off), off });
  }
  // coins
  {
    const n = pick(rand, [3000, 6000, 10000]);
    const off = offIn(rand, 20, 35);
    const was = { gems: Math.round(n * 0.045) };
    list.push({ kind: 'coins', amount: n, was, cost: priced(was, off), off });
  }
  // sometimes a 6th deal: a shop cosmetic or a crate pair
  if (rand() < 0.45) {
    const shopCos = (Object.keys(COSMETICS) as CosKind[]).flatMap((k) => COSMETICS[k]).filter((c) => c.src.t === 'shop' && !cosOwned(p, c.kind, c.id, now));
    if (shopCos.length) {
      const c = pick(rand, shopCos);
      const src = c.src as { coins?: number; gems?: number };
      const off = offIn(rand, 30, 40);
      const was = src.coins ? { coins: src.coins } : { gems: src.gems! };
      list.push({ kind: 'cosmetic', ref: `${c.kind}:${c.id}`, was, cost: priced(was, off), off });
    } else if (list[0].kind !== 'crates') {
      const was = { gems: 180 };
      list.push({ kind: 'crates', amount: 2, was, cost: priced(was, 30), off: 30 });
    }
  }
  p.deals = { day, list, bought: [] };
  return p.deals;
}

/** True if the deal's item is already owned (fighter / skin / cosmetic). */
export function dealOwned(p: Profile, d: Deal, now = Date.now()) {
  if (d.kind === 'fighter') return p.fighters.includes(d.ref!);
  if (d.kind === 'skin') return p.skins.includes(d.ref!);
  if (d.kind === 'cosmetic') { const k = d.ref!.split(':')[0] as CosKind; return cosOwned(p, k, d.ref!.slice(k.length + 1), now); }
  return false;
}

export type DealResult = { ok: true; deal: Deal; granted: Granted | null; crates: CrateResult[] } | { ok: false; reason: 'unknown' | 'bought' | 'owned' | 'funds' };
/** Buys deal #idx of today's list. One purchase per deal per day. */
export function buyDeal(p: Profile, idx: number, now = Date.now(), rand: () => number = Math.random): DealResult {
  const st = dailyDeals(p, now);
  const d = st.list[idx];
  if (!d || !Number.isInteger(idx)) return { ok: false, reason: 'unknown' };
  if (st.bought.includes(idx)) return { ok: false, reason: 'bought' };
  if (dealOwned(p, d, now)) return { ok: false, reason: 'owned' };
  const c = d.cost.coins ?? 0, g = d.cost.gems ?? 0;
  if (p.coins < c || p.gems < g) return { ok: false, reason: 'funds' };
  p.coins -= c; p.gems -= g;
  st.bought.push(idx);
  let granted: Granted | null = null;
  const crates: CrateResult[] = [];
  switch (d.kind) {
    case 'fighter': granted = grantReward(p, { fighters: [d.ref!] }, rand); break;
    case 'skin': granted = grantReward(p, { skins: [d.ref!] }, rand); break;
    case 'cards': granted = grantReward(p, { cards: { [d.ref!]: d.amount! } }, rand); break;
    case 'runes': granted = grantReward(p, { runes: d.amount! }, rand); break;
    case 'coins': granted = grantReward(p, { coins: d.amount! }, rand); break;
    case 'crates': for (let i = 0; i < (d.amount ?? 1); i++) crates.push(openCrate(p, rand)); break;
    case 'cosmetic': { const k = d.ref!.split(':')[0] as CosKind; grantCosmetic(p, k, d.ref!.slice(k.length + 1)); break; }
  }
  return { ok: true, deal: d, granted, crates };
}

// =====================================================================================
//  Smart offers: one-time limited packs triggered by what happens to the player
// =====================================================================================
export type SmartId = 'comeback' | 'league' | 'rune' | 'veteran';
export interface SmartOfferDef {
  id: SmartId; name: string; nameFa: string; desc: string; descFa: string;
  product?: string;              // real IAP product id
  gems?: number;                 // or a gem price
  reward: Reward; cos?: string[]; // "kind:id" cosmetics included
  hours: number;                 // how long the offer stays
  badge: string; badgeFa: string;
}
export const SMART_OFFERS: SmartOfferDef[] = [
  {
    id: 'comeback', name: 'Comeback Pack', nameFa: 'بسته بازگشت', product: 'comeback_pack', hours: 24, badge: '-75%', badgeFa: '۷۵٪ تخفیف',
    desc: 'Three tough losses — reload and hit back.', descFa: 'سه باخت سخت پشت سر هم — نیرو بگیر و برگرد.',
    reward: { gems: 120, coins: 3000, anyCards: 12 },
  },
  {
    id: 'league', name: 'League Pack', nameFa: 'بسته لیگ', gems: 150, hours: 48, badge: 'New league', badgeFa: 'لیگ جدید',
    desc: 'You reached a new league. Gear up for tougher rivals.', descFa: 'به لیگ جدید رسیدی. برای حریف‌های سخت‌تر آماده شو.',
    reward: { coins: 6000, runes: 200, crates: 1 },
  },
  {
    id: 'rune', name: 'Rune Pack', nameFa: 'بسته رون', product: 'rune_pack', hours: 48, badge: 'x3 value', badgeFa: '۳ برابر ارزش',
    desc: 'Out of runes? Power up your spells right now.', descFa: 'رونت تمام شد؟ همین حالا جادوهایت را قوی کن.',
    reward: { runes: 600, gems: 60 },
  },
  {
    id: 'veteran', name: 'Veteran Pack', nameFa: 'بسته کهنه‌کار', product: 'veteran_pack', hours: 72, badge: 'Level 10', badgeFa: 'سطح ۱۰',
    desc: 'Level 10! A pack worthy of a seasoned fighter, with an exclusive frame.', descFa: 'سطح ۱۰! بسته‌ای در شأن یک مبارز باتجربه، با قاب انحصاری.',
    reward: { gems: 600, coins: 15000, crates: 3 }, cos: ['frame:veteran'],
  },
];
export const SMART_PRODUCTS = SMART_OFFERS.filter((o) => o.product).map((o) => o.product!);
export function smartDef(id: string) { return SMART_OFFERS.find((o) => o.id === id); }

export interface SmartOffer { id: SmartId; at: number; exp: number; bought: boolean; shown: boolean }
export interface SmartState { day: string; done: string[]; list: SmartOffer[]; losses: number; tier: number }

/** Cheapest rune cost of the next spell step (learn or level up), or Infinity if maxed. */
export function nextRuneNeed(p: Profile) {
  let best = Infinity;
  for (const s of SPELLS) {
    const lv = p.spells?.[s.id] ?? 0;
    const cost = lv === 0 ? s.unlock : lv < SPELL_MAX_LEVEL ? s.upgrade[lv - 1] : Infinity;
    if (cost > 0) best = Math.min(best, cost);
  }
  return best;
}
function runesSpent(p: Profile) { return Object.entries(p.spells ?? {}).some(([id, lv]) => id !== 'nova' || lv > 1); }

function triggered(p: Profile, id: SmartId, now: number): boolean {
  const s = p.smart!;
  switch (id) {
    case 'comeback': return s.losses >= 3;
    case 'league': return tierFor(p.rank.peak).index > s.tier;
    case 'rune': return featureUnlocked(p, 'spells') && runesSpent(p) && p.runes < nextRuneNeed(p) && Number.isFinite(nextRuneNeed(p));
    case 'veteran': return p.level >= 10;
  }
  void now;
  return false;
}

/**
 * Evaluates the trigger rules. At most one NEW offer per day; every offer fires once per player.
 * Returns the offer created now (or null).
 */
export function checkSmartOffers(p: Profile, now = Date.now()): SmartOffer | null {
  migrateLiveops(p);
  const s = p.smart!;
  const today = dayKey(now);
  if (s.day === today || !featureUnlocked(p, 'shop') || p.stats.matches < 3) return null;
  for (const def of SMART_OFFERS) {
    if (s.done.includes(def.id) || !triggered(p, def.id, now)) continue;
    const o: SmartOffer = { id: def.id, at: now, exp: now + def.hours * HOUR, bought: false, shown: false };
    s.done.push(def.id);
    s.list.push(o);
    s.day = today;
    if (def.id === 'league') s.tier = tierFor(p.rank.peak).index;
    if (s.list.length > 10) s.list.splice(0, s.list.length - 10);
    return o;
  }
  return null;
}
export function activeOffers(p: Profile, now = Date.now()) {
  return (p.smart?.list ?? []).filter((o) => !o.bought && o.exp > now);
}
export function markOfferShown(p: Profile, id: string) {
  const o = p.smart?.list.find((x) => x.id === id);
  if (o) o.shown = true;
  return !!o;
}
function grantSmart(p: Profile, def: SmartOfferDef, rand: () => number) {
  const g = grantReward(p, def.reward, rand);
  for (const k of def.cos ?? []) { const kind = k.split(':')[0] as CosKind; grantCosmetic(p, kind, k.slice(kind.length + 1)); }
  return g;
}
export type OfferBuyResult = { ok: true; granted: Granted } | { ok: false; reason: 'unknown' | 'expired' | 'funds' | 'iap' };
/** Buys a gem-priced smart offer (IAP ones go through billing → grantIap). */
export function buySmartOffer(p: Profile, id: string, now = Date.now(), rand: () => number = Math.random): OfferBuyResult {
  migrateLiveops(p);
  const def = smartDef(id);
  if (!def) return { ok: false, reason: 'unknown' };
  if (!def.gems) return { ok: false, reason: 'iap' };
  const o = activeOffers(p, now).find((x) => x.id === id);
  if (!o) return { ok: false, reason: 'expired' };
  if (p.gems < def.gems) return { ok: false, reason: 'funds' };
  p.gems -= def.gems;
  o.bought = true;
  return { ok: true, granted: grantSmart(p, def, rand) };
}

/** Called by grantIap after a verified purchase of one of this module's products. */
export function grantLiveopsIap(p: Profile, productId: string, now = Date.now(), rand: () => number = Math.random): Granted | null {
  migrateLiveops(p);
  if (productId === VIP_PRODUCT) { grantVip(p, now); return null; }
  const def = SMART_OFFERS.find((o) => o.product === productId);
  if (!def) return null;
  const o = p.smart!.list.find((x) => x.id === def.id && !x.bought);
  if (o) o.bought = true;
  else if (!p.smart!.done.includes(def.id)) p.smart!.done.push(def.id);
  return grantSmart(p, def, rand);
}

// =====================================================================================
//  Match hook (called at the end of applyMatch): VIP coin bonus, mastery, loss streak,
//  cosmetics unlocks and smart-offer triggers.
// =====================================================================================
export function liveopsAfterMatch(p: Profile, m: MatchSummary, res: RewardResult, now = Date.now()) {
  migrateLiveops(p);
  if (vipActive(p, now) && res.coins > 0) {
    const extra = Math.round(res.coins * VIP_COIN_BONUS);
    p.coins += extra; res.coins += extra; res.vipCoins = extra;
    if (p.lastReward) p.lastReward.coins = res.coins;
  }
  if (FIGHTERS.some((f) => f.id === m.fighter)) {
    const mg = addMasteryXp(p, m.fighter, masteryGain(m));
    if (mg) res.mastery = mg;
  }
  p.smart!.losses = m.won ? 0 : p.smart!.losses + 1;
  const added = syncCosmetics(p, now);
  if (added.length) res.unlocked = added.map((c) => `${c.kind}:${c.id}`);
  checkSmartOffers(p, now);
}

// ---- migration ---------------------------------------------------------------------------------
export function migrateLiveops(p: Profile): Profile {
  p.vip ??= { until: 0, claimDay: '', spinDay: '', months: 0 };
  p.smart ??= { day: '', done: [], list: [], losses: 0, tier: tierFor(p.rank?.peak ?? 1000).index };
  migrateCosmetics(p);
  return p;
}
