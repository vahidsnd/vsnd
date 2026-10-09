import { CHAT_MAX_LEN, ROLE_NAMES, dmChannel, type ChatMsg, type ClanRole, type ClanView } from '@nb/shared';
import { social } from '../services/social.ts';
import { backend } from '../services/backend.ts';
import { h, show, toast } from './dom.ts';
import { svg } from './icons.ts';
import { introOnce } from './tutorial.ts';
import { isFa, num, duration } from '../i18n.ts';
import { clanScreen, clock, ago, roleTag, socialErrorText, trySocial } from './clan.ts';
import './social.css';
import { frameRing, titleTag, vipBadge } from './collection.ts';
import { publicBadges } from '@nb/shared';

// =============================================================================================
//  Chat side panel: global, clan, alliance and private (clan mates) channels.
// =============================================================================================

type LL = { fa: string; en: string };
const L = {
  chat: { fa: 'چت', en: 'Chat' },
  global: { fa: 'جهانی', en: 'Global' },
  clan: { fa: 'قبیله', en: 'Clan' },
  ally: { fa: 'اتحاد', en: 'Alliance' },
  dm: { fa: 'خصوصی', en: 'Private' },
  placeholder: { fa: 'پیام بنویس…', en: 'Type a message…' },
  empty: { fa: 'هنوز پیامی نیست. اولین نفر باش!', en: 'No messages yet — say hi!' },
  noClan: { fa: 'برای چت قبیله، اتحاد و پیام خصوصی باید عضو یک قبیله باشی.', en: 'Join a clan to use clan chat, alliance chat and private messages.' },
  findClan: { fa: 'پیدا کردن قبیله', en: 'Find a clan' },
  noAllies: { fa: 'قبیله تو هنوز متحدی ندارد؛ فعلاً فقط هم‌قبیله‌ای‌ها این پیام‌ها را می‌بینند.', en: 'Your clan has no allies yet — only clan mates see this channel for now.' },
  noMates: { fa: 'هم‌قبیله‌ای دیگری نیست', en: 'No other clan mates yet' },
  noMsgYet: { fa: 'شروع گفتگو', en: 'Start a conversation' },
  muted: { fa: 'بی‌صدا هستی تا', en: 'You are muted until' },
  report: { fa: 'گزارش تخلف', en: 'Report' },
  reportWhy: { fa: 'دلیل گزارش', en: 'Why are you reporting?' },
  reported: { fa: 'گزارش ثبت شد. پلیس بازی بررسی می‌کند.', en: 'Reported. The Game Police will review it.' },
  pm: { fa: 'پیام خصوصی', en: 'Private message' },
  cancel: { fa: 'انصراف', en: 'Cancel' },
  lv: { fa: 'سطح', en: 'Lv' },
  rules: { fa: 'احترام بگذار؛ توهین، اسپم و اطلاعات شخصی ممنوع است.', en: 'Be respectful — no abuse, spam or personal info.' },
  system: { fa: 'سیستم', en: 'System' },
  you: { fa: 'شما', en: 'You' },
} satisfies Record<string, LL>;
const tr = (k: keyof typeof L) => (isFa() ? L[k].fa : L[k].en);
const REASONS: [string, LL][] = [
  ['abuse', { fa: 'توهین یا فحاشی', en: 'Abuse / insults' }],
  ['spam', { fa: 'اسپم یا تبلیغ', en: 'Spam / ads' }],
  ['cheat', { fa: 'تقلب', en: 'Cheating' }],
  ['name', { fa: 'نام نامناسب', en: 'Offensive name' }],
  ['other', { fa: 'سایر', en: 'Other' }],
];

export type ChatTab = 'global' | 'clan' | 'ally' | 'dm';
const TAB_ICON: Record<ChatTab, string> = { global: 'globe', clan: 'shield', ally: 'handshake', dm: 'mail' };

let closeCurrent: (() => void) | null = null;

