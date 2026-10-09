import { FIGHTERS, getFighter } from './fighters.ts';
import { STAGES } from './stages.ts';
import { SPELLS } from './spells.ts';
import { createGame, step } from './sim.ts';
import { botInput, createBrain } from './ai.ts';
import { fighterMods, migrateProgress, sendMail, type Reward } from './progress.ts';
import { hash32 } from './rules.ts';
import type { Profile } from './economy.ts';
import type { FighterMods, MatchConfig } from './types.ts';

// =====================================================================================
//  Weekend tournament: 8-player single elimination
//  • Sign-up window: Friday 00:00 → Saturday 20:00 (Tehran). Entry fee in coins or gems
//    (two tiers with their own brackets and prizes). Every 8 sign-ups of a tier fill a bracket.
//  • Saturday 20:00 the brackets lock, empty seats are filled with computer fighters and
//    round 1 (quarter-finals) opens. Each round has a 30-minute window.
//  • A round match is a real online match when both players show up ("ready") inside the
//    window. If only one shows up the other forfeits; if neither does (or both are bots)
//    the match is simulated server-side with the real engine, bots playing both fighters.
//  • Prizes: winner, finalist and semi-finalists by mail + a trophy in the cabinet.
//  • Offline: the same bracket against 7 computer fighters with escalating difficulty.
// =====================================================================================

declare module './economy.ts' {
  interface Profile {
    /** tournament trophies (place 1 = champion, 2 = finalist, 3 = semi-finalist) */
    tTrophies?: { week: number; tier: TourneyTier; place: number; t: number }[];
  }
}
declare module './social.ts' {
  interface SocialDb {
    tourney?: TourneyDb;
  }
}

export type TourneyTier = 'coins' | 'gems';
export interface TierDef { id: TourneyTier; name: string; nameFa: string; fee: { coins?: number; gems?: number }; prizes: [Reward, Reward, Reward]; level: number; color: string }
export const TOURNEY_TIERS: Record<TourneyTier, TierDef> = {
  coins: {
    id: 'coins', name: 'Silver Cup', nameFa: 'جام نقره', fee: { coins: 1500 }, level: 5, color: '#cfd8e8',
    prizes: [{ coins: 9000, runes: 120, gems: 20 }, { coins: 4000, runes: 50 }, { coins: 1800, runes: 20 }],
  },
  gems: {
    id: 'gems', name: 'Golden Cup', nameFa: 'جام طلا', fee: { gems: 60 }, level: 7, color: '#ffd23f',
    prizes: [{ gems: 320, runes: 260, crates: 2 }, { gems: 130, runes: 110 }, { gems: 55, runes: 45 }],
  },
};
export const BRACKET_SIZE = 8;
export const ROUND_NAMES = [{ en: 'Quarter-finals', fa: 'یک‌چهارم نهایی' }, { en: 'Semi-finals', fa: 'نیمه‌نهایی' }, { en: 'Final', fa: 'فینال' }];

// ---- schedule ----------------------------------------------------------------------------------------
const H = 3600_000, DAY = 24 * H;
/** Friday 2 Jan 2026 00:00 Tehran (UTC+3:30) */
export const TOURNEY_EPOCH = Date.UTC(2026, 0, 1, 20, 30);
export const SIGNUP_HOURS = 44;           // Fri 00:00 → Sat 20:00
export const ROUND_MS = 30 * 60_000;
export interface TourneyTiming { signupMs: number; roundMs: number }
export const DEFAULT_TIMING: TourneyTiming = { signupMs: SIGNUP_HOURS * H, roundMs: ROUND_MS };

export function tourneyWeek(now: number) { return Math.floor((now - TOURNEY_EPOCH) / (7 * DAY)) + 1; }
export function tourneySchedule(week: number, timing: TourneyTiming = DEFAULT_TIMING) {
  const signupStart = TOURNEY_EPOCH + (week - 1) * 7 * DAY;
  const start = signupStart + timing.signupMs;
  return { signupStart, start, rounds: [0, 1, 2].map((r) => ({ start: start + r * timing.roundMs, end: start + (r + 1) * timing.roundMs })), end: start + 3 * timing.roundMs };
}
export type TourneyPhase = 'signup' | 'live' | 'closed';
/** signup = sign-ups open; live = rounds running; closed = between tournaments */
export function tourneyPhase(now: number, timing: TourneyTiming = DEFAULT_TIMING): { phase: TourneyPhase; week: number; next: number } {
  const week = tourneyWeek(now);
  const s = tourneySchedule(week, timing);
  if (now < s.start) return { phase: 'signup', week, next: s.start };
  if (now < s.end + 2 * timing.roundMs) return { phase: 'live', week, next: s.end };
  return { phase: 'closed', week, next: tourneySchedule(week + 1, timing).signupStart };
}

