export interface Tier { id: string; name: string; nameFa: string; min: number; color: string }

export const TIERS: Tier[] = [
  { id: 'bronze', name: 'Bronze', nameFa: 'برنز', min: 0, color: '#c58a5a' },
  { id: 'silver', name: 'Silver', nameFa: 'نقره', min: 1000, color: '#c9d3e0' },
  { id: 'gold', name: 'Gold', nameFa: 'طلا', min: 1200, color: '#ffd23f' },
  { id: 'platinum', name: 'Platinum', nameFa: 'پلاتین', min: 1400, color: '#5ef2d0' },
  { id: 'diamond', name: 'Diamond', nameFa: 'الماس', min: 1600, color: '#62b6ff' },
  { id: 'master', name: 'Master', nameFa: 'استاد', min: 1800, color: '#c77dff' },
  { id: 'legend', name: 'Legend', nameFa: 'افسانه', min: 2000, color: '#ff4f8b' },
];

export function tierFor(mmr: number): { tier: Tier; division: number; progress: number } {
  let i = 0;
  while (i + 1 < TIERS.length && mmr >= TIERS[i + 1].min) i++;
  const tier = TIERS[i];
  if (tier.id === 'legend') return { tier, division: 0, progress: 1 };
  const next = TIERS[i + 1].min;
  const span = (next - tier.min) / 3;
  const into = mmr - tier.min;
  const division = 3 - Math.min(2, Math.floor(into / span)); // III, II, I
  return { tier, division, progress: (into % span) / span };
}

/** Elo with streak bonus; returns delta for the player. */
export function eloDelta(my: number, opp: number, won: boolean, streak = 0): number {
  const expected = 1 / (1 + 10 ** ((opp - my) / 400));
  const k = my < 1200 ? 40 : my < 1800 ? 32 : 24;
  let d = Math.round(k * ((won ? 1 : 0) - expected));
  if (won && streak >= 2) d += Math.min(10, streak * 2);
  if (!won && my < 1000) d = Math.round(d * 0.6); // softer losses in Bronze
  return d;
}

export const SEASON_REWARDS: Record<string, { coins: number; gems: number }> = {
  bronze: { coins: 500, gems: 0 },
  silver: { coins: 1000, gems: 20 },
  gold: { coins: 1500, gems: 50 },
  platinum: { coins: 2500, gems: 80 },
  diamond: { coins: 4000, gems: 120 },
  master: { coins: 6000, gems: 200 },
  legend: { coins: 10000, gems: 400 },
};
