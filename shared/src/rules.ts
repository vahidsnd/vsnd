import { Btn } from './input.ts';
import { getFighter, registerFighter, FIGHTERS, type FighterDef } from './fighters.ts';
import { getStage, platformPos, type StageDef } from './stages.ts';
import { SPELLS } from './spells.ts';
import type { FighterMods, FighterState, GameState, MatchConfig, MoveDef, MoveId, ProjectileDef } from './types.ts';

// =====================================================================================
//  Match rules ("event modes") layered on the core simulation.
//
//  Everything here is deterministic: it only reads the match config, the frame number and
//  the game state, so the server and every client compute exactly the same thing.
//   • low gravity, giant mode and the co-op boss use *derived fighter definitions*
//     (scaled stats / hitboxes, registered under "<id>~<key>") so the whole engine,
//     the AI and the renderer just work with them
//   • spells-only: every fighter gets a spell, the meter fills fast, normal attacks are weaker
//   • stamina: an HP pool per stock (KO at 0 HP), blast zones still KO
//   • sudden death: one stock, everybody starts at 300%
//   • items: spawn on the stage from (frame, seed); picked up by walking over them
//   • survival (offline) and co-op boss bookkeeping
//  Hooks are called from sim.step(): rulesInput → (fighters) → rulesMid → (blast zones) → rulesLate.
// =====================================================================================

export type ItemKind = 'heal' | 'bomb' | 'boots' | 'bubble' | 'mana';
export const ITEM_KINDS: ItemKind[] = ['heal', 'bomb', 'boots', 'bubble', 'mana'];
/** relative spawn weight per item kind */
const ITEM_WEIGHT: Record<ItemKind, number> = { heal: 3, bomb: 3, boots: 2, bubble: 2, mana: 2 };

export interface MatchRules {
  /** gravity multiplier on fighters (0.5 = low gravity) */
  gravity?: number;
  /** every fighter casts spells; the meter fills fast and normal attacks deal half damage */
  spellsOnly?: boolean;
  /** all fighters bigger and heavier */
  giant?: boolean;
  /** stamina mode: HP per stock instead of the percent meter */
  stamina?: number;
  /** every life starts at 300% (max 3 stocks) */
  suddenDeath?: boolean;
  /** items spawn on the stage */
  items?: boolean;
  itemKinds?: ItemKind[];
  /** frames between item spawns (default 6 s) */
  itemEvery?: number;
  /** seed for item spawns / survival waves */
  seed?: number;
  /** endless waves of computer fighters (offline mode) */
  survival?: boolean;
  /** slot of the co-op boss (damage tally + boss HP bar) */
  boss?: number;
}

export interface ItemState { id: number; kind: ItemKind; plat: number; ox: number; x: number; y: number; t: number }
export interface BossTally { slot: number; hp: number; max: number; dmg: number[] }
export interface SurvivalState { wave: number; level: number; foes: number }

export const ITEM_LIFE = 12 * 60;
export const MAX_ITEMS = 3;
export const BOOTS_FRAMES = 8 * 60;
export const BUBBLE_FRAMES = 5 * 60;
export const HEAL_AMOUNT = 35;
export const GIANT = { scale: 1.4, weight: 1.6 };
export const LOW_GRAVITY = 0.5;
export const SUDDEN_DEATH_PCT = 300;
const RESPAWN_FRAMES = 100;
const BOMB: ProjectileDef = { kind: 'it_bomb', vx: 9, vy: -7, gravity: 0.45, life: 120, r: 14, dmg: 15, ang: 60, bkb: 58, kbg: 72, explode: 86, ox: 18, oy: -50 };

// ---- deterministic hashing ---------------------------------------------------------------------
export function hash32(...xs: number[]) {
  let h = 0x811c9dc5 | 0;
  for (const x of xs) {
    h = Math.imul(h ^ (x | 0), 0x01000193);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  }
  return (h >>> 0) / 4294967296;
}

// ---- derived fighter definitions ----------------------------------------------------------------
export interface Derive { scale: number; grav: number; weight: number; atk: number; armor: boolean }
const NO_DERIVE: Derive = { scale: 1, grav: 1, weight: 1, atk: 1, armor: false };
const r2 = (n: number) => Math.round(n * 100) / 100;

