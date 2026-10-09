import { getFighter } from './fighters.ts';
import { STAGES } from './stages.ts';
import { grantReward, migrateProgress, type Granted, type Reward } from './progress.ts';
import { hash32, presetRules, type MatchRules, type RuleMode } from './rules.ts';
import type { Profile } from './economy.ts';
import type { MatchConfig } from './types.ts';

// =====================================================================================
//  Timed events
//  A rotating calendar of special modes. Every week (starting Saturday 00:00 Tehran) has
//  three back-to-back event slots of 3 + 2 + 2 days; each slot runs one event mode from
//  EVENT_DEFS in rotation. Dated specials (SPECIAL_EVENTS) override the rotation.
//  Every event has its own reward track: win X matches in the event (vs CPU offline or in
//  the online event queue) to unlock rewards, ending with an event-exclusive skin and a
//  collectible event token.
// =====================================================================================

declare module './economy.ts' {
  interface Profile {
    /** progress in the current event (reset when a new event starts) */
    ev?: EventProgress;
    /** collectible event tokens (cosmetic, shown on the profile) */
    evTokens?: string[];
  }
}

export interface EventProgress { key: string; wins: number; played: number; claimed: number[]; cpuDay?: string; cpu?: number }

export interface EventSkin { fighter: string; id: string; name: string; nameFa: string; main: string; second: string; glow: string }
export interface EventDef {
  id: string;
  name: string; nameFa: string;
  desc: string; descFa: string;
  mode: RuleMode;
  color: string;
  icon: string;
  stages: string[];
  skin: EventSkin;
  token: { name: string; nameFa: string };
}

export const EVENT_DEFS: EventDef[] = [
  {
    id: 'moonwalk', name: 'Moon Walk', nameFa: 'راه‌رفتن روی ماه', mode: 'lowgrav', color: '#9ad8ff', icon: 'sparkles',
    desc: 'Low gravity: floaty jumps, long launches, items on.', descFa: 'جاذبه کم: پرش‌های بلند، پرتاب‌های دور، آیتم‌ها روشن.',
    stages: ['dojo', 'skyruins', 'orbit', 'glacier'],
    skin: { fighter: 'zephyr', id: 'zephyr_ev_moon', name: 'Lunar', nameFa: 'ماهتابی', main: '#c9d6f2', second: '#3a4a7a', glow: '#9ad8ff' },
    token: { name: 'Moon Token', nameFa: 'نشان ماه' },
  },
  {
    id: 'arcane', name: 'Arcane Storm', nameFa: 'طوفان جادو', mode: 'spells', color: '#b48cff', icon: 'sparkles',
    desc: 'Spells only: the meter fills in seconds, normal attacks deal half damage.', descFa: 'فقط جادو: نوار جادو در چند ثانیه پر می‌شود و ضربه‌های معمولی نصف آسیب دارند.',
    stages: ['cathedral', 'temple', 'shrine', 'garden'],
    skin: { fighter: 'nyx', id: 'nyx_ev_arcane', name: 'Arcanist', nameFa: 'جادوگر اعظم', main: '#4b2a86', second: '#e8d6ff', glow: '#c08cff' },
    token: { name: 'Arcane Token', nameFa: 'نشان جادو' },
  },
  {
    id: 'titans', name: 'Clash of Titans', nameFa: 'نبرد غول‌ها', mode: 'giant', color: '#ffb347', icon: 'zap',
    desc: 'Giant mode: every fighter is bigger and heavier.', descFa: 'حالت غول: همه مبارزها بزرگ‌تر و سنگین‌ترند.',
    stages: ['rooftop', 'canyon', 'forge', 'highway'],
    skin: { fighter: 'boulder', id: 'boulder_ev_titan', name: 'Titan', nameFa: 'تایتان', main: '#6b5a48', second: '#ffcf8a', glow: '#ffb347' },
    token: { name: 'Titan Token', nameFa: 'نشان تایتان' },
  },
  {
    id: 'laststand', name: 'Last Stand', nameFa: 'آخرین ایستادگی', mode: 'stamina', color: '#ff4f6d', icon: 'heart',
    desc: 'Stamina: 150 HP per life, KO at zero. Heal capsules and bombs drop in.', descFa: 'استقامت: ۱۵۰ جان در هر زندگی، با صفر شدن ناک‌اوت. کپسول درمان و بمب می‌افتد.',
    stages: ['bazaar', 'reactor', 'jungle', 'rooftop'],
    skin: { fighter: 'kira', id: 'kira_ev_crimson', name: 'Crimson Oath', nameFa: 'پیمان سرخ', main: '#7a1022', second: '#f4e0c8', glow: '#ff4f6d' },
    token: { name: 'Stand Token', nameFa: 'نشان ایستادگی' },
  },
  {
    id: 'frenzy', name: 'Item Frenzy', nameFa: 'جنون آیتم', mode: 'items', color: '#2ee6a6', icon: 'gift',
    desc: 'Items rain twice as often: bombs, boots, bubbles, heals and mana.', descFa: 'آیتم‌ها دو برابر می‌افتند: بمب، کفش سرعت، حباب محافظ، درمان و جادو.',
    stages: ['bazaar', 'garden', 'highway', 'jungle'],
    skin: { fighter: 'pip', id: 'pip_ev_frenzy', name: 'Gadgeteer', nameFa: 'آچار به دست', main: '#1e6a52', second: '#ffe066', glow: '#2ee6a6' },
    token: { name: 'Frenzy Token', nameFa: 'نشان جنون' },
  },
  {
    id: 'sudden', name: 'Sudden Death', nameFa: 'مرگ ناگهانی', mode: 'sudden', color: '#ffd23f', icon: 'flame',
    desc: 'Every life starts at 300%. One clean hit decides it.', descFa: 'هر زندگی از ۳۰۰٪ شروع می‌شود. یک ضربه تمیز همه‌چیز را تمام می‌کند.',
    stages: ['dojo', 'rooftop', 'canyon', 'orbit'],
    skin: { fighter: 'blaze', id: 'blaze_ev_sudden', name: 'Last Ember', nameFa: 'آخرین اخگر', main: '#2a2a2a', second: '#ffd23f', glow: '#ff8a00' },
    token: { name: 'Ember Token', nameFa: 'نشان اخگر' },
  },
];

