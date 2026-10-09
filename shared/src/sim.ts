import { Btn, dirX, dirY } from './input.ts';
import { getFighter, type FighterDef } from './fighters.ts';
import { getStage, platformPos, type StageDef } from './stages.ts';
import { aegisFrames, getSpell, healAmount, MANA, spellProjectile } from './spells.ts';
import type {
  FighterMods, FighterState, GameEvent, GameState, Hitbox, MatchConfig, MoveDef, MoveId, ProjectileState,
} from './types.ts';

// ---- tuning -----------------------------------------------------------------
export const TICK_RATE = 60;
const LAUNCH = 0.12;          // knockback units -> px/frame
const LAUNCH_DECAY = 0.32;    // px/frame^2 launch speed decay
const HITSTUN = 0.4;          // frames per knockback unit
const SHIELD_MAX = 50;
const RESPAWN_FRAMES = 100;
const SPAWN_Y = -330;
const TAP_WINDOW = 4;
/** Frames of "3-2-1-GO" at match start during which inputs are ignored. */
export const COUNTDOWN = 180;
const AERIALS: MoveId[] = ['nair', 'fair', 'bair', 'uair', 'dair'];
const SPECIALS: MoveId[] = ['nspecial', 'sspecial', 'uspecial', 'dspecial'];
const SMASHES: MoveId[] = ['fsmash', 'usmash', 'dsmash'];
const EDGE_LOCKED = new Set(['attack', 'shield', 'roll', 'spotdodge', 'land', 'grabbing', 'shieldbreak', 'jumpsquat', 'ledgeclimb']);

type Plat = { x1: number; x2: number; y: number };

// ---- setup --------------------------------------------------------------------
export function createGame(cfg: MatchConfig): GameState {
  const stage = getStage(cfg.stageId);
  const fighters: FighterState[] = cfg.players.map((p, i) => {
    const [sx, sy] = stage.spawns[i % stage.spawns.length];
    return newFighter(i, p.charId, p.skin, cfg.teams ? p.team : i, p.name, sx, sy, cfg.stocks);
  });
  return {
    frame: 0, cfg, fighters, projectiles: [], nextId: 1,
    timer: cfg.timeLimit > 0 ? cfg.timeLimit * TICK_RATE : 0,
    over: false, winnerTeam: -1, endFrame: 0, events: [],
  };
}

function newFighter(slot: number, charId: string, skin: number, team: number, name: string, x: number, y: number, stocks: number): FighterState {
  const def = getFighter(charId);
  return {
    slot, charId: def.id, skin, team, name, x, y, vx: 0, vy: 0, kx: 0, ky: 0,
    facing: x > 0 ? -1 : 1, grounded: false, platform: -1, jumps: def.stats.airJumps,
    damage: 0, stocks, action: 'air', af: 0, move: null, charge: 0, hitIds: [], multiTick: 0,
    hitlag: 0, hitstun: 0, shield: SHIELD_MAX, shieldStun: 0, invuln: 0, intang: false,
    fastFall: false, dropThrough: 0, airdodged: false, usedRecovery: false, ledgeRegrab: 0, ledgeSide: 0,
    grabPartner: -1, respawn: 0, inp: 0, prev: 0, tapX: 0, tapY: 0, tapT: 0, lastHitBy: -1, lastHitMove: null,
    combo: 0, lag: 0, grabT: 0, ledgeGrabs: 0, usedSide: false,
    stats: { kos: 0, falls: 0, dmgDealt: 0, smashKOs: 0, maxCombo: 0 },
    mana: 0,
  };
}

const NEUTRAL: FighterMods = { atk: 1, def: 1, hp: 1 };
function modsOf(state: GameState, slot: number): FighterMods {
  return state.cfg.players[slot]?.mods ?? NEUTRAL;
}

export function cloneState(s: GameState): GameState {
  return structuredClone(s);
}

// ---- main step ----------------------------------------------------------------
export function step(state: GameState, inputs: ArrayLike<number>): void {
  state.events = [];
  if (state.over) { state.frame++; return; }
  const stage = getStage(state.cfg.stageId);
  const plats = stage.platforms.map((p) => platformPos(p, state.frame));
  const prevPlats = stage.platforms.map((p) => platformPos(p, state.frame - 1));

  const live = state.frame >= COUNTDOWN;
  for (const f of state.fighters) {
    f.prev = f.inp;
    f.inp = live ? inputs[f.slot] ?? 0 : 0;
    trackTaps(f);
  }
  for (const f of state.fighters) updateFighter(state, f, stage, plats, prevPlats);
  if (live) for (const f of state.fighters) updateMagic(state, f);
  pushApart(state, stage);
  updateProjectiles(state, stage, plats);
  resolveHits(state);
  checkBlastZones(state, stage);

  if (state.timer > 0 && live) {
    state.timer--;
    if (state.timer === 0) endByTime(state);
  }
  if (!state.over) checkEnd(state);
  state.frame++;
}

function trackTaps(f: FighterState) {
  const x = dirX(f.inp), px = dirX(f.prev);
  const y = dirY(f.inp), py = dirY(f.prev);
  if (f.tapT > 0) f.tapT--;
  else { f.tapX = 0; f.tapY = 0; }
  if (x !== 0 && x !== px) { f.tapX = x; f.tapY = 0; f.tapT = TAP_WINDOW; }
  if (y !== 0 && y !== py) { f.tapY = y; f.tapX = x !== px ? x : 0; f.tapT = TAP_WINDOW; }
}

/** Grounded fighters can't stand inside each other: gentle separation like platform fighters do. */
function pushApart(state: GameState, stage: StageDef) {
  const fs = state.fighters;
  for (let i = 0; i < fs.length; i++) {
    for (let j = i + 1; j < fs.length; j++) {
      const a = fs[i], b = fs[j];
      if (!a.grounded || !b.grounded || a.platform !== b.platform) continue;
      if (a.action === 'dead' || b.action === 'dead' || a.action === 'grabbed' || b.action === 'grabbed' || a.grabPartner === b.slot) continue;
      const wa = getFighter(a.charId).stats.w, wb = getFighter(b.charId).stats.w;
      const min = (wa + wb) * 0.4;
      const dx = b.x - a.x;
      if (Math.abs(dx) >= min) continue;
      const dir = dx === 0 ? (a.slot < b.slot ? 1 : -1) : Math.sign(dx);
      const push = Math.min(2.5, (min - Math.abs(dx)) * 0.25);
      const surf = a.platform === 0 ? stage.main : null;
      a.x -= dir * push; b.x += dir * push;
      if (surf) {
        a.x = Math.max(surf.x1, Math.min(surf.x2, a.x));
        b.x = Math.max(surf.x1, Math.min(surf.x2, b.x));
      }
    }
  }
}

