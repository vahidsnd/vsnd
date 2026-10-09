import {
  getFighter, LOGIN_REWARDS, passTier, tierFor, IAP_PRODUCTS, claimableAchievements, featureUnlocked, featureRequirement,
  claimableMilestones, claimableLeague, unreadMail, wheelState, dayKey, MAP_SIZE, romanDiv, fighterPower,
  type FeatureId, type QueueFormat,
} from '@nb/shared';
import { backend } from '../services/backend.ts';
import { billing } from '../services/billing.ts';
import { net } from '../net/net.ts';
import { h, show, topBar, fighterCanvas, modal, rewardReveal, toast, icon, lockText, type Screen } from './dom.ts';
import { svg } from './icons.ts';
import { checkUnlocks, onboarding, silenceExistingUnlocks } from './tutorial.ts';
import { social } from '../services/social.ts';
import { t, num, isFa, loc } from '../i18n.ts';

let loginShownDay = '';
let starterShown = false;
let onboardChecked = false;

export function homeScreen(): Screen {
  const p = backend.profile;
  const def = getFighter(p.selFighter);
  const skin = backend.selectedSkin(def.id);
  const tier = tierFor(p.rank.mmr);
  const open = (f: FeatureId) => featureUnlocked(p, f);
  const questsReady = p.daily.quests.filter((q) => !q.claimed && q.progress >= q.target).length;
  const passReady = Math.max(0, passTier(p) - p.pass.free.length) + (p.pass.premium ? Math.max(0, passTier(p) - p.pass.prem.length) : 0);
  const achReady = claimableAchievements(p);
  const msReady = claimableMilestones(p);
  const leagueReady = claimableLeague(p);
  const mail = unreadMail(p);
  const wheelFree = wheelState(p, dayKey(Date.now())).free;
  const staff = (() => { try { return social().staffRole(); } catch { return null; } })();
  const badge = (n: number) => (n > 0 ? h('span', { class: 'badge' }, num(n)) : null);

  const locked = (f: FeatureId) => toast(`${t('unlocksAt')} ${lockText(featureRequirement(f))}`, 'info');
  const sideBtn = (id: string, ico: string, label: string, fn: () => void, feature?: FeatureId, n = 0) => {
    const isOpen = !feature || open(feature);
    return h('button', { class: `side-btn ${isOpen ? '' : 'locked'}`, 'data-f': id, onclick: () => (isOpen ? fn() : locked(feature!)) },
      svg(isOpen ? ico : 'lock', 18), label,
      isOpen ? badge(n) : h('span', { class: 'req' }, lockText(featureRequirement(feature!))));
  };

  const fa = isFa();
  const side = h('nav', { class: 'side' },
    sideBtn('fighters', 'fighters', t('fighters'), () => go('fighters')),
    sideBtn('spells', 'sparkles', fa ? 'جادو' : 'Spells', () => progress((m) => m.spellsScreen()), 'spells'),
    sideBtn('shop', 'shop', t('shop'), () => go('shop'), 'shop'),
    sideBtn('quests', 'quests', t('quests'), () => go('quests'), 'quests', questsReady + msReady + (p.login.claimed ? 0 : 1)),
    sideBtn('pass', 'pass', t('pass'), () => go('pass'), 'pass', passReady),
    sideBtn('achievements', 'medal', t('achievements'), () => go('achievements'), 'achievements', achReady),
    sideBtn('league', 'trophy', fa ? 'لیگ' : 'League', () => progress((m) => m.leagueScreen()), 'ranked', leagueReady),
    sideBtn('leaderboard', 'star', t('leaderboard'), () => go('leaderboard')),
    staff ? sideBtn('police', 'police', fa ? 'پلیس بازی' : 'Game Police', () => import('./police.ts').then((m) => show(m.policeScreen))) : null,
    sideBtn('settings', 'settings', t('settings'), () => go('settings')),
  );
  const tool = (id: string, ico: string, label: string, fn: () => void, n = 0, feature?: FeatureId) => {
    const isOpen = !feature || open(feature);
    return h('button', { class: `tool ${isOpen ? '' : 'locked'}`, 'data-f': id, title: label, 'aria-label': label, onclick: () => (isOpen ? fn() : locked(feature!)) }, svg(isOpen ? ico : 'lock', 18), isOpen ? badge(n) : null);
  };
  const tools = h('div', { class: 'hero-tools' },
    tool('chat', 'chat', fa ? 'چت' : 'Chat', () => import('./chat.ts').then((m) => m.openChat()), 0, 'chat'),
    tool('inbox', 'mail', fa ? 'صندوق پیام' : 'Inbox', () => progress((m) => m.inboxScreen()), mail),
    tool('wheel', 'wheel', fa ? 'گردونه شانس' : 'Lucky wheel', () => progress((m) => m.wheelModal(() => show(homeScreen))), wheelFree ? 1 : 0, 'wheel'),
  );

  const hero = h('div', { class: 'hero' },
    h('div', { class: 'hero-glow' }),
    tools,
    (() => { const c = fighterCanvas(def.id, skin, 230); c.addEventListener('click', () => go('fighters')); return c; })(),
    h('div', { class: 'hero-name' }, loc(def), h('small', {}, isFa() ? def.titleFa : def.title, open('cards') ? ` · ${fa ? 'قدرت' : 'Power'} ${num(fighterPower(p, def.id))}` : '')),
    h('div', { class: 'rank-pill', style: { borderColor: tier.tier.color } },
      h('b', { style: { color: tier.tier.color } }, `${isFa() ? tier.tier.nameFa : tier.tier.name} ${tier.division ? romanDiv(tier.division) : ''}`),
      h('span', {}, `${num(p.rank.mmr)} · ${num(p.rank.wins)}${t('wins')} ${num(p.rank.losses)}${t('losses')}`)),
    h('div', { class: 'status' },
      h('span', { class: backend.online ? 'dot ok' : 'dot' }),
      backend.online ? `${t('online')}${net.online ? ` · ${num(net.online)} ${t('playersOnline')}` : ''}` : t('offline')),
  );

  const online = backend.online;
  const onlineOpen = open('online');
  const mapDone = p.map.cleared >= MAP_SIZE;
  const nextNode = Math.min(p.map.cleared, MAP_SIZE - 1);
  const mode = (cls: string, ico: string, title: string, desc: string, fn: () => void, opts: { online?: boolean; feature?: FeatureId } = {}) => {
    const isLocked = opts.feature && !open(opts.feature);
    const off = opts.online && !online;
    return h('button', {
      class: `mode ${cls} ${isLocked ? 'locked' : ''} ${off ? 'offline' : ''}`,
      onclick: () => (isLocked ? locked(opts.feature!) : off ? toast(t('offline'), 'err') : fn()),
    }, svg(isLocked ? 'lock' : ico, 20), h('b', {}, title), h('span', {}, desc),
      isLocked ? h('span', { class: 'tag lock' }, lockText(featureRequirement(opts.feature!))) : null);
  };

  const playBtn = onlineOpen && online
    ? h('button', { class: 'btn play', onclick: () => queue('casual', '1v1') }, t('play'), h('small', {}, t('quick') + ' 1v1'))
    : !mapDone
      ? h('button', { class: 'btn play', 'data-f': 'mapplay', onclick: () => import('./play.ts').then((m) => m.startMapNode(nextNode)) }, t('play'), h('small', {}, fa ? `نقشه · مرحله ${num(nextNode + 1)}` : `Map · stage ${num(nextNode + 1)}`))
      : h('button', { class: 'btn play', onclick: cpu }, t('play'), h('small', {}, t('vsCpu')));
  const modes = h('div', { class: 'modes' },
    playBtn,
    h('div', { class: 'mode-grid' },
      mode('m-map', 'map', fa ? 'نقشه جهان' : 'World map', `${num(Math.min(p.map.cleared, MAP_SIZE))}/${num(MAP_SIZE)}`, () => progress((m) => m.mapScreen())),
      mode('m-ranked', 'trophy', fa ? 'لیگ' : 'League', t('rankedDesc'), () => queue('ranked', '1v1'), { online: true, feature: 'ranked' }),
      mode('m-quick', 'globe', t('quick'), t('quickDesc'), () => pickFormat(), { online: true, feature: 'online' }),
      mode('m-clan', 'shield', fa ? 'قبیله' : 'Clan', p.clan ? `[${p.clan.tag}] ${p.clan.name}` : (fa ? 'جنگ، اتحاد، چت' : 'Wars, allies, chat'), () => import('./clan.ts').then((m) => show(m.clanScreen)), { feature: 'clans' }),
      mode('m-friends', 'users', t('friends'), t('friendsDesc'), () => import('./play.ts').then((m) => show(m.roomScreen)), { online: true, feature: 'friends' }),
      mode('m-cpu', 'bot', t('vsCpu'), t('vsCpuDesc'), cpu),
      mode('m-train', 'target', t('training'), t('trainingDesc'), () => import('./play.ts').then((m) => m.startTraining())),
    ),
  );

  const el = h('div', { class: 'home' },
    topBar(),
    h('div', { class: 'home-body' }, side, hero, modes),
    p.noAds ? null : h('div', { class: 'ad-slot' }),
  );

  // first launch → onboarding; afterwards: unlock popups, daily login, starter offer.
  // Waits until no other window (e.g. a reward) is open so popups never stack.
  const popups = () => {
    if (!el.isConnected || document.querySelector('.game')) return;
    if (backend.tampered) { backend.tampered = false; toast(isFa() ? 'فایل ذخیره بازی دستکاری شده بود؛ سکه و الماس بازنشانی شد.' : 'The save file was edited outside the game; coins and gems were reset.', 'err'); }
    if (document.querySelector('.modal-wrap, .coach-bubble')) { setTimeout(popups, 500); return; }
    if (!onboardChecked) {
      onboardChecked = true;
      if (!backend.seen('onboard') && !backend.seen('basic')) {
        if (p.stats.matches === 0) {
          onboarding(() => import('./play.ts').then((m) => m.startTutorial()), () => show(homeScreen));
          return;
        }
        silenceExistingUnlocks();
        backend.completeTutorial('onboard');
      }
    }
    if (checkUnlocks()) return;
    if (!p.login.claimed && loginShownDay !== p.daily.day && p.stats.matches > 0) { loginShownDay = p.daily.day; loginPopup(); return; }
    if (!starterShown && !p.offers.starter && p.stats.matches >= 3 && open('shop')) { starterShown = true; starterPopup(); }
  };
  setTimeout(popups, 350);

  return { el, bannerAd: true };
}