export function baseFighterId(id: string) { const i = id.indexOf('~'); return i < 0 ? id : id.slice(0, i); }
/** visual size multiplier of a (possibly derived) fighter id */
export function fighterScale(id: string) { const m = /~s([\d.]+)/.exec(id); return m ? Number(m[1]) : 1; }

function deriveKey(d: Derive) {
  return `s${r2(d.scale)}g${r2(d.grav)}w${r2(d.weight)}a${r2(d.atk)}${d.armor ? 'A' : ''}`;
}

/** Id of the definition for `base` under the given modifiers (registers it on first use). */
export function derivedId(base: string, d: Derive): string {
  const b = getFighter(baseFighterId(base));
  if (d.scale === 1 && d.grav === 1 && d.weight === 1 && d.atk === 1 && !d.armor) return b.id;
  const id = `${b.id}~${deriveKey(d)}`;
  if (getFighter(id).id !== id) registerFighter(deriveDef(b, id, d));
  return id;
}

function deriveDef(b: FighterDef, id: string, d: Derive): FighterDef {
  const s = d.scale;
  const st = { ...b.stats };
  st.w = r2(st.w * s); st.h = r2(st.h * s);
  st.weight = r2(st.weight * d.weight);
  // low gravity: floaty arcs, slower falls; giants jump a little higher so platforms stay reachable
  st.gravity = r2(st.gravity * d.grav);
  const fallK = d.grav < 1 ? 0.55 + 0.45 * d.grav : 1;
  st.fall = r2(st.fall * fallK); st.fastFall = r2(st.fastFall * fallK);
  const jumpK = s > 1 ? 1 + (s - 1) * 0.3 : 1;
  st.jump = r2(st.jump * jumpK); st.airJump = r2(st.airJump * jumpK); st.shortHop = r2(st.shortHop * jumpK);
  const moveK = s > 1 ? 1 + (s - 1) * 0.2 : 1;
  st.walk = r2(st.walk * moveK); st.run = r2(st.run * moveK); st.airSpeed = r2(st.airSpeed * moveK);
  const hb = <T extends { x: number; y: number; r: number; dmg: number }>(h: T): T => ({ ...h, x: r2(h.x * s), y: r2(h.y * s), r: r2(h.r * s), dmg: h.dmg ? r2(h.dmg * d.atk) : 0 });
  const moves = {} as Record<MoveId, MoveDef>;
  for (const [k, m0] of Object.entries(b.moves) as [MoveId, MoveDef][]) {
    const m: MoveDef = { ...m0, hitboxes: m0.hitboxes.map(hb) };
    if (m0.throwHit) m.throwHit = hb(m0.throwHit);
    if (m0.proj) {
      const p = m0.proj.def;
      m.proj = { ...m0.proj, def: { ...p, r: r2(p.r * s), dmg: r2(p.dmg * d.atk), ox: r2((p.ox ?? 30) * s), oy: r2((p.oy ?? -34) * s), ...(p.explode ? { explode: r2(p.explode * s) } : {}) } };
    }
    if (m0.teleport) m.teleport = { ...m0.teleport, dist: r2(m0.teleport.dist * s) };
    if (d.armor && k !== 'grab') m.armor = [1, m0.total];
    moves[k] = m;
  }
  return { ...b, id, stats: st, moves };
}