const pressed = (f: FighterState, b: number) => (f.inp & b) !== 0 && (f.prev & b) === 0;
const held = (f: FighterState, b: number) => (f.inp & b) !== 0;

function setAction(f: FighterState, a: FighterState['action']) {
  f.action = a;
  f.af = 0;
  f.intang = false;
  if (a !== 'attack') { f.move = null; f.charge = 0; }
}

function startMove(state: GameState, f: FighterState, m: MoveId) {
  setAction(f, 'attack');
  f.move = m;
  f.charge = 0;
  f.hitIds = [];
  state.events.push({ t: 'swing', slot: f.slot, move: m });
}

function approach(v: number, target: number, step: number) {
  if (v < target) return Math.min(target, v + step);
  return Math.max(target, v - step);
}

// ---- fighter state machine ----------------------------------------------------
function updateFighter(state: GameState, f: FighterState, stage: StageDef, plats: Plat[], prevPlats: Plat[]) {
  if (f.action === 'dead') {
    if (f.stocks <= 0) return;
    if (--f.respawn <= 0) {
      f.x = 0; f.y = SPAWN_Y; f.vx = f.vy = f.kx = f.ky = 0; f.damage = 0;
      f.grounded = false; f.jumps = getFighter(f.charId).stats.airJumps;
      f.invuln = 150; f.shield = SHIELD_MAX; f.lastHitBy = -1;
      setAction(f, 'spawn');
      state.events.push({ t: 'spawn', slot: f.slot });
    }
    return;
  }
  if (f.hitlag > 0) { f.hitlag--; return; }
  if (f.invuln > 0) f.invuln--;
  if (f.ledgeRegrab > 0) f.ledgeRegrab--;
  if (f.dropThrough > 0) f.dropThrough--;
  f.af++;

  const def = getFighter(f.charId);
  const st = def.stats;
  const dx = dirX(f.inp), dy = dirY(f.inp);

  if (f.action !== 'shield' && f.action !== 'shieldbreak') f.shield = Math.min(SHIELD_MAX, f.shield + 0.08);

  switch (f.action) {
    case 'spawn': {
      f.vx = f.vy = 0;
      if (f.af > 150 || (f.af > 20 && f.inp !== 0 && f.inp !== f.prev)) setAction(f, 'air');
      return; // floats; skip physics
    }
    case 'idle': case 'walk': case 'run': case 'crouch': {
      if (groundActions(state, f, def)) break;
      if (dy > 0) {
        if (f.tapY === 1 && f.tapT === TAP_WINDOW && f.platform > 0) { // drop through soft platform
          f.grounded = false; f.platform = -1; f.dropThrough = 10; f.y += 2; setAction(f, 'air');
          break;
        }
        if (f.action !== 'crouch') setAction(f, 'crouch');
        f.vx = approach(f.vx, 0, st.traction);
      } else if (dx !== 0) {
        const dashing = f.action === 'run' && Math.sign(f.vx) === dx;
        if (dashing || (f.tapX === dx && f.tapT > 0 && f.action !== 'crouch')) {
          if (f.action !== 'run') setAction(f, 'run');
          f.facing = dx as 1 | -1;
          f.vx = approach(f.vx, dx * st.run, 1.3);
        } else {
          if (f.action !== 'walk') setAction(f, 'walk');
          f.facing = dx as 1 | -1;
          f.vx = approach(f.vx, dx * st.walk, 0.8);
        }
      } else {
        if (f.action !== 'idle') setAction(f, 'idle');
        f.vx = approach(f.vx, 0, st.traction);
      }
      break;
    }
    case 'jumpsquat': {
      f.vx = approach(f.vx, 0, st.traction * 0.5);
      if (f.af >= 3) {
        f.vy = held(f, Btn.JUMP) ? -st.jump : -st.shortHop;
        if (dx !== 0) f.vx = approach(f.vx, dx * st.airSpeed, 2);
        f.vx = Math.max(-st.airSpeed * 1.2, Math.min(st.airSpeed * 1.2, f.vx));
        f.grounded = false; f.platform = -1;
        setAction(f, 'air');
        state.events.push({ t: 'jump', slot: f.slot, x: f.x, y: f.y });
        // allow buffered aerial on the takeoff frame
        if (held(f, Btn.ATTACK) && pressedRecently(f)) airActions(state, f, def, true);
      }
      break;
    }
    case 'air': {
      if (airActions(state, f, def, false)) break;
      airDrift(f, st, dx, 1);
      if (dy > 0 && f.tapY === 1 && f.tapT === TAP_WINDOW && f.vy > -3) f.fastFall = true;
      break;
    }
    case 'helpless': {
      airDrift(f, st, dx, 0.7);
      break;
    }
    case 'land': {
      f.vx = approach(f.vx, 0, st.traction);
      if (--f.lag <= 0) setAction(f, 'idle');
      break;
    }
    case 'attack': updateAttack(state, f, def, dx, dy); break;
    case 'shield': {
      f.vx = approach(f.vx, 0, st.traction);
      if (f.shieldStun > 0) { f.shieldStun--; break; }
      if (!held(f, Btn.SHIELD)) { setAction(f, 'land'); f.lag = 7; break; }
      f.shield -= 0.14;
      if (f.shield <= 0) { breakShield(state, f); break; }
      if (pressed(f, Btn.JUMP)) { setAction(f, 'jumpsquat'); break; }
      if (pressed(f, Btn.GRAB) || pressed(f, Btn.ATTACK)) { startMove(state, f, 'grab'); break; }
      if (f.tapT === TAP_WINDOW && f.tapX !== 0) { f.facing = (-f.tapX) as 1 | -1; setAction(f, 'roll'); break; }
      if (f.tapT === TAP_WINDOW && f.tapY === 1) { setAction(f, 'spotdodge'); break; }
      break;
    }
    case 'shieldbreak': {
      f.vx = approach(f.vx, 0, st.traction);
      if (f.af === 1) { f.vy = -9; f.grounded = false; }
      if (f.af > 190 && f.grounded) { f.shield = 30; setAction(f, 'idle'); }
      break;
    }
    case 'roll': {
      f.intang = f.af >= 3 && f.af <= 16;
      f.vx = f.af <= 18 ? -f.facing * 8 : approach(f.vx, 0, 1);
      if (f.af >= 28) setAction(f, 'idle');
      break;
    }
    case 'spotdodge': {
      f.intang = f.af >= 3 && f.af <= 15;
      f.vx = approach(f.vx, 0, st.traction);
      if (f.af >= 22) setAction(f, 'idle');
      break;
    }
    case 'airdodge': {
      f.intang = f.af >= 3 && f.af <= 18;
      if (f.af > 10 && f.af < 30) { f.vx *= 0.9; f.vy = Math.min(f.vy + st.gravity * 0.5, st.fall); }
      if (f.af >= 30) setAction(f, 'air');
      break;
    }
    case 'hitstun': {
      if (f.grounded) f.kx *= 0.9;
      else airDrift(f, st, dx, 0.35);
      if (--f.hitstun <= 0) {
        f.hitstun = 0; f.combo = 0;
        setAction(f, f.grounded ? 'idle' : 'air');
      } else if (!f.grounded && f.hitstun < 999 && f.af > 8 && Math.hypot(f.kx, f.ky) < 4 && (pressed(f, Btn.ATTACK) || pressed(f, Btn.SPECIAL) || pressed(f, Btn.JUMP))) {
        // tumble cancel once launch speed is low and remaining hitstun is short
        if (f.hitstun < 10) { f.hitstun = 0; f.combo = 0; setAction(f, 'air'); airActions(state, f, def, false); }
      }
      break;
    }
    case 'ledge': {
      f.vx = f.vy = f.kx = f.ky = 0;
      const towards = -f.ledgeSide; // ledgeSide -1 = left ledge, fighter faces +1
      if (f.af < 8) break;
      if (f.af > 300) { dropFromLedge(f); break; }
      if (pressed(f, Btn.JUMP) || (f.tapY === -1 && f.tapT === TAP_WINDOW)) {
        f.vy = -st.jump * 1.05; f.vx = towards * 2; setAction(f, 'air'); f.ledgeRegrab = 20;
        state.events.push({ t: 'jump', slot: f.slot, x: f.x, y: f.y });
      } else if (pressed(f, Btn.ATTACK) || pressed(f, Btn.SPECIAL)) {
        climbOnto(f, stage); startMove(state, f, 'ledgeattack');
      } else if (pressed(f, Btn.SHIELD)) {
        climbOnto(f, stage); f.facing = (-towards) as 1 | -1; setAction(f, 'roll'); f.facing = (-towards) as 1 | -1;
      } else if ((dx === towards && f.tapX === towards) || pressed(f, Btn.GRAB)) {
        setAction(f, 'ledgeclimb');
      } else if (dx === -towards || (dy > 0 && f.tapY === 1)) {
        dropFromLedge(f);
      }
      return; // no physics while hanging
    }
    case 'ledgeclimb': {
      f.intang = f.af < 14;
      if (f.af === 12) climbOnto(f, stage);
      if (f.af < 12) return;
      if (f.af >= 22) setAction(f, 'idle');
      break;
    }
    case 'grabbing': {
      const v = state.fighters[f.grabPartner];
      if (!v || v.action !== 'grabbed') { setAction(f, 'idle'); f.grabPartner = -1; break; }
      v.x = f.x + f.facing * (st.w / 2 + getFighter(v.charId).stats.w / 2 - 4);
      v.y = f.y;
      if (f.af > 8) {
        let t: MoveId | null = null;
        if (dy < 0) t = 'uthrow'; else if (dy > 0) t = 'dthrow';
        else if (dx === f.facing) t = 'fthrow'; else if (dx === -f.facing) t = 'bthrow';
        if (!t && (pressed(f, Btn.ATTACK) || f.af > 90)) t = 'fthrow';
        if (t) { const p = f.grabPartner; startMove(state, f, t); f.grabPartner = p; }
      }
      break;
    }
    case 'grabbed': {
      f.vx = f.vy = f.kx = f.ky = 0;
      const a = state.fighters[f.grabPartner];
      if (!a || (a.action !== 'grabbing' && !(a.action === 'attack' && a.move && a.move.endsWith('throw')))) {
        f.grabPartner = -1; setAction(f, f.grounded ? 'idle' : 'air'); break;
      }
      if (f.inp !== f.prev && f.inp !== 0) f.grabT -= 6;
      if (--f.grabT <= 0 && a.action === 'grabbing') {
        f.grabPartner = -1; a.grabPartner = -1;
        setAction(f, 'air'); f.vy = -6; f.vx = -a.facing * -5; f.grounded = false;
        setAction(a, 'land'); a.lag = 18; a.vx = -a.facing * 4;
      }
      return;
    }
    default: break;
  }

  physics(state, f, def, stage, plats, prevPlats);
}