// ---- bracket data -----------------------------------------------------------------------------------------
export interface TSeat { id: string; name: string; fighter: string; skin: number; bot: boolean; level: number; mods?: FighterMods; mmr: number }
export interface TMatch {
  a: number; b: number;              // seat indexes (-1 = waiting for the previous round)
  winner: number;                    // seat index, -1 = undecided
  status: 'pending' | 'live' | 'done';
  how?: 'played' | 'forfeit' | 'sim';
  ready: string[];                   // user ids that pressed "play" in this round window
  matchId?: string;
  score?: [number, number];          // stocks left (a, b)
}
export interface Bracket {
  id: string; week: number; tier: TourneyTier;
  seats: TSeat[];
  rounds: TMatch[][];                // [4 QF, 2 SF, 1 F]
  round: number;                     // current round index (3 = finished)
  status: 'signup' | 'live' | 'done';
  created: number;
  paid?: boolean;
  offline?: boolean;
  /** end of the current round's window (set when a round opens) */
  windowEnd?: number;
}
export interface TourneyDb { brackets: Record<string, Bracket>; byUser: Record<string, string>; seq: number; settledWeek?: number }

export function tourneyDb(db: { tourney?: TourneyDb }): TourneyDb { return (db.tourney ??= { brackets: {}, byUser: {}, seq: 1 }); }

const BOT_NAMES = ['Arash', 'Sara', 'Kian', 'Nika', 'Dariush', 'Mina', 'Reza', 'Shirin', 'Omid', 'Yasmin', 'Babak', 'Leila', 'Navid', 'Roya', 'Kaveh', 'Ava', 'Raptor', 'Sable', 'Echo', 'Rook', 'Orbit', 'Saffron'];

export function seatOf(p: Profile): TSeat {
  const f = getFighter(p.selFighter).id;
  return { id: p.id, name: p.name, fighter: f, skin: p.selSkin?.[f] ?? 0, bot: false, level: 5, mods: fighterMods(p, f), mmr: p.rank.mmr };
}
export function botSeat(seed: number, i: number, level: number): TSeat {
  const f = FIGHTERS[Math.floor(hash32(seed, i, 3) * FIGHTERS.length)].id;
  const lv = Math.max(1, Math.min(9, level + Math.floor(hash32(seed, i, 4) * 3) - 1));
  const spell = SPELLS[Math.floor(hash32(seed, i, 5) * SPELLS.length)].id;
  return { id: `bot:${seed}:${i}`, name: BOT_NAMES[Math.floor(hash32(seed, i, 6) * BOT_NAMES.length)], fighter: f, skin: Math.floor(hash32(seed, i, 7) * 3), bot: true, level: lv, mods: { atk: 1 + lv * 0.01, def: 1, hp: 1, spell, spellLv: Math.max(1, Math.round(lv / 2)) }, mmr: 700 + lv * 120 };
}

export function newBracket(id: string, week: number, tier: TourneyTier, now: number): Bracket {
  return { id, week, tier, seats: [], rounds: [], round: 0, status: 'signup', created: now };
}