// ---- config normalisation (called by createGame) --------------------------------------------------
/** Fills in rule effects on the config: derived fighters, spells for everyone, sudden-death stocks. */
export function prepareConfig(cfg: MatchConfig): { cfg: MatchConfig; charIds: string[] } {
  const r = cfg.rules;
  const ids = cfg.players.map((p) => p.charId);
  if (!r && !cfg.players.some((p) => p.mods?.scale || p.mods?.armor)) return { cfg, charIds: ids };
  const out: MatchConfig = { ...cfg, players: cfg.players.map((p) => ({ ...p })) };
  if (r?.suddenDeath) out.stocks = Math.min(cfg.stocks, 3);
  out.players.forEach((p, i) => {
    if (r?.spellsOnly && !p.mods?.spell) {
      const sp = SPELLS[Math.floor(hash32(r.seed ?? 0, i, 77) * SPELLS.length)].id;
      p.mods = { atk: 1, def: 1, hp: 1, ...(p.mods ?? {}), spell: sp, spellLv: Math.max(p.mods?.spellLv ?? 0, 2) };
    }
    const m = p.mods;
    const d: Derive = {
      scale: (m?.scale ?? 1) * (r?.giant ? GIANT.scale : 1),
      grav: r?.gravity ?? 1,
      weight: r?.giant ? GIANT.weight : 1,
      atk: r?.spellsOnly ? 0.5 : 1,
      armor: !!m?.armor,
    };
    ids[i] = derivedId(p.charId, d);
  });
  return { cfg: out, charIds: ids };
}

/** Per-match state set-up after the fighters exist (createGame). */
export function rulesInit(state: GameState) {
  const r = state.cfg.rules;
  if (r?.suddenDeath) for (const f of state.fighters) f.damage = SUDDEN_DEATH_PCT;
  if (r?.items) state.items = [];
  if (r?.items || r?.boss !== undefined) for (const f of state.fighters) { f.spd = 0; f.bub = 0; f.held = 0; }
  if (r?.boss !== undefined) {
    const b = state.fighters[r.boss];
    const max = state.cfg.players[r.boss]?.mods?.hpMax ?? 1000;
    if (b) { b.stocks = 99; state.boss = { slot: r.boss, hp: max, max, dmg: state.fighters.map(() => 0) }; }
  }
  if (r?.survival) {
    state.sv = { wave: 1, level: 2, foes: 1 };
    setupWave(state);
  }
}

// ---- stamina ------------------------------------------------------------------------------------
/** HP pool of a fighter in this match (0 = percent rules). */
export function staminaMax(state: GameState, slot: number): number {
  if (state.boss && state.boss.slot === slot) return state.boss.max;
  return state.cfg.players[slot]?.mods?.hpMax ?? state.cfg.rules?.stamina ?? 0;
}
export function staminaHp(state: GameState, slot: number): number {
  if (state.boss && state.boss.slot === slot) return Math.max(0, state.boss.hp);
  const max = staminaMax(state, slot);
  return max ? Math.max(0, Math.round(max - state.fighters[slot].damage)) : 0;
}

function setAct(f: FighterState, a: FighterState['action']) { f.action = a; f.af = 0; f.intang = false; if (a !== 'attack') { f.move = null; f.charge = 0; } }

function koFighter(state: GameState, f: FighterState) {
  f.stocks--;
  f.stats.falls++;
  const killer = f.lastHitBy;
  if (killer >= 0 && killer !== f.slot) state.fighters[killer].stats.kos++;
  if (f.grabPartner >= 0) {
    const p = state.fighters[f.grabPartner];
    if (p) { p.grabPartner = -1; if (p.action === 'grabbed' || p.action === 'grabbing') setAct(p, 'air'); }
    f.grabPartner = -1;
  }
  state.events.push({ t: 'ko', slot: f.slot, by: killer, x: f.x, y: f.y - 40 });
  setAct(f, 'dead');
  f.respawn = RESPAWN_FRAMES;
  f.vx = f.vy = f.kx = f.ky = 0;
  f.hitstun = 0; f.combo = 0; f.held = 0;
}

// ---- hook: inputs (before the fighters update) ------------------------------------------------------
const THROWABLE = new Set(['idle', 'walk', 'run', 'crouch', 'air', 'land', 'jumpsquat']);
export function rulesInput(state: GameState) {
  if (!state.items) return;
  for (const f of state.fighters) {
    if (!f.held || f.hitlag > 0 || !THROWABLE.has(f.action)) continue;
    if (!((f.inp & Btn.GRAB) && !(f.prev & Btn.GRAB))) continue;
    // throw the bomb (grab button); up = lob, down = drop
    const up = (f.inp & Btn.UP) !== 0, down = (f.inp & Btn.DOWN) !== 0;
    const dx = (f.inp & Btn.RIGHT ? 1 : 0) - (f.inp & Btn.LEFT ? 1 : 0);
    if (dx) f.facing = dx as 1 | -1;
    const st = getFighter(f.charId).stats;
    const vx = up ? 3 : down ? 1.5 : BOMB.vx, vy = up ? -12 : down ? 3 : BOMB.vy;
    state.projectiles.push({
      id: state.nextId++, owner: f.slot, team: f.team, kind: BOMB.kind,
      x: f.x + f.facing * (st.w / 2 + 6), y: f.y - st.h * 0.7, vx: vx * f.facing, vy, life: BOMB.life, def: BOMB, hit: [], facing: f.facing,
    });
    state.events.push({ t: 'proj', slot: f.slot, kind: BOMB.kind });
    f.held = 0;
    f.prev |= Btn.GRAB; // consumed: the grab button doesn't also start a grab
  }
}

