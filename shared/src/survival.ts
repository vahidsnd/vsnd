import { getFighter } from './fighters.ts';
import { STAGES } from './stages.ts';
import { dayKey, type Profile } from './economy.ts';
import { fighterMods, grantReward, migrateProgress, type Granted, type Reward } from './progress.ts';
import type { MatchConfig } from './types.ts';

// =====================================================================================
//  Survival: endless waves of computer fighters on a chosen arena.
//  Waves grow in number of foes (1 → 3) and level (2 → 9) with a small stat boost. Between
//  waves the player heals a little; every 5th wave gives an extra life. Score = waves cleared.
//  Rewards: coins per wave cleared (daily cap on rewarded runs) + one-time milestone rewards.
//  Personal best on the profile; the server keeps a leaderboard (offline: local best).
// =====================================================================================

declare module './economy.ts' {
  interface Profile {
    surv?: SurvivalProgress;
  }
}
export interface SurvivalProgress { best: number; bestStage: string; runs: number; ms: number[]; day: string; paid: number }

export const SURVIVAL = { slots: 3, stocks: 3, rewardedRunsPerDay: 8, coinsPerWave: 25 };
export const SURVIVAL_MILESTONES: { wave: number; reward: Reward }[] = [
  { wave: 3, reward: { coins: 300 } },
  { wave: 5, reward: { runes: 30 } },
  { wave: 8, reward: { gems: 15, anyCards: 5 } },
  { wave: 12, reward: { runes: 80, coins: 1000 } },
  { wave: 16, reward: { gems: 40 } },
  { wave: 20, reward: { crates: 1, runes: 120 } },
  { wave: 30, reward: { gems: 100 } },
];

export function survivalProgress(p: Profile, now: number): SurvivalProgress {
  migrateProgress(p);
  const s = (p.surv ??= { best: 0, bestStage: '', runs: 0, ms: [], day: '', paid: 0 });
  const d = dayKey(now);
  if (s.day !== d) { s.day = d; s.paid = 0; }
  return s;
}

export function survivalConfig(p: Profile, stageId: string, seed: number): MatchConfig {
  const fid = getFighter(p.selFighter).id;
  const stage = STAGES.some((s) => s.id === stageId) ? stageId : STAGES[0].id;
  const players: MatchConfig['players'] = [{ charId: fid, skin: p.selSkin?.[fid] ?? 0, team: 0, name: p.name, mods: fighterMods(p, fid) }];
  for (let i = 0; i < SURVIVAL.slots; i++) players.push({ charId: 'blaze', skin: 0, team: 1, name: `#${i + 1}`, bot: true });
  return { stageId: stage, stocks: SURVIVAL.stocks, timeLimit: 0, teams: true, players, rules: { survival: true, seed: seed >>> 0, items: true, itemKinds: ['heal', 'bomb', 'bubble', 'boots'], itemEvery: 600 } };
}

export interface SurvivalRun { waves: number; durationSec: number; kos: number }
export interface SurvivalOutcome { coins: number; best: boolean; milestones: Granted[]; reached: number[] }

/** Plausibility of a reported run (server): waves need time and KOs. */
export function survivalPlausible(r: SurvivalRun) {
  return r.waves >= 0 && r.waves <= 200 && r.durationSec >= r.waves * 6 && r.kos >= r.waves;
}

export function recordSurvival(p: Profile, stageId: string, r: SurvivalRun, now: number, rand: () => number = Math.random): SurvivalOutcome {
  const s = survivalProgress(p, now);
  s.runs++;
  const waves = Math.max(0, Math.floor(r.waves));
  const best = waves > s.best;
  if (best) { s.best = waves; s.bestStage = stageId; }
  let coins = 0;
  if (s.paid < SURVIVAL.rewardedRunsPerDay && waves > 0) { s.paid++; coins = waves * SURVIVAL.coinsPerWave; p.coins += coins; }
  const milestones: Granted[] = [], reached: number[] = [];
  SURVIVAL_MILESTONES.forEach((m, i) => {
    if (waves >= m.wave && !s.ms.includes(i)) { s.ms.push(i); reached.push(m.wave); milestones.push(grantReward(p, m.reward, rand)); }
  });
  return { coins, best, milestones, reached };
}

export interface SurvivalRow { pos: number; id: string; name: string; best: number; stage: string; fighter: string }
export function survivalLeaderboard(profiles: Profile[], limit = 50): SurvivalRow[] {
  return profiles.filter((p) => (p.surv?.best ?? 0) > 0)
    .sort((a, b) => b.surv!.best - a.surv!.best || a.name.localeCompare(b.name)).slice(0, limit)
    .map((p, i) => ({ pos: i + 1, id: p.id, name: p.name, best: p.surv!.best, stage: p.surv!.bestStage, fighter: p.selFighter }));
}
