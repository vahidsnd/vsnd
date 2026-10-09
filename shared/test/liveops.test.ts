import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newProfile, applyMatch, grantIap, dayKey, migrateProfile, spinWheel, wheelState, IAP_PRODUCTS, FIGHTERS,
  dailyDeals, buyDeal, seededRand, nextDayAt,
  checkSmartOffers, activeOffers, buySmartOffer, markOfferShown, SMART_OFFERS,
  vipActive, vipDaysLeft, claimVipDaily, grantVip, VIP_DAILY_GEMS, adsRemoved,
  cosOwned, buyCosmetic, equipCosmetic, emoteLoadout, ownsEmoteNet, equippedFrame, equippedTitle, poseFor, syncCosmetics, publicBadges, EMOTE_SLOTS,
  masteryLevel, masteryInfo, claimMastery, addMasteryXp, MASTERY_XP, MASTERY_MAX, masteryReward, noteRaidStars,
  type MatchSummary, type Profile,
} from '../src/index.ts';

const DAY = 86400_000;
const T0 = Date.UTC(2026, 9, 9, 12, 0);
const rich = (id = 'u_test', now = T0): Profile => { const p = newProfile(id, 'Tester', now); p.coins = 1e6; p.gems = 1e5; p.runes = 0; return p; };
const match = (won: boolean, extra: Partial<MatchSummary> = {}): MatchSummary => ({
  matchId: 'm' + Math.random(), mode: 'cpu', won, placement: won ? 1 : 2, players: 2, kos: won ? 3 : 1, falls: won ? 0 : 3,
  dmg: 200, smashKOs: 0, maxCombo: 3, fighter: 'blaze', durationSec: 90, ...extra,
});

// ---------------------------------------------------------------------------------------------
test('daily deals: deterministic per day + player, 4–6 offers, stable after purchases', () => {
  const a = rich('u_aaa'), b = rich('u_aaa'), c = rich('u_bbb');
  const da = dailyDeals(a, T0), db = dailyDeals(b, T0);
  assert.deepEqual(da.list, db.list, 'same player + day → same deals (server == client)');
  assert.ok(da.list.length >= 4 && da.list.length <= 6, `deal count ${da.list.length}`);
  for (const d of da.list) {
    assert.ok(d.off >= 20 && d.off <= 50, 'discount in range');
    const cost = d.cost.coins ?? d.cost.gems ?? 0, was = d.was.coins ?? d.was.gems ?? 0;
    assert.ok(cost > 0 && cost < was, 'discounted price');
  }
  // another player or another day → (almost surely) different set
  const dc = dailyDeals(c, T0);
  const next = dailyDeals(rich('u_aaa'), T0 + DAY);
  assert.notDeepEqual(JSON.stringify(dc.list), JSON.stringify(da.list));
  assert.notDeepEqual(JSON.stringify(next.list), JSON.stringify(da.list));
  // rng itself is deterministic
  const r1 = seededRand('x'), r2 = seededRand('x');
  assert.equal(r1(), r2());
  // stable within the day even after buying
  const before = JSON.stringify(da.list);
  assert.ok(buyDeal(a, 0, T0 + 1000).ok);
  assert.equal(JSON.stringify(dailyDeals(a, T0 + 2000).list), before);
  assert.ok(nextDayAt(T0) > T0 && nextDayAt(T0) - T0 <= DAY);
});

test('daily deals: one purchase per deal per day, funds checked, refresh next day', () => {
  const p = rich();
  const deals = dailyDeals(p, T0);
  const i = deals.list.findIndex((d) => d.kind === 'runes');
  const d = deals.list[i];
  const gems = p.gems;
  const r = buyDeal(p, i, T0);
  assert.ok(r.ok);
  assert.equal(p.runes, d.amount);
  assert.equal(p.gems, gems - (d.cost.gems ?? 0));
  assert.deepEqual(buyDeal(p, i, T0 + 5000), { ok: false, reason: 'bought' });
  assert.deepEqual(buyDeal(p, 99, T0), { ok: false, reason: 'unknown' });
  // next day: fresh list, nothing bought
  dailyDeals(p, T0 + DAY);
  assert.equal(p.deals!.bought.length, 0);
  assert.notEqual(p.deals!.day, dayKey(T0));
  // poor player can't buy
  const poor = newProfile('u_poor', 'P', T0); poor.coins = 0; poor.gems = 0;
  dailyDeals(poor, T0);
  assert.deepEqual(buyDeal(poor, 0, T0), { ok: false, reason: 'funds' });
  // fighter deal grants the fighter, then shows as owned for re-purchase attempts
  const q = rich('u_fighter');
  const fi = dailyDeals(q, T0).list.findIndex((x) => x.kind === 'fighter');
  if (fi >= 0) {
    const f = q.deals!.list[fi].ref!;
    assert.ok(buyDeal(q, fi, T0).ok);
    assert.ok(q.fighters.includes(f));
  }
});