function progress(fn: (m: typeof import('./progress.ts')) => unknown) {
  import('./progress.ts').then((m) => { const r = fn(m); if (r && typeof r === 'object' && 'el' in (r as object)) show(() => r as Screen); });
}

function go(where: 'fighters' | 'shop' | 'pass' | 'quests' | 'leaderboard' | 'settings' | 'achievements' | 'profile') {
  import('./meta.ts').then((m) => {
    const map = {
      fighters: () => m.fightersScreen(), shop: () => m.shopScreen(), pass: m.passScreen, quests: m.questsScreen,
      leaderboard: m.leaderboardScreen, settings: m.settingsScreen, achievements: m.achievementsScreen, profile: m.profileScreen,
    };
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
    h('div', { class: 'row' },
      h('button', { class: 'btn accent big', onclick: () => pick('1v1') }, '1 v 1'),
      h('button', { class: 'btn accent big', onclick: () => pick('2v2') }, '2 v 2'),
      h('button', { class: 'btn accent big', onclick: () => pick('ffa') }, t('ffa')),
    )));
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
    h('h2', { class: 'title-grad' }, t('dailyLogin')),
    h('div', { class: 'days' }, days),
    h('button', { class: 'btn primary big', disabled: p.login.claimed, onclick: async () => {
      const r = await backend.claimLogin().catch(() => null);
      m.close();
      if (r) rewardReveal(t('dailyLogin'), [...(r.coins ? [{ kind: 'coin' as const, amount: r.coins }] : []), ...(r.gems ? [{ kind: 'gem' as const, amount: r.gems }] : [])]);
      if (document.querySelector('.home')) show(homeScreen); // refresh badges only if still on home
    } }, t('claim')),
  ));
}

export function starterPopup() {
  const prod = IAP_PRODUCTS.find((x) => x.id === 'starter_pack')!;
  const m = modal(h('div', { class: 'offer' },
    h('div', { class: 'ribbon' }, t('limited')),
    h('h2', { class: 'title-grad' }, t('starterTitle')),
    h('div', { class: 'offer-art' }, fighterCanvas('zephyr', 0, 130), fighterCanvas('blaze', 1, 130)),
    h('p', {}, t('starterDesc')),
    h('div', { class: 'badge-big' }, isFa() ? prod.badgeFa : prod.badge),
    h('button', { class: 'btn primary big', onclick: async () => {
      const ok = await billing.buy(prod.id);
      if (ok) { m.close(); rewardReveal(t('purchaseOk'), [{ kind: 'fighter', id: 'zephyr' }, { kind: 'gem', amount: 300 }, { kind: 'coin', amount: 5000 }]); show(homeScreen); }
      else toast(t('purchaseFail'), 'err');
    } }, billing.price(prod)),
  ));
}