/** Dated specials that replace the rotation while they run. */
export const SPECIAL_EVENTS: { def: EventDef; start: number; end: number }[] = [
  {
    // Yalda night (longest night of the year): 20 Dec 2026 20:30 UTC = 21 Dec 00:00 Tehran, three days
    start: Date.UTC(2026, 11, 20, 20, 30), end: Date.UTC(2026, 11, 23, 20, 30),
    def: {
      id: 'yalda', name: 'Yalda Night', nameFa: 'شب یلدا', mode: 'lowgrav', color: '#ff3d7f', icon: 'star',
      desc: 'The longest night: low gravity, pomegranate-red skies and double items.', descFa: 'بلندترین شب سال: جاذبه کم و آیتم‌های بیشتر.',
      stages: ['garden', 'shrine', 'dojo'],
      skin: { fighter: 'mira', id: 'mira_ev_yalda', name: 'Pomegranate', nameFa: 'انار', main: '#8a0f2a', second: '#ffd6a0', glow: '#ff3d7f' },
      token: { name: 'Yalda Token', nameFa: 'نشان یلدا' },
    },
  },
];

// event skins are real skins of their fighter (index 4+), granted only by the event track
for (const d of [...EVENT_DEFS, ...SPECIAL_EVENTS.map((s) => s.def)]) {
  const f = getFighter(d.skin.fighter);
  if (f.id === d.skin.fighter && !f.skins.some((s) => s.id === d.skin.id)) {
    f.skins.push({ id: d.skin.id, name: d.skin.name, nameFa: d.skin.nameFa, main: d.skin.main, second: d.skin.second, glow: d.skin.glow });
  }
}
export function isEventSkin(skinId: string) { return EVENT_DEFS.some((d) => d.skin.id === skinId) || SPECIAL_EVENTS.some((s) => s.def.skin.id === skinId); }

// ---- calendar ---------------------------------------------------------------------------------------
const DAY = 86400_000;
/** Saturday 3 Jan 2026 00:00 Tehran (UTC+3:30) */
export const EVENT_EPOCH = Date.UTC(2026, 0, 2, 20, 30);
/** event slots inside a week: [start day, length in days] */
export const EVENT_SLOTS: [number, number][] = [[0, 3], [3, 2], [5, 2]];

export interface EventInstance { def: EventDef; start: number; end: number; key: string; special?: boolean }

function rotationAt(now: number): EventInstance {
  const week = Math.floor((now - EVENT_EPOCH) / (7 * DAY));
  const inWeek = now - (EVENT_EPOCH + week * 7 * DAY);
  let slot = EVENT_SLOTS.length - 1;
  for (let i = 0; i < EVENT_SLOTS.length; i++) if (inWeek < (EVENT_SLOTS[i][0] + EVENT_SLOTS[i][1]) * DAY) { slot = i; break; }
  const n = EVENT_DEFS.length;
  const def = EVENT_DEFS[(((week * EVENT_SLOTS.length + slot) % n) + n) % n];
  const start = EVENT_EPOCH + week * 7 * DAY + EVENT_SLOTS[slot][0] * DAY;
  return { def, start, end: start + EVENT_SLOTS[slot][1] * DAY, key: `${def.id}@${start}` };
}