// ---------------------------------------------------------------------------------------------
test('smart offers: 3 losses → comeback pack, once, max one new offer per day', () => {
  const p = rich();
  p.stats.matches = 5;
  let now = T0;
  for (let i = 0; i < 3; i++) applyMatch(p, match(false), now);
  const act = activeOffers(p, now);
  assert.equal(act.length, 1);
  assert.equal(act[0].id, 'comeback');
  assert.ok(act[0].exp > now);
  // another trigger the same day is held back
  p.level = 10;
  assert.equal(checkSmartOffers(p, now + 1000), null, 'one new offer per day');
  // next day the veteran pack triggers; comeback never re-triggers
  now += DAY;
  const v = checkSmartOffers(p, now);
  assert.equal(v?.id, 'veteran');
  for (let i = 0; i < 3; i++) applyMatch(p, match(false), now + 2 * DAY);
  assert.ok(!p.smart!.list.some((o, i) => o.id === 'comeback' && i > 0));
  // expiry
  assert.ok(!activeOffers(p, now + 30 * DAY).length);
  assert.ok(markOfferShown(p, 'veteran'));
  assert.ok(p.smart!.list.find((o) => o.id === 'veteran')!.shown);
});

test('smart offers: new league → gem-priced league pack; rune shortage → rune pack (IAP)', () => {
  const p = rich();
  p.stats.matches = 10;
  p.rank.peak = 1320; // gold
  const o = checkSmartOffers(p, T0);
  assert.equal(o?.id, 'league');
  const def = SMART_OFFERS.find((x) => x.id === 'league')!;
  const gems = p.gems;
  const r = buySmartOffer(p, 'league', T0 + 10, () => 0); // crate roll → coins
  assert.ok(r.ok);
  assert.equal(p.gems, gems - def.gems! + (def.reward.gems ?? 0));
  assert.deepEqual(buySmartOffer(p, 'league', T0 + 20), { ok: false, reason: 'expired' });
  // rune pack: spells open, runes spent before, can't afford the next step
  const q = rich('u_rune');
  q.stats.matches = 10; q.map.cleared = 5; q.spells = { nova: 2 }; q.runes = 5;
  assert.equal(checkSmartOffers(q, T0)?.id, 'rune');
  assert.deepEqual(buySmartOffer(q, 'rune', T0), { ok: false, reason: 'iap' });
  const runes = q.runes;
  assert.ok(IAP_PRODUCTS.some((x) => x.id === 'rune_pack'));
  grantIap(q, 'rune_pack');
  assert.equal(q.runes, runes + 600);
  assert.ok(q.smart!.list.find((x) => x.id === 'rune')!.bought);
  // veteran pack grants its exclusive frame
  const v = rich('u_vet');
  grantIap(v, 'veteran_pack');
  assert.ok(cosOwned(v, 'frame', 'veteran'));
});

// ---------------------------------------------------------------------------------------------
test('VIP: 30 days, renew extends, daily gems once per day, +10% coins, ads off, extra wheel spin, expiry', () => {
  const p = rich();
  assert.ok(!vipActive(p, T0));
  assert.equal(claimVipDaily(p, T0), null);
  const base = applyMatch(rich('u_novip'), match(true), T0).coins;
  grantVip(p, T0);
  assert.ok(vipActive(p, T0));
  assert.equal(vipDaysLeft(p, T0), 30);
  grantIap(p, 'vip_month'); // renew through the store product extends from the current expiry
  assert.ok(vipDaysLeft(p, Date.now()) >= 30);
  const q = rich('u_vip2');
  grantVip(q, T0); grantVip(q, T0 + 5 * DAY);
  assert.equal(vipDaysLeft(q, T0), 60);
  const gems = q.gems;
  assert.deepEqual(claimVipDaily(q, T0), { gems: VIP_DAILY_GEMS });
  assert.equal(claimVipDaily(q, T0 + 1000), null);
  assert.equal(q.gems, gems + VIP_DAILY_GEMS);
  assert.ok(claimVipDaily(q, T0 + DAY));
  // +10% coins
  const r = applyMatch(q, match(true), T0);
  assert.equal(r.vipCoins, Math.round(base * 0.1));
  assert.equal(r.coins, base + r.vipCoins);
  // ads removed while active
  assert.ok(adsRemoved(q, T0));
  // wheel: free spin + 1 VIP spin
  const today = dayKey(T0);
  const w = rich('u_wheel'); grantVip(w, T0);
  assert.ok(spinWheel(w, today, false, () => 0.5));
  assert.ok(wheelState(w, today).free, 'VIP spin available after the free one');
  assert.ok(spinWheel(w, today, false, () => 0.5));
  assert.equal(spinWheel(w, today, false, () => 0.5), null);
  // expiry: benefits stop
  const later = T0 + 61 * DAY;
  assert.ok(!vipActive(q, later));
  assert.equal(claimVipDaily(q, later), null);
  assert.ok(!adsRemoved(q, later));
  assert.ok(!cosOwned(q, 'frame', 'vip', later));
  assert.ok(cosOwned(q, 'frame', 'vip', T0));
});

