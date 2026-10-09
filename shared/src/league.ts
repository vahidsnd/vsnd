import { TIERS, tierFor } from './rank.ts';
import { migrateProgress, sendMail, type Reward } from './progress.ts';
import type { Profile } from './economy.ts';

// =====================================================================================
//  Weekly league
//  • A league week opens Saturday 15:00 Tehran time and closes the next Saturday 14:00.
//    The hour in between is the results break (league matches are closed).
//  • Players are placed in the bracket of the league they were in at their first league
//    match of the week (no tier hopping), and race for weekly league points.
//  • The top 3 of every league get runes (the headline prize), gems and a trophy for the
//    trophy cabinet. Then the standings reset and a new week starts.
// =====================================================================================

const HOUR = 3600_000;
export const WEEK_MS = 7 * 24 * HOUR;
export const BREAK_MS = HOUR;
/** Saturday 3 Jan 2026, 15:00 Tehran (UTC+3:30) = 11:30 UTC. */
export const WEEK_EPOCH = Date.UTC(2026, 0, 3, 11, 30);

export function weekId(now: number) { return Math.floor((now - WEEK_EPOCH) / WEEK_MS) + 1; }
export function weekWindow(id: number) {
  const start = WEEK_EPOCH + (id - 1) * WEEK_MS;
  return { start, end: start + WEEK_MS - BREAK_MS, next: start + WEEK_MS };
}
/** True during the one-hour results break before a new week. */
export function leagueBreak(now: number) { return now >= weekWindow(weekId(now)).end; }

export interface WeekStats { id: number; pts: number; w: number; l: number; tier: number; t: number }
export interface Trophy { week: number; tier: number; place: number; t: number }

/** Points for a league match: win 3, flawless +1, loss −1 (never below zero). */
export function weekPoints(won: boolean, falls: number) { return won ? 3 + (falls === 0 ? 1 : 0) : -1; }

export function weekStats(p: Profile, now: number): WeekStats {
  migrateProgress(p);
  const id = weekId(now);
  if (!p.lweek || p.lweek.id !== id) p.lweek = { id, pts: 0, w: 0, l: 0, tier: tierFor(p.rank.mmr).index, t: 0 };
  return p.lweek;
}
/** Records a league match for the weekly race (call after the mmr update). */
export function addWeekResult(p: Profile, won: boolean, falls: number, now: number) {
  if (leagueBreak(now)) return null;
  const w = weekStats(p, now);
  if (w.w + w.l === 0) w.tier = tierFor(p.rank.mmr).index; // bracket fixed at the first match of the week
  w.pts = Math.max(0, w.pts + weekPoints(won, falls));
  if (won) w.w++; else w.l++;
  w.t = now;
  p.stats.leagueWins = (p.stats.leagueWins ?? 0) + (won ? 1 : 0);
  return w;
}

/** Prize for 1st/2nd/3rd place in a league bracket. Runes are the scarce headline prize. */
export const TIER_MULT = [1, 1.25, 1.6, 2.2, 3];
export function weekPrize(tier: number, place: number): Reward {
  const base = [{ runes: 300, gems: 100, coins: 3000 }, { runes: 200, gems: 60, coins: 2000 }, { runes: 120, gems: 30, coins: 1200 }][place - 1];
  if (!base) return {};
  const m = TIER_MULT[tier] ?? 1;
  return { runes: Math.round(base.runes * m), gems: Math.round(base.gems * m), coins: Math.round(base.coins * m) };
}
export const PLACE_NAMES = [{ fa: 'قهرمان', en: 'Champion' }, { fa: 'نایب‌قهرمان', en: 'Runner-up' }, { fa: 'سوم', en: 'Third place' }];

export interface WeekEntry { id: string; name: string; pts: number; w: number; l: number; t: number; tier: number; bot?: boolean }
export function rankWeek(entries: WeekEntry[]) {
  return [...entries].sort((a, b) => b.pts - a.pts || b.w - a.w || a.l - b.l || a.t - b.t);
}

/** Pays a podium finish: mail with the prize + a trophy in the cabinet. */
export function awardWeek(p: Profile, week: number, tier: number, place: number, now: number) {
  migrateProgress(p);
  if (p.trophies.some((t) => t.week === week)) return false;
  p.trophies.unshift({ week, tier, place, t: now });
  if (p.trophies.length > 200) p.trophies.length = 200;
  const tt = TIERS[tier];
  const pn = PLACE_NAMES[place - 1];
  sendMail(p, {
    title: `${pn.en} — ${tt.name} league, week ${week}`, titleFa: `${pn.fa} لیگ ${tt.nameFa} — هفته ${week}`,
    body: 'A trophy was added to your cabinet.', bodyFa: 'یک جام به قفسه افتخاراتت اضافه شد.',
    reward: weekPrize(tier, place),
  }, now);
  return true;
}

/** Settles a finished week for every bracket. Returns the podiums (for logs / announcements). */
export function settleWeek(week: number, players: Profile[], now: number) {
  const podiums: { tier: number; ids: string[] }[] = [];
  TIERS.forEach((_, tier) => {
    const entries: WeekEntry[] = players
      .filter((p) => p.lweek?.id === week && p.lweek.tier === tier && p.lweek.w + p.lweek.l > 0 && p.lweek.pts > 0)
      .map((p) => ({ id: p.id, name: p.name, pts: p.lweek!.pts, w: p.lweek!.w, l: p.lweek!.l, t: p.lweek!.t, tier }));
    const top = rankWeek(entries).slice(0, 3);
    top.forEach((e, i) => { const p = players.find((x) => x.id === e.id)!; awardWeek(p, week, tier, i + 1, now); });
    podiums.push({ tier, ids: top.map((e) => e.id) });
  });
  return podiums;
}

/**
 * Computer rivals for the offline demo: a deterministic bracket whose points grow through
 * the week, so the tester sees a live race and a real top-3 decision at the end.
 */
export function demoRivals(week: number, tier: number, now: number, names: string[]): WeekEntry[] {
  const { start, end } = weekWindow(week);
  const progress = Math.max(0, Math.min(1, (now - start) / (end - start)));
  let s = (week * 7919 + tier * 104729) >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const out: WeekEntry[] = [];
  for (let i = 0; i < 19; i++) {
    const pace = 6 + rnd() * 70 * (1 + tier * 0.15);   // final points this rival reaches
    const pts = Math.round(pace * Math.pow(progress, 0.8 + rnd() * 0.4));
    const games = Math.round(pts / 2.4 + rnd() * 4);
    const w = Math.min(games, Math.round(pts / 3.2));
    out.push({ id: `rv${week}_${tier}_${i}`, name: names[(i * 7 + tier * 3 + week) % names.length], pts, w, l: Math.max(0, games - w), t: start + i, tier, bot: true });
  }
  return out;
}

export function weekInfo(now: number) {
  const id = weekId(now);
  const w = weekWindow(id);
  return { id, ...w, inBreak: now >= w.end, left: Math.max(0, w.end - now), toNext: Math.max(0, w.next - now) };
}
