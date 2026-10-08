import {
  CRATE_ODDS, FIGHTERS, IAP_PRODUCTS, PASS_TIERS, PASS_XP_PER_TIER, passReward, passTier, seasonEndsAt, shopCatalog,
  skinPrice, tierFor, getFighter, dayKey, type PassReward, type FighterDef,
} from '@nb/shared';
import { backend } from '../services/backend.ts';
import { billing } from '../services/billing.ts';
import { ads } from '../services/ads.ts';
import { audio } from '../game/audio.ts';
import { store } from '../services/platform.ts';
import { setLang, t, num, isFa, loc, duration } from '../i18n.ts';
import { h, show, topBar, fighterCanvas, modal, toast, rewardReveal, crateToItems, icon, currency, confirmBox, getFighterBySkin, type Screen, type Child } from './dom.ts';
import { homeScreen } from './home.ts';

const home = () => show(homeScreen);

// ============================================================================================
// Fighters
// ============================================================================================
const MOVES: Record<string, { fa: string[]; en: string[] }> = {
  blaze: { fa: ['B: گلوله آتش', '→B: یورش شعله', '↑B: آپرکات آتشین', '↓B: کوبش هوایی'], en: ['B: Fireball', '→B: Flame Dash', '↑B: Rising Flame', '↓B: Meteor Drop'] },
  boulder: { fa: ['B: پرتاب سنگ', '→B: شانه‌زنی زره‌دار', '↑B: پرش موشکی', '↓B: زمین‌لرزه'], en: ['B: Rock Toss', '→B: Armored Charge', '↑B: Rocket Hop', '↓B: Quake Stomp'] },
  zephyr: { fa: ['B: تندباد', '→B: پر تیز', '↑B: اوج‌گیری', '↓B: گردباد'], en: ['B: Gust', '→B: Feather Dart', '↑B: Updraft', '↓B: Tornado Spin'] },
  volt: { fa: ['B: گوی برقی', '→B: جهش صاعقه', '↑B: تله‌پورت', '↓B: میدان مغناطیسی'], en: ['B: Spark Orb', '→B: Zap Dash', '↑B: Teleport', '↓B: Magnet Burst'] },
  kira: { fa: ['B: شوریکن', '→B: ضربه پرشی', '↑B: برش صعودی', '↓B: ضدحمله'], en: ['B: Shuriken', '→B: Lunge', '↑B: Rising Slash', '↓B: Counter'] },
  pip: { fa: ['B: بمب', '→B: غلت‌زدن', '↑B: بادکنک', '↓B: مین'], en: ['B: Bomb', '→B: Roll Out', '↑B: Balloon', '↓B: Mine'] },
};