function pressedRecently(f: FighterState) {
  return (f.prev & Btn.ATTACK) === 0 || f.af <= 3;
}

function airDrift(f: FighterState, st: FighterDef['stats'], dx: number, mult: number) {
  const max = st.airSpeed * mult;
  if (dx !== 0) {
    if (Math.sign(f.vx) === dx && Math.abs(f.vx) > max) f.vx -= dx * 0.06;
    else f.vx = approach(f.vx, dx * max, st.airAccel * mult);
  } else f.vx = approach(f.vx, 0, 0.06);
}

function groundActions(state: GameState, f: FighterState, def: FighterDef): boolean {
  const dx = dirX(f.inp), dy = dirY(f.inp);
  if (pressed(f, Btn.JUMP)) { setAction(f, 'jumpsquat'); return true; }
  if (pressed(f, Btn.GRAB)) { startMove(state, f, 'grab'); return true; }
  if (pressed(f, Btn.SHIELD) || (held(f, Btn.SHIELD) && f.action !== 'run')) {
    if (f.tapT > 0 && f.tapX !== 0 && pressed(f, Btn.SHIELD)) {
      f.facing = (-f.tapX) as 1 | -1; setAction(f, 'roll'); return true;
    }
    setAction(f, 'shield'); return true;
  }
  if (pressed(f, Btn.SPECIAL)) return special(state, f, dx, dy);
  const strong = pressed(f, Btn.STRONG);
  if (pressed(f, Btn.ATTACK) || strong) {
    // smash attacks come only from the dedicated smash input (button / right stick): reliable on touch & keys
    const smash = strong || held(f, Btn.STRONG);
    if (smash) {
      const sy = dy, sx = dx;
      if (sy < 0) startMove(state, f, 'usmash');
      else if (sy > 0) startMove(state, f, 'dsmash');
      else { if (sx !== 0) f.facing = sx as 1 | -1; startMove(state, f, 'fsmash'); }
      return true;
    }
    // a real dash (not the first frames of a direction press) turns attack into a dash attack
    if (f.action === 'run' && f.af > 10 && Math.abs(f.vx) > getFighter(f.charId).stats.walk + 0.5) { startMove(state, f, 'dash'); return true; }
    if (dy < 0) startMove(state, f, 'utilt');
    else if (dy > 0) startMove(state, f, 'dtilt');
    else if (dx !== 0) { f.facing = dx as 1 | -1; startMove(state, f, 'ftilt'); }
    else startMove(state, f, 'jab');
    return true;
  }
  return false;
}

