import { drawSpellProjectile } from './spellfx.ts';
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
  // hit flash: brighten only the fighter's own pixels
  if (o.flash && o.flash > 0.05) ctx.filter = `brightness(${(1 + o.flash * 1.6).toFixed(2)})`;

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
  ctx.lineWidth = 2.8;
  ctx.strokeStyle = INK;

  // charge glow
  const m = f.action === 'attack' && f.move ? def.moves[f.move] : null;
  const charging = !!(m?.charge && f.charge > 0 && f.af === m.charge.frame);
  if (charging) {
    // pulsing aura instead of a (slow) blur shadow
    ctx.save();
    ctx.globalAlpha *= 0.35 + 0.25 * Math.sin(o.time * 40);
    ctx.fillStyle = skin.glow;
    ctx.beginPath(); ctx.ellipse(0, -h * 0.5, w * 0.95, h * 0.68, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // swooshes behind body
  if (pose.swoosh) {
    for (const s of pose.swoosh) drawSwoosh(ctx, s.x, s.y, s.r, s.a, skin.glow);
  }

  const back = (lead: 'hb' | 'fb') => drawLimb(ctx, pose[lead], lead[0] === 'h', def, skin, true, pose.lead === lead);
  back('fb'); back('hb');
  drawBody(ctx, def, skin, w, h, pose, o.time, f);
  drawLimb(ctx, pose.ff, false, def, skin, false, pose.lead === 'ff');
  const weapon = def.look.weapon ?? (def.look.body === 'ninja' ? 'katana' : undefined);
  if (weapon && weapon !== 'claws') drawWeapon(ctx, weapon, pose, f, m, skin, o.time);
  drawLimb(ctx, pose.hf, true, def, skin, false, pose.lead === 'hf');
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

type Body = FighterDef['look']['body'];
const HAND_R: Partial<Record<Body, number>> = { golem: 13, imp: 6, mech: 13, demon: 12, colossus: 14, bear: 11, knight: 10, shark: 9 };
const FOOT_R: Partial<Record<Body, number>> = { golem: 10, imp: 6, mech: 11, demon: 10, colossus: 11, bear: 10, knight: 9, mage: 7, witch: 7 };

function limbPath(ctx: CanvasRenderingContext2D, p: V, hand: boolean, body: Body, r: number) {
  if (hand && body === 'bird') { ctx.beginPath(); ctx.ellipse(p.x, p.y, r * 1.6, r * 0.8, -0.5, 0, Math.PI * 2); }
  else if (!hand) { ctx.beginPath(); ctx.ellipse(p.x, p.y - r * 0.5, r * 1.25, r * 0.8, 0, 0, Math.PI * 2); }
  else if (body === 'mech' || body === 'colossus') roundRect(ctx, p.x - r, p.y - r, r * 2, r * 2, r * 0.45);
  else if (body === 'scorpion') { ctx.beginPath(); ctx.moveTo(p.x + r * 0.2, p.y); ctx.arc(p.x, p.y, r * 1.2, 0.55, Math.PI * 2 - 0.55); ctx.closePath(); }
  else { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); }
}

function drawLimb(ctx: CanvasRenderingContext2D, p: V, hand: boolean, def: FighterDef, skin: FighterDef['skins'][number], back: boolean, lead: boolean) {
  const body = def.look.body;
  const r = (hand ? HAND_R[body] : FOOT_R[body]) ?? 8;
  ctx.save();
  if (!hand && body === 'serpent') {
    // no feet: only the tail tip shows when it is the attacking limb
    if (lead) {
      ctx.save(); ctx.globalAlpha *= 0.45; ctx.fillStyle = skin.glow;
      ctx.beginPath(); ctx.arc(p.x, p.y - 4, 15, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      ctx.fillStyle = skin.main;
      ctx.beginPath(); ctx.moveTo(p.x - 12, p.y - 10); ctx.quadraticCurveTo(p.x + 4, p.y - 14, p.x + 14, p.y - 2); ctx.quadraticCurveTo(p.x + 2, p.y - 1, p.x - 12, p.y - 2); ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
    return;
  }
  ctx.fillStyle = back ? shade(hand ? skin.main : skin.second, -0.25) : hand ? skin.main : skin.second;
  if (lead) {
    ctx.save(); ctx.globalAlpha *= 0.45; ctx.fillStyle = skin.glow;
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.9, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  limbPath(ctx, p, hand, body, r);
  ctx.fill(); ctx.stroke();
  if (hand && (body === 'mech' || body === 'colossus')) {
    // knuckle line
    ctx.save(); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x + r * 0.35, p.y - r * 0.6); ctx.lineTo(p.x + r * 0.35, p.y + r * 0.6); ctx.stroke(); ctx.restore();
  }
  if (hand && def.look.weapon === 'claws' && body !== 'scorpion') {
    ctx.save(); ctx.strokeStyle = back ? shade(skin.glow, -0.3) : skin.glow; ctx.lineWidth = 2.2;
    for (const dy of [-4, 0, 4]) { ctx.beginPath(); ctx.moveTo(p.x + r * 0.6, p.y + dy); ctx.lineTo(p.x + r * 1.5, p.y + dy * 1.4 - 2); ctx.stroke(); }
    ctx.restore();
  }
  ctx.restore();
}

/** Held props: drawn just behind the front hand so the hand "grips" them. */
function drawWeapon(ctx: CanvasRenderingContext2D, kind: NonNullable<FighterDef['look']['weapon']>, pose: Pose, f: FighterState, m: FighterDef['moves'][keyof FighterDef['moves']] | null, skin: FighterDef['skins'][number], time: number) {
  const active = f.action === 'attack';
  const hand = pose.hf;
  const rest = !active || !pose.lead;
  switch (kind) {
    case 'katana': drawSword(ctx, hand, pose.sword ?? -0.6, skin, active); return;
    case 'greatsword': {
      ctx.save(); ctx.translate(hand.x, hand.y); ctx.rotate(rest ? -1.05 : (pose.sword ?? -0.6));
      if (active && pose.swoosh) {
        ctx.save(); ctx.globalAlpha *= 0.5; ctx.strokeStyle = skin.glow; ctx.lineWidth = 18;
        ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(70, 0); ctx.stroke(); ctx.restore();
      }
      const g = ctx.createLinearGradient(0, -7, 0, 7);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, shade(skin.glow, 0.55)); g.addColorStop(1, shade(skin.glow, -0.1));
      ctx.fillStyle = g; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(8, -6); ctx.lineTo(62, -6); ctx.lineTo(76, 0); ctx.lineTo(62, 7); ctx.lineTo(8, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(12, -2); ctx.lineTo(58, -2); ctx.stroke(); ctx.restore();
      ctx.fillStyle = skin.second; roundRect(ctx, 2, -13, 7, 26, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = shade(skin.second, -0.3); roundRect(ctx, -12, -3, 14, 6, 3); ctx.fill(); ctx.stroke();
      ctx.restore(); return;
    }
    case 'staff': case 'spear': {
      const ang = rest ? (kind === 'staff' ? -1.35 : -1.2) : (pose.sword ?? -0.6);
      ctx.save(); ctx.translate(hand.x, hand.y); ctx.rotate(ang);
      const len = kind === 'staff' ? 50 : 62;
      ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(-34, 0); ctx.lineTo(len, 0); ctx.stroke();
      ctx.strokeStyle = kind === 'staff' ? shade(skin.second, -0.45) : shade(skin.main, -0.35); ctx.lineWidth = 4.2;
      ctx.beginPath(); ctx.moveTo(-33, 0); ctx.lineTo(len - 1, 0); ctx.stroke();
      ctx.strokeStyle = INK; ctx.lineWidth = 2.6;
      if (kind === 'staff') {
        // crescent head holding an orb
        ctx.fillStyle = skin.second;
        ctx.beginPath(); ctx.arc(len + 8, 0, 11, Math.PI * 0.35, Math.PI * 1.65); ctx.arc(len + 4, 0, 7, Math.PI * 1.55, Math.PI * 0.45, true); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.save(); ctx.globalAlpha *= 0.35 + 0.15 * Math.sin(time * 6); ctx.fillStyle = skin.glow;
        ctx.beginPath(); ctx.arc(len + 9, 0, 13, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        ctx.fillStyle = shade(skin.glow, 0.5); ctx.beginPath(); ctx.arc(len + 9, 0, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      } else {
        if (active && pose.swoosh) { ctx.save(); ctx.globalAlpha *= 0.5; ctx.strokeStyle = skin.glow; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(len - 4, 0); ctx.lineTo(len + 22, 0); ctx.stroke(); ctx.restore(); }
        ctx.fillStyle = '#e8eef8';
        ctx.beginPath(); ctx.moveTo(len - 3, 0); ctx.quadraticCurveTo(len + 6, -8, len + 22, 0); ctx.quadraticCurveTo(len + 6, 8, len - 3, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = skin.glow; ctx.beginPath(); ctx.moveTo(len - 6, 0); ctx.lineTo(len - 14, -8 + Math.sin(time * 9) * 2); ctx.lineTo(len - 10, 2); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.restore(); return;
    }
    case 'gun': {
      let ang = 0.45;
      if (active && m?.proj) ang = Math.max(-0.9, Math.min(0.9, Math.atan2(m.proj.def.vy, Math.abs(m.proj.def.vx) || 1)));
      else if (active && f.move === 'sspecial') ang = 0;
      else if (active) ang = pose.sword ?? 0.45;
      ctx.save(); ctx.translate(hand.x, hand.y); ctx.rotate(ang);
      if (active && m?.proj && f.af >= m.proj.frame && f.af < m.proj.frame + 4) {
        ctx.save(); ctx.fillStyle = skin.glow; ctx.globalAlpha *= 0.85;
        ctx.beginPath(); ctx.moveTo(30, -3); ctx.lineTo(46, -10); ctx.lineTo(42, -2); ctx.lineTo(52, 0); ctx.lineTo(42, 3); ctx.lineTo(46, 9); ctx.lineTo(30, 3); ctx.closePath(); ctx.fill(); ctx.restore();
      }
      ctx.lineWidth = 2.6;
      ctx.fillStyle = shade(skin.second, -0.2);
      ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(8, -4); ctx.lineTo(3, 11); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#5a5f6e'; roundRect(ctx, 4, -9, 30, 7, 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#8a90a0'; roundRect(ctx, 2, -10, 13, 11, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = skin.glow; ctx.fillRect(30, -12, 3, 3);
      ctx.restore(); return;
    }
    case 'lantern': {
      const sway = active ? 0 : Math.sin(time * 3) * 0.25;
      ctx.save(); ctx.translate(hand.x, hand.y); ctx.rotate(sway);
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 10); ctx.stroke();
      ctx.save(); ctx.globalAlpha *= 0.28 + 0.1 * Math.sin(time * 7); ctx.fillStyle = skin.glow;
      ctx.beginPath(); ctx.arc(0, 21, 15, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      ctx.lineWidth = 2.6; ctx.fillStyle = shade(skin.second, -0.35);
      roundRect(ctx, -7, 9, 14, 5, 2); ctx.fill(); ctx.stroke();
      const g = ctx.createRadialGradient(0, 21, 1, 0, 21, 9);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, skin.glow); g.addColorStop(1, shade(skin.glow, -0.35));
      ctx.fillStyle = g; roundRect(ctx, -7, 13, 14, 16, 5); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(0, 13); ctx.lineTo(0, 29); ctx.stroke();
      ctx.lineWidth = 2.6; ctx.fillStyle = shade(skin.second, -0.35); roundRect(ctx, -5, 28, 10, 4, 2); ctx.fill(); ctx.stroke();
      ctx.restore(); return;
    }
  }
}

function drawSword(ctx: CanvasRenderingContext2D, hand: V, ang: number, skin: FighterDef['skins'][number], active: boolean) {
  ctx.save();
  ctx.translate(hand.x, hand.y);
  ctx.rotate(ang);
  ctx.lineWidth = 3.5;
  ctx.fillStyle = active ? '#ffffff' : '#dfe8ff';
  if (active) {
    ctx.save(); ctx.globalAlpha *= 0.5; ctx.strokeStyle = skin.glow; ctx.lineWidth = 12;
    ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(58, 0); ctx.stroke(); ctx.restore();
  }
  ctx.beginPath();
  ctx.moveTo(4, -3); ctx.lineTo(52, -2); ctx.lineTo(60, 0); ctx.lineTo(52, 3); ctx.lineTo(4, 3); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = skin.second;
  ctx.fillRect(-2, -7, 6, 14); ctx.strokeRect(-2, -7, 6, 14);
  ctx.restore();
}

function eyes(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, mode: Pose['eyes'], time: number, gap = r * 2.2, slot = 0, iris = '#7fe0ff') {
  const blink = (Math.floor(time * 10 + slot * 7) % 41) === 0;
  ctx.save();
  ctx.lineWidth = 2;
  for (const dx of [0, gap]) {
    const ex = x + dx;
    if (mode === 'hurt') {
      ctx.beginPath(); ctx.moveTo(ex - r * 0.6, y - r * 0.5); ctx.lineTo(ex + r * 0.6, y + r * 0.4);
      ctx.moveTo(ex + r * 0.6, y - r * 0.5); ctx.lineTo(ex - r * 0.6, y + r * 0.4); ctx.stroke();
      continue;
    }
    if (mode === 'closed' || blink) {
      ctx.beginPath(); ctx.moveTo(ex - r, y); ctx.quadraticCurveTo(ex, y + r * 0.35, ex + r, y - r * 0.1); ctx.stroke();
      continue;
    }
    const open = mode === 'focus' ? 0.5 : 0.75;
    // almond-shaped eye
    ctx.fillStyle = '#f4f6ff';
    ctx.beginPath(); ctx.moveTo(ex - r, y); ctx.quadraticCurveTo(ex, y - r * open * 1.2, ex + r, y - r * 0.18); ctx.quadraticCurveTo(ex, y + r * 0.6, ex - r, y); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.save(); ctx.clip();
    ctx.fillStyle = iris; ctx.beginPath(); ctx.arc(ex + r * 0.32, y - r * 0.08, r * 0.46, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(ex + r * 0.38, y - r * 0.08, r * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // brow: angled = determined
    ctx.save(); ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(ex - r * 1.1, y - r * (mode === 'focus' ? 1.05 : 1.15)); ctx.lineTo(ex + r * 1.05, y - r * (mode === 'focus' ? 0.55 : 0.8)); ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/** Cel shading for the current path: core shadow toward the back/bottom + rim light toward the front/top. */
function cel(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, rim: string) {
  // shading uses Path2D so the current path (the shape outline) survives for the re-ink below
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(6,8,22,0.26)';
  const core = new Path2D(); core.ellipse(cx - rx * 0.6, cy + ry * 0.55, rx * 1.15, ry * 1.1, 0, 0, Math.PI * 2); ctx.fill(core);
  ctx.globalAlpha = 0.75; ctx.strokeStyle = rim; ctx.lineWidth = 3;
  const rimArc = new Path2D(); rimArc.ellipse(cx + rx * 0.16, cy - ry * 0.12, rx * 0.98, ry * 0.98, 0, -Math.PI * 0.75, Math.PI * 0.05); ctx.stroke(rimArc);
  ctx.restore();
  ctx.stroke(); // re-ink the outline over the shading
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
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath(); ctx.ellipse(x, y, rx * 0.8, ry * 0.7, -0.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** Tapered athletic torso (shoulders at `top`, hips at `bot`, as fractions of h). */
function torsoPath(ctx: CanvasRenderingContext2D, w: number, h: number, top: number, bot: number, wTop: number, wBot: number) {
  ctx.beginPath();
  ctx.moveTo(-w * wTop, -h * top); ctx.quadraticCurveTo(0, -h * (top + 0.1), w * (wTop + 0.02), -h * top);
  ctx.quadraticCurveTo(w * wTop, -h * (bot + 0.06), w * wBot, -h * bot); ctx.lineTo(-w * (wBot + 0.02), -h * bot);
  ctx.quadraticCurveTo(-w * (wTop + 0.02), -h * (bot + 0.06), -w * wTop, -h * top); ctx.closePath();
}

/** Thick curved horn rooted at (x, y), curling outward (dir) then up. */
function horn(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, k: number, fill: string) {
  ctx.save(); ctx.translate(x, y); ctx.scale(dir * k, k);
  ctx.fillStyle = fill;
  ctx.beginPath(); ctx.moveTo(-6, 2); ctx.quadraticCurveTo(-4, -14, 14, -20); ctx.quadraticCurveTo(24, -24, 22, -40);
  ctx.quadraticCurveTo(32, -22, 18, -10); ctx.quadraticCurveTo(10, -4, 7, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.save(); ctx.strokeStyle = 'rgba(6,8,22,0.3)'; ctx.lineWidth = 1.6;
  for (const t of [0.3, 0.55]) { ctx.beginPath(); ctx.moveTo(-2 + t * 20, -6 - t * 16); ctx.lineTo(6 + t * 20, -2 - t * 14); ctx.stroke(); }
  ctx.restore(); ctx.restore();
}

function rune(ctx: CanvasRenderingContext2D, x: number, y: number, glow: string) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
  ctx.fillStyle = glow; ctx.lineWidth = 2; ctx.fillRect(-4, -4, 8, 8); ctx.strokeRect(-4, -4, 8, 8);
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
      // athletic torso (tapered)
      ctx.fillStyle = main; ctx.beginPath();
      ctx.moveTo(-w * 0.36, -h * 0.5); ctx.quadraticCurveTo(0, -h * 0.6, w * 0.38, -h * 0.5);
      ctx.quadraticCurveTo(w * 0.36, -h * 0.12, w * 0.18, -h * 0.06); ctx.lineTo(-w * 0.2, -h * 0.06);
      ctx.quadraticCurveTo(-w * 0.38, -h * 0.12, -w * 0.36, -h * 0.5); ctx.closePath();
      ctx.fill(); ctx.stroke(); cel(ctx, 0, -h * 0.3, w * 0.4, h * 0.27, glow);
      ctx.fillStyle = second; ctx.beginPath(); ctx.moveTo(w * 0.02, -h * 0.48); ctx.lineTo(w * 0.3, -h * 0.46); ctx.lineTo(w * 0.12, -h * 0.16); ctx.closePath(); ctx.fill();
      // head
      const hy = -h * 0.74;
      ctx.fillStyle = main;
      for (const ex of [-w * 0.16, w * 0.16]) { ctx.beginPath(); ctx.moveTo(ex - 7, hy - 10); ctx.lineTo(ex + 3, hy - 40); ctx.lineTo(ex + 9, hy - 9); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      ctx.beginPath(); ctx.ellipse(0, hy, w * 0.37, w * 0.34, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); cel(ctx, 0, hy, w * 0.37, w * 0.34, glow);
      // muzzle
      ctx.fillStyle = second; ctx.beginPath(); ctx.moveTo(w * 0.12, hy + 2); ctx.quadraticCurveTo(w * 0.42, hy - 4, w * 0.62, hy + 6); ctx.quadraticCurveTo(w * 0.4, hy + 16, w * 0.14, hy + 12); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(w * 0.6, hy + 5, 2.6, 0, Math.PI * 2); ctx.fill();
      eyes(ctx, w * 0.04, hy - 3, 4.6, pose.eyes, time, 11, f.slot, glow);
      ctx.save(); ctx.fillStyle = glow; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(0, hy - w * 0.42 - 2, 3, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      break;
    }
    case 'golem': {
      ctx.fillStyle = main;
      roundRect(ctx, -w * 0.5, -h * 0.82, w, h * 0.72, 14); ctx.fill(); ctx.stroke(); cel(ctx, 0, -h * 0.46, w * 0.5, h * 0.36, glow);
      ctx.fillStyle = shade(main, -0.2);
      roundRect(ctx, -w * 0.3, -h * 1.0, w * 0.62, h * 0.26, 9); ctx.fill(); ctx.stroke(); cel(ctx, 0, -h * 0.87, w * 0.31, h * 0.13, glow);
      // cracks
      ctx.save(); ctx.strokeStyle = glow;  ctx.lineWidth = 3;
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
      ctx.fillStyle = main; ctx.beginPath(); ctx.ellipse(0, -h * 0.46, w * 0.48, h * 0.45, 0.08, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); cel(ctx, 0, -h * 0.46, w * 0.48, h * 0.45, glow);
      ctx.fillStyle = second; ctx.beginPath(); ctx.moveTo(w * 0.05, -h * 0.55); ctx.quadraticCurveTo(w * 0.42, -h * 0.4, w * 0.12, -h * 0.1); ctx.quadraticCurveTo(-w * 0.02, -h * 0.3, w * 0.05, -h * 0.55); ctx.fill();
      // crest
      ctx.fillStyle = glow;
      for (let i = 0; i < 3; i++) {
        ctx.save(); ctx.translate(-w * 0.05 + i * 6, -h * 0.86); ctx.rotate(-0.6 + i * 0.35 + Math.sin(time * 6 + i) * 0.1);
        ctx.beginPath(); ctx.ellipse(0, -10, 4, 12, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
      }
      // beak
      ctx.fillStyle = '#f2b23a';
      ctx.beginPath(); ctx.moveTo(w * 0.38, -h * 0.68); ctx.quadraticCurveTo(w * 0.86, -h * 0.68, w * 0.8, -h * 0.52); ctx.lineTo(w * 0.62, -h * 0.56); ctx.lineTo(w * 0.38, -h * 0.52); ctx.closePath(); ctx.fill(); ctx.stroke();
      eyes(ctx, w * 0.08, -h * 0.68, 4.4, pose.eyes, time, 10.5, f.slot, glow);
      break;
    }
    case 'robot': {
      ctx.fillStyle = main;
      roundRect(ctx, -w * 0.4, -h * 0.55, w * 0.8, h * 0.48, 9); ctx.fill(); ctx.stroke(); cel(ctx, 0, -h * 0.31, w * 0.4, h * 0.24, glow);
      ctx.fillStyle = second;
      roundRect(ctx, -w * 0.18, -h * 0.45, w * 0.36, h * 0.2, 5); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.fillStyle = glow; 
      ctx.beginPath(); ctx.arc(0, -h * 0.35, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      // head
      ctx.fillStyle = main;
      roundRect(ctx, -w * 0.45, -h * 1.0, w * 0.9, h * 0.42, 11); ctx.fill(); ctx.stroke(); cel(ctx, 0, -h * 0.79, w * 0.45, h * 0.21, glow);
      ctx.fillStyle = second;
      roundRect(ctx, -w * 0.25, -h * 0.92, w * 0.66, h * 0.24, 8); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.fillStyle = glow; 
      if (pose.eyes === 'hurt') { ctx.font = 'bold 14px monospace'; ctx.fillText('x x', -w * 0.1, -h * 0.75); }
      else { const eh = pose.eyes === 'closed' ? 2 : 8; ctx.fillRect(-w * 0.08, -h * 0.84 + (8 - eh) / 2, 7, eh); ctx.fillRect(w * 0.16, -h * 0.84 + (8 - eh) / 2, 7, eh); }
      ctx.restore();
      // antenna
      ctx.beginPath(); ctx.moveTo(0, -h * 1.0); ctx.lineTo(-4, -h * 1.0 - 14); ctx.stroke();
      ctx.save(); ctx.fillStyle = glow; 
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
      ctx.beginPath(); ctx.moveTo(-w * 0.34, -h * 0.55); ctx.quadraticCurveTo(0, -h * 0.62, w * 0.36, -h * 0.55); ctx.quadraticCurveTo(w * 0.34, -h * 0.1, w * 0.16, -h * 0.05); ctx.lineTo(-w * 0.18, -h * 0.05); ctx.quadraticCurveTo(-w * 0.36, -h * 0.1, -w * 0.34, -h * 0.55); ctx.closePath();
      ctx.fill(); ctx.stroke(); cel(ctx, 0, -h * 0.32, w * 0.36, h * 0.27, glow);
      ctx.fillStyle = second; ctx.fillRect(-w * 0.36, -h * 0.3, w * 0.72, 5);
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.ellipse(0, -h * 0.76, w * 0.4, w * 0.38, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); cel(ctx, 0, -h * 0.76, w * 0.4, w * 0.38, glow);
      ctx.fillStyle = second;
      ctx.beginPath(); ctx.rect(-w * 0.45, -h * 0.8, w * 0.9, 12); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f6e7d8';
      ctx.beginPath(); ctx.ellipse(w * 0.15, -h * 0.74, w * 0.28, 7, 0, 0, Math.PI * 2); ctx.fill();
      eyes(ctx, w * 0.06, -h * 0.75, 4.2, pose.eyes, time, 11, f.slot, glow);
      highlight(ctx, -w * 0.18, -h * 0.9, 7, 4);
      break;
    }
    case 'imp': {
      // tail
      ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = 2.8;
      ctx.beginPath(); ctx.moveTo(-w * 0.4, -h * 0.25); ctx.quadraticCurveTo(-w * 1.0, -h * 0.2 + Math.sin(time * 6) * 6, -w * 0.95, -h * 0.6); ctx.stroke();
      ctx.fillStyle = second; ctx.beginPath(); ctx.moveTo(-w * 0.95, -h * 0.75); ctx.lineTo(-w * 0.8, -h * 0.55); ctx.lineTo(-w * 1.1, -h * 0.55); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = second;
      for (const [ex, dir] of [[-w * 0.3, -1], [w * 0.25, 1]] as const) { ctx.beginPath(); ctx.moveTo(ex - 6, -h * 0.84); ctx.quadraticCurveTo(ex + dir * 10, -h * 1.05, ex + dir * 14, -h * 1.22); ctx.lineTo(ex + 7, -h * 0.82); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.ellipse(0, -h * 0.5, w * 0.58, h * 0.46, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); cel(ctx, 0, -h * 0.5, w * 0.58, h * 0.46, glow);
      eyes(ctx, -w * 0.08, -h * 0.6, 5, pose.eyes, time, 14, f.slot, glow);
      ctx.save(); ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(w * 0.0, -h * 0.36); ctx.quadraticCurveTo(w * 0.18, -h * 0.3, w * 0.32, -h * 0.4); ctx.stroke(); ctx.restore();
      break;
    }
    case 'wolf': {
      // scabbard at the hip
      ctx.save(); ctx.translate(-w * 0.18, -h * 0.26); ctx.rotate(2.75);
      ctx.fillStyle = '#231a2c'; roundRect(ctx, -2, -4, 44, 8, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = glow; ctx.fillRect(34, -4, 4, 8);
      ctx.restore();
      ctx.fillStyle = main; torsoPath(ctx, w, h, 0.52, 0.06, 0.38, 0.2); ctx.fill(); ctx.stroke(); cel(ctx, 0, -h * 0.3, w * 0.4, h * 0.27, glow);
      // kimono lapels + obi
      ctx.fillStyle = second;
      ctx.beginPath(); ctx.moveTo(-w * 0.16, -h * 0.55); ctx.lineTo(w * 0.1, -h * 0.28); ctx.lineTo(w * 0.02, -h * 0.28); ctx.lineTo(-w * 0.26, -h * 0.53); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(w * 0.24, -h * 0.54); ctx.lineTo(w * 0.04, -h * 0.3); ctx.lineTo(w * 0.12, -h * 0.29); ctx.lineTo(w * 0.32, -h * 0.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = shade(glow, -0.35); ctx.fillRect(-w * 0.37, -h * 0.29, w * 0.74, 7); ctx.strokeRect(-w * 0.37, -h * 0.29, w * 0.74, 7);
      // neck ruff
      const hy = -h * 0.74;
      ctx.fillStyle = second; ctx.beginPath();
      for (let i = 0; i <= 8; i++) { const a = Math.PI * (0.05 + i * 0.1125); const rr = i % 2 ? w * 0.3 : w * 0.4; ctx.lineTo(Math.cos(a) * rr * 1.05 - w * 0.02, hy + w * 0.18 + Math.sin(a) * rr * 0.55); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // ears
      ctx.fillStyle = main;
      for (const ex of [-w * 0.2, w * 0.06]) {
        ctx.beginPath(); ctx.moveTo(ex - 7, hy - 9); ctx.lineTo(ex - 3, hy - 38); ctx.lineTo(ex + 8, hy - 11); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.save(); ctx.fillStyle = shade(main, -0.45); ctx.beginPath(); ctx.moveTo(ex - 3, hy - 12); ctx.lineTo(ex - 2.5, hy - 30); ctx.lineTo(ex + 4, hy - 13); ctx.closePath(); ctx.fill(); ctx.restore();
      }
      // topknot
      ctx.fillStyle = '#231a2c'; ctx.beginPath(); ctx.ellipse(-w * 0.3, hy - w * 0.2, 6, 5, -0.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = glow; ctx.fillRect(-w * 0.25, hy - w * 0.25, 3, 7);
      ctx.fillStyle = main; ctx.beginPath(); ctx.ellipse(0, hy, w * 0.34, w * 0.32, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); cel(ctx, 0, hy, w * 0.34, w * 0.32, glow);
      // long muzzle
      ctx.fillStyle = second; ctx.beginPath(); ctx.moveTo(w * 0.08, hy); ctx.quadraticCurveTo(w * 0.45, hy - 5, w * 0.72, hy + 4); ctx.quadraticCurveTo(w * 0.5, hy + 15, w * 0.12, hy + 13); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = INK; ctx.beginPath(); ctx.ellipse(w * 0.7, hy + 3, 3.4, 2.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.save(); ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(w * 0.62, hy + 9); ctx.lineTo(w * 0.32, hy + 10); ctx.stroke(); ctx.restore();
      eyes(ctx, -w * 0.02, hy - 4, 4.2, pose.eyes, time, 11, f.slot, glow);
      // scar
      ctx.save(); ctx.lineWidth = 1.6; ctx.strokeStyle = shade(main, -0.5); ctx.beginPath(); ctx.moveTo(-w * 0.12, hy - 13); ctx.lineTo(-w * 0.02, hy + 4); ctx.stroke(); ctx.restore();
      break;
    }
    case 'scorpion': {
      // segmented tail arching over the head
      const sway = Math.sin(time * 4) * 3;
      const P = [{ x: -w * 0.32, y: -h * 0.26 }, { x: -w * 1.15, y: -h * 0.55 }, { x: -w * 0.75, y: -h * 1.5 + sway }, { x: w * 0.12, y: -h * 1.28 + sway }];
      const bz = (t: number) => {
        const u = 1 - t;
        return { x: u * u * u * P[0].x + 3 * u * u * t * P[1].x + 3 * u * t * t * P[2].x + t * t * t * P[3].x, y: u * u * u * P[0].y + 3 * u * u * t * P[1].y + 3 * u * t * t * P[2].y + t * t * t * P[3].y };
      };
      const end = bz(1), pre = bz(0.94);
      // stinger
      const sa = Math.atan2(end.y - pre.y, end.x - pre.x);
      ctx.save(); ctx.translate(end.x, end.y); ctx.rotate(sa + 0.9);
      ctx.fillStyle = glow; ctx.beginPath(); ctx.moveTo(-6, -8); ctx.quadraticCurveTo(18, -9, 22, 14); ctx.quadraticCurveTo(10, 3, -6, 8); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      for (let i = 9; i >= 0; i--) {
        const t = i / 9; const q = bz(t); const rr = 11 - t * 4.5;
        ctx.fillStyle = i % 2 ? main : shade(main, -0.12);
        ctx.beginPath(); ctx.arc(q.x, q.y, rr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.arc(q.x + rr * 0.25, q.y - rr * 0.35, rr * 0.4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      // carapace torso
      ctx.fillStyle = main; torsoPath(ctx, w, h, 0.56, 0.06, 0.36, 0.2); ctx.fill(); ctx.stroke(); cel(ctx, 0, -h * 0.32, w * 0.38, h * 0.28, glow);
      ctx.save(); ctx.strokeStyle = shade(main, -0.4); ctx.lineWidth = 2;
      for (const yy of [-0.42, -0.32, -0.22]) { ctx.beginPath(); ctx.moveTo(-w * 0.26, -h * yy - h * 0); ctx.stroke(); }
      for (const yy of [0.44, 0.34, 0.24]) { ctx.beginPath(); ctx.moveTo(-w * 0.28, -h * yy); ctx.quadraticCurveTo(0, -h * yy + 4, w * 0.3, -h * yy); ctx.stroke(); }
      ctx.restore();
      // desert wrap: shoulder cloth + head wrap
      ctx.fillStyle = second;
      ctx.beginPath(); ctx.moveTo(-w * 0.4, -h * 0.56); ctx.quadraticCurveTo(0, -h * 0.66, w * 0.4, -h * 0.56); ctx.lineTo(w * 0.22, -h * 0.44); ctx.quadraticCurveTo(0, -h * 0.5, -w * 0.28, -h * 0.42); ctx.closePath(); ctx.fill(); ctx.stroke();
      const hy = -h * 0.76;
      const wave = Math.sin(time * 8) * 3;
      ctx.beginPath(); ctx.moveTo(-w * 0.25, hy + 2); ctx.quadraticCurveTo(-w * 0.7, hy + wave, -w * 0.85, hy + 12 - wave); ctx.lineTo(-w * 0.62, hy + 12); ctx.quadraticCurveTo(-w * 0.45, hy + 8, -w * 0.25, hy + 10); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(0, hy, w * 0.33, w * 0.31, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); cel(ctx, 0, hy, w * 0.33, w * 0.31, glow);
      ctx.fillStyle = shade(main, -0.35); roundRect(ctx, -w * 0.08, hy - 8, w * 0.44, 12, 6); ctx.fill(); ctx.stroke();
      eyes(ctx, w * 0.02, hy - 2, 3.8, pose.eyes, time, 10, f.slot, glow);
      break;
    }
    case 'knight': {
      // cape
      const wave = Math.sin(time * 5) * 3;
      ctx.fillStyle = second;
      ctx.beginPath(); ctx.moveTo(-w * 0.3, -h * 0.62); ctx.quadraticCurveTo(-w * 0.75, -h * 0.35 + wave, -w * 0.7, -h * 0.06); ctx.lineTo(-w * 0.45, -h * 0.1 + wave * 0.5); ctx.lineTo(-w * 0.3, -h * 0.05); ctx.lineTo(-w * 0.05, -h * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke();
      // breastplate
      ctx.fillStyle = main; roundRect(ctx, -w * 0.4, -h * 0.62, w * 0.8, h * 0.54, 13); ctx.fill(); ctx.stroke(); cel(ctx, 0, -h * 0.35, w * 0.4, h * 0.27, glow);
      ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = shade(main, -0.4);
      ctx.beginPath(); ctx.moveTo(w * 0.04, -h * 0.58); ctx.lineTo(w * 0.04, -h * 0.24); ctx.stroke(); ctx.restore();
      ctx.fillStyle = second; ctx.fillRect(-w * 0.4, -h * 0.22, w * 0.8, 7); ctx.strokeRect(-w * 0.4, -h * 0.22, w * 0.8, 7);
      // frost sigil
      ctx.save(); ctx.strokeStyle = glow; ctx.lineWidth = 2.2; ctx.translate(w * 0.04, -h * 0.42);
      for (let i = 0; i < 3; i++) { ctx.rotate(Math.PI / 3); ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(7, 0); ctx.stroke(); }
      ctx.restore();
      // pauldrons with ice shards
      for (const px of [-w * 0.4, w * 0.36]) {
        ctx.fillStyle = glow;
        for (const [dx, hh] of [[-6, 12], [1, 17], [8, 11]]) { ctx.beginPath(); ctx.moveTo(px + dx - 4, -h * 0.62); ctx.lineTo(px + dx, -h * 0.62 - hh); ctx.lineTo(px + dx + 4, -h * 0.62); ctx.closePath(); ctx.fill(); ctx.stroke(); }
        ctx.fillStyle = shade(main, 0.12); ctx.beginPath(); ctx.ellipse(px, -h * 0.58, 14, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); cel(ctx, px, -h * 0.58, 14, 10, glow);
      }
      // great helm
      const hy = -h * 0.82;
      ctx.fillStyle = main; roundRect(ctx, -w * 0.28, hy - h * 0.18, w * 0.6, h * 0.34, 12); ctx.fill(); ctx.stroke(); cel(ctx, w * 0.02, hy, w * 0.3, h * 0.17, glow);
      ctx.fillStyle = INK; roundRect(ctx, -w * 0.02, hy - 6, w * 0.32, 8, 3); ctx.fill(); ctx.fillRect(w * 0.15, hy - 4, 5, 18);
      ctx.save(); ctx.fillStyle = pose.eyes === 'hurt' ? '#fff' : glow; const eh = pose.eyes === 'closed' ? 1.5 : 4;
      ctx.fillRect(w * 0.0, hy - 4 + (4 - eh) / 2, w * 0.12, eh); ctx.fillRect(w * 0.18, hy - 4 + (4 - eh) / 2, w * 0.1, eh); ctx.restore();
      // icicle crest
      ctx.fillStyle = shade(glow, 0.4);
      for (const [dx, hh, a] of [[-10, 14, -0.5], [-2, 20, -0.2], [6, 15, 0.1]]) {
        ctx.save(); ctx.translate(w * 0.02 + dx, hy - h * 0.18); ctx.rotate(a);
        ctx.beginPath(); ctx.moveTo(-4, 2); ctx.lineTo(0, -hh); ctx.lineTo(4, 2); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
      }
      highlight(ctx, -w * 0.12, hy - h * 0.1, 7, 4);
      break;
    }
    case 'mage': {
      // orbiting runes
      for (let i = 0; i < 2; i++) {
        const a = time * 2.2 + i * Math.PI;
        const rx = Math.cos(a) * w * 0.75, ry = -h * 0.45 + Math.sin(a) * 8;
        if (Math.sin(a) > 0) continue; // only the back half here
        rune(ctx, rx, ry, glow);
      }
      // robe
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.moveTo(-w * 0.3, -h * 0.62); ctx.quadraticCurveTo(0, -h * 0.68, w * 0.32, -h * 0.62);
      ctx.quadraticCurveTo(w * 0.45, -h * 0.3, w * 0.56, -h * 0.03);
      for (let i = 1; i <= 4; i++) ctx.lineTo(w * 0.56 - (w * 1.12 * i) / 4 + (i % 2 ? w * 0.07 : 0), -h * (i % 2 ? 0.0 : 0.04));
      ctx.quadraticCurveTo(-w * 0.45, -h * 0.3, -w * 0.3, -h * 0.62); ctx.closePath();
      ctx.fill(); ctx.stroke(); cel(ctx, 0, -h * 0.32, w * 0.5, h * 0.32, glow);
      ctx.fillStyle = second; ctx.beginPath(); ctx.moveTo(w * 0.1, -h * 0.6); ctx.lineTo(w * 0.24, -h * 0.6); ctx.lineTo(w * 0.36, -h * 0.03); ctx.lineTo(w * 0.16, -h * 0.03); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = shade(main, -0.35); ctx.fillRect(-w * 0.36, -h * 0.4, w * 0.72, 6); ctx.strokeRect(-w * 0.36, -h * 0.4, w * 0.72, 6);
      ctx.save(); ctx.fillStyle = glow; ctx.translate(w * 0.18, -h * 0.37); ctx.rotate(Math.PI / 4); ctx.fillRect(-4, -4, 8, 8); ctx.strokeRect(-4, -4, 8, 8); ctx.restore();
      // hood
      const hy = -h * 0.76;
      ctx.fillStyle = shade(main, -0.08);
      ctx.beginPath(); ctx.moveTo(-w * 0.36, hy + 12); ctx.quadraticCurveTo(-w * 0.5, hy - 14, -w * 0.62, hy - 30); ctx.quadraticCurveTo(-w * 0.1, hy - w * 0.5, w * 0.3, hy - w * 0.3);
      ctx.quadraticCurveTo(w * 0.52, hy, w * 0.36, hy + 16); ctx.quadraticCurveTo(0, hy + 24, -w * 0.36, hy + 12); ctx.closePath();
      ctx.fill(); ctx.stroke(); cel(ctx, -w * 0.05, hy - 4, w * 0.42, w * 0.4, glow);
      // void face
      ctx.fillStyle = '#07050f'; ctx.beginPath(); ctx.ellipse(w * 0.14, hy + 2, w * 0.22, w * 0.2, 0.1, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.fillStyle = pose.eyes === 'hurt' ? '#fff' : glow;
      for (const ex of [w * 0.06, w * 0.24]) {
        if (pose.eyes === 'closed' || pose.eyes === 'hurt') { ctx.fillRect(ex - 3, hy + 1, 7, 2); continue; }
        ctx.beginPath(); ctx.ellipse(ex, hy + 1, 3.4, pose.eyes === 'focus' ? 1.8 : 2.8, -0.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      for (let i = 0; i < 2; i++) {
        const a = time * 2.2 + i * Math.PI;
        if (Math.sin(a) <= 0) continue;
        rune(ctx, Math.cos(a) * w * 0.75, -h * 0.45 + Math.sin(a) * 8, glow);
      }
      break;
    }
    case 'mech': {
      // exhaust stacks
      for (const [ex, eh] of [[-w * 0.42, 22], [-w * 0.26, 16]]) {
        ctx.fillStyle = second; roundRect(ctx, ex - 5, -h * 0.78 - eh, 10, eh + 6, 3); ctx.fill(); ctx.stroke();
        ctx.save(); ctx.globalAlpha *= 0.4 + 0.25 * Math.sin(time * 18 + ex); ctx.fillStyle = glow;
        ctx.beginPath(); ctx.arc(ex, -h * 0.78 - eh - 5, 5 + Math.sin(time * 14 + ex) * 1.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
      ctx.fillStyle = main; roundRect(ctx, -w * 0.48, -h * 0.74, w * 0.96, h * 0.62, 15); ctx.fill(); ctx.stroke(); cel(ctx, 0, -h * 0.43, w * 0.48, h * 0.31, glow);
      // hazard band
      ctx.save(); roundRect(ctx, -w * 0.48, -h * 0.26, w * 0.96, h * 0.14, 8); ctx.fillStyle = second; ctx.fill(); ctx.clip();
      ctx.fillStyle = INK; for (let i = -5; i < 6; i++) { ctx.beginPath(); const x0 = i * 12; ctx.moveTo(x0, -h * 0.26); ctx.lineTo(x0 + 6, -h * 0.26); ctx.lineTo(x0 - 4, -h * 0.12); ctx.lineTo(x0 - 10, -h * 0.12); ctx.closePath(); ctx.fill(); }
      ctx.restore(); roundRect(ctx, -w * 0.48, -h * 0.26, w * 0.96, h * 0.14, 8); ctx.stroke();
      // rivets + reactor core
      ctx.fillStyle = INK; for (const [rx, ry] of [[-0.4, -0.66], [0.4, -0.66], [-0.4, -0.32], [0.4, -0.32]]) { ctx.beginPath(); ctx.arc(w * rx, h * ry, 2, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = shade(main, -0.35); ctx.beginPath(); ctx.arc(w * 0.14, -h * 0.44, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.fillStyle = glow; ctx.globalAlpha *= 0.75 + 0.25 * Math.sin(time * 6); ctx.beginPath(); ctx.arc(w * 0.14, -h * 0.44, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      // cockpit dome with pilot
      const hy = -h * 0.76;
      ctx.fillStyle = second; roundRect(ctx, -w * 0.3, hy - 2, w * 0.66, 9, 4); ctx.fill(); ctx.stroke();
      ctx.save();
      ctx.beginPath(); ctx.ellipse(w * 0.04, hy, w * 0.29, h * 0.2, 0, Math.PI, Math.PI * 2); ctx.closePath();
      const g = ctx.createLinearGradient(0, hy - h * 0.2, 0, hy);
      g.addColorStop(0, shade(glow, 0.7)); g.addColorStop(1, shade(glow, -0.2));
      ctx.fillStyle = g; ctx.globalAlpha *= 0.9; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
      ctx.restore();
      eyes(ctx, w * 0.0, hy - 7, 3.6, pose.eyes, time, 9.5, f.slot, INK);
      ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath(); ctx.ellipse(-w * 0.1, hy - h * 0.13, 6, 3, -0.5, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      break;
    }
    case 'serpent': {
      // coiled tail
      const sw = Math.sin(time * 4) * 4;
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.moveTo(-w * 0.5, -h * 0.1); ctx.quadraticCurveTo(-w * 1.05, -h * 0.12 + sw, -w * 0.98, -h * 0.4 - sw); ctx.quadraticCurveTo(-w * 0.92, -h * 0.2, -w * 0.48, -h * 0.22); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(-w * 0.04, -h * 0.13, w * 0.62, h * 0.14, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); cel(ctx, -w * 0.04, -h * 0.13, w * 0.62, h * 0.14, glow);
      ctx.save(); ctx.strokeStyle = shade(main, -0.4); ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(-w * 0.04, -h * 0.15, w * 0.38, h * 0.065, 0, Math.PI * 0.05, Math.PI * 0.95, true); ctx.stroke(); ctx.restore();
      // torso rising from the coil
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.moveTo(-w * 0.26, -h * 0.18); ctx.quadraticCurveTo(-w * 0.34, -h * 0.4, -w * 0.32, -h * 0.58); ctx.quadraticCurveTo(0, -h * 0.66, w * 0.32, -h * 0.58); ctx.quadraticCurveTo(w * 0.3, -h * 0.38, w * 0.26, -h * 0.18); ctx.closePath();
      ctx.fill(); ctx.stroke(); cel(ctx, 0, -h * 0.4, w * 0.32, h * 0.22, glow);
      // belly scales
      ctx.fillStyle = second; ctx.beginPath(); ctx.moveTo(w * 0.02, -h * 0.56); ctx.quadraticCurveTo(w * 0.3, -h * 0.38, w * 0.18, -h * 0.17); ctx.lineTo(-w * 0.02, -h * 0.17); ctx.quadraticCurveTo(w * 0.08, -h * 0.38, w * 0.02, -h * 0.56); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.strokeStyle = shade(second, -0.35); ctx.lineWidth = 1.6; for (let i = 1; i < 5; i++) { const yy = -h * (0.56 - i * 0.08); ctx.beginPath(); ctx.moveTo(w * 0.04, yy); ctx.lineTo(w * 0.2, yy - 1); ctx.stroke(); } ctx.restore();
      // cobra hood
      const hy = -h * 0.76;
      ctx.fillStyle = shade(main, -0.18);
      ctx.beginPath(); ctx.moveTo(-w * 0.1, hy + 26); ctx.quadraticCurveTo(-w * 0.62, hy + 14, -w * 0.5, hy - 12); ctx.quadraticCurveTo(-w * 0.34, hy - 32, -w * 0.02, hy - 26); ctx.quadraticCurveTo(w * 0.36, hy - 26, w * 0.4, hy + 6); ctx.quadraticCurveTo(w * 0.3, hy + 22, -w * 0.1, hy + 26); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.save(); ctx.strokeStyle = second; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(-w * 0.4, hy + 8); ctx.quadraticCurveTo(-w * 0.4, hy - 18, -w * 0.12, hy - 20); ctx.stroke();
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(-w * 0.32, hy - 4, 3, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      ctx.fillStyle = main; ctx.beginPath(); ctx.ellipse(w * 0.1, hy, w * 0.27, w * 0.25, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); cel(ctx, w * 0.1, hy, w * 0.27, w * 0.25, glow);
      // crown
      ctx.fillStyle = second;
      ctx.beginPath(); const cy = hy - w * 0.2; ctx.moveTo(-w * 0.08, cy + 4); ctx.lineTo(-w * 0.1, cy - 9); ctx.lineTo(-w * 0.0, cy - 2); ctx.lineTo(w * 0.08, cy - 14); ctx.lineTo(w * 0.16, cy - 2); ctx.lineTo(w * 0.27, cy - 9); ctx.lineTo(w * 0.25, cy + 5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(w * 0.08, cy - 2, 2.6, 0, Math.PI * 2); ctx.fill();
      eyes(ctx, w * 0.04, hy - 1, 4, pose.eyes, time, 10, f.slot, glow);
      // forked tongue flick
      if (Math.floor(time * 2 + f.slot) % 3 === 0) {
        ctx.save(); ctx.strokeStyle = '#d0344f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(w * 0.34, hy + 7); ctx.lineTo(w * 0.5, hy + 8); ctx.lineTo(w * 0.56, hy + 5); ctx.moveTo(w * 0.5, hy + 8); ctx.lineTo(w * 0.56, hy + 11); ctx.stroke(); ctx.restore();
      }
      break;
    }
    case 'bear': {
      ctx.fillStyle = main; ctx.beginPath(); ctx.ellipse(0, -h * 0.4, w * 0.5, h * 0.36, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); cel(ctx, 0, -h * 0.4, w * 0.5, h * 0.36, glow);
      // monk robe: skirt + diagonal sash
      ctx.save(); ctx.beginPath(); ctx.ellipse(0, -h * 0.4, w * 0.5, h * 0.36, 0, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = second; ctx.fillRect(-w * 0.6, -h * 0.24, w * 1.2, h * 0.24);
      ctx.beginPath(); ctx.moveTo(-w * 0.5, -h * 0.66); ctx.lineTo(-w * 0.22, -h * 0.74); ctx.lineTo(w * 0.55, -h * 0.26); ctx.lineTo(w * 0.3, -h * 0.18); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(6,8,22,0.22)'; ctx.fillRect(-w * 0.6, -h * 0.24, w * 0.5, h * 0.24);
      ctx.restore();
      ctx.save(); ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(-w * 0.49, -h * 0.24); ctx.lineTo(w * 0.49, -h * 0.24); ctx.moveTo(-w * 0.22, -h * 0.74); ctx.lineTo(w * 0.52, -h * 0.28); ctx.stroke(); ctx.restore();
      ctx.beginPath(); ctx.ellipse(0, -h * 0.4, w * 0.5, h * 0.36, 0, 0, Math.PI * 2); ctx.stroke();
      const hy = -h * 0.8;
      // prayer beads
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI * (0.12 + i * 0.095);
        const bx = Math.cos(a) * w * 0.32 + w * 0.02, byy = hy + 14 + Math.sin(a) * 12;
        ctx.fillStyle = i === 4 ? glow : shade(second, -0.45); ctx.beginPath(); ctx.arc(bx, byy, i === 4 ? 4.5 : 3.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = main;
      for (const ex of [-w * 0.22, w * 0.22]) { ctx.beginPath(); ctx.arc(ex, hy - w * 0.22, 7.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.save(); ctx.fillStyle = shade(main, -0.4); ctx.beginPath(); ctx.arc(ex, hy - w * 0.22, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
      ctx.beginPath(); ctx.ellipse(w * 0.03, hy, w * 0.31, w * 0.28, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); cel(ctx, w * 0.03, hy, w * 0.31, w * 0.28, glow);
      ctx.fillStyle = shade(main, 0.35); ctx.beginPath(); ctx.ellipse(w * 0.24, hy + 5, 10, 7.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = INK; ctx.beginPath(); ctx.ellipse(w * 0.3, hy + 2, 3.6, 2.6, 0, 0, Math.PI * 2); ctx.fill();
      eyes(ctx, -w * 0.06, hy - 4, 3.8, pose.eyes, time, 10, f.slot, glow);
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(w * 0.04, hy - 12, 2.2, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'valkyrie': {
      // feathered wings
      const flap = Math.sin(time * (f.grounded ? 3 : 9)) * (f.grounded ? 0.06 : 0.22);
      ctx.save(); ctx.translate(-w * 0.22, -h * 0.52);
      for (let i = 0; i < 5; i++) {
        ctx.save(); ctx.rotate(-3.05 + i * 0.27 + flap * (1 - i * 0.15));
        ctx.fillStyle = i % 2 ? shade(second, -0.14) : second;
        const L = 30 + i * 6;
        ctx.beginPath(); ctx.ellipse(L * 0.55, 0, L * 0.6, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
      }
      ctx.fillStyle = shade(second, -0.25); ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
      // braid
      const hy = -h * 0.75;
      ctx.fillStyle = shade(second, 0.25);
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(-w * 0.32 - Math.sin(time * 4 + i) * 1.5, hy + 8 + i * 9, 5, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
      ctx.fillStyle = main; torsoPath(ctx, w, h, 0.52, 0.06, 0.34, 0.2); ctx.fill(); ctx.stroke(); cel(ctx, 0, -h * 0.3, w * 0.36, h * 0.25, glow);
      // breastplate + belt + tassets
      ctx.fillStyle = second;
      ctx.beginPath(); ctx.moveTo(-w * 0.26, -h * 0.53); ctx.quadraticCurveTo(w * 0.04, -h * 0.58, w * 0.32, -h * 0.52); ctx.quadraticCurveTo(w * 0.28, -h * 0.36, w * 0.04, -h * 0.32); ctx.quadraticCurveTo(-w * 0.2, -h * 0.36, -w * 0.26, -h * 0.53); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = shade(main, -0.35); ctx.fillRect(-w * 0.32, -h * 0.24, w * 0.66, 6); ctx.strokeRect(-w * 0.32, -h * 0.24, w * 0.66, 6);
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(w * 0.02, -h * 0.21, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // face + winged helm
      ctx.fillStyle = '#efcfb4'; ctx.beginPath(); ctx.ellipse(w * 0.02, hy, w * 0.31, w * 0.3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); cel(ctx, w * 0.02, hy, w * 0.31, w * 0.3, glow);
      eyes(ctx, w * 0.0, hy + 1, 4, pose.eyes, time, 10.5, f.slot, glow);
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.moveTo(-w * 0.33, hy + 2); ctx.quadraticCurveTo(-w * 0.34, hy - w * 0.42, w * 0.04, hy - w * 0.4); ctx.quadraticCurveTo(w * 0.38, hy - w * 0.38, w * 0.36, hy - 5); ctx.lineTo(w * 0.18, hy - 6); ctx.lineTo(w * 0.14, hy + 6); ctx.lineTo(w * 0.08, hy - 6); ctx.lineTo(-w * 0.12, hy - 6); ctx.lineTo(-w * 0.16, hy + 4); ctx.closePath();
      ctx.fill(); ctx.stroke(); cel(ctx, 0, hy - 8, w * 0.34, w * 0.24, glow);
      ctx.save(); ctx.translate(-w * 0.24, hy - 10); ctx.fillStyle = second;
      for (let i = 0; i < 3; i++) { ctx.save(); ctx.rotate(-2.2 + i * 0.32); ctx.beginPath(); ctx.ellipse(10, 0, 11 - i * 2, 3.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore(); }
      ctx.restore();
      break;
    }
    case 'demon': {
      // flame mane
      ctx.save();
      for (let i = 0; i < 4; i++) {
        const fx = -w * 0.32 + i * w * 0.14, fl = 22 + Math.sin(time * 11 + i * 2) * 5 + (i % 2) * 6;
        ctx.fillStyle = i % 2 ? second : glow;
        ctx.beginPath(); ctx.moveTo(fx - 9, -h * 0.74); ctx.quadraticCurveTo(fx - 8, -h * 0.74 - fl * 0.7, fx - 2 + Math.sin(time * 9 + i) * 3, -h * 0.74 - fl - 8); ctx.quadraticCurveTo(fx + 8, -h * 0.74 - fl * 0.5, fx + 9, -h * 0.74); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
      // hulking torso
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.moveTo(-w * 0.5, -h * 0.66); ctx.quadraticCurveTo(-w * 0.2, -h * 0.84, w * 0.42, -h * 0.68);
      ctx.quadraticCurveTo(w * 0.58, -h * 0.46, w * 0.3, -h * 0.08); ctx.lineTo(-w * 0.3, -h * 0.08); ctx.quadraticCurveTo(-w * 0.58, -h * 0.4, -w * 0.5, -h * 0.66); ctx.closePath();
      ctx.fill(); ctx.stroke(); cel(ctx, 0, -h * 0.42, w * 0.5, h * 0.36, glow);
      // magma veins
      ctx.save(); ctx.lineCap = 'round';
      const vein = (pts: number[][]) => {
        for (const [col, lw] of [[second, 5], [glow, 2]] as const) {
          ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(w * x, h * y) : ctx.moveTo(w * x, h * y))); ctx.stroke();
        }
      };
      vein([[-0.3, -0.6], [-0.12, -0.46], [-0.24, -0.32], [-0.06, -0.16]]);
      vein([[0.3, -0.58], [0.16, -0.42], [0.28, -0.26]]);
      ctx.restore();
      // head with horns
      const hy = -h * 0.74, hx = w * 0.14;
      horn(ctx, hx - w * 0.14, hy - 8, -1, 1.15, '#d8c9ad');
      ctx.fillStyle = main; ctx.beginPath(); ctx.ellipse(hx, hy, w * 0.25, w * 0.23, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); cel(ctx, hx, hy, w * 0.25, w * 0.23, glow);
      horn(ctx, hx + w * 0.12, hy - 9, 1, 1, '#ece0c8');
      eyes(ctx, hx - w * 0.07, hy - 2, 4, pose.eyes === 'open' ? 'focus' : pose.eyes, time, 10.5, f.slot, glow);
      ctx.fillStyle = '#fff';
      for (const tx of [hx + w * 0.02, hx + w * 0.14]) { ctx.beginPath(); ctx.moveTo(tx - 3, hy + 9); ctx.lineTo(tx, hy + 3); ctx.lineTo(tx + 3, hy + 9); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      ctx.save(); ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(hx - w * 0.06, hy + 9); ctx.lineTo(hx + w * 0.2, hy + 9); ctx.stroke(); ctx.restore();
      break;
    }
    case 'crow': {
      // tail feathers
      ctx.fillStyle = shade(main, -0.15);
      for (let i = 0; i < 3; i++) { ctx.save(); ctx.translate(-w * 0.26, -h * 0.3); ctx.rotate(3.3 + i * 0.25 + Math.sin(time * 5) * 0.05); ctx.beginPath(); ctx.ellipse(14, 0, 16, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore(); }
      // body + poncho
      ctx.fillStyle = main; torsoPath(ctx, w, h, 0.5, 0.06, 0.3, 0.18); ctx.fill(); ctx.stroke();
      ctx.fillStyle = second;
      const sway = Math.sin(time * 4) * 2;
      ctx.beginPath(); ctx.moveTo(-w * 0.26, -h * 0.58); ctx.quadraticCurveTo(0, -h * 0.64, w * 0.28, -h * 0.58); ctx.lineTo(w * 0.56, -h * 0.24 + sway); ctx.lineTo(-w * 0.5, -h * 0.22 - sway); ctx.closePath();
      ctx.fill(); ctx.stroke(); cel(ctx, 0, -h * 0.4, w * 0.5, h * 0.2, glow);
      ctx.save(); ctx.beginPath(); ctx.moveTo(-w * 0.26, -h * 0.58); ctx.quadraticCurveTo(0, -h * 0.64, w * 0.28, -h * 0.58); ctx.lineTo(w * 0.56, -h * 0.24 + sway); ctx.lineTo(-w * 0.5, -h * 0.22 - sway); ctx.closePath(); ctx.clip();
      ctx.strokeStyle = glow; ctx.lineWidth = 2.4; ctx.beginPath();
      for (let i = 0; i <= 10; i++) ctx.lineTo(-w * 0.5 + i * w * 0.106, -h * 0.31 + (i % 2 ? -5 : 0)); ctx.stroke();
      ctx.restore();
      // bandana
      ctx.fillStyle = shade(glow, -0.45); ctx.beginPath(); ctx.moveTo(-w * 0.2, -h * 0.6); ctx.lineTo(w * 0.24, -h * 0.6); ctx.lineTo(w * 0.04, -h * 0.5); ctx.closePath(); ctx.fill(); ctx.stroke();
      // head + beak
      const hy = -h * 0.74;
      ctx.fillStyle = main; ctx.beginPath(); ctx.ellipse(0, hy, w * 0.32, w * 0.3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); cel(ctx, 0, hy, w * 0.32, w * 0.3, glow);
      ctx.fillStyle = '#4b4f5c';
      ctx.beginPath(); ctx.moveTo(w * 0.16, hy - 5); ctx.quadraticCurveTo(w * 0.6, hy - 6, w * 0.86, hy + 6); ctx.quadraticCurveTo(w * 0.55, hy + 6, w * 0.18, hy + 9); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(w * 0.24, hy - 2); ctx.quadraticCurveTo(w * 0.55, hy - 2, w * 0.74, hy + 3); ctx.stroke(); ctx.restore();
      eyes(ctx, -w * 0.06, hy - 2, 4, pose.eyes, time, 10, f.slot, glow);
      // wide-brim hat
      ctx.save(); ctx.translate(0, hy - w * 0.2); ctx.rotate(-0.08);
      ctx.fillStyle = shade(second, -0.3);
      roundRect(ctx, -w * 0.26, -19, w * 0.52, 21, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = glow; ctx.fillRect(-w * 0.26, -6, w * 0.52, 4);
      ctx.fillStyle = shade(second, -0.3); ctx.beginPath(); ctx.ellipse(0, 1, w * 0.64, 5.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = shade(main, -0.1); ctx.beginPath(); ctx.ellipse(-w * 0.3, -12, 3, 11, -0.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
      break;
    }
    case 'panther': {
      // long cyber tail
      const tw = Math.sin(time * 4) * 6;
      const tail = () => { ctx.beginPath(); ctx.moveTo(-w * 0.3, -h * 0.2); ctx.bezierCurveTo(-w * 0.9, -h * 0.1 + tw, -w * 1.1, -h * 0.6 - tw, -w * 0.78, -h * 0.82 + tw * 0.5); };
      ctx.save(); ctx.lineWidth = 10; tail(); ctx.stroke(); ctx.strokeStyle = main; ctx.lineWidth = 5.5; tail(); ctx.stroke(); ctx.restore();
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(-w * 0.78, -h * 0.82 + tw * 0.5, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = main; torsoPath(ctx, w, h, 0.5, 0.06, 0.36, 0.2); ctx.fill(); ctx.stroke(); cel(ctx, 0, -h * 0.3, w * 0.38, h * 0.26, glow);
      ctx.fillStyle = second; ctx.beginPath(); ctx.ellipse(w * 0.12, -h * 0.3, w * 0.14, h * 0.15, 0, 0, Math.PI * 2); ctx.fill();
      // circuit lines
      ctx.save(); ctx.strokeStyle = glow; ctx.lineWidth = 2; ctx.globalAlpha *= 0.9;
      ctx.beginPath(); ctx.moveTo(-w * 0.3, -h * 0.44); ctx.lineTo(-w * 0.12, -h * 0.44); ctx.lineTo(-w * 0.04, -h * 0.34); ctx.lineTo(-w * 0.04, -h * 0.16);
      ctx.moveTo(-w * 0.32, -h * 0.28); ctx.lineTo(-w * 0.18, -h * 0.28); ctx.stroke();
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(-w * 0.04, -h * 0.15, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // head
      const hy = -h * 0.72;
      ctx.fillStyle = main;
      for (const ex of [-w * 0.22, w * 0.1]) { ctx.beginPath(); ctx.moveTo(ex - 8, hy - 8); ctx.quadraticCurveTo(ex - 4, hy - 26, ex + 1, hy - 28); ctx.quadraticCurveTo(ex + 7, hy - 18, ex + 9, hy - 9); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.save(); ctx.fillStyle = glow; ctx.globalAlpha *= 0.6; ctx.beginPath(); ctx.moveTo(ex - 3, hy - 10); ctx.lineTo(ex + 1, hy - 22); ctx.lineTo(ex + 5, hy - 10); ctx.closePath(); ctx.fill(); ctx.restore(); }
      ctx.beginPath(); ctx.ellipse(0, hy, w * 0.36, w * 0.3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); cel(ctx, 0, hy, w * 0.36, w * 0.3, glow);
      ctx.fillStyle = second; ctx.beginPath(); ctx.ellipse(w * 0.26, hy + 6, w * 0.15, w * 0.11, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = INK; ctx.beginPath(); ctx.moveTo(w * 0.33, hy + 1); ctx.lineTo(w * 0.41, hy + 1); ctx.lineTo(w * 0.37, hy + 5); ctx.closePath(); ctx.fill();
      eyes(ctx, -w * 0.08, hy - 4, 4, pose.eyes, time, 11, f.slot, glow);
      // visor
      ctx.save(); ctx.globalAlpha *= 0.42; ctx.fillStyle = glow; roundRect(ctx, -w * 0.24, hy - 10, w * 0.6, 11, 5); ctx.fill(); ctx.restore();
      ctx.save(); ctx.lineWidth = 2; roundRect(ctx, -w * 0.24, hy - 10, w * 0.6, 11, 5); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.moveTo(-w * 0.16, hy - 7); ctx.lineTo(w * 0.04, hy - 7); ctx.stroke(); ctx.restore();
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(w * 0.3, hy + 8); ctx.lineTo(w * 0.52, hy + 6); ctx.moveTo(w * 0.3, hy + 10); ctx.lineTo(w * 0.5, hy + 12); ctx.stroke(); ctx.restore();
      break;
    }
    case 'colossus': {
      // drifting sand
      ctx.save(); ctx.fillStyle = glow;
      for (let i = 0; i < 7; i++) {
        const a = time * (0.8 + i * 0.13) + i * 1.9;
        ctx.globalAlpha = 0.35 + 0.3 * Math.sin(a * 2);
        ctx.beginPath(); ctx.arc(Math.cos(a) * w * 0.7, -h * 0.5 + Math.sin(a * 1.3) * h * 0.4, 1.8 + (i % 3), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      // tall block body
      const bodyPath = () => { ctx.beginPath(); ctx.moveTo(-w * 0.42, -h * 0.7); ctx.lineTo(w * 0.42, -h * 0.7); ctx.lineTo(w * 0.5, -h * 0.08); ctx.lineTo(-w * 0.5, -h * 0.08); ctx.closePath(); };
      ctx.fillStyle = main; bodyPath(); ctx.fill(); ctx.stroke(); cel(ctx, 0, -h * 0.4, w * 0.48, h * 0.32, glow);
      ctx.save(); bodyPath(); ctx.clip(); ctx.strokeStyle = shade(main, -0.35); ctx.lineWidth = 2;
      for (const [y, off] of [[-0.52, 0], [-0.34, 0.5], [-0.17, 0]]) {
        ctx.beginPath(); ctx.moveTo(-w, h * y); ctx.lineTo(w, h * y); ctx.stroke();
        for (let i = -2; i <= 2; i++) { const x = (i + off) * w * 0.32; ctx.beginPath(); ctx.moveTo(x, h * y); ctx.lineTo(x, h * y - h * 0.17); ctx.stroke(); }
      }
      ctx.restore();
      // sun glyph
      ctx.save(); ctx.fillStyle = glow; ctx.strokeStyle = INK; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(w * 0.08, -h * 0.43, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = glow; ctx.lineWidth = 2.4;
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(w * 0.08 + Math.cos(a) * 10, -h * 0.43 + Math.sin(a) * 10); ctx.lineTo(w * 0.08 + Math.cos(a) * 14, -h * 0.43 + Math.sin(a) * 14); ctx.stroke(); }
      ctx.restore();
      // nemes headdress
      const hy = -h * 0.84;
      const nemes = () => { ctx.beginPath(); ctx.moveTo(-w * 0.2, hy - h * 0.15); ctx.quadraticCurveTo(w * 0.04, hy - h * 0.2, w * 0.28, hy - h * 0.15); ctx.lineTo(w * 0.38, hy + h * 0.17); ctx.lineTo(w * 0.22, hy + h * 0.17); ctx.lineTo(w * 0.18, hy); ctx.lineTo(-w * 0.12, hy); ctx.lineTo(-w * 0.18, hy + h * 0.17); ctx.lineTo(-w * 0.34, hy + h * 0.17); ctx.closePath(); };
      ctx.fillStyle = second; nemes(); ctx.fill(); ctx.stroke();
      ctx.save(); nemes(); ctx.clip(); ctx.strokeStyle = main; ctx.lineWidth = 3.2;
      for (let i = -3; i < 6; i++) { const yy = hy - h * 0.16 + i * 7; ctx.beginPath(); ctx.moveTo(-w * 0.5, yy); ctx.lineTo(w * 0.5, yy + 4); ctx.stroke(); }
      ctx.restore(); nemes(); ctx.stroke();
      ctx.fillStyle = main; roundRect(ctx, -w * 0.12, hy - h * 0.08, w * 0.3, h * 0.2, 6); ctx.fill(); ctx.stroke(); cel(ctx, w * 0.03, hy + h * 0.02, w * 0.15, h * 0.1, glow);
      ctx.save(); ctx.fillStyle = pose.eyes === 'hurt' ? '#fff' : glow; const eh = pose.eyes === 'closed' ? 2 : 5;
      ctx.fillRect(-w * 0.06, hy - 3, 7, eh); ctx.fillRect(w * 0.07, hy - 3, 7, eh); ctx.restore();
      ctx.fillStyle = second; roundRect(ctx, w * 0.0, hy + h * 0.11, 8, 10, 3); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(w * 0.04, hy - h * 0.13, 3.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
      break;
    }
    case 'shark': {
      // tail fin
      ctx.fillStyle = main;
      const tw = Math.sin(time * 5) * 0.12;
      ctx.save(); ctx.translate(-w * 0.32, -h * 0.18); ctx.rotate(tw);
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.quadraticCurveTo(-20, -16, -32, -32); ctx.quadraticCurveTo(-22, -6, -26, 12); ctx.quadraticCurveTo(-12, 2, 0, 6); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
      // dorsal fin
      ctx.beginPath(); ctx.moveTo(-w * 0.3, -h * 0.84); ctx.quadraticCurveTo(-w * 0.36, -h * 1.0, -w * 0.48, -h * 1.12); ctx.quadraticCurveTo(-w * 0.1, -h * 1.06, w * 0.06, -h * 0.92); ctx.closePath(); ctx.fill(); ctx.stroke();
      const bodyPath = () => { ctx.beginPath(); ctx.moveTo(-w * 0.36, -h * 0.08); ctx.quadraticCurveTo(-w * 0.52, -h * 0.6, -w * 0.18, -h * 0.9); ctx.quadraticCurveTo(w * 0.3, -h * 1.02, w * 0.62, -h * 0.72); ctx.quadraticCurveTo(w * 0.6, -h * 0.58, w * 0.42, -h * 0.54); ctx.quadraticCurveTo(w * 0.42, -h * 0.25, w * 0.3, -h * 0.08); ctx.closePath(); };
      bodyPath(); ctx.fill(); ctx.stroke(); cel(ctx, 0, -h * 0.5, w * 0.48, h * 0.42, glow);
      ctx.save(); bodyPath(); ctx.clip();
      ctx.fillStyle = second; ctx.beginPath(); ctx.moveTo(w * 0.7, -h * 0.68); ctx.quadraticCurveTo(w * 0.2, -h * 0.6, w * 0.06, -h * 0.4); ctx.quadraticCurveTo(-w * 0.04, -h * 0.2, 0, -h * 0.02); ctx.lineTo(w * 0.6, -h * 0.02); ctx.closePath(); ctx.fill();
      ctx.restore(); bodyPath(); ctx.stroke();
      // grin with teeth
      const my = -h * 0.6;
      ctx.fillStyle = '#3a0f1e'; ctx.beginPath(); ctx.moveTo(w * 0.12, my); ctx.quadraticCurveTo(w * 0.36, my + 12, w * 0.54, my - 4); ctx.quadraticCurveTo(w * 0.34, my + 3, w * 0.12, my); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.save(); ctx.lineWidth = 1.4;
      for (let i = 0; i < 5; i++) { const tx = w * (0.17 + i * 0.07); const ty = my + 1 + Math.sin((i / 4) * Math.PI) * 3; ctx.beginPath(); ctx.moveTo(tx - 3, ty - 1); ctx.lineTo(tx, ty + 4); ctx.lineTo(tx + 3, ty - 1); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      ctx.restore();
      // gills
      ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = shade(main, -0.45);
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-w * 0.04 - i * 6, -h * 0.66); ctx.quadraticCurveTo(-w * 0.08 - i * 6, -h * 0.58, -w * 0.04 - i * 6, -h * 0.5); ctx.stroke(); }
      ctx.restore();
      eyes(ctx, w * 0.14, -h * 0.76, 3.8, pose.eyes, time, 10, f.slot, glow);
      highlight(ctx, -w * 0.18, -h * 0.76, 8, 5);
      break;
    }
    case 'witch': {
      const hy = -h * 0.7;
      // hair
      ctx.fillStyle = second;
      const hw = Math.sin(time * 3) * 3;
      ctx.beginPath(); ctx.moveTo(-w * 0.3, hy - 8); ctx.quadraticCurveTo(-w * 0.62, hy + 14 + hw, -w * 0.5, hy + 40); ctx.quadraticCurveTo(-w * 0.3, hy + 30, -w * 0.12, hy + 34 - hw); ctx.lineTo(w * 0.1, hy + 6); ctx.closePath(); ctx.fill(); ctx.stroke();
      // tattered dress
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.moveTo(-w * 0.24, -h * 0.58); ctx.quadraticCurveTo(0, -h * 0.62, w * 0.26, -h * 0.58); ctx.lineTo(w * 0.2, -h * 0.4);
      ctx.quadraticCurveTo(w * 0.5, -h * 0.2, w * 0.6, -h * 0.04);
      for (let i = 1; i <= 6; i++) ctx.lineTo(w * 0.6 - (w * 1.2 * i) / 6 + (i % 2 ? w * 0.1 : 0), -h * (i % 2 ? 0.0 : 0.08));
      ctx.quadraticCurveTo(-w * 0.5, -h * 0.2, -w * 0.2, -h * 0.4); ctx.closePath();
      ctx.fill(); ctx.stroke(); cel(ctx, 0, -h * 0.28, w * 0.55, h * 0.3, glow);
      ctx.fillStyle = shade(main, -0.35); ctx.fillRect(-w * 0.22, -h * 0.42, w * 0.44, 5); ctx.strokeRect(-w * 0.22, -h * 0.42, w * 0.44, 5);
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, -h * 0.4, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // pale face
      ctx.fillStyle = '#ece3ea'; ctx.beginPath(); ctx.ellipse(w * 0.04, hy, w * 0.3, w * 0.3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); cel(ctx, w * 0.04, hy, w * 0.3, w * 0.3, glow);
      ctx.fillStyle = second; ctx.beginPath(); ctx.moveTo(-w * 0.26, hy - 2); ctx.quadraticCurveTo(-w * 0.16, hy - w * 0.32, w * 0.06, hy - w * 0.28); ctx.quadraticCurveTo(-w * 0.12, hy - 8, -w * 0.26, hy - 2); ctx.fill(); ctx.stroke();
      eyes(ctx, w * 0.0, hy + 2, 3.9, pose.eyes, time, 10, f.slot, glow);
      ctx.save(); ctx.fillStyle = 'rgba(255,110,140,0.35)'; ctx.beginPath(); ctx.arc(w * 0.28, hy + 8, 3, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      // crooked hat
      const by = hy - w * 0.3;
      const tip = Math.sin(time * 2.5) * 3;
      ctx.fillStyle = main;
      ctx.beginPath(); ctx.moveTo(-w * 0.32, by); ctx.quadraticCurveTo(-w * 0.16, by - 18, -w * 0.12, by - 32); ctx.lineTo(-w * 0.5 + tip, by - 50); ctx.lineTo(w * 0.06, by - 34); ctx.quadraticCurveTo(w * 0.14, by - 16, w * 0.32, by); ctx.closePath();
      ctx.fill(); ctx.stroke(); cel(ctx, 0, by - 18, w * 0.3, 20, glow);
      ctx.fillStyle = glow; ctx.beginPath(); ctx.moveTo(-w * 0.28, by - 4); ctx.lineTo(w * 0.3, by - 4); ctx.lineTo(w * 0.24, by - 11); ctx.lineTo(-w * 0.22, by - 11); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = main; ctx.beginPath(); ctx.ellipse(w * 0.02, by, w * 0.66, 5.5, -0.04, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // floating spirit flames
      for (let i = 0; i < 2; i++) {
        const a = time * 1.6 + i * Math.PI;
        const sx = -w * 0.55 + Math.cos(a) * 6 + i * w * 1.15, sy = -h * 0.55 + Math.sin(a * 1.4) * 8 - i * 6;
        ctx.save(); ctx.globalAlpha *= 0.85; ctx.fillStyle = glow; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx, sy - 9); ctx.quadraticCurveTo(sx + 6, sy - 1, sx, sy + 4); ctx.quadraticCurveTo(sx - 6, sy - 1, sx, sy - 9); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx, sy, 1.8, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
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
  if (p.kind.startsWith('sp_')) { drawSpellProjectile(ctx, p, time); ctx.restore(); return; }
  switch (p.kind) {
    case 'fireball': {
      for (let i = 4; i > 0; i--) {
        ctx.fillStyle = i % 2 ? '#ff6a2b' : '#ffd23f';
        ctx.globalAlpha = 0.25 * i;
        ctx.beginPath(); ctx.arc(-p.vx * i * 1.2, -p.vy * i, r * (1 - i * 0.12), 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1; 
      ctx.fillStyle = '#ff8a00'; ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(0, 0, r * 1.7, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
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
      ctx.fillStyle = glow; 
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.8, r * 0.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    }
    case 'orb': {
      
      ctx.fillStyle = glow; ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.arc(0, 0, r * 1.8, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
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
      
      ctx.beginPath(); ctx.arc(p.kind === 'mine' ? 0 : r * 0.5, p.kind === 'mine' ? 0 : -r * 0.8, 4, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'shock': {
      ctx.fillStyle = glow; ctx.globalAlpha = Math.min(1, p.life / 10);
      ctx.beginPath(); ctx.moveTo(-r, r); ctx.quadraticCurveTo(0, -r * 1.6, r, r); ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'slashwave': {
      ctx.scale(p.vx < 0 ? -1 : 1, 1);
      ctx.globalAlpha = Math.min(1, p.life / 8);
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(-r * 0.4, 0, r * 1.35, -1.25, 1.25); ctx.arc(-r * 1.1, 0, r * 1.2, 1.0, -1.0, true); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath(); ctx.arc(-r * 0.4, 0, r * 1.2, -0.9, 0.9); ctx.arc(-r * 0.8, 0, r * 1.05, 0.75, -0.75, true); ctx.closePath(); ctx.fill();
      break;
    }
    case 'venom': case 'icicle': case 'bolt': {
      ctx.rotate(Math.atan2(p.vy, p.vx));
      if (p.kind === 'venom') {
        ctx.fillStyle = shade(glow, -0.15); ctx.globalAlpha = 0.4; ctx.beginPath(); ctx.arc(-r * 1.6, 0, r * 0.5, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        ctx.fillStyle = glow; ctx.beginPath(); ctx.moveTo(r * 1.3, 0); ctx.quadraticCurveTo(0, -r * 1.1, -r, 0); ctx.quadraticCurveTo(0, r * 1.1, r * 1.3, 0); ctx.fill(); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(r * 0.2, -r * 0.3, r * 0.25, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'icicle') {
        ctx.fillStyle = '#e4f7ff'; ctx.beginPath(); ctx.moveTo(r * 1.9, 0); ctx.lineTo(-r * 0.6, -r * 0.6); ctx.lineTo(-r * 1.5, 0); ctx.lineTo(-r * 0.6, r * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = glow; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-r * 1.1, 0); ctx.lineTo(r * 1.4, 0); ctx.stroke();
      } else {
        ctx.fillStyle = glow; ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.ellipse(0, 0, r * 2.4, r * 0.9, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        ctx.fillStyle = '#fffbe0'; ctx.lineWidth = 2.4; ctx.beginPath();
        ctx.moveTo(r * 2, 0); ctx.lineTo(r * 0.6, -r * 0.5); ctx.lineTo(r * 0.3, -r * 0.1); ctx.lineTo(-r * 1.8, -r * 0.35); ctx.lineTo(-r * 0.2, r * 0.15); ctx.lineTo(-r * 0.5, r * 0.5); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      break;
    }
    case 'sandtrap': {
      const armed = p.life < p.def.life - 30;
      ctx.fillStyle = '#b8935c'; ctx.beginPath(); ctx.ellipse(0, r * 0.45, r * 1.3, r * 0.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = armed && Math.floor(time * 5) % 2 ? glow : '#6b5132'; ctx.lineWidth = 2;
      ctx.beginPath(); for (let i = 0; i < 18; i++) { const a = time * 6 + i * 0.6; const rr = (i / 18) * r * 1.1; ctx.lineTo(Math.cos(a) * rr, r * 0.45 + Math.sin(a) * rr * 0.38); } ctx.stroke();
      break;
    }
    case 'icewall': {
      ctx.globalAlpha = Math.min(1, p.life / 10);
      for (const [dx, hh, ww] of [[-r * 0.6, r * 1.3, r * 0.5], [r * 0.55, r * 1.1, r * 0.45], [0, r * 1.9, r * 0.6]] as const) {
        ctx.fillStyle = '#d7f3ff';
        ctx.beginPath(); ctx.moveTo(dx - ww, r); ctx.lineTo(dx - ww, r - hh * 0.75); ctx.lineTo(dx, r - hh); ctx.lineTo(dx + ww, r - hh * 0.75); ctx.lineTo(dx + ww, r); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = glow; ctx.globalAlpha *= 0.55; ctx.beginPath(); ctx.moveTo(dx, r - hh); ctx.lineTo(dx + ww, r - hh * 0.75); ctx.lineTo(dx + ww, r); ctx.lineTo(dx, r); ctx.closePath(); ctx.fill(); ctx.globalAlpha = Math.min(1, p.life / 10);
      }
      break;
    }
    case 'shadowbolt': case 'comet': {
      const a = Math.atan2(p.vy, p.vx);
      for (let i = 1; i <= 4; i++) { ctx.globalAlpha = 0.5 - i * 0.1; ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(-Math.cos(a) * i * r * 0.7, -Math.sin(a) * i * r * 0.7, r * (1 - i * 0.16), 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#140a26'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = glow; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(r * 0.25, -r * 0.25, r * 0.28, 0, Math.PI * 2); ctx.fill();
      if (p.kind === 'comet') { ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, r * 1.25, time * 8, time * 8 + 2); ctx.stroke(); }
      break;
    }
    case 'fist': case 'missile': {
      ctx.rotate(Math.atan2(p.vy, p.vx));
      const flick = Math.random() * 4;
      ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.moveTo(-r * 0.9, -r * 0.45); ctx.lineTo(-r * 2.2 - flick, 0); ctx.lineTo(-r * 0.9, r * 0.45); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#fff3c4'; ctx.beginPath(); ctx.moveTo(-r * 0.9, -r * 0.22); ctx.lineTo(-r * 1.6 - flick, 0); ctx.lineTo(-r * 0.9, r * 0.22); ctx.closePath(); ctx.fill();
      if (p.kind === 'fist') {
        ctx.fillStyle = '#8a94a3'; roundRect(ctx, -r, -r * 0.85, r * 1.9, r * 1.7, r * 0.5); ctx.fill(); ctx.stroke();
        ctx.lineWidth = 2; for (const yy of [-0.35, 0.05, 0.45]) { ctx.beginPath(); ctx.moveTo(r * 0.45, r * yy - 3); ctx.lineTo(r * 0.85, r * yy - 3); ctx.stroke(); }
        ctx.fillStyle = glow; ctx.fillRect(-r * 0.9, -r * 0.85, 4, r * 1.7);
      } else {
        ctx.fillStyle = '#dfe4ec'; roundRect(ctx, -r, -r * 0.45, r * 1.7, r * 0.9, r * 0.4); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#e8424f'; ctx.beginPath(); ctx.moveTo(r * 0.6, -r * 0.45); ctx.quadraticCurveTo(r * 1.4, 0, r * 0.6, r * 0.45); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = glow; ctx.fillRect(-r * 0.5, -r * 0.45, 3, r * 0.9);
      }
      break;
    }
    case 'snake': {
      ctx.scale(p.vx < 0 ? -1 : 1, 1);
      const ph = time * 14;
      const pts: V[] = []; for (let i = 0; i <= 8; i++) pts.push({ x: -i * r * 0.45, y: Math.sin(ph - i * 0.9) * r * 0.35 * (i / 8 + 0.3) });
      ctx.lineWidth = r * 0.95 + 3; ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke();
      ctx.strokeStyle = shade(glow, -0.35); ctx.lineWidth = r * 0.95; ctx.stroke();
      ctx.lineWidth = 2.6; ctx.strokeStyle = INK;
      ctx.fillStyle = shade(glow, -0.2); ctx.beginPath(); ctx.ellipse(r * 0.3, pts[0].y, r * 0.75, r * 0.55, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#ffe066'; ctx.beginPath(); ctx.arc(r * 0.55, pts[0].y - r * 0.15, 2, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'chi': {
      ctx.scale(p.vx < 0 ? -1 : 1, 1);
      ctx.globalAlpha = Math.min(1, p.life / 8);
      const g = ctx.createRadialGradient(0, 0, r * 0.1, 0, 0, r * 1.2);
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.5, glow); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = glow; ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(-r * 0.3 - i * 7, 0, r * (0.7 + i * 0.25), -0.9, 0.9); ctx.stroke(); }
      break;
    }
    case 'lightning': {
      const len = 240;
      const seg = 7;
      const pts: V[] = [];
      for (let i = 0; i <= seg; i++) pts.push({ x: i === seg ? 0 : Math.sin(i * 7.3 + Math.floor(time * 30)) * 10, y: -len + (len * i) / seg });
      ctx.lineJoin = 'miter';
      const line = () => { ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); };
      ctx.globalAlpha = 0.45; ctx.strokeStyle = glow; ctx.lineWidth = 16; line(); ctx.stroke();
      ctx.globalAlpha = 1; ctx.strokeStyle = INK; ctx.lineWidth = 8; line(); ctx.stroke();
      ctx.strokeStyle = '#fffbe0'; ctx.lineWidth = 4; line(); ctx.stroke();
      ctx.fillStyle = glow; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'magma': case 'lantern': {
      const landed = p.vx === 0 && p.vy === 0;
      if (p.kind === 'magma') {
        ctx.fillStyle = '#ff7a1a'; ctx.globalAlpha = 0.3 + 0.15 * Math.sin(time * 9); ctx.beginPath(); ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        ctx.fillStyle = '#ff9b3d'; ctx.beginPath();
        if (landed) ctx.ellipse(0, r * 0.55, r * 1.5, r * 0.45, 0, 0, Math.PI * 2); else ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#3b2b2e';
        for (const [dx, dy] of [[-0.4, -0.2], [0.35, 0.1], [0, 0.45]]) { ctx.beginPath(); ctx.arc(r * dx * (landed ? 1.8 : 1), landed ? r * 0.5 + dy * 3 : r * dy, r * 0.2, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#ffe066'; ctx.beginPath(); ctx.arc(r * 0.2, landed ? r * 0.3 - Math.abs(Math.sin(time * 5)) * 6 : -r * 0.4, 2.5, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = glow; ctx.globalAlpha = 0.25 + 0.15 * Math.sin(time * 6); ctx.beginPath(); ctx.arc(0, 0, r * 1.8, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        ctx.lineWidth = 2.6;
        ctx.fillStyle = '#3a2a3a'; roundRect(ctx, -r * 0.55, -r * 1.05, r * 1.1, r * 0.35, 3); ctx.fill(); ctx.stroke();
        const g = ctx.createRadialGradient(0, 0, 1, 0, 0, r);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.5, glow); g.addColorStop(1, shade(glow, -0.4));
        ctx.fillStyle = g; roundRect(ctx, -r * 0.6, -r * 0.75, r * 1.2, r * 1.5, r * 0.4); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#3a2a3a'; roundRect(ctx, -r * 0.45, r * 0.7, r * 0.9, r * 0.3, 3); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, -r * 1.15, r * 0.3, Math.PI, 0); ctx.stroke();
      }
      break;
    }
    case 'bullet': case 'ricochet': {
      ctx.rotate(Math.atan2(p.vy, p.vx));
      ctx.strokeStyle = glow; ctx.globalAlpha = 0.55; ctx.lineWidth = r * 0.9;
      ctx.beginPath(); ctx.moveTo(-r * 5, 0); ctx.lineTo(0, 0); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.strokeStyle = INK; ctx.lineWidth = 2.2;
      ctx.fillStyle = p.kind === 'bullet' ? '#f2d38a' : glow;
      ctx.beginPath(); ctx.moveTo(-r, -r * 0.6); ctx.lineTo(r * 0.4, -r * 0.6); ctx.quadraticCurveTo(r * 1.5, 0, r * 0.4, r * 0.6); ctx.lineTo(-r, r * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'clawdisc': {
      ctx.rotate(time * 22 * (p.vx < 0 ? -1 : 1));
      ctx.fillStyle = glow; ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.arc(0, 0, r * 1.5, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#e8ecf5';
      for (let i = 0; i < 3; i++) {
        ctx.save(); ctx.rotate((i * Math.PI * 2) / 3);
        ctx.beginPath(); ctx.moveTo(0, -r * 0.3); ctx.quadraticCurveTo(r * 1.1, -r * 0.6, r * 1.3, r * 0.2); ctx.quadraticCurveTo(r * 0.7, -r * 0.1, 0, r * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
      }
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    }
    case 'dune': {
      ctx.scale(p.vx < 0 ? -1 : 1, 1);
      ctx.globalAlpha = Math.min(1, p.life / 10);
      ctx.fillStyle = '#d8b67a';
      ctx.beginPath(); ctx.moveTo(-r * 1.6, r); ctx.quadraticCurveTo(-r * 0.6, -r * 0.2, r * 0.3, -r * 0.9); ctx.quadraticCurveTo(r * 0.9, -r * 0.3, r * 1.2, r); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#a5824e'; ctx.beginPath(); ctx.moveTo(r * 0.3, -r * 0.9); ctx.quadraticCurveTo(r * 0.9, -r * 0.3, r * 1.2, r); ctx.lineTo(r * 0.5, r); ctx.closePath(); ctx.fill();
      ctx.fillStyle = glow;
      for (let i = 0; i < 4; i++) { const t = (time * 3 + i * 0.25) % 1; ctx.globalAlpha = 1 - t; ctx.beginPath(); ctx.arc(r * 0.3 - t * r * 1.5, -r * 0.9 - t * 10 + i * 3, 2, 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case 'bubble': {
      ctx.translate(0, Math.sin(time * 6 + p.id) * 2);
      ctx.fillStyle = 'rgba(160,230,255,0.28)'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = glow; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, r + 1.5, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.ellipse(-r * 0.35, -r * 0.4, r * 0.28, r * 0.16, -0.6, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'wisp': {
      const fl = Math.sin(time * 12 + p.id) * 2;
      ctx.fillStyle = glow; ctx.globalAlpha = 0.3; ctx.beginPath(); ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = glow; ctx.beginPath(); ctx.moveTo(fl, -r * 1.5); ctx.quadraticCurveTo(r, -r * 0.2, 0, r * 0.8); ctx.quadraticCurveTo(-r, -r * 0.2, fl, -r * 1.5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(0, r * 0.05, r * 0.35, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(-r * 0.15, 0, 1.5, 0, Math.PI * 2); ctx.arc(r * 0.15, 0, 1.5, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'husk': {
      const k = p.life / p.def.life;
      ctx.globalAlpha = 0.35 + 0.4 * k;
      const pulse = 1 + (k < 0.35 ? Math.sin(time * 40) * 0.08 : 0);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = shade(glow, 0.3);
      ctx.beginPath(); ctx.ellipse(0, 0, r * 0.7, r * 1.25, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = glow; ctx.lineWidth = 1.6;
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.arc(0, i * r * 0.4, r * 0.4, 0.3, Math.PI - 0.3); ctx.stroke(); }
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