export function fightersScreen(selected = backend.profile.selFighter): Screen {
  const p = backend.profile;
  const def = getFighter(selected);
  const owned = p.fighters.includes(def.id);
  const curSkin = backend.selectedSkin(def.id);

  const grid = h('div', { class: 'fgrid' }, FIGHTERS.map((f) => {
    const own = p.fighters.includes(f.id);
    return h('button', { class: `fcard ${f.id === def.id ? 'sel' : ''} ${own ? '' : 'locked'}`, onclick: () => show(() => fightersScreen(f.id)) },
      fighterCanvas(f.id, backend.selectedSkin(f.id), 84),
      h('b', {}, loc(f)),
      own ? (p.selFighter === f.id ? h('span', { class: 'tag ok' }, '✓') : null) : h('span', { class: 'tag' }, '🔒'));
  }));

  const stat = (label: string, v: number) => h('div', { class: 'stat' }, h('span', {}, label), h('div', { class: 'sbar' }, h('div', { style: { width: `${Math.round(v * 100)}%` } })));
  const s = def.stats;
  const stats = h('div', { class: 'stats' },
    stat(isFa() ? 'وزن' : 'Weight', (s.weight - 60) / 75),
    stat(isFa() ? 'سرعت' : 'Speed', (s.run - 5.5) / 3.2),
    stat(isFa() ? 'هوا' : 'Air', (s.airSpeed - 4 + s.airJumps * 0.4) / 4),
    stat(isFa() ? 'قدرت' : 'Power', def.archetype === 'heavy' ? 0.95 : def.archetype === 'swordie' ? 0.75 : def.archetype === 'allrounder' ? 0.65 : 0.5),
  );

  const skins = h('div', { class: 'skins' }, def.skins.map((sk, i) => {
    const has = i === 0 || p.skins.includes(sk.id);
    const price = skinPrice(i);
    return h('button', {
      class: `skin ${i === curSkin ? 'sel' : ''} ${has ? '' : 'locked'}`, style: { background: `linear-gradient(135deg, ${sk.main}, ${sk.second})` },
      onclick: async () => {
        if (has) { if (owned) backend.saveProfile({ selSkin: { fighter: def.id, idx: i } }); show(() => fightersScreen(def.id)); return; }
        if (!price) { toast(isFa() ? 'فقط در پاس فصل' : 'Season Pass exclusive'); return; }
        if (await confirmBox(`${loc(sk)} — ${price.coins ? num(price.coins) + ' ' + t('coins') : num(price.gems!) + ' ' + t('gems')}`)) {
          const r = await backend.buy(`skin:${sk.id}`);
          if (r.ok) { audio.coin(); toast(t('purchaseOk'), 'ok'); } else toast(t('notEnough'), 'err');
          show(() => fightersScreen(def.id));
        }
      },
    }, has ? null : h('span', {}, price ? (price.coins ? '🪙' : '💎') : '🎟'), h('small', {}, loc(sk)));
  }));

  const actions: Child[] = [];
  if (owned) {
    actions.push(h('button', { class: `btn primary big ${p.selFighter === def.id ? 'disabled' : ''}`, onclick: () => { backend.saveProfile({ selFighter: def.id }); show(() => fightersScreen(def.id)); } }, p.selFighter === def.id ? t('selected') : t('select')));
  } else {
    const buy = async (cur: 'coins' | 'gems') => {
      const r = await backend.buy(`fighter:${def.id}:${cur}`);
      if (r.ok) { rewardReveal(t('purchaseOk'), [{ kind: 'fighter', id: def.id }]); backend.saveProfile({ selFighter: def.id }); show(() => fightersScreen(def.id)); }
      else toast(t('notEnough'), 'err');
    };
    actions.push(h('button', { class: 'btn primary', onclick: () => buy('coins') }, icon('coin'), num(def.price.coins)));
    actions.push(h('button', { class: 'btn gem', onclick: () => buy('gems') }, icon('gem'), num(def.price.gems)));
    actions.push(h('button', { class: 'btn ad', onclick: async () => {
      if (await ads.rewarded('trial')) import('./play.ts').then((m) => m.startCpuMatch({ fighter: def.id, skin: 0, trial: true }));
    } }, '▶ ', t('tryWithAd')));
  }

  const detail = h('div', { class: 'fdetail' },
    h('div', { class: 'fd-art' }, fighterCanvas(def.id, curSkin, 220)),
    h('div', { class: 'fd-info' },
      h('h2', {}, loc(def), ' ', h('small', {}, isFa() ? def.titleFa : def.title)),
      stats,
      h('ul', { class: 'moves' }, (isFa() ? MOVES[def.id].fa : MOVES[def.id].en).map((m) => h('li', {}, m))),
      skins,
      h('div', { class: 'row' }, actions),
    ),
  );

  return { el: h('div', { class: 'page fighters' }, topBar({ back: home, title: t('fighters') }), h('div', { class: 'split' }, grid, detail)) };
}

// ============================================================================================
// Shop
// ============================================================================================
type ShopTab = 'featured' | 'gems' | 'fighters' | 'skins' | 'coins' | 'crates';

