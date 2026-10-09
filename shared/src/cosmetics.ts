import { FIGHTERS } from './fighters.ts';
import { TIERS } from './rank.ts';
import { grantReward, type Granted, type Reward } from './progress.ts';
import { passTier, type Profile } from './economy.ts';
import { vipActive } from './liveops.ts';

// =====================================================================================
//  Cosmetics & fighter mastery
//   • Emotes (in-match quick chat, loadout of 6), profile frames, titles, victory poses.
//   • Sources: free, shop (coins / gems), season pass tiers, achievements, weekly-league
//     trophies, VIP, fighter mastery, raids, the world map, special offers.
//   • Fighter mastery: per-fighter XP from matches (more for wins), 10 levels with a
//     claimable reward each, a mastery title at 5 and an exclusive frame at 10.
//  Pure functions on the profile so the server and the offline client share the rules.
// =====================================================================================

export type CosKind = 'emote' | 'frame' | 'title' | 'pose';
export type CosSource =
  | { t: 'free' }
  | { t: 'shop'; coins?: number; gems?: number }
  | { t: 'pass'; tier: number; premium?: boolean }
  | { t: 'ach'; id: string }
  | { t: 'trophy'; tier?: number; place: number }
  | { t: 'vip' }
  | { t: 'mastery'; fighter: string; level: number }
  | { t: 'map' }
  | { t: 'raid'; stars: number }
  | { t: 'level'; level: number }
  | { t: 'grant' };              // only from a pack / offer

export interface Cosmetic {
  kind: CosKind; id: string; name: string; nameFa: string; src: CosSource;
  /** emotes: stable network id (index sent in the match protocol) */
  n?: number;
  /** frames: ring colours */
  c1?: string; c2?: string;
}

export const EMOTE_SLOTS = 6;

const E = (n: number, id: string, name: string, nameFa: string, src: CosSource): Cosmetic => ({ kind: 'emote', id, n, name, nameFa, src });
/** Network ids 0–4 are the five original quick-chat emotes (kept for old clients). */
export const EMOTES: Cosmetic[] = [
  E(0, 'gg', 'GG', 'GG', { t: 'free' }),
  E(1, 'gl', 'GL', 'GL', { t: 'free' }),
  E(2, 'bang', '!', '!', { t: 'free' }),
  E(3, 'what', '?', '?', { t: 'free' }),
  E(4, 'nice', 'Nice', 'عالی', { t: 'free' }),
  E(5, 'wp', 'Well played', 'خوب بازی کردی', { t: 'shop', coins: 800 }),
  E(6, 'wow', 'Wow!', 'واو!', { t: 'shop', coins: 800 }),
  E(7, 'sorry', 'Sorry!', 'ببخشید!', { t: 'shop', coins: 600 }),
  E(8, 'thanks', 'Thanks!', 'مرسی!', { t: 'shop', coins: 600 }),
  E(9, 'rematch', 'Rematch?', 'یه دست دیگه؟', { t: 'shop', gems: 40 }),
  E(10, 'close', 'Close one!', 'نزدیک بود!', { t: 'pass', tier: 8 }),
  E(11, 'onfire', 'On fire!', 'داغ کردم!', { t: 'ach', id: 'wins_10' }),
  E(12, 'bow', 'Bow down', 'تعظیم کن', { t: 'trophy', place: 3 }),
  E(13, 'calm', 'Stay calm', 'آروم باش', { t: 'shop', gems: 60 }),
  E(14, 'vip', 'VIP in the house', 'VIP اومد', { t: 'vip' }),
  E(15, 'raid', 'Raid time!', 'وقت حمله‌ست!', { t: 'raid', stars: 3 }),
];
export const DEFAULT_EMOTES = ['gg', 'gl', 'bang', 'what', 'nice', ''];

