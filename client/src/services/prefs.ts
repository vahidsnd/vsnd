import { store } from './platform.ts';

/** Device-local preferences (graphics, controls) — not part of the synced profile. */
export interface Prefs {
  quality: 'auto' | 'low' | 'high';
  vibration: boolean;
  dmgNumbers: boolean;
  btnScale: number;     // 0.8 .. 1.25
  btnOpacity: number;   // 0.35 .. 1
  leftHanded: boolean;  // buttons on the left, stick on the right
  /** custom touch layout from the control editor (null = default layout) */
  layout: CtlLayout | null;
}

/** One touch button: centre as a fraction of the arena (right-handed frame) and a size multiplier. */
export interface CtlPos { x: number; y: number; s: number }
/** Positions are stored for right-handed play and mirrored horizontally in left-handed mode. */
export interface CtlLayout { v: 1; btn: Record<string, CtlPos>; stick: { x: number; y: number; w: number; h: number } }

const DEFAULTS: Prefs = { quality: 'auto', vibration: true, dmgNumbers: true, btnScale: 1, btnOpacity: 0.85, leftHanded: false, layout: null };

export const prefs: Prefs = { ...DEFAULTS, ...store.get<Partial<Prefs>>('prefs', {}) };

export function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]) {
  prefs[k] = v;
  store.set('prefs', prefs);
}
