import { COUNTDOWN, getFighter, getStage, platformPos, TICK_RATE, type GameEvent, type GameState, type StageDef } from '@nb/shared';
import { drawFighter, drawProjectile, INK, PLAYER_COLORS, previewFighter, shade, star } from './art.ts';
import { t } from '../i18n.ts';

interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; max: number;
  color: string; size: number; kind: 'spark' | 'dust' | 'ring' | 'star' | 'beam' | 'text' | 'smoke'; rot?: number; text?: string; g?: number;
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

export class Renderer {
  ctx: CanvasRenderingContext2D;
  w = 0; h = 0; dpr = 1;
  cam = { x: 0, y: -150, z: 1 };
  private particles: Particle[] = [];
  private shake = 0;
  private flashes: number[] = [0, 0, 0, 0];
  private dmgShake: number[] = [0, 0, 0, 0];
  private flashScreen = 0;
  private bgCache = new Map<string, { layers: { depth: number; shapes: any[] }[] }>();
  /** visual offsets used to smooth network corrections */
  offsets: { x: number; y: number }[] = [];
  trialSlots = new Set<number>();
  hitstop = 0;

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = this.canvas.clientWidth; this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  reset() { this.particles = []; this.shake = 0; this.cam = { x: 0, y: -150, z: 1 }; }