const F = (id: string, name: string, nameFa: string, c1: string, c2: string, src: CosSource): Cosmetic => ({ kind: 'frame', id, name, nameFa, c1, c2, src });
export const FRAMES: Cosmetic[] = [
  F('steel', 'Steel', 'فولادی', '#c9d3e0', '#5d6a85', { t: 'shop', coins: 1500 }),
  F('neon', 'Neon Pulse', 'پالس نئون', '#29e3f0', '#ff3d7f', { t: 'shop', gems: 100 }),
  F('ember', 'Ember', 'اخگر', '#ff8a3d', '#ff3d5c', { t: 'shop', gems: 150 }),
  F('gold', 'Gold League', 'لیگ طلایی', '#ffd23f', '#b07a00', { t: 'ach', id: 'gold_rank' }),
  F('season', 'Season Elite', 'نخبه فصل', '#b48cff', '#29e3f0', { t: 'pass', tier: 15, premium: true }),
  F('champion', 'Champion', 'قهرمان', '#ffd23f', '#ff4f8b', { t: 'trophy', place: 1 }),
  F('conqueror', 'Conqueror', 'فاتح', '#2ee59d', '#29e3f0', { t: 'map' }),
  F('vip', 'VIP', 'VIP', '#ffd66b', '#f5b301', { t: 'vip' }),
  F('veteran', 'Veteran', 'کهنه‌کار', '#d08a52', '#ffd23f', { t: 'grant' }),
  ...FIGHTERS.map((f) => F(`m:${f.id}`, `${f.name} Mastery`, `استادی ${f.nameFa}`, f.skins[0].main, f.skins[0].glow, { t: 'mastery', fighter: f.id, level: 10 })),
];

const T = (id: string, name: string, nameFa: string, src: CosSource): Cosmetic => ({ kind: 'title', id, name, nameFa, src });
export const TITLES: Cosmetic[] = [
  T('brawler', 'Street Brawler', 'مبارز خیابانی', { t: 'shop', coins: 2000 }),
  T('ghost', 'Neon Ghost', 'شبح نئون', { t: 'shop', gems: 80 }),
  T('unbreakable', 'Unbreakable', 'شکست‌ناپذیر', { t: 'shop', gems: 120 }),
  T('rising', 'Rising Star', 'ستاره نوظهور', { t: 'ach', id: 'level_10' }),
  T('veteran', 'Veteran', 'کهنه‌کار', { t: 'ach', id: 'wins_50' }),
  T('legend', 'Living Legend', 'افسانه زنده', { t: 'ach', id: 'legend_rank' }),
  T('collector', 'Collector', 'کلکسیونر', { t: 'ach', id: 'collector' }),
  T('conqueror', 'Map Conqueror', 'فاتح نقشه', { t: 'map' }),
  T('raider', 'Clan Raider', 'مهاجم قبیله', { t: 'raid', stars: 3 }),
  T('podium', 'Podium Finisher', 'سکونشین', { t: 'trophy', place: 3 }),
  ...TIERS.map((tt, i) => T(`champ:${i}`, `Weekly Champion – ${tt.name}`, `قهرمان هفته – ${tt.nameFa}`, { t: 'trophy', tier: i, place: 1 })),
  T('season', 'Season Elite', 'نخبه فصل', { t: 'pass', tier: 25, premium: true }),
  T('vip', 'VIP', 'VIP', { t: 'vip' }),
  ...FIGHTERS.map((f) => T(`m:${f.id}`, `${f.name} Master`, `استاد ${f.nameFa}`, { t: 'mastery', fighter: f.id, level: 5 })),
];

const P = (id: string, name: string, nameFa: string, src: CosSource): Cosmetic => ({ kind: 'pose', id, name, nameFa, src });
/** Victory poses for the results screen (rendered as preview animations on the client). */
export const POSES: Cosmetic[] = [
  P('classic', 'Classic', 'کلاسیک', { t: 'free' }),
  P('flip', 'Air Flip', 'پشتک هوایی', { t: 'shop', coins: 2500 }),
  P('taunt', 'Taunt', 'کُری', { t: 'shop', gems: 120 }),
  P('leap', 'Victory Leap', 'پرش پیروزی', { t: 'pass', tier: 20 }),
  P('spin', 'Whirlwind', 'گردباد', { t: 'vip' }),
  P('stomp', 'Ground Stomp', 'کوبش زمین', { t: 'ach', id: 'kos_250' }),
];