function special(state: GameState, f: FighterState, dx: number, dy: number): boolean {
  if (dy < 0) {
    if (f.usedRecovery) return false;
    f.usedRecovery = !f.grounded;
    if (dx !== 0) f.facing = dx as 1 | -1;
    startMove(state, f, 'uspecial');
  } else if (dy > 0) startMove(state, f, 'dspecial');
  else if (dx !== 0) {
    if (!f.grounded && f.usedSide) return false;
    f.usedSide = !f.grounded;
    f.facing = dx as 1 | -1; startMove(state, f, 'sspecial');
  } else startMove(state, f, 'nspecial');
  return true;
}

function airActions(state: GameState, f: FighterState, def: FighterDef, buffered: boolean): boolean {
  const dx = dirX(f.inp), dy = dirY(f.inp);
  const st = def.stats;
  if (!buffered && pressed(f, Btn.JUMP) && f.jumps > 0) {
    f.jumps--;
    f.vy = -st.airJump;
    f.vx = dx * st.airSpeed;
    f.fastFall = false;
    setAction(f, 'air');
    state.events.push({ t: 'jump', slot: f.slot, x: f.x, y: f.y });
    return true;
  }
  if (!buffered && pressed(f, Btn.SHIELD) && !f.airdodged) {
    f.airdodged = true;
    setAction(f, 'airdodge');
    if (dx !== 0 || dy !== 0) {
      const l = Math.hypot(dx, dy);
      f.vx = (dx / l) * 9; f.vy = (dy / l) * 9; f.fastFall = false;
    }
    return true;
  }
  if (!buffered && pressed(f, Btn.SPECIAL)) return special(state, f, dx, dy);
  if (pressed(f, Btn.ATTACK) || pressed(f, Btn.STRONG) || buffered) {
    let m: MoveId = 'nair';
    if (dy < 0) m = 'uair';
    else if (dy > 0) m = 'dair';
    else if (dx === f.facing) m = 'fair';
    else if (dx === -f.facing) m = 'bair';
    startMove(state, f, m);
    return true;
  }
  return false;
}

function updateAttack(state: GameState, f: FighterState, def: FighterDef, dx: number, dy: number) {
  const m = def.moves[f.move!];
  const st = def.stats;
  // smash charge: freeze on the charge frame while the button is held
  if (m.charge && f.af === m.charge.frame && (held(f, Btn.ATTACK) || held(f, Btn.STRONG)) && f.charge < m.charge.max) {
    f.charge++;
    f.af--;
  }
  if (f.move === 'jab' && m.cancel && f.af >= m.cancel && pressed(f, Btn.ATTACK)) {
    startMove(state, f, 'jab');
    return;
  }
  let velSet = false;
  for (const v of m.vel ?? []) {
    if (f.af >= v.s && f.af <= v.e) {
      if (v.vx !== undefined) f.vx = v.vx * f.facing;
      if (v.vy !== undefined) f.vy = v.vy;
      velSet = true;
    }
  }
  if (m.proj && f.af === m.proj.frame) {
    const pd = m.proj.def;
    const count = state.projectiles.filter((p) => p.owner === f.slot && p.kind === pd.kind).length;
    if (count < (m.proj.max ?? 1)) {
      state.projectiles.push({
        id: state.nextId++, owner: f.slot, team: f.team, kind: pd.kind,
        x: f.x + (pd.ox ?? 30) * f.facing, y: f.y + (pd.oy ?? -34),
        vx: pd.vx * f.facing, vy: pd.vy, life: pd.life, def: pd, hit: [], facing: f.facing,
      });
      state.events.push({ t: 'proj', slot: f.slot, kind: pd.kind });
    }
  }
  if (m.teleport && f.af === m.teleport.frame) {
    let tx = dx, ty = dy;
    if (tx === 0 && ty === 0) ty = -1;
    const l = Math.hypot(tx, ty);
    f.x += (tx / l) * m.teleport.dist;
    f.y += (ty / l) * m.teleport.dist;
    f.vx = 0; f.vy = 0;
    if (f.y < 0 || ty < 0) f.grounded = false;
  }
  if (m.groundPound) {
    if (f.af === 1 && f.grounded) { f.vy = -9; f.grounded = false; }
    if (f.af >= 6 && !f.grounded) { f.vy = 17; f.vx *= 0.8; velSet = true; if (f.af >= m.total - 2) f.af = m.total - 2; }
  }
  if (m.invuln) f.intang = f.af >= m.invuln[0] && f.af <= m.invuln[1];
  if (!f.grounded && !velSet) {
    if (!(m.noGravity && f.af >= m.noGravity[0] && f.af <= m.noGravity[1])) airDrift(f, st, dx, 0.9);
    if (dy > 0 && f.tapY === 1 && f.tapT === TAP_WINDOW && f.vy > -3 && AERIALS.includes(f.move!)) f.fastFall = true;
  }
  if (f.grounded && !velSet) f.vx = approach(f.vx, 0, st.traction);
  // multi-hit refresh
  for (const h of m.hitboxes) {
    if (h.multi && f.af >= h.s && f.af <= h.e && (f.af - h.s) % h.multi === 0) f.hitIds = [];
  }
  // throws release the victim at the hit frame
  if (m.throwHit && f.af === m.throwHit.s) {
    const v = state.fighters[f.grabPartner];
    if (v && v.action === 'grabbed') {
      v.grabPartner = -1;
      v.action = 'air';
      applyHit(state, f.slot, v, m.throwHit, f.facing, v.x, v.y - 30, f.move!, 1);
    }
    f.grabPartner = -1;
  }
  if (f.af >= m.total) {
    const helpless = m.helpless && !f.grounded;
    setAction(f, f.grounded ? 'idle' : helpless ? 'helpless' : 'air');
  }
}

function breakShield(state: GameState, f: FighterState) {
  f.shield = 0;
  setAction(f, 'shieldbreak');
  state.events.push({ t: 'shieldbreak', slot: f.slot });
}

function dropFromLedge(f: FighterState) {
  f.ledgeRegrab = 30;
  f.x += f.ledgeSide * 6;
  setAction(f, 'air');
}

function climbOnto(f: FighterState, stage: StageDef) {
  const st = getFighter(f.charId).stats;
  f.x = f.ledgeSide < 0 ? stage.main.x1 + st.w / 2 + 2 : stage.main.x2 - st.w / 2 - 2;
  f.y = stage.main.y;
  f.grounded = true; f.platform = 0; f.vx = f.vy = 0;
  f.facing = (-f.ledgeSide) as 1 | -1;
}

