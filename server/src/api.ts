import type http from 'node:http';
import {
  applyMatch, buyItem, claimAchievement, completeTutorial, claimFreeCrate, claimLogin, claimPass, claimQuest, doubleLastReward, getFighter,
  grantIap, IAP_PRODUCTS, MAX_REWARDED_ADS_PER_DAY, rerollQuest, dayKey, type MatchSummary,
  claimLeague, claimMail, claimMilestone, claimStarChest, clearMapNode, equipSpell, learnSpell, spinWheel, upgradeSpell, upgradeStat,
  collectDonations, MAP_SIZE, checkSummary, flagCheat, rewardsWithheld, RateLimiter, remoteConfig,
} from '@nb/shared';
import { HttpError, need, socialRoutes } from './social.ts';
import { liveopsRoutes } from './liveops.ts';
import { modeRoutes } from './modes.ts';
import { socialCtx } from './db.ts';
import { config } from './config.ts';
import { winsLeaderboard, createGuest, isPurchaseTokenUsed, leaderboard, markDirty, markPurchaseToken, sanitizeName, userByToken, type UserRec } from './db.ts';
import { verifyGooglePlay } from './billing/googleplay.ts';
import { verifyMyket } from './billing/myket.ts';
import { accountRoutes } from './accounts.ts';
import { replayRoutes } from './replays.ts';
import { spectateRoutes } from './spectate.ts';
import { adminRoutes } from './admin.ts';
import { analyticsRoutes, track, trackPurchase } from './analytics.ts';

type Handler = (body: any, user: UserRec | null, req: http.IncomingMessage) => Promise<unknown> | unknown;
const apiLimit = new RateLimiter(180), redeemLimit = new RateLimiter(6), reportLimit = new RateLimiter(10);

