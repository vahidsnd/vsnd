import {
  allyBreak, allyRequest, allyRespond, cardDonate, cardRequest, chatHistory, chatPost, clanCreate, clanDonateGems, clanEdit,
  clanJoin, clanKick, clanLeave, clanLeaderboard, clanOf, clanRespond, clanSearch, clanSetRole, clanSummary, clanUpgrade,
  clanUpgradeCost, dmThreads, featureUnlocked, isMuted, matchWars, moderate, policeView, promoCreate, promoToggle, redeemCode,
  reportPlayer, ROLE_RANK, setStaff, SocialError, staffRole, warCancel, warScore, warSearch, warTick, warVsBot,
  clanView as clanViewShared, type Clan, type FeatureId, type Profile,
} from '@nb/shared';
import { config } from './config.ts';
import { markDirty, socialCtx, socialDb, userById, type UserRec } from './db.ts';
import { deliverChat, isOnline, notifyClan, sendTo } from './sockets.ts';

export class HttpError extends Error { constructor(public code: number, msg: string) { super(msg); } }
export const need = (u: UserRec | null) => { if (!u) throw new HttpError(401, 'auth'); return u; };
type Handler = (body: any, user: UserRec | null) => Promise<unknown> | unknown;

function gate(p: Profile, f: FeatureId) {
  if (!config.unlockAll && !featureUnlocked(p, f)) throw new HttpError(403, 'locked');
}

/** Runs a social-engine call and maps its errors to HTTP 400 with the error code. */
function run<T>(fn: () => T): T {
  try { const out = fn(); markDirty(); return out; } catch (e) {
    if (e instanceof SocialError) throw new HttpError(400, e.code);
    throw e;
  }
}

const clanView = (c: Clan, viewer: string) => clanViewShared(socialDb(), c, viewer, isOnline);

const ctx = () => socialCtx();
const mine = (u: UserRec) => {
  const c = clanOf(socialDb(), u.profile.id);
  return { clan: c ? clanView(c, u.profile.id) : null, profile: u.profile };
};
const after = (u: UserRec) => {
  const c = clanOf(socialDb(), u.profile.id);
  if (c) notifyClan(c.id, 'clan');
  return mine(u);
};

