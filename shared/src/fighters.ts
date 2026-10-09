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
  look: {
    body: 'fox' | 'golem' | 'bird' | 'robot' | 'ninja' | 'imp'
      | 'wolf' | 'scorpion' | 'knight' | 'mage' | 'mech' | 'serpent' | 'bear'
      | 'valkyrie' | 'demon' | 'crow' | 'panther' | 'colossus' | 'shark' | 'witch';
    /** held prop drawn on the front hand (ninja implies 'katana') */
    weapon?: 'katana' | 'greatsword' | 'staff' | 'spear' | 'gun' | 'lantern' | 'claws';
  };
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
      { id: 'blaze0', name: 'Classic', nameFa: 'کلاسیک', main: '#e2582c', second: '#f1dcc0', glow: '#ffbf47' },
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
      { id: 'zephyr0', name: 'Breeze', nameFa: 'نسیم', main: '#2aa894', second: '#e7efdc', glow: '#93f0df' },
      { id: 'zephyr1', name: 'Storm', nameFa: 'طوفان', main: '#5b5fef', second: '#d6d8ff', glow: '#f7ff63' },
      { id: 'zephyr2', name: 'Sunset', nameFa: 'غروب', main: '#d9637f', second: '#f2dcb3', glow: '#ffb86b' },
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
      { id: 'volt0', name: 'Prototype', nameFa: 'نمونه اولیه', main: '#e3b02c', second: '#262c3c', glow: '#3fe0ff' },
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
      { id: 'kira1', name: 'Sakura', nameFa: 'شکوفه', main: '#e7a1bd', second: '#3d1f33', glow: '#ffffff' },
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
      { id: 'pip0', name: 'Mischief', nameFa: 'شیطون', main: '#7046d6', second: '#efc54a', glow: '#ff5d9e' },
      { id: 'pip1', name: 'Lime', nameFa: 'لیمو', main: '#9be15d', second: '#1f3d2b', glow: '#e6ff5c' },
      { id: 'pip2', name: 'Neon', nameFa: 'نئون', main: '#d9467f', second: '#54d6f0', glow: '#ffffff' },
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
  // ---------------------------------------------------------------- midnight arena expansion
  make({
    id: 'kage', name: 'Kage', nameFa: 'کاگه', title: 'Wolf Ronin', titleFa: 'رونین گرگ', archetype: 'swordie',
    stats: { weight: 92, walk: 3.5, run: 8.2, airSpeed: 5.4, airAccel: 0.46, gravity: 0.66, fall: 12, fastFall: 17.5, jump: 15.8, shortHop: 9.6, airJump: 14.6, airJumps: 1, traction: 0.6, w: 44, h: 76 },
    look: { body: 'wolf', weapon: 'katana' },
    skins: [
      { id: 'kage0', name: 'Ashen', nameFa: 'خاکستری', main: '#5d6472', second: '#e9e2d0', glow: '#c9a35a' },
      { id: 'kage1', name: 'Blood Moon', nameFa: 'ماه خونین', main: '#7a1f2b', second: '#f4d8b0', glow: '#ff4d4d' },
      { id: 'kage2', name: 'Spirit', nameFa: 'روح', main: '#cfe6ff', second: '#2a3550', glow: '#6ff3ff' },
      { id: 'kage3', name: 'Oni', nameFa: 'دیو', main: '#1c1a24', second: '#e23b3b', glow: '#ffd23f' },
    ],
    price: { coins: 4500, gems: 450 },
    tune: { speed: 1.0, power: 1.06, reach: 1.28 },
    specials: {
      nspecial: { total: 38, hitboxes: [], proj: { frame: 13, max: 1, def: proj({ kind: 'slashwave', vx: 11, life: 32, r: 18, dmg: 7, ang: 35, bkb: 25, kbg: 45, pierce: true, oy: -38 }) } },
      sspecial: {
        total: 46, vel: [{ s: 8, e: 18, vx: 15 }], noGravity: [8, 20],
        hitboxes: [hb(8, 18, 30, -34, 24, 11, 38, 48, 72)],
      },
      uspecial: {
        total: 46, helpless: true, airOnce: true, vel: [{ s: 5, e: 21, vy: -16, vx: 2.5 }], noGravity: [5, 21],
        hitboxes: [hb(5, 9, 24, -44, 26, 8, 82, 55, 55), hb(10, 21, 14, -64, 24, 5, 85, 45, 55, { multi: 30 })],
      },
      dspecial: { total: 42, hitboxes: [hb(10, 13, 0, -38, 34, 5, 60, 40, 30), hb(14, 28, 0, -38, 66, 0, 25, 75, 0, { wind: true, multi: 5 })] },
    },
  }),
  make({
    id: 'sirocco', name: 'Sirocco', nameFa: 'سیروکو', title: 'Scorpion Assassin', titleFa: 'آدمکش کژدم', archetype: 'trickster',
    stats: { weight: 74, walk: 3.7, run: 8.6, airSpeed: 5.5, airAccel: 0.55, gravity: 0.6, fall: 10.5, fastFall: 16, jump: 15.2, shortHop: 9.2, airJump: 14, airJumps: 2, traction: 0.5, w: 46, h: 62 },
    look: { body: 'scorpion', weapon: 'claws' },
    skins: [
      { id: 'sirocco0', name: 'Dune', nameFa: 'تلماسه', main: '#a8845a', second: '#3b2a20', glow: '#e8c26a' },
      { id: 'sirocco1', name: 'Obsidian', nameFa: 'ابسیدین', main: '#2a2638', second: '#9b6bff', glow: '#c58bff' },
      { id: 'sirocco2', name: 'Toxin', nameFa: 'زهرآگین', main: '#5b8c2a', second: '#1d2b14', glow: '#c6ff3d' },
      { id: 'sirocco3', name: 'Emperor', nameFa: 'امپراتور', main: '#7d1630', second: '#ffcf5a', glow: '#ffae00' },
    ],
    price: { coins: 4800, gems: 480 },
    tune: { speed: 0.92, power: 0.92, reach: 1.0 },
    specials: {
      nspecial: { total: 34, hitboxes: [], proj: { frame: 12, max: 2, def: proj({ kind: 'venom', vx: 8, vy: -5, gravity: 0.35, life: 70, r: 10, dmg: 7, ang: 50, bkb: 30, kbg: 40, oy: -40 }) } },
      sspecial: {
        total: 42, vel: [{ s: 6, e: 14, vx: 9 }],
        hitboxes: [hb(12, 15, 62, -48, 18, 12, 30, 40, 85), hb(12, 15, 36, -40, 16, 6, 45, 30, 40)],
      },
      uspecial: {
        total: 46, helpless: true, airOnce: true, vel: [{ s: 4, e: 22, vy: -16, vx: 3 }], noGravity: [4, 22],
        hitboxes: [hb(4, 20, 0, -30, 24, 3, 85, 35, 15, { multi: 5 }), hb(21, 24, 10, -50, 26, 6, 80, 55, 70, { multi: 30 })],
      },
      dspecial: { total: 34, hitboxes: [], proj: { frame: 12, max: 1, def: proj({ kind: 'sandtrap', vx: 0, vy: 2, gravity: 0.6, life: 480, r: 18, dmg: 6, ang: 88, bkb: 75, kbg: 25, mine: true, ox: 22, oy: -10 }) } },
    },
  }),
  make({
    id: 'rime', name: 'Rime', nameFa: 'رایم', title: 'Frost Knight', titleFa: 'شوالیه یخ', archetype: 'swordie',
    stats: { weight: 106, walk: 2.8, run: 6.6, airSpeed: 4.7, airAccel: 0.38, gravity: 0.7, fall: 12, fastFall: 17.5, jump: 15, shortHop: 9, airJump: 13.8, airJumps: 1, traction: 0.65, w: 52, h: 84 },
    look: { body: 'knight', weapon: 'greatsword' },
    skins: [
      { id: 'rime0', name: 'Glacier', nameFa: 'یخچال', main: '#8a9db3', second: '#2f3c55', glow: '#a8e6ff' },
      { id: 'rime1', name: 'Aurora', nameFa: 'شفق', main: '#3b6f8f', second: '#e6fbff', glow: '#6effc5' },
      { id: 'rime2', name: 'Black Ice', nameFa: 'یخ سیاه', main: '#262c3b', second: '#8fb8ff', glow: '#5ce1ff' },
      { id: 'rime3', name: 'Yalda', nameFa: 'یلدا', main: '#e9e4dc', second: '#9b2335', glow: '#ff6b6b' },
    ],
    price: { coins: 5200, gems: 520 },
    tune: { speed: 1.14, power: 1.04, reach: 1.18 },
    specials: {
      nspecial: { total: 40, hitboxes: [], proj: { frame: 15, max: 2, def: proj({ kind: 'icicle', vx: 12, life: 38, r: 11, dmg: 8, ang: 32, bkb: 28, kbg: 45, oy: -40 }) } },
      sspecial: { total: 48, hitboxes: [], proj: { frame: 18, max: 1, def: proj({ kind: 'icewall', vx: 2.2, life: 80, r: 24, dmg: 10, ang: 55, bkb: 45, kbg: 55, pierce: true, ox: 40, oy: -26 }) } },
      uspecial: {
        total: 50, helpless: true, airOnce: true, armor: [7, 14], vel: [{ s: 7, e: 22, vy: -16 }], noGravity: [7, 22],
        hitboxes: [hb(7, 22, 8, -56, 30, 9, 84, 50, 70)],
      },
      dspecial: { total: 46, counter: [6, 24], hitboxes: [] },
    },
  }),
  make({
    id: 'nyx', name: 'Nyx', nameFa: 'نیکس', title: 'Shadow Mage', titleFa: 'جادوگر سایه', archetype: 'zoner',
    stats: { weight: 74, walk: 3.0, run: 6.9, airSpeed: 5.0, airAccel: 0.5, gravity: 0.5, fall: 9.5, fastFall: 14.5, jump: 14.8, shortHop: 9, airJump: 13.5, airJumps: 2, traction: 0.55, w: 42, h: 78 },
    look: { body: 'mage', weapon: 'staff' },
    skins: [
      { id: 'nyx0', name: 'Dusk', nameFa: 'شامگاه', main: '#3a3150', second: '#c9b8e8', glow: '#9d7bff' },
      { id: 'nyx1', name: 'Eclipse', nameFa: 'کسوف', main: '#16141e', second: '#ff9f1c', glow: '#ffcc33' },
      { id: 'nyx2', name: 'Abyss', nameFa: 'ژرفا', main: '#10324a', second: '#6ef0ff', glow: '#25d8ff' },
      { id: 'nyx3', name: 'Blood Rite', nameFa: 'آیین خون', main: '#4a0f1e', second: '#ffb3c1', glow: '#ff2e63' },
    ],
    price: { coins: 5500, gems: 550 },
    tune: { speed: 1.0, power: 0.95, reach: 1.05 },
    specials: {
      nspecial: { total: 34, hitboxes: [], proj: { frame: 12, max: 2, def: proj({ kind: 'shadowbolt', vx: 10, life: 60, r: 11, dmg: 6, ang: 40, bkb: 25, kbg: 40, oy: -44 }) } },
      sspecial: { total: 44, hitboxes: [], proj: { frame: 16, max: 1, def: proj({ kind: 'comet', vx: 8, vy: 3, life: 55, r: 14, dmg: 9, ang: 60, bkb: 40, kbg: 55, explode: 42, oy: -60 }) } },
      uspecial: { total: 40, helpless: true, airOnce: true, teleport: { frame: 15, dist: 240 }, invuln: [6, 20], noGravity: [1, 24], hitboxes: [] },
      dspecial: { total: 54, hitboxes: [hb(24, 28, 0, -38, 58, 13, 80, 55, 62)] },
    },
  }),
  make({
    id: 'rivet', name: 'Rivet', nameFa: 'ریوت', title: 'Iron Brawler', titleFa: 'مشت‌زن آهنین', archetype: 'heavy',
    stats: { weight: 118, walk: 2.7, run: 6.4, airSpeed: 4.5, airAccel: 0.36, gravity: 0.74, fall: 12.8, fastFall: 18, jump: 15.2, shortHop: 9.1, airJump: 13.6, airJumps: 1, traction: 0.72, w: 60, h: 82 },
    look: { body: 'mech' },
    skins: [
      { id: 'rivet0', name: 'Gunmetal', nameFa: 'فولادی', main: '#5a6470', second: '#d8b04a', glow: '#ff9f43' },
      { id: 'rivet1', name: 'Hazard', nameFa: 'خطر', main: '#f2c230', second: '#1e1e24', glow: '#ff3b3b' },
      { id: 'rivet2', name: 'Navy', nameFa: 'دریایی', main: '#2b4e8c', second: '#e6eef9', glow: '#4fd2ff' },
      { id: 'rivet3', name: 'Chrome', nameFa: 'کروم', main: '#d6dde6', second: '#3a3f4a', glow: '#ff4fd8' },
    ],
    price: { coins: 5800, gems: 580 },
    tune: { speed: 1.2, power: 1.18, reach: 1.08 },
    specials: {
      nspecial: { total: 44, hitboxes: [], proj: { frame: 16, max: 1, def: proj({ kind: 'fist', vx: 11, life: 44, r: 15, dmg: 11, ang: 40, bkb: 42, kbg: 62, oy: -38 }) } },
      sspecial: {
        total: 50, vel: [{ s: 8, e: 28, vx: 7.5 }],
        hitboxes: [hb(8, 26, 34, -34, 24, 2, 40, 20, 6, { multi: 4 }), hb(27, 30, 38, -34, 28, 7, 38, 55, 75, { multi: 30 })],
      },
      uspecial: {
        total: 50, helpless: true, airOnce: true, vel: [{ s: 6, e: 21, vy: -17 }], noGravity: [6, 21],
        hitboxes: [hb(6, 21, 0, -24, 30, 8, 80, 45, 55)],
      },
      dspecial: { total: 42, hitboxes: [], proj: { frame: 16, max: 2, def: proj({ kind: 'missile', vx: 4, vy: -11, gravity: 0.42, life: 90, r: 11, dmg: 9, ang: 60, bkb: 40, kbg: 55, explode: 46, ox: -10, oy: -70 }) } },
    },
  }),
  make({
    id: 'azhi', name: 'Azhi', nameFa: 'اژی', title: 'Serpent Queen', titleFa: 'ملکه مارها', archetype: 'zoner',
    stats: { weight: 88, walk: 3.1, run: 7.0, airSpeed: 5.1, airAccel: 0.46, gravity: 0.58, fall: 10.5, fastFall: 15.5, jump: 15, shortHop: 9.2, airJump: 14, airJumps: 1, traction: 0.58, w: 48, h: 80 },
    look: { body: 'serpent' },
    skins: [
      { id: 'azhi0', name: 'Jade', nameFa: 'یشم', main: '#2f6b57', second: '#d9c38a', glow: '#9ff0c4' },
      { id: 'azhi1', name: 'Coral', nameFa: 'مرجان', main: '#c4505a', second: '#f6e3c8', glow: '#ffb36b' },
      { id: 'azhi2', name: 'Venom', nameFa: 'زهر', main: '#2a1d45', second: '#b6ff4a', glow: '#b6ff4a' },
      { id: 'azhi3', name: 'Albino', nameFa: 'سپید', main: '#efe9df', second: '#8a2338', glow: '#ff4f8b' },
    ],
    price: { coins: 6200, gems: 620 },
    tune: { speed: 1.02, power: 0.98, reach: 1.15 },
    specials: {
      nspecial: { total: 38, hitboxes: [], proj: { frame: 14, max: 2, def: proj({ kind: 'snake', vx: 6.5, life: 70, r: 12, dmg: 8, ang: 75, bkb: 35, kbg: 50, ox: 32, oy: -12 }) } },
      sspecial: { total: 44, hitboxes: [hb(12, 15, 70, -14, 22, 11, 35, 40, 80), hb(12, 15, 40, -14, 20, 7, 45, 30, 50)] },
      uspecial: {
        total: 48, helpless: true, airOnce: true, vel: [{ s: 8, e: 22, vy: -17.5 }], noGravity: [8, 22],
        hitboxes: [hb(8, 12, 0, -60, 28, 9, 88, 55, 62)],
      },
      dspecial: {
        total: 40, invuln: [2, 18], vel: [{ s: 2, e: 12, vx: -7 }],
        hitboxes: [], proj: { frame: 2, max: 1, def: proj({ kind: 'husk', vx: 0, vy: 0, life: 34, r: 24, dmg: 8, ang: 60, bkb: 40, kbg: 55, explode: 44, ox: 0, oy: -36 }) },
      },
    },
  }),
  make({
    id: 'ursa', name: 'Ursa', nameFa: 'اورسا', title: 'Bear Monk', titleFa: 'راهب خرس', archetype: 'allrounder',
    stats: { weight: 116, walk: 2.9, run: 6.9, airSpeed: 4.8, airAccel: 0.4, gravity: 0.68, fall: 12, fastFall: 17, jump: 15.4, shortHop: 9.3, airJump: 14, airJumps: 1, traction: 0.68, w: 56, h: 80 },
    look: { body: 'bear' },
    skins: [
      { id: 'ursa0', name: 'Saffron', nameFa: 'زعفرانی', main: '#6b4a33', second: '#c98a2e', glow: '#ffcf7a' },
      { id: 'ursa1', name: 'Polar', nameFa: 'قطبی', main: '#e9eef2', second: '#3d6b8f', glow: '#9fe4ff' },
      { id: 'ursa2', name: 'Panda', nameFa: 'پاندا', main: '#f4f1ea', second: '#2a2a30', glow: '#6ee36e' },
      { id: 'ursa3', name: 'Ascended', nameFa: 'روحانی', main: '#3a2a5c', second: '#f6c445', glow: '#ff7ae0' },
    ],
    price: { coins: 6500, gems: 650 },
    tune: { speed: 1.12, power: 1.1, reach: 1.06 },
    specials: {
      nspecial: { total: 40, hitboxes: [], proj: { frame: 14, max: 1, def: proj({ kind: 'chi', vx: 9, life: 24, r: 22, dmg: 10, ang: 38, bkb: 40, kbg: 60, pierce: true, ox: 34, oy: -38 }) } },
      sspecial: {
        total: 50, vel: [{ s: 4, e: 10, vx: 5 }],
        hitboxes: [hb(8, 30, 38, -36, 24, 1.5, 60, 18, 5, { multi: 3 }), hb(31, 34, 42, -36, 28, 6, 40, 55, 80, { multi: 30 })],
      },
      uspecial: {
        total: 48, helpless: true, airOnce: true, vel: [{ s: 6, e: 22, vy: -15.5, vx: 1.5 }], noGravity: [6, 22],
        hitboxes: [hb(6, 22, 0, -44, 30, 2, 85, 30, 8, { multi: 4 }), hb(23, 26, 0, -66, 30, 7, 85, 60, 80, { multi: 30 })],
      },
      dspecial: { total: 46, armor: [3, 32], hitboxes: [hb(30, 33, 0, -30, 46, 12, 70, 50, 70)] },
    },
  }),
  make({
    id: 'sigrun', name: 'Sigrun', nameFa: 'سیگرون', title: 'Storm Valkyrie', titleFa: 'والکیری طوفان', archetype: 'aerial',
    stats: { weight: 82, walk: 3.4, run: 7.4, airSpeed: 6.0, airAccel: 0.58, gravity: 0.52, fall: 9.5, fastFall: 15, jump: 15, shortHop: 9.2, airJump: 12.8, airJumps: 3, traction: 0.5, w: 44, h: 78 },
    look: { body: 'valkyrie', weapon: 'spear' },
    skins: [
      { id: 'sigrun0', name: 'Steel', nameFa: 'پولادین', main: '#6e7d91', second: '#e8d9b5', glow: '#7fd4ff' },
      { id: 'sigrun1', name: 'Thunder', nameFa: 'تندر', main: '#2d3b8c', second: '#ffe066', glow: '#ffe066' },
      { id: 'sigrun2', name: 'Valhalla', nameFa: 'والهالا', main: '#e8e0cf', second: '#b8862f', glow: '#ffd76b' },
      { id: 'sigrun3', name: 'Ragnarok', nameFa: 'رگناروک', main: '#2a1214', second: '#ff5a3d', glow: '#ff5a3d' },
    ],
    price: { coins: 6800, gems: 680 },
    tune: { speed: 0.9, power: 0.92, reach: 1.12 },
    specials: {
      nspecial: { total: 36, hitboxes: [], proj: { frame: 14, max: 1, def: proj({ kind: 'bolt', vx: 13, life: 38, r: 11, dmg: 8, ang: 36, bkb: 28, kbg: 50, pierce: true, oy: -40 }) } },
      sspecial: {
        total: 44, vel: [{ s: 8, e: 20, vx: 10, vy: -6 }], noGravity: [8, 20],
        hitboxes: [hb(8, 20, 20, -40, 26, 3, 70, 30, 12, { multi: 4 }), hb(21, 24, 26, -44, 28, 6, 50, 55, 70, { multi: 30 })],
      },
      uspecial: {
        total: 46, helpless: true, airOnce: true, vel: [{ s: 5, e: 22, vy: -15 }], noGravity: [5, 22],
        hitboxes: [hb(5, 8, 10, -60, 28, 8, 88, 55, 60)],
      },
      dspecial: { total: 46, hitboxes: [], proj: { frame: 20, max: 1, def: proj({ kind: 'lightning', vx: 0, vy: 18, life: 16, r: 20, dmg: 11, ang: 75, bkb: 45, kbg: 70, pierce: true, ox: 80, oy: -240 }) } },
    },
  }),
  make({
    id: 'azar', name: 'Azar', nameFa: 'آذر', title: 'Lava Demon', titleFa: 'دیو گدازه', archetype: 'heavy',
    stats: { weight: 122, walk: 2.6, run: 6.3, airSpeed: 4.5, airAccel: 0.36, gravity: 0.72, fall: 12.5, fastFall: 18, jump: 15.2, shortHop: 9, airJump: 13.6, airJumps: 1, traction: 0.7, w: 60, h: 88 },
    look: { body: 'demon' },
    skins: [
      { id: 'azar0', name: 'Basalt', nameFa: 'بازالت', main: '#3b2b2e', second: '#e0662c', glow: '#ff9b3d' },
      { id: 'azar1', name: 'Hellfire', nameFa: 'آتش دوزخ', main: '#8c1414', second: '#ffd23f', glow: '#ffe066' },
      { id: 'azar2', name: 'Soulfire', nameFa: 'آتش روح', main: '#1d2338', second: '#4ff0ff', glow: '#9ffaff' },
      { id: 'azar3', name: 'Brimstone', nameFa: 'گوگرد', main: '#2a2a2a', second: '#b6ff2e', glow: '#e0ff5c' },
    ],
    price: { coins: 7200, gems: 720 },
    tune: { speed: 1.2, power: 1.3, reach: 1.12 },
    specials: {
      nspecial: { total: 46, hitboxes: [], proj: { frame: 16, max: 2, def: proj({ kind: 'magma', vx: 5.5, vy: -7, gravity: 0.42, life: 260, r: 14, dmg: 9, ang: 75, bkb: 45, kbg: 55, mine: true, oy: -50 }) } },
      sspecial: {
        total: 58, armor: [4, 22], vel: [{ s: 16, e: 22, vx: 6 }],
        hitboxes: [hb(20, 24, 44, -40, 26, 18, 38, 48, 92)],
      },
      uspecial: {
        total: 52, helpless: true, airOnce: true, vel: [{ s: 8, e: 23, vy: -16 }], noGravity: [8, 23],
        hitboxes: [hb(8, 23, 0, -50, 30, 3, 85, 35, 10, { multi: 5 }), hb(24, 27, 0, -76, 32, 7, 85, 60, 80, { multi: 30 })],
      },
      dspecial: { total: 50, hitboxes: [hb(12, 32, 22, -60, 28, 2, 90, 25, 8, { multi: 4 }), hb(33, 36, 22, -80, 32, 7, 88, 58, 82, { multi: 30 })] },
    },
  }),
  make({
    id: 'corvin', name: 'Corvin', nameFa: 'کوروین', title: 'Crow Gunslinger', titleFa: 'هفت‌تیرکش کلاغ', archetype: 'aerial',
    stats: { weight: 82, walk: 3.4, run: 7.6, airSpeed: 5.8, airAccel: 0.55, gravity: 0.55, fall: 10, fastFall: 15.5, jump: 15, shortHop: 9.2, airJump: 13, airJumps: 3, traction: 0.55, w: 42, h: 74 },
    look: { body: 'crow', weapon: 'gun' },
    skins: [
      { id: 'corvin0', name: 'Outlaw', nameFa: 'یاغی', main: '#2c2a33', second: '#8a6340', glow: '#e3c27a' },
      { id: 'corvin1', name: 'Bone', nameFa: 'استخوان', main: '#e3ddd0', second: '#3a2f2a', glow: '#ff5f5f' },
      { id: 'corvin2', name: 'Midnight', nameFa: 'نیمه‌شب', main: '#1a1f3d', second: '#5b6fbf', glow: '#9ff0ff' },
      { id: 'corvin3', name: 'Bounty', nameFa: 'جایزه‌بگیر', main: '#5a1a1a', second: '#f2c14e', glow: '#ffd700' },
    ],
    price: { coins: 7500, gems: 750 },
    tune: { speed: 0.94, power: 0.98, reach: 1.05 },
    specials: {
      nspecial: { total: 26, hitboxes: [], proj: { frame: 9, max: 2, def: proj({ kind: 'bullet', vx: 20, life: 26, r: 6, dmg: 5, ang: 25, bkb: 15, kbg: 30, ox: 40, oy: -40 }) } },
      sspecial: {
        total: 48, vel: [{ s: 12, e: 18, vx: -5 }],
        hitboxes: [hb(11, 13, 52, -38, 30, 13, 38, 40, 82)],
      },
      uspecial: {
        total: 54, helpless: true, airOnce: true, vel: [{ s: 4, e: 36, vy: -10.5, vx: 2 }], noGravity: [4, 36],
        hitboxes: [hb(4, 8, 0, -40, 26, 4, 85, 50, 30)],
      },
      dspecial: { total: 34, hitboxes: [], proj: { frame: 11, max: 2, def: proj({ kind: 'ricochet', vx: 11, vy: 8, life: 55, r: 7, dmg: 6, ang: 55, bkb: 25, kbg: 40, bounce: true, oy: -30 }) } },
    },
  }),
  make({
    id: 'onyx', name: 'Onyx', nameFa: 'اونیکس', title: 'Cyber Panther', titleFa: 'پلنگ سایبری', archetype: 'allrounder',
    stats: { weight: 86, walk: 3.8, run: 9.0, airSpeed: 5.6, airAccel: 0.5, gravity: 0.66, fall: 11.5, fastFall: 17, jump: 16, shortHop: 9.8, airJump: 14.8, airJumps: 1, traction: 0.6, w: 46, h: 66 },
    look: { body: 'panther', weapon: 'claws' },
    skins: [
      { id: 'onyx0', name: 'Stealth', nameFa: 'پنهان', main: '#2a2d38', second: '#8a93a6', glow: '#4ee6c8' },
      { id: 'onyx1', name: 'Neon', nameFa: 'نئون', main: '#19122e', second: '#ff3cac', glow: '#ff3cac' },
      { id: 'onyx2', name: 'Cheetah', nameFa: 'یوزپلنگ', main: '#c99a4a', second: '#3a2a18', glow: '#ffde6b' },
      { id: 'onyx3', name: 'Ghost', nameFa: 'شبح', main: '#e8ecf5', second: '#6a7ba8', glow: '#7cc8ff' },
    ],
    price: { coins: 7800, gems: 780 },
    tune: { speed: 0.92, power: 0.98, reach: 1.0 },
    specials: {
      nspecial: { total: 36, hitboxes: [], proj: { frame: 12, max: 1, def: proj({ kind: 'clawdisc', vx: 10, life: 50, r: 13, dmg: 7, ang: 42, bkb: 28, kbg: 45 }) } },
      sspecial: {
        total: 44, vel: [{ s: 6, e: 16, vx: 11, vy: -6 }], noGravity: [6, 16],
        hitboxes: [hb(8, 18, 26, -30, 24, 10, 40, 45, 72)],
      },
      uspecial: {
        total: 44, helpless: true, airOnce: true, vel: [{ s: 4, e: 21, vy: -16, vx: 2.5 }], noGravity: [4, 21],
        hitboxes: [hb(4, 10, 18, -48, 24, 4, 80, 40, 20, { multi: 3 }), hb(11, 21, 12, -62, 24, 6, 82, 52, 62, { multi: 30 })],
      },
      dspecial: { total: 44, invuln: [4, 20], hitboxes: [hb(22, 25, 30, -30, 28, 10, 40, 45, 72)] },
    },
  }),
  make({
    id: 'kavir', name: 'Kavir', nameFa: 'کویر', title: 'Sand Colossus', titleFa: 'غول‌پیکر شنی', archetype: 'heavy',
    stats: { weight: 130, walk: 2.4, run: 5.9, airSpeed: 4.2, airAccel: 0.32, gravity: 0.74, fall: 12.8, fastFall: 18.5, jump: 15, shortHop: 9, airJump: 13.5, airJumps: 1, traction: 0.75, w: 64, h: 92 },
    look: { body: 'colossus' },
    skins: [
      { id: 'kavir0', name: 'Sandstone', nameFa: 'ماسه‌سنگ', main: '#b89668', second: '#4a5f7a', glow: '#f0c36b' },
      { id: 'kavir1', name: 'Red Rock', nameFa: 'صخره سرخ', main: '#9b4a2e', second: '#f3d8b8', glow: '#ff9050' },
      { id: 'kavir2', name: 'Pharaoh', nameFa: 'فرعون', main: '#1f3b5c', second: '#e8c35a', glow: '#ffd86b' },
      { id: 'kavir3', name: 'Glass', nameFa: 'شیشه', main: '#7fd6d0', second: '#ffffff', glow: '#c9fffb' },
    ],
    price: { coins: 8200, gems: 820 },
    tune: { speed: 1.25, power: 1.26, reach: 1.15 },
    specials: {
      nspecial: { total: 46, hitboxes: [], proj: { frame: 18, max: 1, def: proj({ kind: 'dune', vx: 7, life: 55, r: 18, dmg: 9, ang: 70, bkb: 40, kbg: 55, pierce: true, ox: 36, oy: -16 }) } },
      sspecial: {
        total: 56, vel: [{ s: 8, e: 40, vx: 3.5 }],
        hitboxes: [hb(8, 38, 0, -44, 48, 1.4, 70, 25, 6, { multi: 5 }), hb(39, 42, 0, -44, 52, 6, 55, 55, 75, { multi: 30 })],
      },
      uspecial: {
        total: 52, helpless: true, airOnce: true, armor: [8, 18], vel: [{ s: 8, e: 24, vy: -16 }], noGravity: [8, 24],
        hitboxes: [hb(8, 24, 0, -70, 30, 10, 88, 50, 75)],
      },
      dspecial: { total: 50, groundPound: true, landLag: 22, hitboxes: [hb(6, 49, 0, 4, 30, 13, 275, 34, 72)] },
    },
  }),
  make({
    id: 'riptide', name: 'Riptide', nameFa: 'ریپتاید', title: 'Tide Shark', titleFa: 'کوسه موج', archetype: 'allrounder',
    stats: { weight: 100, walk: 3.3, run: 7.8, airSpeed: 5.2, airAccel: 0.48, gravity: 0.6, fall: 11, fastFall: 16.5, jump: 15.4, shortHop: 9.4, airJump: 14.2, airJumps: 1, traction: 0.55, w: 50, h: 74 },
    look: { body: 'shark' },
    skins: [
      { id: 'riptide0', name: 'Deep', nameFa: 'ژرفا', main: '#4a6276', second: '#e6ecef', glow: '#6fd3e8' },
      { id: 'riptide1', name: 'Hammerhead', nameFa: 'سرچکشی', main: '#6b5d4a', second: '#f1e6d0', glow: '#ffb347' },
      { id: 'riptide2', name: 'Abyssal', nameFa: 'مغاک', main: '#11162a', second: '#3cf0ff', glow: '#3cf0ff' },
      { id: 'riptide3', name: 'Reef', nameFa: 'مرجانی', main: '#e66b5b', second: '#fff2e0', glow: '#ffe066' },
    ],
    price: { coins: 8600, gems: 860 },
    tune: { speed: 1.02, power: 1.05, reach: 1.02 },
    specials: {
      nspecial: { total: 38, hitboxes: [], proj: { frame: 14, max: 2, def: proj({ kind: 'bubble', vx: 3.5, vy: -0.4, life: 110, r: 14, dmg: 8, ang: 60, bkb: 35, kbg: 50, explode: 36 }) } },
      sspecial: {
        total: 48, armor: [6, 14], vel: [{ s: 6, e: 24, vx: 12 }], noGravity: [6, 24],
        hitboxes: [hb(6, 24, 24, -30, 24, 9, 45, 45, 65)],
      },
      uspecial: {
        total: 46, helpless: true, airOnce: true, vel: [{ s: 4, e: 22, vy: -15 }], noGravity: [4, 22],
        hitboxes: [hb(4, 22, 0, -30, 30, 2, 88, 30, 8, { multi: 4 }), hb(23, 26, 0, -60, 30, 6, 85, 58, 72, { multi: 30 })],
      },
      dspecial: { total: 44, hitboxes: [hb(14, 16, 30, -34, 26, 16, 42, 42, 88)] },
    },
  }),
  make({
    id: 'mira', name: 'Mira', nameFa: 'میرا', title: 'Lantern Witch', titleFa: 'ساحره فانوس', archetype: 'trickster',
    stats: { weight: 66, walk: 3.3, run: 7.2, airSpeed: 5.4, airAccel: 0.55, gravity: 0.46, fall: 8.8, fastFall: 14, jump: 14.6, shortHop: 9, airJump: 13, airJumps: 2, traction: 0.5, w: 40, h: 76 },
    look: { body: 'witch', weapon: 'lantern' },
    skins: [
      { id: 'mira0', name: 'Hollow', nameFa: 'تهی', main: '#3e3a52', second: '#d8c8a0', glow: '#ffb347' },
      { id: 'mira1', name: 'Moonlit', nameFa: 'مهتابی', main: '#2b4a5a', second: '#e0f7ff', glow: '#7ff7ff' },
      { id: 'mira2', name: 'Harvest', nameFa: 'خرمن', main: '#c4561e', second: '#2a1a12', glow: '#ffd23f' },
      { id: 'mira3', name: 'Spectre', nameFa: 'روح', main: '#f0eef8', second: '#6a4ca8', glow: '#c39bff' },
    ],
    price: { coins: 9000, gems: 900 },
    tune: { speed: 0.9, power: 0.86, reach: 1.05 },
    specials: {
      nspecial: { total: 34, hitboxes: [], proj: { frame: 12, max: 3, def: proj({ kind: 'wisp', vx: 3.2, vy: -0.5, life: 140, r: 12, dmg: 7, ang: 50, bkb: 28, kbg: 42 }) } },
      sspecial: { total: 40, hitboxes: [hb(10, 14, 52, -34, 24, 10, 48, 40, 72), hb(10, 14, 28, -30, 18, 6, 60, 30, 40)] },
      uspecial: {
        total: 56, helpless: true, airOnce: true, vel: [{ s: 4, e: 38, vy: -9.5, vx: 3 }], noGravity: [4, 38],
        hitboxes: [hb(4, 8, 0, -40, 24, 4, 85, 45, 30)],
      },
      dspecial: { total: 36, hitboxes: [], proj: { frame: 12, max: 1, def: proj({ kind: 'lantern', vx: 0, vy: 2, gravity: 0.6, life: 540, r: 15, dmg: 11, ang: 80, bkb: 52, kbg: 72, mine: true, explode: 56, ox: 0, oy: -10 }) } },
    },
  }),
];

const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));
export function getFighter(id: string): FighterDef {
  return BY_ID.get(id) ?? FIGHTERS[0];
}
