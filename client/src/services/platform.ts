import { Capacitor } from '@capacitor/core';
import type { Market } from '@nb/shared';

export const MARKET = ((import.meta.env.VITE_MARKET as string) || 'web') as Market;
export const isNative = Capacitor.isNativePlatform();

export function serverHttp(): string {
  const env = (import.meta.env.VITE_SERVER_URL as string) || '';
  if (env) return env.replace(/\/$/, '');
  return location.origin;
}

export function serverWs(): string {
  return serverHttp().replace(/^http/, 'ws') + '/ws';
}

export const store = {
  get<T>(k: string, def: T): T {
    try { const v = localStorage.getItem('nb.' + k); return v ? (JSON.parse(v) as T) : def; } catch { return def; }
  },
  set(k: string, v: unknown) {
    try { localStorage.setItem('nb.' + k, JSON.stringify(v)); } catch { /* storage full or blocked */ }
  },
};

export async function haptic(kind: 'light' | 'heavy' = 'light') {
  if (!isNative) { if (navigator.vibrate) navigator.vibrate(kind === 'heavy' ? 30 : 10); return; }
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: kind === 'heavy' ? ImpactStyle.Heavy : ImpactStyle.Light });
  } catch { /* not available */ }
}
