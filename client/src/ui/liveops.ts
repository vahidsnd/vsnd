import {
  IAP_PRODUCTS, VIP_DAILY_GEMS, VIP_DAYS, VIP_PRODUCT, activeOffers, dayKey, dealOwned, featureUnlocked, getCosmetic, getFighter,
  nextDayAt, smartDef, vipActive, vipCanClaim, vipDaysLeft, wheelState,
  type Deal, type Reward, type SmartOffer, type SmartOfferDef,
} from '@nb/shared';
import { backend } from '../services/backend.ts';
import { billing } from '../services/billing.ts';
import { liveops } from '../services/liveops.ts';
import { audio } from '../game/audio.ts';
import { poseCanvas } from '../game/poses.ts';
import { isFa, num, loc, duration } from '../i18n.ts';
import { h, show, topBar, fighterCanvas, modal, toast, rewardReveal, grantedToItems, crateToItems, icon, getFighterBySkin, type Child, type RewardItem, type Screen } from './dom.ts';
import { svg } from './icons.ts';
import { introOnce } from './tutorial.ts';
import { homeScreen } from './home.ts';
import { cosmeticName, frameRing } from './collection.ts';
import './liveops.css';

// =============================================================================================
//  Live-ops UI: daily deals (first shop tab), smart-offer popups and the VIP screen.
// =============================================================================================

const tr = (fa: string, en: string) => (isFa() ? fa : en);
const L = (fa: string, en: string) => ({ fa, en });

/** Live countdown text; the timer stops itself when the element leaves the page. */
function countdown(until: number, prefix: () => string, onDone?: () => void) {
  const el = h('span', { class: 'cd', dir: 'auto' });
  let seen = false;
  const tick = () => {
    const left = until - Date.now();
    el.textContent = `${prefix()} ${duration(Math.max(0, left))}`;
    if (left <= 0) { clearInterval(iv); onDone?.(); }
  };
  const iv = setInterval(() => { if (!el.isConnected && seen) { clearInterval(iv); return; } if (el.isConnected) seen = true; tick(); }, 1000);
  tick();
  return el;
}

function rewardChips(r: Reward, cos: string[] = []): Child[] {
  const out: Child[] = [];
  if (r.gems) out.push(h('span', { class: 'cur big' }, icon('gem'), num(r.gems)));
  if (r.coins) out.push(h('span', { class: 'cur big' }, icon('coin'), num(r.coins)));
  if (r.runes) out.push(h('span', { class: 'cur big rune' }, icon('rune'), num(r.runes)));
  if (r.anyCards) out.push(h('span', { class: 'cur big' }, svg('fighters', 16), num(r.anyCards)));
  if (r.crates) out.push(h('span', { class: 'cur big' }, svg('crate', 16), `×${num(r.crates)}`));
  for (const k of cos) { const [kind, ...rest] = k.split(':'); const c = getCosmetic(kind as any, rest.join(':')); if (c) out.push(h('span', { class: 'tag gold' }, svg('frame', 12), cosmeticName(c))); }
  return out;
}
function rewardItems(r: Reward): RewardItem[] {
  const out: RewardItem[] = [];
  if (r.gems) out.push({ kind: 'gem', amount: r.gems });
  if (r.coins) out.push({ kind: 'coin', amount: r.coins });
  if (r.runes) out.push({ kind: 'rune', amount: r.runes });
  return out;
}

