import fs from 'node:fs';
import type http from 'node:http';
import {
  analyticsSeries, cleanReward, dayKey, addDays, IAP_PRODUCTS, remoteConfig, rewardEmpty, retentionSummary, sendMail, sumByPrefix, DEFAULT_REMOTE_CONFIG,
} from '@nb/shared';
import { config } from './config.ts';
import { allUsers, analyticsStore, dbMeta, leaderboard, markDirty, socialDb, storage, userById, type UserRec } from './db.ts';
import { activeMatches } from './match.ts';
import { queueSizes } from './matchmaker.ts';
import { socketsByUser, sendTo } from './sockets.ts';
import { spectatorCount } from './spectate.ts';
import { setRemoteOverrides } from './analytics.ts';
import { HttpError } from './social.ts';

type Handler = (body: any, user: UserRec | null) => Promise<unknown> | unknown;

/**
 * Operator panel API (all under /api/admin/, header x-admin-key = ADMIN_KEY, checked in api.ts).
 */
export const adminRoutes: Record<string, Handler> = {
  'GET /api/admin/stats': () => {
    const store = analyticsStore();
    const today = dayKey(Date.now());
    const db = socialDb();
    const users = allUsers();
    const prices = Object.fromEntries(IAP_PRODUCTS.map((p) => [p.id, p.price]));
    return {
      now: Date.now(), today, storage: storage().kind,
      live: { online: socketsByUser.size, matches: activeMatches.size, queues: queueSizes(), spectators: spectatorCount(), users: users.length },
      series: analyticsSeries(store, today, 30),
      retention: retentionSummary(store, today),
      revenue: { byProduct: sumByPrefix(store, 'iap:'), byMarket: sumByPrefix(store, 'iapm:'), totals: sumByPrefix(store, 'rev_'), last30: sumByPrefix(store, 'rev_', addDays(today, -29)), prices },
      ads: { total: sumByPrefix(store, 'ads')[''] ?? 0, last30: sumByPrefix(store, 'ads', addDays(today, -29))[''] ?? 0 },
      events: sumByPrefix(store, 'ev:', addDays(today, -6)),
      topPlayers: leaderboard(15),
      flagged: Object.entries(db.cheats ?? {}).filter(([, c]) => c.score > 0).sort((a, b) => b[1].score - a[1].score).slice(0, 30)
        .map(([id, c]) => ({ id, name: userById(id)?.profile.name ?? c.name, score: Math.round(c.score * 10) / 10, at: c.at, flags: c.flags.slice(-3), banned: !!db.bans[id] })),
      reports: db.reports.slice(-30).reverse(),
      promos: Object.values(db.promos).sort((a, b) => b.created - a.created).slice(0, 50),
      config: remoteConfig(), overrides: dbMeta().remoteConfig ?? {}, defaults: DEFAULT_REMOTE_CONFIG,
      broadcasts: (dbMeta().broadcasts ?? []).slice(0, 20),
    };
  },
  'POST /api/admin/config': (b) => setRemoteOverrides(b?.overrides ?? b),
  'POST /api/admin/promo/toggle': (b) => {
    const pr = socialDb().promos[String(b.code ?? '').toUpperCase()];
    if (!pr) throw new HttpError(404, 'not-found');
    pr.off = !!b.off; markDirty();
    return { promo: pr };
  },
  /** in-game mail to every player (optionally with a reward and a minimum level) */
  'POST /api/admin/mail': (b) => {
    const title = String(b.title ?? '').slice(0, 80), titleFa = String(b.titleFa ?? '').slice(0, 80);
    if (!title && !titleFa) throw new HttpError(400, 'title');
    const reward = b.reward ? cleanReward(b.reward) : undefined;
    const minLevel = Math.max(0, Number(b.minLevel) || 0);
    const now = Date.now();
    let n = 0;
    for (const u of allUsers()) {
      if (u.banned || u.profile.level < minLevel) continue;
      sendMail(u.profile, { title: title || titleFa, titleFa: titleFa || title, body: String(b.body ?? '').slice(0, 500), bodyFa: String(b.bodyFa ?? b.body ?? '').slice(0, 500), reward: reward && !rewardEmpty(reward) ? reward : undefined }, now);
      sendTo(u.profile.id, { t: 'profile', profile: u.profile });
      n++;
    }
    const meta = dbMeta();
    (meta.broadcasts ??= []).unshift({ t: now, title: title || titleFa, recipients: n, reward });
    meta.broadcasts.length = Math.min(meta.broadcasts.length, 50);
    markDirty();
    return { recipients: n };
  },
};

let page = '';
/** GET /admin → the single-page operator panel (inline JS/CSS; login with ADMIN_KEY). */
export function serveAdminPage(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const p = (req.url ?? '').split('?')[0];
  if (req.method !== 'GET' || (p !== '/admin' && p !== '/admin/')) return false;
  if (!config.adminKey) { res.writeHead(404, { 'content-type': 'text/plain' }).end('admin panel disabled (set ADMIN_KEY)'); return true; }
  page ||= fs.readFileSync(new URL('./admin-page.html', import.meta.url), 'utf8');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' }).end(page);
  return true;
}