// ---- physics & collisions -------------------------------------------------------
function physics(state: GameState, f: FighterState, def: FighterDef, stage: StageDef, plats: Plat[], prevPlats: Plat[]) {
  const st = def.stats;
  const m = f.action === 'attack' && f.move ? def.moves[f.move] : null;
  const noGrav = (m?.noGravity && f.af >= m.noGravity[0] && f.af <= m.noGravity[1])
    || (f.action === 'airdodge' && f.af <= 10 && (f.vx !== 0 || f.vy !== 0));

  if (f.grounded && f.vy < 0) { f.grounded = false; f.platform = -1; }

  if (!f.grounded && !noGrav) {
    if (f.fastFall) f.vy = Math.max(f.vy, st.fastFall);
    else if (f.vy < st.fall) f.vy = Math.min(st.fall, f.vy + st.gravity);
  }

  // launch decay
  const kmag = Math.hypot(f.kx, f.ky);
  if (kmag > 0) {
    const nm = Math.max(0, kmag - LAUNCH_DECAY);
    f.kx *= nm / kmag; f.ky *= nm / kmag;
  }

  const px = f.x, py = f.y;

  // ride moving platforms
  if (f.grounded && f.platform > 0) {
    const a = plats[f.platform - 1], b = prevPlats[f.platform - 1];
    f.x += a.x1 - b.x1;
    f.y = a.y;
  }

  f.x += f.vx + f.kx;
  if (!f.grounded) f.y += f.vy + f.ky;

  const main = stage.main;
  if (f.grounded) {
    const surf = f.platform === 0 ? main : plats[f.platform - 1];
    if (!surf) { f.grounded = false; }
    else if (f.x < surf.x1 || f.x > surf.x2) {
      if (EDGE_LOCKED.has(f.action)) {
        f.x = Math.max(surf.x1, Math.min(surf.x2, f.x));
        f.vx = 0;
      } else {
        f.grounded = false; f.platform = -1;
        if (f.action === 'idle' || f.action === 'walk' || f.action === 'run' || f.action === 'crouch') setAction(f, 'air');
      }
    } else {
      f.y = surf.y;
    }
  }

  if (!f.grounded) {
    const vyTot = f.vy + f.ky;
    let landed = false;
    if (vyTot >= 0) {
      if (py <= main.y + 0.5 && f.y >= main.y && f.x >= main.x1 && f.x <= main.x2) {
        f.y = main.y; f.platform = 0; landed = true;
      } else if (f.dropThrough === 0 && f.action !== 'grabbed') {
        for (let i = 0; i < plats.length; i++) {
          const p = plats[i], pp = prevPlats[i];
          if (py <= pp.y + 0.5 && f.y >= p.y && f.x >= p.x1 && f.x <= p.x2) {
            // holding down while falling in tumble passes through
            f.y = p.y; f.platform = i + 1; landed = true; break;
          }
        }
      }
    }
    if (landed) onLand(state, f, def);
    else {
      // solid block sides / underside
      const half = st.w / 2;
      const bottom = main.y + main.depth;
      if (f.x + half > main.x1 && f.x - half < main.x2 && f.y > main.y + 1 && f.y - st.h < bottom) {
        if (py - st.h >= bottom - 1) {
          f.y = bottom + st.h; if (f.vy < 0) f.vy = 0; if (f.ky < 0) f.ky = -f.ky * 0.4;
        } else {
          const toLeft = Math.abs(f.x - main.x1) < Math.abs(f.x - main.x2);
          f.x = toLeft ? main.x1 - half : main.x2 + half;
          if (f.action === 'hitstun' && Math.abs(f.kx) > 6) f.kx = -f.kx * 0.5; else f.kx = 0;
          f.vx = 0;
        }
      }
      tryLedge(state, f, def, stage);
    }
  }
}

function onLand(state: GameState, f: FighterState, def: FighterDef) {
  const st = def.stats;
  const impact = f.vy + f.ky;
  if (f.action === 'hitstun' && f.hitstun > 0 && impact > 5) {
    if (held(f, Btn.SHIELD)) { // tech
      f.grounded = true; f.vy = 0; f.ky = 0; f.kx = 0;
      f.hitstun = 0; f.combo = 0; f.invuln = Math.max(f.invuln, 20);
      setAction(f, 'land'); f.lag = 12;
      resetAir(f, st);
      state.events.push({ t: 'land', slot: f.slot, x: f.x, y: f.y });
      return;
    }
    if (impact > 9) { // bounce
      f.ky = -Math.abs(f.ky) * 0.55; f.vy = -2; f.y -= 1; f.grounded = false; f.platform = -1;
      state.events.push({ t: 'land', slot: f.slot, x: f.x, y: f.y });
      return;
    }
  }
  f.grounded = true;
  f.vy = 0; f.ky = 0;
  resetAir(f, st);
  state.events.push({ t: 'land', slot: f.slot, x: f.x, y: f.y });
  switch (f.action) {
    case 'attack': {
      const mv = f.move!;
      const m = def.moves[mv];
      if (AERIALS.includes(mv)) { setAction(f, 'land'); f.lag = m.landLag ?? 8; }
      else if (m.groundPound) {
        setAction(f, 'land'); f.lag = m.landLag ?? 16;
        spawnShockwaves(state, f);
      } else if (SPECIALS.includes(mv) && !m.vel?.some((v) => v.vy !== undefined && v.vy > 0)) {
        if (mv === 'uspecial' || mv === 'nspecial' || mv === 'dspecial') {
          // keep the move going on the ground for neutral/down specials, end recoveries
          if (mv === 'uspecial') { setAction(f, 'land'); f.lag = 14; }
        }
      }
      break;
    }
    case 'helpless': setAction(f, 'land'); f.lag = 18; break;
    case 'airdodge': setAction(f, 'land'); f.lag = 10; break;
    case 'hitstun':
      if (f.hitstun > 0) { setAction(f, 'land'); f.lag = 26; f.kx *= 0.4; f.hitstun = 0; f.combo = 0; }
      else setAction(f, 'idle');
      break;
    case 'shieldbreak': case 'grabbed': break;
    default: setAction(f, 'land'); f.lag = 3;
  }
}

function resetAir(f: FighterState, st: FighterDef['stats']) {
  f.jumps = st.airJumps; f.airdodged = false; f.usedRecovery = false; f.usedSide = false;
  f.fastFall = false; f.ledgeGrabs = 0;
}