// =============================================================================================
//  Daily deals
// =============================================================================================
function dealName(d: Deal): string {
  switch (d.kind) {
    case 'fighter': return loc(getFighter(d.ref!));
    case 'skin': { const s = getFighterBySkin(d.ref!); return s ? `${loc(getFighter(s.f))} · ${loc(getFighter(s.f).skins[s.idx])}` : '?'; }
    case 'cards': return tr(`${num(d.amount!)} کارت ${loc(getFighter(d.ref!))}`, `${num(d.amount!)} ${loc(getFighter(d.ref!))} cards`);
    case 'runes': return tr(`${num(d.amount!)} رون`, `${num(d.amount!)} runes`);
    case 'coins': return tr(`${num(d.amount!)} سکه`, `${num(d.amount!)} coins`);
    case 'crates': return tr(`${num(d.amount!)} جعبه`, `${num(d.amount!)} crates`);
    case 'cosmetic': { const [k, ...r] = d.ref!.split(':'); const c = getCosmetic(k as any, r.join(':')); return c ? cosmeticName(c) : '?'; }
  }
}
const KIND_L: Record<Deal['kind'], [string, string]> = {
  fighter: ['مبارز ویژه', 'Featured fighter'], skin: ['اسکین', 'Skin'], cards: ['بسته کارت', 'Card bundle'], runes: ['رون', 'Runes'],
  coins: ['سکه', 'Coins'], crates: ['جعبه', 'Crates'], cosmetic: ['کلکسیون', 'Collection'],
};
function dealArt(d: Deal): Child {
  switch (d.kind) {
    case 'fighter': return fighterCanvas(d.ref!, 0, 84);
    case 'skin': { const s = getFighterBySkin(d.ref!); return s ? fighterCanvas(s.f, s.idx, 78) : null; }
    case 'cards': return h('div', { class: 'card-stack' }, fighterCanvas(d.ref!, backend.selectedSkin(d.ref!), 64));
    case 'runes': return h('div', { class: 'art-ico c-mag deal-rune' }, svg('rune', 34));
    case 'coins': return h('div', { class: 'art-ico c-gold' }, svg('coins', 34));
    case 'crates': return h('div', { class: 'art-ico c-green' }, svg('crate', 34));
    case 'cosmetic': {
      const [k, ...r] = d.ref!.split(':'); const id = r.join(':'); const p = backend.profile;
      if (k === 'frame') return frameRing(id, fighterCanvas(p.selFighter, backend.selectedSkin(p.selFighter), 54), 'big');
      if (k === 'pose') return poseCanvas(p.selFighter, backend.selectedSkin(p.selFighter), 78, id);
      const c = getCosmetic(k as any, id);
      return k === 'title' ? h('span', { class: 'ptitle' }, c ? cosmeticName(c) : '') : h('div', { class: 'em-bubble' }, c ? cosmeticName(c) : '');
    }
  }
}
function dealReveal(d: Deal, r: Extract<Awaited<ReturnType<typeof liveops.buyDeal>>, { ok: true }>) {
  const items: RewardItem[] = [...grantedToItems(r.granted), ...r.crates.flatMap(crateToItems)];
  if (d.kind === 'cosmetic') { toast(tr('به کلکسیون اضافه شد', 'Added to your collection'), 'ok'); audio.reward(); return; }
  rewardReveal(tr('خرید پیشنهاد روز', 'Deal purchased'), items);
}

/** Smart offers still running (shown above the deals so they can be bought later). */
function offersStrip(): HTMLElement | null {
  const act = activeOffers(backend.profile);
  if (!act.length) return null;
  return h('div', { class: 'offer-strip' }, act.map((o) => {
    const def = smartDef(o.id)!;
    return h('button', { class: 'offer-chip', onclick: () => offerModal(o, def) },
      svg('zap', 16), h('b', {}, isFa() ? def.nameFa : def.name),
      countdown(o.exp, () => '', () => {}));
  }));
}

/** Shop → "Today's deals" tab. */
export function dealsTab(refresh: () => void): HTMLElement {
  const wrap = h('div', { class: 'deals-wrap' });
  const p0 = backend.profile;
  const render = () => {
    const p = backend.profile;
    const st = p.deals;
    wrap.innerHTML = '';
    if (!st || st.day !== dayKey(Date.now())) { wrap.append(h('div', { class: 'muted center' }, '…')); return; }
    wrap.append(
      offersStrip() ?? '',
      h('div', { class: 'deals-head' },
        h('b', {}, svg('tag', 16), ' ', tr('پیشنهادهای امروز تو', 'Your deals today')),
        h('small', { class: 'muted' }, tr('هر پیشنهاد یک بار در روز', 'One purchase per deal per day')),
        h('span', { class: 'tag gold deals-cd' }, svg('timer', 12), countdown(nextDayAt(Date.now()), () => tr('تازه می‌شود در', 'New deals in'), refresh))),
      h('div', { class: 'cards deals' }, st.list.map((d, i) => {
        const bought = st.bought.includes(i);
        const owned = !bought && dealOwned(p, d);
        const gem = !!d.cost.gems;
        return h('div', { class: `card deal ${d.kind === 'fighter' ? 'hot' : ''} ${bought || owned ? 'done' : ''}` },
          h('div', { class: 'ribbon' }, `-${num(d.off)}%`),
          h('small', { class: 'deal-kind' }, tr(...KIND_L[d.kind])),
          h('div', { class: 'card-art' }, dealArt(d)),
          h('b', { class: 'deal-name' }, dealName(d)),
          bought ? h('span', { class: 'tag ok' }, svg('check', 12), tr('خریدی', 'Bought'))
            : owned ? h('span', { class: 'tag' }, tr('داری', 'Owned'))
              : h('button', { class: `btn ${gem ? 'gem' : 'gold'}`, onclick: async () => {
                const r = await liveops.buyDeal(i).catch(() => null);
                if (r?.ok) dealReveal(d, r);
                else toast(r && !r.ok && r.reason === 'funds' ? tr('موجودی کافی نیست', 'Not enough funds') : tr('خطا', 'Error'), 'err');
                refresh();
              } }, h('s', { class: 'was' }, num(d.was.gems ?? d.was.coins ?? 0)), icon(gem ? 'gem' : 'coin'), num(d.cost.gems ?? d.cost.coins ?? 0)));
      })),
    );
  };
  if (!p0.deals || p0.deals.day !== dayKey(Date.now()) || backend.online) liveops.deals().then(render).catch(() => { wrap.innerHTML = ''; wrap.append(h('div', { class: 'muted center' }, tr('بارگذاری نشد', 'Could not load deals'))); });
  render();
  introOnce('deals', [
    { target: '.deals-head', title: L('پیشنهادهای روزانه', 'Daily deals'), text: L('هر روز چند پیشنهاد تخفیف‌دار فقط برای تو: مبارز، اسکین، کارت، رون و سکه. هر کدام فقط یک بار در روز خریدنی است و با شمارش معکوس عوض می‌شوند.', 'Every day a few discounted offers just for you: a fighter, skins, cards, runes and coins. Each can be bought once a day; they refresh when the countdown ends.') },
  ]);
  return wrap;
}

