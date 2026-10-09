import {
  ACHIEVEMENTS, CRATE_ODDS, FIGHTERS, IAP_PRODUCTS, PASS_TIERS, PASS_XP_PER_TIER, achievementState, passReward, passTier, seasonEndsAt,
  shopCatalog, skinPrice, tierFor, TIERS, PLACE_NAMES, getFighter, dayKey, xpForLevel, featureUnlocked, fighterPower, type PassReward,
  equippedTitle, vipActive, adsRemoved,
} from '@nb/shared';
import { social } from '../services/social.ts';
import { upgradePanel, milestonesBlock } from './progress.ts';
import { backend } from '../services/backend.ts';
import { billing } from '../services/billing.ts';
import { ads } from '../services/ads.ts';
import { prefs, setPref } from '../services/prefs.ts';
import { store } from '../services/platform.ts';
import { audio } from '../game/audio.ts';
import { setLang, t, num, isFa, loc, duration } from '../i18n.ts';
import { h, show, topBar, fighterCanvas, modal, toast, rewardReveal, crateToItems, grantedToItems, icon, currency, confirmBox, getFighterBySkin, type Screen, type Child } from './dom.ts';
import { svg } from './icons.ts';
import { specialsList } from './movelist.ts';
import { introOnce, resetIntros } from './tutorial.ts';
import { homeScreen } from './home.ts';
import { dealsTab } from './liveops.ts';
import { frameRing, myFrame, titleTag, masteryBadge, masteryPanel, masteryList, vipBadge, cosmeticsWhere, cosChip } from './collection.ts';

const home = () => show(homeScreen);
const L = (fa: string, en: string) => ({ fa, en });
const tr2 = (fa: string, en: string) => (isFa() ? fa : en);

// ============================================================================================
// Fighters
// ============================================================================================
export function fightersScreen(selected = backend.profile.selFighter): Screen {
  const p = backend.profile;
  const def = getFighter(selected);
  const owned = p.fighters.includes(def.id);
  const curSkin = backend.selectedSkin(def.id);

  const grid = h('div', { class: 'fgrid' }, FIGHTERS.map((f) => {
    const own = p.fighters.includes(f.id);
    return h('button', { class: `fcard ${f.id === def.id ? 'sel' : ''} ${own ? '' : 'locked'}`, onclick: () => show(() => fightersScreen(f.id)) },
      fighterCanvas(f.id, backend.selectedSkin(f.id), 80),
      h('span', {}, loc(f)),
      own && featureUnlocked(p, 'cards') ? h('span', { class: 'pw' }, num(fighterPower(p, f.id))) : null,
      own && (p.cards[f.id] ?? 0) > 0 ? h('span', { class: 'cards-n' }, num(p.cards[f.id])) : null,
      own && featureUnlocked(p, 'mastery') ? masteryBadge(f.id) : null,
      own ? (p.selFighter === f.id ? h('span', { class: 'tag ok' }, svg('check', 12)) : null) : h('span', { class: 'tag lock' }, svg('lock', 12)));
  }));

  const stat = (label: string, v: number) => h('div', { class: 'stat' }, h('span', {}, label), h('div', { class: 'sbar' }, h('div', { style: { width: `${Math.round(Math.max(0.08, Math.min(1, v)) * 100)}%` } })));
  const s = def.stats;
  const stats = h('div', { class: 'stats' },
    stat(t('stWeight'), (s.weight - 60) / 75),
    stat(t('stSpeed'), (s.run - 5.5) / 3.2),
    stat(t('stAir'), (s.airSpeed - 4 + s.airJumps * 0.4) / 4),
    stat(t('stPower'), def.archetype === 'heavy' ? 0.95 : def.archetype === 'swordie' ? 0.75 : def.archetype === 'allrounder' ? 0.65 : 0.5),
  );

  const skins = h('div', { class: 'skins' }, def.skins.map((sk, i) => {
    const has = i === 0 || p.skins.includes(sk.id);
    const price = skinPrice(i);
    return h('button', {
      class: `skin ${i === curSkin ? 'sel' : ''} ${has ? '' : 'locked'}`, style: { background: `linear-gradient(135deg, ${sk.main}, ${sk.second})` },
      onclick: async () => {
        if (has) { if (owned) backend.saveProfile({ selSkin: { fighter: def.id, idx: i } }); show(() => fightersScreen(def.id)); return; }
        if (!price) { toast(t('passExclusive')); return; }
        if (await confirmBox(`${loc(sk)} — ${price.coins ? num(price.coins) + ' ' + t('coins') : num(price.gems!) + ' ' + t('gems')}`)) {
          const r = await backend.buy(`skin:${sk.id}`);
          if (r.ok) { audio.coin(); toast(t('purchaseOk'), 'ok'); } else toast(t('notEnough'), 'err');
          show(() => fightersScreen(def.id));
        }
      },
    }, has ? null : svg(price ? 'lock' : 'pass', 14), h('small', {}, loc(sk)));
  }));

  const actions: Child[] = [];
  if (owned) {
    actions.push(h('button', { class: `btn accent ${p.selFighter === def.id ? 'disabled' : ''}`, onclick: () => { backend.saveProfile({ selFighter: def.id }); show(() => fightersScreen(def.id)); } }, p.selFighter === def.id ? t('selected') : t('select')));
  } else {
    const buy = async (cur: 'coins' | 'gems') => {
      const r = await backend.buy(`fighter:${def.id}:${cur}`);
      if (r.ok) { rewardReveal(t('purchaseOk'), [{ kind: 'fighter', id: def.id }]); backend.saveProfile({ selFighter: def.id }); show(() => fightersScreen(def.id)); }
      else toast(t('notEnough'), 'err');
    };
    actions.push(h('button', { class: 'btn gold', onclick: () => buy('coins') }, icon('coin'), num(def.price.coins)));
    actions.push(h('button', { class: 'btn gem', onclick: () => buy('gems') }, icon('gem'), num(def.price.gems)));
    actions.push(h('button', { class: 'btn ad', onclick: async () => {
      if (await ads.rewarded('trial')) import('./play.ts').then((m) => m.startCpuMatch({ fighter: def.id, skin: 0, trial: true }));
    } }, svg('ad', 16), t('tryWithAd')));
  }
  const fs = p.fstats[def.id];

  const detail = h('div', { class: 'fdetail' },
    h('div', { class: 'fd-art' }, fighterCanvas(def.id, curSkin, 190)),
    h('div', { class: 'fd-info' },
      h('h2', {}, loc(def), h('small', {}, isFa() ? def.titleFa : def.title)),
      stats,
      featureUnlocked(p, 'mastery') ? masteryPanel(def.id, () => show(() => fightersScreen(def.id))) : null,
      owned && featureUnlocked(p, 'cards') ? upgradePanel(def.id, () => show(() => fightersScreen(def.id))) : null,
      specialsList(def.id),
      fs ? h('small', { class: 'muted' }, `${t('matchesShort')}: ${num(fs.m)} · ${t('wins')}: ${num(fs.w)}`) : null,
      h('div', { class: 'skins-wrap' }, skins),
      h('div', { class: 'fd-actions' }, actions),
    ),
  );
  introOnce('fighters', [
    { target: '.fgrid', title: L('مبارزها', 'Fighters'), text: L('هر مبارز سبک بازی خودش را دارد: سنگین، سریع، هوایی، دوربُرد. مبارزهای قفل را با سکه یا الماس بخر یا با تماشای تبلیغ یک بازی امتحانشان کن.', 'Each fighter plays differently: heavy, fast, aerial, zoner. Buy locked fighters with coins or gems — or try one for a match by watching an ad.') },
    { target: '.skins', title: L('اسکین‌ها', 'Skins'), text: L('ظاهر مبارزت را عوض کن. بعضی اسکین‌ها با سکه، بعضی با الماس و بعضی فقط در پاس فصل به دست می‌آیند.', 'Change your look. Some skins cost coins, some gems, and some come only from the Season Pass.') },
  ]);
  return { el: h('div', { class: 'page fighters' }, topBar({ back: home, title: t('fighters') }), h('div', { class: 'split' }, grid, detail)) };
}