export const COSMETICS: Record<CosKind, Cosmetic[]> = { emote: EMOTES, frame: FRAMES, title: TITLES, pose: POSES };
export function getCosmetic(kind: CosKind, id: string): Cosmetic | undefined {
  return COSMETICS[kind]?.find((c) => c.id === id);
}
export const cosKey = (kind: CosKind, id: string) => `${kind}:${id}`;
export function emoteByNet(n: number) { return EMOTES.find((e) => e.n === n); }

// ---- profile state ---------------------------------------------------------------------------
export interface CosState {
  own: string[];                    // persisted unlocks (bought / reached), keys "kind:id"
  frame: string;                    // equipped frame ('' = none)
  title: string;                    // equipped title ('' = none)
  emotes: string[];                 // loadout of EMOTE_SLOTS emote ids ('' = empty)
  pose: Record<string, string>;     // fighter id -> pose id
  raid: number;                     // raid stars earned (Clan Raider)
}
export interface MasteryState { xp: number; cl: number }   // cl = highest claimed level

export function migrateCosmetics(p: Profile) {
  p.cos ??= { own: [], frame: '', title: '', emotes: [...DEFAULT_EMOTES], pose: {}, raid: 0 };
  p.cos.own ??= []; p.cos.pose ??= {}; p.cos.raid ??= 0; p.cos.frame ??= ''; p.cos.title ??= '';
  if (!Array.isArray(p.cos.emotes) || p.cos.emotes.length !== EMOTE_SLOTS) p.cos.emotes = [...DEFAULT_EMOTES];
  if (!p.mastery) {
    // existing players start with mastery from their match history
    p.mastery = {};
    for (const [fid, s] of Object.entries(p.fstats ?? {})) {
      const xp = s.w * 30 + (s.m - s.w) * 12;
      if (xp > 0) p.mastery[fid] = { xp: Math.min(xp, MASTERY_XP[MASTERY_MAX]), cl: 0 };
    }
  }
}

/** Is a cosmetic's earn condition met right now (shop / grant items never are)? */
function conditionMet(p: Profile, c: Cosmetic, now: number): boolean {
  const s = c.src;
  switch (s.t) {
    case 'free': return true;
    case 'pass': return passTier(p) >= s.tier && (!s.premium || p.pass.premium);
    case 'ach': return p.ach.includes(s.id);
    case 'trophy': return (p.trophies ?? []).some((tr) => tr.place <= s.place && (s.tier === undefined || tr.tier === s.tier));
    case 'vip': return vipActive(p, now);
    case 'mastery': return masteryLevel(p.mastery?.[s.fighter]?.xp ?? 0) >= s.level;
    case 'map': return (p.map?.cleared ?? 0) >= 20;
    case 'raid': return (p.cos?.raid ?? 0) >= s.stars;
    case 'level': return p.level >= s.level;
    default: return false;
  }
}

export function cosOwned(p: Profile, kind: CosKind, id: string, now = Date.now()): boolean {
  const c = getCosmetic(kind, id);
  if (!c) return false;
  return (p.cos?.own ?? []).includes(cosKey(kind, id)) || conditionMet(p, c, now);
}

/**
 * Persists newly earned (non-VIP) cosmetics so they stay owned even when the condition
 * lapses (season pass reset). Returns the newly unlocked items.
 */
export function syncCosmetics(p: Profile, now = Date.now()): Cosmetic[] {
  migrateCosmetics(p);
  const out: Cosmetic[] = [];
  for (const list of Object.values(COSMETICS)) for (const c of list) {
    if (c.src.t === 'free' || c.src.t === 'vip' || c.src.t === 'shop' || c.src.t === 'grant') continue;
    const k = cosKey(c.kind, c.id);
    if (!p.cos!.own.includes(k) && conditionMet(p, c, now)) { p.cos!.own.push(k); out.push(c); }
  }
  return out;
}

export function grantCosmetic(p: Profile, kind: CosKind, id: string) {
  migrateCosmetics(p);
  const k = cosKey(kind, id);
  if (getCosmetic(kind, id) && !p.cos!.own.includes(k)) p.cos!.own.push(k);
}