  // ---- events → effects --------------------------------------------------------------
  onEvents(state: GameState, events: GameEvent[], sfx: (e: GameEvent) => void) {
    for (const e of events) {
      sfx(e);
      switch (e.t) {
        case 'hit': {
          const n = Math.min(26, 6 + Math.floor(e.kb / 8));
          const color = PLAYER_COLORS[e.attacker] ?? '#fff';
          for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, s = rnd(3, 6 + e.kb / 15);
            this.particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: rnd(12, 24), color: i % 3 ? '#fff6c2' : color, size: rnd(2, 4), kind: 'spark' });
          }
          this.particles.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0, max: 14, color, size: 10 + e.kb / 4, kind: 'ring' });
          if (e.kb > 90) this.particles.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0, max: 18, color: '#fff', size: 22, kind: 'star', rot: Math.random() });
          this.flashes[e.victim] = 1;
          this.dmgShake[e.victim] = Math.min(14, 4 + e.dmg);
          this.shake = Math.max(this.shake, Math.min(16, e.kb / 12));
          break;
        }
        case 'shieldhit':
          for (let i = 0; i < 8; i++) { const a = Math.random() * Math.PI * 2; this.particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * 4, vy: Math.sin(a) * 4, life: 0, max: 12, color: '#bdf6ff', size: 2.5, kind: 'spark' }); }
          break;
        case 'ko': {
          const f = state.fighters[e.slot];
          const color = PLAYER_COLORS[e.slot];
          const ang = Math.atan2(-150 - e.y, -e.x);
          this.particles.push({ x: e.x, y: e.y, vx: Math.cos(ang), vy: Math.sin(ang), life: 0, max: 40, color, size: 140, kind: 'beam' });
          for (let i = 0; i < 40; i++) {
            const a = ang + rnd(-0.8, 0.8), s = rnd(6, 22);
            this.particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: rnd(25, 45), color: i % 2 ? color : '#fff', size: rnd(3, 7), kind: 'spark' });
          }
          this.shake = 22; this.flashScreen = 0.5;
          void f;
          break;
        }
        case 'jump': this.dust(e.x, e.y, 5); break;
        case 'land': this.dust(e.x, e.y, 4); break;
        case 'explode': {
          this.particles.push({ x: e.x, y: e.y, vx: 0, vy: 0, life: 0, max: 18, color: '#ffb02e', size: e.r, kind: 'ring' });
          for (let i = 0; i < 18; i++) { const a = Math.random() * Math.PI * 2, s = rnd(2, 7); this.particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, life: 0, max: rnd(20, 34), color: i % 2 ? '#ff6a2b' : '#ffd23f', size: rnd(5, 11), kind: 'smoke' }); }
          this.shake = Math.max(this.shake, 8);
          break;
        }
        case 'shieldbreak': {
          const f = state.fighters[e.slot];
          for (let i = 0; i < 16; i++) { const a = Math.random() * Math.PI * 2; this.particles.push({ x: f.x, y: f.y - 40, vx: Math.cos(a) * 7, vy: Math.sin(a) * 7, life: 0, max: 30, color: '#bdf6ff', size: 4, kind: 'spark' }); }
          this.shake = 10;
          break;
        }
        case 'counter': {
          const f = state.fighters[e.slot];
          this.particles.push({ x: f.x, y: f.y - 40, vx: 0, vy: -0.6, life: 0, max: 40, color: '#ffd23f', size: 22, kind: 'text', text: 'COUNTER!' });
          this.particles.push({ x: f.x, y: f.y - 40, vx: 0, vy: 0, life: 0, max: 16, color: '#ffd23f', size: 50, kind: 'ring' });
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
    for (let i = 0; i < n; i++) this.particles.push({ x: x + rnd(-10, 10), y: y - 2, vx: rnd(-2, 2), vy: rnd(-1.5, -0.3), life: 0, max: rnd(14, 22), color: 'rgba(255,255,255,0.6)', size: rnd(4, 8), kind: 'dust' });
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
    // keep part of the stage in view
    minX = Math.min(minX, stage.main.x1 * 0.5); maxX = Math.max(maxX, stage.main.x2 * 0.5);
    maxY = Math.max(maxY, stage.main.y + 40);
    const padX = 260, padY = 190;
    const bw = maxX - minX + padX * 2, bh = maxY - minY + padY * 2;
    const base = Math.min(this.w / 1280, this.h / 720);
    let z = Math.min(this.w / bw, this.h / bh);
    z = Math.max(0.42 * base * 1.6, Math.min(1.25 * base * 1.6, z));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const k = instant ? 1 : 0.08;
    this.cam.x += (cx - this.cam.x) * k;
    this.cam.y += (cy - this.cam.y) * k;
    this.cam.z += (z - this.cam.z) * k;
  }

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

    this.drawParticles();
    ctx.restore();

    this.drawOffscreen(state);
    if (this.flashScreen > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${this.flashScreen})`; ctx.fillRect(0, 0, this.w, this.h); this.flashScreen *= 0.85;
    }
    this.drawHud(state, opts);
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
    ctx.shadowColor = PLAYER_COLORS[slot]; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.ellipse(x, y + 4, 42, 9, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  private drawParticles() {
    const { ctx } = this;
    const keep: Particle[] = [];
    for (const p of this.particles) {
      p.life++;
      if (p.life > p.max) continue;
      keep.push(p);
      const k = 1 - p.life / p.max;
      p.x += p.vx; p.y += p.vy;
      if (p.kind === 'spark') { p.vx *= 0.9; p.vy *= 0.9; }
      if (p.kind === 'smoke' || p.kind === 'dust') { p.vx *= 0.94; p.vy *= 0.94; }
      ctx.save();
      ctx.globalAlpha = Math.max(0, k);
      switch (p.kind) {
        case 'spark':
          ctx.strokeStyle = p.color; ctx.lineWidth = p.size; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 2.2, p.y - p.vy * 2.2); ctx.stroke();
          break;
        case 'dust': case 'smoke':
          ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.4 - k * 0.6), 0, Math.PI * 2); ctx.fill();
          break;
        case 'ring':
          ctx.strokeStyle = p.color; ctx.lineWidth = 5 * k + 1;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.6 - k), 0, Math.PI * 2); ctx.stroke();
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
  private bgLayers(stage: StageDef) {
    let c = this.bgCache.get(stage.id);
    if (c) return c;
    const r = seeded(stage.id.length * 7919 + stage.id.charCodeAt(0));
    const layers: { depth: number; shapes: any[] }[] = [];
    const th = stage.theme;
    if (th.props === 'city') {
      for (const depth of [0.15, 0.3, 0.5]) {
        const shapes = [];
        for (let x = -1600; x < 1600; x += 60 + r() * 90) {
          const hh = 120 + r() * 300 * (1 - depth * 0.7);
          const wins: [number, number][] = [];
          for (let i = 0; i < 10; i++) if (r() < 0.6) wins.push([r(), r()]);
          shapes.push({ type: 'tower', x, w: 50 + r() * 80, h: hh, wins, sign: r() < 0.2 });
        }
        layers.push({ depth, shapes });
      }
    } else if (th.props === 'moon') {
      layers.push({ depth: 0.05, shapes: [{ type: 'moon', x: 300, y: -560, r: 170 }] });
      for (const depth of [0.2, 0.4]) {
        const pts = []; for (let x = -1800; x <= 1800; x += 120) pts.push([x, -80 - r() * 260 * (1 - depth)]);
        layers.push({ depth, shapes: [{ type: 'hills', pts }] });
      }
      layers.push({ depth: 0.45, shapes: Array.from({ length: 5 }, (_, i) => ({ type: 'pagoda', x: -900 + i * 450 + r() * 100, h: 160 + r() * 120 })) });
    } else if (th.props === 'lanterns') {
      layers.push({ depth: 0.1, shapes: [{ type: 'sun', x: -200, y: -300, r: 260 }] });
      for (const depth of [0.25, 0.45]) {
        const shapes = []; for (let x = -1600; x < 1600; x += 140 + r() * 120) shapes.push({ type: 'dome', x, w: 90 + r() * 110, h: 120 + r() * 240 * (1 - depth) });
        layers.push({ depth, shapes });
      }
      layers.push({ depth: 0.6, shapes: Array.from({ length: 22 }, () => ({ type: 'lantern', x: -1400 + r() * 2800, y: -700 + r() * 600, s: 0.6 + r() * 0.8, ph: r() * 6 })) });
    } else if (th.props === 'pipes') {
      layers.push({ depth: 0.1, shapes: [{ type: 'core', x: 0, y: -380, r: 200 }] });
      for (const depth of [0.3, 0.5]) {
        const shapes = []; for (let x = -1600; x < 1600; x += 120 + r() * 200) shapes.push({ type: 'pipe', x, w: 30 + r() * 50, h: 300 + r() * 500 });
        layers.push({ depth, shapes });
      }
    } else {
      layers.push({ depth: 0.08, shapes: Array.from({ length: 10 }, () => ({ type: 'cloud', x: -1600 + r() * 3200, y: -800 + r() * 700, s: 1 + r() * 1.6 })) });
      layers.push({ depth: 0.35, shapes: Array.from({ length: 7 }, () => ({ type: 'pillar', x: -1300 + r() * 2600, y: -100 + r() * 300, h: 150 + r() * 260 })) });
      layers.push({ depth: 0.55, shapes: Array.from({ length: 8 }, () => ({ type: 'cloud', x: -1600 + r() * 3200, y: -300 + r() * 600, s: 0.8 + r() })) });
    }
    c = { layers };
    this.bgCache.set(stage.id, c);
    return c;
  }

  private drawBackground(stage: StageDef, time: number) {
    const { ctx } = this;
    const th = stage.theme;
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, th.sky[0]); g.addColorStop(1, th.sky[1]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, this.w, this.h);
    // stars for dark skies
    if (th.props !== 'clouds') {
      const r = seeded(42);
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 70; i++) {
        const x = r() * this.w, y = r() * this.h * 0.6;
        ctx.globalAlpha = 0.3 + 0.5 * Math.abs(Math.sin(time * 1.5 + i));
        ctx.fillRect(x, y, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
    const L = this.bgLayers(stage);
    const base = Math.min(this.w / 1280, this.h / 720) * 1.6;
    for (const layer of L.layers) {
      ctx.save();
      const z = base * (0.55 + layer.depth * 0.5);
      ctx.translate(this.w / 2 - this.cam.x * layer.depth * z, this.h * 0.78 - (this.cam.y + 150) * layer.depth * z);
      ctx.scale(z, z);
      const col = th.props === 'clouds' ? shade(th.sky[0], -0.1 - layer.depth * 0.3) : shade(th.sky[0], 0.04 + layer.depth * 0.22);
      for (const s of layer.shapes) this.drawBgShape(s, col, th, time, layer.depth);
      ctx.restore();
    }
  }

  private drawBgShape(s: any, col: string, th: StageDef['theme'], time: number, depth: number) {
    const { ctx } = this;
    ctx.fillStyle = col;
    switch (s.type) {
      case 'tower': {
        ctx.fillRect(s.x, -s.h, s.w, s.h + 900);
        ctx.fillStyle = depth > 0.4 ? th.accent : shade(th.accent, -0.3);
        ctx.globalAlpha = 0.55;
        for (const [wx, wy] of s.wins) ctx.fillRect(s.x + 6 + wx * (s.w - 18), -s.h + 10 + wy * (s.h - 20), 8, 10);
        ctx.globalAlpha = 1;
        if (s.sign) { ctx.save(); ctx.fillStyle = th.edge; ctx.shadowColor = th.edge; ctx.shadowBlur = 20; ctx.fillRect(s.x + 8, -s.h + 20, s.w - 16, 14); ctx.restore(); }
        break;
      }
      case 'moon': {
        ctx.save(); ctx.fillStyle = '#f6f1e0'; ctx.shadowColor = '#f6f1e0'; ctx.shadowBlur = 80;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        break;
      }
      case 'sun': {
        ctx.save(); const g = ctx.createRadialGradient(s.x, s.y, 10, s.x, s.y, s.r); g.addColorStop(0, '#fff3b0'); g.addColorStop(0.5, '#ffb35c'); g.addColorStop(1, 'rgba(255,120,40,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        break;
      }
      case 'hills': {
        ctx.beginPath(); ctx.moveTo(-1800, 600);
        for (const [x, y] of s.pts) ctx.lineTo(x, y);
        ctx.lineTo(1800, 600); ctx.closePath(); ctx.fill();
        break;
      }
      case 'pagoda': {
        for (let i = 0; i < 3; i++) {
          const y = -s.h + i * 50, w = 60 + i * 25;
          ctx.beginPath(); ctx.moveTo(s.x - w, y + 20); ctx.lineTo(s.x, y - 10); ctx.lineTo(s.x + w, y + 20); ctx.closePath(); ctx.fill();
          ctx.fillRect(s.x - w * 0.6, y + 18, w * 1.2, 32);
        }
        ctx.fillRect(s.x - 50, -s.h + 150, 100, 600);
        ctx.save(); ctx.fillStyle = th.edge; ctx.globalAlpha = 0.6; ctx.fillRect(s.x - 8, -s.h + 70, 16, 16); ctx.restore();
        break;
      }
      case 'dome': {
        ctx.beginPath(); ctx.ellipse(s.x + s.w / 2, -s.h, s.w / 2, s.w * 0.45, 0, Math.PI, 0); ctx.fill();
        ctx.fillRect(s.x, -s.h, s.w, s.h + 800);
        ctx.fillRect(s.x + s.w / 2 - 3, -s.h - s.w * 0.45 - 30, 6, 30);
        break;
      }
      case 'lantern': {
        const y = s.y + Math.sin(time + s.ph) * 12;
        ctx.save(); ctx.fillStyle = '#ffb02e'; ctx.shadowColor = '#ff8a00'; ctx.shadowBlur = 25;
        ctx.beginPath(); ctx.ellipse(s.x, y, 14 * s.s, 18 * s.s, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        break;
      }
      case 'core': {
        ctx.save(); ctx.strokeStyle = th.accent; ctx.lineWidth = 14; ctx.shadowColor = th.accent; ctx.shadowBlur = 40;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r * (0.95 + Math.sin(time * 3) * 0.05), 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = th.edge; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 0.7, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        break;
      }
      case 'pipe': {
        ctx.fillRect(s.x, -s.h, s.w, s.h + 800);
        ctx.fillRect(s.x - 8, -s.h + 40, s.w + 16, 16);
        ctx.save(); ctx.fillStyle = th.edge; ctx.globalAlpha = 0.5 + 0.5 * Math.sin(time * 4 + s.x); ctx.fillRect(s.x + s.w / 2 - 3, -s.h + 80, 6, 30); ctx.restore();
        break;
      }
      case 'cloud': {
        ctx.save(); ctx.fillStyle = 'rgba(255,255,255,0.85)';
        for (const [dx, dy, rr] of [[0, 0, 40], [35, -15, 45], [75, 0, 38], [38, 12, 40]]) { ctx.beginPath(); ctx.arc(s.x + dx * s.s, s.y + dy * s.s, rr * s.s, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
        break;
      }
      case 'pillar': {
        ctx.fillRect(s.x, s.y - s.h, 50, s.h);
        ctx.fillRect(s.x - 10, s.y - s.h - 14, 70, 16);
        break;
      }
    }
  }

  private drawStage(stage: StageDef, frame: number, time: number) {
    const { ctx } = this;
    const th = stage.theme;
    const m = stage.main;
    // island body
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.fillStyle = th.ground;
    ctx.strokeStyle = INK; ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(m.x1, m.y);
    ctx.lineTo(m.x2, m.y);
    ctx.lineTo(m.x2 - 20, m.y + m.depth * 0.6);
    ctx.quadraticCurveTo((m.x1 + m.x2) / 2 + 60, m.y + m.depth * 2.2, (m.x1 + m.x2) / 2, m.y + m.depth * 2.3);
    ctx.quadraticCurveTo((m.x1 + m.x2) / 2 - 60, m.y + m.depth * 2.2, m.x1 + 20, m.y + m.depth * 0.6);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // underside detail
    ctx.strokeStyle = shade(th.ground, 0.15); ctx.lineWidth = 3;
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(m.x1 + 40 * i, m.y + 22 * i); ctx.lineTo(m.x2 - 40 * i, m.y + 22 * i); ctx.stroke(); }
    // top surface
    ctx.fillStyle = shade(th.ground, 0.25);
    ctx.fillRect(m.x1, m.y, m.x2 - m.x1, 14);
    // neon edge
    ctx.shadowColor = th.edge; ctx.shadowBlur = 18;
    ctx.strokeStyle = th.edge; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(m.x1, m.y + 1); ctx.lineTo(m.x2, m.y + 1); ctx.stroke();
    // ledge markers
    ctx.fillStyle = th.accent; ctx.shadowColor = th.accent;
    for (const x of [m.x1, m.x2]) { ctx.beginPath(); ctx.arc(x, m.y + 2, 6 + Math.sin(time * 5) * 1.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();

    for (const p of stage.platforms) {
      const pp = platformPos(p, frame);
      ctx.save();
      ctx.fillStyle = shade(th.ground, 0.15);
      ctx.strokeStyle = INK; ctx.lineWidth = 4;
      const h = 12;
      ctx.beginPath();
      ctx.moveTo(pp.x1, pp.y); ctx.lineTo(pp.x2, pp.y); ctx.lineTo(pp.x2 - 12, pp.y + h); ctx.lineTo(pp.x1 + 12, pp.y + h); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.shadowColor = th.accent; ctx.shadowBlur = 14; ctx.strokeStyle = th.accent; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(pp.x1 + 4, pp.y + 1); ctx.lineTo(pp.x2 - 4, pp.y + 1); ctx.stroke();
      // underglow
      ctx.globalAlpha = 0.25; ctx.fillStyle = th.accent;
      ctx.beginPath(); ctx.ellipse((pp.x1 + pp.x2) / 2, pp.y + h + 6, (pp.x2 - pp.x1) * 0.4, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  // ---- HUD -----------------------------------------------------------------------------------------
  private drawOffscreen(state: GameState) {
    const { ctx } = this;
    for (const f of state.fighters) {
      if (f.action === 'dead' || f.stocks <= 0) continue;
      const sx = (f.x - this.cam.x) * this.cam.z + this.w / 2;
      const sy = (f.y - 40 - this.cam.y) * this.cam.z + this.h / 2;
      const m = 34;
      if (sx >= -10 && sx <= this.w + 10 && sy >= -10 && sy <= this.h + 10) continue;
      const cx = Math.max(m, Math.min(this.w - m, sx));
      const cy = Math.max(m, Math.min(this.h - m - 90, sy));
      ctx.save();
      ctx.fillStyle = 'rgba(20,11,36,0.75)'; ctx.strokeStyle = PLAYER_COLORS[f.slot]; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(cx, cy, 26, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 26, 0, Math.PI * 2); ctx.clip();
      previewFighter(ctx, f.charId, displaySkin(state, f.slot), cx, cy + 22, 0.42, 0);
      ctx.restore();
      const a = Math.atan2(sy - cy, sx - cx);
      ctx.save(); ctx.fillStyle = PLAYER_COLORS[f.slot]; ctx.translate(cx + Math.cos(a) * 32, cy + Math.sin(a) * 32); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-4, -7); ctx.lineTo(-4, 7); ctx.closePath(); ctx.fill(); ctx.restore();
    }
  }

  private drawHud(state: GameState, opts: { localSlots: number[]; time: number; training?: boolean; ping?: number }) {
    const { ctx } = this;
    const n = state.fighters.length;
    const cardW = Math.min(210, (this.w - 40) / n - 12);
    const total = n * cardW + (n - 1) * 12;
    let x0 = (this.w - total) / 2;
    const y0 = this.h - 86;
    const fa = t('lang') === 'fa';
    const hs = Math.min(1, this.h / 560);
    ctx.save();
    ctx.translate(this.w / 2, this.h); ctx.scale(hs, hs); ctx.translate(-this.w / 2, -this.h);
    for (const f of state.fighters) {
      const x = x0; x0 += cardW + 12;
      const col = PLAYER_COLORS[f.slot];
      ctx.save();
      ctx.globalAlpha = f.stocks <= 0 ? 0.4 : 1;
      ctx.fillStyle = 'rgba(20,11,36,0.72)';
      ctx.strokeStyle = col; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(x, y0, cardW, 74, 16); ctx.fill(); ctx.stroke();
      // portrait
      ctx.save();
      ctx.beginPath(); ctx.arc(x + 36, y0 + 37, 27, 0, Math.PI * 2);
      ctx.fillStyle = shade(col, -0.5); ctx.fill(); ctx.clip();
      previewFighter(ctx, f.charId, displaySkin(state, f.slot), x + 36, y0 + 62, 0.48, 0);
      ctx.restore();
      // damage %
      const d = f.damage;
      const heat = Math.min(1, d / 150);
      const dc = `rgb(255,${Math.round(255 - heat * 200)},${Math.round(255 - heat * 230)})`;
      const ds = this.dmgShake[f.slot] ?? 0;
      this.dmgShake[f.slot] = ds * 0.85;
      const jx = ds > 0.5 ? rnd(-ds, ds) * 0.5 : 0, jy = ds > 0.5 ? rnd(-ds, ds) * 0.5 : 0;
      ctx.font = `900 ${Math.min(38, cardW * 0.2)}px Vazirmatn, system-ui, sans-serif`;
      ctx.textAlign = 'left';
      ctx.lineWidth = 6; ctx.strokeStyle = INK;
      const txt = f.stocks <= 0 ? '—' : `${Math.floor(d)}%`;
      ctx.strokeText(txt, x + 70 + jx, y0 + 44 + jy);
      ctx.fillStyle = dc; ctx.fillText(txt, x + 70 + jx, y0 + 44 + jy);
      // name
      ctx.font = '700 12px Vazirmatn, system-ui, sans-serif';
      ctx.fillStyle = '#fff';
      const p = state.cfg.players[f.slot];
      let name = (p?.name ?? '').slice(0, 12);
      if (p?.bot) name += ` · ${t('bot')}`;
      if (this.trialSlots.has(f.slot)) name += ` · ${t('trial')}`;
      ctx.fillText(name, x + 70, y0 + 62);
      // stocks
      if (!opts.training) {
        for (let i = 0; i < Math.min(f.stocks, 5); i++) {
          ctx.fillStyle = col; ctx.strokeStyle = INK; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x + 74 + i * 14, y0 + 13, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        if (f.stocks > 5) { ctx.fillStyle = '#fff'; ctx.fillText(`×${f.stocks}`, x + 74 + 5 * 14, y0 + 17); }
      }
      ctx.restore();
    }
    ctx.restore();
    void fa;
    // timer
    if (state.timer > 0 || state.cfg.timeLimit > 0) {
      const sec = Math.ceil((state.timer || 0) / TICK_RATE);
      const s = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      ctx.save(); ctx.font = '900 30px Vazirmatn, system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 6; ctx.strokeStyle = INK; ctx.strokeText(s, this.w / 2, 42);
      ctx.fillStyle = sec <= 10 ? '#ff4f6d' : '#fff'; ctx.fillText(s, this.w / 2, 42); ctx.restore();
    }
    if (opts.ping !== undefined) {
      ctx.save(); ctx.font = '600 11px system-ui'; ctx.fillStyle = opts.ping < 90 ? '#3ee089' : opts.ping < 160 ? '#ffd23f' : '#ff4f6d';
      ctx.textAlign = 'right'; ctx.fillText(`${Math.round(opts.ping)} ms`, this.w - 12, 18); ctx.restore();
    }
    // countdown & end banners
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
    ctx.translate(this.w / 2, this.h * 0.42);
    ctx.scale(scale, scale);
    ctx.font = '900 96px Vazirmatn, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 14; ctx.strokeStyle = INK; ctx.strokeText(text, 0, 0);
    const g = ctx.createLinearGradient(0, -50, 0, 50); g.addColorStop(0, '#fff6c2'); g.addColorStop(1, '#ff4fd8');
    ctx.fillStyle = g; ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}