/** Locks a bracket: fills empty seats with bots, shuffles, opens round 1. */
export function lockBracket(b: Bracket, seed: number) {
  const lv = TOURNEY_TIERS[b.tier].level;
  for (let i = b.seats.length; i < BRACKET_SIZE; i++) {
    const s = botSeat(seed, i, lv);
    // no two computer fighters with the same name in one bracket
    for (let k = 1; b.seats.some((x) => x.name === s.name) && k < BOT_NAMES.length; k++) s.name = BOT_NAMES[(BOT_NAMES.indexOf(s.name) + 1) % BOT_NAMES.length];
    b.seats.push(s);
  }
  // deterministic shuffle so friends who signed up together don't always meet first
  const order = b.seats.map((_, i) => i).sort((x, y) => hash32(seed, x, 9) - hash32(seed, y, 9));
  b.seats = order.map((i) => b.seats[i]);
  b.rounds = [
    [0, 1, 2, 3].map((k) => ({ a: k * 2, b: k * 2 + 1, winner: -1, status: 'pending' as const, ready: [] })),
    [0, 1].map(() => ({ a: -1, b: -1, winner: -1, status: 'pending' as const, ready: [] })),
    [{ a: -1, b: -1, winner: -1, status: 'pending' as const, ready: [] }],
  ];
  b.round = 0;
  b.status = 'live';
}
export const seedOf = (id: string) => { let h = 7; for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0; return h; };

/** Records a result and moves the winner into the next round. */
export function setResult(b: Bracket, round: number, idx: number, winner: number, how: TMatch['how'], score?: [number, number]) {
  const m = b.rounds[round]?.[idx];
  if (!m || m.status === 'done' || (winner !== m.a && winner !== m.b)) return false;
  m.winner = winner; m.status = 'done'; m.how = how; if (score) m.score = score;
  const next = b.rounds[round + 1];
  if (next) { const nm = next[Math.floor(idx / 2)]; if (idx % 2 === 0) nm.a = winner; else nm.b = winner; }
  return true;
}
export function roundDone(b: Bracket, round = b.round) { return !!b.rounds[round]?.every((m) => m.status === 'done'); }

/** Opens the next round once the current one is complete. Returns true when the bracket finished. */
export function advanceRound(b: Bracket): boolean {
  if (b.status !== 'live' || !roundDone(b)) return false;
  b.round++;
  if (b.round >= b.rounds.length) { b.status = 'done'; return true; }
  return false;
}

/** Final placements: seat index → 1 (champion), 2 (finalist), 3 (semi-finalists), 0 (quarter-final losers). */
export function placementsOf(b: Bracket): number[] {
  const out = b.seats.map(() => 0);
  const f = b.rounds[2]?.[0];
  if (f?.status === 'done') { out[f.winner] = 1; out[f.winner === f.a ? f.b : f.a] = 2; }
  for (const m of b.rounds[1] ?? []) if (m.status === 'done') out[m.winner === m.a ? m.b : m.a] = 3;
  return out;
}

/** Pays prizes once (mail + trophy). profileOf returns null for bots / unknown users. */
export function payPrizes(b: Bracket, profileOf: (id: string) => Profile | null, now: number): { id: string; place: number }[] {
  if (b.status !== 'done' || b.paid) return [];
  b.paid = true;
  const tier = TOURNEY_TIERS[b.tier];
  const paid: { id: string; place: number }[] = [];
  placementsOf(b).forEach((place, i) => {
    if (!place) return;
    const s = b.seats[i];
    if (s.bot) return;
    const p = profileOf(s.id);
    if (!p) return;
    migrateProgress(p);
    (p.tTrophies ??= []).unshift({ week: b.week, tier: b.tier, place, t: now });
    if (p.tTrophies.length > 100) p.tTrophies.length = 100;
    const names = [{ en: 'Champion', fa: 'قهرمان' }, { en: 'Finalist', fa: 'فینالیست' }, { en: 'Semi-finalist', fa: 'نیمه‌نهایی' }][place - 1];
    sendMail(p, {
      title: `${names.en} — ${tier.name} (week ${b.week})`, titleFa: `${names.fa} ${tier.nameFa} — هفته ${b.week}`,
      body: 'A tournament trophy was added to your cabinet.', bodyFa: 'جام مسابقات به قفسه افتخاراتت اضافه شد.',
      reward: tier.prizes[place - 1],
    }, now);
    paid.push({ id: s.id, place });
  });
  return paid;
}

// ---- sign-up -------------------------------------------------------------------------------------------------
export class TourneyError extends Error { constructor(public code: string) { super(code); } }
const fail = (c: string): never => { throw new TourneyError(c); };

