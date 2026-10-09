// =====================================================================================
//  Leagues: Bronze → Silver → Gold → Crystal → Legendary.
//  Every league except Legendary has three divisions (III → II → I).
//  Reaching a division the first time pays a one-time promotion reward; at season end
//  every player gets the reward of the best league reached that season (via inbox).
// =====================================================================================

export interface Tier { id: LeagueId; name: string; nameFa: string; min: number; color: string; icon: string }
export type LeagueId = 'bronze' | 'silver' | 'gold' | 'crystal' | 'legendary';

export const TIERS: Tier[] = [
  { id: 'bronze', name: 'Bronze', nameFa: 'برنزی', min: 0, color: '#c58a5a', icon: 'shield' },
  { id: 'silver', name: 'Silver', nameFa: 'نقره‌ای', min: 1100, color: '#c9d3e0', icon: 'shield' },
  { id: 'gold', name: 'Gold', nameFa: 'طلایی', min: 1300, color: '#ffd23f', icon: 'trophy' },
  { id: 'crystal', name: 'Crystal', nameFa: 'کریستالی', min: 1550, color: '#62e6ff', icon: 'gem' },
  { id: 'legendary', name: 'Legendary', nameFa: 'افسانه‌ای', min: 1800, color: '#ff4f8b', icon: 'flame' },
];
export const LEAGUES = TIERS;

export function tierFor(mmr: number): { tier: Tier; index: number; division: number; progress: number } {
  let i = 0;
  while (i + 1 < TIERS.length && mmr >= TIERS[i + 1].min) i++;
  const tier = TIERS[i];
  if (tier.id === 'legendary') return { tier, index: i, division: 0, progress: Math.min(1, (mmr - tier.min) / 400) };
  const next = TIERS[i + 1].min;
  const span = (next - tier.min) / 3;
  const into = Math.max(0, mmr - tier.min);
  const division = 3 - Math.min(2, Math.floor(into / span)); // III, II, I
  return { tier, index: i, division, progress: (into % span) / span };
}

/** All league steps in order, e.g. bronze3, bronze2, bronze1, silver3 … legendary. */
export function leagueSteps(): { key: string; tier: Tier; division: number; min: number }[] {
  const out: { key: string; tier: Tier; division: number; min: number }[] = [];
  TIERS.forEach((t, i) => {
    if (t.id === 'legendary') { out.push({ key: 'legendary', tier: t, division: 0, min: t.min }); return; }
    const span = (TIERS[i + 1].min - t.min) / 3;
    for (let d = 3; d >= 1; d--) out.push({ key: `${t.id}${d}`, tier: t, division: d, min: Math.round(t.min + (3 - d) * span) });
  });
  return out;
}

export const romanDiv = (d: number) => ['', 'I', 'II', 'III'][d] ?? '';

/** Elo with streak bonus; returns delta for the player. */
export function eloDelta(my: number, opp: number, won: boolean, streak = 0): number {
  const expected = 1 / (1 + 10 ** ((opp - my) / 400));
  const k = my < 1300 ? 40 : my < 1800 ? 32 : 24;
  let d = Math.round(k * ((won ? 1 : 0) - expected));
  if (won && streak >= 2) d += Math.min(10, streak * 2);
  if (!won && my < 1100) d = Math.round(d * 0.6); // softer losses in Bronze
  return d;
}

export interface LeagueReward { coins: number; gems: number; runes: number; crates?: number }
/** One-time reward for first reaching a league step. */
export function promotionReward(key: string): LeagueReward {
  const t = key.replace(/\d$/, '') as LeagueId;
  const base: Record<LeagueId, LeagueReward> = {
    bronze: { coins: 200, gems: 0, runes: 10 },
    silver: { coins: 400, gems: 10, runes: 20 },
    gold: { coins: 700, gems: 20, runes: 35 },
    crystal: { coins: 1200, gems: 40, runes: 60 },
    legendary: { coins: 3000, gems: 120, runes: 150, crates: 2 },
  };
  return base[t];
}

export const SEASON_REWARDS: Record<LeagueId, LeagueReward> = {
  bronze: { coins: 500, gems: 0, runes: 20 },
  silver: { coins: 1000, gems: 20, runes: 40 },
  gold: { coins: 2000, gems: 50, runes: 80 },
  crystal: { coins: 4000, gems: 120, runes: 150, crates: 1 },
  legendary: { coins: 8000, gems: 300, runes: 300, crates: 3 },
};
