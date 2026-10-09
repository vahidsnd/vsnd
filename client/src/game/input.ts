import { Btn } from '@nb/shared';
import { haptic } from '../services/platform.ts';
import { prefs, type CtlLayout, type CtlPos } from '../services/prefs.ts';
import { t } from '../i18n.ts';
import { svgHtml } from '../ui/icons.ts';

export interface InputSource { read(): number; destroy(): void; label: string }

const KEYMAP: Record<string, number> = {
  KeyA: Btn.LEFT, ArrowLeft: Btn.LEFT,
  KeyD: Btn.RIGHT, ArrowRight: Btn.RIGHT,
  KeyW: Btn.UP, ArrowUp: Btn.UP,
  KeyS: Btn.DOWN, ArrowDown: Btn.DOWN,
  Space: Btn.JUMP, KeyJ: Btn.ATTACK, KeyK: Btn.SPECIAL, KeyL: Btn.SHIELD, ShiftLeft: Btn.SHIELD,
  KeyU: Btn.GRAB, KeyI: Btn.STRONG, KeyE: Btn.MAGIC, KeyO: Btn.MAGIC, KeyZ: Btn.ATTACK, KeyX: Btn.SPECIAL, KeyC: Btn.JUMP, KeyV: Btn.SHIELD,
};

export class KeyboardSource implements InputSource {
  label = 'keyboard';
  private bits = 0;
  private latch = 0; // presses shorter than a frame still register once
  private down = (e: KeyboardEvent) => {
    const b = KEYMAP[e.code];
    if (b) { this.bits |= b; this.latch |= b; if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); }
  };
  private up = (e: KeyboardEvent) => { const b = KEYMAP[e.code]; if (b) this.bits &= ~b; };
  private blur = () => { this.bits = 0; };
  constructor() {
    addEventListener('keydown', this.down);
    addEventListener('keyup', this.up);
    addEventListener('blur', this.blur);
  }
  read() { const b = this.bits | this.latch; this.latch = 0; return b; }
  destroy() { removeEventListener('keydown', this.down); removeEventListener('keyup', this.up); removeEventListener('blur', this.blur); }
}

export class GamepadSource implements InputSource {
  label: string;
  constructor(public index: number) { this.label = 'pad' + index; }
  read() {
    const gp = navigator.getGamepads?.()[this.index];
    if (!gp) return 0;
    let b = 0;
    const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
    const pressed = (i: number) => !!gp.buttons[i]?.pressed;
    if (ax < -0.4 || pressed(14)) b |= Btn.LEFT;
    if (ax > 0.4 || pressed(15)) b |= Btn.RIGHT;
    if (ay < -0.5 || pressed(12)) b |= Btn.UP;
    if (ay > 0.5 || pressed(13)) b |= Btn.DOWN;
    if (pressed(0)) b |= Btn.ATTACK;
    if (pressed(1)) b |= Btn.SPECIAL;
    if (pressed(2) || pressed(3)) b |= Btn.JUMP;
    if (pressed(4)) b |= Btn.GRAB;
    if (pressed(10) || pressed(11)) b |= Btn.MAGIC;
    if (pressed(5) || pressed(6) || pressed(7)) b |= Btn.SHIELD;
    // right stick = smash attacks in that direction
    const rx = gp.axes[2] ?? 0, ry = gp.axes[3] ?? 0;
    if (Math.hypot(rx, ry) > 0.6) {
      b |= Btn.STRONG;
      if (Math.abs(rx) > Math.abs(ry)) b = (b & ~(Btn.LEFT | Btn.RIGHT | Btn.UP | Btn.DOWN)) | (rx < 0 ? Btn.LEFT : Btn.RIGHT);
      else b = (b & ~(Btn.LEFT | Btn.RIGHT | Btn.UP | Btn.DOWN)) | (ry < 0 ? Btn.UP : Btn.DOWN);
    }
    return b;
  }
  destroy() {}
}

/** Base sizes (px, before the size preference) of the touch buttons; keys match the .tb-* classes. */
export const TOUCH_BUTTONS: Record<string, { size: number; font?: number }> = {
  attack: { size: 80, font: 26 }, special: { size: 64, font: 22 }, jump: { size: 64 }, shield: { size: 52 }, grab: { size: 50 }, smash: { size: 50 }, magic: { size: 50 },
};

