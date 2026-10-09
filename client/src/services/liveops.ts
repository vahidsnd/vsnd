import {
  buyCosmetic, buyDeal, buySmartOffer, checkSmartOffers, claimMastery, claimVipDaily, dailyDeals, equipCosmetic, markOfferShown, syncCosmetics,
  type CosBuyResult, type CosKind, type DealResult, type DealsState, type Granted, type OfferBuyResult, type SmartOffer,
} from '@nb/shared';
import { backend } from './backend.ts';

/**
 * Live-ops calls: the server runs the shared rules online; offline the very same
 * functions run against the local profile (see backend.run).
 */
export const liveops = {
  deals: () => backend.run('/api/deals/state', {}, (p) => dailyDeals(p), (j) => j.deals as DealsState),
  buyDeal: (idx: number) => backend.run('/api/deals/buy', { idx }, (p) => buyDeal(p, idx), (j) => j.result as DealResult),
  /** evaluates smart-offer triggers; `seen` marks an offer's popup as shown */
  checkOffers: (seen?: string) => backend.run('/api/offers/check', { seen }, (p) => { if (seen) markOfferShown(p, seen); return checkSmartOffers(p); }, (j) => j.created as SmartOffer | null),
  buyOffer: (id: string) => backend.run('/api/offers/buy', { id }, (p) => buySmartOffer(p, id), (j) => j.result as OfferBuyResult),
  vipClaim: () => backend.run('/api/vip/claim', {}, (p) => claimVipDaily(p), (j) => j.result as { gems: number } | null),
  cosSync: () => backend.run('/api/cos/sync', {}, (p) => syncCosmetics(p).map((c) => `${c.kind}:${c.id}`), (j) => j.added as string[]),
  cosBuy: (kind: CosKind, id: string) => backend.run('/api/cos/buy', { kind, id }, (p) => buyCosmetic(p, kind, id), (j) => j.result as CosBuyResult),
  cosEquip: (kind: CosKind, id: string, opts: { slot?: number; fighter?: string } = {}) =>
    backend.run('/api/cos/equip', { kind, id, ...opts }, (p) => equipCosmetic(p, kind, id, opts), (j) => !!j.ok),
  masteryClaim: (fighter: string) => backend.run('/api/mastery/claim', { fighter }, (p) => claimMastery(p, fighter), (j) => j.result as { levels: number[]; granted: Granted; titles: string[]; frames: string[] } | null),
};
