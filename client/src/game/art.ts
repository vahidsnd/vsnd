import { getFighter, type FighterDef, type FighterState, type Hitbox, type ProjectileState } from '@nb/shared';

/**
 * Art direction: "Neon Sticker"
 *  – chunky, rounded characters with a thick ink outline (like vinyl stickers)
 *  – flat colour fills + one highlight, and a neon rim/glow colour per skin
 *  – limbs are floating hands/feet (no arms/legs) so every pose reads instantly;
 *    the lead limb of an attack is placed exactly on the move's hitbox, so what you see is what hits.
 */
export const INK = '#140b24';
export const PLAYER_COLORS = ['#ff4f6d', '#3fa9ff', '#ffd23f', '#3ee089'];

type V = { x: number; y: number };
interface Pose {
  lean: number; sx: number; sy: number; by: number; spin: number;
  hf: V; hb: V; ff: V; fb: V;   // hands / feet (front / back), local coords facing right, feet origin
  lead?: 'hf' | 'hb' | 'ff' | 'fb';
  swoosh?: { x: number; y: number; r: number; a: number }[];
  eyes: 'open' | 'hurt' | 'focus' | 'closed';
  sword?: number; // angle of sword for swordie
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpV = (a: V, b: V, t: number): V => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const ease = (t: number) => 1 - (1 - t) * (1 - t);

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  r = f(r); g = f(g); b = f(b);
  return `rgb(${r},${g},${b})`;
}

function computePose(f: FighterState, def: FighterDef, time: number): Pose {
  const { w, h } = def.stats;
  const rest: Pose = {
    lean: 0, sx: 1, sy: 1, by: 0, spin: 0,
    hf: { x: w * 0.55, y: -h * 0.42 }, hb: { x: -w * 0.45, y: -h * 0.45 },
    ff: { x: w * 0.22, y: -3 }, fb: { x: -w * 0.22, y: -3 },
    eyes: 'open', sword: -0.6,
  };
  const p = { ...rest };
  const t = f.af;
  switch (f.action) {
    case 'idle': case 'spawn': {
      const b = Math.sin(time * 4 + f.slot) * 0.03;
      p.sy = 1 + b; p.sx = 1 - b;
      p.hf = { x: w * 0.55, y: -h * 0.42 + Math.sin(time * 4) * 2 };
      p.hb = { x: -w * 0.48, y: -h * 0.44 - Math.sin(time * 4) * 2 };
      break;
    }
    case 'walk': case 'run': {
      const sp = f.action === 'run' ? 0.45 : 0.28;
      const c = Math.sin(t * sp);
      const amp = f.action === 'run' ? 1 : 0.6;
      p.lean = f.action === 'run' ? 0.22 : 0.08;
      p.ff = { x: c * w * 0.45 * amp, y: -3 - Math.max(0, -c) * 10 * amp };
      p.fb = { x: -c * w * 0.45 * amp, y: -3 - Math.max(0, c) * 10 * amp };
      p.hf = { x: w * 0.4 - c * 10 * amp, y: -h * 0.42 };
      p.hb = { x: -w * 0.4 + c * 10 * amp, y: -h * 0.45 };
      p.by = -Math.abs(c) * 3 * amp;
      break;
    }
    case 'crouch': p.sy = 0.72; p.sx = 1.15; p.hf = { x: w * 0.5, y: -h * 0.25 }; p.hb = { x: -w * 0.45, y: -h * 0.28 }; break;
    case 'jumpsquat': p.sy = 0.8; p.sx = 1.15; break;
    case 'land': { const k = clamp01(f.lag / 10); p.sy = 1 - 0.18 * k; p.sx = 1 + 0.12 * k; p.hf.y += 8 * k; p.hb.y += 8 * k; break; }
    case 'air': case 'helpless': {
      const up = f.vy < 0;
      p.sy = up ? 1.08 : 0.98; p.sx = up ? 0.94 : 1.02;
      p.ff = { x: w * 0.25, y: up ? -14 : -4 };
      p.fb = { x: -w * 0.2, y: up ? -6 : -10 };
      p.hf = { x: w * 0.55, y: -h * (up ? 0.62 : 0.5) };
      p.hb = { x: -w * 0.55, y: -h * (up ? 0.62 : 0.5) };
      if (f.action === 'helpless') { p.spin = 0; p.eyes = 'closed'; }
      if (f.jumps < def.stats.airJumps && f.af < 18 && f.vy < 0) p.spin = (f.af / 18) * Math.PI * 2 * (def.archetype === 'aerial' ? 1 : 0); // flip on double jump
      break;
    }
    case 'shield': p.sy = 0.92; p.hf = { x: w * 0.3, y: -h * 0.55 }; p.hb = { x: w * 0.1, y: -h * 0.5 }; p.eyes = 'focus'; break;
    case 'shieldbreak': p.spin = 0; p.lean = Math.sin(time * 8) * 0.2; p.eyes = 'hurt'; break;
    case 'roll': p.spin = -(t / 28) * Math.PI * 2; p.sy = 0.8; break;
    case 'spotdodge': p.sx = 0.8; p.sy = 1.1; break;
    case 'airdodge': p.spin = 0; p.sx = 0.9; break;
    case 'hitstun': {
      p.eyes = 'hurt';
      const speed = Math.hypot(f.kx, f.ky);
      if (!f.grounded && speed > 5) p.spin = t * 0.35;
      p.hf = { x: w * 0.6, y: -h * 0.75 }; p.hb = { x: -w * 0.6, y: -h * 0.75 };
      p.ff = { x: w * 0.35, y: -8 }; p.fb = { x: -w * 0.35, y: -2 };
      break;
    }
    case 'ledge': p.hf = { x: w * 0.55, y: -h * 0.98 }; p.hb = { x: w * 0.35, y: -h * 1.02 }; p.ff = { x: 6, y: -2 }; p.fb = { x: -4, y: -8 }; break;
    case 'ledgeclimb': p.sy = 0.9; p.lean = 0.2; break;
    case 'grabbing': p.hf = { x: w * 0.75, y: -h * 0.45 }; p.hb = { x: w * 0.6, y: -h * 0.5 }; p.eyes = 'focus'; break;
    case 'grabbed': p.eyes = 'hurt'; p.lean = -0.1; p.hf.y -= 10; p.hb.y -= 10; break;
    case 'attack': attackPose(p, rest, f, def); break;
  }
  return p;
}