/** Pays the fee and seats the player in an open bracket of the tier (server and offline). */
export function tourneySignUp(db: TourneyDb, p: Profile, tier: TourneyTier, now: number, timing: TourneyTiming = DEFAULT_TIMING): Bracket {
  const t = TOURNEY_TIERS[tier] ?? fail('bad-input');
  const ph = tourneyPhase(now, timing);
  if (ph.phase !== 'signup') fail('tourney-closed');
  const cur = db.byUser[p.id] ? db.brackets[db.byUser[p.id]] : null;
  if (cur && cur.week === ph.week) fail('already');
  if (p.coins < (t.fee.coins ?? 0) || p.gems < (t.fee.gems ?? 0)) fail('funds');
  p.coins -= t.fee.coins ?? 0; p.gems -= t.fee.gems ?? 0;
  let b = Object.values(db.brackets).find((x) => x.week === ph.week && x.tier === tier && x.status === 'signup' && x.seats.length < BRACKET_SIZE && !x.offline);
  if (!b) { b = newBracket(`t${ph.week}_${tier}_${db.seq++}`, ph.week, tier, now); db.brackets[b.id] = b; }
  b.seats.push(seatOf(p));
  db.byUser[p.id] = b.id;
  return b;
}
/** Leaving before the lock refunds half the fee. */
export function tourneyLeave(db: TourneyDb, p: Profile): boolean {
  const b = db.byUser[p.id] ? db.brackets[db.byUser[p.id]] : null;
  if (!b || b.status !== 'signup') return false;
  b.seats = b.seats.filter((s) => s.id !== p.id);
  delete db.byUser[p.id];
  const t = TOURNEY_TIERS[b.tier];
  p.coins += Math.floor((t.fee.coins ?? 0) / 2); p.gems += Math.floor((t.fee.gems ?? 0) / 2);
  if (!b.seats.length) delete db.brackets[b.id];
  return true;
}
export function myBracket(db: TourneyDb, userId: string): Bracket | null {
  const id = db.byUser[userId];
  return (id && db.brackets[id]) || null;
}

// ---- server-side simulation -------------------------------------------------------------------------------------
/** Plays a full bot-vs-bot match with the real engine (both fighters AI-driven). Returns the winning side. */
export function simulateMatch(a: TSeat, b: TSeat, seed: number, stage?: string): { winner: 0 | 1; score: [number, number]; frames: number } {
  const st = stage ?? STAGES[Math.floor(hash32(seed, 21) * STAGES.length)].id;
  const cfg: MatchConfig = {
    stageId: st, stocks: 2, timeLimit: 150, teams: false,
    players: [a, b].map((s, i) => ({ charId: s.fighter, skin: s.skin, team: i, name: s.name, bot: true, mods: s.mods })),
  };
  const g = createGame(cfg);
  const brains = [createBrain(a.level, (seed * 31 + 1) >>> 0), createBrain(b.level, (seed * 31 + 2) >>> 0)];
  let f = 0;
  while (!g.over && f < (150 + 10) * 60) { step(g, brains.map((br, s) => botInput(g, s, br))); f++; }
  const sa = g.fighters[0], sb = g.fighters[1];
  let winner: 0 | 1;
  if (g.winnerTeam === 0) winner = 0; else if (g.winnerTeam === 1) winner = 1;
  else winner = sa.stocks !== sb.stocks ? (sa.stocks > sb.stocks ? 0 : 1) : sa.damage <= sb.damage ? 0 : 1;
  return { winner, score: [sa.stocks, sb.stocks], frames: f };
}

/**
 * Resolves what can be resolved in the current round at `now`:
 *  - bot vs bot: simulated right away
 *  - after the round window: absent players forfeit; two absent humans are simulated
 * `live(m)` says whether a real match for that pairing is still being played.
 */
