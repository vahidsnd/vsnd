import crypto from 'node:crypto';

// =====================================================================================
//  External providers used by accounts & notifications, each behind a small interface
//  with a "not configured" fallback so the server runs (and tests pass) without any keys.
//   • SMS one-time codes: Kavenegar verify/lookup API, or a console mock.
//   • Push: Firebase Cloud Messaging HTTP v1 (service account JSON), or a no-op.
//   • Google Play Games sign-in: server auth code → OAuth token → Games API player id.
// =====================================================================================

const env = (k: string) => process.env[k] ?? '';
const isProd = () => process.env.NODE_ENV === 'production';

// ---- SMS ----------------------------------------------------------------------------------------------
export interface SmsProvider {
  readonly name: string;
  /** true when codes are not really sent (dev): the route may return the code to the client */
  readonly mock: boolean;
  sendOtp(phone: string, code: string): Promise<{ ok: boolean; error?: string }>;
}

/** https://kavenegar.com/rest.html#sms-Lookup — template with a %token% placeholder. */
export class KavenegarSms implements SmsProvider {
  readonly name = 'kavenegar';
  readonly mock = false;
  constructor(private apiKey: string, private template: string, private fetchFn: typeof fetch = fetch) {}
  async sendOtp(phone: string, code: string) {
    const url = `https://api.kavenegar.com/v1/${encodeURIComponent(this.apiKey)}/verify/lookup.json`;
    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ receptor: phone, token: code, template: this.template }),
        signal: AbortSignal.timeout(10_000),
      });
      const j = (await res.json().catch(() => null)) as { return?: { status?: number; message?: string } } | null;
      const st = j?.return?.status;
      if (!res.ok || st !== 200) {
        console.error(`[sms] kavenegar failed http=${res.status} status=${st} ${j?.return?.message ?? ''}`);
        return { ok: false, error: `sms-${st ?? res.status}` };
      }
      return { ok: true };
    } catch (e) {
      console.error('[sms] kavenegar error', (e as Error).message);
      return { ok: false, error: 'sms-network' };
    }
  }
}

/** Development provider: prints the code to the server console. */
export class ConsoleSms implements SmsProvider {
  readonly name = 'console';
  readonly mock = true;
  async sendOtp(phone: string, code: string) {
    console.log(`[sms:mock] code for ${phone}: ${code}`);
    return { ok: true };
  }
}

let sms: SmsProvider | null = null;
export function smsProvider(): SmsProvider {
  if (sms) return sms;
  const key = env('KAVENEGAR_API_KEY'), tpl = env('KAVENEGAR_TEMPLATE');
  sms = key && tpl ? new KavenegarSms(key, tpl) : new ConsoleSms();
  if (!(key && tpl) && isProd()) console.warn('[sms] KAVENEGAR_API_KEY / KAVENEGAR_TEMPLATE not set: phone login codes are only logged');
  return sms;
}
export function setSmsProvider(p: SmsProvider | null) { sms = p; }
/** Only outside production, and only with the mock provider, the code is echoed to the client. */
export function echoOtp() { return smsProvider().mock && !isProd(); }

