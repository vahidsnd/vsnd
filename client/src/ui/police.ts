import { FIGHTERS, SPELLS, getFighter, type ModAction, type PoliceView, type Promo, type Reward, type StaffRole } from '@nb/shared';
import { social } from '../services/social.ts';
import { h, show, topBar, toast, confirmBox, type Child, type Screen } from './dom.ts';
import { svg } from './icons.ts';
import { introOnce } from './tutorial.ts';
import { isFa, num, loc, duration } from '../i18n.ts';
import { ago, clock, digits, ltr, socialErrorText, trySocial } from './clan.ts';
import './social.css';

// =============================================================================================
//  "Game Police" — moderation panel for staff (mods & admins): reports, player lookup,
//  sanctions, promo codes, staff roles and the moderation log.
// =============================================================================================

type LL = { fa: string; en: string };
const L = {
  title: { fa: 'پلیس بازی', en: 'Game Police' },
  locked: { fa: 'این بخش فقط برای ناظران و مدیران بازی است.', en: 'This area is for game moderators and admins only.' },
  reports: { fa: 'گزارش‌ها', en: 'Reports' },
  players: { fa: 'بازیکن‌ها', en: 'Players' },
  sanctions: { fa: 'محرومیت‌ها', en: 'Sanctions' },
  promos: { fa: 'کد هدیه', en: 'Promo codes' },
  staff: { fa: 'کادر', en: 'Staff' },
  log: { fa: 'سابقه', en: 'Log' },
  cheats: { fa: 'ضد تقلب', en: 'Anti-cheat' },
  pardon: { fa: 'بخشش', en: 'Pardon' },
  noReports: { fa: 'گزارش بازی وجود ندارد 👌', en: 'No open reports 👌' },
  reporter: { fa: 'گزارش‌دهنده', en: 'Reporter' },
  target: { fa: 'متخلف', en: 'Target' },
  channel: { fa: 'کانال', en: 'Channel' },
  warn: { fa: 'اخطار', en: 'Warn' },
  mute: { fa: 'بی‌صدا', en: 'Mute' },
  unmute: { fa: 'رفع بی‌صدا', en: 'Unmute' },
  ban: { fa: 'مسدود', en: 'Ban' },
  unban: { fa: 'رفع مسدودی', en: 'Unban' },
  delete: { fa: 'حذف پیام', en: 'Delete message' },
  dismiss: { fa: 'بی‌مورد', en: 'Dismiss' },
  rename: { fa: 'تغییر اجباری نام', en: 'Force rename' },
  banQ: { fa: 'این بازیکن مسدود شود؟', en: 'Ban this player?' },
  done: { fa: 'انجام شد', en: 'Done' },
  lookupPh: { fa: 'شناسه بازیکن', en: 'Player id' },
  lookup: { fa: 'جستجو', en: 'Look up' },
  lookupHint: { fa: 'شناسه بازیکن را وارد کن یا در گزارش‌ها روی نام بزن.', en: 'Enter a player id, or tap a name in a report.' },
  note: { fa: 'یادداشت / دلیل (اختیاری)', en: 'Note / reason (optional)' },
  level: { fa: 'سطح', en: 'Level' },
  trophies: { fa: 'جام', en: 'Trophies' },
  matches: { fa: 'مسابقه', en: 'Matches' },
  warns: { fa: 'اخطارها', en: 'Warnings' },
  mutedUntil: { fa: 'بی‌صدا تا', en: 'Muted until' },
  banned: { fa: 'مسدود', en: 'Banned' },
  clean: { fa: 'بدون محرومیت', en: 'No sanctions' },
  mutes: { fa: 'بی‌صداها', en: 'Active mutes' },
  bans: { fa: 'مسدودها', en: 'Bans' },
  none: { fa: 'موردی نیست', en: 'None' },
  lift: { fa: 'لغو', en: 'Lift' },
  adminOnly: { fa: 'فقط مدیر کل', en: 'Admins only' },
  code: { fa: 'کد', en: 'Code' },
  uses: { fa: 'استفاده', en: 'Uses' },
  expires: { fa: 'انقضا', en: 'Expires' },
  never: { fa: 'بدون انقضا', en: 'Never' },
  expired: { fa: 'منقضی', en: 'Expired' },
  minLevel: { fa: 'حداقل سطح', en: 'Min level' },
  on: { fa: 'فعال', en: 'On' },
  off: { fa: 'غیرفعال', en: 'Off' },
  newPromo: { fa: 'ساخت کد هدیه', en: 'New promo code' },
  reward: { fa: 'جایزه', en: 'Reward' },
  coins: { fa: 'سکه', en: 'Coins' },
  gems: { fa: 'الماس', en: 'Gems' },
  runes: { fa: 'رون', en: 'Runes' },
  xp: { fa: 'تجربه', en: 'XP' },
  anyCards: { fa: 'کارت تصادفی', en: 'Random cards' },
  crates: { fa: 'جعبه', en: 'Crates' },
  fighters: { fa: 'مبارزها', en: 'Fighters' },
  spells: { fa: 'جادوها', en: 'Spells' },
  skins: { fa: 'اسکین‌ها (شناسه، با کاما)', en: 'Skins (ids, comma separated)' },
  maxUses: { fa: 'حداکثر استفاده', en: 'Max uses' },
  days: { fa: 'روز اعتبار (۰ = همیشه)', en: 'Days valid (0 = forever)' },
  createPromo: { fa: 'ساخت کد', en: 'Create code' },
  promoMade: { fa: 'کد ساخته شد', en: 'Code created' },
  noPromos: { fa: 'کدی ساخته نشده', en: 'No codes yet' },
  grant: { fa: 'اعطا', en: 'Grant' },
  remove: { fa: 'حذف', en: 'Remove' },
  removeQ: { fa: 'نقش این فرد حذف شود؟', en: 'Remove this staff role?' },
  mod: { fa: 'ناظر', en: 'Moderator' },
  admin: { fa: 'مدیر کل', en: 'Admin' },
  staffHint: { fa: 'ناظر گزارش‌ها را بررسی و بازیکن‌ها را بی‌صدا یا مسدود می‌کند. مدیر کل علاوه بر آن کد هدیه می‌سازد و کادر را تعیین می‌کند.', en: 'Moderators review reports and mute or ban players. Admins can also create promo codes and appoint staff.' },
  noLog: { fa: 'سابقه‌ای نیست', en: 'Nothing logged yet' },
  auto: { fa: 'خودکار', en: 'auto' },
  you: { fa: 'شما', en: 'you' },
} satisfies Record<string, LL>;
const tr = (k: keyof typeof L) => (isFa() ? L[k].fa : L[k].en);
const REASON: Record<string, LL> = {
  abuse: { fa: 'توهین', en: 'Abuse' }, spam: { fa: 'اسپم', en: 'Spam' }, cheat: { fa: 'تقلب', en: 'Cheating' },
  name: { fa: 'نام نامناسب', en: 'Offensive name' }, other: { fa: 'سایر', en: 'Other' },
};
const ACTION: Record<string, LL> = {
  pardon: L.pardon, mute: L.mute, unmute: L.unmute, ban: L.ban, unban: L.unban, warn: L.warn, delete: L.delete, dismiss: L.dismiss, rename: L.rename, promo: L.promos,
  'role:mod': L.mod, 'role:admin': L.admin, 'role:none': { fa: 'حذف نقش', en: 'Role removed' },
};
const pick = (l?: LL, fb = '') => (l ? (isFa() ? l.fa : l.en) : fb);

