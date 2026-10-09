import { featureUnlocked, notifText, type Notif, type NotifKind } from '@nb/shared';
import { notifs } from '../services/notifs.ts';
import { friends } from '../services/friends.ts';
import { backend } from '../services/backend.ts';
import { net } from '../net/net.ts';
import { h, show, modal, toast } from './dom.ts';
import { svg } from './icons.ts';
import { coach } from './tutorial.ts';
import { store } from '../services/platform.ts';
import { isFa, num } from '../i18n.ts';
import './accounts.css';

// =============================================================================================
//  Notification bell + friends shortcut for the home screen, the notification panel and the
//  global handlers (toasts for new notifications, match-invite prompt). Works the same with
//  the server (websocket pushes) and in the offline demo (locally generated notifications).
// =============================================================================================

type LL = { fa: string; en: string };
const tr = (l: LL) => (isFa() ? l.fa : l.en);
const L = {
  notifs: { fa: 'اعلان‌ها', en: 'Notifications' },
  friends: { fa: 'دوستان', en: 'Friends' },
  readAll: { fa: 'همه خوانده شد', en: 'Mark all read' },
  empty: { fa: 'هنوز اعلانی نداری. حمله‌ها، لیگ هفتگی، دوستان و هدیه‌ها اینجا خبر داده می‌شوند.', en: 'Nothing yet. Clan attacks, the weekly league, friends and gifts show up here.' },
  sys: { fa: 'اعلان گوشی', en: 'Phone notifications' },
  sysOn: { fa: 'روشن', en: 'On' },
  sysEnable: { fa: 'فعال کن', en: 'Enable' },
  sysNo: { fa: 'این نسخه پشتیبانی نمی‌کند', en: 'Not supported here' },
  sysFail: { fa: 'اجازه اعلان داده نشد', en: 'Permission was not granted' },
  offlineNote: { fa: 'نسخه آفلاین: اعلان‌ها از دنیای دمو روی همین گوشی ساخته می‌شوند.', en: 'Offline build: notifications are generated on this phone from the demo world.' },
  invite: { fa: 'دعوت به بازی', en: 'Match invite' },
  join: { fa: 'ورود به اتاق', en: 'Join room' },
  play: { fa: 'بازی دوستانه', en: 'Friendly match' },
  later: { fa: 'بعداً', en: 'Later' },
  demoInvite: { fa: 'اتاق خصوصی به سرور آنلاین نیاز دارد؛ در نسخه آفلاین یک بازی دوستانه مقابل کامپیوتر شروع می‌شود.', en: 'Private rooms need the online server; the offline build starts a friendly match against the computer.' },
  now: { fa: 'همین حالا', en: 'just now' },
  bellIntro: { fa: 'زنگ اعلان‌ها', en: 'Notification bell' },
  bellText: { fa: 'حمله به قبیله، پایان لیگ هفتگی، درخواست و هدیه دوستان و جعبه رایگان اینجا خبر داده می‌شوند. عدد قرمز یعنی اعلان نخوانده.', en: 'Clan attacks, the weekly league ending, friend requests, gifts and the free crate are announced here. The red number counts unread ones.' },
  friendsIntro: { fa: 'دوستان و دعوت', en: 'Friends & invites' },
  friendsText: { fa: 'با کد بازیکن دوست اضافه کن، هر روز هدیه بفرست و دوستانت را با کد دعوت بیاور تا هر دو جایزه بگیرید.', en: 'Add friends by player code, send daily gifts and bring friends with your invite code — you both get rewards.' },
};

const KIND_ICON: Record<NotifKind, string> = {
  'raid-declared': 'swords', 'raid-soon': 'swords', 'raid-live': 'swords', 'clan-war-ended': 'flag',
  'league-ending': 'trophy', 'league-top3': 'crown',
  'friend-request': 'userPlus', 'friend-accept': 'users', 'friend-invite': 'gamepad', 'friend-gift': 'gift',
  'free-crate': 'crate', referral: 'share', 'referral-milestone': 'star', system: 'bell',
};
const KIND_CLS = (k: NotifKind) => (k.startsWith('raid') || k === 'clan-war-ended' ? 'n-red' : k.startsWith('league') ? 'n-gold' : k.startsWith('friend') ? 'n-cyan' : k.startsWith('referral') ? 'n-violet' : 'n-green');

