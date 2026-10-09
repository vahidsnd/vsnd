import {
  CARD_REQUEST_SIZE, CLAN_CREATE_COST, CLAN_LEVEL_COST, CLAN_MAX_LEVEL, CLAN_MAX_MEMBERS, CLAN_PERKS, MAX_ALLIES, MAX_DEPUTIES, ROLE_NAMES, ROLE_RANK,
  clanBonus, getFighter,
  type CardRequest, type ClanInput, type ClanRole, type ClanSummary, type ClanView,
} from '@nb/shared';
import { social } from '../services/social.ts';
import { backend } from '../services/backend.ts';
import { h, show, topBar, modal, toast, confirmBox, fighterCanvas, icon, type Child, type Screen } from './dom.ts';
import { svg } from './icons.ts';
import { introOnce } from './tutorial.ts';
import { isFa, num, loc, duration } from '../i18n.ts';
import './social.css';

// =============================================================================================
//  Clan screen: browse / create / leaderboard when clanless; members, upgrades, card trades,
//  wars, alliances, log and settings once inside a clan. Everything goes through social().
// =============================================================================================

type LL = { fa: string; en: string };
const L = {
  clan: { fa: 'قبیله', en: 'Clan' },
  browse: { fa: 'جستجو', en: 'Browse' },
  create: { fa: 'ساخت قبیله', en: 'Create' },
  top: { fa: 'برترین‌ها', en: 'Leaderboard' },
  members: { fa: 'اعضا', en: 'Members' },
  upgrades: { fa: 'ارتقا', en: 'Upgrades' },
  cards: { fa: 'کارت‌ها', en: 'Cards' },
  war: { fa: 'جنگ', en: 'War' },
  allies: { fa: 'اتحاد', en: 'Alliances' },
  log: { fa: 'رویدادها', en: 'Log' },
  settings: { fa: 'تنظیمات', en: 'Settings' },
  chat: { fa: 'چت', en: 'Chat' },
  searchPh: { fa: 'نام یا تگ قبیله…', en: 'Clan name or tag…' },
  search: { fa: 'جستجو', en: 'Search' },
  join: { fa: 'عضویت', en: 'Join' },
  request: { fa: 'درخواست', en: 'Request' },
  requested: { fa: 'درخواست عضویت ارسال شد', en: 'Join request sent' },
  joined: { fa: 'به قبیله پیوستی!', en: 'You joined the clan!' },
  noClans: { fa: 'قبیله‌ای پیدا نشد', en: 'No clans found' },
  open: { fa: 'آزاد', en: 'Open' },
  invite: { fa: 'با درخواست', en: 'Invite only' },
  closed: { fa: 'بسته', en: 'Closed' },
  minTrophies: { fa: 'حداقل جام', en: 'Min trophies' },
  trophies: { fa: 'جام', en: 'Trophies' },
  level: { fa: 'سطح', en: 'Level' },
  lv: { fa: 'سطح', en: 'Lv' },
  power: { fa: 'قدرت', en: 'Power' },
  warWins: { fa: 'برد جنگ', en: 'War wins' },
  bank: { fa: 'خزانه', en: 'Bank' },
  type: { fa: 'نوع', en: 'Type' },
  you: { fa: 'شما', en: 'you' },
  leave: { fa: 'ترک قبیله', en: 'Leave clan' },
  leaveQ: { fa: 'مطمئنی می‌خواهی قبیله را ترک کنی؟', en: 'Leave the clan?' },
  leaveLeaderQ: { fa: 'تو رئیس هستی. با رفتنت ریاست به بالاترین عضو می‌رسد. ادامه می‌دهی؟', en: 'You are the leader — leadership passes to the next highest member. Leave anyway?' },
  left: { fa: 'قبیله را ترک کردی', en: 'You left the clan' },
  pm: { fa: 'پیام خصوصی', en: 'Private message' },
  makeCo: { fa: 'انتخاب به‌عنوان معاون', en: 'Make Deputy' },
  makeElder: { fa: 'انتخاب به‌عنوان زیردست ارشد', en: 'Make Officer' },
  makeMember: { fa: 'تبدیل به عضو عادی', en: 'Make Member' },
  promote: { fa: 'ارتقا به زیردست ارشد', en: 'Promote to Officer' },
  demote: { fa: 'تنزل به عضو', en: 'Demote to Member' },
  transfer: { fa: 'واگذاری ریاست', en: 'Transfer leadership' },
  transferQ: { fa: 'ریاست قبیله را واگذار می‌کنی؟ تو معاون می‌شوی.', en: 'Hand over leadership? You will become a Deputy.' },
  kick: { fa: 'اخراج', en: 'Kick' },
  kickQ: { fa: 'این عضو اخراج شود؟', en: 'Remove this member from the clan?' },
  deputiesFull: { fa: 'حداکثر معاون', en: 'max deputies' },
  roleSet: { fa: 'نقش تغییر کرد', en: 'Role updated' },
  kicked: { fa: 'عضو اخراج شد', en: 'Member removed' },
  requests: { fa: 'درخواست‌های عضویت', en: 'Join requests' },
  accept: { fa: 'قبول', en: 'Accept' },
  decline: { fa: 'رد', en: 'Decline' },
  donations: { fa: 'کارت اهدایی', en: 'Cards donated' },
  gemsGiven: { fa: 'الماس اهدایی', en: 'Gems given' },
  warPts: { fa: 'امتیاز جنگ', en: 'War points' },
  joinedAt: { fa: 'عضویت', en: 'Joined' },
  noActions: { fa: 'این خودت هستی', en: 'This is you' },
  donate: { fa: 'اهدا', en: 'Donate' },
  custom: { fa: 'دلخواه', en: 'Custom' },
  donateGems: { fa: 'اهدای الماس به خزانه', en: 'Donate gems to the bank' },
  donated: { fa: 'الماس به خزانه رفت', en: 'Gems added to the bank' },
  amount: { fa: 'تعداد الماس (حداقل ۱۰)', en: 'Gems (min 10)' },
  upgrade: { fa: 'ارتقای قبیله', en: 'Upgrade clan' },
  upgraded: { fa: 'قبیله ارتقا یافت!', en: 'Clan upgraded!' },
  maxLevel: { fa: 'حداکثر سطح', en: 'Max level' },
  nextLevel: { fa: 'تا سطح بعد', en: 'to next level' },
  onlyLeaders: { fa: 'فقط رئیس و معاون‌ها', en: 'Leader & deputies only' },
  perks: { fa: 'قابلیت‌های قبیله', en: 'Clan perks' },
  topDonors: { fa: 'بیشترین اهدا', en: 'Top donors' },
  reqCards: { fa: 'درخواست کارت', en: 'Request cards' },
  reqCardsText: { fa: 'هم‌قبیله‌ای‌ها می‌توانند کارت مبارز به تو هدیه بدهند. هر درخواست', en: 'Clan mates can donate fighter cards to you. Each request asks for' },
  cardsWord: { fa: 'کارت', en: 'cards' },
  todayLeft: { fa: 'درخواست باقی‌مانده امروز', en: 'requests left today' },
  pickFighter: { fa: 'برای کدام مبارز کارت می‌خواهی؟', en: 'Which fighter do you need cards for?' },
  reqSent: { fa: 'درخواست کارت ثبت شد', en: 'Card request posted' },
  collect: { fa: 'دریافت کارت‌ها', en: 'Collect cards' },
  collected: { fa: 'کارت دریافت شد', en: 'cards collected' },
  nothing: { fa: 'فعلاً چیزی برای دریافت نیست', en: 'Nothing to collect yet' },
  openReqs: { fa: 'درخواست‌های باز', en: 'Open requests' },
  noReqs: { fa: 'درخواست کارتی نیست', en: 'No card requests' },
  yours: { fa: 'درخواست شما', en: 'Yours' },
  done: { fa: 'کامل', en: 'Done' },
  youHave: { fa: 'داری', en: 'you have' },
  thanks: { fa: 'ممنون! ۱۵ سکه جایزه گرفتی', en: 'Thanks! +15 coins' },
  myOpen: { fa: 'یک درخواست باز داری', en: 'You already have an open request' },
  vs: { fa: 'در برابر', en: 'vs' },
  timeLeft: { fa: 'زمان باقی‌مانده', en: 'Time left' },
  topContrib: { fa: 'بهترین جنگجوها', en: 'Top contributors' },
  noPts: { fa: 'هنوز امتیازی ثبت نشده', en: 'No points yet' },
  searchWar: { fa: 'جستجوی جنگ', en: 'Search for war' },
  cancelSearch: { fa: 'لغو جستجو', en: 'Cancel search' },
  searching: { fa: 'در حال پیدا کردن حریف…', en: 'Looking for an opponent…' },
  noWar: { fa: 'قبیله در جنگ نیست', en: 'Your clan is not at war' },
  warStarted: { fa: 'جستجو شروع شد', en: 'Search started' },
  warLog: { fa: 'تاریخچه جنگ‌ها', en: 'War history' },
  noWarLog: { fa: 'هنوز جنگی انجام نشده', en: 'No wars yet' },
  won: { fa: 'برد', en: 'Won' },
  lost: { fa: 'باخت', en: 'Lost' },
  rules: { fa: 'قوانین جنگ', en: 'War rules' },
  alliesTitle: { fa: 'متحدان', en: 'Allies' },
  noAllies: { fa: 'هنوز متحدی ندارید', en: 'No allies yet' },
  breakAlly: { fa: 'لغو اتحاد', en: 'Break' },
  breakQ: { fa: 'اتحاد با این قبیله لغو شود؟', en: 'End the alliance with this clan?' },
  proposals: { fa: 'پیشنهادهای اتحاد', en: 'Alliance proposals' },
  propose: { fa: 'پیشنهاد اتحاد', en: 'Propose' },
  proposeTitle: { fa: 'پیشنهاد اتحاد به قبیله دیگر', en: 'Propose an alliance' },
  sent: { fa: 'ارسال شد', en: 'Sent' },
  proposed: { fa: 'پیشنهاد اتحاد ارسال شد', en: 'Alliance proposal sent' },
  allied: { fa: 'متحد شدید!', en: 'Alliance formed!' },
  allyChat: { fa: 'چت اتحاد', en: 'Alliance chat' },
  allyFull: { fa: 'ظرفیت اتحاد پر است', en: 'Alliance slots are full' },
  allyText: { fa: 'قبیله‌های متحد چت مشترک دارند و با هم جنگ نمی‌کنند.', en: 'Allied clans share a chat channel and are never matched against each other in wars.' },
  logEmpty: { fa: 'رویدادی ثبت نشده', en: 'Nothing here yet' },
  save: { fa: 'ذخیره', en: 'Save' },
  saved: { fa: 'ذخیره شد', en: 'Saved' },
  desc: { fa: 'توضیحات', en: 'Description' },
  name: { fa: 'نام قبیله', en: 'Clan name' },
  tag: { fa: 'تگ (۲ تا ۵ حرف)', en: 'Tag (2–5 letters)' },
  badge: { fa: 'نشان', en: 'Badge' },
  createBtn: { fa: 'ساخت قبیله', en: 'Create clan' },
  created: { fa: 'قبیله ساخته شد!', en: 'Clan founded!' },
  createText: { fa: 'قبیله خودت را بساز و تا ۱۵ نفر عضو بگیر. تو رئیس می‌شوی.', en: 'Found your own clan for up to 15 players. You become its leader.' },
  view: { fa: 'مشاهده', en: 'View' },
  inClanAlready: { fa: 'تو عضو این قبیله هستی', en: 'You are in this clan' },
  online: { fa: 'آنلاین', en: 'online' },
} satisfies Record<string, LL>;
const tr = (k: keyof typeof L) => (isFa() ? L[k].fa : L[k].en);
const pick = (l: LL) => (isFa() ? l.fa : l.en);