export type CosBuyResult = { ok: true } | { ok: false; reason: 'unknown' | 'owned' | 'funds' | 'not-for-sale' };
export function buyCosmetic(p: Profile, kind: CosKind, id: string, now = Date.now()): CosBuyResult {
  migrateCosmetics(p);
  const c = getCosmetic(kind, id);
  if (!c) return { ok: false, reason: 'unknown' };
  if (c.src.t !== 'shop') return { ok: false, reason: 'not-for-sale' };
  if (cosOwned(p, kind, id, now)) return { ok: false, reason: 'owned' };
  const coins = c.src.coins ?? 0, gems = c.src.gems ?? 0;
  if (p.coins < coins || p.gems < gems) return { ok: false, reason: 'funds' };
  p.coins -= coins; p.gems -= gems;
  p.cos!.own.push(cosKey(kind, id));
  return { ok: true };
}

/**
 * Equips a cosmetic. frame/title: id '' unequips. emote: needs `slot` (0..5), id '' clears the
 * slot; an emote already in another slot is swapped. pose: needs `fighter`.
 */
export function equipCosmetic(p: Profile, kind: CosKind, id: string, opts: { slot?: number; fighter?: string } = {}, now = Date.now()): boolean {
  migrateCosmetics(p);
  const cos = p.cos!;
  if (id !== '' && !cosOwned(p, kind, id, now)) return false;
  switch (kind) {
    case 'frame': cos.frame = id; return true;
    case 'title': cos.title = id; return true;
    case 'emote': {
      const slot = opts.slot ?? -1;
      if (!Number.isInteger(slot) || slot < 0 || slot >= EMOTE_SLOTS) return false;
      const prev = cos.emotes.indexOf(id);
      if (id !== '' && prev >= 0) cos.emotes[prev] = cos.emotes[slot];
      cos.emotes[slot] = id;
      return true;
    }
    case 'pose': {
      if (!opts.fighter || !FIGHTERS.some((f) => f.id === opts.fighter) || id === '') return false;
      cos.pose[opts.fighter] = id;
      return true;
    }
  }
  return false;
}

// ---- display helpers (fall back when an item is no longer owned, e.g. VIP ended) ---------------
export function equippedFrame(p: Profile, now = Date.now()) { const f = p.cos?.frame ?? ''; return f && cosOwned(p, 'frame', f, now) ? f : ''; }
export function equippedTitle(p: Profile, now = Date.now()) { const t = p.cos?.title ?? ''; return t && cosOwned(p, 'title', t, now) ? t : ''; }
/** Network ids of the emotes in the loadout (empty / no-longer-owned slots skipped). */
export function emoteLoadout(p: Profile, now = Date.now()): number[] {
  const ids = p.cos?.emotes ?? DEFAULT_EMOTES;
  return ids.filter((id) => id && cosOwned(p, 'emote', id, now)).map((id) => getCosmetic('emote', id)!.n!);
}
export function ownsEmoteNet(p: Profile, n: number, now = Date.now()) {
  const e = emoteByNet(n);
  return !!e && (e.src.t === 'free' || cosOwned(p, 'emote', e.id, now));
}
export function poseFor(p: Profile, fighter: string, now = Date.now()) {
  const id = p.cos?.pose?.[fighter] ?? 'classic';
  return cosOwned(p, 'pose', id, now) ? id : 'classic';
}
/** Public badges carried on chat messages, leaderboard rows and match configs. */
export function publicBadges(p: Profile, now = Date.now()): { frame?: string; title?: string; vip?: boolean } {
  const out: { frame?: string; title?: string; vip?: boolean } = {};
  const f = equippedFrame(p, now), t = equippedTitle(p, now);
  if (f) out.frame = f;
  if (t) out.title = t;
  if (vipActive(p, now)) out.vip = true;
  return out;
}
/** title / frame for a MatchConfig player entry */
export function matchBadges(p: Profile, now = Date.now()): { title?: string; frame?: string } {
  const b = publicBadges(p, now);
  return { ...(b.title ? { title: b.title } : {}), ...(b.frame ? { frame: b.frame } : {}) };
}
export function titleText(id: string | undefined, fa: boolean) {
  const c = id ? getCosmetic('title', id) : undefined;
  return c ? (fa ? c.nameFa : c.name) : '';
}

/** Raid fights feed the Clan Raider title / emote. */
export function noteRaidStars(p: Profile, stars: number) {
  migrateCosmetics(p);
  p.cos!.raid += Math.max(0, Math.min(3, stars | 0));
}