/** Opens the chat panel (slides in from the inline-end edge). */
export function openChat(tab: ChatTab = 'global', dmWith?: { id: string; name: string }) {
  closeCurrent?.();
  const me = backend.profile.id;
  let cur: ChatTab = tab;
  let dm: { id: string; name: string } | null = dmWith ?? null;
  let clan: ClanView | null = null;
  let clanKnown = false;
  let msgs: ChatMsg[] = [];
  let mutedUntil = 0;
  let alive = true;
  let seq = 0;

  const tabsEl = h('div', { class: 'chat-tabs' });
  const body = h('div', { class: 'chat-body' });
  const panel = h('aside', { class: 'chat-panel', role: 'dialog' },
    h('div', { class: 'chat-head' },
      h('b', { class: 'chat-title' }, svg('chat', 18), tr('chat')),
      h('button', { class: 'btn icon modal-x chat-x', onclick: () => close() }, svg('close', 18))),
    tabsEl, body);
  const wrap = h('div', { class: 'modal-wrap chat-wrap', onclick: (e: Event) => { if (e.target === wrap) close(); } }, panel);
  document.body.appendChild(wrap);

  const close = () => {
    if (!alive) return;
    alive = false; offChat(); closeCurrent = null;
    wrap.classList.add('out');
    setTimeout(() => wrap.remove(), 170);
  };
  closeCurrent = close;

  // which request channel and which live key the open view listens to
  const reqCh = () => (cur === 'dm' ? `dm:${dm!.id}` : cur);
  const liveKey = () => {
    if (cur === 'global') return 'global';
    if (!clan) return '';
    if (cur === 'clan') return `clan:${clan.id}`;
    if (cur === 'ally') return `ally:${clan.id}`;
    return dm ? dmChannel(me, dm.id) : '';
  };
  let refreshT = 0;
  const offChat = social().onChat((m) => {
    if (!alive) return;
    const key = liveKey();
    if (key && m.ch === key) { clearTimeout(refreshT); refreshT = window.setTimeout(() => void refresh(), 120); }
    else if (cur === 'dm' && !dm && m.ch.startsWith('dm:') && m.ch.includes(me)) { clearTimeout(refreshT); refreshT = window.setTimeout(() => render(), 200); }
  });

  // ---- tabs ----------------------------------------------------------------------------------
  const drawTabs = () => {
    tabsEl.innerHTML = '';
    for (const t of ['global', 'clan', 'ally', 'dm'] as ChatTab[]) {
      tabsEl.append(h('button', { class: `chat-tab ${t === cur ? 'on' : ''}`, 'data-ct': t, onclick: () => { cur = t; if (t !== 'dm') dm = null; render(); } },
        svg(TAB_ICON[t], 15), h('span', {}, tr(t))));
    }
  };

  // ---- message list ----------------------------------------------------------------------------
  let listEl: HTMLElement | null = null;
  let composeEl: HTMLElement | null = null;
  const drawList = () => {
    if (!listEl) return;
    const atBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 60;
    const first = !listEl.childElementCount || listEl.querySelector('.chat-wait');
    listEl.innerHTML = '';
    if (!msgs.length) listEl.append(h('div', { class: 'chat-empty muted' }, svg('chat', 28), tr('empty')));
    let lastDay = '';
    for (const m of msgs) {
      const day = new Date(m.t).toDateString();
      if (day !== lastDay && msgs.length > 1 && lastDay) listEl.append(h('div', { class: 'chat-day' }, ago(m.t)));
      lastDay = day;
      listEl.append(msgEl(m));
    }
    if (first || atBottom) listEl.scrollTop = listEl.scrollHeight;
  };
  const msgEl = (m: ChatMsg) => {
    if (m.sys || m.uid === 'sys') return h('div', { class: 'chat-sys' }, h('span', { dir: 'auto' }, m.text), h('time', {}, clock(m.t)));
    const mine = m.uid === me;
    return h('div', { class: `chat-msg ${mine ? 'me' : ''}`, onclick: mine ? undefined : () => msgMenu(m) },
      h('div', { class: 'chat-meta' },
        ...msgBadges(m, mine),
        m.tag ? h('span', { class: 'chat-ctag', dir: 'ltr' }, `[${m.tag}]`) : null,
        m.role && m.role !== 'member' ? h('span', { class: `chat-role r-${m.role}` }, (isFa() ? ROLE_NAMES[m.role as ClanRole].fa : ROLE_NAMES[m.role as ClanRole].en)) : null,
        m.lvl ? h('span', { class: 'chat-lvl' }, `${tr('lv')} ${num(m.lvl)}`) : null,
        h('time', {}, clock(m.t))),
      h('div', { class: 'chat-text', dir: 'auto' }, m.text));
  };

  /** avatar initial in the sender's frame, name, VIP badge and title */
  const msgBadges = (m: ChatMsg, mine: boolean) => {
    const b = mine ? publicBadges(backend.profile) : { frame: m.frame, title: m.title, vip: m.vip };
    return [
      frameRing(b.frame, h('span', { class: 'chat-ava' }, (m.name || '?').slice(0, 1).toUpperCase()), 'xs'),
      h('b', { class: 'chat-name' }, mine ? tr('you') : m.name),
      b.vip ? vipBadge() : null,
      titleTag(b.title, 'sm'),
    ];
  };

  const refresh = async () => {
    const my = ++seq;
    try {
      const r = await social().history(reqCh());
      if (!alive || my !== seq) return;
      msgs = r.msgs; mutedUntil = r.muted || 0;
      drawList(); drawMuted();
    } catch (e) {
      if (alive && my === seq) { msgs = []; drawList(); toast(socialErrorText((e as Error).message), 'err'); }
    }
  };

  // ---- composer ---------------------------------------------------------------------------------
  let input: HTMLInputElement | null = null;
  let mutedEl: HTMLElement | null = null;
  const drawMuted = () => {
    if (!mutedEl || !input || !composeEl) return;
    const on = mutedUntil > Date.now();
    mutedEl.hidden = !on;
    mutedEl.textContent = on ? `${tr('muted')} ${clock(mutedUntil)} · ${duration(mutedUntil - Date.now())}` : '';
    input.disabled = on;
    composeEl.classList.toggle('off', on);
  };
  const composer = () => {
    const counter = h('small', { class: 'chat-count', dir: 'ltr' }, `0/${CHAT_MAX_LEN}`);
    input = h('input', { class: 'input chat-input', maxlength: CHAT_MAX_LEN, placeholder: tr('placeholder'), dir: 'auto', enterkeyhint: 'send' }) as HTMLInputElement;
    const inp = input;
    const upd = () => { counter.textContent = `${inp.value.length}/${CHAT_MAX_LEN}`; counter.classList.toggle('near', inp.value.length > CHAT_MAX_LEN - 20); };
    let sending = false;
    const send = async () => {
      const text = inp.value.trim();
      if (!text || sending) return;
      sending = true;
      try {
        await social().post(reqCh(), text);
        inp.value = ''; upd();
        await refresh();
      } catch (e) {
        const code = (e as Error).message;
        toast(socialErrorText(code), 'err');
        if (code === 'muted' || code === 'banned') await refresh();
      } finally { sending = false; }
    };
    inp.addEventListener('input', upd);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void send(); } });
    mutedEl = h('div', { class: 'chat-muted' });
    mutedEl.hidden = true;
    composeEl = h('div', { class: 'chat-compose' },
      mutedEl,
      h('div', { class: 'chat-compose-row' }, inp, counter,
        h('button', { class: 'btn accent icon chat-send', onclick: send, title: 'Send' }, svg('send', 18))));
    return composeEl;
  };

  // ---- message menu (in-panel popover) -------------------------------------------------------------
  const msgMenu = (m: ChatMsg) => {
    const sameClan = !!clan && clan.members.some((x) => x.id === m.uid);
    const pop = h('div', { class: 'chat-pop', onclick: (e: Event) => { if (e.target === pop) pop.remove(); } });
    const card = h('div', { class: 'chat-pop-card' });
    const main = () => {
      card.replaceChildren(h('div', { class: 'chat-pop-in' },
        h('div', { class: 'chat-pop-head' }, h('b', {}, m.name), m.tag ? h('span', { class: 'chat-ctag', dir: 'ltr' }, `[${m.tag}]`) : null,
          m.role ? roleTag(m.role) : null),
        h('q', { class: 'chat-pop-quote', dir: 'auto' }, m.text),
        sameClan ? h('button', { class: 'btn accent wide', onclick: () => { pop.remove(); cur = 'dm'; dm = { id: m.uid, name: m.name }; render(); } }, svg('mail', 16), tr('pm')) : null,
        h('button', { class: 'btn primary wide', onclick: reasons }, svg('flag', 16), tr('report')),
        h('button', { class: 'btn ghost wide', onclick: () => pop.remove() }, tr('cancel')),
      ));
    };
    const reasons = () => {
      card.replaceChildren(h('div', { class: 'chat-pop-in' }, h('b', {}, tr('reportWhy')),
        REASONS.map(([id, l]) => h('button', { class: 'btn wide chat-reason', onclick: async () => {
          pop.remove();
          await trySocial(social().report({ target: m.uid, targetName: m.name, msgId: m.id, reason: id }), tr('reported'));
        } }, isFa() ? l.fa : l.en)),
        h('button', { class: 'btn ghost wide', onclick: main }, tr('cancel'))));
    };
    main();
    pop.append(card);
    panel.append(pop);
  };

  // ---- views ---------------------------------------------------------------------------------------
  const noClanState = () => h('div', { class: 'chat-empty chat-noclan' },
    svg('shield', 34), h('p', {}, tr('noClan')),
    h('button', { class: 'btn primary', onclick: () => { close(); show(clanScreen); } }, svg('search', 16), tr('findClan')));

  const threadsView = async () => {
    const list = h('div', { class: 'chat-threads' }, h('div', { class: 'muted center chat-wait' }, '…'));
    body.append(list);
    const rows = await trySocial(social().dms());
    if (!alive || cur !== 'dm' || dm) return;
    list.innerHTML = '';
    if (!rows?.length) { list.append(h('div', { class: 'chat-empty muted' }, svg('users', 28), tr('noMates'))); return; }
    for (const r of rows) {
      list.append(h('button', { class: 'chat-thread', onclick: () => { dm = { id: r.id, name: r.name }; render(); } },
        h('span', { class: 'chat-thread-ava' }, r.name.slice(0, 1).toUpperCase()),
        h('span', { class: 'chat-thread-main' },
          h('span', { class: 'chat-thread-top' }, h('b', {}, r.name), roleTag(r.role)),
          h('small', { class: 'muted', dir: 'auto' }, r.last ? `${r.last.uid === me ? tr('you') + ': ' : ''}${r.last.text}` : tr('noMsgYet'))),
        r.last ? h('time', {}, ago(r.last.t)) : null,
        svg(isFa() ? 'back' : 'chevron', 16, 'chat-thread-go')));
    }
  };

  const render = () => {
    if (!alive) return;
    drawTabs();
    body.innerHTML = '';
    listEl = null; composeEl = null; input = null; mutedEl = null;
    seq++;
    if (cur !== 'global' && !clanKnown) { body.append(h('div', { class: 'muted center chat-wait' }, '…')); return; }
    if (cur !== 'global' && !clan) { body.append(noClanState()); return; }
    if (cur === 'dm' && !dm) { void threadsView(); return; }
    if (cur === 'dm' && dm) {
      body.append(h('div', { class: 'chat-sub' },
        h('button', { class: 'btn icon small chat-back', onclick: () => { dm = null; render(); } }, svg(isFa() ? 'chevron' : 'back', 16)),
        svg('mail', 15), h('b', {}, dm.name)));
    }
    if (cur === 'ally' && clan && !clan.allies.length) body.append(h('div', { class: 'chat-note' }, svg('handshake', 14), tr('noAllies')));
    if (cur === 'global') body.append(h('div', { class: 'chat-note' }, svg('police', 14), tr('rules')));
    listEl = h('div', { class: 'chat-list' }, h('div', { class: 'muted center chat-wait' }, '…'));
    body.append(listEl, composer());
    void refresh();
  };

  render();
  social().myClan().then((c) => { clan = c; }).catch(() => { clan = null; }).finally(() => {
    clanKnown = true;
    if (!alive) return;
    if (cur !== 'global') render();
    introOnce('chat-panel', [
      { target: '.chat-tabs', title: { fa: 'کانال‌های چت', en: 'Chat channels' }, text: { fa: 'جهانی با همه بازیکن‌ها، قبیله فقط با هم‌قبیله‌ای‌ها، اتحاد با قبیله‌های متحد و خصوصی بین اعضای یک قبیله.', en: 'Global talks to everyone, Clan to your clan mates, Alliance to allied clans and Private is one-to-one between clan mates.' } },
      { target: '.chat-body', title: { fa: 'گزارش و پیام خصوصی', en: 'Report & private message' }, text: { fa: 'روی پیام هر بازیکن بزن تا گزارشش کنی یا (اگر هم‌قبیله‌ای است) به او پیام خصوصی بدهی. فیلتر خودکار فحش و اسپم را می‌گیرد.', en: 'Tap another player\'s message to report it or (for clan mates) send a private message. An automatic filter blocks profanity and spam.' } },
    ]);
  });
}