const routes: Record<string, Handler> = {
  'POST /api/guest': (b) => {
    const u = createGuest(b?.name);
    return { token: u.token, profile: u.profile };
  },
  'GET /api/profile': (_b, u) => ({ profile: need(u).profile }),
  'POST /api/profile': (b, u) => {
    const p = need(u).profile;
    if (typeof b.name === 'string' && sanitizeName(b.name)) p.name = sanitizeName(b.name);
    if (typeof b.selFighter === 'string' && p.fighters.includes(b.selFighter)) p.selFighter = b.selFighter;
    if (b.selSkin && typeof b.selSkin.fighter === 'string') {
      const f = getFighter(b.selSkin.fighter);
      const idx = Number(b.selSkin.idx);
      if (idx === 0 || p.skins.includes(f.skins[idx]?.id)) p.selSkin[f.id] = idx;
    }
    if (b.settings && typeof b.settings === 'object') {
      const s = b.settings;
      if (s.lang === 'fa' || s.lang === 'en') p.settings.lang = s.lang;
      if (typeof s.sfx === 'boolean') p.settings.sfx = s.sfx;
      if (typeof s.music === 'boolean') p.settings.music = s.music;
      if (s.controls === 'buttons' || s.controls === 'gestures') p.settings.controls = s.controls;
    }
    markDirty();
    return { profile: p };
  },
  'POST /api/login/claim': (_b, u) => {
    const p = need(u).profile;
    const r = claimLogin(p);
    markDirty();
    return { reward: r, profile: p };
  },
  'POST /api/quest/claim': (b, u) => {
    const p = need(u).profile;
    const q = claimQuest(p, Number(b.idx));
    markDirty();
    return { quest: q, profile: p };
  },
  'POST /api/quest/reroll': (b, u) => {
    const rec = need(u);
    const p = rec.profile;
    if (p.daily.rerolls > 0) p.daily.rerolls--;
    else if (!b.viaAd || !takeAd(rec)) throw new HttpError(400, 'no-rerolls');
    rerollQuest(p, Number(b.idx));
    markDirty();
    return { profile: p };
  },
  'POST /api/shop/buy': (b, u) => {
    const p = need(u).profile;
    const r = buyItem(p, String(b.itemId));
    markDirty();
    return { result: r, profile: p };
  },
  'POST /api/crate/free': (_b, u) => {
    const rec = need(u);
    if (!takeAd(rec)) throw new HttpError(429, 'ad-limit');
    const crate = claimFreeCrate(rec.profile);
    markDirty();
    return { crate, profile: rec.profile };
  },
  'POST /api/pass/claim': (b, u) => {
    const p = need(u).profile;
    const r = claimPass(p, Number(b.tier), !!b.premium);
    markDirty();
    return { result: r, profile: p };
  },
  'POST /api/ad/reward': (b, u) => {
    const rec = need(u);
    const p = rec.profile;
    if (!takeAd(rec)) throw new HttpError(429, 'ad-limit');
    let granted = 0;
    if (b.placement === 'double') granted = doubleLastReward(p, String(b.matchId));
    else if (b.placement === 'coins') { granted = Math.round(60 * remoteConfig().economy.adCoinMult); p.coins += granted; }
    markDirty();
    return { granted, profile: p };
  },
  'POST /api/iap/verify': async (b, u) => {
    const rec = need(u);
    const productId = String(b.productId);
    const token = String(b.purchaseToken ?? '');
    const market = String(b.market);
    if (!IAP_PRODUCTS.some((p) => p.id === productId)) throw new HttpError(400, 'unknown-product');
    if (!token) throw new HttpError(400, 'no-token');
    if (isPurchaseTokenUsed(token)) return { ok: true, duplicate: true, profile: rec.profile };
    let v: { ok: boolean; reason?: string };
    if (market === 'googleplay') v = await verifyGooglePlay(productId, token);
    else if (market === 'myket') v = await verifyMyket(productId, token);
    else v = { ok: false, reason: 'market' };
    if (!v.ok && config.iapSandbox && token.startsWith('sandbox-')) v = { ok: true };
    if (!v.ok) throw new HttpError(402, 'verify-failed:' + v.reason);
    markPurchaseToken(token, rec.profile.id);
    grantIap(rec.profile, productId);
    trackPurchase(productId, market);
    markDirty();
    return { ok: true, profile: rec.profile };
  },
  'POST /api/match/offline': (b, u) => {
    // CPU / world-map matches played offline; rewards are reduced by the mode multiplier and capped per day
    const rec = need(u);
    const p = rec.profile;
    const s = b.summary as MatchSummary;
    if (!s || (s.mode !== 'cpu' && s.mode !== 'map')) throw new HttpError(400, 'bad-summary');
    const today = dayKey(Date.now());
    if (!rec.cpu || rec.cpu.day !== today) rec.cpu = { day: today, count: 0 };
    rec.recent = (rec.recent ?? []).filter((t) => Date.now() - t < 3600_000);
    rec.recent.push(Date.now());
    const clean: MatchSummary = {
      matchId: String(s.matchId).slice(0, 40), mode: s.mode, won: !!s.won,
      placement: clamp(s.placement, 1, 4), players: clamp(s.players, 2, 4),
      kos: clamp(s.kos, 0, 12), falls: clamp(s.falls, 0, 12), dmg: clamp(s.dmg, 0, 2000),
      smashKOs: clamp(s.smashKOs, 0, 12), maxCombo: clamp(s.maxCombo, 0, 20),
      fighter: String(s.fighter), durationSec: clamp(s.durationSec, 0, 900),
    };
    // anti-cheat: plausibility of the reported result
    const sc = socialCtx();
    const chk = checkSummary(clean, { foes: Math.max(1, clean.players - 1), stocks: 3, recentPerHour: rec.recent.length });
    if (chk.pts) flagCheat(sc, p, 'offline', chk.reasons.join('; '), chk.pts);
    if (rewardsWithheld(sc, p)) { markDirty(); return { reward: null, map: null, withheld: true, profile: p }; }
    // map progress is never capped (it's finite); only the per-match coins are
    const map = s.mode === 'map' && Number.isInteger(b.node) && b.node >= 0 && b.node < MAP_SIZE
      ? clearMapNode(p, b.node, clean.won, clean.falls) : null;
    if (rec.cpu.count >= 40) { markDirty(); return { reward: null, map, profile: p }; }
    rec.cpu.count++;
    const reward = applyMatch(p, clean);
    markDirty();
    return { reward, map, profile: p };
  },
  'POST /api/map/chest': (b, u) => { const p = need(u).profile; const g = claimStarChest(p, Number(b.idx)); markDirty(); return { granted: g, profile: p }; },
  'POST /api/milestone/claim': (b, u) => { const p = need(u).profile; const g = claimMilestone(p, Number(b.idx)); markDirty(); return { granted: g, profile: p }; },
  'POST /api/fighter/upgrade': (b, u) => { const p = need(u).profile; const ok = upgradeStat(p, String(b.fighter), b.stat); markDirty(); return { ok, profile: p }; },
  'POST /api/spell/learn': (b, u) => { const p = need(u).profile; const ok = learnSpell(p, String(b.id)); markDirty(); return { ok, profile: p }; },
  'POST /api/spell/upgrade': (b, u) => { const p = need(u).profile; const ok = upgradeSpell(p, String(b.id)); markDirty(); return { ok, profile: p }; },
  'POST /api/spell/equip': (b, u) => { const p = need(u).profile; const ok = equipSpell(p, String(b.fighter), b.id ? String(b.id) : null); markDirty(); return { ok, profile: p }; },
  'POST /api/league/claim': (b, u) => { const p = need(u).profile; const g = claimLeague(p, String(b.key)); markDirty(); return { granted: g, profile: p }; },
  'POST /api/mail/claim': (b, u) => { const p = need(u).profile; const g = claimMail(p, String(b.id)); markDirty(); return { granted: g, profile: p }; },
  'POST /api/wheel/spin': (b, u) => {
    const rec = need(u);
    if (b.viaAd && !takeAd(rec)) throw new HttpError(429, 'ad-limit');
    const r = spinWheel(rec.profile, dayKey(Date.now()), !!b.viaAd);
    markDirty();
    return { result: r, profile: rec.profile };
  },
  'POST /api/clan/cards/collect': (_b, u) => { const p = need(u).profile; const n = collectDonations(socialCtx(), p); markDirty(); return { n, profile: p }; },
  'POST /api/ach/claim': (b, u) => {
    const p = need(u).profile;
    const a = claimAchievement(p, String(b.id));
    markDirty();
    return { achievement: a ? { id: a.id, reward: a.reward } : null, profile: p };
  },
  'POST /api/tutorial/done': (b, u) => {
    const p = need(u).profile;
    const reward = completeTutorial(p, String(b.id));
    markDirty();
    return { reward, profile: p };
  },
  'GET /api/leaderboard': () => ({ top: leaderboard(100) }),
  'GET /api/leaderboard/wins': () => ({ top: winsLeaderboard(100) }),
  'GET /api/health': () => ({ ok: true }),
  ...socialRoutes,
  ...liveopsRoutes,
  ...accountRoutes,
  ...replayRoutes,
  ...spectateRoutes,
  ...analyticsRoutes,
  ...adminRoutes,
  ...modeRoutes,
};

