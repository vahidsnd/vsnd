// =============================================================================================
//  Remote config: operator-tunable knobs (economy multipliers, event toggles, feature flags,
//  message of the day). The server stores overrides; clients fetch the merged config at boot and
//  cache it for offline play. Shared economy code reads it through remoteConfig().
// =============================================================================================

export interface Motd { fa: string; en: string; kind: 'info' | 'event' | 'warn'; until: number /* ms epoch, 0 = no expiry */ }

export interface RemoteConfig {
  /** bumped on every save (ms epoch) so clients can tell configs apart */
  version: number;
  economy: {
    matchCoinMult: number;   // coins from every match
    matchXpMult: number;     // XP from every match
    cratePriceMult: number;  // gem price of a shop crate
    adCoinMult: number;      // coins from the "watch ad for coins" placement
    wheelRewards: boolean;   // lucky wheel on/off
  };
  events: {
    doubleCoins: boolean;    // event: x2 match coins on top of the multiplier
    clanWars: boolean;       // clan wars searchable
    raids: boolean;          // clan attacks can be declared
  };
  flags: {
    replays: boolean;
    spectate: boolean;
    analytics: boolean;
    liveList: boolean;
  };
  motd: Motd | null;
}

export const DEFAULT_REMOTE_CONFIG: RemoteConfig = {
  version: 0,
  economy: { matchCoinMult: 1, matchXpMult: 1, cratePriceMult: 1, adCoinMult: 1, wheelRewards: true },
  events: { doubleCoins: false, clanWars: true, raids: true },
  flags: { replays: true, spectate: true, analytics: true, liveList: true },
  motd: null,
};

/** allowed numeric ranges */
const RANGES: Record<string, [number, number]> = {
  'economy.matchCoinMult': [0, 10], 'economy.matchXpMult': [0, 10], 'economy.cratePriceMult': [0.1, 10], 'economy.adCoinMult': [0, 10],
};

export type RemoteConfigPatch = { [K in keyof RemoteConfig]?: K extends 'motd' ? Partial<Motd> | null : K extends 'version' ? number : Partial<RemoteConfig[K]> };

/**
 * Validates an untrusted override object. Unknown keys and wrong types are dropped with an error
 * message; numbers are clamped to their allowed range. Returns only the valid part.
 */
export function validateRemoteConfig(input: unknown): { patch: RemoteConfigPatch; errors: string[] } {
  const errors: string[] = [];
  const patch: RemoteConfigPatch = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { patch, errors: ['not-an-object'] };
  const src = input as Record<string, unknown>;
  for (const [k, v] of Object.entries(src)) {
    if (k === 'version') continue;
    if (k === 'motd') {
      if (v === null) { patch.motd = null; continue; }
      if (!v || typeof v !== 'object') { errors.push('motd: object or null'); continue; }
      const m = v as Record<string, unknown>;
      const out: Partial<Motd> = {};
      for (const lang of ['fa', 'en'] as const) {
        if (m[lang] === undefined) continue;
        if (typeof m[lang] !== 'string') { errors.push(`motd.${lang}: string`); continue; }
        out[lang] = (m[lang] as string).slice(0, 280);
      }
      if (m.kind !== undefined) { if (m.kind === 'info' || m.kind === 'event' || m.kind === 'warn') out.kind = m.kind; else errors.push('motd.kind: info|event|warn'); }
      if (m.until !== undefined) { const n = Number(m.until); if (Number.isFinite(n) && n >= 0) out.until = n; else errors.push('motd.until: number'); }
      for (const extra of Object.keys(m)) if (!['fa', 'en', 'kind', 'until'].includes(extra)) errors.push(`motd.${extra}: unknown`);
      patch.motd = out;
      continue;
    }
    const group = (DEFAULT_REMOTE_CONFIG as unknown as Record<string, unknown>)[k];
    if (!group || typeof group !== 'object') { errors.push(`${k}: unknown`); continue; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) { errors.push(`${k}: object`); continue; }
    const out: Record<string, unknown> = {};
    for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) {
      const def = (group as Record<string, unknown>)[kk];
      const path = `${k}.${kk}`;
      if (def === undefined) { errors.push(`${path}: unknown`); continue; }
      if (typeof def === 'boolean') {
        if (typeof vv === 'boolean') out[kk] = vv; else errors.push(`${path}: boolean`);
      } else if (typeof def === 'number') {
        const n = typeof vv === 'string' && vv.trim() !== '' ? Number(vv) : vv;
        if (typeof n !== 'number' || !Number.isFinite(n)) { errors.push(`${path}: number`); continue; }
        const [lo, hi] = RANGES[path] ?? [-Infinity, Infinity];
        if (n < lo || n > hi) errors.push(`${path}: clamped to ${lo}..${hi}`);
        out[kk] = Math.max(lo, Math.min(hi, n));
      }
    }
    (patch as Record<string, unknown>)[k] = out;
  }
  return { patch, errors };
}

/** Deep-merges validated overrides onto a base config (defaults by default). */
export function mergeRemoteConfig(overrides: unknown, base: RemoteConfig = DEFAULT_REMOTE_CONFIG): RemoteConfig {
  const { patch } = validateRemoteConfig(overrides);
  const out: RemoteConfig = structuredClone(base);
  for (const k of ['economy', 'events', 'flags'] as const) if (patch[k]) Object.assign(out[k], patch[k]);
  if (patch.motd === null) out.motd = null;
  else if (patch.motd) {
    const m = { ...(out.motd ?? { fa: '', en: '', kind: 'info' as const, until: 0 }), ...patch.motd };
    out.motd = m.fa || m.en ? m : null;
  }
  const v = Number((overrides as { version?: unknown } | null)?.version);
  if (Number.isFinite(v) && v > 0) out.version = v;
  return out;
}

// ---- the live config (one per process / app) -------------------------------------------------
let current: RemoteConfig = structuredClone(DEFAULT_REMOTE_CONFIG);
export function remoteConfig(): RemoteConfig { return current; }
export function setRemoteConfig(c: RemoteConfig) { current = c; }

/** Coin multiplier applied to match rewards (includes the double-coins event). */
export function matchCoinMultiplier(c: RemoteConfig = current) {
  return c.economy.matchCoinMult * (c.events.doubleCoins ? 2 : 1);
}

/** The message of the day if one is set and not expired. */
export function activeMotd(now: number, c: RemoteConfig = current): Motd | null {
  const m = c.motd;
  if (!m || (!m.fa && !m.en)) return null;
  if (m.until && now > m.until) return null;
  return m;
}