type View = Awaited<ReturnType<ReturnType<typeof social>['police']>>;
type Tab = 'reports' | 'players' | 'cheats' | 'sanctions' | 'promos' | 'staff' | 'log';
const TAB_ICON: Record<Tab, string> = { cheats: 'zap', reports: 'flag', players: 'search', sanctions: 'lock', promos: 'ticket', staff: 'shield', log: 'history' };

/** Readable one-line summary of a reward. */
export function rewardText(r: Reward): string {
  const parts: string[] = [];
  const n = (v: number | undefined, k: keyof typeof L) => { if (v) parts.push(`${num(v)} ${tr(k)}`); };
  n(r.coins, 'coins'); n(r.gems, 'gems'); n(r.runes, 'runes'); n(r.xp, 'xp'); n(r.anyCards, 'anyCards'); n(r.crates, 'crates');
  for (const f of r.fighters ?? []) parts.push(loc(getFighter(f)));
  for (const s of r.spells ?? []) { const sp = SPELLS.find((x) => x.id === s); parts.push(sp ? (isFa() ? sp.nameFa : sp.name) : s); }
  for (const s of r.skins ?? []) parts.push(s);
  for (const [f, c] of Object.entries(r.cards ?? {})) parts.push(`${num(c)}× ${loc(getFighter(f))}`);
  return parts.join(isFa() ? '، ' : ', ') || '—';
}