function spawnShockwaves(state: GameState, f: FighterState) {
  const def = getFighter(f.charId);
  const pow = def.archetype === 'heavy' ? 9 : 6;
  for (const dir of [-1, 1] as const) {
    state.projectiles.push({
      id: state.nextId++, owner: f.slot, team: f.team, kind: 'shock',
      x: f.x + dir * 20, y: f.y - 14, vx: dir * 7, vy: 0, life: 16, facing: dir, hit: [],
      def: { kind: 'shock', vx: 7, vy: 0, life: 16, r: 18, dmg: pow, ang: 70, bkb: 45, kbg: 45, pierce: true },
    });
  }
  state.events.push({ t: 'explode', x: f.x, y: f.y, r: 50 });
}

function tryLedge(state: GameState, f: FighterState, def: FighterDef, stage: StageDef) {
  if (f.ledgeRegrab > 0 || f.vy + f.ky < 0) return;
  if (!(f.action === 'air' || f.action === 'helpless' || (f.action === 'attack' && f.move === 'uspecial' && f.af > 10))) return;
  if (dirY(f.inp) > 0) return;
  const st = def.stats;
  const main = stage.main;
  for (const side of [-1, 1] as const) {
    const lx = side < 0 ? main.x1 : main.x2;
    const nearX = side < 0 ? f.x >= lx - st.w / 2 - 34 && f.x <= lx + 6 : f.x <= lx + st.w / 2 + 34 && f.x >= lx - 6;
    const top = f.y - st.h;
    if (!nearX || top < main.y - 40 || top > main.y + 26) continue;
    if (state.fighters.some((o) => o !== f && o.action === 'ledge' && o.ledgeSide === side)) continue;
    setAction(f, 'ledge');
    f.ledgeSide = side;
    f.facing = (-side) as 1 | -1;
    f.x = lx + side * (st.w / 2);
    f.y = main.y + st.h * 0.7;
    f.vx = f.vy = f.kx = f.ky = 0;
    f.jumps = st.airJumps; f.usedRecovery = false; f.usedSide = false; f.airdodged = false; f.fastFall = false;
    if (f.ledgeGrabs === 0) f.invuln = Math.max(f.invuln, 34);
    f.ledgeGrabs++;
    return;
  }
}

// ---- projectiles --------------------------------------------------------------------
function updateProjectiles(state: GameState, stage: StageDef, plats: Plat[]) {
  const main = stage.main;
  const keep: ProjectileState[] = [];
  for (const p of state.projectiles) {
    const d = p.def;
    if (d.gravity && !(d.mine && p.vx === 0 && p.vy === 0 && p.life < d.life - 2)) p.vy += d.gravity;
    p.x += p.vx; p.y += p.vy;
    p.life--;
    let dead = p.life <= 0;
    // ground interaction
    const surfaces: Plat[] = [main, ...plats];
    for (const s of surfaces) {
      if (p.vy >= 0 && p.x >= s.x1 && p.x <= s.x2 && p.y + d.r >= s.y && p.y + d.r - p.vy <= s.y + 2) {
        if (d.mine) { p.y = s.y - d.r; p.vx = 0; p.vy = 0; }
        else if (d.bounce) { p.y = s.y - d.r; p.vy = -Math.abs(p.vy) * 0.55; p.vx *= 0.8; if (Math.abs(p.vy) < 1.5) p.vy = 0; }
        else if (d.gravity) { dead = true; }
      }
    }
    if (!d.mine && !d.bounce && p.x > main.x1 && p.x < main.x2 && p.y > main.y + 6 && p.y < main.y + main.depth) dead = true;
    if (p.x < stage.blast.left || p.x > stage.blast.right || p.y > stage.blast.bottom || p.y < stage.blast.top) { p.life = 0; continue; }
    if (dead) {
      if (d.explode) explode(state, p);
      continue;
    }
    keep.push(p);
  }
  state.projectiles = keep;
}

function explode(state: GameState, p: ProjectileState) {
  const d = p.def;
  state.events.push({ t: 'explode', x: p.x, y: p.y, r: d.explode! });
  for (const v of state.fighters) {
    if (!canBeHit(state, v) || v.team === p.team && v.slot !== p.owner) continue;
    if (v.slot === p.owner) continue;
    const st = getFighter(v.charId).stats;
    if (circleRect(p.x, p.y, d.explode!, v.x - st.w / 2, v.y - st.h, st.w, st.h)) {
      const dirSign = v.x >= p.x ? 1 : -1;
      hitFighter(state, p.owner, v, { s: 0, e: 0, x: 0, y: 0, r: d.explode!, dmg: d.dmg, ang: d.ang, bkb: d.bkb, kbg: d.kbg, spell: p.kind.startsWith('sp_') }, dirSign, v.x, v.y - st.h / 2, null, false);
    }
  }
}

// ---- hit detection ---------------------------------------------------------------------
function canBeHit(_state: GameState, v: FighterState) {
  if (v.stocks <= 0 || v.action === 'dead' || v.action === 'spawn') return false;
  return v.invuln <= 0 && !v.intang;
}

function circleRect(cx: number, cy: number, r: number, rx: number, ry: number, rw: number, rh: number) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  return (cx - nx) ** 2 + (cy - ny) ** 2 <= r * r;
}

function resolveHits(state: GameState) {
  const teams = state.cfg.teams;
  for (const a of state.fighters) {
    if (a.action !== 'attack' || !a.move || a.hitlag > 0) continue;
    const def = getFighter(a.charId);
    const m = def.moves[a.move];
    for (const h of m.hitboxes) {
      if (a.af < h.s || a.af > h.e) continue;
      const hx = a.x + h.x * a.facing, hy = a.y + h.y;
      for (const v of state.fighters) {
        if (v === a || a.hitIds.includes(v.slot)) continue;
        if (teams && v.team === a.team) continue;
        if (!canBeHit(state, v)) continue;
        if (v.action === 'grabbed') continue;
        const vs = getFighter(v.charId).stats;
        if (!circleRect(hx, hy, h.r, v.x - vs.w / 2, v.y - vs.h, vs.w, vs.h)) continue;
        a.hitIds.push(v.slot);
        if (h.grab) {
          if (v.action === 'ledge' || !v.grounded && v.action !== 'shield') continue;
          if (a.action !== 'attack') continue;
          setAction(a, 'grabbing'); a.grabPartner = v.slot;
          setAction(v, 'grabbed'); v.grabPartner = a.slot; v.grabT = 70 + v.damage * 0.6;
          v.facing = (-a.facing) as 1 | -1; v.vx = v.vy = v.kx = v.ky = 0;
          break;
        }
        const sign = h.x === 0 ? (v.x >= a.x ? 1 : -1) : a.facing;
        hitFighter(state, a.slot, v, chargeScaled(h, a, m), sign, (hx + v.x) / 2, (hy + v.y - vs.h / 2) / 2, a.move, true);
      }
    }
  }
  // projectiles
  for (const p of state.projectiles) {
    if (p.life <= 0) continue;
    const d = p.def;
    if (d.mine && p.life > d.life - 30) continue; // arming time
    for (const v of state.fighters) {
      if (v.slot === p.owner || p.hit.includes(v.slot)) continue;
      if (teams && v.team === p.team) continue;
      if (!canBeHit(state, v)) continue;
      const vs = getFighter(v.charId).stats;
      if (!circleRect(p.x, p.y, d.r, v.x - vs.w / 2, v.y - vs.h, vs.w, vs.h)) continue;
      p.hit.push(v.slot);
      if (d.explode) { explode(state, p); p.life = 0; break; }
      const sign = d.wind ? (p.vx >= 0 ? 1 : -1) : (p.vx === 0 ? (v.x >= p.x ? 1 : -1) : Math.sign(p.vx));
      hitFighter(state, p.owner, v, { s: 0, e: 0, x: 0, y: 0, r: d.r, dmg: d.dmg, ang: d.ang, bkb: d.bkb, kbg: d.kbg, wind: d.wind, spell: p.kind.startsWith('sp_') }, sign, p.x, p.y, null, false);
      if (!d.pierce) { p.life = 0; break; }
    }
  }
  state.projectiles = state.projectiles.filter((p) => p.life > 0);
}

