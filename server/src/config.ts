export const config = {
  port: Number(process.env.PORT ?? 8787),
  dataDir: process.env.DATA_DIR ?? new URL('../data/', import.meta.url).pathname,
  // PostgreSQL connection string; when set it replaces the JSON file storage
  databaseUrl: process.env.DATABASE_URL ?? '',
  // write-behind interval for the storage adapter
  flushMs: Number(process.env.FLUSH_MS ?? 5000),
  // spectators: max per match and broadcast delay (anti-ghosting in clan wars)
  spectate: { max: Number(process.env.SPECTATE_MAX ?? 20), delayMs: Number(process.env.SPECTATE_DELAY_MS ?? 3000) },
  // online replays kept per player
  replaysPerUser: Number(process.env.REPLAYS_PER_USER ?? 50),
  // allow unverified "sandbox" purchases (web build / local testing). NEVER enable in production.
  iapSandbox: process.env.IAP_SANDBOX === '1' || process.env.NODE_ENV !== 'production',
  googlePlay: {
    packageName: process.env.GP_PACKAGE ?? 'ir.neonbrawl.game',
    // service-account JSON (stringified) with access to the Play Developer API
    serviceAccount: process.env.GP_SERVICE_ACCOUNT ?? '',
  },
  myket: {
    packageName: process.env.MYKET_PACKAGE ?? 'ir.neonbrawl.game',
    accessToken: process.env.MYKET_ACCESS_TOKEN ?? '',
  },
  matchmaking: {
    botFillAfterMs: { casual: 15000, ranked: 30000, event: Number(process.env.EVENT_BOT_AFTER_MS ?? 15000) } as Record<string, number>,
    mmrWindowStart: 100,
    mmrWindowGrowPerSec: 15,
  },
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  // operator key for /api/admin/* (create the first admin / promo codes from a terminal). Empty = disabled.
  adminKey: process.env.ADMIN_KEY ?? '',
  // skip feature gating (world map) — for local testing only
  unlockAll: process.env.UNLOCK_ALL === '1',
  // a clan searching for war this long gets a computer-run rival
  warBotAfterMs: Number(process.env.WAR_BOT_AFTER_MS ?? 5 * 60_000),
  // weekend tournament (modes.ts): TOURNEY_TEST=1 keeps sign-ups open until /api/admin/tourney/start
  tourneyTest: process.env.TOURNEY_TEST === '1',
  tourneyRoundMs: Number(process.env.TOURNEY_ROUND_MS ?? 30 * 60_000),
};