export function shopScreen(tab: ShopTab = 'featured'): Screen {
  const tabs: ShopTab[] = ['featured', 'gems', 'fighters', 'skins', 'coins', 'crates'];
  const label: Record<ShopTab, string> = { featured: t('featured'), gems: t('gemsTab'), fighters: t('fightersTab'), skins: t('skinsTab'), coins: t('coinsTab'), crates: t('crates') };
  const body = h('div', { class: 'shop-body' }, renderShopTab(tab));
  const el = h('div', { class: 'page shop' },
    topBar({ back: home, title: t('shop') }),
    h('div', { class: 'tabs' }, tabs.map((x) => h('button', { class: `tab ${x === tab ? 'on' : ''}`, onclick: () => show(() => shopScreen(x)) }, label[x]))),
    body,
  );
  return { el };
}

async function buyIap(id: string, after?: () => void) {
  const ok = await billing.buy(id);
  if (ok) { audio.reward(); toast(t('purchaseOk'), 'ok'); after?.(); }
  else toast(t('purchaseFail'), 'err');
}

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
    h('div', { class: 'card-art crate-art' }, '📦'),
    h('b', {}, t('freeCrate')),
    left > 0
      ? h('button', { class: 'btn disabled' }, `${t('readyIn')} ${duration(left)}`)
      : h('button', { class: 'btn ad', onclick: async () => {
        if (!(await ads.rewarded('crate'))) return;
        const c = await backend.freeCrate().catch(() => null);
        if (c) rewardReveal(t('youGot'), crateToItems(c));
        show(() => shopScreen('crates'));
      } }, '▶ ', t('watchAd')),
  );
}