// ---- hook: after hits, before blast zones --------------------------------------------------------------
type Plat = { x1: number; x2: number; y: number };
export function rulesMid(state: GameState, stage: StageDef, plats: Plat[]) {
  const r = state.cfg.rules;
  if (!r) return;
  const live = state.frame >= 180;
  // boss: damage tally, super armor
  const boss = state.boss;
  if (boss) {
    const b = state.fighters[boss.slot];
    let hitThisFrame = false;
    for (const e of state.events) {
      if (e.t !== 'hit' || e.victim !== boss.slot || e.attacker === boss.slot) continue;
      boss.hp = Math.max(0, Math.round((boss.hp - e.dmg) * 10) / 10);
      if (e.attacker >= 0) boss.dmg[e.attacker] = Math.round(((boss.dmg[e.attacker] ?? 0) + e.dmg) * 10) / 10;
      hitThisFrame = true;
    }
    if (b && hitThisFrame && b.action === 'hitstun') { b.hitstun = Math.min(b.hitstun, 8); b.kx *= 0.35; b.ky *= 0.35; }
    // percent tracks the boss's wounds so launches grow as it weakens (never above ~110%)
    if (b) b.damage = Math.round((1 - boss.hp / boss.max) * 110);
  }
  // sudden death: every life starts at 300%
  if (r.suddenDeath) for (const e of state.events) if (e.t === 'spawn') state.fighters[e.slot].damage = SUDDEN_DEATH_PCT;
  // spells-only: fast meter
  if (r.spellsOnly && live) for (const f of state.fighters) if (f.stocks > 0 && f.action !== 'dead' && f.hitlag <= 0) f.mana = Math.min(100, Math.round((f.mana + 0.32) * 100) / 100);
  // stamina: KO at 0 HP
  if (r.stamina || state.cfg.players.some((p) => p.mods?.hpMax)) {
    for (const f of state.fighters) {
      if (f.action === 'dead' || f.stocks <= 0 || (boss && boss.slot === f.slot)) continue;
      const max = staminaMax(state, f.slot);
      if (max && f.damage >= max) koFighter(state, f);
    }
  }
  // buffs
  for (const f of state.fighters) {
    if (f.spd) {
      f.spd--;
      // speed boots: extra ground / air speed on top of the normal movement
      if (f.action === 'walk' || f.action === 'run' || f.action === 'air') {
        const nx = f.x + f.vx * 0.45;
        if (!f.grounded) f.x = nx;
        else {
          const surf = f.platform === 0 ? stage.main : plats[f.platform - 1];
          if (surf && nx >= surf.x1 && nx <= surf.x2) f.x = nx;
        }
      }
    }
    if (f.bub) { f.bub--; if (f.action !== 'dead') f.invuln = Math.max(f.invuln, 2); }
    if (f.action === 'dead') { f.spd = f.spd ? 0 : f.spd; f.bub = f.bub ? 0 : f.bub; }
  }
  if (state.items && live) updateItems(state, stage, plats);
}

// ---- items ---------------------------------------------------------------------------------------------------
function itemSurfaces(stage: StageDef, plats: Plat[]): Plat[] { return [stage.main, ...plats]; }