// ============================================================================================
// Shop
// ============================================================================================
type ShopTab = 'deals' | 'featured' | 'gems' | 'fighters' | 'skins' | 'coins' | 'crates';

export function shopScreen(tab: ShopTab = featureUnlocked(backend.profile, 'deals') ? 'deals' : 'featured'): Screen {
  const tabs: ShopTab[] = [...(featureUnlocked(backend.profile, 'deals') ? ['deals' as const] : []), 'featured', 'gems', 'fighters', 'skins', 'coins', 'crates'];
  const label: Record<ShopTab, string> = { deals: isFa() ? 'پیشنهاد روز' : 'Daily deals', featured: t('featured'), gems: t('gemsTab'), fighters: t('fightersTab'), skins: t('skinsTab'), coins: t('coinsTab'), crates: t('crates') };
  const el = h('div', { class: 'page shop' },
    topBar({ back: home, title: t('shop') }),
    h('div', { class: 'tabs' }, tabs.map((x) => h('button', { class: `tab ${x === tab ? 'on' : ''}`, onclick: () => show(() => shopScreen(x)) }, label[x]))),
    h('div', { class: 'scroll' }, renderShopTab(tab)),
  );
  introOnce('shop', [
    { target: '.tabs', title: L('بخش‌های فروشگاه', 'Shop sections'), text: L('پیشنهادهای ویژه، الماس، مبارزها، اسکین‌ها، تبدیل الماس به سکه و جعبه‌ها.', 'Featured offers, gems, fighters, skins, gem-to-coin packs and crates.') },
    { target: '.wallet', title: L('کیف پول', 'Wallet'), text: L('سکه را با بازی کردن به دست می‌آوری؛ الماس ارز ویژه است و از خرید، پاس و دستاوردها می‌آید.', 'Coins come from playing; gems are the premium currency from purchases, the pass and achievements.') },
  ]);
  return { el };
}

async function buyIap(id: string, after?: () => void) {
  const ok = await billing.buy(id);
  if (ok) { audio.reward(); toast(t('purchaseOk'), 'ok'); after?.(); }
  else toast(t('purchaseFail'), 'err');
}

const artIco = (name: string, cls = 'c-cyan', size = 34) => h('div', { class: `art-ico ${cls}` }, svg(name, size));

function iapCard(id: string, art: Child, cls = '') {
  const prod = IAP_PRODUCTS.find((x) => x.id === id)!;
  return h('div', { class: `card iap ${cls}` },
    prod.badge ? h('div', { class: 'ribbon' }, isFa() ? prod.badgeFa : prod.badge) : null,
    h('div', { class: 'card-art' }, art),
    h('b', {}, loc(prod)),
    prod.gems ? h('div', {}, currency('gem', prod.gems)) : null,
    h('button', { class: 'btn primary', onclick: () => buyIap(id, () => show(() => shopScreen('featured'))) }, billing.price(prod)),
  );
}

function freeCrateCard(): HTMLElement {
  const p = backend.profile;
  const left = p.daily.crateAt - Date.now();
  return h('div', { class: 'card' },
    h('div', { class: 'card-art' }, artIco('crate', 'c-green')),
    h('b', {}, t('freeCrate')),
    left > 0
      ? h('button', { class: 'btn disabled' }, `${t('readyIn')} ${duration(left)}`)
      : h('button', { class: 'btn ad', onclick: async () => {
        if (!(await ads.rewarded('crate'))) return;
        const c = await backend.freeCrate().catch(() => null);
        if (c) rewardReveal(t('youGot'), crateToItems(c));
        show(() => shopScreen('crates'));
      } }, svg('ad', 16), t('watchAd')),
  );
}

