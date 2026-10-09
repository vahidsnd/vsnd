import { COUNTDOWN, getFighter, getStage, platformPos, TICK_RATE, type GameEvent, type GameState, type StageDef, getSpell } from '@nb/shared';
import { drawFighter, drawProjectile, INK, PLAYER_COLORS, previewFighter, shade, star } from './art.ts';
import { t, isFa } from '../i18n.ts';
import { prefs } from '../services/prefs.ts';

interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; max: number;
  color: string; size: number; kind: 'spark' | 'dust' | 'ring' | 'star' | 'beam' | 'text' | 'smoke' | 'slash' | 'num'; rot?: number; text?: string; g?: number;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Mirror matches: a later player with the same fighter+skin is shown in the next skin. */
export function displaySkin(state: GameState, slot: number): number {
  const f = state.fighters[slot];
  const n = getFighter(f.charId).skins.length;
  let skin = f.skin;
  for (let i = 0; i < slot; i++) {
    const o = state.fighters[i];
    if (o.charId === f.charId && displaySkin(state, i) === skin) skin = (skin + 1) % n;
  }
  return skin;
}

function seeded(seed: number) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

// ---- stage-art colour helpers (hex in, hex/rgba out) ----
function hexRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const A = hexRgb(a), B = hexRgb(b);
  const c = (i: number) => Math.round(A[i] + (B[i] - A[i]) * t);
  return '#' + ((1 << 24) | (c(0) << 16) | (c(1) << 8) | c(2)).toString(16).slice(1);
}
function rgba(h: string, a: number): string {
  const [r, g, b] = hexRgb(h);
  return `rgba(${r},${g},${b},${a})`;
}

/** One parallax layer: fog = how much it fades into the haze colour, haze = add a free haze band, tint = lit (cloud) layer. */
interface BgLayer { depth: number; fog: number; shapes: any[]; haze?: boolean; tint?: number }

export class Renderer {
  ctx: CanvasRenderingContext2D;
  w = 0; h = 0; dpr = 1;
  cam = { x: 0, y: -150, z: 1 };
  private particles: Particle[] = [];
  private shake = 0;
  private flashes: number[] = [0, 0, 0, 0];
  private dmgShake: number[] = [0, 0, 0, 0];
  private flashScreen = 0;
  private bgCache = new Map<string, { layers: BgLayer[] }>();
  /** visual offsets used to smooth network corrections */
  offsets: { x: number; y: number }[] = [];
  trialSlots = new Set<number>();
  hitstop = 0;
  showHitboxes = false;
  private get lowFx() { return prefs.quality === 'low' || this.maxDpr <= 1.05; }

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  /** render-resolution cap; lowered automatically when frames are slow */
  private maxDpr = prefs.quality === 'low' ? 1 : Math.min(prefs.quality === 'high' ? 2 : 1.5, window.devicePixelRatio || 1);
  private slowFrames = 0;
  private fastFrames = 0;
  private layerCache = new Map<string, HTMLCanvasElement>();

  resize() {
    this.dpr = Math.min(this.maxDpr, window.devicePixelRatio || 1);
    const sizeChanged = this.w !== this.canvas.clientWidth || this.h !== this.canvas.clientHeight;
    this.w = this.canvas.clientWidth; this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    // screen-size dependent caches (sky, parallax layers) are rebuilt lazily
    if (sizeChanged) for (const k of [...this.layerCache.keys()]) if (k.startsWith('sky:') || k.startsWith('bg:')) this.layerCache.delete(k);
  }

  /** Feed real frame times; drops render resolution on slow devices, restores it when there is headroom. */
  noteFrame(ms: number) {
    if (prefs.quality !== 'auto') return;
    if (ms > 22) { this.slowFrames++; this.fastFrames = 0; } else if (ms < 15) { this.fastFrames++; this.slowFrames = Math.max(0, this.slowFrames - 1); }
    if (this.slowFrames > 45 && this.maxDpr > 1) {
      this.maxDpr = Math.max(1, this.maxDpr - 0.35); this.slowFrames = 0; this.resize();
    } else if (this.fastFrames > 600 && this.maxDpr < Math.min(2, window.devicePixelRatio || 1)) {
      this.maxDpr = Math.min(2, this.maxDpr + 0.25); this.fastFrames = 0; this.resize();
    }
  }

  private get portrait() { return this.h > this.w * 1.05; }
  /** world→screen scale reference for the current screen shape */
  private get baseScale() { return this.portrait ? this.w / 430 : Math.min(this.w / 1280, this.h / 720) * 1.6; }

  reset() { this.particles = []; this.shake = 0; this.cam = { x: 0, y: -150, z: 1 }; }