// ---- Google service-account OAuth (shared by FCM) ---------------------------------------------------------
interface ServiceAccount { client_email: string; private_key: string; project_id: string }
const tokenCache = new Map<string, { token: string; exp: number }>();
async function serviceToken(sa: ServiceAccount, scope: string): Promise<string> {
  const ck = sa.client_email + scope;
  const c = tokenCache.get(ck);
  if (c && c.exp > Date.now() + 60_000) return c.token;
  const now = Math.floor(Date.now() / 1000);
  const b64 = (s: string) => Buffer.from(s).toString('base64url');
  const header = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64(JSON.stringify({ iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(`${header}.${claim}`).sign(sa.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claim}.${sig}` }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error('google oauth failed ' + res.status);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(ck, { token: j.access_token, exp: Date.now() + j.expires_in * 1000 });
  return j.access_token;
}

// ---- push -------------------------------------------------------------------------------------------------
export interface PushMessage { title: string; body: string; data?: Record<string, string> }
export interface PushProvider {
  readonly name: string;
  /** Sends to each device token; returns the tokens the provider reported as invalid (to forget them). */
  send(tokens: string[], msg: PushMessage): Promise<{ sent: number; invalid: string[] }>;
}

/** Firebase Cloud Messaging HTTP v1: POST projects/{id}/messages:send per token. */
export class FcmPush implements PushProvider {
  readonly name = 'fcm';
  constructor(private sa: ServiceAccount) {}
  async send(tokens: string[], msg: PushMessage) {
    let sent = 0;
    const invalid: string[] = [];
    let access: string;
    try { access = await serviceToken(this.sa, 'https://www.googleapis.com/auth/firebase.messaging'); } catch (e) { console.error('[push]', (e as Error).message); return { sent, invalid }; }
    const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.sa.project_id)}/messages:send`;
    await Promise.all(tokens.map(async (token) => {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
          body: JSON.stringify({ message: { token, notification: { title: msg.title, body: msg.body }, data: msg.data ?? {}, android: { priority: 'HIGH', notification: { channel_id: 'default' } } } }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) { sent++; return; }
        const j = (await res.json().catch(() => null)) as { error?: { status?: string; details?: { errorCode?: string }[] } } | null;
        const codes = [j?.error?.status, ...(j?.error?.details ?? []).map((d) => d.errorCode)];
        if (res.status === 404 || codes.includes('UNREGISTERED') || codes.includes('INVALID_ARGUMENT')) invalid.push(token);
        else console.error('[push] fcm', res.status, JSON.stringify(j?.error ?? {}));
      } catch (e) { console.error('[push] fcm error', (e as Error).message); }
    }));
    return { sent, invalid };
  }
}
export class NoopPush implements PushProvider {
  readonly name = 'none';
  async send() { return { sent: 0, invalid: [] as string[] }; }
}
let push: PushProvider | null = null;
export function pushProvider(): PushProvider {
  if (push) return push;
  const raw = env('FCM_SERVICE_ACCOUNT');
  if (raw) {
    try { push = new FcmPush(JSON.parse(raw) as ServiceAccount); } catch { console.error('[push] FCM_SERVICE_ACCOUNT is not valid JSON'); }
  }
  return (push ??= new NoopPush());
}
export function setPushProvider(p: PushProvider | null) { push = p; }

// ---- Google Play Games sign-in --------------------------------------------------------------------------
export function gpgConfigured() { return !!(env('GPG_CLIENT_ID') && env('GPG_CLIENT_SECRET')); }
/**
 * Verifies a Play Games Services v2 server auth code: exchanges it for an access token
 * (OAuth client of type "web application" linked to the Play Games project) and reads the
 * player id from the Games API. Returns reason 'not-configured' without env keys.
 */
export async function verifyPlayGames(serverAuthCode: string): Promise<{ ok: boolean; playerId?: string; name?: string; reason?: string }> {
  if (!gpgConfigured()) return { ok: false, reason: 'not-configured' };
  if (!serverAuthCode) return { ok: false, reason: 'no-code' };
  try {
    const tok = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: serverAuthCode, client_id: env('GPG_CLIENT_ID'), client_secret: env('GPG_CLIENT_SECRET'), grant_type: 'authorization_code', redirect_uri: '' }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tok.ok) return { ok: false, reason: 'exchange-' + tok.status };
    const { access_token } = (await tok.json()) as { access_token: string };
    const me = await fetch('https://games.googleapis.com/games/v1/players/me', { headers: { authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(10_000) });
    if (!me.ok) return { ok: false, reason: 'player-' + me.status };
    const j = (await me.json()) as { playerId?: string; displayName?: string };
    if (!j.playerId) return { ok: false, reason: 'no-player' };
    return { ok: true, playerId: j.playerId, name: j.displayName };
  } catch (e) {
    return { ok: false, reason: 'network:' + (e as Error).message };
  }
}
