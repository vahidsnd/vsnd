import { getFighter, LOGIN_REWARDS, passTier, tierFor, IAP_PRODUCTS, type QueueFormat } from '@nb/shared';
import { backend } from '../services/backend.ts';
import { billing } from '../services/billing.ts';
import { net } from '../net/net.ts';
import { h, show, topBar, fighterCanvas, modal, rewardReveal, toast, icon, type Screen } from './dom.ts';
import { t, num, isFa, loc } from '../i18n.ts';

let loginShownDay = '';
let starterShown = false;

export function homeScreen(): Screen {
  const p = backend.profile;
  const def = getFighter(p.selFighter);
  const skin = backend.selectedSkin(def.id);
  const tier = tierFor(p.rank.mmr);
  const questsReady = p.daily.quests.filter((q) => !q.claimed && q.progress >= q.target).length;
  const passReady = Math.max(0, passTier(p) - p.pass.free.length) + (p.pass.premium ? Math.max(0, passTier(p) - p.pass.prem.length) : 0);
  const badge = (n: number) => (n > 0 ? h('span', { class: 'badge' }, num(n)) : null);

  const nav = (icon: string, label: string, fn: () => void, n = 0) =>
    h('button', { class: 'nav-btn', onclick: fn }, h('span', { class: 'si' }, icon), label, badge(n));
  const bottomNav = h('nav', { class: 'bottom-nav' },
    nav('🥊', t('fighters'), () => go('fighters')),
    nav('🛒', t('shop'), () => go('shop')),
    nav('🎟', t('pass'), () => go('pass'), passReady),
    nav('📜', t('quests'), () => go('quests'), questsReady + (p.login.claimed ? 0 : 1)),
    nav('🏆', t('leaderboard'), () => go('leaderboard')),
    nav('⚙', t('settings'), () => go('settings')),
  );

  const online = backend.online;
  const hero = h('div', { class: 'hero' },
    h('div', { class: 'hero-glow' }),
    (() => { const c = fighterCanvas(def.id, skin, 180); c.addEventListener('click', () => go('fighters')); return c; })(),
    h('div', { class: 'hero-name' }, loc(def), h('small', {}, isFa() ? def.titleFa : def.title)),
    h('div', { class: 'rank-pill', style: { borderColor: tier.tier.color } },
      h('b', { style: { color: tier.tier.color } }, `${isFa() ? tier.tier.nameFa : tier.tier.name} ${tier.division ? ['', 'I', 'II', 'III'][tier.division] : ''}`),
      h('span', {}, `${num(p.rank.mmr)} · ${num(p.rank.wins)}${t('wins')} ${num(p.rank.losses)}${t('losses')}`)),
    h('div', { class: 'status' },
      h('span', { class: online ? 'dot ok' : 'dot' }),
      online ? `${t('online')}${net.online ? ` · ${num(net.online)} ${t('playersOnline')}` : ''}` : t('offline')),
  );

  const mode = (cls: string, title: string, desc: string, fn: () => void, needOnline = false) =>
    h('button', { class: `mode ${cls} ${needOnline && !online ? 'disabled' : ''}`, onclick: () => (needOnline && !online ? toast(t('offline'), 'err') : fn()) },
      h('b', {}, title), h('span', {}, desc));

  const el = h('div', { class: 'home' },
    topBar(),
    h('div', { class: 'home-main' },
      hero,
      h('button', { class: 'btn play', onclick: () => (online ? queue('casual', '1v1') : cpu()) }, t('play'), h('small', {}, online ? t('quick') + ' 1v1' : t('vsCpu'))),
      h('div', { class: 'modes' },
        mode('m-ranked', t('ranked'), t('rankedDesc'), () => queue('ranked', '1v1'), true),
        mode('m-quick', t('quick'), t('quickDesc'), () => pickFormat(), true),
        mode('m-friends', t('friends'), t('friendsDesc'), () => import('./play.ts').then((m) => show(m.roomScreen)), true),
        mode('m-cpu', t('vsCpu'), t('vsCpuDesc'), cpu),
        mode('m-train', t('training'), t('trainingDesc'), () => import('./play.ts').then((m) => m.startTraining())),
      ),
    ),
    bottomNav,
    p.noAds ? null : h('div', { class: 'ad-slot' }),
  );

  // popups: daily login, then starter offer
  setTimeout(() => {
    if (!p.login.claimed && loginShownDay !== p.daily.day) { loginShownDay = p.daily.day; loginPopup(); }
    else if (!starterShown && !p.offers.starter && p.stats.matches >= 2) { starterShown = true; starterPopup(); }
  }, 400);

  return { el, bannerAd: true };
}

