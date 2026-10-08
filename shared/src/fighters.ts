import type { FighterStats, Hitbox, MoveDef, MoveId, ProjectileDef } from './types.ts';

export interface FighterDef {
  id: string;
  name: string;
  nameFa: string;
  title: string;
  titleFa: string;
  archetype: 'allrounder' | 'heavy' | 'aerial' | 'zoner' | 'swordie' | 'trickster';
  stats: FighterStats;
  moves: Record<MoveId, MoveDef>;
  // art: base colours for procedural sticker art; one palette per skin
  look: { body: 'fox' | 'golem' | 'bird' | 'robot' | 'ninja' | 'imp' };
  skins: { id: string; name: string; nameFa: string; main: string; second: string; glow: string }[];
  price: { coins: number; gems: number }; // 0/0 = starter
}

const hb = (
  s: number, e: number, x: number, y: number, r: number,
  dmg: number, ang: number, bkb: number, kbg: number, extra: Partial<Hitbox> = {},
): Hitbox => ({ s, e, x, y, r, dmg, ang, bkb, kbg, ...extra });

interface Tune { speed: number; power: number; reach: number }

// Generic normals: every fighter starts from this kit and then overrides signature moves.
function baseKit(t: Tune): Record<Exclude<MoveId, 'nspecial' | 'sspecial' | 'uspecial' | 'dspecial'>, MoveDef> {
  const f = (n: number) => Math.max(1, Math.round(n * t.speed));
  const d = (n: number) => Math.round(n * t.power * 10) / 10;
  const r = (n: number) => Math.round(n * t.reach);
  return {
    jab: { total: f(18), cancel: f(9), hitboxes: [hb(f(3), f(5), r(24), -30, r(13), d(3), 75, 22, 40)] },
    ftilt: { total: f(28), hitboxes: [hb(f(6), f(9), r(36), -28, r(17), d(9), 38, 30, 92)] },
    utilt: { total: f(26), hitboxes: [hb(f(5), f(10), r(10), -64, r(22), d(7), 95, 40, 105)] },
    dtilt: { total: f(20), hitboxes: [hb(f(5), f(7), r(34), -8, r(15), d(6), 78, 45, 45)] },
    dash: {
      total: f(34), hitboxes: [hb(f(6), f(12), r(26), -26, r(19), d(10), 55, 52, 70)],
      vel: [{ s: 1, e: f(14), vx: 6 }],
    },
    fsmash: { total: f(50), charge: { frame: f(8), max: 60 }, hitboxes: [hb(f(14), f(17), r(42), -30, r(23), d(16), 38, 40, 104)] },
    usmash: { total: f(46), charge: { frame: f(6), max: 60 }, hitboxes: [hb(f(11), f(16), 0, -72, r(26), d(15), 90, 38, 100)] },
    dsmash: {
      total: f(46), charge: { frame: f(5), max: 60 },
      hitboxes: [hb(f(9), f(11), r(36), -10, r(19), d(13), 25, 36, 98), hb(f(9), f(11), -r(36), -10, r(19), d(13), 155, 36, 98)],
    },
    nair: { total: f(36), landLag: 8, hitboxes: [hb(f(4), f(8), 0, -30, r(28), d(8), 45, 28, 88), hb(f(9), f(20), 0, -30, r(26), d(5), 45, 18, 70)] },
    fair: { total: f(36), landLag: 12, hitboxes: [hb(f(8), f(11), r(32), -32, r(21), d(11), 45, 32, 98)] },
    bair: { total: f(34), landLag: 11, hitboxes: [hb(f(7), f(10), -r(34), -30, r(21), d(13), 145, 30, 100)] },
    uair: { total: f(30), landLag: 8, hitboxes: [hb(f(5), f(9), 0, -70, r(23), d(8), 85, 30, 92)] },
    dair: { total: f(40), landLag: 18, hitboxes: [hb(f(12), f(15), 0, 6, r(21), d(13), 270, 26, 82)] },
    grab: { total: f(30), hitboxes: [hb(f(6), f(8), r(28), -30, r(17), 0, 0, 0, 0, { grab: true })] },
    fthrow: { total: 20, hitboxes: [], throwHit: hb(10, 10, 30, -30, 10, d(8), 42, 62, 62) },
    bthrow: { total: 24, hitboxes: [], throwHit: hb(12, 12, -30, -30, 10, d(10), 140, 62, 72) },
    uthrow: { total: 22, hitboxes: [], throwHit: hb(10, 10, 0, -60, 10, d(7), 90, 72, 62) },
    dthrow: { total: 24, hitboxes: [], throwHit: hb(12, 12, 10, 0, 10, d(6), 80, 60, 38) },
    ledgeattack: { total: 34, invuln: [1, 12], hitboxes: [hb(14, 18, 30, -20, 22, 9, 40, 60, 40)] },
  };
}