function renderShopTab(tab: ShopTab): Child {
  const p = backend.profile;
  const cat = shopCatalog();
  switch (tab) {
    case 'deals': return dealsTab(() => show(() => shopScreen('deals')));
    case 'featured': return h('div', { class: 'cards' },
      !p.offers.starter ? iapCard('starter_pack', h('div', { class: 'duo' }, fighterCanvas('zephyr', 0, 84), fighterCanvas('blaze', 1, 84)), 'hot') : null,
      !p.pass.premium ? iapCard('season_pass', artIco('pass', 'c-gold')) : null,
      !adsRemoved(p) ? iapCard('no_ads', artIco('noads', 'c-mag')) : h('div', { class: 'card' }, artIco('check', 'c-green'), h('b', {}, t('noAdsActive'))),
      featureUnlocked(p, 'vip') ? h('div', { class: 'card iap vip-shop' },
        h('div', { class: 'ribbon' }, vipActive(p) ? tr2('فعال', 'Active') : 'VIP'),
        h('div', { class: 'card-art' }, artIco('crown', 'c-gold')),
        h('b', {}, isFa() ? 'اشتراک VIP' : 'VIP membership'),
        h('button', { class: 'btn gold', onclick: () => import('./liveops.ts').then((m) => show(m.vipScreen)) }, vipActive(p) ? tr2('تمدید', 'Renew') : billing.price(IAP_PRODUCTS.find((x) => x.id === 'vip_month')!))) : null,
      featureUnlocked(p, 'collection') ? h('div', { class: 'card' },
        h('div', { class: 'card-art' }, artIco('layers', 'c-cyan')),
        h('b', {}, isFa() ? 'ایموت، قاب، لقب، ژست' : 'Emotes, frames, titles, poses'),
        h('button', { class: 'btn accent', onclick: () => import('./collection.ts').then((m) => show(() => m.collectionScreen())) }, svg('layers', 16), isFa() ? 'کلکسیون' : 'Collection')) : null,
      p.fighters.length < FIGHTERS.length ? iapCard('all_fighters', h('div', { class: 'duo' }, fighterCanvas('kira', 0, 76), fighterCanvas('pip', 0, 76))) : null,
      h('div', { class: 'card' },
        h('div', { class: 'card-art' }, artIco('coins', 'c-gold')),
        h('b', {}, t('watchForCoins')),
        h('button', { class: 'btn ad', onclick: async () => {
          if (!(await ads.rewarded('coins'))) return;
          const g = await backend.adReward('coins').catch(() => 0);
          if (g) { audio.coin(); toast(`+${num(g)} ${t('coins')}`, 'ok'); }
          else toast(t('dailyLimit'), 'err');
        } }, svg('ad', 16), t('bonusCoins'))),
      featureUnlocked(p, 'crates') ? freeCrateCard() : null,
    );
    case 'gems': return h('div', { class: 'cards' },
      IAP_PRODUCTS.filter((x) => x.id.startsWith('gems_')).map((x, i) => iapCard(x.id, h('div', { class: 'gem-pile' }, Array.from({ length: Math.min(4, i + 1) }, () => svg('gem', 22))))));
    case 'fighters': return h('div', { class: 'cards' }, FIGHTERS.filter((f) => f.price.coins).map((f) => {
      const own = p.fighters.includes(f.id);
      return h('div', { class: 'card' },
        h('div', { class: 'card-art' }, fighterCanvas(f.id, 0, 100)),
        h('b', {}, loc(f)),
        own ? h('span', { class: 'tag ok' }, t('owned')) : h('div', { class: 'row' },
          h('button', { class: 'btn gold small', onclick: () => buyCat(`fighter:${f.id}:coins`, 'fighters', { kind: 'fighter', id: f.id }) }, icon('coin'), num(f.price.coins)),
          h('button', { class: 'btn gem small', onclick: () => buyCat(`fighter:${f.id}:gems`, 'fighters', { kind: 'fighter', id: f.id }) }, icon('gem'), num(f.price.gems))));
    }));
    case 'skins': return h('div', { class: 'cards' }, cat.filter((i) => i.kind === 'skin').map((i) => {
      const sk = getFighterBySkin(i.ref!)!;
      const own = p.skins.includes(i.ref!);
      const sdef = getFighter(sk.f).skins[sk.idx];
      return h('div', { class: 'card' },
        h('div', { class: 'card-art' }, fighterCanvas(sk.f, sk.idx, 92)),
        h('b', {}, `${loc(getFighter(sk.f))} · ${loc(sdef)}`),
        own ? h('span', { class: 'tag ok' }, t('owned')) :
          h('button', { class: `btn ${i.cost.gems ? 'gem' : 'gold'} small`, onclick: () => buyCat(i.id, 'skins', { kind: 'skin', id: i.ref! }) },
            icon(i.cost.gems ? 'gem' : 'coin'), num(i.cost.gems ?? i.cost.coins ?? 0)));
    }));
    case 'coins': return h('div', { class: 'cards' }, cat.filter((i) => i.kind === 'coins').map((i) => h('div', { class: 'card' },
      h('div', { class: 'card-art' }, artIco('coins', 'c-gold', 26 + Math.min(16, i.amount! / 1000))),
      h('b', {}, currency('coin', i.amount!)),
      h('button', { class: 'btn gem small', onclick: () => buyCat(i.id, 'coins', { kind: 'coin', amount: i.amount }) }, icon('gem'), num(i.cost.gems!)))));
    case 'crates': return h('div', { class: 'cards' },
      freeCrateCard(),
      h('div', { class: 'card' },
        h('div', { class: 'card-art' }, artIco('gift', 'c-mag')),
        h('b', {}, t('crate')),
        h('button', { class: 'btn gem', onclick: async () => {
          const r = await backend.buy('crate');
          if (r.ok) rewardReveal(t('youGot'), crateToItems(r.crate)); else toast(t('notEnough'), 'err');
        } }, icon('gem'), num(cat.find((x) => x.kind === 'crate')!.cost.gems!)),
        h('button', { class: 'btn small ghost', onclick: oddsModal }, t('odds'))),
    );
  }
}

async function buyCat(id: string, back: ShopTab, reveal: { kind: 'fighter' | 'skin' | 'coin'; id?: string; amount?: number }) {
  const r = await backend.buy(id);
  if (r.ok) rewardReveal(t('purchaseOk'), [reveal as any]);
  else toast(r.reason === 'owned' ? t('owned') : t('notEnough'), 'err');
  show(() => shopScreen(back));
}