let safeProbe: HTMLDivElement | null = null;
/** Current safe-area insets (notch / rounded corners) in px. */
export function safeInsets() {
  if (!safeProbe) {
    safeProbe = document.createElement('div');
    safeProbe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-left:var(--safe-l);padding-right:var(--safe-r);padding-bottom:var(--safe-b)';
    document.body.appendChild(safeProbe);
  }
  const cs = getComputedStyle(safeProbe);
  return { l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0 };
}

/** Mobile on-screen controls: floating joystick on the left, action buttons on the right. */
export class TouchControls implements InputSource {
  label = 'touch';
  el: HTMLDivElement;
  private stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private held = new Map<number, number>(); // pointerId -> button bit
  private latch = 0;
  private knob: HTMLDivElement;
  private base: HTMLDivElement;
  readonly lefty: boolean;
  layout: CtlLayout | null;
  private onResize = () => this.applyLayout();

  /** editor = static preview for the layout editor (no input handling) */
  constructor(parent: HTMLElement, opts: { editor?: boolean; layout?: CtlLayout | null } = {}) {
    this.lefty = prefs.leftHanded;
    this.layout = opts.layout !== undefined ? opts.layout : prefs.layout;
    this.el = document.createElement('div');
    this.el.className = this.lefty ? 'touch lefty' : 'touch';
    this.el.style.setProperty('--s', String(prefs.btnScale));
    this.el.style.setProperty('--o', String(prefs.btnOpacity));
    this.el.innerHTML = `
      <div class="stick-zone"><div class="stick-base"><div class="stick-knob"></div></div></div>
      <div class="tbtns">
        <button data-b="${Btn.SHIELD}" data-k="shield" class="tb tb-shield">${svgHtml('shield', 22)}</button>
        <button data-b="${Btn.GRAB}" data-k="grab" class="tb tb-grab">${svgHtml('grab', 22)}</button>
        <button data-b="${Btn.STRONG}" data-k="smash" class="tb tb-smash">${svgHtml('zap', 22)}</button>
        <button data-b="${Btn.MAGIC}" data-k="magic" class="tb tb-magic">${svgHtml('sparkles', 22)}</button>
        <button data-b="${Btn.JUMP}" data-k="jump" class="tb tb-jump"><span>${svgHtml('up', 22)}<small>${t('btnJump')}</small></span></button>
        <button data-b="${Btn.SPECIAL}" data-k="special" class="tb tb-special"><span>B<small>${t('btnSpecial')}</small></span></button>
        <button data-b="${Btn.ATTACK}" data-k="attack" class="tb tb-attack"><span>A<small>${t('btnAttack')}</small></span></button>
      </div>`;
    parent.appendChild(this.el);
    this.base = this.el.querySelector('.stick-base') as HTMLDivElement;
    this.knob = this.el.querySelector('.stick-knob') as HTMLDivElement;
    addEventListener('resize', this.onResize);
    this.applyLayout();
    if (opts.editor) { this.el.classList.add('editing'); return; }
    const zone = this.el.querySelector('.stick-zone') as HTMLDivElement;

    zone.addEventListener('pointerdown', (e) => {
      if (this.stick.id !== -1) return;
      try { zone.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
      this.base.style.left = `${e.clientX}px`; this.base.style.top = `${e.clientY}px`;
      this.base.classList.add('on');
      e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stick.id) return;
      const R = 56;
      let dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
      this.stick.x = dx / R; this.stick.y = dy / R;
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
      this.knob.style.transform = '';
      this.base.classList.remove('on');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    this.el.querySelectorAll<HTMLButtonElement>('.tb').forEach((btn) => {
      const bit = Number(btn.dataset.b);
      btn.addEventListener('pointerdown', (e) => {
        try { btn.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
        this.held.set(e.pointerId, bit); this.latch |= bit; btn.classList.add('on'); e.preventDefault();
        haptic('light');
      });
      const up = (e: PointerEvent) => { this.held.delete(e.pointerId); btn.classList.remove('on'); };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  /**
   * Places buttons and the stick zone from a custom layout (fractions of the arena, mirrored
   * for left-handed play), clamped inside the screen's safe area. No layout = CSS default.
   */
  applyLayout(layout: CtlLayout | null = this.layout) {
    this.layout = layout;
    const el = this.el;
    const btns = el.querySelectorAll<HTMLElement>('.tb');
    const zone = el.querySelector('.stick-zone') as HTMLElement;
    if (!layout) {
      el.classList.remove('custom');
      btns.forEach((b) => { b.style.left = b.style.top = b.style.width = b.style.height = b.style.fontSize = ''; });
      zone.style.left = zone.style.top = zone.style.width = zone.style.height = zone.style.right = zone.style.bottom = '';
      return;
    }
    el.classList.add('custom');
    const W = el.clientWidth || innerWidth, H = el.clientHeight || innerHeight;
    const safe = safeInsets();
    const minX = safe.l + 2, maxX = W - safe.r - 2, maxY = H - safe.b - 2;
    btns.forEach((b) => {
      const k = b.dataset.k!, def = TOUCH_BUTTONS[k], pos = layout.btn[k];
      if (!def || !pos) return;
      const size = Math.round(def.size * prefs.btnScale * clamp(pos.s, 0.6, 1.8));
      const fx = this.lefty ? 1 - pos.x : pos.x;
      const cx = clamp(fx * W, minX + size / 2, maxX - size / 2);
      const cy = clamp(pos.y * H, 2 + size / 2, maxY - size / 2);
      Object.assign(b.style, { left: `${cx - size / 2}px`, top: `${cy - size / 2}px`, width: `${size}px`, height: `${size}px`, fontSize: def.font ? `${Math.round(def.font * size / def.size)}px` : '' });
    });
    const st = layout.stick;
    const w = clamp(st.w, 0.12, 0.9) * W, h = clamp(st.h, 0.15, 1) * H;
    const fx = this.lefty ? 1 - st.x - st.w : st.x;
    const x = clamp(fx * W, minX, Math.max(minX, maxX - w)), y = clamp(st.y * H, 0, Math.max(0, H - h));
    Object.assign(zone.style, { left: `${x}px`, top: `${y}px`, width: `${Math.min(w, maxX - minX)}px`, height: `${Math.min(h, H)}px`, right: 'auto', bottom: 'auto' });
  }

  /** The layout currently on screen in layout form (measures the CSS default when none is set). */
  measure(): CtlLayout {
    const r0 = this.el.getBoundingClientRect();
    const W = r0.width || 1, H = r0.height || 1;
    const mx = (x: number) => (this.lefty ? 1 - x : x);
    const btn: Record<string, CtlPos> = {};
    this.el.querySelectorAll<HTMLElement>('.tb').forEach((b) => {
      const k = b.dataset.k!, def = TOUCH_BUTTONS[k];
      const r = b.getBoundingClientRect();
      if (!def || !r.width) return;
      btn[k] = { x: mx((r.left + r.width / 2 - r0.left) / W), y: (r.top + r.height / 2 - r0.top) / H, s: Math.round((r.width / (def.size * prefs.btnScale)) * 100) / 100 };
    });
    const z = (this.el.querySelector('.stick-zone') as HTMLElement).getBoundingClientRect();
    const zx = (z.left - r0.left) / W, zw = z.width / W;
    return { v: 1, btn, stick: { x: this.lefty ? 1 - zx - zw : zx, y: (z.top - r0.top) / H, w: zw, h: z.height / H } };
  }

  read() {
    let b = 0;
    const { x, y } = this.stick;
    if (x < -0.35) b |= Btn.LEFT;
    if (x > 0.35) b |= Btn.RIGHT;
    if (y < -0.45) b |= Btn.UP;
    if (y > 0.5) b |= Btn.DOWN;
    for (const v of this.held.values()) b |= v;
    b |= this.latch; this.latch = 0;
    return b;
  }
  destroy() { removeEventListener('resize', this.onResize); this.el.remove(); }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const isTouch = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

export function connectedPads(): number[] {
  const pads = navigator.getGamepads?.() ?? [];
  const out: number[] = [];
  for (let i = 0; i < pads.length; i++) if (pads[i]) out.push(i);
  return out;
}

/** Merges several sources into one (keyboard + first pad + touch for player 1). */
export class MergedSource implements InputSource {
  label = 'merged';
  constructor(private sources: InputSource[]) {}
  read() { let b = 0; for (const s of this.sources) b |= s.read(); return b; }
  destroy() { this.sources.forEach((s) => s.destroy()); }
}