function go(where: 'fighters' | 'shop' | 'pass' | 'quests' | 'leaderboard' | 'settings') {
  import('./meta.ts').then((m) => {
    const map = { fighters: m.fightersScreen, shop: () => m.shopScreen(), pass: m.passScreen, quests: m.questsScreen, leaderboard: m.leaderboardScreen, settings: m.settingsScreen };
    show(map[where]);
  });
}

function queue(mode: 'ranked' | 'casual', format: QueueFormat) {
  import('./play.ts').then((m) => show(() => m.matchmakingScreen(mode, format)));
}
function cpu() { import('./play.ts').then((m) => show(m.cpuSetupScreen)); }

function pickFormat() {
  const pick = (f: QueueFormat) => { md.close(); queue('casual', f); };
  const md = modal(h('div', { class: 'pick' },
    h('h2', {}, t('quick')),
    h('button', { class: 'btn primary big', onclick: () => pick('1v1') }, '1 v 1'),
    h('button', { class: 'btn primary big', onclick: () => pick('2v2') }, '2 v 2'),
    h('button', { class: 'btn primary big', onclick: () => pick('ffa') }, t('ffa')),
  ));
}

export function loginPopup() {
  const p = backend.profile;
  const days = LOGIN_REWARDS.map((r, i) => {
    const d = i + 1;
    const state = d < p.login.streak ? 'done' : d === p.login.streak ? (p.login.claimed ? 'done' : 'today') : 'next';
    return h('div', { class: `day ${state}` }, h('small', {}, `${t('day')} ${num(d)}`),
      r.gems ? h('span', {}, icon('gem'), num(r.gems)) : null, r.coins ? h('span', {}, icon('coin'), num(r.coins)) : null);
  });
  const m = modal(h('div', { class: 'login' },
    h('h2', { class: 'shine' }, t('dailyLogin')),
    h('div', { class: 'days' }, days),
    h('button', { class: 'btn primary big wide', disabled: p.login.claimed, onclick: async () => {
      const r = await backend.claimLogin().catch(() => null);
      m.close();
      if (r) rewardReveal(t('dailyLogin'), [...(r.coins ? [{ kind: 'coin' as const, amount: r.coins }] : []), ...(r.gems ? [{ kind: 'gem' as const, amount: r.gems }] : [])]);
      show(homeScreen);
    } }, t('claim')),
  ));
}

export function starterPopup() {
  const prod = IAP_PRODUCTS.find((x) => x.id === 'starter_pack')!;
  const m = modal(h('div', { class: 'offer' },
    h('div', { class: 'ribbon' }, t('limited')),
    h('h2', { class: 'shine' }, t('starterTitle')),
    h('div', { class: 'offer-art' }, fighterCanvas('zephyr', 0, 120), fighterCanvas('blaze', 1, 120)),
    h('p', {}, t('starterDesc')),
    h('div', { class: 'badge-big' }, isFa() ? prod.badgeFa : prod.badge),
    h('button', { class: 'btn primary big', onclick: async () => {
      const ok = await billing.buy(prod.id);
      if (ok) { m.close(); rewardReveal(t('purchaseOk'), [{ kind: 'fighter', id: 'zephyr' }, { kind: 'gem', amount: 300 }, { kind: 'coin', amount: 5000 }]); show(homeScreen); }
      else toast(t('purchaseFail'), 'err');
    } }, billing.price(prod)),
  ), { cls: 'offer-modal' });
}
