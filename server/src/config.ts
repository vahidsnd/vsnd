export const config = {
  port: Number(process.env.PORT ?? 8787),
  dataDir: process.env.DATA_DIR ?? new URL('../data/', import.meta.url).pathname,
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
    botFillAfterMs: { casual: 15000, ranked: 30000 },
    mmrWindowStart: 100,
    mmrWindowGrowPerSec: 15,
  },
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
};
