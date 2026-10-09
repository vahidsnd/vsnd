import { Capacitor } from '@capacitor/core';
import { checksum, migrateProfile, refreshDaily, type Profile } from '@nb/shared';
import { backend } from './backend.ts';
import { store } from './platform.ts';

/**
 * Account & progress recovery.
 *  Online: phone login with a one-time SMS code, a 12-character transfer code, Google Play
 *  Games sign-in (when the native build has a Play Games plugin and the server is configured).
 *  Logging in to another account swaps the stored token and restarts the app on it.
 *  Offline (test APK, no server): the whole local profile can be exported as a code and
 *  imported on another device.
 */
export interface AccountInfo { code: string; phone: string | null; transfer: string | null; gpg: boolean; gpgConfigured: boolean; sms: string }
export interface OtpSent { phone: string; ttl: number; retryIn: number; devCode?: string }
type Session = { token: string; profile: Profile; switched?: boolean; linked?: boolean; phone?: string };

export const account = {
  get online() { return backend.online; },
  info: () => backend.api<AccountInfo>('GET', '/api/account'),
  requestOtp: (phone: string) => backend.api<OtpSent>('POST', '/api/auth/otp/request', { phone }),
  async verifyOtp(phone: string, code: string) { return this.applySession(await backend.api<Session>('POST', '/api/auth/otp/verify', { phone, code })); },
  newTransfer: async () => (await backend.api<{ code: string }>('POST', '/api/account/transfer/new', {})).code,
  async redeemTransfer(code: string) { return this.applySession(await backend.api<Session>('POST', '/api/auth/transfer', { code })); },

  /** Google Play Games: needs a native plugin exposing signIn() → { serverAuthCode }. */
  gpgAvailable() {
    try { return Capacitor.isPluginAvailable('PlayGamesAuth') || Capacitor.isPluginAvailable('PlayGames'); } catch { return false; }
  },
  async gpgSignIn(): Promise<'switched' | 'linked' | 'same'> {
    const P = (Capacitor as any).Plugins?.PlayGamesAuth ?? (Capacitor as any).Plugins?.PlayGames;
    if (!P?.signIn) throw new Error('gpg-unavailable');
    const r = await P.signIn({ serverAuthCode: true });
    const code = r?.serverAuthCode ?? r?.authCode;
    if (!code) throw new Error('gpg-cancelled');
    const s = await this.applySession(await backend.api<Session>('POST', '/api/auth/gpg', { serverAuthCode: code }));
    return s;
  },

  /** Same account → refresh the profile; another account → switch token and restart. */
  applySession(s: Session): 'switched' | 'linked' | 'same' {
    if (s.token && s.token !== backend.token) {
      switchTo(s.token);
      return 'switched';
    }
    if (s.profile) backend.applyServerProfile(s.profile);
    return s.linked ? 'linked' : 'same';
  },
};

export function switchTo(token: string) {
  store.set('token', token);
  backend.token = token;
  setTimeout(() => location.reload(), 900);
}

// ---- offline export / import --------------------------------------------------------------------------
const PREFIX = 'NBX1';
async function deflate(s: string): Promise<{ z: boolean; bytes: Uint8Array }> {
  const raw = new TextEncoder().encode(s);
  try {
    if (typeof CompressionStream === 'undefined') throw 0;
    const cs = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return { z: true, bytes: new Uint8Array(await new Response(cs).arrayBuffer()) };
  } catch { return { z: false, bytes: raw }; }
}
async function inflate(bytes: Uint8Array, z: boolean): Promise<string> {
  if (!z) return new TextDecoder().decode(bytes);
  if (typeof DecompressionStream === 'undefined') throw new Error('unsupported');
  const ds = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new TextDecoder().decode(await new Response(ds).arrayBuffer());
}
const b64 = (u: Uint8Array) => { let s = ''; for (const c of u) s += String.fromCharCode(c); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64 = (s: string) => { const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); };

/** The offline profile as a copyable code (NBX1.<z|p>.<data>.<check>). */
export async function exportProfile(): Promise<string> {
  const p = { ...backend.profile, history: backend.profile.history.slice(0, 10) };
  const { z, bytes } = await deflate(JSON.stringify(p));
  const data = b64(bytes);
  return `${PREFIX}.${z ? 'z' : 'p'}.${data}.${checksum(data)}`;
}
/** Validates and decodes an export code. Throws 'bad-code'. */
export async function decodeExport(code: string): Promise<Profile> {
  const parts = code.replace(/\s+/g, '').split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX || checksum(parts[2]) !== parts[3]) throw new Error('bad-code');
  let p: Profile;
  try { p = JSON.parse(await inflate(unb64(parts[2]), parts[1] === 'z')); } catch { throw new Error('bad-code'); }
  if (!p || typeof p !== 'object' || !Array.isArray(p.fighters) || typeof p.coins !== 'number') throw new Error('bad-code');
  return p;
}
/** Replaces the local offline profile with an imported one (keeps the local id). */
export function importProfile(p: Profile) {
  p.id = backend.profile.id;
  migrateProfile(p);
  refreshDaily(p);
  backend.profile = p;
  backend.touch();
}