// ---------------------------------------------------------------------------------------------
test('cosmetics: buy, unlock conditions, equip validation, loadout of 6, VIP items lapse', () => {
  const p = rich();
  // shop item
  assert.ok(!cosOwned(p, 'emote', 'wp'));
  assert.ok(!equipCosmetic(p, 'emote', 'wp', { slot: 5 }), 'cannot equip unowned');
  assert.deepEqual(buyCosmetic(p, 'emote', 'wp'), { ok: true });
  assert.deepEqual(buyCosmetic(p, 'emote', 'wp'), { ok: false, reason: 'owned' });
  assert.deepEqual(buyCosmetic(p, 'title', 'conqueror'), { ok: false, reason: 'not-for-sale' });
  assert.ok(equipCosmetic(p, 'emote', 'wp', { slot: 5 }));
  assert.equal(p.cos!.emotes.length, EMOTE_SLOTS);
  assert.ok(emoteLoadout(p).includes(5));
  assert.ok(!equipCosmetic(p, 'emote', 'wp', { slot: 6 }), 'slot range');
  // moving an equipped emote swaps slots (no duplicates)
  assert.ok(equipCosmetic(p, 'emote', 'wp', { slot: 0 }));
  assert.equal(p.cos!.emotes.filter((x) => x === 'wp').length, 1);
  assert.equal(p.cos!.emotes[5], 'gg');
  // network validation used by the match server
  assert.ok(ownsEmoteNet(p, 0) && ownsEmoteNet(p, 5));
  assert.ok(!ownsEmoteNet(p, 9) && !ownsEmoteNet(p, 999));
  // condition unlocks: achievements, trophies, map, raid
  assert.ok(!cosOwned(p, 'title', 'conqueror'));
  p.map.cleared = 20;
  assert.ok(cosOwned(p, 'title', 'conqueror'));
  p.trophies.push({ week: 3, tier: 2, place: 1, t: T0 });
  assert.ok(cosOwned(p, 'title', 'champ:2') && !cosOwned(p, 'title', 'champ:1'));
  assert.ok(cosOwned(p, 'frame', 'champion'));
  noteRaidStars(p, 3);
  assert.ok(cosOwned(p, 'title', 'raider'));
  p.ach.push('gold_rank');
  assert.ok(cosOwned(p, 'frame', 'gold'));
  // season pass items persist after the pass resets
  p.pass.xp = 350 * 21;
  const added = syncCosmetics(p, T0);
  assert.ok(added.some((c) => c.kind === 'pose' && c.id === 'leap'));
  p.pass.xp = 0;
  assert.ok(cosOwned(p, 'pose', 'leap'));
  // equip frame / title / pose; '' unequips; invalid fighter rejected
  assert.ok(equipCosmetic(p, 'frame', 'champion'));
  assert.ok(equipCosmetic(p, 'title', 'champ:2'));
  assert.equal(equippedFrame(p), 'champion');
  assert.equal(equippedTitle(p), 'champ:2');
  assert.deepEqual(publicBadges(p, T0), { frame: 'champion', title: 'champ:2' });
  assert.ok(equipCosmetic(p, 'pose', 'leap', { fighter: 'blaze' }));
  assert.equal(poseFor(p, 'blaze'), 'leap');
  assert.equal(poseFor(p, 'kira'), 'classic');
  assert.ok(!equipCosmetic(p, 'pose', 'leap', { fighter: 'nobody' }));
  assert.ok(!equipCosmetic(p, 'pose', 'taunt', { fighter: 'blaze' }), 'unowned pose');
  assert.ok(equipCosmetic(p, 'frame', ''));
  assert.equal(equippedFrame(p), '');
  // VIP frame works only while VIP is active
  grantVip(p, T0);
  assert.ok(equipCosmetic(p, 'frame', 'vip', {}, T0));
  assert.equal(equippedFrame(p, T0), 'vip');
  assert.equal(equippedFrame(p, T0 + 31 * DAY), '', 'falls back when VIP ends');
  // funds
  const poor = newProfile('u_poor2', 'P', T0); poor.gems = 0;
  assert.deepEqual(buyCosmetic(poor, 'frame', 'neon'), { ok: false, reason: 'funds' });
});