export function policeScreen(): Screen {
  const goHome = () => import('./home.ts').then((m) => show(m.homeScreen));
  let tab: Tab = 'reports';
  let v: View | null = null;
  let alive = true;
  let lookupId = '';
  let formOpen = false;
  const tabsEl = h('div', { class: 'tabs police-tabs' });
  const scroll = h('div', { class: 'scroll police-scroll' }, h('div', { class: 'muted center' }, '…'));
  const el = h('div', { class: 'page police' }, topBar({ back: goHome, title: tr('title') }), tabsEl, scroll);
  const admin = () => v?.role === 'admin';

  const load = async () => {
    try { v = await social().police(); } catch (e) {
      v = null;
      const code = (e as Error).message;
      if (alive) { tabsEl.innerHTML = ''; scroll.innerHTML = ''; scroll.append(lockedView(code)); }
      return;
    }
    render();
  };
  const lockedView = (code: string) => h('div', { class: 'police-locked' }, svg('lock', 40), h('h2', {}, tr('title')),
    h('p', { class: 'muted' }, code === 'perm' || code === 'auth' || code === 'http-403' ? tr('locked') : socialErrorText(code)));

  /** runs a moderation action, then reloads the view */
  const act = async (inp: { action: ModAction; target: string; minutes?: number; msgId?: string; reportId?: string; note?: string }) => {
    if (inp.action === 'ban' && !(await confirmBox(`${tr('banQ')}\n${inp.target}`))) return false;
    const ok = await trySocial(social().act(inp).then(() => true), `${pick(ACTION[inp.action], inp.action)} · ${tr('done')}`);
    if (ok) await load();
    return !!ok;
  };
  const actionBar = (target: string, extra: { msgId?: string; reportId?: string; note?: () => string; lifts?: boolean; rename?: boolean } = {}) => {
    const base = () => ({ target, reportId: extra.reportId, note: extra.note?.() || undefined });
    const b = (cls: string, label: Child, fn: () => void) => h('button', { class: `btn small ${cls}`, onclick: fn }, label);
    return h('div', { class: 'police-acts' },
      b('', [svg('flag', 13), tr('warn')], () => act({ action: 'warn', ...base() })),
      b('', [svg('chat', 13), `${tr('mute')} ${isFa() ? '۱ ساعت' : '1h'}`], () => act({ action: 'mute', minutes: 60, ...base() })),
      b('', isFa() ? '۲۴ ساعت' : '24h', () => act({ action: 'mute', minutes: 60 * 24, ...base() })),
      b('', isFa() ? '۷ روز' : '7d', () => act({ action: 'mute', minutes: 60 * 24 * 7, ...base() })),
      b('primary', [svg('lock', 13), tr('ban')], () => act({ action: 'ban', ...base() })),
      extra.msgId ? b('gold', [svg('close', 13), tr('delete')], () => act({ action: 'delete', target, msgId: extra.msgId })) : null,
      extra.lifts ? [b('ghost', tr('unmute'), () => act({ action: 'unmute', ...base() })), b('ghost', tr('unban'), () => act({ action: 'unban', ...base() }))] : null,
      extra.rename ? b('ghost', [svg('user', 13), tr('rename')], () => act({ action: 'rename', ...base() })) : null,
      extra.reportId ? b('ghost', [svg('check', 13), tr('dismiss')], () => act({ action: 'dismiss', ...base() })) : null,
    );
  };
  const openPlayer = (id: string) => { lookupId = id; tab = 'players'; render(); };

  function render() {
    if (!alive || !v) return;
    const tabs: Tab[] = ['reports', 'players', 'cheats', 'sanctions', ...(admin() ? ['promos', 'staff'] as Tab[] : []), 'log'];
    if (!tabs.includes(tab)) tab = 'reports';
    tabsEl.innerHTML = '';
    for (const t of tabs) {
      const n = t === 'reports' ? v.reports.length : 0;
      tabsEl.append(h('button', { class: t === tab ? 'tab on' : 'tab', 'data-pt': t, onclick: () => { tab = t; render(); } },
        svg(TAB_ICON[t], 13), tr(t), n ? h('span', { class: 'clan-tabn' }, num(n)) : null));
    }
    const st = scroll.scrollTop;
    scroll.innerHTML = '';
    scroll.append(h('div', { class: 'narrow police-pane' }, pane(tab, v)));
    scroll.scrollTop = st;
  }

  function pane(t: Tab, v: View): Child {
    switch (t) {
      case 'reports': return reportsPane(v);
      case 'players': return playersPane();
      case 'sanctions': return sanctionsPane(v);
      case 'promos': return promosPane(v);
      case 'staff': return staffPane(v);
      case 'log': return logPane(v);
      case 'cheats': return cheatsPane(v);
    }
  }

  // ---- reports -----------------------------------------------------------------------------------
  function reportsPane(v: View) {
    if (!v.reports.length) return h('div', { class: 'police-empty muted' }, svg('check', 28), tr('noReports'));
    return v.reports.map((r) => h('div', { class: 'police-card' },
      h('div', { class: 'police-card-top' },
        h('span', { class: `tag police-reason rs-${r.reason}` }, pick(REASON[r.reason], r.reason)),
        h('button', { class: 'police-name', onclick: () => openPlayer(r.target) }, svg('user', 13), h('b', {}, r.targetName), h('small', { class: 'muted', dir: 'ltr' }, r.target)),
        h('span', { class: 'grow' }),
        h('small', { class: 'muted' }, ago(r.t))),
      r.text ? h('q', { class: 'police-quote', dir: 'auto' }, r.text) : null,
      h('div', { class: 'police-meta muted' },
        h('span', {}, `${tr('reporter')}: `, h('button', { class: 'police-link', onclick: () => openPlayer(r.by) }, r.byName)),
        r.ch ? h('span', {}, `${tr('channel')}: `, h('span', { dir: 'ltr' }, r.ch)) : null),
      actionBar(r.target, { msgId: r.msgId, reportId: r.id }),
    ));
  }

  // ---- player lookup -----------------------------------------------------------------------------
  function playersPane() {
    const q = h('input', { class: 'input grow', placeholder: tr('lookupPh'), value: lookupId, dir: 'ltr' }) as HTMLInputElement;
    const note = h('input', { class: 'input', placeholder: tr('note'), maxlength: 120 }) as HTMLInputElement;
    const out = h('div', { class: 'police-player' }, h('small', { class: 'muted' }, tr('lookupHint')));
    const run = async () => {
      const id = q.value.trim();
      lookupId = id;
      if (!id) return;
      const u = await trySocial(social().lookup(id));
      out.innerHTML = '';
      if (!u) return;
      const muted = u.muted > Date.now();
      out.append(h('div', { class: 'police-card' },
        h('div', { class: 'police-card-top' }, svg('user', 18), h('b', { class: 'police-big' }, u.name), h('small', { class: 'muted', dir: 'ltr' }, u.id),
          h('span', { class: 'grow' }),
          u.banned ? h('span', { class: 'tag police-bad' }, svg('lock', 12), `${tr('banned')}: ${u.banned}`) : null,
          muted ? h('span', { class: 'tag gold' }, svg('chat', 12), `${tr('mutedUntil')} ${clock(u.muted)}`) : null,
          !u.banned && !muted ? h('span', { class: 'tag ok' }, tr('clean')) : null),
        h('div', { class: 'stat-grid police-stats' },
          sbox(num(u.level), tr('level')), sbox(num(u.mmr), tr('trophies')), sbox(num(u.matches), tr('matches')), sbox(digits(String(Math.round(u.warns * 100) / 100)), tr('warns'))),
        note,
        actionBar(u.id, { note: () => note.value.trim(), lifts: true, rename: true }),
      ));
    };
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { q.blur(); void run(); } });
    if (lookupId) void run();
    return [h('div', { class: 'clan-search' }, q, h('button', { class: 'btn accent', onclick: run }, svg('search', 16), tr('lookup'))), out];
  }

  // ---- sanctions -----------------------------------------------------------------------------------
  function sanctionsPane(v: View) {
    const row = (id: string, name: string | undefined, info: Child, action: ModAction) => h('div', { class: 'police-row' },
      h('button', { class: 'police-name', onclick: () => openPlayer(id) }, h('b', {}, name ?? id), h('small', { class: 'muted', dir: 'ltr' }, id)),
      h('span', { class: 'grow' }), info,
      h('button', { class: 'btn small ghost', onclick: () => act({ action, target: id }) }, tr('lift')));
    return h('div', { class: 'two-col' },
      h('div', { class: 'box' }, h('h3', {}, svg('chat', 15), ' ', tr('mutes')),
        v.mutes.length ? (v.mutes as { id: string; until: number; name?: string }[]).map((m) => row(m.id, m.name, h('small', { class: 'tag gold' }, duration(m.until - Date.now())), 'unmute')) : h('small', { class: 'muted' }, tr('none'))),
      h('div', { class: 'box' }, h('h3', {}, svg('lock', 15), ' ', tr('bans')),
        v.bans.length ? (v.bans as { id: string; reason: string; name?: string }[]).map((b) => row(b.id, b.name, h('small', { class: 'tag police-bad' }, b.reason), 'unban')) : h('small', { class: 'muted' }, tr('none'))),
    );
  }

  // ---- promo codes ------------------------------------------------------------------------------------
  function promosPane(v: View) {
    const now = Date.now();
    const list = [...v.promos].sort((a, b) => b.created - a.created);
    const promoRow = (p: Promo) => {
      const exp = p.expires && now > p.expires;
      return h('div', { class: `police-promo ${p.off || exp ? 'off' : ''}` },
        h('div', { class: 'police-promo-main' },
          h('div', { class: 'police-promo-top' }, h('b', { class: 'police-code', dir: 'ltr' }, p.code),
            p.note ? h('small', { class: 'muted' }, p.note) : null),
          h('small', {}, svg('gift', 12), ' ', rewardText(p.reward))),
        h('div', { class: 'police-promo-stats' },
          h('span', { class: 'clan-chip' }, svg('users', 12), ltr(`${num(p.uses)}/${num(p.maxUses)}`)),
          h('span', { class: `clan-chip ${exp ? 'police-badtxt' : ''}` }, svg('history', 12), p.expires ? (exp ? tr('expired') : duration(p.expires - now)) : tr('never')),
          p.minLevel ? h('span', { class: 'clan-chip' }, svg('star', 12), num(p.minLevel)) : null),
        h('button', { class: `btn small ${p.off ? 'ghost' : 'accent'} police-toggle`, onclick: async () => {
          if (await trySocial(social().promoToggle(p.code, !p.off).then(() => true))) await load();
        } }, p.off ? tr('off') : tr('on')),
      );
    };
    return [promoForm(), h('h3', { class: 'clan-sub' }, svg('ticket', 15), ' ', tr('promos')),
      list.length ? h('div', { class: 'clan-list' }, list.map(promoRow)) : h('div', { class: 'muted center' }, tr('noPromos'))];
  }

  function promoForm() {
    const numIn = (ph: string, init = '') => h('input', { class: 'input police-num', type: 'number', min: 0, placeholder: ph, value: init, dir: 'ltr' }) as HTMLInputElement;
    const code = h('input', { class: 'input police-codein', maxlength: 24, placeholder: 'CODE2026', dir: 'ltr', oninput: (e: Event) => {
      const i = e.target as HTMLInputElement; i.value = i.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    } }) as HTMLInputElement;
    const f = { coins: numIn('0'), gems: numIn('0'), runes: numIn('0'), xp: numIn('0'), anyCards: numIn('0'), crates: numIn('0') };
    const maxUses = numIn('1000', '1000'), days = numIn('0', '30'), minLevel = numIn('0', '0');
    const skins = h('input', { class: 'input', placeholder: 'blaze1, volt2', dir: 'ltr' }) as HTMLInputElement;
    const note = h('input', { class: 'input', maxlength: 80, placeholder: tr('note') }) as HTMLInputElement;
    const selF = new Set<string>(), selS = new Set<string>();
    const chips = (items: { id: string; label: string }[], set: Set<string>) => h('div', { class: 'police-chips' }, items.map((it) => {
      const b = h('button', { type: 'button', class: 'police-pick', onclick: () => { if (set.has(it.id)) set.delete(it.id); else set.add(it.id); b.classList.toggle('on', set.has(it.id)); } }, it.label);
      return b;
    }));
    const create = async () => {
      const reward: Reward = {};
      for (const [k, inp] of Object.entries(f)) { const n = Math.floor(Number(inp.value) || 0); if (n > 0) (reward as Record<string, number>)[k] = n; }
      if (selF.size) reward.fighters = [...selF];
      if (selS.size) reward.spells = [...selS];
      const sk = skins.value.split(/[\s,،]+/).map((s) => s.trim()).filter(Boolean);
      if (sk.length) reward.skins = sk;
      if (code.value.length < 4 || !Object.keys(reward).length) { toast(socialErrorText('bad-input'), 'err'); return; }
      const ok = await trySocial(social().promoCreate({
        code: code.value, reward, maxUses: Math.max(1, Number(maxUses.value) || 1000), days: Math.max(0, Number(days.value) || 0) || undefined,
        minLevel: Math.max(0, Number(minLevel.value) || 0), note: note.value.trim() || undefined,
      }).then(() => true), `${tr('promoMade')}: ${code.value}`);
      if (ok) { formOpen = false; await load(); }
    };
    const fld = (label: string, c: Child) => h('label', { class: 'police-fld' }, h('span', {}, label), c);
    return h('details', { class: 'box police-form', open: formOpen, ontoggle: (e: Event) => { formOpen = (e.target as HTMLDetailsElement).open; } },
      h('summary', { class: 'police-summary' }, svg('ticket', 15), h('b', {}, tr('newPromo')), svg('chevron', 15, 'police-chev')),
      h('div', { class: 'police-grid' },
        fld(tr('code'), code), fld(tr('maxUses'), maxUses), fld(tr('days'), days), fld(tr('minLevel'), minLevel)),
      h('small', { class: 'muted' }, tr('reward')),
      h('div', { class: 'police-grid' },
        fld(tr('coins'), f.coins), fld(tr('gems'), f.gems), fld(tr('runes'), f.runes), fld(tr('xp'), f.xp), fld(tr('anyCards'), f.anyCards), fld(tr('crates'), f.crates)),
      fld(tr('fighters'), chips(FIGHTERS.map((x) => ({ id: x.id, label: loc(x) })), selF)),
      fld(tr('spells'), chips(SPELLS.map((x) => ({ id: x.id, label: isFa() ? x.nameFa : x.name })), selS)),
      fld(tr('skins'), skins),
      fld(tr('note'), note),
      h('button', { class: 'btn gold wide', onclick: create }, svg('check', 16), tr('createPromo')),
    );
  }

  // ---- staff -------------------------------------------------------------------------------------
  function staffPane(v: View) {
    const id = h('input', { class: 'input grow', placeholder: tr('lookupPh'), dir: 'ltr' }) as HTMLInputElement;
    let role: StaffRole = 'mod';
    const seg = h('div', { class: 'seg' });
    const drawSeg = () => { seg.innerHTML = ''; for (const r of ['mod', 'admin'] as StaffRole[]) seg.append(h('button', { type: 'button', class: r === role ? 'on' : '', onclick: () => { role = r; drawSeg(); } }, tr(r))); };
    drawSeg();
    const grant = async () => {
      const t = id.value.trim();
      if (!t) return;
      if (await trySocial(social().staff(t, role).then(() => true), tr('done'))) await load();
    };
    return [
      h('div', { class: 'box' }, h('h3', {}, svg('shield', 15), ' ', tr('staff')), h('small', { class: 'muted' }, tr('staffHint')),
        h('div', { class: 'clan-search' }, id, seg, h('button', { class: 'btn accent', onclick: grant }, tr('grant')))),
      h('div', { class: 'clan-list' }, v.staff.map((s) => h('div', { class: 'police-row' },
        svg(s.role === 'admin' ? 'crown' : 'shield', 16),
        h('b', { dir: 'ltr' }, s.id), h('span', { class: `tag ${s.role === 'admin' ? 'gold' : ''}` }, tr(s.role)),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn small ghost', onclick: async () => {
          if (!(await confirmBox(`${tr('removeQ')}\n${s.id}`))) return;
          if (await trySocial(social().staff(s.id, null).then(() => true), tr('done'))) await load();
        } }, tr('remove'))))),
    ];
  }

  // ---- log ---------------------------------------------------------------------------------------
  function cheatsPane(v: View) {
    const list = (v as any).cheats as { id: string; name: string; score: number; flags: { t: number; kind: string; detail: string; pts: number }[] }[] | undefined;
    const intro = h('p', { class: 'muted small' }, isFa()
      ? 'بازی‌های آنلاین روی سرور اجرا می‌شوند و قابل تقلب نیستند. نتیجه‌هایی که خود گوشی گزارش می‌کند (کامپیوتر، نقشه، نبرد حمله قبیله) بررسی می‌شوند: زمان غیرممکن، آسیب یا ناک‌اوت بیش از حد، نبرد سریع‌تر از زمان واقعی، ورودی سریع‌تر از واقعیت و درخواست‌های انبوه. با امتیاز ۱۰، جایزه‌های آفلاین متوقف و بازیکن به پلیس گزارش می‌شود؛ امتیاز با گذشت زمان کم می‌شود.'
      : 'Online matches run on the server and can\'t be cheated. Results the phone reports (CPU, map, raid fights) are checked: impossible times, too much damage or KOs, fights shorter than real time, inputs faster than real time and request floods. At 10 points offline rewards stop and the player is reported to the police; the score decays over time.');
    if (!list?.length) return h('div', {}, intro, h('div', { class: 'police-empty muted' }, svg('check', 28), isFa() ? 'مورد مشکوکی نیست' : 'Nothing suspicious'));
    return h('div', { class: 'box' }, intro, list.map((c) => h('div', { class: 'police-report' },
      h('div', { class: 'row space' }, h('b', {}, c.name, h('small', { class: 'muted', dir: 'ltr' }, ` ${c.id}`)), h('span', { class: `tag ${c.score >= 10 ? 'gold' : ''}` }, `${isFa() ? 'امتیاز تقلب' : 'score'} ${num(Math.round(c.score * 10) / 10)}`)),
      c.flags.slice(0, 5).map((f) => h('div', { class: 'muted small', dir: 'ltr', style: { textAlign: 'start' } }, `${f.kind} +${f.pts} · ${f.detail} · `, h('span', { dir: 'auto' }, ago(f.t)))),
      h('div', { class: 'row' },
        h('button', { class: 'btn small ghost', onclick: () => act({ action: 'pardon', target: c.id }) }, svg('check', 13), tr('pardon')),
        h('button', { class: 'btn small primary', onclick: () => act({ action: 'ban', target: c.id, note: 'cheating' }) }, svg('lock', 13), tr('ban'))))));
  }

  function logPane(v: View) {
    if (!v.log.length) return h('div', { class: 'police-empty muted' }, tr('noLog'));
    return h('div', { class: 'box clan-log' }, v.log.map((l: PoliceView['log'][number]) => h('div', { class: 'police-logrow' },
      h('span', { class: 'tag' }, pick(ACTION[l.action], l.action)),
      h('span', { class: 'police-logwho' }, h('small', { class: 'muted' }, l.by === 'auto' ? tr('auto') : l.by), ' → ', h('b', { dir: 'ltr' }, l.target)),
      l.note ? h('small', { class: 'muted police-lognote', dir: 'auto' }, l.note) : null,
      h('span', { class: 'grow' }),
      h('small', { class: 'muted' }, ago(l.t)))));
  }

  void load().then(() => {
    if (!alive || !v) return;
    introOnce('police', [
      { title: { fa: 'پلیس بازی', en: 'The Game Police' }, text: { fa: 'اینجا ناظران از جامعه بازی محافظت می‌کنند. فیلتر خودکار فحش، لینک و شماره تلفن را پنهان می‌کند، پیام تکراری (اسپم) خودکار ۱۰ دقیقه بی‌صدا می‌شود و اگر سه نفر یک بازیکن را گزارش کنند، تا بررسی ۳۰ دقیقه بی‌صدا می‌شود.', en: 'Moderators keep the community safe here. An automatic filter hides profanity, links and phone numbers; repeated messages (spam) trigger a 10-minute mute, and three reports from different players mute someone for 30 minutes until reviewed.' } },
      { target: '[data-pt=reports]', title: { fa: 'گزارش‌ها', en: 'Reports' }, text: { fa: 'هر گزارش، پیام نقل‌شده و کانال را نشان می‌دهد. اخطار بده، بی‌صدا کن (۱ ساعت، ۲۴ ساعت، ۷ روز)، مسدود کن، پیام را حذف کن یا گزارش را بی‌مورد ببند.', en: 'Each report shows the quoted message and channel. Warn, mute (1h, 24h, 7d), ban, delete the message or dismiss the report.' } },
      { target: '[data-pt=players]', title: { fa: 'بازیکن‌ها و محرومیت‌ها', en: 'Players & sanctions' }, text: { fa: 'با شناسه، وضعیت هر بازیکن را ببین و محرومیت‌های فعال را از بخش محرومیت‌ها لغو کن.', en: 'Look up any player by id, and lift active mutes and bans from the Sanctions tab.' } },
      ...(admin() ? [{ target: '[data-pt=promos]', title: { fa: 'کد هدیه و کادر', en: 'Promo codes & staff' }, text: { fa: 'مدیر کل کد هدیه با سکه، الماس، رون، کارت، مبارز و جادو می‌سازد و ناظر یا مدیر جدید تعیین می‌کند.', en: 'Admins create promo codes (coins, gems, runes, cards, fighters, spells) and appoint moderators or admins.' } }] : []),
    ]);
  });
  return { el, destroy: () => { alive = false; } };
}

function sbox(v: string, label: string) { return h('div', { class: 'stat-box' }, h('b', {}, v), h('span', {}, label)); }