function oddsModal() {
  const total = CRATE_ODDS.reduce((a, o) => a + o.weight, 0);
  const names: Record<string, string> = isFa()
    ? { coins: 'سکه (۴۰۰–۱۲۰۰)', gems: 'الماس (۱۵–۴۰)', skin: 'اسکین تصادفی', fighter: 'مبارز تصادفی' }
    : { coins: 'Coins (400–1200)', gems: 'Gems (15–40)', skin: 'Random skin', fighter: 'Random fighter' };
  modal(h('div', { class: 'odds' }, h('h2', {}, t('odds')),
    h('table', {}, CRATE_ODDS.map((o) => h('tr', {}, h('td', {}, names[o.kind]), h('td', {}, `${num((o.weight / total) * 100)}%`)))),
    h('p', { class: 'muted' }, t('dupToCoins'))));
}

// ============================================================================================
// Season pass
// ============================================================================================
export function passScreen(): Screen {
  const p = backend.profile;
  const tier = passTier(p);
  const into = p.pass.xp - tier * PASS_XP_PER_TIER;
  const rewardView = (r: PassReward): Child => {
    if (r.skin) { const s = getFighterBySkin(r.skin); return s ? fighterCanvas(s.f, s.idx, 56) : svg('star', 26); }
    if (r.crate) return h('span', { style: { color: 'var(--accent2)' } }, svg('gift', 26));
    if (r.gems) return h('div', {}, icon('gem'), ' ', num(r.gems));
    return h('div', {}, icon('coin'), ' ', num(r.coins ?? 0));
  };
  const claim = async (tierN: number, premium: boolean) => {
    const r = await backend.claimPass(tierN, premium).catch(() => null);
    if (!r) return;
    const items: any[] = [];
    if (r.reward.coins) items.push({ kind: 'coin', amount: r.reward.coins });
    if (r.reward.gems) items.push({ kind: 'gem', amount: r.reward.gems });
    if (r.reward.skin) items.push({ kind: 'skin', id: r.reward.skin });
    items.push(...crateToItems(r.crate));
    rewardReveal(t('youGot'), items);
    show(passScreen);
  };
  const cols = [];
  for (let i = 1; i <= PASS_TIERS; i++) {
    const reached = i <= tier;
    const cell = (premium: boolean) => {
      const claimed = (premium ? p.pass.prem : p.pass.free).includes(i);
      const locked = premium && !p.pass.premium;
      return h('div', { class: `pcell ${premium ? 'prem' : ''} ${claimed ? 'claimed' : ''} ${reached && !claimed && !locked ? 'ready' : ''}` },
        rewardView(passReward(i, premium)),
        cosmeticsWhere((s) => s.t === 'pass' && s.tier === i && !!s.premium === premium).map((c) => cosChip(c, true)),
        locked ? h('span', { class: 'corner' }, svg('lock', 12)) : claimed ? h('span', { class: 'corner' }, svg('check', 14)) :
          reached ? h('button', { class: 'btn small accent', onclick: () => claim(i, premium) }, t('claim')) : null);
    };
    cols.push(h('div', { class: `pcol ${reached ? 'reached' : ''}` }, h('div', { class: 'pnum' }, num(i)), cell(false), cell(true)));
  }
  const prod = IAP_PRODUCTS.find((x) => x.id === 'season_pass')!;
  const el = h('div', { class: 'page pass' },
    topBar({ back: home, title: t('pass') }),
    h('div', { class: 'pass-head' },
      h('div', {}, h('b', {}, `${t('newSeason')} ${num(p.pass.season)} · ${t('tier')} `, h('span', { dir: 'ltr' }, `${num(tier)} / ${num(PASS_TIERS)}`)),
        h('div', { class: 'xpbar wide' }, h('div', { style: { width: `${tier >= PASS_TIERS ? 100 : (into / PASS_XP_PER_TIER) * 100}%` } })),
        h('small', { class: 'muted' }, `${t('seasonEnds')}: ${duration(seasonEndsAt(Date.now()) - Date.now())}`)),
      p.pass.premium ? h('span', { class: 'tag ok' }, svg('check', 12), t('premium'))
        : h('button', { class: 'btn gold', onclick: () => buyIap('season_pass', () => show(passScreen)) }, svg('pass', 16), t('unlockPremium'), ' · ', billing.price(prod)),
    ),
    h('div', { class: 'ptrack' }, h('div', { class: 'plabels' }, h('div', {}), h('div', {}, t('free')), h('div', {}, t('premium'))), h('div', { class: 'pscroll' }, cols)),
  );
  requestAnimationFrame(() => { const sc = el.querySelector('.pscroll') as HTMLElement; const target = sc?.children[Math.max(0, tier - 2)] as HTMLElement; if (target && tier > 2) target.scrollIntoView({ inline: 'start', block: 'nearest' }); });
  introOnce('pass', [
    { target: '.pass-head', title: L('پیشرفت فصل', 'Season progress'), text: L('هر مسابقه و هر مأموریت امتیاز تجربه می‌دهد. هر ۳۵۰ امتیاز یک مرحله جلو می‌روی.', 'Every match and quest gives XP. Each 350 XP advances one tier.') },
    { target: '.plabels', title: L('دو مسیر جایزه', 'Two reward tracks'), text: L('مسیر رایگان برای همه است. مسیر ویژه اسکین‌های انحصاری، الماس و جعبه بیشتر دارد. جایزه‌های رسیده را دستی دریافت کن.', 'The free track is for everyone. Premium adds exclusive skins, more gems and crates. Claim reached rewards manually.') },
  ]);
  return { el };
}

// ============================================================================================
// Quests
// ============================================================================================
const QUEST_TEXT: Record<string, { fa: string; en: string }> = {
  play: { fa: '{n} مسابقه بازی کن', en: 'Play {n} matches' },
  win: { fa: '{n} مسابقه ببر', en: 'Win {n} matches' },
  ko: { fa: '{n} ناک‌اوت بزن', en: 'Get {n} KOs' },
  dmg: { fa: '{n}٪ آسیب بزن', en: 'Deal {n}% damage' },
  smashko: { fa: '{n} ناک‌اوت با اسمش', en: 'Get {n} smash-attack KOs' },
  combo: { fa: 'یک کمبوی {n} ضربه‌ای بزن', en: 'Land a {n}-hit combo' },
  online: { fa: '{n} مسابقه آنلاین بازی کن', en: 'Play {n} online matches' },
  winwith: { fa: 'با {f} {n} بار ببر', en: 'Win {n} with {f}' },
};