function renderShopTab(tab: ShopTab): Child {
  const p = backend.profile;
  const cat = shopCatalog();
  switch (tab) {
    case 'featured': return h('div', { class: 'cards' },
      !p.offers.starter ? iapCard('starter_pack', h('div', { class: 'duo' }, fighterCanvas('zephyr', 0, 90), fighterCanvas('blaze', 1, 90)), 'hot') : null,
      !p.pass.premium ? iapCard('season_pass', h('div', { class: 'big-emoji' }, '🎟')) : null,
      !p.noAds ? iapCard('no_ads', h('div', { class: 'big-emoji' }, '🚫📺')) : h('div', { class: 'card' }, h('b', {}, t('noAdsActive'))),
      p.fighters.length < FIGHTERS.length ? iapCard('all_fighters', h('div', { class: 'duo' }, fighterCanvas('kira', 0, 80), fighterCanvas('pip', 0, 80))) : null,
      h('div', { class: 'card' },
        h('div', { class: 'card-art big-emoji' }, '🪙'),
        h('b', {}, t('watchForCoins')),
        h('button', { class: 'btn ad', onclick: async () => {
          if (!(await ads.rewarded('coins'))) return;
          const g = await backend.adReward('coins').catch(() => 0);
          if (g) { audio.coin(); toast(`+${num(g)} ${t('coins')}`, 'ok'); }
          else toast(isFa() ? 'سقف روزانه' : 'Daily limit reached', 'err');
        } }, '▶ ', t('bonusCoins'))),
      freeCrateCard(),
    );
    case 'gems': return h('div', { class: 'cards' },
      IAP_PRODUCTS.filter((x) => x.id.startsWith('gems_')).map((x, i) => iapCard(x.id, h('div', { class: 'gem-pile', style: { '--n': String(i + 1) } as any }, '💎'.repeat(Math.min(5, i + 1))))));
    case 'fighters': return h('div', { class: 'cards' }, FIGHTERS.filter((f) => f.price.coins).map((f) => {
      const own = p.fighters.includes(f.id);
      return h('div', { class: 'card' },
        h('div', { class: 'card-art' }, fighterCanvas(f.id, 0, 110)),
        h('b', {}, loc(f)),
        own ? h('span', { class: 'tag ok' }, t('owned')) : h('div', { class: 'row' },
          h('button', { class: 'btn primary small', onclick: () => buyCat(`fighter:${f.id}:coins`, 'fighters', { kind: 'fighter', id: f.id }) }, icon('coin'), num(f.price.coins)),
          h('button', { class: 'btn gem small', onclick: () => buyCat(`fighter:${f.id}:gems`, 'fighters', { kind: 'fighter', id: f.id }) }, icon('gem'), num(f.price.gems))));
    }));
    case 'skins': return h('div', { class: 'cards' }, cat.filter((i) => i.kind === 'skin').map((i) => {
      const sk = getFighterBySkin(i.ref!)!;
      const own = p.skins.includes(i.ref!);
      const sdef = getFighter(sk.f).skins[sk.idx];
      return h('div', { class: 'card' },
        h('div', { class: 'card-art' }, fighterCanvas(sk.f, sk.idx, 100)),
        h('b', {}, `${loc(getFighter(sk.f))} · ${loc(sdef)}`),
        own ? h('span', { class: 'tag ok' }, t('owned')) :
          h('button', { class: `btn ${i.cost.gems ? 'gem' : 'primary'} small`, onclick: () => buyCat(i.id, 'skins', { kind: 'skin', id: i.ref! }) },
            icon(i.cost.gems ? 'gem' : 'coin'), num(i.cost.gems ?? i.cost.coins ?? 0)));
    }));
    case 'coins': return h('div', { class: 'cards' }, cat.filter((i) => i.kind === 'coins').map((i) => h('div', { class: 'card' },
      h('div', { class: 'card-art big-emoji' }, '🪙'.repeat(i.amount! >= 12000 ? 3 : i.amount! >= 5000 ? 2 : 1)),
      h('b', {}, currency('coin', i.amount!)),
      h('button', { class: 'btn gem small', onclick: () => buyCat(i.id, 'coins', { kind: 'coin', amount: i.amount }) }, icon('gem'), num(i.cost.gems!)))));
    case 'crates': return h('div', { class: 'cards' },
      freeCrateCard(),
      h('div', { class: 'card' },
        h('div', { class: 'card-art crate-art' }, '🎁'),
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
    h('p', { class: 'muted' }, isFa() ? 'آیتم تکراری به سکه تبدیل می‌شود.' : 'Duplicates convert to coins.')));
}

// ============================================================================================
// Season pass
// ============================================================================================
export function passScreen(): Screen {
  const p = backend.profile;
  const tier = passTier(p);
  const into = p.pass.xp - tier * PASS_XP_PER_TIER;
  const rewardView = (r: PassReward): Child => {
    if (r.skin) { const s = getFighterBySkin(r.skin); return s ? fighterCanvas(s.f, s.idx, 64) : '🎨'; }
    if (r.crate) return h('div', { class: 'big-emoji' }, '🎁');
    if (r.gems) return h('div', {}, icon('gem'), num(r.gems));
    return h('div', {}, icon('coin'), num(r.coins ?? 0));
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
        locked ? h('span', { class: 'lock' }, '🔒') : claimed ? h('span', { class: 'check' }, '✓') :
          reached ? h('button', { class: 'btn small primary', onclick: () => claim(i, premium) }, t('claim')) : null);
    };
    cols.push(h('div', { class: `pcol ${reached ? 'reached' : ''}` }, h('div', { class: 'pnum' }, num(i)), cell(false), cell(true)));
  }
  const prod = IAP_PRODUCTS.find((x) => x.id === 'season_pass')!;
  const el = h('div', { class: 'page pass' },
    topBar({ back: home, title: `${t('pass')} · ${t('newSeason')} ${num(p.pass.season)}` }),
    h('div', { class: 'pass-head' },
      h('div', {}, h('b', {}, `${t('tier')} ${num(tier)}/${num(PASS_TIERS)}`),
        h('div', { class: 'xpbar wide' }, h('div', { style: { width: `${tier >= PASS_TIERS ? 100 : (into / PASS_XP_PER_TIER) * 100}%` } })),
        h('small', { class: 'muted' }, `${t('seasonEnds')}: ${duration(seasonEndsAt(Date.now()) - Date.now())}`)),
      p.pass.premium ? h('span', { class: 'tag ok' }, t('premium') + ' ✓')
        : h('button', { class: 'btn gold big', onclick: () => buyIap('season_pass', () => show(passScreen)) }, t('unlockPremium'), ' · ', billing.price(prod)),
    ),
    h('div', { class: 'ptrack' }, h('div', { class: 'plabels' }, h('div', {}), h('div', {}, t('free')), h('div', {}, t('premium'))), h('div', { class: 'pscroll' }, cols)),
  );
  requestAnimationFrame(() => { const sc = el.querySelector('.pscroll') as HTMLElement; const target = sc?.children[Math.max(0, tier - 2)] as HTMLElement; target?.scrollIntoView({ inline: 'start', block: 'nearest' }); });
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
        h('small', {}, `${num(q.progress)} / ${num(q.target)}`)),
      h('div', { class: 'q-reward' }, currency('coin', q.reward.coins), q.reward.gems ? currency('gem', q.reward.gems) : null),
      q.claimed ? h('span', { class: 'tag ok' }, t('claimed')) :
        done ? h('button', { class: 'btn primary', onclick: async () => {
          const r = await backend.claimQuest(i).catch(() => null);
          if (r) rewardReveal(t('questDone'), [{ kind: 'coin', amount: r.reward.coins }, ...(r.reward.gems ? [{ kind: 'gem' as const, amount: r.reward.gems }] : [])]);
          show(questsScreen);
        } }, t('claim')) :
          h('button', { class: `btn small ${p.daily.rerolls > 0 ? '' : 'ad'}`, onclick: async () => {
            const viaAd = p.daily.rerolls <= 0;
            if (viaAd && !(await ads.rewarded('reroll'))) return;
            await backend.rerollQuest(i, viaAd).catch(() => toast('…', 'err'));
            show(questsScreen);
          } }, p.daily.rerolls > 0 ? `↻ ${t('reroll')} (${t('free')})` : `▶ ${t('reroll')}`),
    );
  });
  const el = h('div', { class: 'page quests' },
    topBar({ back: home, title: t('quests') }),
    h('div', { class: 'quests-body' },
      h('div', { class: 'row space' }, h('h3', {}, t('dailyQuests')), h('small', { class: 'muted' }, `${t('resetIn')} ${duration(nextReset - Date.now())}`)),
      cards,
      h('button', { class: 'btn ghost', onclick: () => import('./home.ts').then((m) => m.loginPopup()) }, '📅 ', t('dailyLogin'), p.login.claimed ? ' ✓' : ' •'),
    ),
  );
  return { el };
}

