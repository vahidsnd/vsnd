import {
  activeOffers, buyCosmetic, buyDeal, buySmartOffer, checkSmartOffers, claimMastery, claimVipDaily, dailyDeals, equipCosmetic,
  markOfferShown, syncCosmetics, type CosKind,
} from '@nb/shared';
import { HttpError, need } from './social.ts';
import { markDirty, type UserRec } from './db.ts';

type Handler = (body: any, user: UserRec | null) => Promise<unknown> | unknown;
const KINDS: CosKind[] = ['emote', 'frame', 'title', 'pose'];
const kind = (k: unknown): CosKind => { if (!KINDS.includes(k as CosKind)) throw new HttpError(400, 'kind'); return k as CosKind; };

/** Live-ops routes: daily deals, smart offers, VIP, cosmetics, fighter mastery. */
export const liveopsRoutes: Record<string, Handler> = {
  'POST /api/deals/state': (_b, u) => { const p = need(u).profile; const deals = dailyDeals(p); markDirty(); return { deals, profile: p }; },
  'POST /api/deals/buy': (b, u) => { const p = need(u).profile; const result = buyDeal(p, Number(b.idx)); markDirty(); return { result, profile: p }; },
  'POST /api/offers/check': (b, u) => {
    const p = need(u).profile;
    if (typeof b.seen === 'string') markOfferShown(p, b.seen);
    const created = checkSmartOffers(p);
    markDirty();
    return { created, active: activeOffers(p), profile: p };
  },
  'POST /api/offers/buy': (b, u) => { const p = need(u).profile; const result = buySmartOffer(p, String(b.id)); markDirty(); return { result, profile: p }; },
  'POST /api/vip/claim': (_b, u) => { const p = need(u).profile; const result = claimVipDaily(p); markDirty(); return { result, profile: p }; },
  'POST /api/cos/sync': (_b, u) => { const p = need(u).profile; const added = syncCosmetics(p); markDirty(); return { added: added.map((c) => `${c.kind}:${c.id}`), profile: p }; },
  'POST /api/cos/buy': (b, u) => { const p = need(u).profile; const result = buyCosmetic(p, kind(b.kind), String(b.id)); markDirty(); return { result, profile: p }; },
  'POST /api/cos/equip': (b, u) => {
    const p = need(u).profile;
    const ok = equipCosmetic(p, kind(b.kind), String(b.id ?? ''), { slot: b.slot === undefined ? undefined : Number(b.slot), fighter: b.fighter ? String(b.fighter) : undefined });
    markDirty();
    return { ok, profile: p };
  },
  'POST /api/mastery/claim': (b, u) => { const p = need(u).profile; const result = claimMastery(p, String(b.fighter)); markDirty(); return { result, profile: p }; },
};