export function questsScreen(): Screen {
  const p = backend.profile;
  const nextReset = new Date(dayKey(Date.now()) + 'T00:00:00Z').getTime() + 86400000 - 3.5 * 3600000;
  const cards = p.daily.quests.map((q, i) => {
    const txt = (isFa() ? QUEST_TEXT[q.kind].fa : QUEST_TEXT[q.kind].en).replace('{n}', num(q.target)).replace('{f}', q.param ? loc(getFighter(q.param)) : '');
    const done = q.progress >= q.target;
    return h('div', { class: `quest ${done ? 'done' : ''} ${q.claimed ? 'claimed' : ''}` },
      h('div', { class: 'q-main' }, h('b', {}, txt),
        h('div', { class: 'xpbar wide' }, h('div', { style: { width: `${(q.progress / q.target) * 100}%` } })),
        h('small', { class: 'muted', dir: 'ltr' }, `${num(q.progress)} / ${num(q.target)}`)),
      h('div', { class: 'q-reward' }, currency('coin', q.reward.coins), q.reward.gems ? currency('gem', q.reward.gems) : null),
      q.claimed ? h('span', { class: 'tag ok' }, svg('check', 12), t('claimed')) :
        done ? h('button', { class: 'btn accent', onclick: async () => {
          const r = await backend.claimQuest(i).catch(() => null);
          if (r) rewardReveal(t('questDone'), [{ kind: 'coin', amount: r.reward.coins }, ...(r.reward.gems ? [{ kind: 'gem' as const, amount: r.reward.gems }] : [])]);
          show(questsScreen);
        } }, t('claim')) :
          h('button', { class: `btn small ${p.daily.rerolls > 0 ? 'ghost' : 'ad'}`, onclick: async () => {
            const viaAd = p.daily.rerolls <= 0;
            if (viaAd && !(await ads.rewarded('reroll'))) return;
            await backend.rerollQuest(i, viaAd).catch(() => toast(t('error'), 'err'));
            show(questsScreen);
          } }, svg(p.daily.rerolls > 0 ? 'refresh' : 'ad', 14), p.daily.rerolls > 0 ? `${t('reroll')} (${t('free')})` : t('reroll')),
    );
  });
  const el = h('div', { class: 'page quests' },
    topBar({ back: home, title: t('quests') }),
    h('div', { class: 'scroll narrow' },
      featureUnlocked(p, 'milestones') ? milestonesBlock(() => show(questsScreen)) : null,
      h('div', { class: 'row space' }, h('h3', {}, t('dailyQuests')), h('small', { class: 'muted' }, `${t('resetIn')} ${duration(nextReset - Date.now())}`)),
      cards,
      h('button', { class: 'btn ghost', onclick: () => import('./home.ts').then((m) => m.loginPopup()) }, svg('calendar', 16), t('dailyLogin'), p.login.claimed ? svg('check', 14) : null),
    ),
  );
  introOnce('quests', [
    { target: '.quest', title: L('مأموریت روزانه', 'Daily quest'), text: L('هدف را کامل کن و جایزه را دریافت کن. روزی یک بار می‌توانی یک مأموریت را رایگان عوض کنی؛ بعد از آن با تماشای تبلیغ.', 'Complete the goal and claim the reward. Reroll one quest per day for free — after that, by watching an ad.') },
  ]);
  return { el };
}

// ============================================================================================
// Achievements
// ============================================================================================
export function achievementsScreen(): Screen {
  const p = backend.profile;
  const list = h('div', { class: 'achs' }, ACHIEVEMENTS.map((a) => {
    const st = achievementState(p, a);
    return h('div', { class: `ach ${st.done ? 'done' : ''} ${st.claimed ? 'claimed' : ''}` },
      h('div', { class: 'a-ico' }, svg(st.done ? 'medal' : 'star', 22)),
      h('div', { class: 'a-main' },
        h('b', {}, isFa() ? a.nameFa : a.name),
        h('small', {}, isFa() ? a.descFa : a.desc),
        h('div', { class: 'xpbar' }, h('div', { style: { width: `${(st.value / a.goal) * 100}%` } })),
        h('small', {}, a.goal > 100 ? '' : h('span', { dir: 'ltr' }, `${num(st.value)} / ${num(a.goal)}`), ' ', a.reward.coins ? currency('coin', a.reward.coins) : null, ' ', a.reward.gems ? currency('gem', a.reward.gems) : null,
          ...cosmeticsWhere((s) => s.t === 'ach' && s.id === a.id).map((c) => cosChip(c)))),
      st.claimed ? h('span', { class: 'tag ok' }, svg('check', 12)) :
        st.done ? h('button', { class: 'btn small gold', onclick: async () => {
          const r = await backend.claimAchievement(a.id).catch(() => null);
          if (r) rewardReveal(isFa() ? a.nameFa : a.name, [...(r.reward.coins ? [{ kind: 'coin' as const, amount: r.reward.coins }] : []), ...(r.reward.gems ? [{ kind: 'gem' as const, amount: r.reward.gems }] : [])]);
          show(achievementsScreen);
        } }, t('claim')) : null);
  }));
  const done = ACHIEVEMENTS.filter((a) => achievementState(p, a).claimed).length;
  introOnce('achievements', [
    { target: '.achs', title: L('دستاوردها', 'Achievements'), text: L('اهداف بلندمدت با جایزه بزرگ. هر کدام که کامل شد، دکمه دریافت فعال می‌شود.', 'Long-term goals with big rewards. Each one shows a Claim button when it\'s complete.') },
  ]);
  return { el: h('div', { class: 'page achievements' }, topBar({ back: home, title: `${t('achievements')} (${num(done)} ${isFa() ? 'از' : 'of'} ${num(ACHIEVEMENTS.length)})` }), h('div', { class: 'scroll' }, list)) };
}