// ============================================================================================
// Leaderboard
// ============================================================================================
export function leaderboardScreen(): Screen {
  const p = backend.profile;
  const tier = tierFor(p.rank.mmr);
  const list = h('div', { class: 'lb-list' }, h('div', { class: 'muted center' }, '…'));
  backend.leaderboard().then((rows) => {
    list.innerHTML = '';
    if (!rows.length) { list.append(h('div', { class: 'muted center' }, backend.online ? '—' : t('noLeaderboard'))); return; }
    for (const r of rows) {
      const ti = tierFor(r.mmr);
      list.append(h('div', { class: `lb-row ${r.id === p.id ? 'me' : ''}` },
        h('span', { class: 'pos' }, r.pos <= 3 ? ['🥇', '🥈', '🥉'][r.pos - 1] : num(r.pos)),
        fighterCanvas(r.fighter, 0, 40),
        h('b', {}, r.name), h('span', { style: { color: ti.tier.color } }, isFa() ? ti.tier.nameFa : ti.tier.name),
        h('span', {}, num(r.mmr)), h('small', { class: 'muted' }, `${num(r.wins)}${t('wins')} / ${num(r.losses)}${t('losses')}`)));
    }
  }).catch(() => { list.innerHTML = ''; list.append(h('div', { class: 'muted center' }, t('noLeaderboard'))); });
  const el = h('div', { class: 'page leaderboard' },
    topBar({ back: home, title: t('leaderboard') }),
    h('div', { class: 'lb-me', style: { borderColor: tier.tier.color } },
      h('b', { style: { color: tier.tier.color } }, isFa() ? tier.tier.nameFa : tier.tier.name),
      h('span', {}, `${t('mmr')}: ${num(p.rank.mmr)} · ${t('wins')} ${num(p.rank.wins)} · ${t('losses')} ${num(p.rank.losses)}`)),
    list);
  return { el };
}

