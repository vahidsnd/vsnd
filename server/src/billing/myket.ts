import { config } from '../config.ts';

/**
 * Myket in-app purchase verification (Myket developer API).
 * GET https://developer.myket.ir/api/applications/{package}/purchases/products/{sku}/verify/{token}
 * Header: X-Access-Token: <token from the Myket developer panel>
 *
 * Myket's docs are the source of truth for the exact path; adjust `MYKET_VERIFY_URL`
 * via env if Myket changes it.
 */
export async function verifyMyket(productId: string, purchaseToken: string): Promise<{ ok: boolean; orderId?: string; reason?: string }> {
  if (!config.myket.accessToken) return { ok: false, reason: 'not-configured' };
  const tpl = process.env.MYKET_VERIFY_URL
    ?? 'https://developer.myket.ir/api/applications/{pkg}/purchases/products/{sku}/verify/{token}';
  const url = tpl
    .replace('{pkg}', encodeURIComponent(config.myket.packageName))
    .replace('{sku}', encodeURIComponent(productId))
    .replace('{token}', encodeURIComponent(purchaseToken));
  const res = await fetch(url, { headers: { 'X-Access-Token': config.myket.accessToken } });
  if (!res.ok) return { ok: false, reason: 'http-' + res.status };
  const j = (await res.json()) as { purchaseState?: number; consumptionState?: number; orderId?: string; developerPayload?: string };
  if (j.purchaseState !== undefined && j.purchaseState !== 0) return { ok: false, reason: 'not-purchased' };
  return { ok: true, orderId: j.orderId };
}
