import { store } from './platform.ts';

/** Device-local preferences (graphics, controls) — not part of the synced profile. */
export interface Prefs {
  quality: 'auto' | 'low' | 'high';
  vibration: boolean;
  dmgNumbers: boolean;
  btnScale: number;     // 0.8 .. 1.25
  btnOpacity: number;   // 0.35 .. 1
  leftHanded: boolean;  // buttons on the left, stick on the right
}

const DEFAULTS: Prefs = { quality: 'auto', vibration: true, dmgNumbers: true, btnScale: 1, btnOpacity: 0.85, leftHanded: false };

export const prefs: Prefs = { ...DEFAULTS, ...store.get<Partial<Prefs>>('prefs', {}) };

export function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]) {
  prefs[k] = v;
  store.set('prefs', prefs);
}
