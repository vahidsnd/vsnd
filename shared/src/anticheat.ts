import type { Profile, MatchSummary } from './economy.ts';
import { reportPlayer, type SocialCtx } from './social.ts';

// =====================================================================================
//  Anti-cheat
//  Online matches are already server-authoritative (the server runs the simulation; the
//  client only sends button presses). This module covers what the client reports itself:
//  offline (CPU / world map) results, raid fights and request floods.
//   • every suspicious report adds to a per-player suspicion score with evidence
//   • the score decays over time (honest outliers fade away)
//   • at 10+ the player's offline rewards are withheld and the Game Police get a report
// =====================================================================================

export interface CheatFlag { t: number; kind: string; detail: string; pts: number }
export interface CheatRecord { score: number; at: number; name: string; flags: CheatFlag[]; reported?: boolean }

export const CHEAT_THRESHOLD = 10;
const DECAY_PER_DAY = 3;

function record(ctx: SocialCtx, p: Profile): CheatRecord {
  const all = (ctx.db.cheats ??= {});
  const r = (all[p.id] ??= { score: 0, at: ctx.now, name: p.name, flags: [] });
  const days = (ctx.now - r.at) / 86400_000;
  r.score = Math.max(0, r.score - days * DECAY_PER_DAY);
  r.at = ctx.now; r.name = p.name;
  return r;
}

export function flagCheat(ctx: SocialCtx, p: Profile, kind: string, detail: string, pts: number) {
  const r = record(ctx, p);
  r.score += pts;
  r.flags.unshift({ t: ctx.now, kind, detail: detail.slice(0, 140), pts });
  if (r.flags.length > 30) r.flags.length = 30;
  if (r.score >= CHEAT_THRESHOLD && !r.reported) {
    r.reported = true;
    // a system report puts the player in the Game Police queue with the evidence
    try { reportPlayer(ctx, { id: 'anticheat', name: 'Anti-cheat' } as Profile, { target: p.id, targetName: p.name, reason: 'cheat' }); } catch { /* rate limited */ }
  }
  return r.score;
}
export function cheatScore(ctx: SocialCtx, p: Profile) { return record(ctx, p).score; }
export function rewardsWithheld(ctx: SocialCtx, p: Profile) { return cheatScore(ctx, p) >= CHEAT_THRESHOLD; }
export function clearCheats(ctx: SocialCtx, userId: string) { delete (ctx.db.cheats ??= {})[userId]; }

/**
 * Plausibility checks for a match result the client reports (offline / map).
 * Returns the points of suspicion found (0 = clean) and the reasons.
 */
export function checkSummary(s: MatchSummary, opts: { foes: number; stocks: number; recentPerHour: number }): { pts: number; reasons: string[] } {
  const reasons: string[] = [];
  let pts = 0;
  const add = (n: number, why: string) => { pts += n; reasons.push(why); };
  const minWin = 12 * opts.stocks * opts.foes;                       // seconds a real win needs at least
  if (s.won && s.durationSec < Math.min(minWin, 40)) add(4, `win in ${Math.round(s.durationSec)}s`);
  if (s.dmg > s.durationSec * 30 + 60) add(3, `${Math.round(s.dmg)}% dmg in ${Math.round(s.durationSec)}s`);
  if (s.kos > opts.foes * opts.stocks) add(4, `${s.kos} KOs > possible ${opts.foes * opts.stocks}`);
  if (s.won && s.dmg < 30 * opts.foes) add(2, `win with ${Math.round(s.dmg)}% dmg`);
  if (s.maxCombo > 25) add(2, `combo ${s.maxCombo}`);
  if (opts.recentPerHour > 40) add(2, `${opts.recentPerHour} matches/hour`);
  return { pts, reasons };
}

/** Simple token-bucket rate limiter for request floods (per user + action). */
export class RateLimiter {
  private buckets = new Map<string, { n: number; t: number }>();
  constructor(private perMinute: number) {}
  take(key: string, now = Date.now()) {
    const b = this.buckets.get(key) ?? { n: this.perMinute, t: now };
    b.n = Math.min(this.perMinute, b.n + ((now - b.t) / 60_000) * this.perMinute);
    b.t = now;
    if (b.n < 1) { this.buckets.set(key, b); return false; }
    b.n -= 1; this.buckets.set(key, b);
    if (this.buckets.size > 50_000) this.buckets.clear();
    return true;
  }
}

/** Valid input bits (see input.ts) — anything else from a client is dropped. */
export const INPUT_MASK = 2047;

/**
 * Light tamper seal for the offline profile (localStorage). Not cryptographic — it stops
 * casual editing of coins in the browser storage; the server never trusts it.
 */
export function profileSeal(json: string): string {
  let h1 = 0x811c9dc5, h2 = 0x1b873593;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 2246822519) >>> 0;
  }
  return (h1.toString(36) + '.' + h2.toString(36) + '.nb3');
}