export function ago(t: number) {
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return tr(L.now);
  const m = Math.floor(s / 60), hh = Math.floor(m / 60), d = Math.floor(hh / 24);
  if (d > 0) return isFa() ? `${num(d)} روز پیش` : `${d}d ago`;
  if (hh > 0) return isFa() ? `${num(hh)} ساعت پیش` : `${hh}h ago`;
  return isFa() ? `${num(m)} دقیقه پیش` : `${m}m ago`;
}

// ---- global handlers ------------------------------------------------------------------------------------
let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  const svc = notifs();
  svc.onNew((n) => {
    if (document.querySelector('.game')) return;     // never interrupt a fight
    if (n.kind === 'friend-invite') { invitePrompt(n); return; }
    toast(notifText(n, isFa()).title, 'info');
  });
  (window as any).nbOpenNotifs = () => openNotifications();
}

/** A friend invites you: join their private room (online) or play a friendly match (demo). */
export function invitePrompt(n: Notif) {
  if (document.querySelector('.invite-modal')) return;
  const { body } = notifText(n, isFa());
  const demo = notifs().demo;
  const m = modal(h('div', { class: 'acc-modal invite-modal' },
    h('div', { class: 'acc-hero n-cyan' }, svg('gamepad', 30)),
    h('h2', {}, tr(L.invite)),
    h('p', {}, body),
    demo ? h('p', { class: 'muted acc-small' }, tr(L.demoInvite)) : null,
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost', onclick: () => m.close() }, tr(L.later)),
      h('button', { class: 'btn primary', onclick: async () => {
        m.close();
        void notifs().markRead([n.id]);
        if (demo) { import('./play.ts').then((p) => p.startCpuMatch({ opponents: 1, stocks: 3 })); return; }
        const code = String(n.data?.room ?? '');
        if (!(await net.connect())) { toast(isFa() ? 'اتصال برقرار نشد' : 'Could not connect', 'err'); return; }
        const play = await import('./play.ts');
        show(play.roomScreen);
        const p = backend.profile;
        net.send({ t: 'room_join', code, fighter: p.selFighter, skin: backend.selectedSkin(p.selFighter) });
      } }, svg('play', 16), demo ? tr(L.play) : tr(L.join)),
    ),
  ));
}

// ---- home screen tools ----------------------------------------------------------------------------------
/** Bell (notifications) and friends buttons for the home screen's tool column. */
export function socialTools(): HTMLElement[] {
  wire();
  const svc = notifs();
  const p = backend.profile;
  const badge = h('span', { class: 'badge' });
  const sync = () => { const n = svc.unread(); badge.textContent = num(n); badge.style.display = n > 0 ? '' : 'none'; };
  sync();
  const bell = h('button', { class: 'tool', 'data-f': 'notifs', title: tr(L.notifs), 'aria-label': tr(L.notifs), onclick: () => openNotifications() }, svg('bell', 18), badge);
  const off = svc.onChange(sync);
  (bell as any)._cleanup = off;

  // The friends screen always opens: before the feature unlocks it shows the invite (referral)
  // tab, which new players need right away; the other tabs show their unlock requirement.
  const fOpen = featureUnlocked(p, 'friends');
  const fbadge = h('span', { class: 'badge', style: { display: 'none' } });
  const fr = h('button', {
    class: 'tool', 'data-f': 'friendlist', title: tr(L.friends), 'aria-label': tr(L.friends),
    onclick: () => import('./friends.ts').then((m) => show(() => m.friendsScreen())),
  }, svg(fOpen ? 'users' : 'userPlus', 18), fbadge);
  if (fOpen) {
    // pending requests + gifts to collect
    const fsync = () => friends().view().then((v) => { const n = v.incoming.length + (v.giftsCollectable > 0 ? 1 : 0); fbadge.textContent = num(n); fbadge.style.display = n > 0 ? '' : 'none'; }).catch(() => {});
    void fsync();
    const off2 = friends().onChange(() => void fsync());
    (fr as any)._cleanup = off2;
  }
  // first time on the home screen with the bell: short intro (after the other home popups)
  const intro = () => {
    if (!bell.isConnected) return;
    if (document.querySelector('.modal-wrap, .coach-bubble')) { setTimeout(intro, 1500); return; }
    const seen = store.get<string[]>('intros', []);
    if (seen.includes('notifs')) return;
    store.set('intros', [...seen, 'notifs']);
    coach([
      { target: '[data-f=notifs]', title: L.bellIntro, text: L.bellText },
      ...(fOpen ? [{ target: '[data-f=friendlist]', title: L.friendsIntro, text: L.friendsText }] : []),
    ]);
  };
  if (p.stats.matches > 0) setTimeout(intro, 2500);
  return [bell, fr];
}

