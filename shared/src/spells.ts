import type { ProjectileDef } from './types.ts';

// =====================================================================================
//  Spells: one extra "magic" attack per fighter, cast with the magic button when the
//  meter is full. Unlocked and levelled with Runes; equipped per fighter.
// =====================================================================================

export type SpellKind = 'nova' | 'frost' | 'thunder' | 'heal' | 'aegis' | 'meteor' | 'gale' | 'shade';

export interface SpellDef {
  id: SpellKind;
  name: string; nameFa: string;
  desc: string; descFa: string;
  color: string;
  unlock: number;          // runes to learn
  /** runes for level n -> n+1 (index = current level - 1) */
  upgrade: number[];
}

export const SPELL_MAX_LEVEL = 5;
const UP = [60, 120, 220, 360];

export const SPELLS: SpellDef[] = [
  { id: 'nova', name: 'Fire Nova', nameFa: 'انفجار آتش', desc: 'Burst of flame around you', descFa: 'انفجار آتش دور مبارز', color: '#ff7a3d', unlock: 0, upgrade: UP },
  { id: 'frost', name: 'Frost Lance', nameFa: 'نیزه یخ', desc: 'Piercing ice spear forward', descFa: 'نیزه یخی که از همه رد می‌شود', color: '#7fd8ff', unlock: 80, upgrade: UP },
  { id: 'heal', name: 'Mend', nameFa: 'التیام', desc: 'Heals part of your damage', descFa: 'بخشی از آسیب را پاک می‌کند', color: '#6dffb0', unlock: 120, upgrade: UP },
  { id: 'thunder', name: 'Thunder Strike', nameFa: 'صاعقه', desc: 'Lightning hits the nearest foe', descFa: 'صاعقه روی نزدیک‌ترین حریف', color: '#ffe45c', unlock: 160, upgrade: UP },
  { id: 'aegis', name: 'Aegis', nameFa: 'سپر مقدس', desc: 'Brief invulnerability', descFa: 'چند لحظه آسیب‌ناپذیری', color: '#f6f1e0', unlock: 200, upgrade: UP },
  { id: 'gale', name: 'Gale Wall', nameFa: 'دیوار باد', desc: 'Huge gust pushes foes away', descFa: 'باد عظیم که حریف را دور می‌کند', color: '#a5f0e0', unlock: 240, upgrade: UP },
  { id: 'meteor', name: 'Meteor', nameFa: 'شهاب', desc: 'A meteor crashes ahead of you', descFa: 'سقوط شهاب جلوی مبارز', color: '#ff4f5e', unlock: 300, upgrade: UP },
  { id: 'shade', name: 'Shadow Step', nameFa: 'گام سایه', desc: 'Teleport behind a foe and strike', descFa: 'پشت حریف ظاهر شو و بزن', color: '#b48cff', unlock: 360, upgrade: UP },
];

const BY_ID = new Map(SPELLS.map((s) => [s.id, s]));
export function getSpell(id: string | undefined): SpellDef | null {
  return (id && BY_ID.get(id as SpellKind)) || null;
}

/** Meter gain tuning (meter is 0..100). */
export const MANA = { perDealt: 1.0, perTaken: 0.6, perFrame: 0.02 };

/** Projectile used by damaging spells at a given level (1..5). */
export function spellProjectile(id: SpellKind, lv: number): ProjectileDef | null {
  const L = Math.max(1, Math.min(SPELL_MAX_LEVEL, lv)) - 1;
  switch (id) {
    case 'nova': return { kind: 'sp_nova', vx: 0, vy: 0, life: 14, r: 92, dmg: 12 + L * 2, ang: 55, bkb: 48, kbg: 72, pierce: true, ox: 0, oy: -36 };
    case 'frost': return { kind: 'sp_frost', vx: 14, vy: 0, life: 60, r: 18, dmg: 10 + L * 2, ang: 32, bkb: 40, kbg: 62, pierce: true, ox: 34, oy: -36 };
    case 'thunder': return { kind: 'sp_thunder', vx: 0, vy: 30, life: 24, r: 34, dmg: 12 + L * 2, ang: 84, bkb: 46, kbg: 70, pierce: true, ox: 0, oy: 0 };
    case 'meteor': return { kind: 'sp_meteor', vx: 4, vy: 14, gravity: 0.3, life: 80, r: 30, dmg: 14 + L * 2, ang: 70, bkb: 50, kbg: 74, explode: 84, ox: 120, oy: -460 };
    case 'gale': return { kind: 'sp_gale', vx: 8, vy: 0, life: 34, r: 70, dmg: 0, ang: 10, bkb: 95 + L * 10, kbg: 0, wind: true, pierce: true, ox: 30, oy: -40 };
    case 'shade': return { kind: 'sp_shade', vx: 0, vy: 0, life: 8, r: 44, dmg: 8 + L * 2, ang: 45, bkb: 42, kbg: 68, pierce: true, ox: 0, oy: -36 };
    default: return null;
  }
}
export const healAmount = (lv: number) => 20 + (Math.max(1, lv) - 1) * 5;
export const aegisFrames = (lv: number) => 90 + (Math.max(1, lv) - 1) * 15;
