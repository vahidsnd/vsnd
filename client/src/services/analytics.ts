import { remoteConfig, type AnalyticsEventName } from '@nb/shared';
import { serverHttp, store } from './platform.ts';

/**
 * Batched, anonymous analytics: event name + one short dimension (screen, mode, product…).
 * Nothing identifying is sent. Events wait in a small local queue (also across restarts while
 * offline) and are posted every 20 s or when the app goes to the background.
 */
type Ev = { n: AnalyticsEventName; d?: string };
const MAX_QUEUE = 200;
let queue: Ev[] = store.get<Ev[]>('aq', []);
let timer = 0;
let lastScreen = '';
let online = false;

export function track(n: AnalyticsEventName, d?: string) {
  if (!remoteConfig().flags.analytics) return;
  queue.push(d ? { n, d: String(d).slice(0, 24) } : { n });
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  store.set('aq', queue);
}

/** screen views from the DOM router (deduplicated) */
export function trackScreen(el: HTMLElement) {
  const cls = [...el.classList].find((c) => c !== 'page' && c !== 'screen') ?? 'unknown';
  if (cls === lastScreen) return;
  lastScreen = cls;
  track('screen', cls);
}

export function flushAnalytics(beacon = false) {
  if (!online || !queue.length || !serverHttp()) return;
  const batch = queue.splice(0, 100);
  store.set('aq', queue);
  const body = JSON.stringify({ events: batch });
  const url = serverHttp() + '/api/analytics';
  if (beacon && navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) return;
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true })
    .then((r) => { if (!r.ok && r.status !== 429) throw new Error('http'); })
    .catch(() => { queue = [...batch, ...queue].slice(-MAX_QUEUE); store.set('aq', queue); });
}

export function initAnalytics(isOnline: boolean) {
  online = isOnline;
  track('session_start', isOnline ? 'online' : 'offline');
  if (!isOnline) return;
  clearInterval(timer);
  timer = window.setInterval(() => flushAnalytics(), 20_000);
  setTimeout(() => flushAnalytics(), 3000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushAnalytics(true); });
}