function updateItems(state: GameState, stage: StageDef, plats: Plat[]) {
  const r = state.cfg.rules!;
  const items = state.items!;
  const surfaces = itemSurfaces(stage, plats);
  // ride platforms, age, despawn
  for (const it of items) {
    const s = surfaces[it.plat] ?? stage.main;
    it.x = s.x1 + it.ox; it.y = s.y; it.t++;
  }
  state.items = items.filter((it) => it.t < ITEM_LIFE);
  // spawn
  const every = r.itemEvery ?? 360;
  const since = state.frame - 180;
  if (since > 0 && since % every === 0 && state.items.length < MAX_ITEMS) {
    const seed = r.seed ?? 0;
    const kinds = (r.itemKinds?.length ? r.itemKinds : ITEM_KINDS).filter((k) => k !== 'mana' || state.cfg.players.some((p) => p.mods?.spell));
    const total = kinds.reduce((a, k) => a + ITEM_WEIGHT[k], 0);
    let roll = hash32(seed, state.frame, 1) * total;
    let kind = kinds[0];
    for (const k of kinds) { if ((roll -= ITEM_WEIGHT[k]) < 0) { kind = k; break; } }
    const pi = Math.floor(hash32(seed, state.frame, 2) * surfaces.length);
    const s = surfaces[pi];
    const margin = Math.min(40, (s.x2 - s.x1) / 4);
    const ox = margin + hash32(seed, state.frame, 3) * (s.x2 - s.x1 - margin * 2);
    state.items.push({ id: state.nextId++, kind, plat: pi, ox: Math.round(ox), x: s.x1 + ox, y: s.y, t: 0 });
  }
  // pick up: walk over it
  for (const f of state.fighters) {
    if (f.stocks <= 0 || f.action === 'dead' || f.action === 'spawn' || f.action === 'grabbed') continue;
    if (state.boss && state.boss.slot === f.slot) continue;
    const st = getFighter(f.charId).stats;
    for (const it of state.items) {
      if (it.t < 20) continue; // spawn pop-in
      if (Math.abs(f.x - it.x) > st.w / 2 + 14 || f.y < it.y - st.h - 10 || f.y > it.y + 14) continue;
      if (it.kind === 'bomb' && f.held) continue;
      applyItem(state, f, it.kind);
      state.events.push({ t: 'item', slot: f.slot, kind: it.kind, x: it.x, y: it.y - 16 });
      it.t = ITEM_LIFE; // consumed
    }
  }
  state.items = state.items.filter((it) => it.t < ITEM_LIFE);
}

export function applyItem(state: GameState, f: FighterState, kind: ItemKind) {
  switch (kind) {
    case 'heal': f.damage = Math.max(0, Math.round((f.damage - HEAL_AMOUNT) * 10) / 10); break;
    case 'bomb': f.held = 1; break;
    case 'boots': f.spd = BOOTS_FRAMES; break;
    case 'bubble': f.bub = BUBBLE_FRAMES; break;
    case 'mana':
      if (state.cfg.players[f.slot]?.mods?.spell) f.mana = 100;
      else f.damage = Math.max(0, f.damage - 10);
      break;
  }
}

// ---- hook: before the end-of-match check ----------------------------------------------------------------------
export function rulesLate(state: GameState) {
  const boss = state.boss;
  if (boss) {
    const b = state.fighters[boss.slot];
    // a ring-out costs the boss 12% of its HP (credited to whoever launched it)
    for (const e of state.events) {
      if (e.t !== 'ko' || e.slot !== boss.slot) continue;
      const cut = Math.round(boss.max * 0.12);
      boss.hp = Math.max(0, boss.hp - cut);
      if (e.by >= 0 && e.by !== boss.slot) boss.dmg[e.by] = (boss.dmg[e.by] ?? 0) + cut;
    }
    if (b && boss.hp <= 0 && b.stocks > 0) {
      b.stocks = 0;
      if (b.action !== 'dead') { setAct(b, 'dead'); state.events.push({ t: 'ko', slot: b.slot, by: b.lastHitBy, x: b.x, y: b.y - 60 }); }
    }
  }
  if (state.sv) {
    const me = state.fighters[0];
    const foesLeft = state.fighters.some((f) => f.slot !== 0 && f.stocks > 0);
    if (me.stocks > 0 && !foesLeft) {
      state.sv.wave++;
      // breather: heal a bit, an extra life every 5 waves
      me.damage = Math.max(0, me.damage - 30);
      if (state.sv.wave % 5 === 0) me.stocks = Math.min(5, me.stocks + 1);
      setupWave(state);
      state.events.push({ t: 'wave', wave: state.sv.wave });
    }
  }
}