// =============================================================================================
//  Smart offers (popup on home)
// =============================================================================================
async function buyOffer(o: SmartOffer, def: SmartOfferDef, close: () => void) {
  if (def.product) {
    const ok = await billing.buy(def.product);
    if (!ok) { toast(tr('خرید انجام نشد', 'Purchase failed'), 'err'); return; }
    close();
    rewardReveal(isFa() ? def.nameFa : def.name, rewardItems(def.reward));
  } else {
    const r = await liveops.buyOffer(o.id).catch(() => null);
    if (!r?.ok) { toast(r && !r.ok && r.reason === 'funds' ? tr('الماس کافی نیست', 'Not enough gems') : tr('پیشنهاد تمام شده', 'Offer ended'), 'err'); return; }
    close();
    rewardReveal(isFa() ? def.nameFa : def.name, grantedToItems(r.granted));
  }
  if (document.querySelector('.home')) show(homeScreen);
}

export function offerModal(o: SmartOffer, def = smartDef(o.id)!) {
  const prod = def.product ? IAP_PRODUCTS.find((x) => x.id === def.product) : undefined;
  const ico: Record<string, string> = { comeback: 'flame', league: 'trophy', rune: 'rune', veteran: 'medal' };
  const m = modal(h('div', { class: 'offer smart-offer' },
    h('div', { class: 'ribbon' }, tr('پیشنهاد محدود', 'Limited offer'), ' · ', isFa() ? def.badgeFa : def.badge),
    h('div', { class: 'so-top' },
      h('div', { class: 'art-ico c-gold' }, svg(ico[def.id] ?? 'gift', 40)),
      h('div', { class: 'so-text' },
        h('h2', { class: 'title-grad' }, isFa() ? def.nameFa : def.name),
        h('p', { class: 'muted' }, isFa() ? def.descFa : def.desc))),
    h('div', { class: 'row so-rewards' }, rewardChips(def.reward, def.cos)),
    h('div', { class: 'row' },
      h('span', { class: 'tag' }, svg('timer', 12), countdown(o.exp, () => tr('پایان در', 'Ends in'), () => m.close())),
      h('button', { class: `btn big ${prod ? 'primary' : 'gem'}`, onclick: () => buyOffer(o, def, () => m.close()) },
        prod ? billing.price(prod) : h('span', {}, icon('gem'), ' ', num(def.gems ?? 0)))),
  ));
  return m;
}

let lastCheck = 0;
/** Re-evaluates smart-offer triggers (throttled; offline this runs locally and instantly). */
export function refreshOffers() {
  if (Date.now() - lastCheck < 60_000) return;
  lastCheck = Date.now();
  liveops.checkOffers().catch(() => {});
}
/**
 * Home popup queue hook: shows one new smart offer (never stacks on another window).
 * Returns true when a popup was opened.
 */
export function liveopsPopup(): boolean {
  const p = backend.profile;
  if (!featureUnlocked(p, 'shop') || document.querySelector('.modal-wrap, .coach-bubble')) return false;
  const o = activeOffers(p).find((x) => !x.shown);
  if (!o) return false;
  o.shown = true;
  liveops.checkOffers(o.id).catch(() => {});
  offerModal(o);
  return true;
}

