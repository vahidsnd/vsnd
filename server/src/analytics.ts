import {
  aggregateEvents, bump, dayKey, IAP_PRODUCTS, mergeRemoteConfig, parsePrice, pruneAnalytics, remoteConfig, setRemoteConfig, validateRemoteConfig,
} from '@nb/shared';
import { analyticsStore, dbMeta, markDirty, type UserRec } from './db.ts';

type Handler = (body: any, user: UserRec | null) => Promise<unknown> | unknown;
const today = () => dayKey(Date.now());

/** Server-side counter (ads, purchases…). */
export function track(key: string, n = 1) { bump(analyticsStore(), today(), key, n); markDirty(); }

/** A verified purchase: count per product and revenue per currency. */
export function trackPurchase(productId: string, market: string) {
  const prod = IAP_PRODUCTS.find((p) => p.id === productId);
  track('iap:' + productId);
  track('iapm:' + (market === 'myket' ? 'myket' : market === 'googleplay' ? 'googleplay' : 'web'));
  const price = prod ? parsePrice((prod.price as Record<string, string>)[market] ?? prod.price.web) : {};
  if (price.usd) track('rev_usd', price.usd);
  if (price.toman) track('rev_toman', price.toman);
}

let lastPrune = '';
export const analyticsRoutes: Record<string, Handler> = {
  /** batched client events; works without a session (counts only, no ids stored) */
  'POST /api/analytics': (b) => {
    if (!remoteConfig().flags.analytics) return { ok: 0 };
    const d = today();
    const ok = aggregateEvents(analyticsStore(), d, b?.events);
    if (lastPrune !== d) { lastPrune = d; pruneAnalytics(analyticsStore(), d); }
    if (ok) markDirty();
    return { ok };
  },
  /** remote config for clients (cached by the app for offline use) */
  'GET /api/config': () => ({ config: remoteConfig() }),
};

/** Admin: replace the stored overrides; returns the merged config + validation messages. */
export function setRemoteOverrides(overrides: unknown) {
  const { patch, errors } = validateRemoteConfig(overrides);
  const stored = { ...patch, version: Date.now() };
  dbMeta().remoteConfig = stored;
  setRemoteConfig(mergeRemoteConfig(stored));
  markDirty();
  return { config: remoteConfig(), overrides: stored, errors };
}