// ---- survival waves ----------------------------------------------------------------------------------------------
export function survivalWave(wave: number, seed: number, slots: number) {
  const foes = Math.min(slots, 1 + Math.floor((wave - 1) / 3));
  const level = Math.min(9, 2 + Math.floor((wave - 1) * 0.6));
  const ids: string[] = [];
  for (let i = 0; i < foes; i++) ids.push(FIGHTERS[Math.floor(hash32(seed, wave, i, 5) * FIGHTERS.length)].id);
  const boost = 1 + Math.min(0.5, (wave - 1) * 0.035);
  return { foes, level, ids, mods: { atk: boost, def: 1 / Math.sqrt(boost), hp: boost } as FighterMods };
}

function setupWave(state: GameState) {
  const sv = state.sv!;
  const slots = state.fighters.length - 1;
  const w = survivalWave(sv.wave, state.cfg.rules?.seed ?? 0, slots);
  sv.level = w.level; sv.foes = w.foes;
  const stage = getStage(state.cfg.stageId);
  for (let i = 1; i < state.fighters.length; i++) {
    const f = state.fighters[i];
    const active = i - 1 < w.foes;
    const p = state.cfg.players[i];
    if (!active) { f.stocks = 0; setAct(f, 'dead'); f.respawn = 0; continue; }
    const id = w.ids[i - 1];
    f.charId = derivedId(id, { ...NO_DERIVE, grav: state.cfg.rules?.gravity ?? 1, scale: state.cfg.rules?.giant ? GIANT.scale : 1, weight: state.cfg.rules?.giant ? GIANT.weight : 1 });
    if (p) { p.charId = id; p.mods = { ...w.mods, ...(p.mods?.spell ? { spell: p.mods.spell, spellLv: p.mods.spellLv } : {}) }; p.skin = sv.wave % 3; }
    f.skin = sv.wave % 3;
    f.stocks = 1; f.damage = 0; f.mana = 0; f.held = 0; f.spd = 0; f.bub = 0;
    const [sx] = stage.spawns[i % stage.spawns.length];
    f.x = sx; f.y = -330; f.vx = f.vy = f.kx = f.ky = 0; f.grounded = false;
    f.jumps = getFighter(f.charId).stats.airJumps; f.invuln = 90; f.lastHitBy = -1;
    setAct(f, 'spawn');
    state.events.push({ t: 'spawn', slot: f.slot });
  }
}

// ---- bots: items and modes ---------------------------------------------------------------------------------------
/**
 * Extra bot behaviour for rule matches. Returns input bits, or -1 to fall back to the normal AI.
 * Uses the brain's own random source, so local bots stay deterministic per seed.
 */