export function resolveRound(b: Bracket, now: number, windowEnd: number, seed: number, live: (m: TMatch) => boolean = () => false) {
  if (b.status !== 'live') return;
  const round = b.round;
  b.rounds[round].forEach((m, i) => {
    if (m.status === 'done' || m.a < 0 || m.b < 0 || live(m)) return;
    const A = b.seats[m.a], B = b.seats[m.b];
    if (A.bot && B.bot) {
      const r = simulateMatch(A, B, (seed + round * 101 + i * 7) >>> 0);
      setResult(b, round, i, r.winner === 0 ? m.a : m.b, 'sim', r.score);
      return;
    }
    if (now < windowEnd) return;
    const ra = !A.bot && m.ready.includes(A.id), rb = !B.bot && m.ready.includes(B.id);
    if (!A.bot && !B.bot && !ra && !rb) {
      const r = simulateMatch({ ...A, level: 5 }, { ...B, level: 5 }, (seed + round * 101 + i * 7) >>> 0);
      setResult(b, round, i, r.winner === 0 ? m.a : m.b, 'sim', r.score);
    } else if (ra && !rb) setResult(b, round, i, m.a, 'forfeit');
    else if (rb && !ra) setResult(b, round, i, m.b, 'forfeit');
    else if (A.bot && !rb) setResult(b, round, i, m.a, 'forfeit');   // human never showed up vs a bot
    else if (B.bot && !ra) setResult(b, round, i, m.b, 'forfeit');
    // both ready but no live match: let the next ready/match attempt decide (handled by the server)
  });
}

/** Which match of the current round the user plays (or null). */
export function myMatch(b: Bracket, userId: string): { round: number; idx: number; m: TMatch; me: number; foe: number } | null {
  if (b.status !== 'live') return null;
  const ms = b.rounds[b.round] ?? [];
  for (let i = 0; i < ms.length; i++) {
    const m = ms[i];
    if (m.status === 'done' || m.a < 0 || m.b < 0) continue;
    if (b.seats[m.a].id === userId) return { round: b.round, idx: i, m, me: m.a, foe: m.b };
    if (b.seats[m.b].id === userId) return { round: b.round, idx: i, m, me: m.b, foe: m.a };
  }
  return null;
}

// ---- offline tournament ------------------------------------------------------------------------------------------
/** CPU level of the player's opponent per round (escalating). */
export function offlineFoeLevel(tier: TourneyTier, round: number) { return Math.min(9, (tier === 'gems' ? 5 : 4) + round * 2); }

/** Offline: an instant bracket vs 7 computer fighters (the fee is paid like online). */
export function offlineSignUp(db: TourneyDb, p: Profile, tier: TourneyTier, now: number, seed: number): Bracket {
  const t = TOURNEY_TIERS[tier] ?? fail('bad-input');
  const cur = myBracket(db, p.id);
  if (cur && cur.status !== 'done') fail('already');
  if (p.coins < (t.fee.coins ?? 0) || p.gems < (t.fee.gems ?? 0)) fail('funds');
  p.coins -= t.fee.coins ?? 0; p.gems -= t.fee.gems ?? 0;
  const b = newBracket(`off${db.seq++}`, tourneyWeek(now), tier, now);
  b.offline = true;
  b.seats.push(seatOf(p));
  db.brackets = Object.fromEntries(Object.entries(db.brackets).filter(([, x]) => !x.offline || x.status !== 'done' || now - x.created < 7 * DAY));
  db.brackets[b.id] = b;
  db.byUser[p.id] = b.id;
  lockBracket(b, seed);
  // the player's opponents get tougher every round
  return b;
}

/** Offline: simulate the other matches of the round (after the player's own result is in). */
export function offlineResolve(b: Bracket, userId: string, seed: number) {
  if (b.status !== 'live') return;
  const round = b.round;
  b.rounds[round].forEach((m, i) => {
    if (m.status === 'done' || m.a < 0 || m.b < 0) return;
    const A = b.seats[m.a], B = b.seats[m.b];
    if (A.id === userId || B.id === userId) return;
    const r = simulateMatch(A, B, (seed + round * 101 + i * 7) >>> 0);
    setResult(b, round, i, r.winner === 0 ? m.a : m.b, 'sim', r.score);
  });
}
/** Offline: the player was knocked out → finish the remaining rounds by simulation. */
export function offlineFinish(b: Bracket, userId: string, seed: number) {
  let guard = 0;
  while (b.status === 'live' && guard++ < 5) {
    offlineResolve(b, userId, seed);
    // the player's own (lost) match is already done; any match still open involves nobody real
    b.rounds[b.round].forEach((m, i) => {
      if (m.status !== 'done' && m.a >= 0 && m.b >= 0) {
        const r = simulateMatch(b.seats[m.a], b.seats[m.b], (seed + b.round * 101 + i * 7) >>> 0);
        setResult(b, b.round, i, r.winner === 0 ? m.a : m.b, 'sim', r.score);
      }
    });
    advanceRound(b);
  }
}
