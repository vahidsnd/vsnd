import { Btn } from '@nb/shared';
import { haptic } from '../services/platform.ts';

export interface InputSource { read(): number; destroy(): void; label: string }

const KEYMAP: Record<string, number> = {
  KeyA: Btn.LEFT, ArrowLeft: Btn.LEFT,
  KeyD: Btn.RIGHT, ArrowRight: Btn.RIGHT,
  KeyW: Btn.UP, ArrowUp: Btn.UP,
  KeyS: Btn.DOWN, ArrowDown: Btn.DOWN,
  Space: Btn.JUMP, KeyJ: Btn.ATTACK, KeyK: Btn.SPECIAL, KeyL: Btn.SHIELD, ShiftLeft: Btn.SHIELD,
  KeyU: Btn.GRAB, KeyI: Btn.STRONG, KeyZ: Btn.ATTACK, KeyX: Btn.SPECIAL, KeyC: Btn.JUMP, KeyV: Btn.SHIELD,
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

/** Mobile on-screen controls: floating joystick on the left, action buttons on the right. */
export class TouchControls implements InputSource {
  label = 'touch';
  el: HTMLDivElement;
  private stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private held = new Map<number, number>(); // pointerId -> button bit
  private latch = 0;
  private knob: HTMLDivElement;
  private base: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'touch';
    this.el.innerHTML = `
      <div class="stick-zone"><div class="stick-base"><div class="stick-knob"></div></div></div>
      <div class="tbtns">
        <button data-b="${Btn.SHIELD}" class="tb tb-shield">🛡</button>
        <button data-b="${Btn.GRAB}" class="tb tb-grab">✊</button>
        <button data-b="${Btn.STRONG}" class="tb tb-smash">💥</button>
        <button data-b="${Btn.JUMP}" class="tb tb-jump">⤒</button>
        <button data-b="${Btn.SPECIAL}" class="tb tb-special">B</button>
        <button data-b="${Btn.ATTACK}" class="tb tb-attack">A</button>
      </div>`;
    parent.appendChild(this.el);
    this.base = this.el.querySelector('.stick-base') as HTMLDivElement;
    this.knob = this.el.querySelector('.stick-knob') as HTMLDivElement;
    const zone = this.el.querySelector('.stick-zone') as HTMLDivElement;

    zone.addEventListener('pointerdown', (e) => {
      if (this.stick.id !== -1) return;
      zone.setPointerCapture(e.pointerId);
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
        btn.setPointerCapture(e.pointerId);
        this.held.set(e.pointerId, bit); this.latch |= bit; btn.classList.add('on'); e.preventDefault();
        haptic('light');
      });
      const up = (e: PointerEvent) => { this.held.delete(e.pointerId); btn.classList.remove('on'); };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });
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
  destroy() { this.el.remove(); }
}

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
