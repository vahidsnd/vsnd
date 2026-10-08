import crypto from 'node:crypto';
import { config } from '../config.ts';

/**
 * Google Play purchase verification via the Android Publisher API
 * (purchases.products.get + acknowledge). Uses a service-account JWT so no SDK is needed.
 */
let cachedToken: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const sa = JSON.parse(config.googlePlay.serviceAccount) as { client_email: string; private_key: string };
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const sig = crypto.createSign('RSA-SHA256').update(`${header}.${claim}`).sign(sa.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${header}.${claim}.${sig}` }),
  });
  if (!res.ok) throw new Error('google oauth failed ' + res.status);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

function b64url(s: string) { return Buffer.from(s).toString('base64url'); }

export async function verifyGooglePlay(productId: string, purchaseToken: string): Promise<{ ok: boolean; orderId?: string; reason?: string }> {
  if (!config.googlePlay.serviceAccount) return { ok: false, reason: 'not-configured' };
  const pkg = config.googlePlay.packageName;
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
  const token = await accessToken();
  const res = await fetch(base, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return { ok: false, reason: 'http-' + res.status };
  const p = (await res.json()) as { purchaseState: number; acknowledgementState: number; orderId: string; consumptionState: number };
  if (p.purchaseState !== 0) return { ok: false, reason: 'not-purchased' };
  if (p.acknowledgementState === 0) {
    await fetch(base + ':acknowledge', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
  }
  return { ok: true, orderId: p.orderId };
}