// ============================================================================================
// Profile & stats
// ============================================================================================
export function profileScreen(): Screen {
  const p = backend.profile;
  const tier = tierFor(p.rank.mmr);
  const winRate = p.stats.matches ? Math.round((p.stats.wins / p.stats.matches) * 100) : 0;
  const box = (v: string, label: string) => h('div', { class: 'stat-box' }, h('b', {}, v), h('span', {}, label));
  const fav = Object.entries(p.fstats).sort((a, b) => b[1].m - a[1].m)[0]?.[0] ?? p.selFighter;
  const modeName: Record<string, string> = { ranked: t('ranked'), casual: t('quick'), cpu: t('vsCpu'), private: t('friends'), training: t('training') };
  const ago = (ts: number) => { const m = Math.floor((Date.now() - ts) / 60000); return m < 60 ? `${num(m)} ${t('minAgo')}` : m < 1440 ? `${num(Math.floor(m / 60))} ${t('hrAgo')}` : `${num(Math.floor(m / 1440))} ${t('dayAgo')}`; };
  const el = h('div', { class: 'page profile' },
    topBar({ back: home, title: t('profile') }),
    h('div', { class: 'scroll' },
      h('div', { class: 'profile-head' },
        frameRing(myFrame(), fighterCanvas(fav, backend.selectedSkin(fav), 96), 'big'),
        h('div', { class: 'who' },
          h('h2', {}, p.name, vipActive(p) ? vipBadge() : null),
          titleTag(equippedTitle(p)),
          h('div', { class: 'row', style: { justifyContent: 'flex-start' } },
            h('span', { class: 'tag' }, `${t('level')} ${num(p.level)}`),
            h('span', { class: 'tag', style: { color: tier.tier.color } }, `${isFa() ? tier.tier.nameFa : tier.tier.name} · ${num(p.rank.mmr)}`),
            h('span', { class: 'tag' }, `${t('peak')} ${num(p.rank.peak)}`)),
          h('div', { class: 'xpbar wide', style: { maxWidth: '320px' } }, h('div', { style: { width: `${(p.xp / xpForLevel(p.level)) * 100}%` } })),
          h('small', { class: 'muted', dir: 'ltr' }, `${num(p.xp)} / ${num(xpForLevel(p.level))} XP`)),
        h('div', { class: 'ph-actions' },
          featureUnlocked(p, 'collection') ? h('button', { class: 'btn accent small', onclick: () => import('./collection.ts').then((m) => show(() => m.collectionScreen())) }, svg('layers', 14), isFa() ? 'کلکسیون' : 'Collection') : null,
          h('button', { class: 'btn ghost small', onclick: () => show(settingsScreen) }, svg('settings', 14), t('settings'))),
      ),
      h('div', { class: 'stat-grid' },
        box(num(p.stats.matches), t('statMatches')), box(num(p.stats.wins), t('statWins')), box(`${num(winRate)}%`, t('statWinRate')),
        box(num(p.stats.kos), t('kos')), box(num(p.stats.falls), t('falls')), box(`${num(p.stats.dmg)}%`, t('damage')),
        box(num(p.stats.bestCombo), t('combo')), box(num(p.stats.flawless), t('statFlawless')), box(num(p.stats.online), t('statOnline')),
      ),
      h('div', { class: 'box' }, h('h3', {}, svg('trophy', 16), ' ', isFa() ? 'قفسه افتخارات' : 'Trophy cabinet', h('small', { class: 'muted' }, ` · ${isFa() ? 'برد لیگ' : 'league wins'} ${num(p.stats.leagueWins ?? 0)}`)),
        p.trophies.length ? h('div', { class: 'cabinet' }, p.trophies.map((tr) => {
          const tt = TIERS[tr.tier];
          return h('div', { class: 'cup', style: { '--cc': tr.place === 1 ? '#ffd23f' : tr.place === 2 ? '#d6dde8' : '#d08a52' } as any }, svg('trophy', 26),
            h('b', {}, isFa() ? PLACE_NAMES[tr.place - 1].fa : PLACE_NAMES[tr.place - 1].en),
            h('small', { style: { color: tt.color } }, isFa() ? tt.nameFa : tt.name), h('small', { class: 'muted' }, `${isFa() ? 'هفته' : 'week'} ${num(tr.week)}`));
        })) : h('p', { class: 'muted' }, isFa() ? 'هنوز جامی نداری. در لیگ هفتگی جزو سه نفر اول شو!' : 'No trophies yet. Finish top 3 in a weekly league!')),
      h('div', { class: 'two-col' },
        masteryList(),
        h('div', { class: 'box' }, h('h3', {}, svg('history', 16), ' ', t('history')),
          p.history.length ? p.history.map((m) => h('div', { class: 'hist' },
            h('span', { class: `wl ${m.won ? 'w' : 'l'}` }, m.won ? t('winShort') : t('lossShort')),
            fighterCanvas(m.fighter, 0, 32),
            h('div', {}, h('b', {}, modeName[m.mode] ?? m.mode), h('small', { class: 'muted' }, ` · ${t('kos')} ${num(m.kos)} · ${t('falls')} ${num(m.falls)}`)),
            h('small', { class: 'muted' }, ago(m.t)))) : h('p', { class: 'muted' }, t('noHistory'))),
      ),
    ),
  );
  return { el };
}