// ============================================================================================
// Settings
// ============================================================================================
export function settingsScreen(): Screen {
  const p = backend.profile;
  const nameIn = h('input', { class: 'input', value: p.name, maxlength: 16 }) as HTMLInputElement;
  const toggle = (label: string, on: boolean, fn: (v: boolean) => void) =>
    h('label', { class: 'toggle' }, h('span', {}, label), h('input', { type: 'checkbox', checked: on, onchange: (e: Event) => fn((e.target as HTMLInputElement).checked) }));
  const el = h('div', { class: 'page settings' },
    topBar({ back: home, title: t('settings') }),
    h('div', { class: 'settings-body' },
      h('div', { class: 'field' }, h('span', {}, t('name')), nameIn,
        h('button', { class: 'btn small primary', onclick: () => { backend.saveProfile({ name: nameIn.value.trim() || p.name }); toast('✓', 'ok'); } }, t('save'))),
      h('div', { class: 'field' }, h('span', {}, t('language')),
        h('button', { class: `btn small ${isFa() ? 'primary' : ''}`, onclick: () => { setLang('fa'); backend.saveProfile({ settings: { lang: 'fa' } }); show(settingsScreen); } }, 'فارسی'),
        h('button', { class: `btn small ${!isFa() ? 'primary' : ''}`, onclick: () => { setLang('en'); backend.saveProfile({ settings: { lang: 'en' } }); show(settingsScreen); } }, 'English')),
      toggle(t('sound'), p.settings.sfx, (v) => { audio.setSfx(v); backend.saveProfile({ settings: { sfx: v } }); }),
      toggle(t('music'), p.settings.music, (v) => { audio.setMusic(v); if (v) audio.startMusic('menu'); backend.saveProfile({ settings: { music: v } }); }),
      h('div', { class: 'field' }, h('span', {}, t('removeAds')),
        p.noAds ? h('span', { class: 'tag ok' }, t('noAdsActive')) : h('button', { class: 'btn small gold', onclick: () => buyIap('no_ads', () => show(settingsScreen)) }, billing.price(IAP_PRODUCTS.find((x) => x.id === 'no_ads')!))),
      (() => {
        const srv = h('input', { class: 'input', value: store.get('server', ''), placeholder: 'https://your-server:8787', dir: 'ltr', style: { flex: '1' } }) as HTMLInputElement;
        return h('div', { class: 'field' }, h('span', {}, isFa() ? 'سرور' : 'Server'), srv,
          h('button', { class: 'btn small primary', onclick: () => { store.set('server', srv.value.trim()); location.reload(); } }, t('save')));
      })(),
      h('div', { class: 'help' }, h('b', {}, t('controls')), h('p', {}, t('keyboardHelp')), h('p', { class: 'muted' }, 'Gamepad: A attack · B special · X/Y jump · RB shield · LB grab · right stick smash')),
      h('div', { class: 'help' }, h('b', {}, t('howToPlay')), h('ul', {}, ['tutorial1', 'tutorial2', 'tutorial3', 'tutorial4'].map((k) => h('li', {}, t(k))))),
      h('small', { class: 'muted' }, `ID: ${p.id} · v1.0.0 · ${backend.online ? t('online') : t('offline')}`),
    ),
  );
  return { el };
}

export type { FighterDef };