// =============================================================================================
//  VIP
// =============================================================================================
export function vipScreen(): Screen {
  const p = backend.profile;
  const active = vipActive(p);
  const prod = IAP_PRODUCTS.find((x) => x.id === VIP_PRODUCT)!;
  const refresh = () => show(vipScreen);
  const canClaim = vipCanClaim(p);
  const spinLeft = active && wheelState(p, dayKey(Date.now())).free;
  const benefit = (ico: string, title: string, desc: string, action?: Child) => h('div', { class: `vip-b ${active ? 'on' : ''}` },
    h('span', { class: 'vip-ico' }, svg(ico, 18)), h('div', {}, h('b', {}, title), h('small', { class: 'muted' }, desc)), action ?? (active ? svg('check', 16) : null));
  const buy = async () => {
    const ok = await billing.buy(VIP_PRODUCT);
    if (ok) { audio.reward(); toast(tr('VIP فعال شد', 'VIP activated'), 'ok'); refresh(); } else toast(tr('خرید انجام نشد', 'Purchase failed'), 'err');
  };
  const el = h('div', { class: 'page vip' },
    topBar({ back: () => show(homeScreen), title: 'VIP' }),
    h('div', { class: 'vip-body' },
      h('div', { class: `vip-card ${active ? 'on' : ''}` },
        frameRing('vip', fighterCanvas(p.selFighter, backend.selectedSkin(p.selFighter), 70), 'big'),
        h('h2', { class: 'vip-title' }, svg('crown', 22), ' VIP'),
        active
          ? [h('b', { class: 'vip-days' }, tr(`${num(vipDaysLeft(p))} روز باقی‌مانده`, `${num(vipDaysLeft(p))} days left`)),
            h('small', { class: 'muted' }, tr('تمدید، ۳۰ روز به زمان باقی‌مانده اضافه می‌کند', 'Renewing adds 30 days to the time left'))]
          : h('small', { class: 'muted' }, tr(`${num(VIP_DAYS)} روز مزایای ویژه`, `${num(VIP_DAYS)} days of perks`)),
        h('button', { class: 'btn gold big', onclick: buy }, active ? tr('تمدید', 'Renew') : tr('فعال کن', 'Get VIP'), ' · ', h('span', { dir: 'ltr' }, billing.price(prod))),
      ),
      h('div', { class: 'vip-list' },
        benefit('gem', tr(`${num(VIP_DAILY_GEMS)} الماس هر روز`, `${num(VIP_DAILY_GEMS)} gems every day`), tr('هر روز از همین‌جا دریافت کن', 'Claim it here once a day'),
          active ? h('button', { class: `btn small ${canClaim ? 'gem' : 'disabled'}`, onclick: async () => {
            const r = await liveops.vipClaim().catch(() => null);
            if (r) rewardReveal('VIP', [{ kind: 'gem', amount: r.gems }]); else toast(tr('امروز دریافت کردی', 'Already claimed today'), 'err');
            refresh();
          } }, canClaim ? tr('دریافت', 'Claim') : tr('فردا', 'Tomorrow')) : null),
        benefit('noads', tr('بدون تبلیغ', 'No ads'), tr('بدون بنر و تبلیغ بین مسابقه‌ها', 'No banners or ads between matches')),
        benefit('wheel', tr('+۱ چرخش گردونه در روز', '+1 lucky-wheel spin a day'), tr('یک چرخش رایگان اضافه', 'An extra free spin'),
          active ? h('button', { class: `btn small ${spinLeft ? 'accent' : 'disabled'}`, onclick: () => import('./progress.ts').then((m) => m.wheelModal(refresh)) }, tr('بچرخان', 'Spin')) : null),
        benefit('coins', tr('+۱۰٪ سکه مسابقه', '+10% match coins'), tr('روی همه مسابقه‌ها', 'On every match')),
        benefit('frame', tr('قاب و نشان VIP', 'VIP frame & chat badge'), tr('قاب طلایی پروفایل، نشان VIP در چت، لقب، ایموت و ژست ویژه', 'Gold profile frame, VIP chat badge, title, emote and an exclusive pose'),
          active ? h('button', { class: 'btn small ghost', onclick: () => import('./collection.ts').then((m) => show(() => m.collectionScreen('frame'))) }, svg('frame', 14)) : null),
      ),
    ),
  );
  introOnce('vip', [
    { target: '.vip-card', title: L('اشتراک VIP', 'VIP membership'), text: L('۳۰ روز مزایا: الماس روزانه، بدون تبلیغ، چرخش اضافه گردونه، سکه بیشتر و قاب و نشان ویژه. تمدید، ۳۰ روز به زمان باقی‌مانده اضافه می‌کند.', '30 days of perks: daily gems, no ads, an extra wheel spin, more coins and an exclusive frame & badge. Renewing adds 30 days to what is left.') },
    { target: '.vip-list', title: L('دریافت روزانه', 'Daily claim'), text: L('هر روز به این صفحه سر بزن و الماس VIP را بگیر.', 'Come back every day to claim your VIP gems.') },
  ]);
  return { el };
}

