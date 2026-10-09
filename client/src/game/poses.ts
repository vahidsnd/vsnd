import { getFighter, type FighterState, type MoveId } from '@nb/shared';
import { drawFighter } from './art.ts';

// =============================================================================================
//  Victory poses: looping preview animations built from the regular fighter renderer.
// =============================================================================================

type Frame = { action: string; af: number; move?: MoveId | null; vy?: number; jumps?: number; dy: number; rot: number; sx: number; shake: number };

function poseFrame(pose: string, t: number, airJumps: number, h: number): Frame {
  const base: Frame = { action: 'idle', af: Math.floor(t * 60), dy: 0, rot: 0, sx: 1, shake: 0 };
  switch (pose) {
    case 'flip': {          // jump, full back-flip, land, breathe
      const T = 1.9, k = (t % T) / T;
      if (k < 0.45) {
        const u = k / 0.45;
        return { ...base, action: 'air', vy: u < 0.5 ? -3 : 2, jumps: airJumps, dy: -Math.sin(u * Math.PI) * h * 0.75, rot: -u * Math.PI * 2 };
      }
      if (k < 0.55) return { ...base, action: 'land', af: 0, dy: 0 };
      return base;
    }
    case 'taunt': {         // up-smash flourish then a confident idle
      const T = 2.0, k = (t % T);
      if (k < 0.75) return { ...base, action: 'attack', move: 'usmash', af: Math.floor(k * 60) };
      return base;
    }
    case 'leap': {          // big leap with arms up, squash on landing
      const T = 1.6, k = (t % T) / T;
      if (k < 0.6) { const u = k / 0.6; return { ...base, action: 'air', vy: u < 0.5 ? -4 : 2, jumps: airJumps, dy: -Math.sin(u * Math.PI) * h * 0.9 }; }
      if (k < 0.72) return { ...base, action: 'land', af: 0 };
      return { ...base, action: 'jumpsquat', af: 0 };
    }
    case 'spin': {          // whirlwind: horizontal spin in place
      const T = 1.4, k = (t % T) / T;
      return { ...base, action: k < 0.7 ? 'air' : 'idle', vy: -2, jumps: airJumps, sx: k < 0.7 ? Math.cos(k / 0.7 * Math.PI * 4) : 1, dy: k < 0.7 ? -Math.sin(k / 0.7 * Math.PI) * h * 0.25 : 0 };
    }
    case 'stomp': {         // down-smash slam with a screen shake
      const T = 1.8, k = (t % T);
      if (k < 0.7) return { ...base, action: 'attack', move: 'dsmash', af: Math.floor(k * 60), shake: k > 0.2 && k < 0.45 ? 3 : 0 };
      return base;
    }
    default:                // classic: hover in the air pose (original results look)
      return { ...base, action: 'air', vy: -2, jumps: airJumps, dy: -Math.abs(Math.sin(t * 2.4)) * h * 0.12 };
  }
}

/** Draws one frame of a victory pose with the feet at (x, y). */
export function drawPose(ctx: CanvasRenderingContext2D, charId: string, skin: number, pose: string, x: number, y: number, scale: number, time: number) {
  const def = getFighter(charId);
  const fr = poseFrame(pose, time, def.stats.airJumps, def.stats.h);
  const moves = def.moves as Record<string, { total: number }>;
  const af = fr.move && moves[fr.move] ? Math.min(fr.af, moves[fr.move].total - 1) : fr.af;
  const f = {
    slot: 0, charId, x: 0, y: 0, facing: 1, action: fr.action, af, grounded: fr.action !== 'air', vy: fr.vy ?? 0,
    kx: 0, ky: 0, intang: false, invuln: 0, hitlag: 0, jumps: fr.jumps ?? def.stats.airJumps, move: fr.move ?? null, charge: 0,
    shield: 50, shieldStun: 0, lag: fr.action === 'land' ? 8 : 0,
  } as unknown as FighterState;
  ctx.save();
  ctx.translate(x + (fr.shake ? (Math.random() - 0.5) * fr.shake * 2 : 0), y);
  ctx.scale(scale, scale);
  // soft floor shadow
  const sh = Math.max(0.35, 1 + fr.dy / (def.stats.h * 1.4));
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(0, 2, def.stats.w * 0.7 * sh, 5 * sh, 0, 0, Math.PI * 2); ctx.fill();
  ctx.translate(0, fr.dy);
  if (fr.rot || fr.sx !== 1) {
    ctx.translate(0, -def.stats.h / 2);
    ctx.rotate(fr.rot);
    ctx.scale(Math.abs(fr.sx) < 0.08 ? 0.08 * Math.sign(fr.sx || 1) : fr.sx, 1);
    ctx.translate(0, def.stats.h / 2);
  }
  drawFighter(ctx, f, skin, { color: '#fff', time });
  ctx.restore();
}

/** Animated victory-pose canvas (stops itself when removed from the page). */
export function poseCanvas(charId: string, skin: number, size: number, pose: string) {
  const q = Math.min(2, window.devicePixelRatio || 1);
  const c = document.createElement('canvas');
  c.className = 'fcanvas pose-canvas';
  c.width = Math.round(size * q); c.height = Math.round(size * q);
  c.style.width = `${size}px`; c.style.height = `${size}px`;
  const ctx = c.getContext('2d')!;
  const def = getFighter(charId);
  const scale = (c.width * 0.5) / (def.stats.h + 30);
  const t0 = performance.now();
  let seen = false, waited = 0, last = 0;
  const loop = (now: number) => {
    if (!c.isConnected) { if (seen || ++waited > 90) return; requestAnimationFrame(loop); return; }
    seen = true;
    if (now - last >= 33) {
      last = now;
      ctx.clearRect(0, 0, c.width, c.height);
      drawPose(ctx, charId, skin, pose, c.width / 2, c.height * 0.9, scale, (now - t0) / 1000);
    }
    requestAnimationFrame(loop);
  };
  ctx.clearRect(0, 0, c.width, c.height);
  drawPose(ctx, charId, skin, pose, c.width / 2, c.height * 0.9, scale, 0);
  requestAnimationFrame(loop);
  return c;
}