function chargeScaled(h: Hitbox, a: FighterState, m: MoveDef): Hitbox {
  if (!m.charge || a.charge <= 0) return h;
  return { ...h, dmg: Math.round(h.dmg * (1 + (a.charge / 60) * 0.4) * 10) / 10 };
}

/** Handles shield, counter and armour before applying a real hit. */
function hitFighter(state: GameState, atk: number, v: FighterState, h0: Hitbox, dirSign: number, x: number, y: number, move: MoveId | null, melee: boolean) {
  const a = state.fighters[atk];
  const vdef = getFighter(v.charId);
  const mul = (a && a !== v ? modsOf(state, atk).atk : 1) * modsOf(state, v.slot).def;
  const h = mul === 1 || !h0.dmg ? h0 : { ...h0, dmg: Math.round(h0.dmg * mul * 10) / 10 };
  // counter
  if (v.action === 'attack' && v.move) {
    const vm = vdef.moves[v.move];
    if (vm.counter && v.af >= vm.counter[0] && v.af <= vm.counter[1]) {
      state.events.push({ t: 'counter', slot: v.slot });
      v.invuln = Math.max(v.invuln, 24);
      if (melee && a) {
        v.facing = (a.x >= v.x ? 1 : -1);
        applyHit(state, v.slot, a, { s: 0, e: 0, x: 0, y: 0, r: 0, dmg: Math.max(8, h.dmg * 1.3), ang: 38, bkb: 60, kbg: 80 }, v.facing, a.x, a.y - 30, 'dspecial', 1);
      }
      v.af = vm.counter[1];
      return;
    }
  }
  if (v.action === 'shield' && !h.wind) {
    v.shield -= h.dmg * 1.15;
    v.shieldStun = Math.floor(h.dmg * 0.6) + 3;
    v.vx = dirSign * Math.min(8, 1 + h.dmg * 0.35);
    if (melee && a) a.hitlag = Math.min(12, Math.floor(h.dmg * 0.3 + 3));
    v.hitlag = Math.min(12, Math.floor(h.dmg * 0.3 + 3));
    state.events.push({ t: 'shieldhit', x, y, victim: v.slot });
    if (v.shield <= 0) breakShield(state, v);
    return;
  }
  if (v.action === 'attack' && v.move) {
    const vm = vdef.moves[v.move];
    if (vm.armor && v.af >= vm.armor[0] && v.af <= vm.armor[1] && !h.wind) {
      v.damage = Math.min(999, v.damage + h.dmg);
      const hl = Math.min(16, Math.floor(h.dmg * 0.38 + 4));
      v.hitlag = hl; if (melee && a) a.hitlag = hl;
      state.events.push({ t: 'hit', x, y, dmg: h.dmg, kb: 0, attacker: atk, victim: v.slot });
      if (a) a.stats.dmgDealt += h.dmg;
      return;
    }
  }
  applyHit(state, atk, v, h, dirSign, x, y, move, melee ? 1 : 0);
}

export function knockback(percentAfter: number, dmg: number, weight: number, bkb: number, kbg: number) {
  return (((percentAfter / 10 + (percentAfter * dmg) / 20) * (200 / (weight + 100)) * 1.4 + 18) * (kbg / 100)) + bkb;
}

function applyHit(state: GameState, atk: number, v: FighterState, h: Hitbox, dirSign: number, x: number, y: number, move: MoveId | null, meleeFlag: number) {
  const a = state.fighters[atk];
  const vdef = getFighter(v.charId);
  // release any grab
  if (v.grabPartner >= 0) {
    const p = state.fighters[v.grabPartner];
    if (p && p.grabPartner === v.slot) { p.grabPartner = -1; if (p.action === 'grabbed' || p.action === 'grabbing') setAction(p, p.grounded ? 'idle' : 'air'); }
    v.grabPartner = -1;
  }
  if (h.wind) {
    v.kx = dirSign * h.bkb * 0.12;
    v.ky = Math.min(v.ky, -1);
    if (v.grounded) v.ky = 0;
    return;
  }
  v.damage = Math.min(999, Math.round((v.damage + h.dmg) * 10) / 10);
  const kb = knockback(v.damage, h.dmg, vdef.stats.weight * modsOf(state, v.slot).hp, h.bkb, h.kbg);
  gainMana(state, v, h.dmg * MANA.perTaken);
  if (a && a !== v && !h.spell) gainMana(state, a, h.dmg * MANA.perDealt);
  let ang = (h.ang * Math.PI) / 180;
  let lx = Math.cos(ang) * dirSign, ly = -Math.sin(ang);
  // directional influence
  const ix = dirX(v.inp), iy = dirY(v.inp);
  if (ix !== 0 || iy !== 0) {
    const il = Math.hypot(ix, iy);
    const cross = lx * (iy / il) - ly * (ix / il);
    const rot = cross * 0.26;
    const nx = lx * Math.cos(rot) - ly * Math.sin(rot);
    const ny = lx * Math.sin(rot) + ly * Math.cos(rot);
    lx = nx; ly = ny;
  }
  const speed = kb * LAUNCH;
  v.kx = lx * speed;
  v.ky = ly * speed;
  v.vx = 0; v.vy = 0;
  if (v.grounded && v.ky > 0) {
    if (kb > 60) { v.ky = -v.ky * 0.8; } else v.ky = 0;
  }
  if (v.ky < -0.5) { v.grounded = false; v.platform = -1; }
  const wasStunned = v.action === 'hitstun' && v.hitstun > 0;
  setAction(v, 'hitstun');
  v.hitstun = Math.max(6, Math.floor(kb * HITSTUN));
  v.fastFall = false;
  v.lastHitBy = atk;
  v.lastHitMove = move;
  v.combo = wasStunned ? v.combo + 1 : 1;
  const hl = Math.min(20, Math.floor(h.dmg * 0.38 + 5));
  v.hitlag = hl;
  if (meleeFlag && a) a.hitlag = hl;
  if (a) {
    a.stats.dmgDealt += h.dmg;
    a.stats.maxCombo = Math.max(a.stats.maxCombo, v.combo);
  }
  state.events.push({ t: 'hit', x, y, dmg: h.dmg, kb, attacker: atk, victim: v.slot });
}