function attackPose(p: Pose, rest: Pose, f: FighterState, def: FighterDef) {
  const m = def.moves[f.move!];
  const { h } = def.stats;
  p.eyes = 'focus';
  const t = f.af;
  // charging smash: tremble + glow handled by renderer
  const hbs: Hitbox[] = m.hitboxes.length ? m.hitboxes : (m.throwHit ? [m.throwHit] : []);
  if (!hbs.length) {
    // projectile / counter / teleport poses
    const k = clamp01(t / Math.max(1, (m.proj?.frame ?? 10)));
    p.hf = lerpV(rest.hf, { x: def.stats.w * 0.95, y: -h * 0.5 }, ease(k));
    if (m.counter) { p.hf = { x: def.stats.w * 0.2, y: -h * 0.8 }; p.hb = { x: def.stats.w * 0.4, y: -h * 0.5 }; p.sword = -1.4; }
    if (m.teleport) { p.sx = t < m.teleport.frame ? 1 - t / m.teleport.frame : 1; p.sy = 1 / Math.max(0.3, p.sx); }
    return;
  }
  // choose the active hitbox, or the next one, or the last
  let hb = hbs.find((x) => t >= x.s && t <= x.e);
  const active = !!hb;
  if (!hb) hb = hbs.find((x) => t < x.s) ?? hbs[hbs.length - 1];
  const low = hb.y > -h * 0.3;
  const behind = hb.x < -4;
  const lead: Pose['lead'] = low ? (behind ? 'fb' : 'ff') : behind ? 'hb' : 'hf';
  p.lead = lead;
  const target: V = { x: hb.x, y: hb.y };
  if (Math.abs(hb.x) < 4 && hb.y < -h * 0.8) target.x = 6; // ups: slight forward arc
  const windup: V = { x: -target.x * 0.35 + (behind ? 8 : -8), y: target.y * 0.6 + (low ? -10 : 0) };
  let pos: V;
  if (t < hb.s) pos = lerpV(rest[lead], windup, ease(clamp01(t / hb.s)));
  else if (t <= hb.e) {
    const k = (t - hb.s) / Math.max(1, hb.e - hb.s);
    pos = lerpV(windup, target, ease(clamp01(k * 3)));
  } else pos = lerpV(target, rest[lead], ease(clamp01((t - hb.e) / Math.max(1, m.total - hb.e))));
  p[lead] = pos;
  // body language
  const dirLean = behind ? -0.2 : hb.y < -h * 0.85 ? -0.05 : 0.18;
  p.lean = t < hb.s ? -dirLean * 0.6 : dirLean;
  if (f.move === 'nair' || f.move === 'dspecial' && def.archetype === 'aerial') p.spin = t * 0.5;
  if (f.move === 'dsmash' && active) { p.hf = { x: hbs[0].x, y: hbs[0].y }; p.hb = { x: hbs[1]?.x ?? -hbs[0].x, y: hbs[0].y }; }
  if (low && lead === 'ff') p.lean -= 0.1;
  p.sword = Math.atan2(pos.y - (-h * 0.45), pos.x) ;
  if (active) p.swoosh = (m.hitboxes.filter((x) => t >= x.s && t <= x.e)).map((x) => ({ x: x.x, y: x.y, r: x.r, a: 1 - (t - x.s) / Math.max(1, x.e - x.s + 1) }));
  if (m.groundPound && !f.grounded) { p.sy = 1.15; p.sx = 0.85; p.ff = { x: 6, y: 4 }; p.fb = { x: -6, y: 4 }; }
}