// ---------------------------------------------------------------------------------------------
test('fighter mastery: xp per match (more for wins), 10 levels, claimable rewards, title at 5, frame at 10', () => {
  const p = rich();
  assert.equal(masteryLevel(0), 0);
  assert.equal(masteryLevel(MASTERY_XP[1]), 1);
  assert.equal(masteryLevel(1e9), MASTERY_MAX);
  const w = applyMatch(p, match(true), T0);
  const l = applyMatch(p, match(false), T0);
  assert.ok(w.mastery && l.mastery);
  assert.ok(w.mastery!.xp > l.mastery!.xp, 'wins give more mastery XP');
  assert.equal(masteryInfo(p, 'blaze').xp, w.mastery!.xp + l.mastery!.xp);
  // training gives nothing
  const before = masteryInfo(p, 'blaze').xp;
  applyMatch(p, match(true, { mode: 'training' }), T0);
  assert.equal(masteryInfo(p, 'blaze').xp, before);
  // reach level 5 → claim levels 1..5, mastery title unlocked
  addMasteryXp(p, 'blaze', MASTERY_XP[5] - masteryInfo(p, 'blaze').xp);
  assert.equal(masteryInfo(p, 'blaze').level, 5);
  assert.ok(cosOwned(p, 'title', 'm:blaze'));
  const coins = p.coins, cards = p.cards.blaze ?? 0;
  const c = claimMastery(p, 'blaze', () => 0.1)!;
  assert.deepEqual(c.levels, [1, 2, 3, 4, 5]);
  assert.equal(p.coins, coins + 300 + 600);
  assert.equal(p.cards.blaze, cards + 6 + 10);
  assert.deepEqual(c.titles, ['m:blaze']);
  assert.equal(claimMastery(p, 'blaze'), null, 'nothing left to claim');
  // max level, exclusive frame
  addMasteryXp(p, 'blaze', 1e6);
  assert.equal(masteryInfo(p, 'blaze').level, MASTERY_MAX);
  assert.equal(masteryInfo(p, 'blaze').xp, MASTERY_XP[MASTERY_MAX], 'xp capped');
  const c2 = claimMastery(p, 'blaze')!;
  assert.deepEqual(c2.levels, [6, 7, 8, 9, 10]);
  assert.deepEqual(c2.frames, ['m:blaze']);
  assert.ok(cosOwned(p, 'frame', 'm:blaze'));
  assert.ok(masteryReward('blaze', 10).frame && masteryReward('blaze', 5).title);
  // fighters you don't own can't be claimed
  const q = rich('u_m2');
  const locked = FIGHTERS.find((f) => !q.fighters.includes(f.id))!.id;
  addMasteryXp(q, locked, 500);
  assert.equal(claimMastery(q, locked), null);
});

test('migration: old profiles get live-ops fields and mastery from match history', () => {
  const p = newProfile('u_old', 'Old', T0) as any;
  delete p.cos; delete p.mastery; delete p.vip; delete p.smart; delete p.deals;
  p.fstats = { blaze: { m: 10, w: 6 } };
  migrateProfile(p);
  assert.ok(p.cos && p.vip && p.smart);
  assert.equal(p.mastery.blaze.xp, 6 * 30 + 4 * 12);
  assert.equal(p.cos.emotes.length, EMOTE_SLOTS);
});

test('match results report cosmetics newly unlocked by that match', () => {
  const p = rich('u_unl');
  syncCosmetics(p, T0);
  p.ach.push('wins_10');
  addMasteryXp(p, 'blaze', MASTERY_XP[5] - 5);
  const r = applyMatch(p, match(true), T0);
  assert.ok(r.unlocked?.includes('emote:onfire'), 'achievement emote reported');
  assert.ok(r.unlocked?.includes('title:m:blaze'), 'mastery title reported');
  const r2 = applyMatch(p, match(true), T0);
  assert.equal(r2.unlocked, undefined, 'reported only once');
});