  // ---- events → effects --------------------------------------------------------------
  onEvents(state: GameState, events: GameEvent[], sfx: (e: GameEvent) => void) {
    for (const e of events) {
      sfx(e);
      switch (e.t) {
        case 'hit': {
          const color = PLAYER_COLORS[e.attacker] ?? '#fff';
          const n = Math.min(this.lowFx ? 6 : 12, 3 + Math.floor(e.kb / 14));
          for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, sp = rnd(4, 7 + e.kb / 18);
            this.particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: rnd(10, 18), color: i % 2 ? '#ffffff' : color, size: rnd(1.6, 2.8), kind: 'spark' });
          }
          this.particles.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0, max: 12, color, size: 12 + e.kb / 5, kind: 'ring' });
          if (e.kb > 80) this.particles.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0, max: 10, color: '#ffffff', size: 30 + e.kb / 4, kind: 'slash', rot: Math.random() * Math.PI });
          if (prefs.dmgNumbers && e.dmg >= 1) this.particles.push({ x: e.x + rnd(-8, 8), y: e.y - 18, vx: 0, vy: -1.1, life: 0, max: 34, color: e.kb > 90 ? '#ff6b7a' : '#ffffff', size: 15 + Math.min(10, e.dmg * 0.5), kind: 'num', text: String(Math.round(e.dmg)) });
          this.flashes[e.victim] = 1;
          this.dmgShake[e.victim] = Math.min(12, 3 + e.dmg);
          this.shake = Math.max(this.shake, Math.min(14, e.kb / 14));
          break;
        }
        case 'shieldhit':
          this.particles.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0, max: 10, color: '#9fe8ff', size: 14, kind: 'ring' });
          for (let i = 0; i < 4; i++) { const a = Math.random() * Math.PI * 2; this.particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * 3.5, vy: Math.sin(a) * 3.5, life: 0, max: 10, color: '#cff6ff', size: 1.8, kind: 'spark' }); }
          break;
        case 'ko': {
          const color = PLAYER_COLORS[e.slot];
          const ang = Math.atan2(-150 - e.y, -e.x);
          this.particles.push({ x: e.x, y: e.y, vx: Math.cos(ang), vy: Math.sin(ang), life: 0, max: 36, color, size: 120, kind: 'beam' });
          this.particles.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0, max: 22, color: '#ffffff', size: 70, kind: 'ring' });
          for (let i = 0; i < (this.lowFx ? 10 : 22); i++) {
            const a = ang + rnd(-0.6, 0.6), sp = rnd(8, 20);
            this.particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0, max: rnd(20, 34), color: i % 3 ? color : '#ffffff', size: rnd(2, 4), kind: 'spark' });
          }
          this.shake = 18; this.flashScreen = 0.35;
          break;
        }
        case 'jump': this.dust(e.x, e.y, 3); break;
        case 'land': this.dust(e.x, e.y, 2); break;
        case 'explode': {
          this.particles.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0, max: 16, color: '#ffb347', size: e.r, kind: 'ring' });
          for (let i = 0; i < (this.lowFx ? 5 : 10); i++) { const a = Math.random() * Math.PI * 2, s = rnd(1.5, 5); this.particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.8, life: 0, max: rnd(22, 34), color: i % 3 ? 'rgba(70,64,80,0.7)' : 'rgba(255,150,60,0.8)', size: rnd(7, 13), kind: 'smoke' }); }
          for (let i = 0; i < 6; i++) { const a = Math.random() * Math.PI * 2; this.particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * 7, vy: Math.sin(a) * 7, life: 0, max: 14, color: '#ffd38a', size: 2.2, kind: 'spark' }); }
          this.shake = Math.max(this.shake, 8);
          break;
        }
        case 'shieldbreak': {
          const f = state.fighters[e.slot];
          for (let i = 0; i < 10; i++) { const a = Math.random() * Math.PI * 2; this.particles.push({ x: f.x, y: f.y - 40, vx: Math.cos(a) * 6, vy: Math.sin(a) * 6, life: 0, max: 24, color: '#bdf6ff', size: 2.5, kind: 'spark' }); }
          this.shake = 10;
          break;
        }
        case 'counter': {
          const f = state.fighters[e.slot];
          this.particles.push({ x: f.x, y: f.y - 40, vx: 0, vy: -0.6, life: 0, max: 40, color: '#ffd23f', size: 22, kind: 'text', text: 'COUNTER!' });
          this.particles.push({ x: f.x, y: f.y - 40, vx: 0, vy: 0, life: 0, max: 16, color: '#ffd23f', size: 50, kind: 'ring' });
          break;
        }
        case 'spell': {
          const sp = getSpell(e.id);
          const col = sp?.color ?? '#b48cff';
          this.particles.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0, max: 18, color: col, size: 70, kind: 'ring' });
          this.particles.push({ x: e.x, y: e.y - 30, vx: 0, vy: -0.7, life: 0, max: 46, color: col, size: 18, kind: 'text', text: sp ? (isFa() ? sp.nameFa : sp.name) : '!' });
          if (!this.lowFx) for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; this.particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * 4, vy: Math.sin(a) * 4, life: 0, max: 18, color: col, size: 2.4, kind: 'spark' }); }
          this.shake = Math.max(this.shake, 5);
          break;
        }
        case 'spawn': {
          const f = state.fighters[e.slot];
          this.particles.push({ x: f.x, y: f.y - 30, vx: 0, vy: 0, life: 0, max: 24, color: PLAYER_COLORS[e.slot], size: 60, kind: 'ring' });
          break;
        }
      }
    }
  }

  private dust(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) this.particles.push({ x: x + rnd(-10, 10), y: y - 2, vx: rnd(-1.6, 1.6), vy: rnd(-1, -0.2), life: 0, max: rnd(12, 18), color: 'rgba(225,232,255,0.32)', size: rnd(4, 7), kind: 'dust' });
  }

  // ---- camera ---------------------------------------------------------------------------
  private updateCamera(state: GameState, stage: StageDef, instant: boolean) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const f of state.fighters) {
      if (f.action === 'dead' || f.stocks <= 0) continue;
      const fx = Math.max(stage.blast.left + 150, Math.min(stage.blast.right - 150, f.x));
      const fy = Math.max(stage.blast.top + 150, Math.min(stage.blast.bottom - 60, f.y));
      minX = Math.min(minX, fx); maxX = Math.max(maxX, fx); minY = Math.min(minY, fy - 80); maxY = Math.max(maxY, fy);
    }
    if (!isFinite(minX)) { minX = stage.main.x1; maxX = stage.main.x2; minY = -200; maxY = 0; }
    const portrait = this.portrait;
    if (!portrait) { minX = Math.min(minX, stage.main.x1 * 0.5); maxX = Math.max(maxX, stage.main.x2 * 0.5); }
    maxY = Math.max(maxY, stage.main.y + 40);
    // the HUD covers the bottom strip, keep the action above it
    const hud = this.hudHeight();
    const viewH = this.h - hud;
    const padX = portrait ? 90 : 200, padY = portrait ? 130 : 170;
    const bw = maxX - minX + padX * 2, bh = maxY - minY + padY * 2;
    const base = this.baseScale;
    let z = Math.min(this.w / bw, viewH / bh);
    z = Math.max((portrait ? 0.64 : 0.5) * base, Math.min((portrait ? 1.1 : 1.25) * base, z));
    const cx = (minX + maxX) / 2;
    // portrait: put the action at ~60% of the arena height (more air above, less island below)
    const anchor = portrait ? 0.6 : 0.5;
    const cy = (minY + maxY) / 2 - (anchor * viewH - this.h / 2) / z;
    const k = instant ? 1 : 0.08;
    this.cam.x += (cx - this.cam.x) * k;
    this.cam.y += (cy - this.cam.y) * k;
    this.cam.z += (z - this.cam.z) * k;
  }

  private hudHeight() { return this.portrait ? 64 : Math.min(90, this.h * 0.2); }

  // ---- main draw ---------------------------------------------------------------------------
  draw(state: GameState, opts: { localSlots: number[]; time: number; names?: boolean; instantCam?: boolean; training?: boolean; ping?: number }) {
    const { ctx } = this;
    if (this.canvas.clientWidth !== this.w || this.canvas.clientHeight !== this.h) this.resize();
    if (!this.w || !this.h) return;
    const stage = getStage(state.cfg.stageId);
    this.updateCamera(state, stage, !!opts.instantCam);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(stage, opts.time);

    const sx = this.shake > 0.5 ? rnd(-this.shake, this.shake) : 0;
    const sy = this.shake > 0.5 ? rnd(-this.shake, this.shake) : 0;
    this.shake *= 0.85;

    ctx.save();
    ctx.translate(this.w / 2 + sx, this.h / 2 + sy);
    ctx.scale(this.cam.z, this.cam.z);
    ctx.translate(-this.cam.x, -this.cam.y);

    this.drawStage(stage, state.frame, opts.time);

    // projectiles
    for (const p of state.projectiles) {
      const owner = state.fighters[p.owner];
      const def = getFighter(owner?.charId ?? 'blaze');
      drawProjectile(ctx, p, opts.time, def.skins[owner?.skin ?? 0]?.glow ?? '#fff');
    }

    // fighters (local player last so it's on top)
    const order = [...state.fighters].sort((a, b) => (opts.localSlots.includes(a.slot) ? 1 : 0) - (opts.localSlots.includes(b.slot) ? 1 : 0));
    for (const f of order) {
      if (f.action === 'dead') continue;
      const off = this.offsets[f.slot];
      const draw = off && (Math.abs(off.x) > 0.3 || Math.abs(off.y) > 0.3) ? { ...f, x: f.x + off.x, y: f.y + off.y } : f;
      if (f.action === 'spawn') this.drawSpawnPlatform(draw.x, draw.y, f.slot);
      // launch trail
      if (f.action === 'hitstun' && Math.hypot(f.kx, f.ky) > 7) this.trail(draw.x, draw.y - 30, f.kx, f.ky, PLAYER_COLORS[f.slot]);
      const tag = opts.names !== false ? (opts.localSlots.includes(f.slot) && opts.localSlots.length === 1 ? (t('lang') === 'fa' ? 'تو' : 'YOU') : `P${f.slot + 1}`) : undefined;
      drawFighter(ctx, draw, displaySkin(state, f.slot), { color: PLAYER_COLORS[f.slot], time: opts.time, showTag: tag, flash: this.flashes[f.slot] });
      this.flashes[f.slot] = Math.max(0, (this.flashes[f.slot] ?? 0) - 0.12);
    }
    for (const o of this.offsets) if (o) { o.x *= 0.82; o.y *= 0.82; }
    if (this.showHitboxes) this.drawHitboxes(state);

    this.drawParticles();
    ctx.restore();

    this.drawOffscreen(state);
    if (this.flashScreen > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${this.flashScreen})`; ctx.fillRect(0, 0, this.w, this.h); this.flashScreen *= 0.85;
    }
    this.drawHud(state, opts);
  }

  /** Training aid: hurtboxes (yellow) and active hitboxes (red). */
  private drawHitboxes(state: GameState) {
    const { ctx } = this;
    ctx.save();
    ctx.lineWidth = 2;
    for (const f of state.fighters) {
      if (f.action === 'dead') continue;
      const def = getFighter(f.charId);
      ctx.strokeStyle = f.intang || f.invuln > 0 ? 'rgba(120,200,255,0.9)' : 'rgba(255,220,60,0.9)';
      ctx.strokeRect(f.x - def.stats.w / 2, f.y - def.stats.h, def.stats.w, def.stats.h);
      if (f.action !== 'attack' || !f.move) continue;
      const m = def.moves[f.move];
      for (const hb of m.hitboxes) {
        if (f.af < hb.s || f.af > hb.e) continue;
        ctx.fillStyle = hb.grab ? 'rgba(160,90,255,0.4)' : 'rgba(255,60,80,0.4)';
        ctx.beginPath(); ctx.arc(f.x + hb.x * f.facing, f.y + hb.y, hb.r, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.fillStyle = 'rgba(255,60,80,0.4)';
    for (const p of state.projectiles) { ctx.beginPath(); ctx.arc(p.x, p.y, p.def.r, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }

  private trail(x: number, y: number, kx: number, ky: number, color: string) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = color; ctx.globalAlpha = 0.5; ctx.lineWidth = 10; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - kx * 4, y - ky * 4); ctx.stroke();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - kx * 3, y - ky * 3); ctx.stroke();
    ctx.restore();
  }

  private drawSpawnPlatform(x: number, y: number, slot: number) {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = PLAYER_COLORS[slot]; ctx.strokeStyle = INK; ctx.lineWidth = 3;
    ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.ellipse(x, y + 4, 54, 14, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1; ctx.beginPath(); ctx.ellipse(x, y + 4, 42, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  private drawParticles() {
    const { ctx } = this;
    if (this.particles.length > 220) this.particles.splice(0, this.particles.length - 220);
    const keep: Particle[] = [];
    for (const p of this.particles) {
      p.life++;
      if (p.life > p.max) continue;
      keep.push(p);
      const k = 1 - p.life / p.max;
      p.x += p.vx; p.y += p.vy;
      if (p.kind === 'spark') { p.vx *= 0.88; p.vy *= 0.88; }
      if (p.kind === 'num') p.vy *= 0.95;
      if (p.kind === 'smoke' || p.kind === 'dust') { p.vx *= 0.94; p.vy *= 0.94; }
      ctx.save();
      ctx.globalAlpha = Math.max(0, k);
      switch (p.kind) {
        case 'spark':
          if (!this.lowFx) ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = p.color; ctx.lineWidth = p.size * (0.5 + k * 0.5); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2.6, p.y - p.vy * 2.6); ctx.stroke();
          break;
        case 'slash': {
          if (!this.lowFx) ctx.globalCompositeOperation = 'lighter';
          ctx.translate(p.x, p.y); ctx.rotate(p.rot ?? 0);
          const len = p.size * (1.2 - k * 0.4), wdt = 5 * k;
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(0, -wdt); ctx.lineTo(len, 0); ctx.lineTo(0, wdt); ctx.closePath(); ctx.fill();
          break;
        }
        case 'num':
          ctx.font = `800 ${p.size}px Vazirmatn, system-ui, sans-serif`; ctx.textAlign = 'center';
          ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(4,6,12,0.85)'; ctx.strokeText(p.text!, p.x, p.y);
          ctx.fillStyle = p.color; ctx.fillText(p.text!, p.x, p.y);
          break;
        case 'dust': case 'smoke':
          ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.4 - k * 0.6), 0, Math.PI * 2); ctx.fill();
          break;
        case 'ring':
          ctx.strokeStyle = p.color; ctx.lineWidth = 3 * k + 0.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.5 - k * 0.9), 0, Math.PI * 2); ctx.stroke();
          break;
        case 'star': star(ctx, p.x, p.y, p.size * (0.6 + k), p.color, (p.rot ?? 0) + p.life * 0.1); break;
        case 'beam': {
          ctx.globalCompositeOperation = 'lighter';
          const len = 1400, wdt = p.size * k;
          ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(p.vy, p.vx));
          const g = ctx.createLinearGradient(0, 0, len, 0);
          g.addColorStop(0, '#ffffff'); g.addColorStop(0.15, p.color); g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.moveTo(0, -wdt * 0.15); ctx.lineTo(len, -wdt); ctx.lineTo(len, wdt); ctx.lineTo(0, wdt * 0.15); ctx.closePath(); ctx.fill();
          break;
        }
        case 'text':
          ctx.font = `900 ${p.size}px Vazirmatn, system-ui, sans-serif`; ctx.textAlign = 'center';
          ctx.lineWidth = 6; ctx.strokeStyle = INK; ctx.strokeText(p.text!, p.x, p.y); ctx.fillStyle = p.color; ctx.fillText(p.text!, p.x, p.y);
          break;
      }
      ctx.restore();
    }
    this.particles = keep;
  }

  // ---- stage art ----------------------------------------------------------------------------
  /**
   * Parallax layer descriptions per prop set. Coordinates: x is world-ish, y = 0 is the horizon line,
   * negative is up. Everything here is drawn ONCE into cached bitmaps (see drawBackground).
   */
  private bgLayers(stage: StageDef) {
    let c = this.bgCache.get(stage.id);
    if (c) return c;
    const r = seeded(stage.id.length * 7919 + stage.id.charCodeAt(0) * 31 + stage.id.charCodeAt(1));
    const layers: BgLayer[] = [];
    const add = (depth: number, fog: number, shapes: any[], opts: Partial<BgLayer> = {}) => layers.push({ depth, fog, shapes, ...opts });
    const ridge = (step: number, base: number, amp: number, jag = 0.5) => {
      const pts: [number, number][] = [];
      let y = base;
      for (let x = -2000; x <= 2000; x += step) { y = base - amp * (0.35 + 0.65 * r()) * (1 - jag) - (y - base) * jag * 0.3 - amp * jag * r(); pts.push([x, y]); }
      return pts;
    };
    const span = (from: number, to: number, gap: () => number, make: (x: number) => any) => { const out = []; for (let x = from; x < to; x += gap()) out.push(make(x)); return out; };
    switch (stage.theme.props) {
      case 'city':
        add(0.1, 0.62, span(-1700, 1700, () => 30 + r() * 50, (x) => ({ type: 'tower', x, w: 40 + r() * 60, h: 140 + r() * 260, wins: [], spire: r() < 0.2 })), { haze: true });
        add(0.25, 0.38, span(-1700, 1700, () => 60 + r() * 80, (x) => ({ type: 'tower', x, w: 50 + r() * 70, h: 120 + r() * 300, wins: Array.from({ length: 14 }, () => [r(), r()]).filter(() => r() < 0.5), spire: r() < 0.25 })));
        add(0.45, 0.16, span(-1700, 1700, () => 110 + r() * 120, (x) => ({ type: 'tower', x, w: 70 + r() * 90, h: 90 + r() * 230, wins: Array.from({ length: 22 }, () => [r(), r()]).filter(() => r() < 0.45), sign: r() < 0.45 ? (r() < 0.5 ? 1 : 2) : 0, tank: r() < 0.3 })));
        break;
      case 'moon':
        add(0.08, 0.6, [{ type: 'ridge', pts: ridge(90, -140, 260, 0.6), cap: '#9fb8d8' }], { haze: true });
        add(0.22, 0.38, [{ type: 'ridge', pts: ridge(70, -60, 150, 0.4) }, ...span(-1800, 1800, () => 26 + r() * 40, (x) => ({ type: 'pine', x, y: -40 - r() * 60, h: 50 + r() * 60 }))]);
        add(0.42, 0.14, [...Array.from({ length: 5 }, (_, i) => ({ type: 'pagoda', x: -1000 + i * 500 + r() * 120, h: 170 + r() * 110 })),
          ...span(-1700, 1700, () => 320 + r() * 380, (x) => ({ type: 'bamboo', x, h: 380 + r() * 200, n: 2 + Math.floor(r() * 2) }))]);
        break;
      case 'lanterns':
        add(0.12, 0.55, span(-1700, 1700, () => 90 + r() * 120, (x) => ({ type: 'dome', x, w: 70 + r() * 90, h: 80 + r() * 160, minaret: r() < 0.35, lit: false })), { haze: true });
        add(0.3, 0.3, span(-1700, 1700, () => 150 + r() * 130, (x) => ({ type: 'dome', x, w: 100 + r() * 110, h: 110 + r() * 180, minaret: r() < 0.3, lit: true })));
        add(0.55, 0.05, [
          ...Array.from({ length: 4 }, (_, i) => ({ type: 'string', x1: -1500 + i * 800, x2: -900 + i * 800, y: -560 + r() * 140, sag: 70 + r() * 60, n: 9 })),
          ...Array.from({ length: 18 }, () => ({ type: 'lantern', x: -1500 + r() * 3000, y: -680 + r() * 520, s: 0.6 + r() * 0.8 })),
        ]);
        break;
      case 'pipes':
        add(0.08, 0.4, [{ type: 'core', x: 0, y: -360, r: 210 }], { haze: true });
        add(0.28, 0.32, span(-1700, 1700, () => 110 + r() * 170, (x) => ({ type: 'pipe', x, w: 30 + r() * 50, h: 320 + r() * 480, valve: r() < 0.5 })));
        add(0.5, 0.1, [...span(-1700, 1700, () => 220 + r() * 260, (x) => ({ type: 'pipe', x, w: 40 + r() * 40, h: 600 + r() * 300, valve: r() < 0.6 })),
          { type: 'girder', y: -470, x1: -1900, x2: 1900 }]);
        break;
      case 'clouds':
        add(0.06, 0.25, Array.from({ length: 12 }, () => ({ type: 'cloud', x: -1700 + r() * 3400, y: -700 + r() * 560, s: 1.2 + r() * 1.6 })), { tint: 0.12 });
        add(0.3, 0.32, Array.from({ length: 6 }, (_, i) => ({ type: 'isle', x: -1300 + i * 520 + r() * 160, y: -120 - r() * 260, w: 150 + r() * 160, cols: 1 + Math.floor(r() * 4) })));
        add(0.55, 0.1, Array.from({ length: 8 }, () => ({ type: 'cloud', x: -1700 + r() * 3400, y: -60 + r() * 360, s: 1 + r() * 1.2 })), { tint: 0.22 });
        break;
      case 'garden':
        add(0.08, 0.58, [{ type: 'ridge', pts: ridge(80, -110, 240, 0.55), cap: '#c8d8f0' }], { haze: true });
        add(0.26, 0.3, [
          { type: 'gardenwall', x1: -1900, x2: 1900, h: 70 },
          { type: 'kushk', x: 40, w: 520, h: 230 },
          ...span(-1800, 1800, () => 70 + r() * 50, (x) => Math.abs(x - 40) < 330 ? null : ({ type: 'cypress', x, h: 150 + r() * 90, w: 22 + r() * 10 })).filter(Boolean),
          { type: 'pool', x1: -260, x2: 340, y: 18, h: 46 },
        ]);
        add(0.5, 0.08, [...span(-1800, 1800, () => 180 + r() * 220, (x) => ({ type: 'cypress', x, h: 300 + r() * 160, w: 40 + r() * 16 })),
          ...Array.from({ length: 10 }, () => ({ type: 'lamp', x: -1600 + r() * 3200, y: -20 - r() * 40 }))]);
        break;
      case 'canyon':
        add(0.08, 0.55, [{ type: 'mesa', pts: ridge(160, -120, 160, 0.15), flat: true }], { haze: true });
        add(0.28, 0.32, span(-1800, 1800, () => 260 + r() * 260, (x) => ({ type: 'butte', x, w: 140 + r() * 220, h: 160 + r() * 200, strata: 4 + Math.floor(r() * 4) })));
        add(0.52, 0.08, [...span(-1800, 1800, () => 300 + r() * 380, (x) => ({ type: 'spire', x, w: 50 + r() * 50, h: 240 + r() * 240 })),
          { type: 'arch', x: -760, w: 420, h: 330 }, { type: 'arch', x: 900, w: 360, h: 280 }]);
        break;
      case 'glacier':
        add(0.08, 0.5, [{ type: 'ridge', pts: ridge(70, -150, 300, 0.75), cap: '#e8faff', capAll: true }], { haze: true });
        add(0.28, 0.3, [{ type: 'icecliff', pts: ridge(110, -80, 170, 0.3) }]);
        add(0.52, 0.06, [...span(-1800, 1800, () => 140 + r() * 200, (x) => ({ type: 'shard', x, w: 50 + r() * 70, h: 140 + r() * 260, lean: (r() - 0.5) * 0.5 })),
          ...span(-1800, 1800, () => 60 + r() * 90, (x) => ({ type: 'pine', x, y: 10 + r() * 30, h: 70 + r() * 70, snow: true }))]);
        break;
      case 'forge':
        add(0.08, 0.45, [{ type: 'volcano', x: -520, w: 900, h: 420 }, { type: 'volcano', x: 760, w: 700, h: 300 }], { haze: true });
        add(0.28, 0.25, span(-1800, 1800, () => 200 + r() * 220, (x) => ({ type: 'stack', x, w: 50 + r() * 50, h: 220 + r() * 260, mouth: r() < 0.7 })));
        add(0.52, 0.04, [...span(-1700, 1700, () => 260 + r() * 260, (x) => ({ type: 'chain', x, y: -900, len: 260 + r() * 260, hook: r() < 0.5 })),
          { type: 'lavaflow', x1: -1900, x2: 1900, y: 60 }]);
        break;
      case 'temple':
        add(0.08, 0.62, span(-1700, 1700, () => 140 + r() * 160, (x) => ({ type: 'ruincol', x, w: 30 + r() * 30, h: 120 + r() * 260, broken: r() < 0.6 })), { haze: true });
        add(0.3, 0.34, [{ type: 'facade', x: 0, w: 900, h: 380 }, ...span(-1800, 1800, () => 240 + r() * 200, (x) => Math.abs(x) < 560 ? null : ({ type: 'ruincol', x, w: 44, h: 200 + r() * 220, broken: r() < 0.5 })).filter(Boolean)]);
        add(0.52, 0.08, [...span(-1800, 1800, () => 230 + r() * 220, (x) => ({ type: 'kelp', x, h: 260 + r() * 360, ph: r() * 6 })),
          ...span(-1800, 1800, () => 220 + r() * 300, (x) => ({ type: 'coral', x, s: 0.7 + r() * 0.8 }))]);
        break;
      case 'highway':
        add(0.08, 0.6, span(-1700, 1700, () => 26 + r() * 40, (x) => ({ type: 'tower', x, w: 36 + r() * 50, h: 160 + r() * 340, wins: [], spire: r() < 0.3 })), { haze: true });
        add(0.26, 0.3, [{ type: 'overpass', y: -150, x1: -1900, x2: 1900 }, ...span(-1700, 1700, () => 500 + r() * 400, (x) => ({ type: 'billboard', x, y: -330 - r() * 80, w: 200 + r() * 90, h: 90 + r() * 30, hue: r() < 0.5 ? 0 : 1 }))]);
        add(0.5, 0.06, span(-1800, 1800, () => 260 + r() * 160, (x) => ({ type: 'streetlamp', x, h: 290 + r() * 50, dir: r() < 0.5 ? -1 : 1 })));
        break;
      case 'shrine':
        add(0.08, 0.58, [{ type: 'fuji', x: 380, w: 1500, h: 480 }, { type: 'ridge', pts: ridge(110, -40, 120, 0.3) }], { haze: true });
        add(0.28, 0.28, [...Array.from({ length: 4 }, (_, i) => ({ type: 'pagoda', x: -1150 + i * 760 + r() * 120, h: 200 + r() * 90 })),
          ...span(-1800, 1800, () => 170 + r() * 160, (x) => ({ type: 'blossom', x, y: -20, s: 0.8 + r() * 0.6 }))]);
        add(0.5, 0.06, [{ type: 'torii', x: -700, w: 340, h: 360 }, { type: 'torii', x: 820, w: 300, h: 320 },
          ...span(-1800, 1800, () => 300 + r() * 260, (x) => ({ type: 'stonelamp', x })),
          { type: 'branch', x: -1300, y: -620, dir: 1 }, { type: 'branch', x: 1300, y: -660, dir: -1 }]);
        break;
      case 'cathedral':
        add(0.08, 0.55, span(-1700, 1700, () => 160 + r() * 200, (x) => ({ type: 'spire', x, w: 60 + r() * 50, h: 300 + r() * 260, gothic: true })), { haze: true });
        add(0.28, 0.24, [{ type: 'nave', x1: -1900, x2: 1900, h: 520 }, { type: 'rose', x: 0, y: -390, r: 120 }]);
        add(0.5, 0.04, [...span(-1800, 1800, () => 520 + r() * 120, (x) => Math.abs(x) < 300 ? null : ({ type: 'gcol', x, w: 70 })).filter(Boolean),
          { type: 'chandelier', x: -420, y: -620 }, { type: 'chandelier', x: 460, y: -660 }]);
        break;
      case 'orbit':
        add(0.1, 0.35, [{ type: 'station', x: -620, y: -420, s: 0.8 }, { type: 'satellite', x: 760, y: -560, s: 0.7 }], { haze: false });
        add(0.45, 0.05, [{ type: 'truss', x1: -1900, x2: 1900, y: -560 }, { type: 'truss', x1: -1900, x2: -560, y: 140 }, { type: 'truss', x1: 560, x2: 1900, y: 140 },
          { type: 'panel', x: -1050, y: -720 }, { type: 'panel', x: 1100, y: -720 }]);
        break;
      case 'jungle':
        add(0.08, 0.6, [{ type: 'ridge', pts: ridge(60, -60, 140, 0.4) }, { type: 'ziggurat', x: -200, w: 760, h: 330, steps: 6 }], { haze: true });
        add(0.28, 0.3, span(-1800, 1800, () => 70 + r() * 90, (x) => ({ type: 'canopy', x, y: -60 - r() * 120, s: 0.8 + r() * 0.9 })));
        add(0.52, 0.04, [...span(-1800, 1800, () => 110 + r() * 160, (x) => ({ type: 'vine', x, y: -900, len: 260 + r() * 360, ph: r() * 6 })),
          ...span(-1800, 1800, () => 240 + r() * 280, (x) => ({ type: 'fern', x, y: 60, s: 0.9 + r() * 0.8 }))]);
        break;
      case 'storm':
        add(0.06, 0.4, Array.from({ length: 9 }, () => ({ type: 'stormcloud', x: -1700 + r() * 3400, y: -700 + r() * 360, s: 1.4 + r() * 1.4 })), { haze: true });
        add(0.24, 0.4, [{ type: 'waves', y: -40, amp: 50, n: 14 }, { type: 'ship', x: -520, y: -50, s: 0.6 }, { type: 'ship', x: 600, y: -40, s: 0.45 }, { type: 'lighthouse', x: 260, y: -60 }]);
        add(0.48, 0.12, [{ type: 'waves', y: 40, amp: 70, n: 9 }, { type: 'rigging', x1: -590, x2: 590 }]);
        break;
      case 'crystal':
        add(0.08, 0.55, [{ type: 'cavewall' }], { haze: true });
        add(0.28, 0.25, span(-1800, 1800, () => 160 + r() * 200, (x) => ({ type: 'crystals', x, y: -20 - r() * 60, s: 0.7 + r() * 0.9, n: 3 + Math.floor(r() * 4), seed: Math.floor(r() * 1e6) })));
        add(0.52, 0.05, [...span(-1800, 1800, () => 90 + r() * 140, (x) => ({ type: 'stalactite', x, y: -900, len: 180 + r() * 360, w: 40 + r() * 60 })),
          ...span(-1800, 1800, () => 380 + r() * 360, (x) => ({ type: 'crystals', x, y: 120, s: 1.4 + r() * 0.8, n: 4 + Math.floor(r() * 3), seed: Math.floor(r() * 1e6) }))]);
        break;
      case 'clock':
        add(0.06, 0.4, [{ type: 'clockface', x: 0, y: -420, r: 330 }], { haze: true });
        add(0.28, 0.25, span(-1800, 1800, () => 240 + r() * 240, (x) => ({ type: 'gear', x, y: -200 - r() * 360, r: 70 + r() * 110, teeth: 10 + Math.floor(r() * 10), rot: r() * 6 })));
        add(0.52, 0.05, [{ type: 'beam', x1: -1900, x2: 1900, y: -640 }, { type: 'pendulum', x: -820, y: -640, len: 520 }, { type: 'pendulum', x: 900, y: -640, len: 440 },
          { type: 'gear', x: -1250, y: 40, r: 210, teeth: 18, rot: 0.3 }, { type: 'gear', x: 1300, y: 20, r: 170, teeth: 15, rot: 0.1 }]);
        break;
      case 'arcade':
        add(0.06, 0.4, [{ type: 'gridfloor' }, ...span(-1700, 1700, () => 120 + r() * 100, (x) => ({ type: 'cabinet', x, h: 190 + r() * 40, hue: Math.floor(r() * 3) }))], { haze: true });
        add(0.3, 0.2, [{ type: 'neonsign', x: -600, y: -300, text: 'PLAY', hue: 0 }, { type: 'neonsign', x: 620, y: -330, text: 'بازی', hue: 1 },
          { type: 'neonsign', x: 0, y: -470, text: '★ 1UP ★', hue: 2 }, { type: 'neonsign', x: -1250, y: -330, text: 'K.O.', hue: 1 }, { type: 'neonsign', x: 1250, y: -360, text: 'HI', hue: 0 }]);
        add(0.5, 0.05, span(-1800, 1800, () => 420 + r() * 260, (x) => ({ type: 'cabinet', x, h: 330 + r() * 50, hue: Math.floor(r() * 3), near: true })));
        break;
      case 'persepolis':
        add(0.08, 0.55, [{ type: 'ridge', pts: ridge(120, -90, 200, 0.3) }], { haze: true });
        add(0.28, 0.25, [{ type: 'terrace', x1: -1900, x2: 1900, h: 60 }, { type: 'gate', x: -520, w: 260, h: 330 },
          ...span(-1400, 1600, () => 110 + r() * 40, (x) => Math.abs(x + 520) < 220 ? null : ({ type: 'column', x, h: r() < 0.35 ? 120 + r() * 120 : 330 + r() * 40, w: 26, cap: true })).filter(Boolean)]);
        add(0.5, 0.05, [{ type: 'relief', x1: -1900, x2: -500, y: 40, h: 120 }, { type: 'relief', x1: 520, x2: 1900, y: 40, h: 120 },
          { type: 'column', x: -1150, h: 260, w: 54, cap: false }, { type: 'column', x: 1220, h: 520, w: 58, cap: true }]);
        break;
      default:
        add(0.1, 0.5, [{ type: 'ridge', pts: ridge(80, -100, 200, 0.5) }], { haze: true });
    }
    c = { layers };
    this.bgCache.set(stage.id, c);
    return c;
  }

  private offscreen(w: number, h: number) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  /** Sky (multi-stop gradient, stars, celestial glow) baked once per screen size. */
  private bakeSky(stage: StageDef, w: number, h: number, q: number) {
    const th = stage.theme;
    const img = this.offscreen(w * q, h * q);
    const c = img.getContext('2d')!;
    c.scale(q, q);
    const haze = th.haze ?? th.sky[1];
    const horizon = h * (this.portrait ? 0.62 : 0.78);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, th.sky[0]);
    g.addColorStop(0.45, th.skyMid ?? mix(th.sky[0], th.sky[1], 0.4));
    g.addColorStop(Math.min(0.95, horizon / h), th.sky[1]);
    g.addColorStop(1, mix(th.sky[1], '#000000', 0.25));
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    const r = seeded(stage.id.charCodeAt(0) * 97 + 42);
    // nebula / colour wash for depth
    for (let i = 0; i < 3; i++) {
      const x = r() * w, y = r() * horizon * 0.8, rad = (0.3 + r() * 0.4) * Math.max(w, h);
      const ng = c.createRadialGradient(x, y, 0, x, y, rad);
      ng.addColorStop(0, rgba(i === 1 ? th.accent : haze, 0.07)); ng.addColorStop(1, rgba(haze, 0));
      c.fillStyle = ng; c.fillRect(0, 0, w, h);
    }
    // stars
    const n = th.stars ?? 70;
    for (let i = 0; i < n; i++) {
      const x = r() * w, y = Math.pow(r(), 1.4) * horizon * 0.85, a = 0.15 + 0.7 * r() * (1 - y / horizon);
      const s = r() < 0.12 ? 2 : r() < 0.5 ? 1.5 : 1;
      c.fillStyle = rgba(r() < 0.2 ? mix(th.accent, '#ffffff', 0.6) : '#ffffff', a);
      c.fillRect(x, y, s, s);
      if (s === 2 && r() < 0.4) { c.fillStyle = rgba('#ffffff', a * 0.35); c.fillRect(x - 3, y + 0.5, 8, 1); c.fillRect(x + 0.5, y - 3, 1, 8); }
    }
    // special skies
    if (th.props === 'glacier') this.bakeAurora(c, w, horizon, th);
    if (th.props === 'temple') {
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 7; i++) {
        const x = w * (0.1 + r() * 0.8), sw = 30 + r() * 70, lean = (r() - 0.3) * 140;
        const rg = c.createLinearGradient(0, 0, 0, horizon);
        rg.addColorStop(0, rgba('#bff8ff', 0.12)); rg.addColorStop(1, rgba('#bff8ff', 0));
        c.fillStyle = rg; c.beginPath(); c.moveTo(x, 0); c.lineTo(x + sw, 0); c.lineTo(x + sw * 2.4 + lean, horizon); c.lineTo(x + lean, horizon); c.closePath(); c.fill();
      }
      c.globalCompositeOperation = 'source-over';
    }
    if (th.props === 'crystal') {
      // cave ceiling vignette
      const vg = c.createLinearGradient(0, 0, 0, h * 0.4); vg.addColorStop(0, 'rgba(0,0,0,0.6)'); vg.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = vg; c.fillRect(0, 0, w, h * 0.4);
    }
    // celestial body
    if (th.orb) this.bakeOrb(c, th.orb, w, h, horizon, haze);
    // horizon glow
    const hg = c.createLinearGradient(0, horizon - h * 0.35, 0, horizon + h * 0.1);
    hg.addColorStop(0, rgba(haze, 0)); hg.addColorStop(0.8, rgba(haze, 0.28)); hg.addColorStop(1, rgba(haze, 0.12));
    c.fillStyle = hg; c.fillRect(0, horizon - h * 0.35, w, h * 0.45);
    return img;
  }

  private bakeAurora(c: CanvasRenderingContext2D, w: number, horizon: number, th: StageDef['theme']) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    const cols = [th.accent, '#5ad8ff', '#b07aff'];
    for (let band = 0; band < 3; band++) {
      const y0 = horizon * (0.18 + band * 0.12);
      for (let x = -20; x < w + 20; x += 3) {
        const k = x / w;
        const y = y0 + Math.sin(k * 6 + band * 1.7) * horizon * 0.07 + Math.sin(k * 15 + band) * horizon * 0.02;
        const len = horizon * (0.18 + 0.12 * Math.sin(k * 9 + band * 2.3));
        const a = (0.05 + 0.05 * Math.sin(k * 23 + band)) * (band === 0 ? 1.3 : 1);
        const g = c.createLinearGradient(0, y, 0, y + len);
        g.addColorStop(0, rgba(cols[band], 0)); g.addColorStop(0.7, rgba(cols[band], a)); g.addColorStop(1, rgba(cols[band], 0));
        c.fillStyle = g; c.fillRect(x, y, 3, len);
      }
    }
    c.restore();
  }

  private bakeOrb(c: CanvasRenderingContext2D, o: NonNullable<StageDef['theme']['orb']>, w: number, h: number, horizon: number, haze: string) {
    const x = o.x * w, y = o.y * h, R = o.r * h;
    c.save();
    // wide soft glow
    const gl = c.createRadialGradient(x, y, R * 0.5, x, y, R * (o.kind === 'sun' ? 4 : 3));
    gl.addColorStop(0, rgba(o.color, o.kind === 'planet' ? 0.18 : 0.32)); gl.addColorStop(0.35, rgba(o.color, 0.08)); gl.addColorStop(1, rgba(o.color, 0));
    c.fillStyle = gl; c.fillRect(0, 0, w, h);
    if (o.kind === 'planet') {
      c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.clip();
      const pg = c.createLinearGradient(x - R, y - R, x + R * 0.4, y + R * 0.4);
      pg.addColorStop(0, mix(o.color, '#ffffff', 0.25)); pg.addColorStop(0.5, o.color); pg.addColorStop(1, '#02040e');
      c.fillStyle = pg; c.fillRect(x - R, y - R, R * 2, R * 2);
      const r = seeded(7);
      for (let i = 0; i < 9; i++) { c.fillStyle = rgba(i % 2 ? '#ffffff' : '#0a1a40', 0.06 + r() * 0.06); c.fillRect(x - R, y - R + R * 2 * r(), R * 2, R * (0.04 + r() * 0.1)); }
      c.restore(); c.save();
      c.strokeStyle = rgba(mix(o.color, '#ffffff', 0.5), 0.6); c.lineWidth = 3; c.shadowColor = o.color; c.shadowBlur = 24;
      c.beginPath(); c.arc(x, y, R, Math.PI * 1.05, Math.PI * 1.75); c.stroke();
      c.restore();
      return;
    }
    const sunLow = o.kind === 'sun';
    if (sunLow) { c.beginPath(); c.rect(0, 0, w, horizon + 2); c.clip(); }
    const dg = c.createRadialGradient(x - R * 0.3, y - R * 0.3, R * 0.1, x, y, R);
    dg.addColorStop(0, mix(o.color, '#ffffff', 0.55)); dg.addColorStop(1, o.color);
    c.shadowColor = o.color; c.shadowBlur = R * 0.6;
    c.fillStyle = dg; c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.fill();
    c.shadowBlur = 0;
    if (o.kind === 'moon') {
      const r = seeded(11);
      c.fillStyle = rgba('#5a6070', 0.12);
      for (let i = 0; i < 7; i++) { const a = r() * 6.28, d = r() * R * 0.6; c.beginPath(); c.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, R * (0.08 + r() * 0.16), 0, Math.PI * 2); c.fill(); }
      const sh = c.createLinearGradient(x - R, y, x + R, y); sh.addColorStop(0.55, 'rgba(0,0,10,0)'); sh.addColorStop(1, 'rgba(0,0,10,0.28)');
      c.fillStyle = sh; c.beginPath(); c.arc(x, y, R, 0, Math.PI * 2); c.fill();
    } else {
      // haze stripes across the low sun
      c.fillStyle = rgba(haze, 0.35);
      for (let i = 0; i < 5; i++) c.fillRect(x - R, y + R * (0.1 + i * 0.17), R * 2, R * (0.025 + i * 0.012));
    }
    c.restore();
  }

  /** Sky + stars and every parallax layer are rendered once into bitmaps, then just blitted each frame. */
  private drawBackground(stage: StageDef, time: number) {
    const { ctx } = this;
    const th = stage.theme;
    const q = Math.min(this.dpr, 1.25); // background resolution: softer = cheaper and reads as depth
    const skyKey = `sky:${stage.id}:${this.w}x${this.h}:${q}`;
    let sky = this.layerCache.get(skyKey);
    if (!sky) { sky = this.bakeSky(stage, this.w, this.h, q); this.layerCache.set(skyKey, sky); }
    ctx.drawImage(sky, 0, 0, this.w, this.h);

    const L = this.bgLayers(stage);
    const base = this.baseScale;
    // each layer bitmap covers the screen plus a parallax margin (MX/MY px) — small enough to blit cheaply
    const MX = 420, MY = 320;
    const ay = this.portrait ? 0.62 : 0.78;
    const haze = th.haze ?? th.sky[1];
    const sil = mix(th.skyMid ?? th.sky[0], '#000000', 0.45);
    L.layers.forEach((layer, li) => {
      const z = base * (0.55 + layer.depth * 0.5);
      const key = `bg:${stage.id}:${li}:${this.w}x${this.h}:${q}`;
      let img = this.layerCache.get(key);
      if (!img) {
        img = this.offscreen((this.w + MX * 2) * q, (this.h + MY * 2) * q);
        const c = img.getContext('2d')!;
        c.scale(q, q);
        c.save();
        c.translate(this.w / 2 + MX, this.h * ay + MY);
        c.scale(z, z);
        const col = layer.tint !== undefined ? mix(mix(haze, sil, 0.25), '#ffffff', layer.tint) : mix(sil, haze, layer.fog * 0.72);
        for (const sh of layer.shapes) { c.save(); this.drawBgShape(c, sh, col, th, 0, layer.depth); c.restore(); }
        c.restore();
        // atmospheric depth: fog thickens toward the horizon/base of each silhouette layer
        const Y0 = this.h * ay + MY;
        const fg = c.createLinearGradient(0, Y0 - this.h * 0.45, 0, Y0 + this.h * 0.25);
        fg.addColorStop(0, rgba(haze, 0)); fg.addColorStop(0.7, rgba(haze, 0.1 + layer.fog * 0.35)); fg.addColorStop(1, rgba(haze, 0.05 + layer.fog * 0.2));
        c.globalCompositeOperation = 'source-atop';
        c.fillStyle = fg; c.fillRect(0, 0, this.w + MX * 2, this.h + MY * 2);
        c.globalCompositeOperation = 'source-over';
        if (layer.haze) {
          // free-floating haze band in front of the far layer
          const hb = c.createLinearGradient(0, Y0 - this.h * 0.22, 0, Y0 + this.h * 0.18);
          hb.addColorStop(0, rgba(haze, 0)); hb.addColorStop(0.6, rgba(haze, 0.16)); hb.addColorStop(1, rgba(haze, 0));
          c.fillStyle = hb; c.fillRect(0, Y0 - this.h * 0.22, this.w + MX * 2, this.h * 0.4);
        }
        this.layerCache.set(key, img);
      }
      const dx = Math.max(-MX, Math.min(MX, -this.cam.x * layer.depth * z));
      const dy = Math.max(-MY, Math.min(MY, -(this.cam.y + 150) * layer.depth * z));
      ctx.drawImage(img, dx - MX, dy - MY, this.w + MX * 2, this.h + MY * 2);
    });
    if (th.props === 'storm') {
      // occasional lightning: a single translucent fill, only while flashing
      const t = time % 6.7;
      const k = t < 0.09 ? 1 : t > 0.18 && t < 0.26 ? 0.6 : 0;
      if (k) { ctx.fillStyle = `rgba(200,220,255,${0.13 * k})`; ctx.fillRect(0, 0, this.w, this.h); }
    }
    if (!this.lowFx && th.ambient) this.drawAmbient(stage, time);
  }

  /** Light-weight stateless ambient particles (≤40, fillRect/arc only), positions derived from time. */
  private ambientSeeds = new Map<string, number[][]>();
  private drawAmbient(stage: StageDef, time: number) {
    const { ctx } = this;
    const th = stage.theme;
    const kind = th.ambient!;
    const N = ({ rain: 40, snow: 40, embers: 30, petals: 24, bubbles: 22, dust: 28, fireflies: 22, spores: 26, pixels: 22, ash: 30, sparks: 18, streaks: 10, debris: 20 } as Record<string, number>)[kind] ?? 20;
    let seeds = this.ambientSeeds.get(stage.id);
    if (!seeds) {
      const r = seeded(stage.id.charCodeAt(0) * 131 + 5);
      seeds = Array.from({ length: N }, () => [r(), r(), r(), r(), r()]);
      this.ambientSeeds.set(stage.id, seeds);
    }
    const W = this.w + 40, H = this.h + 40;
    const z = this.cam.z;
    const px = -this.cam.x * z * 0.35, py = -this.cam.y * z * 0.35;
    const mod = (v: number, m: number) => ((v % m) + m) % m;
    const col = th.ambientColor ?? '#ffffff';
    const sz = Math.max(0.8, this.baseScale);
    ctx.save();
    ctx.fillStyle = col; ctx.strokeStyle = col;
    switch (kind) {
      case 'rain': {
        ctx.globalAlpha = 0.28; ctx.lineWidth = 1;
        ctx.beginPath();
        for (const [a, b, c] of seeds) {
          const sp = 900 + c * 500;
          const x = mod(a * W + px * 1.4 - time * sp * 0.18, W) - 20, y = mod(b * H + py + time * sp, H) - 20;
          ctx.moveTo(x, y); ctx.lineTo(x - 4 * sz, y + (14 + c * 10) * sz);
        }
        ctx.stroke();
        break;
      }
      case 'snow': case 'ash': {
        const fall = kind === 'snow' ? 40 : 22;
        for (const [a, b, c, d] of seeds) {
          const x = mod(a * W + px * (0.6 + c) + Math.sin(time * (0.6 + d) + a * 9) * 18, W) - 20;
          const y = mod(b * H + py * (0.6 + c) + time * fall * (0.6 + c), H) - 20;
          ctx.globalAlpha = (kind === 'snow' ? 0.45 : 0.3) + c * 0.4;
          const s = (1 + c * 2) * sz;
          ctx.fillRect(x, y, s, s);
        }
        break;
      }
      case 'embers': case 'spores': case 'fireflies': case 'dust': {
        const rise = kind === 'embers' ? 70 : kind === 'spores' ? 18 : kind === 'dust' ? 6 : 4;
        if (kind !== 'dust') ctx.globalCompositeOperation = 'lighter';
        for (const [a, b, c, d] of seeds) {
          const x = mod(a * W + px * (0.5 + c) + Math.sin(time * (0.5 + d) + a * 7) * (kind === 'fireflies' ? 30 : 14) + (kind === 'dust' ? time * 8 : 0), W) - 20;
          const y = mod(b * H + py * (0.5 + c) - time * rise * (0.5 + c) + (kind === 'fireflies' ? Math.cos(time * (0.7 + c) + d * 9) * 20 : 0), H) - 20;
          const pulse = kind === 'fireflies' ? Math.max(0, Math.sin(time * (1.5 + d * 2) + a * 20)) : kind === 'embers' ? 0.5 + 0.5 * Math.sin(time * 9 + d * 30) : 0.6 + 0.4 * Math.sin(time * 2 + d * 10);
          const s = (kind === 'embers' ? 1.5 + c * 1.5 : kind === 'dust' ? 1 + c : 1.5 + c * 1.5) * sz;
          if (kind !== 'dust') { ctx.globalAlpha = 0.12 * pulse; ctx.fillRect(x - s * 1.5, y - s * 1.5, s * 4, s * 4); }
          ctx.globalAlpha = (kind === 'dust' ? 0.25 : 0.75) * pulse;
          ctx.fillRect(x, y, s, s);
        }
        break;
      }
      case 'petals': {
        for (const [a, b, c, d] of seeds) {
          const x = mod(a * W + px * (0.6 + c) - time * 30 * (0.5 + c) + Math.sin(time * 1.2 + d * 9) * 26, W) - 20;
          const y = mod(b * H + py * (0.6 + c) + time * 34 * (0.5 + c), H) - 20;
          const flip = Math.abs(Math.cos(time * (2 + d * 2) + a * 10));
          ctx.globalAlpha = 0.55 + c * 0.35;
          ctx.fillStyle = c > 0.5 ? col : mix(col, '#ffffff', 0.4);
          ctx.fillRect(x, y, (1 + flip * 4) * sz, 3 * sz);
        }
        break;
      }
      case 'bubbles': {
        ctx.lineWidth = 1.2; ctx.globalAlpha = 0.45;
        ctx.beginPath();
        for (const [a, b, c, d] of seeds) {
          const x = mod(a * W + px * (0.5 + c) + Math.sin(time * 1.5 + d * 9) * 10, W) - 20;
          const y = mod(b * H + py * (0.5 + c) - time * 40 * (0.6 + c), H) - 20;
          const rr = (1.5 + c * 4) * sz;
          ctx.moveTo(x + rr, y); ctx.arc(x, y, rr, 0, Math.PI * 2);
        }
        ctx.stroke();
        break;
      }
      case 'pixels': {
        const cols = [col, th.edge, th.accent];
        for (let i = 0; i < seeds.length; i++) {
          const [a, b, c, d] = seeds[i];
          const x = Math.round((mod(a * W + px * (0.6 + c), W) - 20) / 4) * 4;
          const y = Math.round((mod(b * H + py * (0.6 + c) - time * 24 * (0.5 + c), H) - 20) / 4) * 4;
          ctx.globalAlpha = 0.25 + 0.35 * (Math.sin(time * 3 + d * 20) > 0 ? 1 : 0.3);
          ctx.fillStyle = cols[i % 3];
          const s = (c > 0.6 ? 4 : 3) * sz;
          ctx.fillRect(x, y, s, s);
        }
        break;
      }
      case 'sparks': {
        ctx.globalCompositeOperation = 'lighter'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (const [a, b, c, d] of seeds) {
          // short bursts from fixed emitters, falling with gravity
          const per = 1.6 + d * 1.8, t = mod(time + a * per, per);
          if (t > 0.9) continue;
          const ex = mod(a * W + px * 0.5, W) - 20, ey = (0.15 + b * 0.4) * this.h + py * 0.5;
          const vx = (c - 0.5) * 120, x = ex + vx * t, y = ey + 40 * t + 260 * t * t;
          ctx.moveTo(x, y); ctx.lineTo(x - vx * 0.04, y - (40 + 520 * t) * 0.03);
        }
        ctx.globalAlpha = 0.7; ctx.stroke();
        break;
      }
      case 'streaks': {
        ctx.globalCompositeOperation = 'lighter';
        const yb = this.h * (this.portrait ? 0.62 : 0.78);
        for (let i = 0; i < seeds.length; i++) {
          const [a, b, c] = seeds[i];
          const dir = i % 2 ? 1 : -1, len = (60 + c * 120) * sz;
          const x = mod(a * (W + 400) + dir * time * (500 + c * 700) + px * 0.4, W + 400) - 200;
          const y = yb - (0.22 + b * 0.18) * this.h + py * 0.25;
          ctx.globalAlpha = 0.18 + c * 0.25;
          ctx.fillStyle = dir > 0 ? col : th.accent;
          ctx.fillRect(x, y, len, 1.5 * sz);
        }
        break;
      }
      case 'debris': {
        for (const [a, b, c, d] of seeds) {
          const x = mod(a * W + px * (0.8 + c) + time * 6 * (c - 0.5), W) - 20, y = mod(b * H + py * (0.8 + c) + time * 3 * (d - 0.5), H) - 20;
          ctx.globalAlpha = 0.25 + 0.35 * Math.abs(Math.sin(time * (0.8 + d) + a * 9));
          ctx.fillRect(x, y, (1 + c * 3) * sz, (1 + d * 1.5) * sz);
        }
        break;
      }
    }
    ctx.restore();
  }

  /** One background prop, drawn into a layer bitmap (never per frame — shadows/gradients are fine here). */
  private drawBgShape(ctx: CanvasRenderingContext2D, s: any, col: string, th: StageDef['theme'], time: number, depth: number) {
    void time;
    ctx.fillStyle = col;
    const glow = (color: string, blur: number) => { ctx.shadowColor = color; ctx.shadowBlur = blur; };
    const noGlow = () => { ctx.shadowBlur = 0; };
    const P = (pts: number[][]) => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); };
    const near = depth > 0.4;
    switch (s.type) {
      case 'ridge': case 'icecliff': case 'mesa': {
        ctx.beginPath(); ctx.moveTo(-2000, 900);
        for (const [x, y] of s.pts) ctx.lineTo(x, y);
        ctx.lineTo(2000, 900); ctx.closePath(); ctx.fill();
        if (s.cap) {
          // snow caps / moonlit rim on peaks
          ctx.fillStyle = rgba(s.cap, s.capAll ? 0.5 : 0.28);
          for (let i = 1; i < s.pts.length - 1; i++) {
            const [x, y] = s.pts[i], [px, py] = s.pts[i - 1], [nx, ny] = s.pts[i + 1];
            if (y < py && y < ny && (s.capAll || y < -180)) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (nx - x) * 0.35, y + (ny - y) * 0.35 + 8); ctx.lineTo(x + (px - x) * 0.3, y + (py - y) * 0.3 + 14); ctx.closePath(); ctx.fill(); }
          }
        }
        if (s.type === 'icecliff') {
          ctx.strokeStyle = rgba('#dff8ff', 0.22); ctx.lineWidth = 3;
          for (let i = 0; i < s.pts.length; i += 2) { const [x, y] = s.pts[i]; ctx.beginPath(); ctx.moveTo(x, y + 6); ctx.lineTo(x + 18, y + 120); ctx.stroke(); }
          ctx.strokeStyle = rgba('#e8fbff', 0.5); ctx.lineWidth = 4;
          ctx.beginPath(); s.pts.forEach(([x, y]: number[], i: number) => (i ? ctx.lineTo(x, y + 2) : ctx.moveTo(x, y + 2))); ctx.stroke();
        }
        if (s.type === 'mesa') {
          ctx.strokeStyle = rgba(th.edge, 0.12); ctx.lineWidth = 6;
          ctx.beginPath(); s.pts.forEach(([x, y]: number[], i: number) => (i ? ctx.lineTo(x, y + 3) : ctx.moveTo(x, y + 3))); ctx.stroke();
        }
        break;
      }
      case 'tower': {
        ctx.fillRect(s.x, -s.h, s.w, s.h + 900);
        // roofline details
        ctx.fillRect(s.x + s.w * 0.2, -s.h - 10, s.w * 0.6, 10);
        if (s.spire) { ctx.fillRect(s.x + s.w / 2 - 2, -s.h - 70, 4, 60); ctx.save(); ctx.fillStyle = '#ff3a4a'; glow('#ff3a4a', 10); ctx.fillRect(s.x + s.w / 2 - 3, -s.h - 74, 6, 6); ctx.restore(); }
        if (s.tank) { ctx.fillRect(s.x + 10, -s.h - 40, 34, 30); ctx.fillRect(s.x + 14, -s.h - 10, 4, 10); ctx.fillRect(s.x + 36, -s.h - 10, 4, 10); }
        // rim light on the right edge
        ctx.fillStyle = rgba(th.edge, near ? 0.18 : 0.08); ctx.fillRect(s.x + s.w - 3, -s.h, 3, s.h + 400);
        if (s.wins?.length) {
          ctx.globalAlpha = near ? 0.75 : 0.45;
          for (const [wx, wy] of s.wins) {
            ctx.fillStyle = wy > 0.7 ? mix(th.accent, '#ffffff', 0.3) : wx > 0.6 ? '#ffd9a0' : th.accent;
            ctx.fillRect(s.x + 8 + Math.floor(wx * (s.w - 22) / 12) * 12, -s.h + 14 + Math.floor(wy * (s.h - 30) / 16) * 16, 7, 9);
          }
          ctx.globalAlpha = 1;
        }
        if (s.sign) {
          const c2 = s.sign === 1 ? th.edge : th.accent;
          ctx.save(); ctx.strokeStyle = c2; ctx.lineWidth = 4; glow(c2, 22);
          const sw = Math.min(26, s.w * 0.3);
          ctx.strokeRect(s.x + s.w - sw - 6, -s.h + 30, sw, Math.min(130, s.h * 0.55));
          ctx.fillStyle = c2; ctx.globalAlpha = 0.8;
          for (let i = 0; i < 4; i++) ctx.fillRect(s.x + s.w - sw, -s.h + 42 + i * 26, sw - 12, 12);
          ctx.restore();
        }
        break;
      }
      case 'pine': {
        const y = s.y;
        ctx.beginPath(); ctx.moveTo(s.x, y - s.h);
        for (let i = 1; i <= 4; i++) { const k = i / 4; ctx.lineTo(s.x + s.h * 0.22 * k + 6, y - s.h + s.h * k * 0.95); ctx.lineTo(s.x + s.h * 0.08 * k, y - s.h + s.h * k * 0.95 - 4); }
        for (let i = 4; i >= 1; i--) { const k = i / 4; ctx.lineTo(s.x - s.h * 0.08 * k, y - s.h + s.h * k * 0.95 - 4); ctx.lineTo(s.x - s.h * 0.22 * k - 6, y - s.h + s.h * k * 0.95); }
        ctx.closePath(); ctx.fill();
        ctx.fillRect(s.x - 3, y - 6, 6, 900);
        if (s.snow) { ctx.fillStyle = rgba('#e8f6ff', 0.4); ctx.beginPath(); ctx.moveTo(s.x, y - s.h); ctx.lineTo(s.x + s.h * 0.08, y - s.h * 0.75); ctx.lineTo(s.x - s.h * 0.1, y - s.h * 0.72); ctx.closePath(); ctx.fill(); }
        break;
      }
      case 'pagoda': {
        for (let i = 0; i < 4; i++) {
          const y = -s.h + i * 46, w = 52 + i * 22;
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.moveTo(s.x - w - 14, y + 16); ctx.quadraticCurveTo(s.x - w * 0.5, y + 4, s.x, y - 14); ctx.quadraticCurveTo(s.x + w * 0.5, y + 4, s.x + w + 14, y + 16); ctx.lineTo(s.x + w, y + 22); ctx.lineTo(s.x - w, y + 22); ctx.closePath(); ctx.fill();
          ctx.fillRect(s.x - w * 0.62, y + 20, w * 1.24, 26);
          ctx.save(); ctx.fillStyle = th.edge; glow(th.edge, 14); ctx.globalAlpha = 0.55;
          for (let k = -1; k <= 1; k++) ctx.fillRect(s.x + k * w * 0.36 - 5, y + 26, 10, 14);
          ctx.restore();
        }
        ctx.fillStyle = col; ctx.fillRect(s.x - 3, -s.h - 60, 6, 50);
        ctx.fillRect(s.x - 56, -s.h + 200, 112, 800);
        break;
      }
      case 'bamboo': {
        for (let i = 0; i < s.n; i++) {
          const x = s.x + i * 22, h = s.h * (0.8 + 0.2 * Math.sin(i * 3));
          ctx.fillRect(x, -h, 9, h + 800);
          ctx.fillStyle = mix(col, '#000000', 0.3);
          for (let y = -h + 50; y < 0; y += 60) ctx.fillRect(x - 1, y, 11, 3);
          ctx.fillStyle = col;
          for (let y = -h + 40; y < -100; y += 110) { ctx.beginPath(); ctx.ellipse(x + 26, y, 26, 5, -0.4, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(x - 18, y + 30, 22, 4, 0.4, 0, Math.PI * 2); ctx.fill(); }
        }
        break;
      }
      case 'dome': {
        const cx = s.x + s.w / 2, dh = s.w * 0.55;
        ctx.beginPath(); ctx.moveTo(s.x, -s.h); ctx.bezierCurveTo(s.x, -s.h - dh * 0.9, cx - 6, -s.h - dh * 0.9, cx, -s.h - dh * 1.25); ctx.bezierCurveTo(cx + 6, -s.h - dh * 0.9, s.x + s.w, -s.h - dh * 0.9, s.x + s.w, -s.h); ctx.closePath(); ctx.fill();
        ctx.fillRect(s.x - 4, -s.h, s.w + 8, s.h + 800);
        ctx.fillRect(cx - 2, -s.h - dh * 1.25 - 26, 4, 28);
        if (s.minaret) { ctx.fillRect(s.x - 30, -s.h - 120, 16, s.h + 920); ctx.beginPath(); ctx.moveTo(s.x - 34, -s.h - 120); ctx.lineTo(s.x - 22, -s.h - 160); ctx.lineTo(s.x - 10, -s.h - 120); ctx.fill(); ctx.fillRect(s.x - 36, -s.h - 70, 28, 6); }
        if (s.lit) {
          ctx.save(); ctx.fillStyle = '#ffb54a'; glow('#ff8a20', 16); ctx.globalAlpha = 0.7;
          const n = Math.max(1, Math.floor(s.w / 40));
          for (let i = 0; i < n; i++) { const x = s.x + (i + 0.5) * (s.w / n) - 7; ctx.beginPath(); ctx.moveTo(x, -s.h + 70); ctx.lineTo(x, -s.h + 40); ctx.arc(x + 7, -s.h + 40, 7, Math.PI, 0); ctx.lineTo(x + 14, -s.h + 70); ctx.closePath(); ctx.fill(); }
          ctx.restore();
        }
        break;
      }
      case 'string': {
        ctx.strokeStyle = rgba('#1a0a10', 0.8); ctx.lineWidth = 2;
        const mid = (s.x1 + s.x2) / 2;
        ctx.beginPath(); ctx.moveTo(s.x1, s.y); ctx.quadraticCurveTo(mid, s.y + s.sag * 2, s.x2, s.y); ctx.stroke();
        ctx.save(); glow('#ffb02e', 12);
        for (let i = 1; i < s.n; i++) {
          const t = i / s.n, x = s.x1 + (s.x2 - s.x1) * t, y = s.y + s.sag * 2 * 2 * t * (1 - t);
          ctx.fillStyle = i % 3 === 0 ? th.accent : '#ffc04a'; ctx.beginPath(); ctx.arc(x, y + 4, 4, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'lantern': {
        const w = 14 * s.s, h = 20 * s.s;
        ctx.save();
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, h * 3);
        g.addColorStop(0, 'rgba(255,170,60,0.35)'); g.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = g; ctx.fillRect(s.x - h * 3, s.y - h * 3, h * 6, h * 6);
        ctx.fillStyle = '#ffb02e'; glow('#ff8a00', 22);
        ctx.beginPath(); ctx.ellipse(s.x, s.y, w, h, 0, 0, Math.PI * 2); ctx.fill();
        noGlow(); ctx.fillStyle = '#5a1a10'; ctx.fillRect(s.x - w * 0.6, s.y - h - 3, w * 1.2, 4); ctx.fillRect(s.x - w * 0.6, s.y + h - 1, w * 1.2, 4);
        ctx.fillStyle = 'rgba(255,240,200,0.55)'; ctx.fillRect(s.x - 1, s.y - h + 4, 2, h * 2 - 8);
        ctx.restore();
        break;
      }
      case 'core': {
        ctx.save();
        const g = ctx.createRadialGradient(s.x, s.y, s.r * 0.2, s.x, s.y, s.r * 1.6);
        g.addColorStop(0, rgba(th.edge, 0.35)); g.addColorStop(0.5, rgba(th.edge, 0.08)); g.addColorStop(1, rgba(th.edge, 0));
        ctx.fillStyle = g; ctx.fillRect(s.x - s.r * 1.6, s.y - s.r * 1.6, s.r * 3.2, s.r * 3.2);
        ctx.strokeStyle = mix(th.edge, '#ffffff', 0.2); ctx.lineWidth = 10; glow(th.edge, 34);
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 4; ctx.strokeStyle = th.accent; glow(th.accent, 20);
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 0.78, 0.3, 2.6); ctx.stroke(); ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 0.78, 3.4, 5.8); ctx.stroke();
        noGlow(); ctx.fillStyle = col;
        for (let i = 0; i < 8; i++) { ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(i * Math.PI / 4); ctx.fillRect(s.r - 14, -10, 40, 20); ctx.restore(); }
        ctx.restore();
        break;
      }
      case 'pipe': {
        ctx.fillRect(s.x, -s.h, s.w, s.h + 800);
        ctx.fillStyle = rgba('#ffffff', 0.05); ctx.fillRect(s.x + s.w * 0.15, -s.h, s.w * 0.18, s.h + 800);
        ctx.fillStyle = col;
        for (let y = -s.h + 40; y < 200; y += 160) ctx.fillRect(s.x - 8, y, s.w + 16, 14);
        if (s.valve) { ctx.beginPath(); ctx.arc(s.x + s.w / 2, -s.h * 0.5, s.w * 0.6, 0, Math.PI * 2); ctx.fill(); }
        ctx.save(); ctx.fillStyle = th.edge; glow(th.edge, 14); ctx.globalAlpha = 0.85;
        ctx.fillRect(s.x + s.w / 2 - 3, -s.h + 80, 6, 26);
        if (near) { ctx.fillStyle = th.accent; glow(th.accent, 12); ctx.fillRect(s.x + s.w / 2 - 2, -s.h * 0.3, 4, 4); }
        ctx.restore();
        break;
      }
      case 'girder': {
        ctx.fillRect(s.x1, s.y, s.x2 - s.x1, 18); ctx.fillRect(s.x1, s.y + 70, s.x2 - s.x1, 14);
        ctx.strokeStyle = col; ctx.lineWidth = 7;
        ctx.beginPath(); for (let x = s.x1; x < s.x2; x += 80) { ctx.moveTo(x, s.y + 16); ctx.lineTo(x + 40, s.y + 72); ctx.lineTo(x + 80, s.y + 16); } ctx.stroke();
        ctx.save(); glow('#ffcf3a', 10); ctx.fillStyle = '#ffcf3a';
        for (let x = s.x1 + 120; x < s.x2; x += 360) ctx.fillRect(x, s.y + 84, 8, 6);
        ctx.restore();
        break;
      }
      case 'cloud': {
        const lit = mix(col, '#ffffff', 0.25), dk = mix(col, th.sky[0], 0.35);
        const puffs = [[0, 0, 40], [35, -18, 46], [78, -4, 40], [40, 12, 42], [110, 8, 30], [-30, 10, 30]];
        ctx.fillStyle = rgba(dk, 0.45);
        for (const [dx, dy, rr] of puffs) { ctx.beginPath(); ctx.arc(s.x + dx * s.s, s.y + (dy + 8) * s.s, rr * s.s, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = rgba(lit, near ? 0.5 : 0.6);
        for (const [dx, dy, rr] of puffs) { ctx.beginPath(); ctx.arc(s.x + dx * s.s, s.y + dy * s.s, rr * s.s * 0.92, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      case 'isle': {
        ctx.beginPath(); ctx.moveTo(s.x - s.w / 2, s.y); ctx.lineTo(s.x + s.w / 2, s.y);
        ctx.lineTo(s.x + s.w * 0.3, s.y + 40); ctx.lineTo(s.x + s.w * 0.1, s.y + 110); ctx.lineTo(s.x - s.w * 0.05, s.y + 150); ctx.lineTo(s.x - s.w * 0.25, s.y + 70); ctx.closePath(); ctx.fill();
        for (let i = 0; i < s.cols; i++) {
          const x = s.x - s.w / 2 + 20 + i * (s.w - 40) / Math.max(1, s.cols - 1 || 1), h = 70 + ((i * 37) % 60);
          ctx.fillRect(x - 9, s.y - h, 18, h); ctx.fillRect(x - 14, s.y - h - 8, 28, 8);
        }
        ctx.fillStyle = rgba(th.edge, 0.2); ctx.fillRect(s.x - s.w / 2, s.y - 2, s.w, 3);
        break;
      }
      case 'cypress': {
        ctx.beginPath(); ctx.moveTo(s.x, -s.h);
        ctx.bezierCurveTo(s.x + s.w * 0.9, -s.h * 0.7, s.x + s.w * 0.7, -s.h * 0.15, s.x + s.w * 0.25, 0);
        ctx.lineTo(s.x - s.w * 0.25, 0);
        ctx.bezierCurveTo(s.x - s.w * 0.7, -s.h * 0.15, s.x - s.w * 0.9, -s.h * 0.7, s.x, -s.h);
        ctx.fill(); ctx.fillRect(s.x - 3, -4, 6, 800);
        ctx.fillStyle = rgba('#d8e8ff', 0.07); ctx.beginPath(); ctx.moveTo(s.x, -s.h); ctx.bezierCurveTo(s.x + s.w * 0.9, -s.h * 0.7, s.x + s.w * 0.7, -s.h * 0.15, s.x + s.w * 0.25, 0); ctx.lineTo(s.x + 2, 0); ctx.closePath(); ctx.fill();
        break;
      }
      case 'gardenwall': {
        ctx.fillRect(s.x1, -s.h, s.x2 - s.x1, s.h + 800);
        ctx.fillStyle = rgba(th.edge, 0.12);
        for (let x = s.x1; x < s.x2; x += 90) { ctx.beginPath(); ctx.moveTo(x + 20, -8); ctx.lineTo(x + 20, -s.h + 28); ctx.arc(x + 45, -s.h + 28, 25, Math.PI, 0); ctx.lineTo(x + 70, -8); ctx.closePath(); ctx.fill(); }
        ctx.fillStyle = col; for (let x = s.x1; x < s.x2; x += 30) ctx.fillRect(x, -s.h - 8, 18, 8);
        break;
      }
      case 'kushk': {
        const x0 = s.x - s.w / 2;
        ctx.fillRect(x0, -s.h, s.w, s.h + 800);
        // central dome + side minarets
        ctx.beginPath(); ctx.moveTo(s.x - 110, -s.h); ctx.bezierCurveTo(s.x - 110, -s.h - 120, s.x - 10, -s.h - 140, s.x, -s.h - 190); ctx.bezierCurveTo(s.x + 10, -s.h - 140, s.x + 110, -s.h - 120, s.x + 110, -s.h); ctx.fill();
        ctx.fillRect(s.x - 2, -s.h - 230, 4, 44);
        for (const mx of [x0 + 10, x0 + s.w - 34]) { ctx.fillRect(mx, -s.h - 150, 24, 160); ctx.beginPath(); ctx.moveTo(mx - 4, -s.h - 150); ctx.lineTo(mx + 12, -s.h - 200); ctx.lineTo(mx + 28, -s.h - 150); ctx.fill(); }
        // iwan arch glowing warm + tile band
        ctx.save();
        const gw = ctx.createLinearGradient(0, -s.h + 30, 0, 0); gw.addColorStop(0, rgba('#ffcf6b', 0.7)); gw.addColorStop(1, rgba('#ff9a3a', 0.25));
        ctx.fillStyle = gw; glow('#ffb04a', 26);
        ctx.beginPath(); ctx.moveTo(s.x - 60, 0); ctx.lineTo(s.x - 60, -s.h + 90); ctx.quadraticCurveTo(s.x - 60, -s.h + 30, s.x, -s.h + 18); ctx.quadraticCurveTo(s.x + 60, -s.h + 30, s.x + 60, -s.h + 90); ctx.lineTo(s.x + 60, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = rgba('#ffcf6b', 0.55); glow('#ffb04a', 12);
        for (const k of [-1, 1]) for (let i = 0; i < 2; i++) { const ax = s.x + k * (120 + i * 70) - 16; ctx.beginPath(); ctx.moveTo(ax, -20); ctx.lineTo(ax, -s.h * 0.45); ctx.arc(ax + 16, -s.h * 0.45, 16, Math.PI, 0); ctx.lineTo(ax + 32, -20); ctx.closePath(); ctx.fill(); }
        noGlow(); ctx.fillStyle = rgba(th.edge, 0.35); ctx.fillRect(x0, -s.h + 4, s.w, 6);
        ctx.restore();
        break;
      }
      case 'pool': {
        ctx.save();
        const pg = ctx.createLinearGradient(0, s.y, 0, s.y + s.h); pg.addColorStop(0, rgba(th.edge, 0.3)); pg.addColorStop(1, rgba('#0a1a30', 0.6));
        ctx.fillStyle = pg; ctx.fillRect(s.x1, s.y, s.x2 - s.x1, s.h);
        ctx.fillStyle = rgba('#ffcf6b', 0.45); for (let i = 0; i < 6; i++) ctx.fillRect(s.x1 + (s.x2 - s.x1) * 0.5 - 30 + (i % 2) * 14, s.y + 6 + i * 7, 60 - i * 8, 2);
        ctx.fillStyle = rgba('#e8f2ff', 0.25); ctx.fillRect(s.x1, s.y, s.x2 - s.x1, 2);
        ctx.restore();
        break;
      }
      case 'lamp': {
        ctx.fillRect(s.x - 2, s.y - 40, 4, 40 + 800);
        ctx.save(); ctx.fillStyle = '#ffd890'; glow('#ffb04a', 18); ctx.beginPath(); ctx.arc(s.x, s.y - 46, 6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        break;
      }
      case 'butte': {
        const x0 = s.x - s.w / 2, top = -s.h;
        ctx.beginPath(); ctx.moveTo(x0 - 60, 40); ctx.lineTo(x0, top + 30); ctx.lineTo(x0 + 16, top); ctx.lineTo(x0 + s.w - 20, top); ctx.lineTo(x0 + s.w, top + 24); ctx.lineTo(x0 + s.w + 70, 40); ctx.lineTo(x0 + s.w + 70, 900); ctx.lineTo(x0 - 60, 900); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = rgba('#000000', 0.18); ctx.lineWidth = 3;
        for (let i = 1; i <= s.strata; i++) { const y = top + (s.h / (s.strata + 1)) * i; ctx.beginPath(); ctx.moveTo(x0 + 4 - i * 4, y); ctx.lineTo(x0 + s.w + i * 5, y + 3); ctx.stroke(); }
        ctx.fillStyle = rgba(th.edge, 0.22); P([[x0 + 16, top], [x0 + s.w - 20, top], [x0 + s.w, top + 24], [x0 + s.w + 70, 40], [x0 + s.w + 50, 40], [x0 + s.w - 26, top + 6]]); ctx.fill();
        break;
      }
      case 'spire': {
        if (s.gothic) {
          ctx.fillRect(s.x - s.w / 2, -s.h * 0.6, s.w, s.h + 800);
          P([[s.x - s.w / 2 - 4, -s.h * 0.6], [s.x, -s.h], [s.x + s.w / 2 + 4, -s.h * 0.6]]); ctx.fill();
          ctx.fillRect(s.x - 2, -s.h - 40, 4, 44); ctx.fillRect(s.x - 12, -s.h - 28, 24, 4);
          ctx.fillStyle = rgba(th.accent, 0.35); ctx.beginPath(); ctx.moveTo(s.x - 6, -s.h * 0.3); ctx.lineTo(s.x - 6, -s.h * 0.45); ctx.lineTo(s.x, -s.h * 0.5); ctx.lineTo(s.x + 6, -s.h * 0.45); ctx.lineTo(s.x + 6, -s.h * 0.3); ctx.fill();
          break;
        }
        P([[s.x - s.w * 0.8, 40], [s.x - s.w * 0.45, -s.h * 0.6], [s.x - s.w * 0.3, -s.h], [s.x + s.w * 0.25, -s.h * 0.95], [s.x + s.w * 0.4, -s.h * 0.5], [s.x + s.w * 0.9, 40], [s.x + s.w * 0.9, 900], [s.x - s.w * 0.8, 900]]); ctx.fill();
        ctx.fillStyle = rgba(th.edge, 0.18); P([[s.x + s.w * 0.25, -s.h * 0.95], [s.x + s.w * 0.4, -s.h * 0.5], [s.x + s.w * 0.9, 40], [s.x + s.w * 0.6, 40], [s.x + s.w * 0.15, -s.h * 0.85]]); ctx.fill();
        break;
      }
      case 'arch': {
        const x0 = s.x - s.w / 2, th2 = s.w * 0.22;
        ctx.beginPath(); ctx.moveTo(x0, 900); ctx.lineTo(x0, -s.h * 0.6); ctx.quadraticCurveTo(x0 + 10, -s.h, s.x, -s.h); ctx.quadraticCurveTo(x0 + s.w - 10, -s.h, x0 + s.w, -s.h * 0.6); ctx.lineTo(x0 + s.w, 900);
        ctx.lineTo(x0 + s.w - th2, 900); ctx.lineTo(x0 + s.w - th2, -s.h * 0.45); ctx.quadraticCurveTo(x0 + s.w - th2, -s.h + th2 * 0.9, s.x, -s.h + th2 * 0.9); ctx.quadraticCurveTo(x0 + th2, -s.h + th2 * 0.9, x0 + th2, -s.h * 0.45); ctx.lineTo(x0 + th2, 900); ctx.closePath(); ctx.fill();
        ctx.fillStyle = rgba(th.edge, 0.16); ctx.fillRect(x0 + s.w - 8, -s.h * 0.6, 8, s.h * 0.6 + 40);
        break;
      }
      case 'shard': {
        ctx.save(); ctx.translate(s.x, 30); ctx.rotate(s.lean);
        P([[-s.w / 2, 0], [-s.w * 0.2, -s.h], [s.w * 0.1, -s.h * 0.92], [s.w / 2, 0], [s.w / 2, 600], [-s.w / 2, 600]]); ctx.fill();
        ctx.fillStyle = rgba('#dff8ff', 0.2); P([[-s.w * 0.2, -s.h], [s.w * 0.1, -s.h * 0.92], [s.w / 2, 0], [s.w * 0.05, 0]]); ctx.fill();
        ctx.strokeStyle = rgba('#e8fbff', 0.45); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-s.w * 0.2, -s.h); ctx.lineTo(s.w * 0.05, 0); ctx.stroke();
        ctx.restore();
        break;
      }
      case 'volcano': {
        const x0 = s.x - s.w / 2;
        ctx.beginPath(); ctx.moveTo(x0 - 200, 60); ctx.quadraticCurveTo(s.x - s.w * 0.2, -s.h * 0.6, s.x - s.w * 0.08, -s.h); ctx.lineTo(s.x + s.w * 0.08, -s.h); ctx.quadraticCurveTo(s.x + s.w * 0.2, -s.h * 0.6, x0 + s.w + 200, 60); ctx.lineTo(x0 + s.w + 200, 900); ctx.lineTo(x0 - 200, 900); ctx.closePath(); ctx.fill();
        ctx.save();
        const g = ctx.createRadialGradient(s.x, -s.h, 0, s.x, -s.h, s.w * 0.4);
        g.addColorStop(0, rgba('#ff7a2a', 0.55)); g.addColorStop(1, rgba('#ff3a1a', 0));
        ctx.fillStyle = g; ctx.fillRect(s.x - s.w * 0.4, -s.h - s.w * 0.4, s.w * 0.8, s.w * 0.8);
        ctx.strokeStyle = '#ff6a1a'; ctx.lineWidth = 4; glow('#ff4a0a', 16); ctx.globalAlpha = 0.8;
        for (const k of [-1, 0.4, 1]) { ctx.beginPath(); ctx.moveTo(s.x + k * s.w * 0.05, -s.h + 4); ctx.quadraticCurveTo(s.x + k * s.w * 0.12, -s.h * 0.6, s.x + k * s.w * 0.2 + 30, -s.h * 0.25); ctx.stroke(); }
        // smoke plume
        noGlow(); ctx.globalAlpha = 1; ctx.fillStyle = rgba('#200808', 0.22);
        for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(s.x + i * 30 + Math.sin(i) * 20, -s.h - 60 - i * 70, 50 + i * 18, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
        break;
      }
      case 'stack': {
        P([[s.x - s.w * 0.6, 900], [s.x - s.w / 2, -s.h], [s.x + s.w / 2, -s.h], [s.x + s.w * 0.6, 900]]); ctx.fill();
        ctx.fillRect(s.x - s.w / 2 - 8, -s.h - 14, s.w + 16, 16);
        ctx.fillStyle = rgba('#200808', 0.2);
        for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(s.x + i * 18, -s.h - 40 - i * 46, 22 + i * 10, 0, Math.PI * 2); ctx.fill(); }
        if (s.mouth) {
          ctx.save(); const my = -s.h * 0.3;
          const g = ctx.createRadialGradient(s.x, my, 0, s.x, my, 80); g.addColorStop(0, rgba('#ffb03a', 0.5)); g.addColorStop(1, rgba('#ff4a0a', 0));
          ctx.fillStyle = g; ctx.fillRect(s.x - 80, my - 80, 160, 160);
          ctx.fillStyle = '#ff8a2a'; glow('#ff5a0a', 20);
          ctx.beginPath(); ctx.moveTo(s.x - 18, my + 20); ctx.lineTo(s.x - 18, my); ctx.arc(s.x, my, 18, Math.PI, 0); ctx.lineTo(s.x + 18, my + 20); ctx.closePath(); ctx.fill();
          ctx.restore();
        }
        break;
      }
      case 'chain': {
        ctx.strokeStyle = col; ctx.lineWidth = 6;
        for (let y = s.y; y < s.y + s.len; y += 22) { ctx.beginPath(); ctx.ellipse(s.x, y, (y / 22) % 2 < 1 ? 7 : 3, 11, 0, 0, Math.PI * 2); ctx.stroke(); }
        const ey = s.y + s.len;
        if (s.hook) { ctx.lineWidth = 9; ctx.beginPath(); ctx.arc(s.x - 14, ey + 18, 18, -0.3, Math.PI * 0.95); ctx.stroke(); }
        else {
          // cauldron with molten glow
          P([[s.x - 50, ey + 10], [s.x + 50, ey + 10], [s.x + 38, ey + 70], [s.x - 38, ey + 70]]); ctx.fill();
          ctx.save(); ctx.fillStyle = '#ff9a3a'; glow('#ff5a0a', 24); ctx.fillRect(s.x - 46, ey + 6, 92, 7); ctx.restore();
        }
        break;
      }
      case 'lavaflow': {
        ctx.save();
        const g = ctx.createLinearGradient(0, s.y - 60, 0, s.y + 120); g.addColorStop(0, rgba('#ff6a1a', 0)); g.addColorStop(0.4, rgba('#ff6a1a', 0.35)); g.addColorStop(1, rgba('#ff9a3a', 0.15));
        ctx.fillStyle = g; ctx.fillRect(s.x1, s.y - 60, s.x2 - s.x1, 400);
        ctx.strokeStyle = rgba('#ffcf6a', 0.18); ctx.lineWidth = 3;
        for (let i = 0; i < 4; i++) { ctx.beginPath(); for (let x = s.x1; x <= s.x2; x += 60) { const y = s.y + 20 + i * 26 + Math.sin(x * 0.01 + i * 2) * 8; x === s.x1 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke(); }
        ctx.restore();
        break;
      }
      case 'ruincol': {
        const top = s.broken ? -s.h * 0.75 : -s.h;
        P([[s.x - s.w / 2, 900], [s.x - s.w / 2, top + 10], [s.x - s.w * 0.2, top], [s.x + s.w * 0.1, top + 14], [s.x + s.w / 2, top + (s.broken ? 24 : 0)], [s.x + s.w / 2, 900]]); ctx.fill();
        if (!s.broken) ctx.fillRect(s.x - s.w * 0.8, -s.h - 16, s.w * 1.6, 18);
        ctx.fillRect(s.x - s.w * 0.8, -12, s.w * 1.6, 14);
        ctx.fillStyle = rgba('#000000', 0.15); for (let i = -1; i <= 1; i++) ctx.fillRect(s.x + i * s.w * 0.28 - 2, top + 20, 4, -top);
        break;
      }
      case 'facade': {
        const x0 = s.x - s.w / 2;
        ctx.fillRect(x0, -s.h * 0.82, s.w, s.h + 800);
        P([[x0 - 30, -s.h * 0.82], [s.x, -s.h], [x0 + s.w + 30, -s.h * 0.82]]); ctx.fill();
        ctx.fillStyle = mix(col, '#000000', 0.35);
        const cols = 8;
        for (let i = 0; i < cols - 1; i++) { const x = x0 + (i + 1) * (s.w / cols); ctx.fillRect(x - 24, -s.h * 0.7, 48, s.h * 0.7); }
        ctx.save(); ctx.fillStyle = th.accent; glow(th.accent, 20); ctx.globalAlpha = 0.6;
        // glowing glyphs on the pediment and a doorway
        for (let i = -3; i <= 3; i++) ctx.fillRect(s.x + i * 40 - 6, -s.h * 0.86, 12, 12);
        ctx.globalAlpha = 0.35; ctx.fillRect(s.x - 40, -s.h * 0.45, 80, s.h * 0.45);
        ctx.restore();
        break;
      }
      case 'kelp': {
        ctx.strokeStyle = col; ctx.lineWidth = 9; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(s.x, 120);
        for (let y = 100; y > -s.h; y -= 30) ctx.lineTo(s.x + Math.sin(y * 0.02 + s.ph) * 22, y);
        ctx.stroke();
        ctx.fillStyle = col;
        for (let y = 60; y > -s.h + 30; y -= 55) { const x = s.x + Math.sin(y * 0.02 + s.ph) * 22; ctx.beginPath(); ctx.ellipse(x + 16, y, 18, 6, -0.6, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(x - 14, y - 26, 16, 5, 0.6, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      case 'coral': {
        ctx.save(); ctx.translate(s.x, 80); ctx.scale(s.s, s.s);
        ctx.strokeStyle = col; ctx.lineWidth = 14; ctx.lineCap = 'round';
        const br = (x: number, y: number, a: number, l: number, d: number) => { const nx = x + Math.cos(a) * l, ny = y + Math.sin(a) * l; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke(); if (d > 0) { br(nx, ny, a - 0.5, l * 0.7, d - 1); br(nx, ny, a + 0.45, l * 0.72, d - 1); } };
        br(0, 0, -Math.PI / 2, 70, 3);
        ctx.fillStyle = rgba(th.accent, 0.35); ctx.beginPath(); ctx.arc(0, -150, 6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      }
      case 'overpass': {
        ctx.fillRect(s.x1, s.y, s.x2 - s.x1, 40);
        for (let x = s.x1 + 100; x < s.x2; x += 420) { P([[x - 30, 900], [x - 22, s.y + 40], [x + 22, s.y + 40], [x + 30, 900]]); ctx.fill(); }
        ctx.save();
        ctx.fillStyle = rgba('#ffffff', 0.12); ctx.fillRect(s.x1, s.y - 18, s.x2 - s.x1, 4);
        for (let x = s.x1; x < s.x2; x += 18) ctx.fillRect(x, s.y - 18, 2, 18);
        // baked traffic light trails
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgba('#ff3a4a', 0.55); glow('#ff2a3a', 10);
        for (let x = s.x1; x < s.x2; x += 140) ctx.fillRect(x, s.y + 8, 60 + (x % 80), 3);
        ctx.fillStyle = rgba('#fff2d8', 0.5); glow('#ffe8b8', 10);
        for (let x = s.x1 + 50; x < s.x2; x += 170) ctx.fillRect(x, s.y + 22, 80 + (x % 50), 3);
        ctx.restore();
        break;
      }
      case 'billboard': {
        ctx.fillRect(s.x - 6, s.y, 12, 900);
        ctx.fillRect(s.x - s.w / 2 - 8, s.y - s.h - 8, s.w + 16, s.h + 16);
        ctx.save();
        const c1 = s.hue ? th.accent : th.edge;
        const g = ctx.createLinearGradient(s.x - s.w / 2, 0, s.x + s.w / 2, 0); g.addColorStop(0, rgba(c1, 0.55)); g.addColorStop(1, rgba(mix(c1, '#000000', 0.5), 0.5));
        ctx.fillStyle = g; glow(c1, 26); ctx.fillRect(s.x - s.w / 2, s.y - s.h, s.w, s.h);
        noGlow(); ctx.fillStyle = rgba('#ffffff', 0.5);
        ctx.font = `900 ${Math.round(s.h * 0.42)}px Vazirmatn, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(s.hue ? 'NEON' : 'نئون', s.x, s.y - s.h / 2);
        ctx.restore();
        break;
      }
      case 'streetlamp': {
        ctx.fillRect(s.x - 6, -s.h, 12, s.h + 900);
        ctx.fillRect(s.x, -s.h, s.dir * 90, 9);
        ctx.save();
        const lx = s.x + s.dir * 84;
        const g = ctx.createLinearGradient(0, -s.h, 0, 40); g.addColorStop(0, rgba('#ffd8a0', 0.28)); g.addColorStop(1, rgba('#ffd8a0', 0));
        ctx.fillStyle = g; P([[lx - 14, -s.h + 8], [lx + 14, -s.h + 8], [lx + 120, 40], [lx - 120, 40]]); ctx.fill();
        ctx.fillStyle = '#ffe2b0'; glow('#ffb860', 20); ctx.fillRect(lx - 16, -s.h + 6, 32, 6);
        ctx.restore();
        break;
      }
      case 'fuji': {
        P([[s.x - s.w / 2 - 300, 100], [s.x - 90, -s.h], [s.x + 90, -s.h], [s.x + s.w / 2 + 300, 100], [s.x + s.w / 2 + 300, 900], [s.x - s.w / 2 - 300, 900]]); ctx.fill();
        ctx.fillStyle = rgba('#ffe8f0', 0.3);
        P([[s.x - 90, -s.h], [s.x + 90, -s.h], [s.x + 210, -s.h * 0.68], [s.x + 120, -s.h * 0.74], [s.x + 40, -s.h * 0.66], [s.x - 50, -s.h * 0.76], [s.x - 200, -s.h * 0.68]]); ctx.fill();
        break;
      }
      case 'blossom': {
        ctx.save(); ctx.translate(s.x, s.y); ctx.scale(s.s, s.s);
        ctx.strokeStyle = col; ctx.lineWidth = 12; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, 400); ctx.lineTo(0, -60); ctx.quadraticCurveTo(-10, -110, -60, -140); ctx.moveTo(0, -70); ctx.quadraticCurveTo(30, -120, 70, -130); ctx.stroke();
        const pc = mix(th.edge, col, 0.62);
        ctx.fillStyle = rgba(pc, 0.6);
        for (const [x, y, rr] of [[-60, -150, 44], [0, -170, 52], [64, -146, 46], [-22, -120, 40], [34, -110, 38], [-90, -120, 30], [100, -120, 28]]) { ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = rgba(mix(th.edge, '#ffffff', 0.3), 0.16);
        for (const [x, y, rr] of [[-50, -165, 24], [10, -188, 28], [70, -160, 22]]) { ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
        break;
      }
      case 'torii': {
        const x0 = s.x - s.w / 2, c2 = mix('#b02a2a', col, 0.55);
        ctx.fillStyle = c2;
        ctx.fillRect(x0 + s.w * 0.12, -s.h * 0.86, 26, s.h * 0.86 + 900); ctx.fillRect(x0 + s.w * 0.88 - 26, -s.h * 0.86, 26, s.h * 0.86 + 900);
        ctx.beginPath(); ctx.moveTo(x0 - 30, -s.h * 0.9); ctx.quadraticCurveTo(s.x, -s.h * 0.98, x0 + s.w + 30, -s.h * 0.9 - 26); ctx.lineTo(x0 + s.w + 24, -s.h * 0.9 - 2); ctx.quadraticCurveTo(s.x, -s.h * 0.88, x0 - 24, -s.h * 0.86); ctx.closePath(); ctx.fill();
        ctx.fillRect(x0 + s.w * 0.05, -s.h * 0.72, s.w * 0.9, 18);
        ctx.fillRect(s.x - 10, -s.h * 0.86, 20, s.h * 0.14);
        break;
      }
      case 'stonelamp': {
        ctx.fillRect(s.x - 26, -14, 52, 14 + 800); ctx.fillRect(s.x - 8, -80, 16, 70); ctx.fillRect(s.x - 24, -110, 48, 32);
        P([[s.x - 36, -110], [s.x, -140], [s.x + 36, -110]]); ctx.fill();
        ctx.save(); ctx.fillStyle = '#ffcf8a'; glow('#ffa04a', 18); ctx.fillRect(s.x - 10, -102, 20, 16); ctx.restore();
        break;
      }
      case 'branch': {
        ctx.strokeStyle = col; ctx.lineWidth = 16; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.quadraticCurveTo(s.x + s.dir * 250, s.y + 40, s.x + s.dir * 520, s.y + 150); ctx.stroke();
        ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(s.x + s.dir * 260, s.y + 50); ctx.quadraticCurveTo(s.x + s.dir * 330, s.y + 130, s.x + s.dir * 380, s.y + 210); ctx.stroke();
        ctx.fillStyle = rgba(mix(th.edge, col, 0.55), 0.7);
        const rr = seeded(Math.abs(Math.round(s.x)) + 77);
        for (let i = 0; i < 26; i++) { const t = rr(); ctx.beginPath(); ctx.arc(s.x + s.dir * (120 + t * 420) + (rr() - 0.5) * 60, s.y + 30 + t * 130 + (rr() - 0.5) * 60, 12 + rr() * 16, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      case 'nave': {
        // gothic arcade: wall with pointed windows faintly lit by stained glass
        ctx.fillRect(s.x1, -s.h, s.x2 - s.x1, s.h + 800);
        ctx.save();
        for (let x = s.x1 + 40; x < s.x2; x += 220) {
          if (Math.abs(x + 70) < 200) continue;
          const g = ctx.createLinearGradient(0, -s.h * 0.85, 0, -s.h * 0.25);
          g.addColorStop(0, rgba(th.edge, 0.4)); g.addColorStop(0.5, rgba(th.accent, 0.28)); g.addColorStop(1, rgba('#3a5aff', 0.22));
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.moveTo(x, -s.h * 0.25); ctx.lineTo(x, -s.h * 0.7); ctx.quadraticCurveTo(x, -s.h * 0.85, x + 70, -s.h * 0.92); ctx.quadraticCurveTo(x + 140, -s.h * 0.85, x + 140, -s.h * 0.7); ctx.lineTo(x + 140, -s.h * 0.25); ctx.closePath(); ctx.fill();
          ctx.fillStyle = col; ctx.fillRect(x + 66, -s.h * 0.9, 8, s.h * 0.65); ctx.fillRect(x, -s.h * 0.55, 140, 6);
          // light shafts from the windows
          ctx.fillStyle = rgba(th.edge, 0.05); P([[x, -s.h * 0.25], [x + 140, -s.h * 0.25], [x + 260, 60], [x + 80, 60]]); ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'rose': {
        ctx.save();
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 2.2); g.addColorStop(0, rgba(th.edge, 0.3)); g.addColorStop(1, rgba(th.edge, 0));
        ctx.fillStyle = g; ctx.fillRect(s.x - s.r * 2.2, s.y - s.r * 2.2, s.r * 4.4, s.r * 4.4);
        const rg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
        rg.addColorStop(0, rgba('#ffe8b0', 0.75)); rg.addColorStop(0.4, rgba(th.accent, 0.55)); rg.addColorStop(1, rgba(th.edge, 0.5));
        ctx.fillStyle = rg; glow(th.edge, 30); ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
        noGlow(); ctx.strokeStyle = col; ctx.lineWidth = 7;
        for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + Math.cos(a) * s.r, s.y + Math.sin(a) * s.r); ctx.stroke(); }
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 0.45, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 12; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        break;
      }
      case 'gcol': {
        ctx.fillRect(s.x - s.w / 2, -1200, s.w, 2200);
        ctx.fillStyle = rgba('#000000', 0.25); ctx.fillRect(s.x - s.w / 2 + 10, -1200, 8, 2200); ctx.fillRect(s.x + s.w / 2 - 18, -1200, 8, 2200);
        ctx.fillStyle = col; ctx.fillRect(s.x - s.w / 2 - 14, -40, s.w + 28, 40);
        ctx.fillStyle = mix('#5a1020', col, 0.4);
        P([[s.x - s.w / 2 - 6, -560], [s.x + s.w / 2 + 6, -560], [s.x + s.w / 2 + 6, -300], [s.x, -340], [s.x - s.w / 2 - 6, -300]]); ctx.fill();
        break;
      }
      case 'chandelier': {
        ctx.strokeStyle = col; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(s.x, -1200); ctx.lineTo(s.x, s.y); ctx.stroke();
        ctx.lineWidth = 6; ctx.beginPath(); ctx.ellipse(s.x, s.y + 30, 90, 18, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.save(); ctx.fillStyle = '#ffd8a0'; glow('#ffa040', 14);
        for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; ctx.fillRect(s.x + Math.cos(a) * 90 - 3, s.y + 30 + Math.sin(a) * 18 - 16, 6, 12); }
        ctx.restore();
        break;
      }
      case 'station': {
        ctx.save(); ctx.translate(s.x, s.y); ctx.scale(s.s, s.s);
        ctx.fillRect(-260, -20, 520, 40);
        ctx.beginPath(); ctx.arc(0, 0, 90, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 18; ctx.beginPath(); ctx.ellipse(0, 0, 220, 70, 0, 0, Math.PI * 2); ctx.stroke();
        for (const k of [-1, 1]) { ctx.fillStyle = mix('#2a4aa0', col, 0.5); ctx.fillRect(k * 280 - (k < 0 ? 160 : 0), -70, 160, 140); ctx.strokeStyle = rgba('#9ab8ff', 0.25); ctx.lineWidth = 2; for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.moveTo(k * 280 - (k < 0 ? 160 : 0) + i * 27, -70); ctx.lineTo(k * 280 - (k < 0 ? 160 : 0) + i * 27, 70); ctx.stroke(); } }
        ctx.fillStyle = th.accent; glow(th.accent, 14);
        for (let i = -3; i <= 3; i++) ctx.fillRect(i * 22 - 3, -4, 6, 6);
        ctx.fillStyle = '#ff4a4a'; glow('#ff4a4a', 12); ctx.fillRect(-262, -26, 6, 6); ctx.fillRect(256, -26, 6, 6);
        ctx.restore();
        break;
      }
      case 'satellite': {
        ctx.save(); ctx.translate(s.x, s.y); ctx.scale(s.s, s.s); ctx.rotate(-0.4);
        ctx.fillRect(-40, -30, 80, 60);
        ctx.fillStyle = mix('#2a4aa0', col, 0.4); ctx.fillRect(-200, -22, 150, 44); ctx.fillRect(50, -22, 150, 44);
        ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, -60, 34, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
        ctx.restore();
        break;
      }
      case 'truss': {
        ctx.fillRect(s.x1, s.y, s.x2 - s.x1, 12); ctx.fillRect(s.x1, s.y + 70, s.x2 - s.x1, 12);
        ctx.strokeStyle = col; ctx.lineWidth = 6;
        ctx.beginPath(); for (let x = s.x1; x < s.x2; x += 70) { ctx.moveTo(x, s.y + 6); ctx.lineTo(x + 35, s.y + 76); ctx.lineTo(x + 70, s.y + 6); ctx.moveTo(x, s.y); ctx.lineTo(x, s.y + 82); } ctx.stroke();
        ctx.fillStyle = rgba(th.edge, 0.2); ctx.fillRect(s.x1, s.y, s.x2 - s.x1, 3);
        ctx.save(); ctx.fillStyle = th.accent; glow(th.accent, 10);
        for (let x = s.x1 + 100; x < s.x2; x += 420) ctx.fillRect(x, s.y + 32, 6, 6);
        ctx.restore();
        break;
      }
      case 'panel': {
        ctx.fillRect(s.x - 8, s.y, 16, 200);
        ctx.save(); ctx.fillStyle = mix('#1a3a90', col, 0.4);
        ctx.fillRect(s.x - 220, s.y - 70, 440, 140);
        ctx.strokeStyle = rgba('#9ab8ff', 0.25); ctx.lineWidth = 3;
        for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(s.x - 220 + i * 55, s.y - 70); ctx.lineTo(s.x - 220 + i * 55, s.y + 70); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(s.x - 220, s.y); ctx.lineTo(s.x + 220, s.y); ctx.stroke();
        ctx.fillStyle = rgba('#ffffff', 0.08); P([[s.x - 220, s.y - 70], [s.x - 60, s.y - 70], [s.x - 160, s.y + 70], [s.x - 220, s.y + 70]]); ctx.fill();
        ctx.restore();
        break;
      }
      case 'ziggurat': {
        const sh = s.h / s.steps;
        for (let i = 0; i < s.steps; i++) { const w = s.w * (1 - i / (s.steps + 1)); ctx.fillRect(s.x - w / 2, -sh * (i + 1), w, sh + 1); }
        ctx.fillRect(s.x - 36, -s.h - 60, 72, 60);
        ctx.fillRect(s.x - s.w / 2, 0, s.w, 800);
        ctx.fillStyle = mix(col, '#000000', 0.25); ctx.fillRect(s.x - 30, -s.h, 60, s.h);
        ctx.save(); ctx.fillStyle = th.accent; glow(th.accent, 18); ctx.globalAlpha = 0.6; ctx.fillRect(s.x - 12, -s.h - 44, 24, 30); ctx.restore();
        break;
      }
      case 'canopy': {
        ctx.save(); ctx.translate(s.x, s.y); ctx.scale(s.s, s.s);
        ctx.fillRect(-8, 0, 16, 800);
        for (const [x, y, rr] of [[0, -40, 70], [-60, 0, 54], [60, -6, 58], [-24, 30, 48], [30, 28, 50]]) { ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = rgba(th.edge, 0.07); ctx.beginPath(); ctx.arc(-10, -70, 46, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      }
      case 'vine': {
        ctx.strokeStyle = col; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(s.x, s.y);
        for (let y = s.y; y < s.y + s.len; y += 30) ctx.lineTo(s.x + Math.sin(y * 0.015 + s.ph) * 16, y);
        ctx.stroke();
        ctx.fillStyle = col;
        for (let y = s.y + 40; y < s.y + s.len; y += 45) { const x = s.x + Math.sin(y * 0.015 + s.ph) * 16; ctx.beginPath(); ctx.ellipse(x + ((y / 45) % 2 < 1 ? 12 : -12), y, 14, 7, (y / 45) % 2 < 1 ? 0.6 : -0.6, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      case 'fern': {
        ctx.save(); ctx.translate(s.x, s.y); ctx.scale(s.s, s.s);
        for (let i = -3; i <= 3; i++) {
          const a = -Math.PI / 2 + i * 0.32;
          ctx.beginPath(); ctx.moveTo(0, 0);
          const ex = Math.cos(a) * 200, ey = Math.sin(a) * 200;
          ctx.quadraticCurveTo(ex * 0.5 - 20 * Math.sign(i || 1), ey * 0.6, ex, ey + 40);
          ctx.quadraticCurveTo(ex * 0.5 + 20 * Math.sign(i || 1), ey * 0.5, 0, 0);
          ctx.fill();
        }
        ctx.restore();
        break;
      }
      case 'stormcloud': {
        const puffs = [[0, 0, 60], [60, -30, 70], [130, -10, 64], [70, 20, 60], [190, 10, 46], [-60, 14, 46]];
        ctx.fillStyle = rgba(mix(col, '#000000', 0.5), 0.85);
        for (const [dx, dy, rr] of puffs) { ctx.beginPath(); ctx.arc(s.x + dx * s.s, s.y + (dy + 14) * s.s, rr * s.s, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = rgba(col, 0.6);
        for (const [dx, dy, rr] of puffs) { ctx.beginPath(); ctx.arc(s.x + dx * s.s, s.y + dy * s.s, rr * s.s * 0.8, 0, Math.PI * 2); ctx.fill(); }
        ctx.save(); const g = ctx.createRadialGradient(s.x + 60 * s.s, s.y, 0, s.x + 60 * s.s, s.y, 120 * s.s);
        g.addColorStop(0, rgba(th.accent, 0.12)); g.addColorStop(1, rgba(th.accent, 0)); ctx.fillStyle = g; ctx.fillRect(s.x - 120 * s.s, s.y - 140 * s.s, 360 * s.s, 280 * s.s); ctx.restore();
        break;
      }
      case 'waves': {
        ctx.beginPath(); ctx.moveTo(-2000, 900);
        for (let x = -2000; x <= 2000; x += 40) ctx.lineTo(x, s.y - Math.abs(Math.sin(x * 0.004 * s.n * 0.25)) * s.amp - Math.sin(x * 0.013) * s.amp * 0.3);
        ctx.lineTo(2000, 900); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = rgba('#d8eeff', 0.3); ctx.lineWidth = 4;
        ctx.beginPath(); for (let x = -2000; x <= 2000; x += 40) { const y = s.y - Math.abs(Math.sin(x * 0.004 * s.n * 0.25)) * s.amp - Math.sin(x * 0.013) * s.amp * 0.3; x === -2000 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke();
        break;
      }
      case 'ship': {
        ctx.save(); ctx.translate(s.x, s.y); ctx.scale(s.s, s.s); ctx.rotate(-0.06);
        P([[-200, -40], [220, -40], [170, 30], [-160, 30]]); ctx.fill();
        ctx.fillRect(-10, -360, 10, 320); ctx.fillRect(-140, -260, 8, 220);
        ctx.fillStyle = rgba(mix(col, '#ffffff', 0.1), 0.9);
        P([[0, -350], [120, -300], [110, -80], [0, -60]]); ctx.fill(); P([[-132, -250], [-50, -210], [-56, -70], [-132, -60]]); ctx.fill();
        ctx.fillStyle = '#ffcf7a'; glow('#ffa040', 16); ctx.fillRect(180, -50, 8, 8);
        ctx.restore();
        break;
      }
      case 'lighthouse': {
        P([[s.x - 26, s.y], [s.x - 16, s.y - 170], [s.x + 16, s.y - 170], [s.x + 26, s.y]]); ctx.fill();
        ctx.fillRect(s.x - 22, s.y - 196, 44, 28);
        ctx.save();
        const g = ctx.createLinearGradient(s.x, 0, s.x - 900, 0); g.addColorStop(0, rgba('#fff2c8', 0.3)); g.addColorStop(1, rgba('#fff2c8', 0));
        ctx.fillStyle = g; ctx.globalAlpha = 0.5; P([[s.x, s.y - 186], [s.x - 900, s.y - 300], [s.x - 900, s.y - 140]]); ctx.fill();
        ctx.fillStyle = '#fff2c8'; glow('#ffd890', 24); ctx.fillRect(s.x - 10, s.y - 192, 20, 16);
        ctx.restore();
        break;
      }
      case 'rigging': {
        // masts at the screen edges with shrouds running outward (keeps the playfield clear)
        ctx.strokeStyle = col; ctx.lineWidth = 4;
        ctx.beginPath();
        for (const [mx, k] of [[s.x1, -1], [s.x2, 1]]) { for (let i = 0; i < 6; i++) { ctx.moveTo(mx, -1000 + i * 70); ctx.lineTo(mx + k * (260 + i * 70), 260); } ctx.moveTo(mx - 120, -760); ctx.lineTo(mx + 120, -760); }
        ctx.stroke();
        ctx.fillStyle = col;
        for (const mx of [s.x1, s.x2]) { ctx.fillRect(mx - 18, -1200, 36, 1800); ctx.fillRect(mx - 130, -770, 260, 18); }
        ctx.save(); ctx.fillStyle = '#ffcf7a'; glow('#ff9a3a', 22);
        ctx.fillRect(s.x1 + 24, -330, 14, 20); ctx.fillRect(s.x2 - 38, -360, 14, 20); ctx.restore();
        break;
      }
      case 'cavewall': {
        // ceiling stalactites + floor stalagmites silhouettes
        ctx.beginPath(); ctx.moveTo(-2000, -1200);
        for (let x = -2000; x <= 2000; x += 60) ctx.lineTo(x, -620 + ((x / 60) % 3 === 0 ? 120 : 0) + Math.sin(x * 0.01) * 60);
        ctx.lineTo(2000, -1200); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-2000, 900);
        for (let x = -2000; x <= 2000; x += 50) ctx.lineTo(x, -80 - ((Math.abs(x) / 50) % 4 === 1 ? 150 : 30) - Math.sin(x * 0.007) * 50);
        ctx.lineTo(2000, 900); ctx.closePath(); ctx.fill();
        break;
      }
      case 'crystals': {
        ctx.save(); ctx.translate(s.x, s.y); ctx.scale(s.s, s.s);
        const rr = seeded(s.seed + 1);
        const cc = [th.edge, th.accent, mix(th.edge, th.accent, 0.5)];
        ctx.globalAlpha = near ? 0.6 : 0.85;
        const g = ctx.createRadialGradient(0, -60, 0, 0, -60, 200); g.addColorStop(0, rgba(cc[s.seed % 3], 0.12)); g.addColorStop(1, rgba(cc[s.seed % 3], 0));
        ctx.fillStyle = g; ctx.fillRect(-200, -260, 400, 400);
        for (let i = 0; i < s.n; i++) {
          const a = (rr() - 0.5) * 1.1, h = 70 + rr() * 140, w = 18 + rr() * 22, x = (rr() - 0.5) * 120;
          ctx.save(); ctx.translate(x, 20); ctx.rotate(a);
          const c3 = cc[i % 3];
          const cg = ctx.createLinearGradient(-w, 0, w, 0); cg.addColorStop(0, rgba(mix(c3, '#000000', 0.6), 0.6)); cg.addColorStop(0.5, rgba(mix(c3, col, 0.35), 0.45)); cg.addColorStop(1, rgba(mix(c3, '#ffffff', 0.3), 0.55));
          ctx.fillStyle = cg; glow(c3, 10);
          P([[-w / 2, 0], [-w / 2, -h], [0, -h - w], [w / 2, -h], [w / 2, 0]]); ctx.fill();
          noGlow(); ctx.fillStyle = rgba('#ffffff', 0.14); P([[0, -h - w], [w / 2, -h], [w / 2, 0], [w * 0.1, 0]]); ctx.fill();
          ctx.restore();
        }
        ctx.restore();
        break;
      }
      case 'stalactite': {
        P([[s.x - s.w / 2, s.y], [s.x + s.w / 2, s.y], [s.x + s.w * 0.1, s.y + s.len], [s.x - s.w * 0.05, s.y + s.len + 20]]); ctx.fill();
        ctx.fillStyle = rgba(th.accent, 0.12); P([[s.x + s.w * 0.25, s.y], [s.x + s.w / 2, s.y], [s.x + s.w * 0.1, s.y + s.len]]); ctx.fill();
        break;
      }
      case 'clockface': {
        ctx.save();
        const g = ctx.createRadialGradient(s.x, s.y, s.r * 0.2, s.x, s.y, s.r * 1.5); g.addColorStop(0, rgba('#ffd890', 0.3)); g.addColorStop(1, rgba('#ffb040', 0));
        ctx.fillStyle = g; ctx.fillRect(s.x - s.r * 1.5, s.y - s.r * 1.5, s.r * 3, s.r * 3);
        const fg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
        fg.addColorStop(0, rgba('#fff0c8', 0.5)); fg.addColorStop(1, rgba('#d89a4a', 0.35));
        ctx.fillStyle = fg; glow('#ffc060', 30); ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
        noGlow(); ctx.strokeStyle = col; ctx.lineWidth = 22; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 0.78, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = col;
        for (let i = 0; i < 12; i++) { ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(i * Math.PI / 6); ctx.fillRect(-6, -s.r * 0.95, 12, i % 3 === 0 ? 60 : 34); ctx.restore(); }
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(-0.9); ctx.fillRect(-8, -s.r * 0.55, 16, s.r * 0.6); ctx.rotate(2.6); ctx.fillRect(-5, -s.r * 0.8, 10, s.r * 0.85); ctx.restore();
        ctx.beginPath(); ctx.arc(s.x, s.y, 20, 0, Math.PI * 2); ctx.fill();
        // window mullions behind the face
        ctx.fillRect(s.x - 4, s.y - s.r, 8, s.r * 2); ctx.fillRect(s.x - s.r, s.y - 4, s.r * 2, 8);
        ctx.restore();
        break;
      }
      case 'gear': {
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.rot);
        ctx.beginPath();
        const t = s.teeth;
        for (let i = 0; i < t * 2; i++) { const a = (i / (t * 2)) * Math.PI * 2, rr = i % 2 ? s.r : s.r * 1.16; ctx.lineTo(Math.cos(a - 0.08) * rr, Math.sin(a - 0.08) * rr); ctx.lineTo(Math.cos(a + 0.08) * rr, Math.sin(a + 0.08) * rr); }
        ctx.closePath(); ctx.fill();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath(); ctx.arc(0, 0, s.r * 0.72, 0, Math.PI * 2); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        for (let i = 0; i < 4; i++) { ctx.save(); ctx.rotate(i * Math.PI / 2); ctx.fillRect(-s.r * 0.08, 0, s.r * 0.16, s.r * 0.75); ctx.restore(); }
        ctx.beginPath(); ctx.arc(0, 0, s.r * 0.22, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = rgba(th.edge, 0.18); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, s.r * 1.02, -2.4, -0.9); ctx.stroke();
        ctx.restore();
        break;
      }
      case 'beam': {
        ctx.fillRect(s.x1, s.y - 30, s.x2 - s.x1, 50);
        ctx.fillStyle = rgba(th.edge, 0.12); ctx.fillRect(s.x1, s.y - 30, s.x2 - s.x1, 4);
        ctx.fillStyle = mix(col, '#000000', 0.3); for (let x = s.x1; x < s.x2; x += 60) { ctx.beginPath(); ctx.arc(x, s.y - 5, 5, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      case 'pendulum': {
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(0.12);
        ctx.fillRect(-5, 0, 10, s.len);
        ctx.beginPath(); ctx.arc(0, s.len + 40, 54, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rgba(th.edge, 0.25); ctx.beginPath(); ctx.arc(-14, s.len + 26, 22, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      }
      case 'gridfloor': {
        ctx.save();
        const c2 = th.accent;
        ctx.fillStyle = rgba('#000000', 0.35); ctx.fillRect(-2400, 0, 4800, 900);
        ctx.strokeStyle = rgba(c2, 0.5); ctx.lineWidth = 2; glow(c2, 10);
        ctx.beginPath();
        for (let i = -24; i <= 24; i++) { ctx.moveTo(i * 30, 0); ctx.lineTo(i * 220, 600); }
        for (let k = 0; k < 9; k++) { const y = Math.pow(k / 8, 2) * 600 + 4; ctx.moveTo(-2400, y); ctx.lineTo(2400, y); }
        ctx.stroke();
        ctx.restore();
        break;
      }
      case 'cabinet': {
        const w = s.near ? 120 : 70, h = s.h;
        P([[s.x - w / 2, 900], [s.x - w / 2, -h], [s.x - w / 2 + w * 0.15, -h - 12], [s.x + w / 2, -h - 12], [s.x + w / 2, 900]]); ctx.fill();
        ctx.save();
        const c2 = [th.edge, th.accent, '#ffcf3a'][s.hue];
        ctx.fillStyle = rgba(c2, s.near ? 0.26 : 0.5); glow(c2, s.near ? 8 : 16);
        ctx.fillRect(s.x - w * 0.36, -h + h * 0.18, w * 0.72, h * 0.26);
        ctx.fillRect(s.x - w * 0.4, -h - 8, w * 0.8, h * 0.08);
        noGlow(); ctx.fillStyle = rgba('#000000', 0.3);
        for (let y = -h + h * 0.18; y < -h + h * 0.44; y += 6) ctx.fillRect(s.x - w * 0.36, y, w * 0.72, 2);
        ctx.fillStyle = rgba(c2, 0.4); ctx.fillRect(s.x - w * 0.42, -h + h * 0.5, w * 0.84, h * 0.06);
        ctx.restore();
        break;
      }
      case 'neonsign': {
        ctx.save();
        const c2 = [th.edge, th.accent, '#ffcf3a'][s.hue];
        ctx.font = `900 ${s.text.length > 4 ? 64 : 88}px Vazirmatn, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const tw = ctx.measureText(s.text).width;
        ctx.fillStyle = col; ctx.fillRect(s.x - tw / 2 - 30, s.y - 60, tw + 60, 120);
        ctx.strokeStyle = rgba(c2, 0.6); ctx.lineWidth = 3; glow(c2, 16); ctx.strokeRect(s.x - tw / 2 - 22, s.y - 52, tw + 44, 104);
        ctx.lineWidth = 3; ctx.strokeStyle = c2; glow(c2, 24); ctx.strokeText(s.text, s.x, s.y + 4);
        ctx.fillStyle = rgba(mix(c2, '#ffffff', 0.6), 0.85); ctx.fillText(s.text, s.x, s.y + 4);
        ctx.restore();
        ctx.fillStyle = col; ctx.fillRect(s.x - tw / 2, -1400, 4, 1400 + s.y - 60); ctx.fillRect(s.x + tw / 2, -1400, 4, 1400 + s.y - 60);
        break;
      }
      case 'terrace': {
        ctx.fillRect(s.x1, -s.h, s.x2 - s.x1, s.h + 800);
        ctx.fillStyle = rgba('#000000', 0.18); for (let x = s.x1; x < s.x2; x += 80) ctx.fillRect(x, -s.h, 2, s.h);
        ctx.fillStyle = rgba(th.edge, 0.2); ctx.fillRect(s.x1, -s.h, s.x2 - s.x1, 4);
        // grand double staircase hint
        ctx.fillStyle = mix(col, '#000000', 0.2); for (let i = 0; i < 6; i++) ctx.fillRect(220 + i * 18, -s.h + i * 10, 200 - i * 36, 4);
        break;
      }
      case 'gate': {
        const x0 = s.x - s.w / 2;
        ctx.fillRect(x0, -s.h, 70, s.h + 800); ctx.fillRect(x0 + s.w - 70, -s.h, 70, s.h + 800);
        ctx.fillRect(x0 - 10, -s.h - 24, s.w + 20, 26);
        // lamassu silhouettes on the pylons
        ctx.fillStyle = mix(col, '#000000', 0.25);
        for (const k of [0, 1]) { const px = x0 + k * (s.w - 70); ctx.fillRect(px + 8, -s.h * 0.62, 54, s.h * 0.45); ctx.beginPath(); ctx.arc(px + 35, -s.h * 0.66, 20, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(px + 20, -s.h * 0.78, 30, 14); }
        ctx.fillStyle = rgba(th.edge, 0.24); ctx.fillRect(x0 + s.w - 8, -s.h, 8, s.h); ctx.fillRect(x0 + 62, -s.h, 8, s.h);
        break;
      }
      case 'column': {
        const top = -s.h;
        ctx.fillRect(s.x - s.w / 2, top, s.w, s.h + 900);
        ctx.fillStyle = rgba('#000000', 0.18); for (let i = -1; i <= 1; i++) ctx.fillRect(s.x + i * s.w * 0.28 - 1.5, top + 10, 3, s.h);
        ctx.fillStyle = col;
        ctx.fillRect(s.x - s.w * 0.9, -14, s.w * 1.8, 14);
        if (s.cap) {
          // double-bull (protome) capital
          ctx.fillRect(s.x - s.w * 0.75, top - 16, s.w * 1.5, 18);
          ctx.beginPath(); ctx.ellipse(s.x - s.w * 1.1, top - 30, s.w * 1.05, s.w * 0.5, 0, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.ellipse(s.x + s.w * 1.1, top - 30, s.w * 1.05, s.w * 0.5, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillRect(s.x - s.w * 2.1, top - 30, s.w * 0.4, s.w * 0.9); ctx.fillRect(s.x + s.w * 1.7, top - 30, s.w * 0.4, s.w * 0.9);
          ctx.fillRect(s.x - s.w * 2.4, top - 56, s.w * 4.8, 10);
        } else {
          ctx.beginPath(); ctx.moveTo(s.x - s.w / 2, top); ctx.lineTo(s.x - s.w * 0.1, top - 22); ctx.lineTo(s.x + s.w * 0.2, top - 6); ctx.lineTo(s.x + s.w / 2, top - 16); ctx.lineTo(s.x + s.w / 2, top); ctx.fill();
        }
        ctx.fillStyle = rgba(th.edge, 0.22); ctx.fillRect(s.x + s.w / 2 - 4, top, 4, s.h);
        break;
      }
      case 'relief': {
        ctx.fillRect(s.x1, s.y - s.h, s.x2 - s.x1, s.h + 800);
        ctx.fillStyle = rgba(th.edge, 0.18); ctx.fillRect(s.x1, s.y - s.h, s.x2 - s.x1, 5);
        ctx.fillStyle = mix(col, '#000000', 0.3);
        // procession of carved figures
        for (let x = s.x1 + 30; x < s.x2 - 30; x += 46) { ctx.fillRect(x, s.y - s.h + 30, 14, 60); ctx.beginPath(); ctx.arc(x + 7, s.y - s.h + 24, 8, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(x + 12, s.y - s.h + 38, 12, 4); }
        ctx.fillStyle = col; ctx.fillRect(s.x1, s.y - s.h + 100, s.x2 - s.x1, 4);
        break;
      }
    }
  }

  /** The island is pre-rendered (material, texture, glow, underside) into a sprite at 2x world scale. */
  private stageSprite(stage: StageDef) {
    const key = `stage:${stage.id}`;
    let img = this.layerCache.get(key);
    const m = stage.main;
    const S = 2, pad = 30;
    const x0 = m.x1 - pad, y0 = m.y - pad, w = m.x2 - m.x1 + pad * 2, h = m.depth * 2.3 + pad * 2;
    if (!img) {
      img = this.offscreen(w * S, h * S);
      const ctx = img.getContext('2d')!;
      ctx.scale(S, S); ctx.translate(-x0, -y0);
      const th = stage.theme;
      const mat = th.material ?? 'stone';
      const tech = mat === 'metal' || mat === 'neon' || mat === 'asphalt' || mat === 'brass' || mat === 'concrete' || mat === 'wood';
      const cx = (m.x1 + m.x2) / 2, W = m.x2 - m.x1, D = m.depth;
      const haze = th.haze ?? th.sky[1];
      const r = seeded(stage.id.charCodeAt(0) * 13 + stage.id.length);
      // island outline (computed once so fill, clip and stroke share the exact same jagged shape)
      const pts: [number, number][] = [[m.x1, m.y], [m.x2, m.y]];
      if (tech) {
        pts.push([m.x2 - 10, m.y + D * 0.45], [m.x2 - W * 0.12, m.y + D * 0.62], [m.x2 - W * 0.22, m.y + D * 1.25], [cx + W * 0.1, m.y + D * 1.55],
          [cx - W * 0.1, m.y + D * 1.55], [m.x1 + W * 0.22, m.y + D * 1.25], [m.x1 + W * 0.12, m.y + D * 0.62], [m.x1 + 10, m.y + D * 0.45]);
      } else {
        pts.push([m.x2 - 14, m.y + D * 0.5]);
        const n = 9;
        for (let i = 1; i < n; i++) {
          const t = i / n, x = m.x2 - 14 - (W - 28) * t;
          const depthAt = D * (0.6 + 1.6 * Math.sin(Math.PI * t) ** 1.4);
          pts.push([x + (r() - 0.5) * 30, m.y + depthAt + (r() - 0.5) * D * 0.25]);
        }
        pts.push([m.x1 + 14, m.y + D * 0.5]);
      }
      const body = () => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const [x, y] of pts) ctx.lineTo(x, y); ctx.closePath(); };
      ctx.lineJoin = 'round';
      // body: vertical material gradient
      body();
      const bg = ctx.createLinearGradient(0, m.y, 0, m.y + D * 2.3);
      bg.addColorStop(0, mix(th.ground, '#ffffff', 0.08)); bg.addColorStop(0.35, th.ground); bg.addColorStop(1, mix(th.ground, '#000000', 0.6));
      ctx.fillStyle = bg; ctx.fill();
      ctx.save(); body(); ctx.clip();
      this.stageTexture(ctx, mat, m, th, r);
      // underside bounce light from the atmosphere + ambient occlusion beneath the top slab
      const ug = ctx.createLinearGradient(0, m.y + D * 0.8, 0, m.y + D * 2.3);
      ug.addColorStop(0, rgba(haze, 0)); ug.addColorStop(1, rgba(haze, 0.25));
      ctx.fillStyle = ug; ctx.fillRect(m.x1, m.y + D * 0.8, W, D * 1.6);
      const ao = ctx.createLinearGradient(0, m.y + 14, 0, m.y + 44);
      ao.addColorStop(0, 'rgba(0,0,0,0.45)'); ao.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = ao; ctx.fillRect(m.x1, m.y + 14, W, 30);
      // side vignette for roundness
      const sv = ctx.createLinearGradient(m.x1, 0, m.x2, 0);
      sv.addColorStop(0, 'rgba(0,0,0,0.35)'); sv.addColorStop(0.15, 'rgba(0,0,0,0)'); sv.addColorStop(0.85, 'rgba(0,0,0,0)'); sv.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = sv; ctx.fillRect(m.x1, m.y, W, D * 2.3);
      ctx.restore();
      body(); ctx.strokeStyle = INK; ctx.lineWidth = 5; ctx.stroke();
      // hanging details below the island
      this.stageUnderside(ctx, mat, m, th, r, tech);
      // top slab
      const sg = ctx.createLinearGradient(0, m.y, 0, m.y + 16);
      sg.addColorStop(0, mix(th.ground, '#ffffff', 0.32)); sg.addColorStop(1, mix(th.ground, '#ffffff', 0.12));
      ctx.fillStyle = sg; ctx.fillRect(m.x1, m.y, W, 16);
      this.slabTexture(ctx, mat, m.x1, m.y, W, 16, th);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(m.x1, m.y + 15, W, 2);
      ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.strokeRect(m.x1, m.y, W, 16);
      // glowing top edge + crisp highlight
      ctx.save();
      ctx.shadowColor = th.edge; ctx.shadowBlur = 18;
      ctx.strokeStyle = th.edge; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(m.x1, m.y + 1); ctx.lineTo(m.x2, m.y + 1); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = rgba('#ffffff', 0.55); ctx.fillRect(m.x1 + 6, m.y + 0.5, W - 12, 1.2);
      // ledge caps
      for (const [x, k] of [[m.x1, 1], [m.x2, -1]] as const) {
        ctx.fillStyle = mix(th.ground, '#000000', 0.2); ctx.strokeStyle = INK; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.rect(k > 0 ? x : x - 12, m.y - 2, 12, 22); ctx.fill(); ctx.stroke();
        ctx.fillStyle = rgba(th.accent, 0.8); ctx.fillRect(k > 0 ? x + 3 : x - 9, m.y + 6, 6, 3);
      }
      this.layerCache.set(key, img);
    }
    return { img, x0, y0, w, h };
  }

  /** Material pattern on the island body (inside clip). */
  private stageTexture(ctx: CanvasRenderingContext2D, mat: string, m: StageDef['main'], th: StageDef['theme'], r: () => number) {
    const W = m.x2 - m.x1, D = m.depth, y1 = m.y + 16, y2 = m.y + D * 2.3;
    const dark = 'rgba(0,0,0,0.22)', light = rgba('#ffffff', 0.06);
    ctx.lineWidth = 2;
    switch (mat) {
      case 'stone': case 'moss': case 'marble': case 'sand': {
        const bh = mat === 'marble' || mat === 'sand' ? 34 : 24;
        for (let y = y1, row = 0; y < y2; y += bh, row++) {
          ctx.fillStyle = dark; ctx.fillRect(m.x1, y, W, 2);
          const bw = mat === 'marble' ? 110 : 60;
          for (let x = m.x1 + (row % 2) * bw / 2; x < m.x2; x += bw) { ctx.fillRect(x, y, 2, bh); ctx.fillStyle = light; ctx.fillRect(x + 2, y + 2, bw - 4, 2); ctx.fillStyle = dark; }
        }
        if (mat === 'marble') { ctx.strokeStyle = rgba('#ffffff', 0.08); for (let i = 0; i < 10; i++) { ctx.beginPath(); let x = m.x1 + r() * W, y = y1; ctx.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 60; y += 20 + r() * 20; ctx.lineTo(x, y); } ctx.stroke(); } }
        if (mat === 'moss') { ctx.fillStyle = rgba(th.edge, 0.12); for (let i = 0; i < 16; i++) { ctx.beginPath(); ctx.arc(m.x1 + r() * W, y1 + r() * D * 0.5, 5 + r() * 10, 0, Math.PI * 2); ctx.fill(); } }
        if (mat === 'sand') { ctx.fillStyle = rgba(th.edge, 0.1); ctx.fillRect(m.x1, y1 + 10, W, 8); }
        break;
      }
      case 'rock': case 'basalt': {
        ctx.strokeStyle = dark; ctx.lineWidth = 3;
        for (let y = y1 + 14; y < y2; y += 22 + r() * 16) { ctx.beginPath(); ctx.moveTo(m.x1, y); for (let x = m.x1; x <= m.x2; x += 60) ctx.lineTo(x, y + (r() - 0.5) * 10); ctx.stroke(); }
        if (mat === 'basalt') {
          ctx.save(); ctx.strokeStyle = '#ff7a2a'; ctx.lineWidth = 2; ctx.shadowColor = '#ff4a0a'; ctx.shadowBlur = 8; ctx.globalAlpha = 0.55;
          for (let i = 0; i < 9; i++) { let x = m.x1 + 30 + r() * (W - 60), y = y1 + r() * 20; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 40; y += 12 + r() * 16; ctx.lineTo(x, y); } ctx.stroke(); }
          ctx.restore();
        } else { ctx.fillStyle = rgba(th.edge, 0.08); ctx.fillRect(m.x1, y1 + 20, W, 10); ctx.fillRect(m.x1, y1 + 70, W, 6); }
        break;
      }
      case 'wood': {
        for (let y = y1; y < y2; y += 18) { ctx.fillStyle = dark; ctx.fillRect(m.x1, y, W, 2); ctx.fillStyle = light; for (let i = 0; i < 6; i++) ctx.fillRect(m.x1 + r() * W, y + 6 + r() * 8, 30 + r() * 60, 1); }
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; for (let x = m.x1 + 60; x < m.x2; x += 140) ctx.fillRect(x, y1, 10, D * 2);
        ctx.fillStyle = rgba(th.edge, 0.25); for (let x = m.x1 + 65; x < m.x2; x += 140) for (let y = y1 + 20; y < y2; y += 50) ctx.fillRect(x, y, 3, 3);
        break;
      }
      case 'tile': {
        // turquoise girih / kashi band + brick body
        ctx.fillStyle = rgba(th.edge, 0.22); ctx.fillRect(m.x1, y1 + 6, W, 30);
        ctx.strokeStyle = rgba('#ffffff', 0.25); ctx.lineWidth = 1.5;
        for (let x = m.x1; x < m.x2; x += 30) { ctx.beginPath(); ctx.moveTo(x, y1 + 21); ctx.lineTo(x + 15, y1 + 8); ctx.lineTo(x + 30, y1 + 21); ctx.lineTo(x + 15, y1 + 34); ctx.closePath(); ctx.stroke(); }
        ctx.fillStyle = rgba(th.accent, 0.35); for (let x = m.x1 + 15; x < m.x2; x += 30) ctx.fillRect(x - 2, y1 + 19, 4, 4);
        for (let y = y1 + 44, row = 0; y < y2; y += 16, row++) { ctx.fillStyle = dark; ctx.fillRect(m.x1, y, W, 2); for (let x = m.x1 + (row % 2) * 20; x < m.x2; x += 40) ctx.fillRect(x, y, 2, 16); }
        break;
      }
      case 'metal': case 'brass': case 'concrete': case 'asphalt': case 'neon': {
        const pw = mat === 'concrete' ? 120 : 90;
        for (let x = m.x1; x < m.x2; x += pw) { ctx.fillStyle = dark; ctx.fillRect(x, y1, 2, D * 2); ctx.fillStyle = light; ctx.fillRect(x + 2, y1, 2, D * 2); }
        for (let y = y1 + 34; y < y2; y += 40) { ctx.fillStyle = dark; ctx.fillRect(m.x1, y, W, 2); }
        if (mat === 'metal' || mat === 'brass') { ctx.fillStyle = mat === 'brass' ? rgba('#ffe0a0', 0.3) : rgba('#ffffff', 0.18); for (let x = m.x1 + 10; x < m.x2; x += pw) for (let y = y1 + 10; y < y2; y += 40) { ctx.fillRect(x, y, 3, 3); ctx.fillRect(x + pw - 18, y, 3, 3); } }
        if (mat === 'brass') { ctx.strokeStyle = rgba('#ffe0a0', 0.18); ctx.lineWidth = 4; for (let x = m.x1 + 90; x < m.x2; x += 220) { ctx.beginPath(); ctx.arc(x, y1 + 60, 26, 0, Math.PI * 2); ctx.stroke(); } }
        if (mat === 'metal' || mat === 'concrete') {
          ctx.fillStyle = rgba('#ffcf3a', 0.35);
          for (let x = m.x1; x < m.x2; x += 24) { ctx.beginPath(); ctx.moveTo(x, y1 + 2); ctx.lineTo(x + 12, y1 + 2); ctx.lineTo(x + 4, y1 + 12); ctx.lineTo(x - 8, y1 + 12); ctx.closePath(); ctx.fill(); }
        }
        if (mat === 'neon' || mat === 'asphalt') {
          ctx.save(); ctx.strokeStyle = mat === 'neon' ? th.edge : th.accent; ctx.globalAlpha = 0.45; ctx.shadowColor = ctx.strokeStyle as string; ctx.shadowBlur = 10; ctx.lineWidth = 2;
          ctx.beginPath(); for (let x = m.x1; x < m.x2; x += 40) { ctx.moveTo(x, y1); ctx.lineTo(x, y1 + D * 0.5); } ctx.moveTo(m.x1, y1 + 30); ctx.lineTo(m.x2, y1 + 30); ctx.stroke();
          ctx.restore();
        }
        ctx.save(); ctx.fillStyle = th.accent; ctx.shadowColor = th.accent; ctx.shadowBlur = 12;
        for (let x = m.x1 + 40; x < m.x2 - 20; x += 120) ctx.fillRect(x, y1 + D * 0.32, 18, 4);
        ctx.restore();
        break;
      }
      case 'ice': {
        ctx.fillStyle = rgba('#dff8ff', 0.1); for (let i = 0; i < 8; i++) { const x = m.x1 + r() * W; ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x + 50 + r() * 60, y1); ctx.lineTo(x + 10, y2); ctx.closePath(); ctx.fill(); }
        ctx.strokeStyle = rgba('#ffffff', 0.25); ctx.lineWidth = 1.5;
        for (let i = 0; i < 12; i++) { let x = m.x1 + r() * W, y = y1 + r() * D; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (r() - 0.5) * 50; y += 10 + r() * 20; ctx.lineTo(x, y); } ctx.stroke(); }
        break;
      }
      case 'crystal': {
        for (let i = 0; i < 14; i++) {
          const x = m.x1 + r() * W, y = y1 + r() * D * 1.2, s = 20 + r() * 40, c = i % 2 ? th.edge : th.accent;
          ctx.fillStyle = rgba(c, 0.18); ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.5, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s * 0.5, y); ctx.closePath(); ctx.fill();
        }
        ctx.strokeStyle = dark; ctx.lineWidth = 2; for (let y = y1 + 20; y < y2; y += 30) { ctx.beginPath(); ctx.moveTo(m.x1, y); for (let x = m.x1; x <= m.x2; x += 50) ctx.lineTo(x, y + (r() - 0.5) * 14); ctx.stroke(); }
        break;
      }
    }
  }

  /** Decorative things hanging under the island (icicles, vines, crystals, lights, roots). */
  private stageUnderside(ctx: CanvasRenderingContext2D, mat: string, m: StageDef['main'], th: StageDef['theme'], r: () => number, tech: boolean) {
    const W = m.x2 - m.x1, D = m.depth;
    ctx.save();
    if (mat === 'ice') {
      ctx.fillStyle = rgba('#dff8ff', 0.75); ctx.strokeStyle = INK; ctx.lineWidth = 2;
      for (let i = 0; i < 14; i++) { const x = m.x1 + 30 + (W - 60) * (i / 13), t = (x - m.x1) / W, base = m.y + D * (0.55 + 1.3 * Math.sin(Math.PI * t) ** 1.4) - 10, l = 20 + r() * 40; ctx.beginPath(); ctx.moveTo(x - 7, base); ctx.lineTo(x + 7, base); ctx.lineTo(x, base + l); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    } else if (mat === 'moss') {
      ctx.strokeStyle = mix(th.edge, '#000000', 0.6); ctx.lineWidth = 3;
      for (let i = 0; i < 18; i++) { const x = m.x1 + 20 + r() * (W - 40), t = (x - m.x1) / W, base = m.y + D * (0.5 + 1.2 * Math.sin(Math.PI * t) ** 1.4), l = 30 + r() * 70; ctx.beginPath(); ctx.moveTo(x, base - 10); ctx.quadraticCurveTo(x + 10, base + l * 0.5, x - 4, base + l); ctx.stroke(); ctx.fillStyle = rgba(th.edge, 0.5); ctx.beginPath(); ctx.arc(x - 4, base + l, 3, 0, Math.PI * 2); ctx.fill(); }
    } else if (mat === 'crystal') {
      for (let i = 0; i < 9; i++) {
        const x = m.x1 + 50 + r() * (W - 100), t = (x - m.x1) / W, base = m.y + D * (0.5 + 1.3 * Math.sin(Math.PI * t) ** 1.4) - 16, l = 30 + r() * 50, c = i % 2 ? th.edge : th.accent;
        ctx.fillStyle = c; ctx.shadowColor = c; ctx.shadowBlur = 16; ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.moveTo(x - 9, base); ctx.lineTo(x + 9, base); ctx.lineTo(x + 3, base + l); ctx.lineTo(x - 2, base + l + 8); ctx.closePath(); ctx.fill();
      }
    } else if (mat === 'basalt') {
      ctx.fillStyle = '#ff8a2a'; ctx.shadowColor = '#ff4a0a'; ctx.shadowBlur = 14;
      for (let i = 0; i < 6; i++) { const x = m.x1 + 60 + r() * (W - 120), t = (x - m.x1) / W, base = m.y + D * (0.55 + 1.3 * Math.sin(Math.PI * t) ** 1.4) - 8; ctx.beginPath(); ctx.ellipse(x, base + 8, 3, 7, 0, 0, Math.PI * 2); ctx.fill(); }
    } else if (tech) {
      // keel lights / thrusters
      const cx = (m.x1 + m.x2) / 2;
      ctx.fillStyle = th.accent; ctx.shadowColor = th.accent; ctx.shadowBlur = 18;
      for (const k of [-1, 1]) ctx.fillRect(cx + k * W * 0.16 - 10, m.y + D * 1.3, 20, 5);
      ctx.fillRect(cx - 24, m.y + D * 1.55 - 6, 48, 4);
      ctx.shadowBlur = 0; ctx.globalAlpha = 0.25;
      const tg = ctx.createLinearGradient(0, m.y + D * 1.55, 0, m.y + D * 2.25);
      tg.addColorStop(0, th.accent); tg.addColorStop(1, rgba(th.accent, 0));
      ctx.fillStyle = tg; ctx.beginPath(); ctx.moveTo(cx - 24, m.y + D * 1.55); ctx.lineTo(cx + 24, m.y + D * 1.55); ctx.lineTo(cx + 8, m.y + D * 2.25); ctx.lineTo(cx - 8, m.y + D * 2.25); ctx.closePath(); ctx.fill();
    } else {
      // rocky roots and dangling stones
      ctx.strokeStyle = mix(th.ground, '#000000', 0.5); ctx.lineWidth = 3;
      for (let i = 0; i < 10; i++) { const x = m.x1 + 40 + r() * (W - 80), t = (x - m.x1) / W, base = m.y + D * (0.6 + 1.3 * Math.sin(Math.PI * t) ** 1.4) - 16, l = 16 + r() * 34; ctx.beginPath(); ctx.moveTo(x, base); ctx.quadraticCurveTo(x - 8, base + l * 0.6, x + 4, base + l); ctx.stroke(); }
      ctx.fillStyle = rgba(th.edge, 0.5); ctx.shadowColor = th.edge; ctx.shadowBlur = 12;
      for (let i = 0; i < 5; i++) { const x = m.x1 + 80 + r() * (W - 160), t = (x - m.x1) / W; ctx.fillRect(x, m.y + D * (0.4 + 1.0 * Math.sin(Math.PI * t) ** 1.4), 4, 4); }
    }
    ctx.restore();
  }

  /** Detail on the walkable top slab (main stage and platforms). */
  private slabTexture(ctx: CanvasRenderingContext2D, mat: string, x: number, y: number, w: number, h: number, th: StageDef['theme']) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    const seam = 'rgba(0,0,0,0.28)';
    switch (mat) {
      case 'wood': ctx.fillStyle = seam; for (let i = x + 28; i < x + w; i += 28) ctx.fillRect(i, y, 1.5, h); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x, y + h * 0.5, w, 1); break;
      case 'tile': ctx.fillStyle = rgba(th.edge, 0.35); for (let i = x; i < x + w; i += 20) ctx.fillRect(i + 2, y + 4, 16, h - 8); ctx.fillStyle = seam; for (let i = x; i < x + w; i += 20) ctx.fillRect(i, y, 2, h); break;
      case 'asphalt': ctx.fillStyle = rgba('#ffe080', 0.55); for (let i = x + 10; i < x + w; i += 60) ctx.fillRect(i, y + h / 2 - 1, 30, 2.5); break;
      case 'neon': ctx.fillStyle = rgba(th.accent, 0.5); ctx.fillRect(x, y + h - 5, w, 2); ctx.fillStyle = seam; for (let i = x; i < x + w; i += 24) ctx.fillRect(i, y, 2, h); break;
      case 'metal': case 'brass': case 'concrete': ctx.fillStyle = seam; for (let i = x; i < x + w; i += 40) ctx.fillRect(i, y, 2, h); ctx.fillStyle = 'rgba(255,255,255,0.15)'; for (let i = x + 6; i < x + w; i += 40) ctx.fillRect(i, y + h / 2 - 1, 2, 2); break;
      case 'ice': case 'crystal': ctx.fillStyle = 'rgba(255,255,255,0.18)'; for (let i = x; i < x + w; i += 46) { ctx.beginPath(); ctx.moveTo(i, y + h); ctx.lineTo(i + 16, y); ctx.lineTo(i + 26, y); ctx.lineTo(i + 10, y + h); ctx.fill(); } break;
      case 'moss': ctx.fillStyle = rgba(th.edge, 0.35); for (let i = x; i < x + w; i += 14) ctx.fillRect(i, y, 8 + ((i * 7) % 6), 3 + ((i * 3) % 4)); break;
      default: ctx.fillStyle = seam; for (let i = x + 30; i < x + w; i += 52) ctx.fillRect(i, y, 2, h);
    }
    ctx.restore();
  }

  private platformSprite(stage: StageDef, width: number) {
    const key = `plat:${stage.id}:${Math.round(width)}`;
    let img = this.layerCache.get(key);
    const S = 2, pad = 16, h = 12;
    if (!img) {
      img = this.offscreen((width + pad * 2) * S, (h + pad * 2 + 8) * S);
      const ctx = img.getContext('2d')!;
      ctx.scale(S, S); ctx.translate(pad, pad);
      const th = stage.theme;
      const mat = th.material ?? 'stone';
      // soft under-glow
      const R = width * 0.45;
      ctx.save(); ctx.translate(width / 2, h + 5); ctx.scale(1, 0.16);
      const ug = ctx.createRadialGradient(0, 0, 2, 0, 0, R);
      ug.addColorStop(0, rgba(th.accent, 0.32)); ug.addColorStop(1, rgba(th.accent, 0));
      ctx.fillStyle = ug; ctx.fillRect(-R, -R, R * 2, R * 2); ctx.restore();
      const path = () => { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(width, 0); ctx.lineTo(width - 10, h); ctx.lineTo(10, h); ctx.closePath(); };
      path();
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, mix(th.ground, '#ffffff', 0.3)); g.addColorStop(0.45, mix(th.ground, '#ffffff', 0.12)); g.addColorStop(1, mix(th.ground, '#000000', 0.35));
      ctx.fillStyle = g; ctx.fill();
      this.slabTexture(ctx, mat, 0, 0, width, h, th);
      path(); ctx.strokeStyle = INK; ctx.lineWidth = 3.5; ctx.lineJoin = 'round'; ctx.stroke();
      // underside accent lights
      ctx.save(); ctx.fillStyle = th.accent; ctx.shadowColor = th.accent; ctx.shadowBlur = 10; ctx.globalAlpha = 0.85;
      ctx.fillRect(14, h - 3, 6, 2); ctx.fillRect(width - 20, h - 3, 6, 2);
      ctx.restore();
      ctx.save();
      ctx.shadowColor = th.accent; ctx.shadowBlur = 14; ctx.strokeStyle = th.accent; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(3, 1); ctx.lineTo(width - 3, 1); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = rgba('#ffffff', 0.6); ctx.fillRect(6, 0.4, width - 12, 1);
      this.layerCache.set(key, img);
    }
    return { img, pad, h };
  }

  private drawStage(stage: StageDef, frame: number, time: number) {
    const { ctx } = this;
    const sp = this.stageSprite(stage);
    ctx.drawImage(sp.img, sp.x0, sp.y0, sp.w, sp.h);
    const m = stage.main;
    ctx.fillStyle = stage.theme.accent;
    const r = 5 + Math.sin(time * 5) * 1.2;
    for (const x of [m.x1, m.x2]) { ctx.beginPath(); ctx.arc(x, m.y + 2, r, 0, Math.PI * 2); ctx.fill(); }
    for (const p of stage.platforms) {
      const pp = platformPos(p, frame);
      const ps = this.platformSprite(stage, pp.x2 - pp.x1);
      ctx.drawImage(ps.img, pp.x1 - ps.pad, pp.y - ps.pad, pp.x2 - pp.x1 + ps.pad * 2, ps.h + ps.pad * 2 + 8);
    }
  }

  /** Round fighter portraits for HUD / off-screen bubbles, cached per fighter+skin. */
  private portraitImg(charId: string, skin: number, color: string) {
    const key = `face:${charId}:${skin}:${color}`;
    let img = this.layerCache.get(key);
    if (!img) {
      const S = 128;
      img = this.offscreen(S, S);
      const c = img.getContext('2d')!;
      c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
      c.fillStyle = shade(color, -0.5); c.fill(); c.clip();
      previewFighter(c, charId, skin, S / 2, S * 0.98, 1.15, 0);
      this.layerCache.set(key, img);
    }
    return img;
  }

  // ---- HUD -----------------------------------------------------------------------------------------
  private drawOffscreen(state: GameState) {
    const { ctx } = this;
    const bottom = this.h - this.hudHeight() - 8;
    for (const f of state.fighters) {
      if (f.action === 'dead' || f.stocks <= 0) continue;
      const sx = (f.x - this.cam.x) * this.cam.z + this.w / 2;
      const sy = (f.y - 40 - this.cam.y) * this.cam.z + this.h / 2;
      const r = 22, m = r + 8;
      if (sx >= -10 && sx <= this.w + 10 && sy >= -10 && sy <= bottom) continue;
      const cx = Math.max(m, Math.min(this.w - m, sx));
      const cy = Math.max(m + 40, Math.min(bottom - r, sy));
      ctx.drawImage(this.portraitImg(f.charId, displaySkin(state, f.slot), PLAYER_COLORS[f.slot]), cx - r, cy - r, r * 2, r * 2);
      ctx.strokeStyle = PLAYER_COLORS[f.slot]; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      const a = Math.atan2(sy - cy, sx - cx);
      ctx.save(); ctx.fillStyle = PLAYER_COLORS[f.slot]; ctx.translate(cx + Math.cos(a) * (r + 6), cy + Math.sin(a) * (r + 6)); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-4, -6); ctx.lineTo(-4, 6); ctx.closePath(); ctx.fill(); ctx.restore();
    }
  }

  private drawHud(state: GameState, opts: { localSlots: number[]; time: number; training?: boolean; ping?: number }) {
    const { ctx } = this;
    const n = state.fighters.length;
    const gap = 6;
    const H = this.hudHeight() - 8;
    const cardW = Math.min(220, (this.w - 12 - gap * (n - 1)) / n);
    const total = n * cardW + (n - 1) * gap;
    let x0 = (this.w - total) / 2;
    const y0 = this.h - H - 6;
    const pr = Math.min(H * 0.42, cardW * 0.24);           // portrait radius
    const big = Math.round(Math.min(H * 0.48, cardW * 0.22)); // damage font size
    const showName = cardW > 96;
    for (const f of state.fighters) {
      const x = x0; x0 += cardW + gap;
      const col = PLAYER_COLORS[f.slot];
      ctx.save();
      ctx.globalAlpha = f.stocks <= 0 ? 0.4 : 1;
      ctx.fillStyle = 'rgba(20,11,36,0.78)';
      ctx.strokeStyle = col; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.roundRect(x, y0, cardW, H, 12); ctx.fill(); ctx.stroke();
      const pcx = x + 6 + pr, pcy = y0 + H / 2;
      ctx.drawImage(this.portraitImg(f.charId, displaySkin(state, f.slot), col), pcx - pr, pcy - pr, pr * 2, pr * 2);
      const tx = pcx + pr + 5;
      // damage %
      const d = f.damage;
      const heat = Math.min(1, d / 150);
      const ds = this.dmgShake[f.slot] ?? 0;
      this.dmgShake[f.slot] = ds * 0.85;
      const jx = ds > 0.5 ? rnd(-ds, ds) * 0.4 : 0, jy = ds > 0.5 ? rnd(-ds, ds) * 0.4 : 0;
      ctx.font = `900 ${big}px Vazirmatn, system-ui, sans-serif`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.lineWidth = 5; ctx.strokeStyle = INK;
      const txt = f.stocks <= 0 ? '—' : `${Math.floor(d)}%`;
      const ty = y0 + H * (showName ? 0.62 : 0.72);
      ctx.strokeText(txt, tx + jx, ty + jy);
      ctx.fillStyle = `rgb(255,${Math.round(255 - heat * 200)},${Math.round(255 - heat * 230)})`;
      ctx.fillText(txt, tx + jx, ty + jy);
      if (showName) {
        ctx.font = '700 10px Vazirmatn, system-ui, sans-serif';
        ctx.fillStyle = '#fff';
        const p = state.cfg.players[f.slot];
        let name = (p?.name ?? '').slice(0, 10);
        if (p?.bot) name += ` · ${t('bot')}`;
        if (this.trialSlots.has(f.slot)) name += ` · ${t('trial')}`;
        ctx.fillText(name, tx, y0 + H - 6);
      }
      // magic meter
      const mods = state.cfg.players[f.slot]?.mods;
      const sp = getSpell(mods?.spell);
      if (sp && f.stocks > 0) {
        const bx = tx, bw = Math.max(20, x + cardW - 10 - tx), by = y0 + H - (showName ? 17 : 8), full = f.mana >= 100;
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx, by, bw, 4);
        ctx.fillStyle = sp.color; ctx.globalAlpha = full ? 0.75 + 0.25 * Math.sin(opts.time * 10) : 0.85;
        ctx.fillRect(bx, by, bw * Math.min(1, f.mana / 100), 4);
        ctx.globalAlpha = f.stocks <= 0 ? 0.4 : 1;
      }
      if (!opts.training) {
        const sr = Math.max(3, Math.min(4.5, H * 0.07));
        for (let i = 0; i < Math.min(f.stocks, 5); i++) {
          ctx.fillStyle = col; ctx.strokeStyle = INK; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(tx + sr + i * (sr * 2 + 3), y0 + sr + 5, sr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
      ctx.restore();
    }
    // timer
    if (state.timer > 0 || state.cfg.timeLimit > 0) {
      const sec = Math.ceil((state.timer || 0) / TICK_RATE);
      const s = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      ctx.save(); ctx.font = '900 24px Vazirmatn, system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 5; ctx.strokeStyle = INK; ctx.strokeText(s, this.w / 2, 34);
      ctx.fillStyle = sec <= 10 ? '#ff4f6d' : '#fff'; ctx.fillText(s, this.w / 2, 34); ctx.restore();
    }
    if (opts.ping !== undefined) {
      ctx.save(); ctx.font = '600 11px system-ui'; ctx.fillStyle = opts.ping < 90 ? '#3ee089' : opts.ping < 160 ? '#ffd23f' : '#ff4f6d';
      ctx.textAlign = 'center'; ctx.fillText(`${Math.round(opts.ping)} ms`, this.w / 2, 50); ctx.restore();
    }
    if (state.frame < COUNTDOWN + 40) {
      const left = COUNTDOWN - state.frame;
      const label = left > 0 ? String(Math.ceil(left / 60)) : t('go');
      const k = left > 0 ? (left % 60) / 60 : 1 - (state.frame - COUNTDOWN) / 40;
      this.banner(label, 1 + (left > 0 ? k * 0.5 : 0), left > 0 ? 1 : Math.max(0, k));
    }
    if (state.over) this.banner(state.timer === 0 && state.cfg.timeLimit > 0 ? t('timeUp') : t('game'), 1.1, 1);
  }

  private banner(text: string, scale: number, alpha: number) {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(this.w / 2, (this.h - this.hudHeight()) * 0.45);
    ctx.scale(scale, scale);
    const size = Math.round(Math.min(96, this.w * 0.18));
    ctx.font = `900 ${size}px Vazirmatn, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(8, size * 0.14); ctx.strokeStyle = INK; ctx.strokeText(text, 0, 0);
    const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2); g.addColorStop(0, '#fff6c2'); g.addColorStop(1, '#ff4fd8');
    ctx.fillStyle = g; ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}