export const socialRoutes: Record<string, Handler> = {
  // ---- clans ----
  'POST /api/clan/search': (b, u) => { need(u); return { clans: clanSearch(socialDb(), String(b.q ?? '')) }; },
  'GET /api/clan/mine': (_b, u) => mine(need(u)),
  'POST /api/clan/view': (b, u) => {
    need(u);
    const c = socialDb().clans[String(b.id)];
    if (!c) throw new HttpError(404, 'not-found');
    return { clan: clanView(c, u!.profile.id) };
  },
  'POST /api/clan/create': (b, u) => { const r = need(u); gate(r.profile, 'clans'); run(() => clanCreate(ctx(), r.profile, b)); return mine(r); },
  'POST /api/clan/join': (b, u) => {
    const r = need(u); gate(r.profile, 'clans');
    const res = run(() => clanJoin(ctx(), r.profile, String(b.id)));
    const c = socialDb().clans[String(b.id)];
    if (c) notifyClan(c.id, res === 'joined' ? 'clan' : 'request');
    return { result: res, ...mine(r) };
  },
  'POST /api/clan/leave': (_b, u) => {
    const r = need(u);
    const c = clanOf(socialDb(), r.profile.id);
    run(() => clanLeave(ctx(), r.profile));
    if (c) notifyClan(c.id, 'clan');
    return mine(r);
  },
  'POST /api/clan/respond': (b, u) => {
    const r = need(u);
    run(() => clanRespond(ctx(), r.profile, String(b.uid), !!b.accept));
    if (b.accept) { const t = userById(String(b.uid)); if (t) sendTo(t.profile.id, { t: 'profile', profile: t.profile }); }
    return after(r);
  },
  'POST /api/clan/kick': (b, u) => {
    const r = need(u);
    run(() => clanKick(ctx(), r.profile, String(b.uid)));
    const t = userById(String(b.uid)); if (t) sendTo(t.profile.id, { t: 'profile', profile: t.profile });
    return after(r);
  },
  'POST /api/clan/role': (b, u) => { const r = need(u); run(() => clanSetRole(ctx(), r.profile, String(b.uid), b.role)); return after(r); },
  'POST /api/clan/edit': (b, u) => { const r = need(u); run(() => clanEdit(ctx(), r.profile, b)); return after(r); },
  'POST /api/clan/donate': (b, u) => { const r = need(u); run(() => clanDonateGems(ctx(), r.profile, Number(b.amount))); return after(r); },
  'POST /api/clan/upgrade': (_b, u) => { const r = need(u); run(() => clanUpgrade(ctx(), r.profile)); return after(r); },
  'POST /api/clan/cards/request': (b, u) => { const r = need(u); run(() => cardRequest(ctx(), r.profile, String(b.fighter))); return after(r); },
  'POST /api/clan/cards/donate': (b, u) => {
    const r = need(u);
    const req = run(() => cardDonate(ctx(), r.profile, String(b.id)));
    const t = userById(req.uid); if (t) sendTo(t.profile.id, { t: 'profile', profile: t.profile });
    return after(r);
  },
  'POST /api/clan/ally/request': (b, u) => { const r = need(u); run(() => allyRequest(ctx(), r.profile, String(b.id))); notifyClan(String(b.id), 'ally'); return after(r); },
  'POST /api/clan/ally/respond': (b, u) => { const r = need(u); run(() => allyRespond(ctx(), r.profile, String(b.id), !!b.accept)); notifyClan(String(b.id), 'ally'); return after(r); },
  'POST /api/clan/ally/break': (b, u) => { const r = need(u); run(() => allyBreak(ctx(), r.profile, String(b.id))); notifyClan(String(b.id), 'ally'); return after(r); },
  'POST /api/clan/war/search': (_b, u) => { const r = need(u); gate(r.profile, 'clanwar'); run(() => warSearch(ctx(), r.profile)); return after(r); },
  'POST /api/clan/war/cancel': (_b, u) => { const r = need(u); run(() => warCancel(ctx(), r.profile)); return after(r); },
  'GET /api/clan/leaderboard': () => ({ top: clanLeaderboard(socialDb(), 50) }),

  // ---- chat ----
  'POST /api/chat/history': (b, u) => {
    const r = need(u); gate(r.profile, 'chat');
    return { msgs: chatHistory(socialDb(), r.profile.id, String(b.ch)), muted: isMuted(socialDb(), r.profile.id, Date.now()) ? socialDb().mutes[r.profile.id] : 0 };
  },
  'POST /api/chat/post': (b, u) => {
    const r = need(u); gate(r.profile, 'chat');
    const msgs = run(() => chatPost(ctx(), r.profile, String(b.ch), String(b.text ?? '')));
    deliverChat(msgs);
    return { msg: msgs[0] };
  },
  'GET /api/chat/dms': (_b, u) => ({ threads: dmThreads(socialDb(), need(u).profile.id) }),
  'POST /api/report': (b, u) => { const r = need(u); run(() => reportPlayer(ctx(), r.profile, b)); return { ok: true }; },

  // ---- game police (moderators / admins) ----
  'GET /api/police': (_b, u) => {
    const r = need(u);
    const v = run(() => policeView(ctx(), r.profile));
    const name = (id: string) => userById(id)?.profile.name ?? id;
    return { ...v, mutes: v.mutes.map((m) => ({ ...m, name: name(m.id) })), bans: v.bans.map((x) => ({ ...x, name: name(x.id) })), staff: v.staff.map((x) => ({ ...x, name: name(x.id) })) };
  },
  'POST /api/police/act': (b, u) => {
    const r = need(u);
    run(() => moderate(ctx(), r.profile, b));
    if (b.action === 'rename' || b.action === 'warn') { const t = userById(String(b.target)); if (t) sendTo(t.profile.id, { t: 'profile', profile: t.profile }); }
    return { ok: true };
  },
  'POST /api/police/staff': (b, u) => {
    const r = need(u);
    const target = String(b.target);
    if (!userById(target)) throw new HttpError(404, 'not-found');
    run(() => setStaff(ctx(), r.profile, target, b.role === 'mod' || b.role === 'admin' ? b.role : null));
    return { ok: true };
  },
  'POST /api/police/promo': (b, u) => { const r = need(u); return { promo: run(() => promoCreate(ctx(), r.profile, b)) }; },
  'POST /api/police/promo/toggle': (b, u) => { const r = need(u); return { promo: run(() => promoToggle(ctx(), r.profile, String(b.code), !!b.off)) }; },
  'POST /api/police/lookup': (b, u) => {
    const r = need(u);
    if (!staffRole(socialDb(), r.profile.id)) throw new HttpError(403, 'perm');
    const t = userById(String(b.id));
    if (!t) throw new HttpError(404, 'not-found');
    const p = t.profile;
    return { user: { id: p.id, name: p.name, level: p.level, mmr: p.rank.mmr, matches: p.stats.matches, created: p.createdAt, clan: p.clan, muted: socialDb().mutes[p.id] ?? 0, banned: socialDb().bans[p.id] ?? null, warns: socialDb().warns[p.id] ?? 0 } };
  },

  // ---- promo codes ----
  'POST /api/redeem': (b, u) => { const r = need(u); const g = run(() => redeemCode(ctx(), r.profile, String(b.code))); return { granted: g, profile: r.profile }; },

  // ---- console admin (server operator, header x-admin-key) ----
  'POST /api/admin/staff': (b) => {
    run(() => setStaff(ctx(), null, String(b.target), b.role === 'mod' || b.role === 'admin' ? b.role : null));
    return { ok: true };
  },
  'POST /api/admin/promo': (b) => ({ promo: run(() => promoCreate(ctx(), null, b)) }),
};

/** Periodic: resolve wars, pair searching clans, give long-waiting clans a computer rival. */
const searchingSince = new Map<string, number>();
export function socialTick() {
  const c = ctx();
  matchWars(c);
  for (const id of c.db.warQueue) {
    if (!searchingSince.has(id)) searchingSince.set(id, c.now);
    if (c.now - searchingSince.get(id)! > config.warBotAfterMs) { warVsBot(c, id); searchingSince.delete(id); notifyClan(id, 'clan'); }
  }
  for (const id of [...searchingSince.keys()]) if (!c.db.warQueue.includes(id)) searchingSince.delete(id);
  const before = Object.values(c.db.clans).filter((x) => x.war).length;
  warTick(c);
  if (Object.values(c.db.clans).filter((x) => x.war).length !== before) markDirty();
  markDirty();
}