// ---- panel ------------------------------------------------------------------------------------------------
export function openNotifications() {
  wire();
  const svc = notifs();
  const list = h('div', { class: 'notif-list' });
  const sysBox = h('div', { class: 'notif-sys' });
  const render = () => {
    list.innerHTML = '';
    const items = svc.list();
    if (!items.length) list.append(h('p', { class: 'muted acc-empty' }, tr(L.empty)));
    for (const n of items) {
      const { title, body } = notifText(n, isFa());
      list.append(h('button', { class: `notif-row ${n.read ? '' : 'unread'}`, onclick: () => { void svc.markRead([n.id]); m.close(); openTarget(n); } },
        h('span', { class: `notif-ico ${KIND_CLS(n.kind)}` }, svg(KIND_ICON[n.kind] ?? 'bell', 16)),
        h('span', { class: 'notif-main' }, h('b', {}, title), h('small', {}, body)),
        h('span', { class: 'notif-time' }, ago(n.t), n.read ? null : h('i', { class: 'notif-dot' })),
      ));
    }
    sysBox.innerHTML = '';
    const st = svc.systemState();
    sysBox.append(svg('bell', 14), h('span', {}, tr(L.sys)),
      st === 'on' ? h('span', { class: 'tag ok' }, tr(L.sysOn))
        : st === 'unsupported' ? h('span', { class: 'muted' }, tr(L.sysNo))
          : h('button', { class: 'btn small accent', onclick: async () => { const ok = await svc.enableSystem(); if (!ok) toast(tr(L.sysFail), 'err'); render(); } }, tr(L.sysEnable)));
  };
  const m = modal(h('div', { class: 'acc-modal notif-panel' },
    h('div', { class: 'notif-head' },
      h('h2', {}, svg('bell', 20), tr(L.notifs)),
      h('button', { class: 'btn small ghost', onclick: () => void svc.markRead('all') }, svg('check', 14), tr(L.readAll)),
    ),
    list,
    h('div', { class: 'notif-foot' }, sysBox, svc.demo ? h('small', { class: 'muted' }, tr(L.offlineNote)) : null),
  ), { onClose: () => off() });
  const off = svc.onChange(render);
  render();
  void svc.refresh();
}

function openTarget(n: Notif) {
  const k = n.kind;
  if (k === 'friend-invite') { invitePrompt(n); return; }
  if (k.startsWith('friend')) { import('./friends.ts').then((m) => show(() => m.friendsScreen(k === 'friend-request' ? 'requests' : 'friends'))); return; }
  if (k.startsWith('referral')) { import('./progress.ts').then((m) => show(m.inboxScreen)); return; }
  if (k.startsWith('raid') || k === 'clan-war-ended') { import('./clan.ts').then((m) => show(m.clanScreen)); return; }
  if (k === 'league-top3') { import('./progress.ts').then((m) => show(m.inboxScreen)); return; }
  if (k === 'league-ending') { import('./progress.ts').then((m) => show(m.leagueScreen)); return; }
  if (k === 'free-crate') { import('./meta.ts').then((m) => show(() => m.shopScreen())); return; }
}