/** The event running at `now`. */
export function eventAt(now: number): EventInstance {
  const sp = SPECIAL_EVENTS.find((s) => now >= s.start && now < s.end);
  if (sp) return { def: sp.def, start: sp.start, end: sp.end, key: `${sp.def.id}@${sp.start}`, special: true };
  return rotationAt(now);
}

/** Current + upcoming events (for the calendar strip). */
export function eventCalendar(now: number, count = 6): EventInstance[] {
  const out: EventInstance[] = [];
  let t = now;
  for (let i = 0; i < count; i++) {
    const e = eventAt(t);
    // a special can start in the middle of a rotation slot: cut that slot short
    const nextSpecial = SPECIAL_EVENTS.find((s) => s.start > t && s.start < e.end);
    const end = nextSpecial && !e.special ? nextSpecial.start : e.end;
    out.push({ ...e, end });
    t = end;
  }
  return out;
}

// ---- reward track ---------------------------------------------------------------------------------------
export interface TrackStep { wins: number; reward: Reward; skin?: boolean; token?: boolean }
export const EVENT_TRACK: TrackStep[] = [
  { wins: 1, reward: { coins: 300 } },
  { wins: 3, reward: { runes: 40, anyCards: 4 } },
  { wins: 5, reward: { gems: 25, coins: 500 } },
  { wins: 8, reward: { crates: 1, runes: 60 }, token: true },
  { wins: 12, reward: { gems: 40 }, skin: true },
];
/** vs-CPU event wins that count per day (online event-queue wins are unlimited) */
export const EVENT_CPU_DAILY = 15;

export function eventProgress(p: Profile, now: number): EventProgress {
  migrateProgress(p);
  const e = eventAt(now);
  if (!p.ev || p.ev.key !== e.key) p.ev = { key: e.key, wins: 0, played: 0, claimed: [] };
  return p.ev;
}

/** Records an event match. vs-CPU wins are capped per day. Returns whether the win counted. */
export function recordEventMatch(p: Profile, won: boolean, now: number, vsCpu: boolean, day = new Date(now + 3.5 * 3600_000).toISOString().slice(0, 10)): boolean {
  const ev = eventProgress(p, now);
  ev.played++;
  if (!won) return false;
  if (vsCpu) {
    if (ev.cpuDay !== day) { ev.cpuDay = day; ev.cpu = 0; }
    if ((ev.cpu ?? 0) >= EVENT_CPU_DAILY) return false;
    ev.cpu = (ev.cpu ?? 0) + 1;
  }
  ev.wins++;
  return true;
}

export function eventStepReward(e: EventDef, step: TrackStep): Reward {
  return { ...step.reward, ...(step.skin ? { skins: [e.skin.id] } : {}) };
}

export interface EventClaim { granted: Granted; token?: string; skin?: string }
export function claimEventReward(p: Profile, idx: number, now: number, rand: () => number = Math.random): EventClaim | null {
  const ev = eventProgress(p, now);
  const step = EVENT_TRACK[idx];
  if (!step || ev.claimed.includes(idx) || ev.wins < step.wins) return null;
  ev.claimed.push(idx);
  const e = eventAt(now).def;
  const reward = eventStepReward(e, step);
  // the exclusive skin needs the fighter: grant it too if missing (it's the headline prize)
  if (step.skin && !p.fighters.includes(e.skin.fighter)) reward.fighters = [e.skin.fighter];
  const granted = grantReward(p, reward, rand);
  let token: string | undefined;
  if (step.token) {
    p.evTokens ??= [];
    token = e.id;
    if (!p.evTokens.includes(token)) p.evTokens.push(token);
  }
  return { granted, token, skin: step.skin ? e.skin.id : undefined };
}
export function claimableEvent(p: Profile, now: number) {
  const ev = eventProgress(p, now);
  return EVENT_TRACK.filter((s, i) => ev.wins >= s.wins && !ev.claimed.includes(i)).length;
}

// ---- match set-up ------------------------------------------------------------------------------------------
export function eventRules(def: EventDef, seed: number): MatchRules { return presetRules(def.mode, seed); }
export function eventStage(def: EventDef, seed: number) {
  const ok = def.stages.filter((s) => STAGES.some((x) => x.id === s));
  return ok[Math.floor(hash32(seed, 11) * ok.length)] ?? STAGES[0].id;
}
/** Config for an event match (players filled by the caller). */
export function eventConfig(def: EventDef, seed: number, players: MatchConfig['players']): MatchConfig {
  return { stageId: eventStage(def, seed), stocks: def.mode === 'sudden' ? 3 : 2, timeLimit: def.mode === 'sudden' ? 120 : 180, teams: false, players, rules: eventRules(def, seed) };
}
export function eventDefById(id: string): EventDef | null {
  return EVENT_DEFS.find((d) => d.id === id) ?? SPECIAL_EVENTS.find((s) => s.def.id === id)?.def ?? null;
}