const proj = (p: Partial<ProjectileDef> & Pick<ProjectileDef, 'kind'>): ProjectileDef => ({
  vx: 8, vy: 0, life: 70, r: 12, dmg: 5, ang: 40, bkb: 30, kbg: 30, ox: 30, oy: -34, ...p,
});

function make(def: Omit<FighterDef, 'moves'> & { tune: Tune; specials: Partial<Record<MoveId, MoveDef>> }): FighterDef {
  const { tune, specials, ...rest } = def;
  return { ...rest, moves: { ...baseKit(tune), ...specials } as Record<MoveId, MoveDef> };
}

export const FIGHTERS: FighterDef[] = [
  make({
    id: 'blaze', name: 'Blaze', nameFa: 'بلیز', title: 'Ember Fox', titleFa: 'روباه آتشین', archetype: 'allrounder',
    stats: { weight: 95, walk: 3.4, run: 7.6, airSpeed: 5.4, airAccel: 0.45, gravity: 0.62, fall: 11, fastFall: 16, jump: 15.5, shortHop: 9.5, airJump: 14.5, airJumps: 1, traction: 0.55, w: 44, h: 72 },
    look: { body: 'fox' },
    skins: [
      { id: 'blaze0', name: 'Classic', nameFa: 'کلاسیک', main: '#ff6a2b', second: '#ffe2b8', glow: '#ffd23f' },
      { id: 'blaze1', name: 'Frost', nameFa: 'یخی', main: '#4fc3ff', second: '#e8fbff', glow: '#9af0ff' },
      { id: 'blaze2', name: 'Shadow', nameFa: 'سایه', main: '#3a2d5c', second: '#b9a7ff', glow: '#ff3df5' },
      { id: 'blaze3', name: 'Gold', nameFa: 'طلایی', main: '#e8b923', second: '#fff7d1', glow: '#ffffff' },
    ],
    price: { coins: 0, gems: 0 },
    tune: { speed: 1, power: 1, reach: 1 },
    specials: {
      nspecial: { total: 36, hitboxes: [], proj: { frame: 14, max: 2, def: proj({ kind: 'fireball', vx: 9, life: 60, r: 13, dmg: 6, ang: 35, bkb: 25, kbg: 35 }) } },
      sspecial: {
        total: 44, vel: [{ s: 8, e: 22, vx: 13, vy: 0 }], noGravity: [8, 22],
        hitboxes: [hb(8, 22, 26, -32, 22, 10, 40, 45, 75)],
      },
      uspecial: {
        total: 46, helpless: true, airOnce: true, vel: [{ s: 6, e: 26, vy: -14, vx: 2 }], noGravity: [6, 26],
        hitboxes: [hb(6, 24, 6, -40, 24, 2, 80, 30, 10, { multi: 4 }), hb(25, 27, 6, -60, 28, 6, 80, 60, 85)],
      },
      dspecial: { total: 40, groundPound: true, landLag: 16, hitboxes: [hb(6, 39, 0, 4, 22, 9, 280, 30, 70)] },
    },
  }),
  make({
    id: 'boulder', name: 'Boulder', nameFa: 'بولدر', title: 'Stone Titan', titleFa: 'غول سنگی', archetype: 'heavy',
    stats: { weight: 128, walk: 2.6, run: 6.2, airSpeed: 4.4, airAccel: 0.35, gravity: 0.72, fall: 12.5, fastFall: 18, jump: 15, shortHop: 9, airJump: 13.5, airJumps: 1, traction: 0.7, w: 62, h: 86 },
    look: { body: 'golem' },
    skins: [
      { id: 'boulder0', name: 'Granite', nameFa: 'گرانیت', main: '#7d8597', second: '#2ee6a6', glow: '#2ee6a6' },
      { id: 'boulder1', name: 'Magma', nameFa: 'ماگما', main: '#4a2c2a', second: '#ff6b1a', glow: '#ffb01a' },
      { id: 'boulder2', name: 'Jade', nameFa: 'یشم', main: '#2f7d5b', second: '#d9ffe9', glow: '#7dffb5' },
      { id: 'boulder3', name: 'Crystal', nameFa: 'کریستال', main: '#a98bff', second: '#ffffff', glow: '#e3d6ff' },
    ],
    price: { coins: 0, gems: 0 },
    tune: { speed: 1.22, power: 1.32, reach: 1.15 },
    specials: {
      nspecial: { total: 48, hitboxes: [], proj: { frame: 20, max: 1, def: proj({ kind: 'rock', vx: 7, vy: -8, gravity: 0.45, life: 90, r: 18, dmg: 12, ang: 45, bkb: 45, kbg: 60 }) } },
      sspecial: {
        total: 56, armor: [6, 30], vel: [{ s: 10, e: 30, vx: 9 }],
        hitboxes: [hb(10, 30, 34, -40, 26, 13, 38, 55, 78)],
      },
      uspecial: {
        total: 50, helpless: true, airOnce: true, vel: [{ s: 8, e: 22, vy: -16 }], noGravity: [8, 22],
        hitboxes: [hb(8, 22, 0, -70, 30, 12, 88, 50, 80)],
      },
      dspecial: {
        total: 50, groundPound: true, landLag: 22, armor: [4, 30],
        hitboxes: [hb(6, 49, 0, 4, 28, 14, 275, 35, 75)],
      },
    },
  }),
  make({
    id: 'zephyr', name: 'Zephyr', nameFa: 'زفیر', title: 'Wind Dancer', titleFa: 'رقصنده باد', archetype: 'aerial',
    stats: { weight: 76, walk: 3.6, run: 7.2, airSpeed: 6.2, airAccel: 0.6, gravity: 0.5, fall: 9, fastFall: 14, jump: 14.5, shortHop: 9, airJump: 12, airJumps: 4, traction: 0.5, w: 40, h: 66 },
    look: { body: 'bird' },
    skins: [
      { id: 'zephyr0', name: 'Breeze', nameFa: 'نسیم', main: '#38d9a9', second: '#fff4c2', glow: '#c4fff0' },
      { id: 'zephyr1', name: 'Storm', nameFa: 'طوفان', main: '#5b5fef', second: '#d6d8ff', glow: '#f7ff63' },
      { id: 'zephyr2', name: 'Sunset', nameFa: 'غروب', main: '#ff7aa2', second: '#ffe3b3', glow: '#ffb86b' },
      { id: 'zephyr3', name: 'Phoenix', nameFa: 'ققنوس', main: '#ff3d2e', second: '#ffd23f', glow: '#ff8a00' },
    ],
    price: { coins: 2500, gems: 250 },
    tune: { speed: 0.88, power: 0.85, reach: 0.95 },
    specials: {
      nspecial: { total: 40, hitboxes: [], proj: { frame: 12, max: 1, def: proj({ kind: 'gust', vx: 7, life: 45, r: 30, dmg: 0, ang: 10, bkb: 70, kbg: 0, wind: true, pierce: true }) } },
      sspecial: { total: 30, hitboxes: [], proj: { frame: 9, max: 3, def: proj({ kind: 'feather', vx: 15, life: 40, r: 9, dmg: 4, ang: 30, bkb: 10, kbg: 20 }) } },
      uspecial: {
        total: 44, helpless: true, airOnce: true, vel: [{ s: 4, e: 30, vy: -15 }], noGravity: [4, 30],
        hitboxes: [hb(4, 30, 0, -36, 22, 3, 90, 40, 10, { multi: 6 })],
      },
      dspecial: { total: 44, hitboxes: [hb(6, 30, 0, -34, 36, 2, 60, 30, 10, { multi: 5 }), hb(31, 34, 0, -34, 40, 5, 50, 55, 90)] },
    },
  }),
  make({
    id: 'volt', name: 'Volt', nameFa: 'ولت', title: 'Spark Unit', titleFa: 'ربات صاعقه', archetype: 'zoner',
    stats: { weight: 90, walk: 3.1, run: 6.8, airSpeed: 5, airAccel: 0.4, gravity: 0.58, fall: 10.5, fastFall: 15, jump: 15, shortHop: 9.2, airJump: 14, airJumps: 1, traction: 0.6, w: 46, h: 74 },
    look: { body: 'robot' },
    skins: [
      { id: 'volt0', name: 'Prototype', nameFa: 'نمونه اولیه', main: '#ffd23f', second: '#283044', glow: '#38f2ff' },
      { id: 'volt1', name: 'Arctic', nameFa: 'قطبی', main: '#e6f0ff', second: '#2b4a7a', glow: '#62b6ff' },
      { id: 'volt2', name: 'Virus', nameFa: 'ویروس', main: '#7cff4f', second: '#1c1c1c', glow: '#ff2fd0' },
      { id: 'volt3', name: 'Royal', nameFa: 'سلطنتی', main: '#6a2fd6', second: '#ffd700', glow: '#ffd700' },
    ],
    price: { coins: 3000, gems: 300 },
    tune: { speed: 1.05, power: 0.95, reach: 1 },
    specials: {
      nspecial: { total: 44, hitboxes: [], proj: { frame: 16, max: 1, def: proj({ kind: 'orb', vx: 4.5, life: 120, r: 16, dmg: 9, ang: 50, bkb: 35, kbg: 55, pierce: true }) } },
      sspecial: {
        total: 40, vel: [{ s: 10, e: 18, vx: 18 }], noGravity: [8, 20], invuln: [10, 18],
        hitboxes: [hb(10, 18, 0, -36, 26, 8, 70, 50, 45)],
      },
      uspecial: { total: 38, helpless: true, airOnce: true, teleport: { frame: 16, dist: 230 }, invuln: [8, 20], noGravity: [1, 24], hitboxes: [] },
      dspecial: { total: 46, hitboxes: [hb(12, 16, 0, -36, 48, 11, 80, 60, 60)] },
    },
  }),
  make({
    id: 'kira', name: 'Kira', nameFa: 'کیرا', title: 'Moon Blade', titleFa: 'شمشیر ماه', archetype: 'swordie',
    stats: { weight: 88, walk: 3.5, run: 8, airSpeed: 5.3, airAccel: 0.45, gravity: 0.64, fall: 11.5, fastFall: 17, jump: 15.5, shortHop: 9.6, airJump: 14.5, airJumps: 1, traction: 0.55, w: 42, h: 74 },
    look: { body: 'ninja' },
    skins: [
      { id: 'kira0', name: 'Midnight', nameFa: 'نیمه‌شب', main: '#2d2a4a', second: '#ff4f8b', glow: '#f6f1e0' },
      { id: 'kira1', name: 'Sakura', nameFa: 'شکوفه', main: '#ffb3d1', second: '#3d1f33', glow: '#ffffff' },
      { id: 'kira2', name: 'Ronin', nameFa: 'رونین', main: '#8a1c1c', second: '#f2d398', glow: '#ffcf5c' },
      { id: 'kira3', name: 'Ghost', nameFa: 'شبح', main: '#dfe8ff', second: '#5a5f7a', glow: '#38f2ff' },
    ],
    price: { coins: 3500, gems: 350 },
    tune: { speed: 1.05, power: 1.05, reach: 1.3 },
    specials: {
      nspecial: { total: 32, hitboxes: [], proj: { frame: 10, max: 3, def: proj({ kind: 'shuriken', vx: 13, life: 45, r: 10, dmg: 4, ang: 30, bkb: 15, kbg: 25 }) } },
      sspecial: {
        total: 48, vel: [{ s: 10, e: 20, vx: 16 }], noGravity: [10, 22],
        hitboxes: [hb(10, 20, 40, -34, 24, 12, 35, 50, 80)],
      },
      uspecial: {
        total: 48, helpless: true, airOnce: true, vel: [{ s: 5, e: 22, vy: -15.5, vx: 3 }], noGravity: [5, 22],
        hitboxes: [hb(5, 8, 30, -40, 26, 9, 85, 60, 55), hb(9, 22, 20, -60, 24, 5, 80, 40, 60)],
      },
      dspecial: { total: 44, counter: [5, 26], hitboxes: [] },
    },
  }),
  make({
    id: 'pip', name: 'Pip', nameFa: 'پیپ', title: 'Tiny Trouble', titleFa: 'دردسر کوچولو', archetype: 'trickster',
    stats: { weight: 68, walk: 3.8, run: 8.4, airSpeed: 5.6, airAccel: 0.55, gravity: 0.56, fall: 10, fastFall: 15, jump: 15, shortHop: 9.2, airJump: 14, airJumps: 2, traction: 0.5, w: 34, h: 52 },
    look: { body: 'imp' },
    skins: [
      { id: 'pip0', name: 'Mischief', nameFa: 'شیطون', main: '#a05cff', second: '#ffe066', glow: '#ff7af6' },
      { id: 'pip1', name: 'Lime', nameFa: 'لیمو', main: '#9be15d', second: '#1f3d2b', glow: '#e6ff5c' },
      { id: 'pip2', name: 'Candy', nameFa: 'آبنباتی', main: '#ff6fae', second: '#7fe3ff', glow: '#ffffff' },
      { id: 'pip3', name: 'Void', nameFa: 'خلأ', main: '#141421', second: '#ff2e63', glow: '#ff2e63' },
    ],
    price: { coins: 4000, gems: 400 },
    tune: { speed: 0.9, power: 0.88, reach: 0.82 },
    specials: {
      nspecial: { total: 36, hitboxes: [], proj: { frame: 14, max: 2, def: proj({ kind: 'bomb', vx: 6, vy: -7, gravity: 0.42, life: 110, r: 12, dmg: 11, ang: 60, bkb: 45, kbg: 70, bounce: true, explode: 56 }) } },
      sspecial: {
        total: 40, vel: [{ s: 6, e: 26, vx: 11 }],
        hitboxes: [hb(6, 26, 10, -24, 22, 7, 45, 50, 55)],
      },
      uspecial: {
        total: 80, helpless: true, airOnce: true, vel: [{ s: 6, e: 66, vy: -6.5 }], noGravity: [6, 70],
        hitboxes: [hb(6, 10, 0, -50, 22, 4, 90, 50, 30)],
      },
      dspecial: { total: 34, hitboxes: [], proj: { frame: 12, max: 1, def: proj({ kind: 'mine', vx: 0, vy: 2, gravity: 0.6, life: 600, r: 16, dmg: 12, ang: 80, bkb: 55, kbg: 75, mine: true, explode: 60, ox: 0, oy: -10 }) } },
    },
  }),
];

const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));
export function getFighter(id: string): FighterDef {
  return BY_ID.get(id) ?? FIGHTERS[0];
}