export interface DrawOpts { color: string; time: number; showTag?: string; alpha?: number; flash?: number }

export function drawFighter(ctx: CanvasRenderingContext2D, f: FighterState, skinIdx: number, o: DrawOpts) {
  const def = getFighter(f.charId);
  const skin = def.skins[skinIdx] ?? def.skins[0];
  const { w, h } = def.stats;
  const pose = computePose(f, def, o.time);

  ctx.save();
  let alpha = o.alpha ?? 1;
  if (f.intang) alpha *= 0.45;
  if (f.invuln > 0 && f.action !== 'ledge') alpha *= (Math.floor(o.time * 20) % 2 ? 0.55 : 0.9);
  ctx.globalAlpha = alpha;

  let sx = 0;
  if (f.hitlag > 0 && f.action === 'hitstun') sx = (Math.random() - 0.5) * 6;
  ctx.translate(f.x + sx, f.y);

  // ground shadow
  if (f.grounded) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(0, 2, w * 0.6, 5, 0, 0, Math.PI * 2); ctx.fill();
  }

  ctx.scale(f.facing, 1);
  // pivot around body centre for spin / lean
  ctx.translate(0, -h * 0.5 + pose.by);
  ctx.rotate(pose.spin + pose.lean);
  ctx.scale(pose.sx, pose.sy);
  ctx.translate(0, h * 0.5);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = INK;

  // charge glow
  const m = f.action === 'attack' && f.move ? def.moves[f.move] : null;
  const charging = !!(m?.charge && f.charge > 0 && f.af === m.charge.frame);
  if (charging) {
    ctx.shadowColor = skin.glow;
    ctx.shadowBlur = 18 + Math.sin(o.time * 40) * 8;
  }

  // swooshes behind body
  if (pose.swoosh) {
    for (const s of pose.swoosh) drawSwoosh(ctx, s.x, s.y, s.r, s.a, skin.glow);
  }

  const back = (lead: 'hb' | 'fb') => drawLimb(ctx, pose[lead], lead[0] === 'h', def, skin, true, pose.lead === lead);
  back('fb'); back('hb');
  drawBody(ctx, def, skin, w, h, pose, o.time, f);
  drawLimb(ctx, pose.ff, false, def, skin, false, pose.lead === 'ff');
  if (def.look.body === 'ninja') drawSword(ctx, pose.hf, pose.sword ?? -0.6, skin, f.action === 'attack');
  drawLimb(ctx, pose.hf, true, def, skin, false, pose.lead === 'hf');

  ctx.shadowBlur = 0;
  // damage flash
  if (o.flash && o.flash > 0) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(255,255,255,${o.flash})`;
    ctx.fillRect(-w * 2, -h * 2, w * 4, h * 3);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();

  // shield bubble (not rotated)
  if (f.action === 'shield') {
    const r = (Math.max(w, h) * 0.62) * (0.45 + 0.55 * (f.shield / 50));
    ctx.save();
    ctx.globalAlpha = 0.35 + (f.shieldStun > 0 ? 0.25 : 0);
    ctx.fillStyle = o.color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(f.x, f.y - h * 0.5, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  if (f.action === 'shieldbreak') drawDizzy(ctx, f.x, f.y - h - 12, o.time);

  // player tag
  if (o.showTag && f.action !== 'dead') {
    ctx.save();
    ctx.fillStyle = o.color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    const ty = f.y - h - 20;
    ctx.beginPath(); ctx.moveTo(f.x - 7, ty - 8); ctx.lineTo(f.x + 7, ty - 8); ctx.lineTo(f.x, ty); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.font = 'bold 13px Vazirmatn, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeText(o.showTag, f.x, ty - 12);
    ctx.fillText(o.showTag, f.x, ty - 12);
    ctx.restore();
  }
}

function drawSwoosh(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a: number, glow: string) {
  ctx.save();
  ctx.globalAlpha *= 0.25 + 0.6 * a;
  const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 1.15);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.45, glow);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r * 1.15, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawLimb(ctx: CanvasRenderingContext2D, p: V, hand: boolean, def: FighterDef, skin: FighterDef['skins'][number], back: boolean, lead: boolean) {
  const big = def.look.body === 'golem';
  const r = hand ? (big ? 13 : def.look.body === 'imp' ? 6 : 8) : (big ? 10 : def.look.body === 'imp' ? 6 : 8);
  ctx.save();
  ctx.fillStyle = back ? shade(hand ? skin.main : skin.second, -0.25) : hand ? skin.main : skin.second;
  if (def.look.body === 'bird' && hand) {
    ctx.beginPath(); ctx.ellipse(p.x, p.y, r * 1.6, r * 0.8, -0.5, 0, Math.PI * 2);
  } else if (!hand) {
    ctx.beginPath(); ctx.ellipse(p.x, p.y - r * 0.5, r * 1.25, r * 0.8, 0, 0, Math.PI * 2);
  } else {
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  }
  if (lead) { ctx.shadowColor = skin.glow; ctx.shadowBlur = 14; }
  ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawSword(ctx: CanvasRenderingContext2D, hand: V, ang: number, skin: FighterDef['skins'][number], active: boolean) {
  ctx.save();
  ctx.translate(hand.x, hand.y);
  ctx.rotate(ang);
  ctx.lineWidth = 3.5;
  ctx.fillStyle = active ? '#ffffff' : '#dfe8ff';
  if (active) { ctx.shadowColor = skin.glow; ctx.shadowBlur = 16; }
  ctx.beginPath();
  ctx.moveTo(4, -3); ctx.lineTo(52, -2); ctx.lineTo(60, 0); ctx.lineTo(52, 3); ctx.lineTo(4, 3); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = skin.second;
  ctx.fillRect(-2, -7, 6, 14); ctx.strokeRect(-2, -7, 6, 14);
  ctx.restore();
}

function eyes(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, mode: Pose['eyes'], time: number, gap = r * 2.2, slot = 0) {
  const blink = (Math.floor(time * 10 + slot * 7) % 37) === 0;
  for (const dx of [0, gap]) {
    const ex = x + dx;
    if (mode === 'hurt') {
      ctx.save(); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(ex - r * 0.7, y - r * 0.7); ctx.lineTo(ex + r * 0.7, y + r * 0.7);
      ctx.moveTo(ex + r * 0.7, y - r * 0.7); ctx.lineTo(ex - r * 0.7, y + r * 0.7); ctx.stroke(); ctx.restore();
      continue;
    }
    if (mode === 'closed' || blink) {
      ctx.save(); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(ex - r * 0.8, y); ctx.lineTo(ex + r * 0.8, y); ctx.stroke(); ctx.restore();
      continue;
    }
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(ex, y, r * 0.85, r * (mode === 'focus' ? 0.75 : 1.05), 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.arc(ex + r * 0.25, y + (mode === 'focus' ? 0 : 1), r * 0.45, 0, Math.PI * 2); ctx.fill();
    if (mode === 'focus') { ctx.save(); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(ex - r, y - r * 1.1); ctx.lineTo(ex + r, y - r * 0.6); ctx.stroke(); ctx.restore(); }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function highlight(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, -0.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawBody(ctx: CanvasRenderingContext2D, def: FighterDef, skin: FighterDef['skins'][number], w: number, h: number, pose: Pose, time: number, f: FighterState) {
  const main = skin.main, second = skin.second, glow = skin.glow;
  switch (def.look.body) {
    case 'fox': {
      // tail
      const sway = Math.sin(time * 5) * 0.25;
      ctx.save(); ctx.translate(-w * 0.35, -h * 0.3); ctx.rotate(-0.9 + sway);
      ctx.fillStyle = main; ctx.beginPath(); ctx.ellipse(0, -18, 11, 22, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = second; ctx.beginPath(); ctx.ellipse(0, -34, 7, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // torso
      ctx.fillStyle = main; ctx.beginPath(); ctx.ellipse(0, -h * 0.3, w * 0.42, h * 0.27, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = second; ctx.beginPath(); ctx.ellipse(w * 0.12, -h * 0.28, w * 0.2, h * 0.17, 0, 0, Math.PI * 2); ctx.fill();
      // head
      const hy = -h * 0.72;
      ctx.fillStyle = main;
      for (const ex of [-w * 0.18, w * 0.2]) { ctx.beginPath(); ctx.moveTo(ex - 9, hy - 12); ctx.lineTo(ex + 1, hy - 34); ctx.lineTo(ex + 10, hy - 10); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(0, hy, w * 0.42, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = second; ctx.beginPath(); ctx.ellipse(w * 0.36, hy + 6, w * 0.2, w * 0.13, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(w * 0.54, hy + 3, 3.5, 0, Math.PI * 2); ctx.fill();
      highlight(ctx, -w * 0.12, hy - w * 0.2, 8, 5);
      eyes(ctx, w * 0.02, hy - 3, 5, pose.eyes, time, 13, f.slot);
      ctx.save(); ctx.fillStyle = glow; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(0, hy - w * 0.42 - 2, 3, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      break;
    }
    case 'golem': {
      ctx.fillStyle = main;
      roundRect(ctx, -w * 0.5, -h * 0.82, w, h * 0.72, 16); ctx.fill(); ctx.stroke();
      ctx.fillStyle = shade(main, -0.2);
      roundRect(ctx, -w * 0.3, -h * 1.0, w * 0.62, h * 0.26, 10); ctx.fill(); ctx.stroke();
      // cracks
      ctx.save(); ctx.strokeStyle = glow; ctx.shadowColor = glow; ctx.shadowBlur = 10; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-w * 0.2, -h * 0.7); ctx.lineTo(-w * 0.05, -h * 0.55); ctx.lineTo(-w * 0.18, -h * 0.4); ctx.lineTo(0, -h * 0.25);
      ctx.moveTo(w * 0.25, -h * 0.65); ctx.lineTo(w * 0.15, -h * 0.5); ctx.stroke();
      // glowing eye slit
      ctx.fillStyle = pose.eyes === 'hurt' ? '#fff' : glow;
      roundRect(ctx, -w * 0.05, -h * 0.92, w * 0.32, 7, 3); ctx.fill();
      ctx.restore();
      highlight(ctx, -w * 0.25, -h * 0.7, 10, 6);
      break;
    }
    case 'bird': {
      ctx.fillStyle = main; ctx.beginPath(); ctx.ellipse(0, -h * 0.45, w * 0.55, h * 0.45, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = second; ctx.beginPath(); ctx.ellipse(w * 0.15, -h * 0.35, w * 0.3, h * 0.25, 0, 0, Math.PI * 2); ctx.fill();
      // crest
      ctx.fillStyle = glow;
      for (let i = 0; i < 3; i++) {
        ctx.save(); ctx.translate(-w * 0.05 + i * 6, -h * 0.86); ctx.rotate(-0.6 + i * 0.35 + Math.sin(time * 6 + i) * 0.1);
        ctx.beginPath(); ctx.ellipse(0, -10, 4, 12, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
      }
      // beak
      ctx.fillStyle = '#ffb02e';
      ctx.beginPath(); ctx.moveTo(w * 0.42, -h * 0.66); ctx.lineTo(w * 0.85, -h * 0.58); ctx.lineTo(w * 0.42, -h * 0.5); ctx.closePath(); ctx.fill(); ctx.stroke();
      highlight(ctx, -w * 0.2, -h * 0.72, 9, 6);
      eyes(ctx, w * 0.1, -h * 0.66, 5, pose.eyes, time, 12, f.slot);
      break;
    }
    case 'robot': {
      ctx.fillStyle = main;
      roundRect(ctx, -w * 0.4, -h * 0.55, w * 0.8, h * 0.48, 10); ctx.fill(); ctx.stroke();
      ctx.fillStyle = second;
      roundRect(ctx, -w * 0.18, -h * 0.45, w * 0.36, h * 0.2, 5); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.fillStyle = glow; ctx.shadowColor = glow; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(0, -h * 0.35, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      // head
      ctx.fillStyle = main;
      roundRect(ctx, -w * 0.45, -h * 1.0, w * 0.9, h * 0.42, 12); ctx.fill(); ctx.stroke();
      ctx.fillStyle = second;
      roundRect(ctx, -w * 0.25, -h * 0.92, w * 0.66, h * 0.24, 8); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.fillStyle = glow; ctx.shadowColor = glow; ctx.shadowBlur = 12;
      if (pose.eyes === 'hurt') { ctx.font = 'bold 14px monospace'; ctx.fillText('x x', -w * 0.1, -h * 0.75); }
      else { const eh = pose.eyes === 'closed' ? 2 : 8; ctx.fillRect(-w * 0.08, -h * 0.84 + (8 - eh) / 2, 7, eh); ctx.fillRect(w * 0.16, -h * 0.84 + (8 - eh) / 2, 7, eh); }
      ctx.restore();
      // antenna
      ctx.beginPath(); ctx.moveTo(0, -h * 1.0); ctx.lineTo(-4, -h * 1.0 - 14); ctx.stroke();
      ctx.save(); ctx.fillStyle = glow; ctx.shadowColor = glow; ctx.shadowBlur = 10 + Math.sin(time * 8) * 6;
      ctx.beginPath(); ctx.arc(-4, -h * 1.0 - 16, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
      highlight(ctx, -w * 0.25, -h * 0.9, 8, 4);
      break;
    }
    case 'ninja': {
      // scarf tails
      ctx.save(); ctx.fillStyle = second;
      const wave = Math.sin(time * 9) * 5;
      ctx.beginPath(); ctx.moveTo(-w * 0.3, -h * 0.78); ctx.quadraticCurveTo(-w * 0.9, -h * 0.8 + wave, -w * 1.2, -h * 0.7 - wave); ctx.lineTo(-w * 1.1, -h * 0.62 - wave);
      ctx.quadraticCurveTo(-w * 0.8, -h * 0.7 + wave, -w * 0.3, -h * 0.7); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.ellipse(0, -h * 0.32, w * 0.4, h * 0.28, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = second; ctx.fillRect(-w * 0.4, -h * 0.34, w * 0.8, 6);
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.arc(0, -h * 0.74, w * 0.45, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = second;
      ctx.beginPath(); ctx.rect(-w * 0.45, -h * 0.8, w * 0.9, 12); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f6e7d8';
      ctx.beginPath(); ctx.ellipse(w * 0.15, -h * 0.74, w * 0.28, 7, 0, 0, Math.PI * 2); ctx.fill();
      eyes(ctx, w * 0.06, -h * 0.74, 4.5, pose.eyes, time, 12, f.slot);
      highlight(ctx, -w * 0.18, -h * 0.9, 7, 4);
      break;
    }
    case 'imp': {
      // tail
      ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(-w * 0.4, -h * 0.25); ctx.quadraticCurveTo(-w * 1.0, -h * 0.2 + Math.sin(time * 6) * 6, -w * 0.95, -h * 0.6); ctx.stroke();
      ctx.fillStyle = second; ctx.beginPath(); ctx.moveTo(-w * 0.95, -h * 0.75); ctx.lineTo(-w * 0.8, -h * 0.55); ctx.lineTo(-w * 1.1, -h * 0.55); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = second;
      for (const ex of [-w * 0.3, w * 0.25]) { ctx.beginPath(); ctx.moveTo(ex - 6, -h * 0.85); ctx.lineTo(ex + 2, -h * 1.12); ctx.lineTo(ex + 8, -h * 0.82); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.ellipse(0, -h * 0.5, w * 0.62, h * 0.47, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      highlight(ctx, -w * 0.25, -h * 0.75, 8, 5);
      eyes(ctx, -w * 0.05, -h * 0.58, 7, pose.eyes, time, 17, f.slot);
      ctx.save(); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(w * 0.12, -h * 0.35, 6, 0.2, Math.PI - 0.2); ctx.stroke(); ctx.restore();
      break;
    }
  }
}

function drawDizzy(ctx: CanvasRenderingContext2D, x: number, y: number, time: number) {
  ctx.save();
  for (let i = 0; i < 3; i++) {
    const a = time * 5 + (i * Math.PI * 2) / 3;
    const sx = x + Math.cos(a) * 22, sy = y + Math.sin(a) * 6;
    star(ctx, sx, sy, 6, '#ffd23f');
  }
  ctx.restore();
}

export function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, rot = 0) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot);
  ctx.fillStyle = color; ctx.strokeStyle = INK; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

export function drawProjectile(ctx: CanvasRenderingContext2D, p: ProjectileState, time: number, glow: string) {
  const r = p.def.r;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.lineWidth = 3; ctx.strokeStyle = INK;
  switch (p.kind) {
    case 'fireball': {
      for (let i = 4; i > 0; i--) {
        ctx.fillStyle = i % 2 ? '#ff6a2b' : '#ffd23f';
        ctx.globalAlpha = 0.25 * i;
        ctx.beginPath(); ctx.arc(-p.vx * i * 1.2, -p.vy * i, r * (1 - i * 0.12), 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.shadowColor = '#ff8a00'; ctx.shadowBlur = 18;
      ctx.fillStyle = '#ffe066'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    }
    case 'rock': {
      ctx.rotate(time * 6);
      ctx.fillStyle = '#8a8f9c';
      ctx.beginPath();
      for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; const rr = r * (0.8 + ((i * 37) % 5) / 12); ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'gust': {
      ctx.strokeStyle = 'rgba(220,255,250,0.9)'; ctx.lineWidth = 4;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 0, r * (0.4 + i * 0.3), time * 10 + i, time * 10 + i + 3.6); ctx.stroke(); }
      break;
    }
    case 'feather': {
      ctx.rotate(Math.atan2(p.vy, p.vx));
      ctx.fillStyle = glow; ctx.shadowColor = glow; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.8, r * 0.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    }
    case 'orb': {
      ctx.shadowColor = glow; ctx.shadowBlur = 24;
      ctx.fillStyle = '#e8fbff'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = glow; ctx.lineWidth = 2.5;
      for (let i = 0; i < 4; i++) {
        const a = time * 13 + i * 1.7;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.lineTo(Math.cos(a + 0.4) * r * 1.6, Math.sin(a + 0.4) * r * 1.6); ctx.lineTo(Math.cos(a + 0.2) * r * 2, Math.sin(a + 0.2) * r * 2); ctx.stroke();
      }
      break;
    }
    case 'shuriken': star(ctx, 0, 0, r * 1.4, '#dfe8ff', time * 25); break;
    case 'bomb': case 'mine': {
      const blink = p.kind === 'mine' && Math.floor(time * 6) % 2 === 0;
      ctx.fillStyle = '#2a2140';
      ctx.beginPath();
      if (p.kind === 'mine') ctx.ellipse(0, r * 0.3, r * 1.2, r * 0.6, 0, 0, Math.PI * 2); else ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = blink || p.kind === 'bomb' ? '#ff2e63' : '#5a1530';
      ctx.shadowColor = '#ff2e63'; ctx.shadowBlur = blink ? 14 : 0;
      ctx.beginPath(); ctx.arc(p.kind === 'mine' ? 0 : r * 0.5, p.kind === 'mine' ? 0 : -r * 0.8, 4, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'shock': {
      ctx.fillStyle = glow; ctx.globalAlpha = Math.min(1, p.life / 10);
      ctx.beginPath(); ctx.moveTo(-r, r); ctx.quadraticCurveTo(0, -r * 1.6, r, r); ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    default: ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

/** Standalone preview (menus): a fake state for idle / victory poses. */
export function previewFighter(ctx: CanvasRenderingContext2D, charId: string, skin: number, x: number, y: number, scale: number, time: number, action: 'idle' | 'air' | 'run' = 'idle') {
  const def = getFighter(charId);
  const f = {
    slot: 0, charId, x: 0, y: 0, facing: 1, action, af: Math.floor(time * 60), grounded: action !== 'air', vy: -2,
    kx: 0, ky: 0, intang: false, invuln: 0, hitlag: 0, jumps: def.stats.airJumps, move: null, charge: 0, shield: 50, shieldStun: 0, lag: 0,
  } as unknown as FighterState;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  drawFighter(ctx, f, skin, { color: '#fff', time });
  ctx.restore();
}