// ============================================================================================
// Leaderboard
// ============================================================================================
type LbTab = 'players' | 'wins' | 'week' | 'clans' | 'alliances';
export function leaderboardScreen(tab: LbTab = 'players'): Screen {
  const p = backend.profile;
  const fa = isFa();
  const list = h('div', { class: 'scroll narrow' }, h('div', { class: 'muted center' }, '…'));
  const names: Record<LbTab, string> = { players: fa ? 'برترین بازیکن‌ها' : 'Top players', wins: fa ? 'بیشترین برد لیگ' : 'Most league wins', week: fa ? 'لیگ این هفته' : 'This week', clans: fa ? 'برترین قبیله‌ها' : 'Top clans', alliances: fa ? 'برترین اتحادها' : 'Top alliances' };
  const tabs = h('div', { class: 'tabs' }, (Object.keys(names) as LbTab[]).map((k) => h('button', { class: `tab ${tab === k ? 'on' : ''}`, onclick: () => show(() => leaderboardScreen(k)) }, names[k])));
  const pos = (n: number) => h('span', { class: `pos ${n <= 3 ? 'p' + n : ''}` }, n <= 3 ? svg('trophy', 18) : num(n));
  const empty = (msg = t('lbEmpty')) => { list.innerHTML = ''; list.append(h('div', { class: 'muted center' }, msg)); };
  const fill = (rows: HTMLElement[]) => { list.innerHTML = ''; if (!rows.length) empty(); else list.append(...rows); };
  const fail = () => empty(backend.online || social().demo ? t('lbEmpty') : t('noLeaderboard'));
  // frames / titles / VIP: from the server row, or the player's own equipped ones for their row
  const lbFrame = (r: { id: string; frame?: string }) => r.frame ?? (r.id === p.id ? myFrame() : '');
  const lbTitle = (r: { id: string; title?: string }) => r.title ?? (r.id === p.id ? equippedTitle(p) : '');
  const lbVip = (r: { id: string; vip?: boolean }) => (r.vip ?? (r.id === p.id && vipActive(p))) ? vipBadge() : null;
  if (tab === 'players') {
    backend.leaderboard().then((rows) => fill(rows.map((r) => {
      const ti = tierFor(r.mmr);
      return h('div', { class: `lb-row ${r.id === p.id ? 'me' : ''}` }, pos(r.pos), frameRing(lbFrame(r), fighterCanvas(r.fighter, 0, 40)),
        h('div', { class: 'who' }, h('b', {}, r.name, lbVip(r), titleTag(lbTitle(r), 'sm')), h('small', {}, h('span', { style: { color: ti.tier.color } }, fa ? ti.tier.nameFa : ti.tier.name), ` · ${num(r.wins)}${t('wins')} / ${num(r.losses)}${t('losses')}`)),
        h('b', {}, num(r.mmr)));
    }))).catch(fail);
    if (!backend.online) social().winsLeaderboard().then((rows) => fill(rows.sort((a, b) => b.mmr - a.mmr).map((r, i) => {
      const ti = tierFor(r.mmr);
      return h('div', { class: `lb-row ${r.id === p.id ? 'me' : ''}` }, pos(i + 1), frameRing(lbFrame(r), fighterCanvas(r.fighter, 0, 40)),
        h('div', { class: 'who' }, h('b', {}, r.name, lbVip(r), titleTag(lbTitle(r), 'sm')), h('small', { style: { color: ti.tier.color } }, fa ? ti.tier.nameFa : ti.tier.name)), h('b', {}, num(r.mmr)));
    }))).catch(fail);
  } else if (tab === 'wins') {
    social().winsLeaderboard().then((rows) => fill(rows.map((r) => h('div', { class: `lb-row ${r.id === p.id ? 'me' : ''}` }, pos(r.pos), frameRing(lbFrame(r), fighterCanvas(r.fighter, 0, 40)),
      h('div', { class: 'who' }, h('b', {}, r.name, lbVip(r), titleTag(lbTitle(r), 'sm')), h('small', {}, `${fa ? 'جام‌ها' : 'trophies'} ${num(r.trophies)} · ${num(r.mmr)}`)),
      h('b', {}, num(r.wins), h('small', { class: 'muted' }, ` ${fa ? 'برد' : 'wins'}`)))))).catch(fail);
  } else if (tab === 'week') {
    social().weekStandings().then((w) => {
      const tt = TIERS[w.tier];
      const head = h('div', { class: 'lb-me', style: { borderColor: tt.color } }, h('b', { style: { color: tt.color } }, `${fa ? 'لیگ' : 'League'} ${fa ? tt.nameFa : tt.name} · ${fa ? 'هفته' : 'week'} ${num(w.week)}`),
        h('span', {}, `${fa ? 'رتبه تو' : 'Your rank'}: ${w.myPos ? num(w.myPos) : '—'} · ${num(w.me.pts)} ${fa ? 'امتیاز' : 'pts'}`));
      fill([head, ...w.top.map((e, i) => h('div', { class: `lb-row ${e.id === p.id ? 'me' : ''} ${i < 3 ? 'podium' : ''}` }, pos(i + 1),
        h('div', { class: 'who' }, h('b', {}, e.name), h('small', {}, `${num(e.w)}${t('wins')} / ${num(e.l)}${t('losses')}`)),
        h('b', {}, num(e.pts), h('small', { class: 'muted' }, ` ${fa ? 'امتیاز' : 'pts'}`))))]);
    }).catch(fail);
  } else if (tab === 'clans') {
    social().clanLeaderboard().then((rows) => fill(rows.map((r: any) => h('div', { class: `lb-row ${r.id === p.clan?.id ? 'me' : ''}` }, pos(r.pos),
      h('span', { class: 'lb-clan' }, svg('shield', 26)),
      h('div', { class: 'who' }, h('b', {}, r.name, h('small', { class: 'muted' }, ` [${r.tag}]`)),
        h('small', {}, `${fa ? 'سطح' : 'Lv'} ${num(r.level)} · ${num(r.members)}/15 · ${fa ? 'جام' : 'trophies'} ${num(r.trophies ?? 0)} · ${fa ? 'برد جنگ' : 'war wins'} ${num(r.warWins)}`)),
      h('b', {}, num(r.score ?? r.power)))))).catch(fail);
  } else {
    social().allianceLeaderboard().then((rows) => fill(rows.map((r) => h('div', { class: 'lb-row' }, pos(r.pos),
      h('span', { class: 'lb-clan' }, svg('handshake', 26)),
      h('div', { class: 'who' }, h('b', {}, fa ? `اتحاد ${r.name}` : `${r.name} Alliance`), h('small', { dir: 'ltr' }, r.tags.map((x) => `[${x}]`).join(' '), ` · ${num(r.clans)} · ${num(r.members)}`)),
      h('b', {}, num(r.score)))))).catch(fail);
  }
  return { el: h('div', { class: 'page leaderboard' }, topBar({ back: home, title: t('leaderboard') }), tabs, list) };
}

