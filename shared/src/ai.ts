import { Btn } from './input.ts';
import { getFighter } from './fighters.ts';
import { getStage } from './stages.ts';
import type { FighterState, GameState } from './types.ts';
import { ruleBotInput } from './rules.ts';

/** Per-bot memory so decisions can be held for a few frames (human-like). */
export interface BotBrain {
  level: number;          // 1..9
  hold: number;           // current input being held
  holdT: number;          // frames left to hold
  react: number;          // reaction delay counter
  targetSlot: number;
  rand: () => number;
}

export function createBrain(level: number, seed = Math.floor(Math.random() * 1e9)): BotBrain {
  let s = seed >>> 0 || 1;
  const rand = () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  return { level: Math.max(1, Math.min(9, level)), hold: 0, holdT: 0, react: 0, targetSlot: -1, rand };
}

export function botInput(state: GameState, slot: number, brain: BotBrain): number {
  const me = state.fighters[slot];
  if (!me || me.stocks <= 0 || me.action === 'dead') return 0;
  if (brain.holdT > 0) { brain.holdT--; return brain.hold; }

  const stage = getStage(state.cfg.stageId);
  const st = getFighter(me.charId).stats;
  const r = brain.rand;
  const lvl = brain.level;
  const hold = (bits: number, frames: number) => { brain.hold = bits; brain.holdT = frames; return bits; };

  // reaction delay: weaker bots think less often
  const thinkEvery = Math.max(1, 12 - lvl);
  if (state.frame % thinkEvery !== slot % thinkEvery && me.action !== 'ledge' && !offstage(me, stage)) return brain.hold & ~(Btn.ATTACK | Btn.SPECIAL | Btn.JUMP | Btn.STRONG | Btn.GRAB);

  if (me.action === 'spawn') return r() < 0.05 ? Btn.DOWN : 0;

  // match rules (items, spells-only, survival difficulty): see rules.ts
  if (state.cfg.rules) {
    if (state.sv && slot !== 0) brain.level = state.sv.level;
    const rb = ruleBotInput(state, slot, r, brain.level);
    if (rb >= 0) return hold(rb, rb & Btn.GRAB ? 2 : 4);
  }

  // magic: cast once the meter is full and a foe is near (smarter bots wait for a better moment)
  const mods = state.cfg.players[slot]?.mods;
  if (mods?.spell && me.mana >= 100 && me.hitlag <= 0 && me.action !== 'hitstun' && me.action !== 'ledge' && !offstage(me, stage)) {
    const foe = state.fighters.find((o) => o !== me && o.stocks > 0 && o.action !== 'dead' && (!state.cfg.teams || o.team !== me.team));
    const near = foe && Math.abs(foe.x - me.x) < (mods.spell === 'thunder' || mods.spell === 'shade' ? 600 : 160) && Math.abs(foe.y - me.y) < 140;
    const wantHeal = mods.spell === 'heal' && me.damage > 60;
    const wantAegis = mods.spell === 'aegis' && me.damage > 80;
    if ((near || wantHeal || wantAegis) && r() < 0.1 + lvl * 0.05) {
      if (foe) me.facing = foe.x >= me.x ? 1 : -1;
      return hold(Btn.MAGIC | (foe && foe.x > me.x ? Btn.RIGHT : Btn.LEFT), 2);
    }
  }

  // ---- recovery ----
  if (offstage(me, stage)) {
    const towards = me.x < 0 ? Btn.RIGHT : Btn.LEFT;
    if (me.action === 'helpless' || me.action === 'hitstun' && me.hitstun > 8) return towards;
    const below = me.y > stage.main.y - 20;
    if (me.jumps > 0 && (below || me.vy > 4) && r() < 0.6) return hold(towards | Btn.JUMP, 2) ;
    if (me.jumps === 0 && !me.usedRecovery && (me.y > stage.main.y + 30 || (me.vy > 2 && me.y > -40))) return hold(towards | Btn.UP | Btn.SPECIAL, 3);
    return towards;
  }
  if (me.action === 'ledge') {
    if (me.af < 10 + (9 - lvl) * 3) return 0;
    const opts = [Btn.JUMP, me.ledgeSide < 0 ? Btn.RIGHT : Btn.LEFT, Btn.ATTACK, Btn.SHIELD];
    return hold(opts[Math.floor(r() * opts.length)], 2);
  }
  if (me.action === 'grabbing') {
    const opts = [Btn.LEFT, Btn.RIGHT, Btn.UP, Btn.DOWN];
    return hold(opts[Math.floor(r() * opts.length)], 3);
  }
  if (me.action === 'grabbed') return state.frame % 4 === 0 ? (r() < 0.5 ? Btn.LEFT : Btn.RIGHT) | Btn.JUMP : 0;

  // ---- target selection ----
  let target: FighterState | null = null;
  let best = Infinity;
  for (const o of state.fighters) {
    if (o.slot === slot || o.stocks <= 0 || o.action === 'dead') continue;
    if (state.cfg.teams && o.team === me.team) continue;
    const d = Math.hypot(o.x - me.x, o.y - me.y) - (o.slot === brain.targetSlot ? 80 : 0);
    if (d < best) { best = d; target = o; }
  }
  if (!target) return 0;
  brain.targetSlot = target.slot;

  const dx = target.x - me.x;
  const dy = target.y - me.y;
  const adx = Math.abs(dx);
  const toward = dx > 0 ? Btn.RIGHT : Btn.LEFT;
  const away = dx > 0 ? Btn.LEFT : Btn.RIGHT;
  const facingTarget = Math.sign(dx) === me.facing;

  // ---- defence ----
  const threat = target.action === 'attack' && adx < 110 && Math.abs(dy) < 90 && target.af < 8;
  if (threat && me.grounded && r() < 0.06 * lvl) {
    const c = r();
    if (c < 0.5) return hold(Btn.SHIELD, 8 + Math.floor(r() * 10));
    if (c < 0.75) return hold(Btn.SHIELD | away, 2);
    return hold(Btn.JUMP | away, 4);
  }
  if (me.action === 'shield' && r() < 0.3) {
    if (adx < 60 && r() < 0.5) return Btn.SHIELD | Btn.GRAB;
    return 0;
  }

  // stay on stage: walk back to centre if near edge and target is offstage
  const margin = 70;
  if (me.grounded && (me.x < stage.main.x1 + margin && dx < 0 || me.x > stage.main.x2 - margin && dx > 0) && offstage(target, stage)) {
    // edgeguard: wait and throw out an attack when close
    if (adx < 120 && Math.abs(dy) < 120 && r() < 0.08 * lvl) return hold((dy < -40 ? Btn.UP : 0) | Btn.ATTACK | (facingTarget ? 0 : toward), 2);
    if (r() < 0.02 * lvl) return hold(Btn.SPECIAL, 2);
    return 0;
  }

  // ---- offence ----
  const inRange = adx < st.w + 50 && Math.abs(dy) < 70;
  const killPct = target.damage > 90 + (9 - lvl) * 6;
  if (inRange && r() < 0.1 + lvl * 0.06) {
    if (!me.grounded) {
      if (dy < -30) return hold(Btn.UP | Btn.ATTACK, 2);
      if (dy > 30) return hold(Btn.DOWN | Btn.ATTACK, 2);
      return hold((facingTarget ? toward : away) | Btn.ATTACK, 2);
    }
    if (target.action === 'shield' && r() < 0.6) return hold(Btn.GRAB, 2);
    if (killPct && r() < 0.6) {
      if (dy < -40) return hold(Btn.UP | Btn.STRONG, 10 + Math.floor(r() * 12));
      return hold(toward | Btn.STRONG, 6 + Math.floor(r() * 18));
    }
    const c = r();
    if (dy < -40) return hold(Btn.UP | Btn.ATTACK, 2);
    if (c < 0.25) return hold(Btn.ATTACK, 2);
    if (c < 0.5) return hold(toward | Btn.ATTACK, 2);
    if (c < 0.65) return hold(Btn.DOWN | Btn.ATTACK, 2);
    if (c < 0.8) return hold(Btn.GRAB, 2);
    return hold(Btn.JUMP, 3);
  }
  // ranged
  if (adx > 220 && adx < 520 && Math.abs(dy) < 60 && r() < 0.015 * lvl) {
    return hold((facingTarget ? 0 : toward) | Btn.SPECIAL, 2);
  }
  // approach
  if (dy < -90 && me.grounded && r() < 0.25) return hold(toward | Btn.JUMP, 6);
  if (!me.grounded && dy < -40 && me.jumps > 0 && me.vy > 0 && r() < 0.1) return hold(toward | Btn.JUMP, 2);
  if (adx > 160 && me.grounded && me.action !== 'run' && r() < 0.5) {
    // double-tap to dash
    return hold(toward, 3);
  }
  if (adx > st.w + 30) return toward | (me.action === 'run' ? 0 : 0);
  if (r() < 0.1) return hold(away, 6);
  return 0;
}

function offstage(f: FighterState, stage: ReturnType<typeof getStage>) {
  return f.x < stage.main.x1 - 5 || f.x > stage.main.x2 + 5 || f.y > stage.main.y + 5;
}