// ---- KO & match end ---------------------------------------------------------------------
function checkBlastZones(state: GameState, stage: StageDef) {
  const b = stage.blast;
  for (const f of state.fighters) {
    if (f.action === 'dead' || f.stocks <= 0) continue;
    const out = f.x < b.left || f.x > b.right || f.y > b.bottom || (f.y < b.top && (f.action === 'hitstun' || f.y < b.top - 200));
    if (!out) continue;
    f.stocks--;
    f.stats.falls++;
    const killer = f.lastHitBy;
    if (killer >= 0 && killer !== f.slot) {
      const k = state.fighters[killer];
      k.stats.kos++;
      if (f.lastHitMove && SMASHES.includes(f.lastHitMove)) k.stats.smashKOs++;
    }
    if (f.grabPartner >= 0) {
      const p = state.fighters[f.grabPartner];
      if (p) { p.grabPartner = -1; if (p.action === 'grabbed' || p.action === 'grabbing') setAction(p, 'air'); }
      f.grabPartner = -1;
    }
    state.events.push({
      t: 'ko', slot: f.slot, by: killer,
      x: Math.max(b.left, Math.min(b.right, f.x)), y: Math.max(b.top, Math.min(b.bottom, f.y)),
    });
    setAction(f, 'dead');
    f.respawn = RESPAWN_FRAMES;
    f.vx = f.vy = f.kx = f.ky = 0;
    f.hitstun = 0; f.combo = 0;
  }
}

function checkEnd(state: GameState) {
  const alive = new Set(state.fighters.filter((f) => f.stocks > 0).map((f) => f.team));
  if (alive.size <= 1) finish(state, alive.size === 1 ? [...alive][0] : -1);
}

function endByTime(state: GameState) {
  const score = new Map<number, { stocks: number; dmg: number }>();
  for (const f of state.fighters) {
    const s = score.get(f.team) ?? { stocks: 0, dmg: 0 };
    s.stocks += f.stocks; s.dmg += f.stocks > 0 ? f.damage : 0;
    score.set(f.team, s);
  }
  const ranked = [...score.entries()].sort((a, b) => b[1].stocks - a[1].stocks || a[1].dmg - b[1].dmg);
  const tie = ranked.length > 1 && ranked[0][1].stocks === ranked[1][1].stocks && ranked[0][1].dmg === ranked[1][1].dmg;
  finish(state, tie ? -1 : ranked[0][0]);
}

function finish(state: GameState, team: number) {
  state.over = true;
  state.winnerTeam = team;
  state.endFrame = state.frame;
  state.events.push({ t: 'end', winnerTeam: team });
}

/** Final placement per slot (1 = best) for rewards/ranking. */
export function placements(state: GameState): number[] {
  const order = [...state.fighters].sort((a, b) => {
    const aw = a.team === state.winnerTeam ? 1 : 0, bw = b.team === state.winnerTeam ? 1 : 0;
    return bw - aw || b.stocks - a.stocks || b.stats.kos - a.stats.kos || a.stats.falls - b.stats.falls || a.damage - b.damage;
  });
  const out: number[] = [];
  order.forEach((f, i) => { out[f.slot] = i + 1; });
  return out;
}

// ---- magic --------------------------------------------------------------------------------
function gainMana(state: GameState, f: FighterState, n: number) {
  if (!modsOf(state, f.slot).spell) return;
  f.mana = Math.min(100, Math.round((f.mana + n) * 100) / 100);
}

const NO_CAST = new Set(['hitstun', 'dead', 'spawn', 'grabbed', 'grabbing', 'ledge', 'ledgeclimb', 'shieldbreak', 'helpless']);

function updateMagic(state: GameState, f: FighterState) {
  const mods = modsOf(state, f.slot);
  const spell = getSpell(mods.spell);
  if (!spell || f.stocks <= 0 || f.action === 'dead') return;
  if (f.hitlag <= 0) gainMana(state, f, MANA.perFrame);
  if (!pressed(f, Btn.MAGIC) || f.mana < 100 || f.hitlag > 0 || NO_CAST.has(f.action)) return;
  f.mana = 0;
  const lv = mods.spellLv ?? 1;
  state.events.push({ t: 'spell', slot: f.slot, id: spell.id, x: f.x, y: f.y - 36 });
  if (spell.id === 'heal') { f.damage = Math.max(0, Math.round((f.damage - healAmount(lv)) * 10) / 10); return; }
  if (spell.id === 'aegis') { f.invuln = Math.max(f.invuln, aegisFrames(lv)); return; }
  const pd = spellProjectile(spell.id, lv);
  if (!pd) return;
  const foe = nearestFoe(state, f);
  let x = f.x + (pd.ox ?? 0) * f.facing, y = f.y + (pd.oy ?? 0), facing = f.facing;
  if (spell.id === 'thunder') {
    const tx = foe ? foe.x : f.x + 160 * f.facing;
    const ty = foe ? foe.y : f.y;
    x = tx; y = ty - 420;
  } else if (spell.id === 'shade' && foe) {
    const side = (foe.x >= f.x ? 1 : -1);
    f.x = foe.x + side * 46; f.y = foe.y - 2;
    f.facing = (-side) as 1 | -1; facing = f.facing;
    f.vx = f.vy = f.kx = f.ky = 0;
    x = foe.x; y = foe.y - 36;
  }
  state.projectiles.push({
    id: state.nextId++, owner: f.slot, team: f.team, kind: pd.kind,
    x, y, vx: pd.vx * facing, vy: pd.vy, life: pd.life, def: pd, hit: [], facing,
  });
}

function nearestFoe(state: GameState, f: FighterState): FighterState | null {
  let best: FighterState | null = null, bd = Infinity;
  for (const o of state.fighters) {
    if (o === f || o.stocks <= 0 || o.action === 'dead') continue;
    if (state.cfg.teams && o.team === f.team) continue;
    const d = Math.abs(o.x - f.x) + Math.abs(o.y - f.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}