// ============================================================================================
// Settings
// ============================================================================================
export function settingsScreen(): Screen {
  const p = backend.profile;
  const nameIn = h('input', { class: 'input', value: p.name, maxlength: 16 }) as HTMLInputElement;
  const toggle = (label: string, on: boolean, fn: (v: boolean) => void) =>
    h('label', { class: 'toggle' }, h('span', {}, label), h('input', { type: 'checkbox', checked: on, onchange: (e: Event) => fn((e.target as HTMLInputElement).checked) }));
  const seg = <T extends string>(label: string, value: T, opts: [T, string][], fn: (v: T) => void) =>
    h('div', { class: 'field' }, h('span', {}, label), h('div', { class: 'seg' }, opts.map(([v, txt]) => h('button', { class: v === value ? 'on' : '', onclick: () => { fn(v); show(settingsScreen); } }, txt))));
  const range = (label: string, value: number, min: number, max: number, fn: (v: number) => void) =>
    h('div', { class: 'field' }, h('span', {}, label), h('input', { type: 'range', min, max, step: 0.05, value, onchange: (e: Event) => fn(Number((e.target as HTMLInputElement).value)) }));
  const codeIn = h('input', { class: 'input', placeholder: 'NEON2026', dir: 'ltr', maxlength: 24, style: { textTransform: 'uppercase' } }) as HTMLInputElement;
  const srv = h('input', { class: 'input', value: store.get('server', ''), placeholder: 'https://your-server', dir: 'ltr' }) as HTMLInputElement;
  const el = h('div', { class: 'page settings' },
    topBar({ back: home, title: t('settings') }),
    h('div', { class: 'scroll' },
      h('div', { class: 'settings-grid' },
        h('div', { class: 'field' }, h('span', {}, t('name')), nameIn,
          h('button', { class: 'btn small accent', onclick: () => { backend.saveProfile({ name: nameIn.value.trim() || p.name }); toast(t('saved'), 'ok'); } }, t('save'))),
        seg(t('language'), p.settings.lang, [['fa', 'فارسی'], ['en', 'English']], (v) => { setLang(v); backend.saveProfile({ settings: { lang: v } }); }),
        toggle(t('sound'), p.settings.sfx, (v) => { audio.setSfx(v); backend.saveProfile({ settings: { sfx: v } }); }),
        toggle(t('music'), p.settings.music, (v) => { audio.setMusic(v); if (v) audio.startMusic('menu'); backend.saveProfile({ settings: { music: v } }); }),
        seg(t('graphics'), prefs.quality, [['low', t('qLow')], ['auto', t('qAuto')], ['high', t('qHigh')]], (v) => setPref('quality', v)),
        toggle(t('vibration'), prefs.vibration, (v) => setPref('vibration', v)),
        toggle(t('dmgNumbers'), prefs.dmgNumbers, (v) => setPref('dmgNumbers', v)),
        toggle(t('leftHanded'), prefs.leftHanded, (v) => setPref('leftHanded', v)),
        range(t('btnSize'), prefs.btnScale, 0.8, 1.25, (v) => setPref('btnScale', v)),
        range(t('btnOpacity'), prefs.btnOpacity, 0.35, 1, (v) => setPref('btnOpacity', v)),
        h('div', { class: 'field' }, h('span', {}, t('removeAds')),
          adsRemoved(p) ? h('span', { class: 'tag ok' }, t('noAdsActive')) : h('button', { class: 'btn small gold', onclick: () => buyIap('no_ads', () => show(settingsScreen)) }, billing.price(IAP_PRODUCTS.find((x) => x.id === 'no_ads')!))),
        h('div', { class: 'field' }, h('span', {}, t('server')), srv,
          h('button', { class: 'btn small accent', onclick: () => { store.set('server', srv.value.trim()); location.reload(); } }, t('save'))),
      ),
      h('div', { class: 'field redeem' }, h('span', {}, svg('ticket', 16), isFa() ? 'کد هدیه / تخفیف' : 'Gift / promo code'), codeIn,
        h('button', { class: 'btn small gold', onclick: async () => {
          const code = codeIn.value.trim();
          if (!code) return;
          try {
            const g = await social().redeem(code);
            codeIn.value = '';
            rewardReveal(isFa() ? 'کد فعال شد' : 'Code redeemed', grantedToItems(g));
          } catch (e) {
            const c = (e as Error).message;
            const msg: Record<string, [string, string]> = { 'not-found': ['کد معتبر نیست', 'Invalid code'], expired: ['کد منقضی شده', 'Code expired'], 'used-up': ['ظرفیت کد تمام شده', 'Code fully used'], already: ['قبلاً استفاده کرده‌ای', 'Already used'], level: ['سطحت کافی نیست', 'Level too low'] };
            toast((msg[c] ?? ['خطا', 'Error'])[isFa() ? 0 : 1], 'err');
          }
        } }, isFa() ? 'ثبت' : 'Redeem')),
      !backend.online ? h('div', { class: 'field dev' },
        h('span', {}, svg('zap', 16), isFa() ? 'حالت تست: باز کردن همه قابلیت‌ها' : 'Test mode: unlock every feature'),
        h('input', { type: 'checkbox', checked: !!p.dev, onchange: (e: Event) => { backend.setDev((e.target as HTMLInputElement).checked); toast(t('saved'), 'ok'); } }),
        h('small', { class: 'muted' }, isFa() ? 'فقط برای بررسی نسخه آزمایشی؛ روی سرور واقعی اثری ندارد.' : 'Only for reviewing the test build; has no effect on a real server.')) : null,
      h('div', { class: 'row', style: { justifyContent: 'flex-start' } },
        h('button', { class: 'btn primary', 'data-f': 'account', onclick: () => import('./account.ts').then((m) => show(m.accountScreen)) }, svg('user', 16), isFa() ? 'حساب کاربری و بازیابی' : 'Account & recovery'),
        h('button', { class: 'btn accent', onclick: () => import('./play.ts').then((m) => m.startTutorial()) }, svg('help', 16), t('replayTutorial')),
        h('button', { class: 'btn ghost', onclick: () => { resetIntros(); toast(t('tipsReset'), 'ok'); } }, svg('refresh', 16), t('resetTips')),
      ),
      h('div', { class: 'help' }, h('b', {}, t('controls')), h('p', {}, t('keyboardHelp')), h('p', { class: 'muted' }, t('gamepadHelp'))),
      h('small', { class: 'muted' }, `ID: ${p.id} · v1.4.0 · ${backend.online ? t('online') : t('offline')}`),
    ),
  );
  return { el };
}