// =====================================================================================
//  Fighter mastery
// =====================================================================================
export const MASTERY_MAX = 10;
/** cumulative XP needed for mastery level i */
export const MASTERY_XP = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200, 4000];
export function masteryLevel(xp: number) {
  let l = 0;
  while (l < MASTERY_MAX && xp >= MASTERY_XP[l + 1]) l++;
  return l;
}
export function masteryInfo(p: Profile, fid: string) {
  const st = p.mastery?.[fid] ?? { xp: 0, cl: 0 };
  const level = masteryLevel(st.xp);
  const base = MASTERY_XP[level], next = MASTERY_XP[Math.min(MASTERY_MAX, level + 1)];
  return { xp: st.xp, level, claimed: st.cl, pending: Math.max(0, level - st.cl), into: st.xp - base, need: next - base, max: level >= MASTERY_MAX };
}
export interface MasteryReward { reward: Reward; title?: string; frame?: string }
export function masteryReward(fid: string, level: number): MasteryReward {
  const cards = (n: number): Reward => ({ cards: { [fid]: n } });
  switch (level) {
    case 1: return { reward: { coins: 300 } };
    case 2: return { reward: cards(6) };
    case 3: return { reward: { coins: 600 } };
    case 4: return { reward: cards(10) };
    case 5: return { reward: { runes: 60 }, title: `m:${fid}` };
    case 6: return { reward: { coins: 1000 } };
    case 7: return { reward: cards(14) };
    case 8: return { reward: { gems: 25 } };
    case 9: return { reward: { coins: 1500, ...cards(20) } };
    case 10: return { reward: { gems: 60 }, frame: `m:${fid}` };
  }
  return { reward: {} };
}
/** Mastery XP for one match (wins are worth more; very short games give little). */
export function masteryGain(m: { won: boolean; kos: number; durationSec: number }) {
  const base = m.won ? 30 + Math.min(12, m.kos) * 3 : 12 + Math.min(12, m.kos);
  return m.durationSec < 25 ? Math.round(base * 0.2) : base;
}
export function addMasteryXp(p: Profile, fid: string, xp: number) {
  migrateCosmetics(p);
  if (!FIGHTERS.some((f) => f.id === fid) || xp <= 0) return null;
  const st = (p.mastery![fid] ??= { xp: 0, cl: 0 });
  const before = masteryLevel(st.xp);
  st.xp = Math.min(MASTERY_XP[MASTERY_MAX], st.xp + Math.round(xp));
  const level = masteryLevel(st.xp);
  return { fighter: fid, xp: Math.round(xp), level, up: level > before };
}
/** Claims every reached-but-unclaimed mastery level of a fighter. */
export function claimMastery(p: Profile, fid: string, rand: () => number = Math.random): { levels: number[]; granted: Granted; titles: string[]; frames: string[] } | null {
  migrateCosmetics(p);
  const st = p.mastery?.[fid];
  if (!st || !p.fighters.includes(fid)) return null;
  const level = masteryLevel(st.xp);
  if (level <= st.cl) return null;
  const total: Reward = {};
  const levels: number[] = [], titles: string[] = [], frames: string[] = [];
  for (let l = st.cl + 1; l <= level; l++) {
    const r = masteryReward(fid, l);
    levels.push(l);
    for (const [k, v] of Object.entries(r.reward)) {
      if (k === 'cards') { total.cards ??= {}; for (const [f, n] of Object.entries(v as Record<string, number>)) total.cards[f] = (total.cards[f] ?? 0) + n; }
      else (total as any)[k] = ((total as any)[k] ?? 0) + (v as number);
    }
    if (r.title) { titles.push(r.title); grantCosmetic(p, 'title', r.title); }
    if (r.frame) { frames.push(r.frame); grantCosmetic(p, 'frame', r.frame); }
  }
  st.cl = level;
  return { levels, granted: grantReward(p, total, rand), titles, frames };
}
export function claimableMastery(p: Profile) {
  return p.fighters.reduce((a, f) => a + (masteryInfo(p, f).pending > 0 ? 1 : 0), 0);
}