export function ruleBotInput(state: GameState, slot: number, rand: () => number, level: number): number {
  const me = state.fighters[slot];
  if (!me || me.stocks <= 0 || me.action === 'dead' || me.action === 'spawn' || me.hitlag > 0) return -1;
  if (state.boss?.slot === slot) return -1;
  const stage = getStage(state.cfg.stageId);
  const onStage = me.x > stage.main.x1 - 5 && me.x < stage.main.x2 + 5 && me.y <= stage.main.y + 5;
  if (!onStage || me.action === 'hitstun' || me.action === 'ledge' || me.action === 'grabbing' || me.action === 'grabbed') return -1;
  // holding a bomb: throw it at the nearest foe in range
  if (me.held) {
    const foe = nearestFoe(state, me);
    if (foe) {
      const dx = foe.x - me.x, adx = Math.abs(dx);
      if (adx > 60 && adx < 330 && Math.abs(foe.y - me.y) < 120 && rand() < 0.04 + level * 0.02) return (dx > 0 ? Btn.RIGHT : Btn.LEFT) | Btn.GRAB;
      if (adx < 60 && rand() < 0.05) return dx > 0 ? Btn.LEFT : Btn.RIGHT; // back off a bit first
    }
  }
  // go for a nearby useful item when no foe is in our face
  if (state.items?.length && me.grounded) {
    const foe = nearestFoe(state, me);
    const foeClose = foe && Math.abs(foe.x - me.x) < 90 && Math.abs(foe.y - me.y) < 80;
    let best: ItemState | null = null, bd = Infinity;
    for (const it of state.items) {
      if (it.t < 20 || (it.kind === 'bomb' && me.held)) continue;
      const want = it.kind === 'heal' ? me.damage > 40 : it.kind === 'mana' ? me.mana < 80 : true;
      if (!want) continue;
      const d = Math.abs(it.x - me.x) + Math.abs(it.y - me.y) * 2;
      if (d < bd) { bd = d; best = it; }
    }
    if (best && bd < 420 && !foeClose && rand() < 0.25 + level * 0.05) {
      const dx = best.x - me.x;
      const dir = dx > 0 ? Btn.RIGHT : Btn.LEFT;
      if (best.y < me.y - 40) return rand() < 0.2 ? dir | Btn.JUMP : dir;     // item on a platform above
      if (best.y > me.y + 40 && me.platform > 0) return Btn.DOWN;              // below: drop through
      if (Math.abs(dx) > 6) return dir;
    }
  }
  // spells-only: prefer magic, keep distance otherwise
  if (state.cfg.rules?.spellsOnly && me.mana >= 100) {
    const foe = nearestFoe(state, me);
    if (foe && Math.abs(foe.x - me.x) < 420 && rand() < 0.3) return Btn.MAGIC | (foe.x > me.x ? Btn.RIGHT : Btn.LEFT);
  }
  return -1;
}

function nearestFoe(state: GameState, me: FighterState): FighterState | null {
  let best: FighterState | null = null, bd = Infinity;
  for (const o of state.fighters) {
    if (o === me || o.stocks <= 0 || o.action === 'dead') continue;
    if (state.cfg.teams && o.team === me.team) continue;
    const d = Math.abs(o.x - me.x) + Math.abs(o.y - me.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

// ---- items in snapshots ------------------------------------------------------------------------------------------
export function encodeRules(s: GameState): unknown[] | undefined {
  if (!s.items && !s.boss) return undefined;
  return [s.items?.map((i) => [i.id, i.kind, i.plat, i.ox, i.t]) ?? null, s.boss ? [s.boss.hp, s.boss.dmg] : null];
}
export function applyRules(s: GameState, data: unknown) {
  if (!Array.isArray(data)) return;
  const [items, boss] = data as [unknown[][] | null, [number, number[]] | null];
  if (items) {
    const stage = getStage(s.cfg.stageId);
    const surfaces = [stage.main, ...stage.platforms.map((p) => platformPos(p, s.frame))];
    s.items = items.map((a) => {
      const sf = surfaces[a[2] as number] ?? stage.main;
      return { id: a[0] as number, kind: a[1] as ItemKind, plat: a[2] as number, ox: a[3] as number, x: sf.x1 + (a[3] as number), y: sf.y, t: a[4] as number };
    });
  }
  if (boss && s.boss) { s.boss.hp = boss[0]; s.boss.dmg = boss[1]; }
}

// ---- presets used by events / modes ---------------------------------------------------------------------------------
export type RuleMode = 'lowgrav' | 'spells' | 'giant' | 'stamina' | 'sudden' | 'items';
export const RULE_PRESETS: Record<RuleMode, MatchRules> = {
  lowgrav: { gravity: LOW_GRAVITY, items: true },
  spells: { spellsOnly: true },
  giant: { giant: true, items: true, itemKinds: ['heal', 'bomb', 'bubble'] },
  stamina: { stamina: 150, items: true, itemKinds: ['heal', 'bomb', 'bubble', 'boots'] },
  sudden: { suddenDeath: true, items: true, itemKinds: ['bomb'], itemEvery: 240 },
  items: { items: true, itemEvery: 240 },
};
export function presetRules(mode: RuleMode, seed: number): MatchRules {
  return { ...RULE_PRESETS[mode], seed: seed >>> 0 };
}