// ---- shared helpers (also used by chat.ts / police.ts) ---------------------------------------
const ERR: Record<string, LL> = {
  'no-clan': { fa: 'عضو هیچ قبیله‌ای نیستی', en: 'You are not in a clan' },
  perm: { fa: 'اجازه این کار را نداری', en: 'You don\'t have permission for that' },
  'in-clan': { fa: 'اول باید از قبیله فعلی خارج شوی', en: 'Leave your current clan first' },
  'bad-input': { fa: 'اطلاعات واردشده درست نیست', en: 'Please check what you entered' },
  exists: { fa: 'این نام یا تگ قبلاً گرفته شده', en: 'That name or tag is already taken' },
  funds: { fa: 'موجودی کافی نیست', en: 'Not enough funds' },
  'not-found': { fa: 'پیدا نشد', en: 'Not found' },
  full: { fa: 'ظرفیت قبیله پر است', en: 'The clan is full' },
  mmr: { fa: 'جام‌هایت برای این قبیله کافی نیست', en: 'Not enough trophies for this clan' },
  closed: { fa: 'این قبیله عضو نمی‌پذیرد', en: 'This clan is closed' },
  limit: { fa: 'به سقف مجاز رسیدی', en: 'Limit reached' },
  'at-war': { fa: 'قبیله در حال جنگ است', en: 'The clan is at war' },
  members: { fa: 'تعداد اعضا کافی نیست', en: 'Not enough members' },
  max: { fa: 'قبیله در بالاترین سطح است', en: 'The clan is already at max level' },
  muted: { fa: 'فعلاً اجازه چت نداری (بی‌صدا)', en: 'You are muted' },
  banned: { fa: 'حساب تو مسدود شده است', en: 'Your account is banned' },
  rate: { fa: 'کمی آهسته‌تر! چند لحظه صبر کن', en: 'Slow down — try again in a moment' },
  expired: { fa: 'این کد منقضی شده است', en: 'This code has expired' },
  'used-up': { fa: 'ظرفیت این کد تمام شده', en: 'This code has been used up' },
  level: { fa: 'سطح تو برای این کد کافی نیست', en: 'Your level is too low for this code' },
  already: { fa: 'قبلاً از این کد استفاده کرده‌ای', en: 'You already used this code' },
  locked: { fa: 'این بخش هنوز قفل است', en: 'This feature is still locked' },
  auth: { fa: 'دوباره وارد حساب شو', en: 'Please sign in again' },
  network: { fa: 'اتصال به سرور برقرار نشد', en: 'Could not reach the server' },
};
/** Bilingual text for an error code thrown by the social service. */
export function socialErrorText(code: string): string {
  const c = String(code ?? '');
  if (ERR[c]) return pick(ERR[c]);
  if (/^http-5/.test(c)) return isFa() ? 'خطای سرور، بعداً دوباره امتحان کن' : 'Server error — please try again later';
  if (/^http-|network|fetch|Failed/i.test(c)) return pick(ERR.network);
  return isFa() ? 'خطایی رخ داد' : 'Something went wrong';
}
/** Runs a social call; shows a toast on failure (and an optional one on success). */
export async function trySocial<T>(p: Promise<T>, ok?: string): Promise<T | undefined> {
  try {
    const r = await p;
    if (ok) toast(ok, 'ok');
    return r;
  } catch (e) {
    toast(socialErrorText((e as Error)?.message ?? ''), 'err');
    return undefined;
  }
}
const FA_D = '۰۱۲۳۴۵۶۷۸۹';
export const digits = (s: string) => (isFa() ? s.replace(/\d/g, (d) => FA_D[+d]) : s);
/** "5m ago" style relative time. */
export function ago(t: number): string {
  const s = Math.max(0, (Date.now() - t) / 1000);
  const fa = isFa();
  if (s < 60) return fa ? 'همین الان' : 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return fa ? `${num(m)} دقیقه پیش` : `${m}m ago`;
  const hr = Math.floor(m / 60);
  if (hr < 24) return fa ? `${num(hr)} ساعت پیش` : `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return fa ? `${num(d)} روز پیش` : `${d}d ago`;
}
/** HH:MM clock (localised digits). */
export function clock(t: number): string {
  const d = new Date(t);
  const p = (x: number) => String(x).padStart(2, '0');
  return digits(`${p(d.getHours())}:${p(d.getMinutes())}`);
}
export const ltr = (s: string) => h('span', { dir: 'ltr', class: 'ltr' }, s);

const ROLE_ICON: Record<ClanRole, string> = { leader: 'crown', co: 'star', elder: 'shield', member: 'user' };
export function roleName(r: ClanRole) { return pick(ROLE_NAMES[r]); }
export function roleTag(r: ClanRole) {
  return h('span', { class: `clan-role r-${r}` }, svg(ROLE_ICON[r], 12), roleName(r));
}

// ---- badges: 8 icons × 8 colours ------------------------------------------------------------------
const BADGE_ICONS = ['crown', 'swords', 'flame', 'star', 'zap', 'skull', 'flag', 'sparkles'];
const BADGE_COLORS = ['#29e3f0', '#ff3d7f', '#f5b301', '#2ee59d', '#a98bff', '#ff7a1a', '#4a8dff', '#dfe6f7'];
const SHIELD = 'M20 2 4 8v12c0 11 7.2 18.6 16 22 8.8-3.4 16-11 16-22V8z';
/** Clan badge (0–63) drawn as a coloured shield with an icon. */
export function clanBadge(badge: number, size = 36): HTMLElement {
  const b = (((badge | 0) % 64) + 64) % 64;
  const col = BADGE_COLORS[Math.floor(b / 8)];
  const el = h('span', { class: 'clan-badge', style: { width: `${size}px`, height: `${size}px`, color: col } });
  el.innerHTML = `<svg viewBox="0 0 40 44" width="${size}" height="${size}" aria-hidden="true">`
    + `<path d="${SHIELD}" fill="#0b1022"/><path d="${SHIELD}" fill="currentColor" fill-opacity=".2" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>`
    + `<path d="M20 7 9 11.2v8.6c0 7.6 4.8 12.9 11 15.6" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="2"/></svg>`;
  el.append(svg(BADGE_ICONS[b % 8], Math.round(size * 0.44), 'clan-badge-ico'));
  return el;
}

function badgePicker(init: number, onPick: (b: number) => void) {
  let b = init;
  const wrap = h('div', { class: 'clan-bpick' });
  const draw = () => {
    wrap.innerHTML = '';
    const ic = b % 8, co = Math.floor(b / 8);
    wrap.append(
      h('div', { class: 'clan-bpick-prev' }, clanBadge(b, 60)),
      h('div', { class: 'clan-bpick-opts' },
        h('div', { class: 'clan-bpick-row' }, BADGE_ICONS.map((_, i) =>
          h('button', { class: `clan-bopt ${i === ic ? 'on' : ''}`, type: 'button', onclick: () => { b = co * 8 + i; onPick(b); draw(); } }, clanBadge(co * 8 + i, 28)))),
        h('div', { class: 'clan-bpick-row' }, BADGE_COLORS.map((_, j) =>
          h('button', { class: `clan-bopt ${j === co ? 'on' : ''}`, type: 'button', onclick: () => { b = j * 8 + ic; onPick(b); draw(); } }, clanBadge(j * 8 + ic, 28)))),
      ),
    );
  };
  draw();
  return wrap;
}

function seg<T extends string>(value: T, opts: [T, string][], fn: (v: T) => void) {
  const el = h('div', { class: 'seg clan-seg' });
  const draw = () => {
    el.innerHTML = '';
    for (const [v, txt] of opts) el.append(h('button', { type: 'button', class: v === value ? 'on' : '', onclick: () => { value = v; fn(v); draw(); } }, txt));
  };
  draw();
  return el;
}

const typeName = (t: ClanSummary['type']) => tr(t);
const chip = (ico: string | null, val: Child, title?: string, cls = '') =>
  h('span', { class: `clan-chip ${cls}`, title }, ico === 'gem' || ico === 'coin' ? icon(ico) : ico ? svg(ico, 13) : null, val);
const stop = (fn: () => void) => (e: Event) => { e.stopPropagation(); fn(); };

function clanRow(c: ClanSummary & { pos?: number }, action?: Child) {
  return h('div', { class: 'clan-row', onclick: () => clanDetail(c.id) },
    c.pos ? h('span', { class: `pos clan-pos ${c.pos <= 3 ? 'p' + c.pos : ''}` }, c.pos <= 3 ? svg('trophy', 16) : num(c.pos)) : null,
    clanBadge(c.badge, 36),
    h('div', { class: 'clan-row-main' },
      h('div', { class: 'clan-row-name' }, h('b', {}, c.name), h('span', { class: 'clan-tagtxt', dir: 'ltr' }, `[${c.tag}]`)),
      h('small', { class: 'muted' }, c.desc || '—'),
    ),
    h('div', { class: 'clan-row-stats' },
      chip('users', ltr(`${num(c.members)}/${num(CLAN_MAX_MEMBERS)}`), tr('members')),
      chip('star', num(c.level), tr('level')),
      chip('trophy', num(c.power), tr('power'), 'clan-h1'),
      h('span', { class: `tag clan-type t-${c.type}` }, typeName(c.type)),
      c.minMmr > 0 ? chip('lock', num(c.minMmr), tr('minTrophies'), 'clan-h2') : null,
    ),
    action ?? null,
  );
}

async function joinClan(c: { id: string; type: ClanSummary['type'] }, after?: () => void) {
  const r = await trySocial(social().join(c.id));
  if (r === 'joined') toast(tr('joined'), 'ok');
  else if (r === 'requested') toast(tr('requested'), 'ok');
  if (r) after?.();
}

/** Read-only clan detail (members list) in a modal. */
export async function clanDetail(id: string) {
  const v = await trySocial(social().view(id));
  if (!v) return;
  const inClan = !!backend.profile.clan;
  const m = modal(h('div', { class: 'clan-detail' },
    h('div', { class: 'clan-detail-head' },
      clanBadge(v.badge, 56),
      h('div', { class: 'clan-detail-title' },
        h('h2', {}, v.name, ' ', h('span', { class: 'clan-tagtxt', dir: 'ltr' }, `[${v.tag}]`)),
        h('p', { class: 'muted' }, v.desc || '—'),
      ),
    ),
    h('div', { class: 'clan-statline' },
      chip('users', ltr(`${num(v.members.length)}/${num(CLAN_MAX_MEMBERS)}`), tr('members')),
      chip('star', `${tr('lv')} ${num(v.level)}`),
      chip('trophy', num(v.power), tr('power')),
      chip('swords', num(v.warWins), tr('warWins')),
      h('span', { class: `tag clan-type t-${v.type}` }, typeName(v.type)),
      v.minMmr > 0 ? chip('lock', `${tr('minTrophies')} ${num(v.minMmr)}`) : null,
    ),
    h('div', { class: 'clan-detail-list' }, v.members.map((x) => h('div', { class: 'clan-mini' },
      fighterCanvas(x.fighter, 0, 30),
      h('b', {}, x.name), roleTag(x.role),
      h('span', { class: 'grow' }),
      chip('trophy', num(x.mmr)), chip('star', num(x.level)),
    ))),
    v.member ? h('div', { class: 'muted center' }, tr('inClanAlready'))
      : !inClan && v.type !== 'closed' ? h('button', { class: 'btn primary wide', onclick: () => joinClan(v, () => { m.close(); if (document.querySelector('.clan')) show(clanScreen); }) },
        v.type === 'invite' ? tr('request') : tr('join')) : null,
  ), { cls: 'clan-modal' });
}

// =============================================================================================
type Tab = 'browse' | 'create' | 'top' | 'members' | 'upgrades' | 'cards' | 'war' | 'allies' | 'log' | 'settings';
const TAB_ICON: Record<Tab, string> = {
  browse: 'search', create: 'flag', top: 'trophy', members: 'users', upgrades: 'star', cards: 'gift',
  war: 'swords', allies: 'handshake', log: 'history', settings: 'settings',
};
const openChat = (tab: 'clan' | 'ally' | 'dm', dm?: { id: string; name: string }) => import('./chat.ts').then((c) => c.openChat(tab, dm));

export function clanScreen(): Screen {
  const goHome = () => import('./home.ts').then((m) => show(m.homeScreen));
  let view: ClanView | null = null;
  let tab: Tab | null = null;
  let lastTab: Tab | null = null;
  let loaded = false;
  let alive = true;
  let pending = false;
  let introDone = false;

  const head = h('div', { class: 'clan-headwrap' });
  const tabsEl = h('div', { class: 'tabs clan-tabs' });
  const scroll = h('div', { class: 'scroll clan-scroll' }, h('div', { class: 'muted center' }, '…'));
  const el = h('div', { class: 'page clan' }, topBar({ back: goHome, title: tr('clan') }), head, tabsEl, scroll);

  const me = () => backend.profile.id;
  const canManage = () => !!view?.myRole && ROLE_RANK[view.myRole] >= ROLE_RANK.co;
  const isOfficer = () => !!view?.myRole && ROLE_RANK[view.myRole] >= ROLE_RANK.elder;

  const busyInput = () => {
    const a = document.activeElement as HTMLElement | null;
    return !!a && el.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  };
  const load = async () => {
    try { view = await social().myClan(); } catch (e) { toast(socialErrorText((e as Error).message), 'err'); }
    loaded = true;
    render();
  };
  /** applies a returned view (or reloads) after an action */
  const apply = (v: ClanView | null | undefined) => { if (v !== undefined) { view = v; render(); } };
  const offChange = social().onChange(() => { if (!alive) return; if (busyInput()) { pending = true; return; } void load(); });
  el.addEventListener('focusout', () => setTimeout(() => { if (alive && pending && !busyInput()) { pending = false; void load(); } }, 60));
  const timer = window.setInterval(() => {
    el.querySelectorAll<HTMLElement>('[data-end]').forEach((n) => { n.textContent = duration(Number(n.dataset.end) - Date.now()); });
  }, 1000);

  function render() {
    if (!alive || !loaded) return;
    const tabs: Tab[] = view ? ['members', 'upgrades', 'cards', 'war', 'allies', 'log', ...(canManage() ? ['settings' as Tab] : [])] : ['browse', 'create', 'top'];
    if (!tab || !tabs.includes(tab)) tab = tabs[0];
    head.innerHTML = '';
    if (view) head.append(header(view));
    tabsEl.innerHTML = '';
    for (const t of tabs) {
      const n = t === 'members' && view ? view.requests.length : t === 'allies' && view ? view.allyIn.length : 0;
      tabsEl.append(h('button', { class: t === tab ? 'tab on' : 'tab', 'data-t': t, onclick: () => { tab = t; render(); } },
        svg(TAB_ICON[t], 13), tr(t), n ? h('span', { class: 'clan-tabn' }, num(n)) : null));
    }
    const st = scroll.scrollTop;
    scroll.innerHTML = '';
    scroll.append(h('div', { class: 'narrow clan-pane' }, pane(tab)));
    if (lastTab === tab) scroll.scrollTop = st;
    lastTab = tab;
    if (!introDone) { introDone = true; intro(); }
    if (view) { const btn = tabsEl.querySelector('.tab.on') as HTMLElement | null; btn?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
  }

  function intro() {
    if (!view) {
      introOnce('clan-browse', [
        { title: { fa: 'قبیله‌ها', en: 'Clans' }, text: { fa: 'با یک قبیله (تا ۱۵ نفر) بازی کن: چت گروهی، هدیه کارت، ارتقای قبیله با الماس، اتحاد و جنگ قبیله‌ای.', en: 'Play together in a clan of up to 15: group chat, card gifts, gem-powered clan upgrades, alliances and clan wars.' } },
        { target: '[data-t=browse]', title: { fa: 'پیدا کردن قبیله', en: 'Find a clan' }, text: { fa: 'قبیله‌ها را جستجو کن. قبیله «آزاد» فوراً عضوت می‌کند؛ «با درخواست» باید تأیید شود. روی هر قبیله بزن تا اعضایش را ببینی.', en: 'Search clans. "Open" clans let you in instantly; "Invite only" clans review your request. Tap a clan to see its members.' } },
        { target: '[data-t=create]', title: { fa: 'ساخت قبیله', en: 'Found a clan' }, text: { fa: `با ${CLAN_CREATE_COST} سکه قبیله خودت را بساز، نشان و تگ انتخاب کن و رئیس شو.`, en: `Spend ${CLAN_CREATE_COST} coins to found your own clan, pick a badge and tag, and lead it.` } },
        { target: '[data-t=top]', title: { fa: 'جدول قبیله‌ها', en: 'Clan leaderboard' }, text: { fa: 'قوی‌ترین قبیله‌ها بر اساس مجموع جام اعضا و بردهای جنگ.', en: 'The strongest clans by total member trophies and war wins.' } },
      ]);
    } else {
      introOnce('clan-home', [
        { target: '.clan-head', title: { fa: 'قبیله تو', en: 'Your clan' }, text: { fa: 'سطح، خزانه الماس، قدرت، بردهای جنگ و نقش تو در قبیله. دکمه چت، چت قبیله را باز می‌کند.', en: 'Level, gem bank, power, war wins and your role. The chat button opens clan chat.' } },
        { target: '[data-t=members]', title: { fa: 'اعضا و نقش‌ها', en: 'Members & roles' }, text: { fa: 'رئیس تا ۳ معاون و چند زیردست ارشد انتخاب می‌کند. معاون می‌تواند عضو را ارشد کند و ارشدها درخواست عضویت را بررسی می‌کنند. روی هر عضو بزن.', en: 'The leader appoints up to 3 deputies and officers. Deputies can promote members to officer; officers review join requests. Tap a member for options.' } },
        { target: '[data-t=upgrades]', title: { fa: 'ارتقا با الماس', en: 'Gem upgrades' }, text: { fa: 'اعضا الماس به خزانه می‌دهند و رئیس یا معاون قبیله را ارتقا می‌دهد تا قابلیت‌های بیشتری باز شود.', en: 'Members donate gems to the bank; the leader or a deputy spends them on clan levels that unlock perks for everyone.' } },
        { target: '[data-t=cards]', title: { fa: 'هدیه کارت', en: 'Card gifts' }, text: { fa: 'برای مبارزت کارت درخواست کن و به هم‌قبیله‌ای‌ها کارت هدیه بده (هر هدیه ۱۵ سکه جایزه دارد).', en: 'Request cards for your fighter and gift cards to clan mates (each gift pays you 15 coins).' } },
        { target: '[data-t=war]', title: { fa: 'جنگ قبیله‌ای', en: 'Clan wars' }, text: { fa: 'رئیس یا معاون جنگ را شروع می‌کند. هر برد آنلاین اعضا امتیاز می‌آورد و جایزه با صندوق پیام می‌رسد.', en: 'The leader or a deputy starts a war. Members\' online wins score points; rewards arrive by mail.' } },
        { target: '[data-t=allies]', title: { fa: 'اتحاد', en: 'Alliances' }, text: { fa: `تا ${MAX_ALLIES} قبیله متحد داشته باش؛ متحدان چت مشترک دارند.`, en: `Ally with up to ${MAX_ALLIES} clans; allies share a chat channel.` } },
      ]);
    }
  }

  // ---- header ------------------------------------------------------------------------------
  function header(v: ClanView) {
    return h('div', { class: 'clan-head' },
      clanBadge(v.badge, 44),
      h('div', { class: 'clan-head-main' },
        h('div', { class: 'clan-head-name' }, h('b', {}, v.name), h('span', { class: 'clan-tagtxt', dir: 'ltr' }, `[${v.tag}]`),
          h('span', { class: 'tag gold' }, `${tr('lv')} ${num(v.level)}`), v.myRole ? roleTag(v.myRole) : null),
        h('div', { class: 'clan-head-stats' },
          chip('gem', num(v.bank), tr('bank')),
          chip('trophy', num(v.power), tr('power')),
          chip('swords', num(v.warWins), tr('warWins')),
          chip('users', ltr(`${num(v.members.length)}/${num(CLAN_MAX_MEMBERS)}`), tr('members')),
          v.war ? h('span', { class: 'tag clan-atwar' }, svg('flame', 12), tr('war')) : null,
        ),
      ),
      h('div', { class: 'row clan-headbtns' },
        h('button', { class: 'btn small primary clan-raidbtn', 'data-t': 'raid', onclick: () => import('./raid.ts').then((m) => show(m.raidScreen)) }, svg('swords', 16), h('span', { class: 'lbl' }, isFa() ? 'حمله' : 'Attack')),
        h('button', { class: 'btn small accent clan-chatbtn', 'data-t': 'chat', onclick: () => openChat('clan') }, svg('chat', 16), h('span', { class: 'lbl' }, tr('chat')))),
    );
  }

  function pane(t: Tab): Child {
    switch (t) {
      case 'browse': return browsePane();
      case 'create': return createPane();
      case 'top': return topPane();
      case 'members': return membersPane(view!);
      case 'upgrades': return upgradesPane(view!);
      case 'cards': return cardsPane(view!);
      case 'war': return warPane(view!);
      case 'allies': return alliesPane(view!);
      case 'log': return logPane(view!);
      case 'settings': return settingsPane(view!);
    }
  }

  // ---- no clan: browse / create / top -------------------------------------------------------------
  let lastQuery = '';
  function browsePane() {
    const list = h('div', { class: 'clan-list' }, h('div', { class: 'muted center' }, '…'));
    const q = h('input', { class: 'input grow', placeholder: tr('searchPh'), value: lastQuery, maxlength: 24, enterkeyhint: 'search' }) as HTMLInputElement;
    const run = async () => {
      lastQuery = q.value;
      const rows = await trySocial(social().search(q.value));
      list.innerHTML = '';
      if (!rows) return;
      if (!rows.length) { list.append(h('div', { class: 'muted center clan-empty' }, tr('noClans'))); return; }
      for (const c of rows) {
        list.append(clanRow(c, c.type === 'closed' ? null
          : h('button', { class: `btn small ${c.type === 'invite' ? 'ghost' : 'primary'} clan-act`, onclick: stop(() => joinClan(c, () => void load())) },
            c.type === 'invite' ? tr('request') : tr('join'))));
      }
    };
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { q.blur(); void run(); } });
    void run();
    return [h('div', { class: 'clan-search' }, q, h('button', { class: 'btn accent', onclick: run }, svg('search', 16), tr('search'))), list];
  }

  function createPane() {
    const p = backend.profile;
    const inp: ClanInput = { name: '', tag: '', badge: Math.floor(Math.random() * 64), desc: '', type: 'open', minMmr: 0 };
    const name = h('input', { class: 'input', maxlength: 20, placeholder: tr('name'), oninput: (e: Event) => { inp.name = (e.target as HTMLInputElement).value; } }) as HTMLInputElement;
    const tag = h('input', { class: 'input clan-taginp', maxlength: 5, dir: 'ltr', placeholder: 'TAG', oninput: (e: Event) => {
      const i = e.target as HTMLInputElement; i.value = i.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); inp.tag = i.value;
    } }) as HTMLInputElement;
    const desc = h('textarea', { class: 'input clan-desc', maxlength: 120, rows: 2, placeholder: tr('desc'), oninput: (e: Event) => { inp.desc = (e.target as HTMLTextAreaElement).value; } });
    const min = h('input', { class: 'input clan-num', type: 'number', min: 0, max: 3000, step: 100, value: 0, dir: 'ltr', oninput: (e: Event) => { inp.minMmr = Number((e.target as HTMLInputElement).value) || 0; } });
    const create = async () => {
      if (inp.name.trim().length < 3 || inp.tag.length < 2) { toast(socialErrorText('bad-input'), 'err'); return; }
      const v = await trySocial(social().create(inp), tr('created'));
      if (v !== undefined) { tab = 'members'; apply(v); if (!v) void load(); }
    };
    return h('div', { class: 'two-col clan-create' },
      h('div', { class: 'box' },
        h('p', { class: 'muted clan-note' }, tr('createText')),
        field(tr('name'), name), field(tr('tag'), tag), field(tr('desc'), desc),
        field(tr('type'), seg(inp.type, [['open', tr('open')], ['invite', tr('invite')], ['closed', tr('closed')]], (v) => { inp.type = v; })),
        field(tr('minTrophies'), min),
      ),
      h('div', { class: 'box' },
        h('h3', {}, tr('badge')),
        badgePicker(inp.badge, (b) => { inp.badge = b; }),
        h('button', { class: `btn gold big wide ${p.coins < CLAN_CREATE_COST ? 'disabled' : ''}`, onclick: create },
          tr('createBtn'), h('span', { class: 'cur' }, icon('coin'), num(CLAN_CREATE_COST))),
      ),
    );
  }

  function topPane() {
    const list = h('div', { class: 'clan-list' }, h('div', { class: 'muted center' }, '…'));
    trySocial(social().clanLeaderboard()).then((rows) => {
      list.innerHTML = '';
      if (!rows?.length) { list.append(h('div', { class: 'muted center clan-empty' }, tr('noClans'))); return; }
      for (const c of rows) list.append(clanRow(c, h('span', { class: 'clan-ww' }, svg('swords', 13), num(c.warWins))));
    });
    return list;
  }

  // ---- members ---------------------------------------------------------------------------------
  function membersPane(v: ClanView) {
    const out: Child[] = [];
    if (isOfficer() && v.requests.length) {
      out.push(h('div', { class: 'box clan-reqs' }, h('h3', {}, svg('mail', 15), ' ', tr('requests')),
        v.requests.map((r) => h('div', { class: 'clan-reqrow' },
          h('b', {}, r.name), chip('trophy', num(r.mmr)), chip('star', num(r.level)), h('small', { class: 'muted' }, ago(r.t)),
          h('span', { class: 'grow' }),
          h('button', { class: 'btn small accent', onclick: async () => apply(await trySocial(social().respond(r.uid, true))) }, svg('check', 14), tr('accept')),
          h('button', { class: 'btn small ghost', onclick: async () => apply(await trySocial(social().respond(r.uid, false))) }, tr('decline')),
        ))));
    }
    out.push(h('div', { class: 'clan-list' }, v.members.map((m) => h('div', { class: `clan-mem ${m.id === me() ? 'me' : ''}`, onclick: () => memberSheet(v, m) },
      h('span', { class: 'clan-ava' }, fighterCanvas(m.fighter, 0, 36), h('i', { class: m.online ? 'clan-dot on' : 'clan-dot', title: m.online ? tr('online') : '' })),
      h('span', { class: 'clan-mem-main' }, h('b', {}, m.name, m.id === me() ? h('small', { class: 'muted' }, ` (${tr('you')})`) : null), roleTag(m.role)),
      h('span', { class: 'clan-mem-stats' },
        chip('trophy', num(m.mmr), tr('trophies')),
        chip('star', num(m.level), tr('level')),
        chip('gift', num(m.donated), tr('donations'), 'clan-h1'),
        v.war ? chip('swords', num(m.warPts), tr('warPts'), 'clan-h2') : null),
    ))));
    out.push(h('div', { class: 'row' }, h('button', { class: 'btn ghost small clan-leave', onclick: async () => {
      const ok = await confirmBox(v.myRole === 'leader' && v.members.length > 1 ? tr('leaveLeaderQ') : tr('leaveQ'));
      if (!ok) return;
      if ((await trySocial(social().leave().then(() => true), tr('left')))) { tab = null; await load(); }
    } }, svg('logout', 15), tr('leave'))));
    return out;
  }

  function memberSheet(v: ClanView, m: ClanView['members'][number]) {
    const my = v.myRole;
    const self = m.id === me();
    const acts: Child[] = [];
    let sheet: { close: () => void } | null = null;
    const act = (ico: string, label: string, fn: () => void, cls = '', disabled = false, hint?: string) =>
      acts.push(h('button', { class: `btn ${cls} clan-sheet-btn ${disabled ? 'disabled' : ''}`, onclick: () => { if (!disabled) fn(); } }, svg(ico, 16), label, hint ? h('small', { class: 'muted' }, hint) : null));
    const setRole = async (role: ClanRole) => { sheet?.close(); apply(await trySocial(social().setRole(m.id, role), tr('roleSet'))); };
    const kick = async () => { sheet?.close(); if (await confirmBox(`${tr('kickQ')}\n${m.name}`)) apply(await trySocial(social().kick(m.id), tr('kicked'))); };
    if (!self) act('chat', tr('pm'), () => { sheet?.close(); void openChat('dm', { id: m.id, name: m.name }); }, 'accent');
    if (!self && my === 'leader') {
      const deputies = v.members.filter((x) => x.role === 'co').length;
      if (m.role !== 'co') act(ROLE_ICON.co, tr('makeCo'), () => setRole('co'), '', deputies >= MAX_DEPUTIES, deputies >= MAX_DEPUTIES ? `(${tr('deputiesFull')} ${num(MAX_DEPUTIES)})` : undefined);
      if (m.role !== 'elder') act(ROLE_ICON.elder, tr('makeElder'), () => setRole('elder'));
      if (m.role !== 'member') act(ROLE_ICON.member, tr('makeMember'), () => setRole('member'));
      act('crown', tr('transfer'), async () => { sheet?.close(); if (await confirmBox(`${tr('transferQ')}\n${m.name}`)) await setRole('leader'); }, 'gold');
      act('logout', tr('kick'), kick, 'primary');
    } else if (!self && my === 'co' && ROLE_RANK[m.role] < ROLE_RANK.co) {
      if (m.role === 'member') act(ROLE_ICON.elder, tr('promote'), () => setRole('elder'));
      else act(ROLE_ICON.member, tr('demote'), () => setRole('member'));
      act('logout', tr('kick'), kick, 'primary');
    } else if (!self && my === 'elder' && m.role === 'member') {
      act('logout', tr('kick'), kick, 'primary');
    }
    sheet = modal(h('div', { class: 'clan-sheet' },
      h('div', { class: 'clan-sheet-head' },
        fighterCanvas(m.fighter, 0, 64),
        h('div', { class: 'clan-sheet-who' }, h('h2', {}, m.name), roleTag(m.role),
          h('small', { class: 'muted' }, `${tr('joinedAt')}: ${ago(m.joined)}`)),
      ),
      h('div', { class: 'stat-grid clan-sheet-stats' },
        sbox(num(m.mmr), tr('trophies')), sbox(num(m.level), tr('level')), sbox(num(m.donated), tr('donations')),
        sbox(num(m.gemsGiven), tr('gemsGiven')), sbox(num(m.warPts), tr('warPts'))),
      acts.length ? h('div', { class: 'clan-sheet-acts' }, acts) : h('div', { class: 'muted center' }, tr('noActions')),
    ), { cls: 'clan-modal' });
  }

  // ---- upgrades ---------------------------------------------------------------------------------
  function upgradesPane(v: ClanView) {
    const cost = v.nextCost;
    const pct = cost ? Math.min(100, (v.bank / cost) * 100) : 100;
    const donate = async (n: number) => apply(await trySocial(social().donateGems(n), `${tr('donated')} (${num(n)})`));
    const custom = () => {
      const inp = h('input', { class: 'input', type: 'number', min: 10, step: 10, value: 200, dir: 'ltr' }) as HTMLInputElement;
      const md = modal(h('div', { class: 'clan-custom' }, h('h3', {}, tr('donateGems')), h('label', { class: 'muted' }, tr('amount')), inp,
        h('button', { class: 'btn gem wide', onclick: () => { const n = Math.floor(Number(inp.value)); md.close(); void donate(n); } }, icon('gem'), tr('donate'))), { cls: 'clan-modal' });
      setTimeout(() => inp.focus(), 50);
    };
    const donors = [...v.members].filter((m) => m.gemsGiven > 0).sort((a, b) => b.gemsGiven - a.gemsGiven).slice(0, 3);
    return h('div', { class: 'two-col' },
      h('div', { class: 'box clan-upg' },
        h('div', { class: 'clan-lvl-row' },
          h('div', { class: 'clan-lvl' }, h('small', {}, tr('level')), h('b', {}, num(v.level)), h('small', { class: 'muted' }, ltr(`/ ${num(CLAN_MAX_LEVEL)}`))),
          h('div', { class: 'clan-bank' },
            h('div', { class: 'row space' }, h('span', { class: 'cur' }, icon('gem'), tr('bank')),
              h('b', {}, cost ? ltr(`${num(v.bank)} / ${num(cost)}`) : num(v.bank))),
            h('div', { class: 'xpbar wide' }, h('div', { style: { width: `${pct}%` } })),
            h('small', { class: 'muted' }, cost ? `${num(Math.max(0, cost - v.bank))} ${tr('nextLevel')}` : tr('maxLevel')),
          ),
        ),
        h('h3', {}, tr('donateGems')),
        h('div', { class: 'clan-donate' },
          [10, 50, 100].map((n) => h('button', { class: 'btn gem small', onclick: () => donate(n) }, icon('gem'), num(n))),
          h('button', { class: 'btn ghost small', onclick: custom }, tr('custom'))),
        canManage()
          ? h('button', { class: `btn gold wide ${!cost || v.bank < cost ? 'disabled' : ''}`, onclick: async () => apply(await trySocial(social().upgrade(), tr('upgraded'))) },
            svg('up', 16), cost ? [tr('upgrade'), h('span', { class: 'cur' }, icon('gem'), num(cost))] : tr('maxLevel'))
          : h('small', { class: 'muted center' }, `${tr('upgrade')}: ${tr('onlyLeaders')}`),
        donors.length ? h('div', { class: 'clan-donors' }, h('small', { class: 'muted' }, tr('topDonors')),
          donors.map((d) => h('span', { class: 'clan-chip' }, h('b', {}, d.name), icon('gem'), num(d.gemsGiven)))) : null,
      ),
      h('div', { class: 'box' }, h('h3', {}, tr('perks')),
        CLAN_PERKS.map((k) => {
          const on = v.level >= k.level;
          return h('div', { class: `clan-perk ${on ? 'on' : ''}` }, svg(on ? 'check' : 'lock', 14),
            h('span', { class: 'clan-perk-lv' }, `${tr('lv')} ${num(k.level)}`), h('span', {}, isFa() ? k.nameFa : k.name),
            !on && k.level === v.level + 1 ? h('span', { class: 'tag gold' }, icon('gem'), num(CLAN_LEVEL_COST[k.level - 2] ?? 0)) : null);
        })),
    );
  }

  // ---- cards ------------------------------------------------------------------------------------
  function cardsPane(v: ClanView) {
    const p = backend.profile;
    const limit = clanBonus(v.level).cardReq;
    const left = Math.max(0, limit - (p.daily?.cardReq ?? 0));
    const reqs = v.cardReqs as (CardRequest & { pending?: number })[];
    const myOpen = reqs.some((r) => r.uid === me() && r.got < r.need);
    const pend = reqs.filter((r) => r.uid === me()).reduce((a, r) => a + (r.pending ?? 0), 0);
    const collect = async () => {
      const n = await trySocial(social().collectCards());
      if (n === undefined) return;
      toast(n > 0 ? `+${num(n)} ${tr('collected')}` : tr('nothing'), n > 0 ? 'ok' : 'info');
      void load();
    };
    const pickFighter = () => {
      const md = modal(h('div', { class: 'clan-fpick' }, h('h3', {}, tr('pickFighter')),
        h('div', { class: 'clan-fgrid' }, p.fighters.map((id) => {
          const f = getFighter(id);
          return h('button', { class: 'fcard clan-fcard', onclick: async () => { md.close(); apply(await trySocial(social().requestCards(id), tr('reqSent'))); } },
            fighterCanvas(id, backend.selectedSkin(id), 60), h('b', {}, loc(f)), h('small', { class: 'muted' }, `${num(p.cards?.[id] ?? 0)} ${tr('cardsWord')}`));
        }))), { cls: 'clan-modal' });
    };
    return [
      h('div', { class: 'box clan-cardbox' },
        h('div', { class: 'clan-cardbox-main' }, h('h3', {}, svg('gift', 15), ' ', tr('reqCards')),
          h('small', { class: 'muted' }, `${tr('reqCardsText')} ${num(CARD_REQUEST_SIZE)} ${tr('cardsWord')}. `, h('b', {}, ltr(`${num(left)}/${num(limit)}`)), ` ${tr('todayLeft')}`)),
        h('div', { class: 'clan-cardbox-acts' },
          h('button', { class: `btn accent small ${left <= 0 || myOpen ? 'disabled' : ''}`, title: myOpen ? tr('myOpen') : '', onclick: pickFighter }, svg('gift', 14), tr('reqCards')),
          pend > 0 ? h('button', { class: 'btn gold small clan-collect', onclick: collect }, svg('check', 14), tr('collect'), h('span', { class: 'clan-tabn' }, num(pend))) : null),
      ),
      h('h3', { class: 'clan-sub' }, tr('openReqs')),
      reqs.length ? h('div', { class: 'clan-list' }, reqs.map((r) => {
        const f = getFighter(r.fighter);
        const own = r.uid === me();
        const full = r.got >= r.need;
        const have = p.cards?.[r.fighter] ?? 0;
        return h('div', { class: `clan-creq ${own ? 'me' : ''}` },
          fighterCanvas(r.fighter, 0, 40),
          h('div', { class: 'clan-creq-main' },
            h('div', { class: 'clan-creq-top' }, h('b', {}, r.name), h('span', { class: 'muted' }, `· ${loc(f)}`), h('small', { class: 'muted' }, ago(r.t))),
            h('div', { class: 'clan-prog' }, h('div', { class: 'xpbar' }, h('div', { style: { width: `${Math.min(100, (r.got / r.need) * 100)}%` } })), h('small', {}, ltr(`${num(r.got)}/${num(r.need)}`))),
          ),
          own ? h('span', { class: full ? 'tag ok' : 'tag' }, full ? tr('done') : tr('yours'))
            : full ? h('span', { class: 'tag ok' }, svg('check', 12), tr('done'))
              : h('button', { class: `btn small accent clan-act ${have < 1 ? 'disabled' : ''}`, onclick: async () => apply(await trySocial(social().donateCard(r.id), tr('thanks'))) },
                tr('donate'), h('small', {}, `(${num(have)})`)),
        );
      })) : h('div', { class: 'muted center clan-empty' }, tr('noReqs')),
    ];
  }

  // ---- war --------------------------------------------------------------------------------------
  function warPane(v: ClanView) {
    const out: Child[] = [];
    const w = v.war;
    if (w) {
      const lead = w.our >= w.their;
      const contrib = Object.entries(w.pts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const nameOf = (id: string) => v.members.find((m) => m.id === id)?.name ?? (id === me() ? backend.profile.name : id);
      out.push(h('div', { class: 'box clan-war' },
        h('div', { class: 'clan-score' },
          h('div', { class: 'clan-side' }, clanBadge(v.badge, 42), h('b', {}, v.name), h('small', { class: 'clan-tagtxt', dir: 'ltr' }, `[${v.tag}]`)),
          h('div', { class: 'clan-pts' }, h('b', { class: lead ? 'win' : '' }, num(w.our)), h('span', {}, ':'), h('b', { class: !lead ? 'lose' : '' }, num(w.their))),
          h('div', { class: 'clan-side' }, clanBadge(w.vsBadge, 42), h('b', {}, w.vsName), h('small', { class: 'clan-tagtxt', dir: 'ltr' }, `[${w.vsTag}]`)),
        ),
        h('div', { class: 'clan-timer' }, svg('history', 14), tr('timeLeft'), ' ', h('b', { 'data-end': w.end }, duration(w.end - Date.now()))),
        h('div', { class: 'xpbar' }, h('div', { style: { width: `${Math.min(100, ((Date.now() - w.start) / Math.max(1, w.end - w.start)) * 100)}%` } })),
      ));
      out.push(h('div', { class: 'box' }, h('h3', {}, tr('topContrib')),
        contrib.length ? contrib.map(([id, n], i) => h('div', { class: 'clan-contrib' }, h('span', { class: `pos ${i < 3 ? 'p' + (i + 1) : ''}` }, num(i + 1)), h('b', {}, nameOf(id)), h('span', { class: 'grow' }), chip('swords', num(n))))
          : h('small', { class: 'muted' }, tr('noPts'))));
    } else {
      out.push(h('div', { class: 'box clan-nowar' },
        h('div', { class: 'clan-nowar-ico' }, svg('swords', 30)),
        h('b', {}, v.searching ? tr('searching') : tr('noWar')),
        v.searching ? h('div', { class: 'loader clan-loader' }) : null,
        canManage()
          ? v.searching
            ? h('button', { class: 'btn ghost', onclick: async () => apply(await trySocial(social().warCancel())) }, tr('cancelSearch'))
            : h('button', { class: 'btn primary', onclick: async () => apply(await trySocial(social().warSearch(), tr('warStarted'))) }, svg('swords', 16), tr('searchWar'))
          : h('small', { class: 'muted' }, `${tr('searchWar')}: ${tr('onlyLeaders')}`),
      ));
    }
    out.push(h('div', { class: 'two-col' },
      h('div', { class: 'box' }, h('h3', {}, tr('warLog')),
        v.warLog.length ? v.warLog.map((l) => h('div', { class: 'clan-wlog' },
          h('span', { class: `wl ${l.won ? 'w' : 'l'}` }, l.won ? 'W' : 'L'),
          h('span', { class: 'clan-wlog-vs' }, `${tr('vs')} `, h('b', {}, l.vsName), ' ', h('span', { class: 'clan-tagtxt', dir: 'ltr' }, `[${l.vsTag}]`)),
          h('b', { dir: 'ltr' }, `${num(l.our)} - ${num(l.their)}`), h('small', { class: 'muted' }, ago(l.t))))
          : h('small', { class: 'muted' }, tr('noWarLog'))),
      h('div', { class: 'box help clan-rules' }, h('h3', {}, tr('rules')),
        h('ul', {},
          h('li', {}, isFa() ? 'هر برد آنلاین: ۳ امتیاز + تا ۳ امتیاز برای ناک‌اوت‌ها.' : 'Each online win: 3 points + up to 3 points for KOs.'),
          h('li', {}, isFa() ? 'هر باخت: ۱ امتیاز (به‌علاوه امتیاز ناک‌اوت).' : 'Each loss: 1 point (plus KO points).'),
          h('li', {}, isFa() ? 'قبیله‌ای که امتیاز بیشتری جمع کند می‌برد؛ جایزه سکه، الماس و رون با صندوق پیام برای اعضایی که جنگیده‌اند می‌آید.' : 'The clan with more points wins; coins, gems and runes are mailed to every member who fought.'),
          h('li', {}, isFa() ? 'برد جنگ ۱۵۰ الماس هم به خزانه می‌دهد. قبیله‌های متحد با هم جنگ نمی‌کنند.' : 'A war win also adds 150 gems to the bank. Allies are never matched against each other.'),
          social().demo ? h('li', {}, isFa() ? 'در نسخه آفلاین، مسابقه با کامپیوتر هم امتیاز جنگ حساب می‌شود و جنگ‌ها کوتاه‌ترند.' : 'In the offline demo, matches vs the CPU also count and wars are shorter.') : null,
        )),
    ));
    return out;
  }

  // ---- alliances --------------------------------------------------------------------------------
  function alliesPane(v: ClanView) {
    const out: Child[] = [];
    const mg = canManage();
    out.push(h('div', { class: 'box' },
      h('div', { class: 'row space' }, h('h3', {}, svg('handshake', 15), ' ', tr('alliesTitle'), ' ', ltr(`${num(v.allies.length)}/${num(MAX_ALLIES)}`)),
        h('button', { class: 'btn small accent', onclick: () => openChat('ally') }, svg('chat', 14), tr('allyChat'))),
      h('small', { class: 'muted' }, tr('allyText')),
      v.allies.length ? h('div', { class: 'clan-list' }, v.allies.map((a) => clanRow(a, mg ? h('button', { class: 'btn small ghost clan-act', onclick: stop(async () => {
        if (await confirmBox(`${tr('breakQ')}\n[${a.tag}] ${a.name}`)) apply(await trySocial(social().allyBreak(a.id)));
      }) }, tr('breakAlly')) : null))) : h('div', { class: 'muted center clan-empty' }, tr('noAllies')),
    ));
    if (v.allyIn.length) {
      out.push(h('div', { class: 'box' }, h('h3', {}, tr('proposals')),
        h('div', { class: 'clan-list' }, v.allyIn.map((a) => clanRow(a, mg ? h('div', { class: 'clan-act row' },
          h('button', { class: 'btn small accent', onclick: stop(async () => apply(await trySocial(social().allyRespond(a.id, true), tr('allied')))) }, svg('check', 14)),
          h('button', { class: 'btn small ghost', onclick: stop(async () => apply(await trySocial(social().allyRespond(a.id, false)))) }, svg('close', 14)),
        ) : null)))));
    }
    if (mg) {
      const list = h('div', { class: 'clan-list' });
      const q = h('input', { class: 'input grow', placeholder: tr('searchPh'), maxlength: 24 }) as HTMLInputElement;
      const run = async () => {
        const rows = await trySocial(social().search(q.value));
        list.innerHTML = '';
        if (!rows) return;
        const cands = rows.filter((c) => c.id !== v.id && !v.allies.some((a) => a.id === c.id));
        if (!cands.length) { list.append(h('div', { class: 'muted center clan-empty' }, tr('noClans'))); return; }
        for (const c of cands.slice(0, 12)) {
          const sent = v.allyOut.includes(c.id);
          list.append(clanRow(c, sent ? h('span', { class: 'tag ok clan-act' }, svg('check', 12), tr('sent'))
            : h('button', { class: `btn small primary clan-act ${v.allies.length >= MAX_ALLIES ? 'disabled' : ''}`, onclick: stop(async () => apply(await trySocial(social().allyRequest(c.id), tr('proposed')))) },
              tr('propose'))));
        }
      };
      q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { q.blur(); void run(); } });
      void run();
      out.push(h('div', { class: 'box' }, h('h3', {}, tr('proposeTitle')),
        v.allies.length >= MAX_ALLIES ? h('small', { class: 'muted' }, tr('allyFull')) : null,
        h('div', { class: 'clan-search' }, q, h('button', { class: 'btn accent', onclick: run }, svg('search', 16))), list));
    }
    return out;
  }

  // ---- log / settings -----------------------------------------------------------------------------
  function logPane(v: ClanView) {
    if (!v.log.length) return h('div', { class: 'muted center clan-empty' }, tr('logEmpty'));
    return h('div', { class: 'box clan-log' }, v.log.map((l) => h('div', { class: 'clan-logrow' }, h('span', { dir: 'auto' }, isFa() ? l.fa : l.en), h('small', { class: 'muted' }, ago(l.t)))));
  }

  function settingsPane(v: ClanView) {
    const inp: Partial<ClanInput> = { desc: v.desc, type: v.type, minMmr: v.minMmr, badge: v.badge };
    const desc = h('textarea', { class: 'input clan-desc', maxlength: 120, rows: 2, oninput: (e: Event) => { inp.desc = (e.target as HTMLTextAreaElement).value; } });
    desc.value = v.desc;
    const min = h('input', { class: 'input clan-num', type: 'number', min: 0, max: 3000, step: 100, value: v.minMmr, dir: 'ltr', oninput: (e: Event) => { inp.minMmr = Number((e.target as HTMLInputElement).value) || 0; } });
    return h('div', { class: 'two-col' },
      h('div', { class: 'box' },
        field(tr('desc'), desc),
        field(tr('type'), seg(v.type, [['open', tr('open')], ['invite', tr('invite')], ['closed', tr('closed')]], (x) => { inp.type = x; })),
        field(tr('minTrophies'), min),
        h('button', { class: 'btn primary wide', onclick: async () => apply(await trySocial(social().edit(inp), tr('saved'))) }, svg('check', 16), tr('save')),
      ),
      h('div', { class: 'box' }, h('h3', {}, tr('badge')), badgePicker(v.badge, (b) => { inp.badge = b; })),
    );
  }

  void load();
  return { el, destroy: () => { alive = false; offChange(); clearInterval(timer); } };
}

function field(label: string, control: Child) {
  return h('label', { class: 'clan-field' }, h('span', {}, label), control);
}
function sbox(v: string, label: string) { return h('div', { class: 'stat-box' }, h('b', {}, v), h('span', {}, label)); }
