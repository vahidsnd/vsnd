// =============================================================================================
//  Analytics: privacy-friendly daily counters. Clients send batched events (name + one optional
//  dimension such as a screen or a mode); the server only keeps aggregated counts per day —
//  never user ids, names or IPs. DAU / installs / D1-D7-D30 retention are counted from each
//  user's install day and last active day (kept on the user record, not in the counters).
// =============================================================================================

export const ANALYTICS_EVENTS = [
  'session_start', 'screen', 'match_start', 'match_end', 'purchase', 'ad_watched', 'tutorial_step', 'feature_unlock',
  'replay_watch', 'replay_share', 'spectate',
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

/** n = event name, d = optional dimension (screen id, mode, product…) */
export interface AnalyticsEvent { n: string; d?: string }
export type DayCounters = Record<string, number>;
export interface AnalyticsStore { days: Record<string, DayCounters> }

export const ANALYTICS_MAX_BATCH = 100;
export const ANALYTICS_MAX_KEYS_PER_DAY = 600;
export const ANALYTICS_KEEP_DAYS = 120;
export const RETENTION_DAYS = [1, 7, 30] as const;

export function newAnalyticsStore(): AnalyticsStore { return { days: {} }; }

/** Dimension values are short ids only: lowercase letters, digits, - and _. */
export function sanitizeDim(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
  return s || null;
}

export function bump(store: AnalyticsStore, day: string, key: string, n = 1) {
  const d = (store.days[day] ??= {});
  if (d[key] === undefined && Object.keys(d).length >= ANALYTICS_MAX_KEYS_PER_DAY) return false;
  d[key] = (d[key] ?? 0) + n;
  return true;
}

/** Adds a client batch to the day's counters. Returns how many events were accepted. */
export function aggregateEvents(store: AnalyticsStore, day: string, events: unknown): number {
  if (!Array.isArray(events)) return 0;
  let ok = 0;
  for (const e of events.slice(0, ANALYTICS_MAX_BATCH)) {
    if (!e || typeof e !== 'object') continue;
    const n = (e as AnalyticsEvent).n;
    if (!(ANALYTICS_EVENTS as readonly string[]).includes(n)) continue;
    bump(store, day, 'ev:' + n);
    const dim = sanitizeDim((e as AnalyticsEvent).d);
    if (dim) bump(store, day, `ev:${n}:${dim}`);
    ok++;
  }
  return ok;
}

export function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000);
}
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(day + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
}

export interface ActivityRec { installDay?: string; lastDay?: string }

/** A new player: counts an install for the day. */
export function noteInstall(store: AnalyticsStore, rec: ActivityRec, today: string) {
  rec.installDay = today;
  bump(store, today, 'installs');
}

/**
 * The player was active today. Counts DAU once per day and, on day 1/7/30 after install,
 * a retention hit for the install cohort. Returns true the first time per day.
 */
export function noteActive(store: AnalyticsStore, rec: ActivityRec, today: string): boolean {
  if (rec.lastDay === today) return false;
  rec.lastDay = today;
  rec.installDay ??= today;
  bump(store, today, 'dau');
  const d = dayDiff(rec.installDay, today);
  if ((RETENTION_DAYS as readonly number[]).includes(d)) bump(store, rec.installDay, 'ret' + d);
  return true;
}

/** Drops days older than ANALYTICS_KEEP_DAYS. */
export function pruneAnalytics(store: AnalyticsStore, today: string) {
  for (const d of Object.keys(store.days)) if (dayDiff(d, today) > ANALYTICS_KEEP_DAYS) delete store.days[d];
}

/** "$4.99" → {usd: 499 cents}; "۱۴۹٬۰۰۰ تومان" → {toman: 149000} */
export function parsePrice(s: string): { usd?: number; toman?: number } {
  const ascii = String(s).replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c)));
  if (ascii.includes('$')) return { usd: Math.round(parseFloat(ascii.replace(/[^0-9.]/g, '')) * 100) || 0 };
  const n = parseInt(ascii.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? { toman: n } : {};
}

export interface DayRow {
  day: string; dau: number; installs: number; matches: number; ads: number; sessions: number;
  revenueUsdCents: number; revenueToman: number;
  /** retention ratio (0..1) of this day's install cohort, null when not measurable yet */
  d1: number | null; d7: number | null; d30: number | null;
}

/** Table of the last `n` days (oldest first) for charts. */
export function analyticsSeries(store: AnalyticsStore, today: string, n = 30): DayRow[] {
  const rows: DayRow[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    const c = store.days[day] ?? {};
    const installs = c.installs ?? 0;
    const ret = (k: number) => (dayDiff(day, today) >= k && installs > 0 ? (c['ret' + k] ?? 0) / installs : null);
    rows.push({
      day, dau: c.dau ?? 0, installs, matches: c['ev:match_end'] ?? 0, ads: c.ads ?? 0, sessions: c['ev:session_start'] ?? 0,
      revenueUsdCents: c.rev_usd ?? 0, revenueToman: c.rev_toman ?? 0,
      d1: ret(1), d7: ret(7), d30: ret(30),
    });
  }
  return rows;
}

/** Sums prefixed counters over all stored days, e.g. 'iap:' → {gems_500: 12, …}. */
export function sumByPrefix(store: AnalyticsStore, prefix: string, sinceDay?: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [day, c] of Object.entries(store.days)) {
    if (sinceDay && day < sinceDay) continue;
    for (const [k, v] of Object.entries(c)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = (out[k.slice(prefix.length)] ?? 0) + v;
  }
  return out;
}

/** Weighted average retention over the cohorts that are old enough. */
export function retentionSummary(store: AnalyticsStore, today: string, window = 60): Record<'d1' | 'd7' | 'd30', number | null> {
  const out: Record<string, number | null> = {};
  for (const k of RETENTION_DAYS) {
    let inst = 0, ret = 0;
    for (let i = k; i < k + window; i++) {
      const c = store.days[addDays(today, -i)];
      if (!c?.installs) continue;
      inst += c.installs; ret += c['ret' + k] ?? 0;
    }
    out['d' + k] = inst ? ret / inst : null;
  }
  return out as Record<'d1' | 'd7' | 'd30', number | null>;
}