function clamp(v: unknown, lo: number, hi: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
}

function takeAd(rec: UserRec): boolean {
  const today = dayKey(Date.now());
  if (rec.ads.day !== today) rec.ads = { day: today, count: 0 };
  if (rec.ads.count >= MAX_REWARDED_ADS_PER_DAY) return false;
  rec.ads.count++;
  track('ads');
  rec.profile.daily.ads = rec.ads.count;
  return true;
}

export async function handleApi(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://x');
  res.setHeader('access-control-allow-origin', config.corsOrigin);
  res.setHeader('access-control-allow-headers', 'content-type, authorization, x-admin-key');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return true; }
  const handler = routes[`${req.method} ${url.pathname}`];
  if (!handler) return false;
  try {
    // flood protection per player (or per IP before login)
    const who = (req.headers.authorization ?? '').slice(-24) || req.socket.remoteAddress || '?';
    const strict = url.pathname === '/api/redeem' ? redeemLimit : url.pathname === '/api/report' ? reportLimit : null;
    if (!apiLimit.take(who) || (strict && !strict.take(who))) throw new HttpError(429, 'rate');
    if (url.pathname.startsWith('/api/admin/') && (!config.adminKey || req.headers['x-admin-key'] !== config.adminKey)) throw new HttpError(403, 'admin');
    const body = req.method === 'POST' ? await readJson(req) : {};
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const out = await handler(body, userByToken(token), req);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
  } catch (e) {
    const code = e instanceof HttpError ? e.code : 500;
    if (code === 500) console.error(e);
    res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (e as Error).message }));
  }
  return true;
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 64_000) { reject(new HttpError(413, 'too-large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new HttpError(400, 'bad-json')); } });
    req.on('error', reject);
  });
}
