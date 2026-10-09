import { RAID, raidFee, fortCost, raidAttacksLeft, getFighter, ROLE_RANK, type Raid, type RaidView, type ClanView } from '@nb/shared';
import { backend } from '../services/backend.ts';
import { social, type RaidTarget } from '../services/social.ts';
import { isFa, num, loc, duration } from '../i18n.ts';
import { h, show, topBar, toast, modal, confirmBox, fighterCanvas, icon, type Screen, type Child } from './dom.ts';
import { svg } from './icons.ts';
import { introOnce } from './tutorial.ts';
import { clanBadge, socialErrorText, ltr } from './clan.ts';
import './raid.css';

type Lx = { fa: string; en: string };
const T = (fa: string, en: string) => (isFa() ? fa : en);
const tr = (l: Lx) => (isFa() ? l.fa : l.en);

const BLOCK: Record<string, Lx> = {
  self: { fa: 'قبیله خودت', en: 'Your own clan' },
  ally: { fa: 'متحد شماست', en: 'Allied clan' },
  level: { fa: `قبیله باید سطح ${RAID.minLevel} باشد`, en: `Your clan needs level ${RAID.minLevel}` },
  members: { fa: `حداقل ${RAID.minMembers} عضو لازم است`, en: `Needs ${RAID.minMembers}+ members` },
  busy: { fa: 'یک حمله فعال دارید', en: 'You already have an active attack' },
  cooldown: { fa: 'زمان استراحت بعد از حمله قبلی', en: 'Cooling down after the last attack' },
  banner: { fa: 'پرچم جنگ ندارید', en: 'No war banner left' },
  'target-busy': { fa: 'زیر حمله قبیله دیگری است', en: 'Already under attack' },
  shield: { fa: 'سپر محافظ دارد', en: 'Protected by a shield' },
  recent: { fa: 'تازه به آن حمله کرده‌اید (۷۲ ساعت)', en: 'Attacked recently (72 h)' },
  weak: { fa: 'خیلی ضعیف‌تر از شماست', en: 'Too weak for you' },
  strong: { fa: 'خیلی قوی‌تر از شماست', en: 'Too strong for you' },
  funds: { fa: 'خزانه برای هزینه کافی نیست', en: 'Treasury can\'t pay the fee' },
  time: { fa: 'زمان شروع باید حداقل یک ساعت بعد باشد', en: 'Start must be at least one hour ahead' },
  started: { fa: 'حمله شروع شده', en: 'The attack has started' },
  closed: { fa: 'پنجره حمله باز نیست', en: 'The attack window is not open' },
  cleared: { fa: 'این مدافع سه ستاره از دست داده', en: 'This defender is already 3-starred' },
  'in-fight': { fa: 'یک نبرد باز داری', en: 'You already have a fight open' },
};
function errText(code: string) {
  if (code.startsWith('raid-') && BLOCK[code.slice(5)]) return tr(BLOCK[code.slice(5)]);
  if (code === 'cheat') return T('نتیجه نامعتبر بود و برای پلیس بازی ثبت شد', 'The result was invalid and was logged for the Game Police');
  if (code === 'limit') return T('حمله‌هایت تمام شده', 'No attacks left');
  return socialErrorText(code);
}
async function tryR<T>(p: Promise<T>, ok?: string) {
  try { const r = await p; if (ok) toast(ok, 'ok'); return r; } catch (e) { toast(errText((e as Error).message), 'err'); return undefined; }
}

const left = (ms: number) => duration(Math.max(0, ms));
/** live countdown span (updated by the screen's 1 s timer) */
const cd = (until: number) => h('span', { 'data-until': String(until) }, left(until - Date.now()));
const clockAt = (t: number) => new Date(t).toLocaleString(isFa() ? 'fa-IR' : 'en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });

export function raidScreen(): Screen {
  const body = h('div', { class: 'scroll raid-body' }, h('p', { class: 'muted center' }, '…'));
  let clan: ClanView | null = null;
  let view: RaidView | null = null;
  let timer = 0;
  const load = async () => {
    try {
      clan = await social().myClan();
      if (!clan) { body.innerHTML = ''; body.append(h('p', { class: 'muted center' }, T('اول عضو یک قبیله شو.', 'Join a clan first.'))); return; }
      view = await social().raid();
      render();
    } catch (e) { body.innerHTML = ''; body.append(h('p', { class: 'muted center' }, errText((e as Error).message))); }
  };
  const canLead = () => !!clan?.myRole && ROLE_RANK[clan.myRole] >= ROLE_RANK.co;

  const render = () => {
    if (!view || !clan) return;
    const v = view;
    const now = Date.now();
    const keepScroll = body.scrollTop;
    body.innerHTML = '';
    // status strip: banners, shield, cooldown, trophies
    body.append(h('div', { class: 'raid-status' },
      h('div', { class: 'rs' }, svg('flag', 16), h('b', {}, `${num(v.banners)}/${num(RAID.maxBanners)}`), h('small', {}, T('پرچم جنگ', 'War banners')),
        v.nextBanner ? h('small', { class: 'muted' }, '+1 ', cd(v.nextBanner)) : null),
      h('div', { class: 'rs' }, svg('shield', 16), h('b', {}, v.shieldUntil > now ? cd(v.shieldUntil) : T('ندارد', 'none')), h('small', {}, T('سپر محافظ', 'Shield'))),
      h('div', { class: 'rs' }, svg('refresh', 16), h('b', {}, v.cdUntil > now ? cd(v.cdUntil) : T('آماده', 'ready')), h('small', {}, T('استراحت حمله', 'Attack cooldown'))),
      h('div', { class: 'rs' }, svg('trophy', 16), h('b', {}, num(v.trophies)), h('small', {}, T('جام قبیله', 'Clan trophies'))),
    ));
    if (v.inc) body.append(raidCard(v.inc, false));
    if (v.out) body.append(raidCard(v.out, true));
    if (!v.out) body.append(declareBox());
    if (v.helping.length) body.append(h('div', { class: 'box' }, h('h3', {}, svg('handshake', 16), ' ', T('کمک به متحدان', 'Help your allies')),
      v.helping.map((r) => h('div', { class: 'raid-help-row' },
        clanBadge(r.defBadge, 26), h('span', {}, `[${r.defTag}] ${r.defName} ← [${r.attTag}]`), h('small', { class: 'muted' }, cd(r.start)),
        h('button', { class: 'btn small accent', onclick: async () => { if (await tryR(social().raidHelp(r.id), T('به دفاع اضافه شدی', 'You joined the defense')) !== undefined) void load(); } }, T('دفاع می‌کنم', 'Defend'))))));
    body.append(rulesBox());
    if (v.log.length) body.append(h('div', { class: 'box' }, h('h3', {}, T('سابقه حمله‌ها', 'Attack history')),
      v.log.map((l) => h('div', { class: `raid-log ${l.won ? 'won' : 'lost'}` },
        svg(l.attacker ? 'swords' : 'shield', 14), h('span', {}, `[${l.vsTag}] ${l.vsName}`), ltr(`${num(l.our)}/${num(l.max)}★`), h('b', {}, l.won ? T('برد', 'Won') : T('باخت', 'Lost'))))));
    body.scrollTop = keepScroll;
  };

  const raidCard = (r: Raid, attacking: boolean): HTMLElement => {
    const now = Date.now();
    const stars = r.slots.reduce((a, s) => a + s.stars, 0), max = r.slots.length * 3;
    const phase = r.status === 'declared' ? T('شروع تا', 'Starts in') : r.status === 'live' ? T('پایان تا', 'Ends in') : T('تمام شد', 'Finished');
    const until = r.status === 'declared' ? r.start : r.status === 'live' ? r.end : 0;
    const me = backend.profile.id;
    const myLeft = attacking ? raidAttacksLeft(r, me) : 0;
    const need = Math.ceil(max * RAID.winRatio);
    return h('div', { class: `raid-card ${attacking ? 'att' : 'def'} st-${r.status}` },
      h('div', { class: 'rc-head' },
        clanBadge(attacking ? r.attBadge : r.defBadge, 34),
        h('div', { class: 'rc-vs' },
          h('b', {}, attacking ? T('حمله ما به', 'Our attack on') : T('حمله به ما از', 'Attack on us by'), ' ', h('span', { dir: 'ltr' }, `[${attacking ? r.defTag : r.attTag}]`), ' ', attacking ? r.defName : r.attName),
          h('small', { class: 'muted' }, phase, ' ', until ? cd(until) : '', ` · ${clockAt(r.start)}`)),
        clanBadge(attacking ? r.defBadge : r.attBadge, 34)),
      h('div', { class: 'rc-score' },
        h('span', { class: 'stars' }, h('i', { class: 'on' })), h('b', { dir: 'ltr' }, `${num(stars)} / ${num(max)}`),
        h('small', { class: 'muted' }, attacking ? T(`برای پیروزی ${num(need)} ستاره لازم است`, `${num(need)} stars needed to win`) : T(`اگر کمتر از ${num(need)} ستاره ببرند، دفاع پیروز است`, `Hold them under ${num(need)} stars to win`)),
        r.fort ? h('span', { class: 'tag' }, svg('shield', 12), `${T('استحکامات', 'Walls')} ${num(r.fort)}`) : null,
        attacking && r.status === 'live' ? h('span', { class: 'tag gold' }, `${T('حمله‌های تو', 'Your attacks')}: ${num(myLeft)}`) : null),
      h('div', { class: 'rc-slots' }, r.slots.map((s, i) => h('div', { class: `rc-slot ${s.stars >= 3 ? 'down' : ''}` },
        fighterCanvas(s.fighter, s.skin, 56),
        h('b', {}, s.name), s.helper ? h('small', { class: 'tag' }, `[${s.helper}]`) : h('small', { class: 'muted' }, loc(getFighter(s.fighter))),
        h('span', { class: 'stars' }, [1, 2, 3].map((k) => h('i', { class: k <= s.stars ? 'on' : '' }))),
        attacking && r.status === 'live' && s.stars < 3
          ? h('button', { class: `btn small primary ${myLeft > 0 ? '' : 'disabled'}`, onclick: () => attack(r, i) }, svg('swords', 14), T('حمله', 'Attack'))
          : null))),
      // defender preparation
      !attacking && r.status === 'declared' && canLead() ? h('div', { class: 'rc-prep' },
        h('button', { class: 'btn small accent', onclick: () => lineupModal(r) }, svg('users', 14), T('انتخاب مدافع‌ها', 'Choose defenders')),
        r.fort < RAID.fortMax ? h('button', { class: 'btn small gold', onclick: async () => {
          if (await confirmBox(T(`ساخت استحکامات سطح ${num(r.fort + 1)} با ${num(fortCost(r.fort))} الماس از خزانه؟ مدافع‌ها ۵٪ آسیب کمتر و ۵٪ مقاومت بیشتر می‌گیرند.`, `Build level ${r.fort + 1} walls for ${fortCost(r.fort)} treasury gems? Defenders take 5% less damage and resist knockback 5% more.`)))
            if (await tryR(social().raidFortify(r.id), T('تقویت شد', 'Fortified')) !== undefined) void load();
        } }, svg('shield', 14), T('استحکامات', 'Fortify'), ' ', icon('gem'), num(fortCost(r.fort))) : null,
        h('small', { class: 'muted' }, T('از متحدان بخواهید تا ۲ نفر به دفاع شما بپیوندند.', 'Ask your allies — up to 2 of their players can join your defense.'))) : null,
      attacking && r.status === 'declared' && canLead() ? h('div', { class: 'rc-prep' },
        h('button', { class: 'btn small ghost', onclick: async () => {
          if (await confirmBox(T('لغو حمله؟ پرچم و هزینه برنمی‌گردد.', 'Withdraw? The banner and fee are not refunded.'))) if (await tryR(social().raidWithdraw()) !== undefined) void load();
        } }, T('لغو حمله', 'Withdraw'))) : null,
      r.attacks.length ? h('div', { class: 'rc-feed' }, r.attacks.slice(0, 8).map((a) => h('div', {}, h('b', {}, a.name), ' → ', r.slots[a.slot]?.name ?? '?', ' ', h('span', { class: 'stars' }, [1, 2, 3].map((k) => h('i', { class: k <= a.stars ? 'on' : '' })))))) : null,
    );
  };

  const attack = async (r: Raid, slot: number) => {
    const f = await tryR(social().raidFight(r.id, slot));
    if (!f) return;
    const play = await import('./play.ts');
    play.startRaidFight(f, () => show(raidScreen));
  };

  const lineupModal = (r: Raid) => {
    if (!clan) return;
    const chosen = new Set(r.slots.filter((s) => !s.helper).map((s) => s.uid));
    const list = h('div', { class: 'raid-pick' });
    const draw = () => {
      list.innerHTML = '';
      for (const m of clan!.members) {
        const on = chosen.has(m.id);
        list.append(h('button', { class: `raid-pick-row ${on ? 'on' : ''}`, onclick: () => { if (on) chosen.delete(m.id); else if (chosen.size < RAID.slots) chosen.add(m.id); draw(); } },
          fighterCanvas(m.fighter, 0, 34), h('b', {}, m.name), h('small', { class: 'muted' }, `${num(m.mmr)} · Lv ${num(m.level)}`), on ? svg('check', 16) : null));
      }
    };
    draw();
    const md = modal(h('div', { class: 'raid-lineup' },
      h('h3', {}, T(`${num(RAID.slots)} مدافع انتخاب کن`, `Pick ${RAID.slots} defenders`)),
      list,
      h('button', { class: 'btn primary', onclick: async () => { if (await tryR(social().raidLineup(r.id, [...chosen]), T('ذخیره شد', 'Saved')) !== undefined) { md.close(); void load(); } } }, T('ذخیره', 'Save'))));
  };

  const declareBox = (): HTMLElement => {
    const box = h('div', { class: 'box raid-declare' },
      h('h3', {}, svg('swords', 16), ' ', T('اعلام حمله', 'Declare an attack')),
      !canLead() ? h('p', { class: 'muted' }, T('فقط رئیس و معاون می‌توانند اعلام حمله کنند.', 'Only the leader and deputies can declare an attack.')) : null);
    if (!canLead()) return box;
    const q = h('input', { class: 'input', placeholder: T('جستجوی قبیله', 'Search clans') }) as HTMLInputElement;
    const list = h('div', { class: 'raid-targets' }, h('p', { class: 'muted' }, '…'));
    const fill = async () => {
      const ts = await tryR(social().raidTargets(q.value));
      list.innerHTML = '';
      for (const c of ts ?? []) list.append(targetRow(c));
    };
    q.addEventListener('change', fill);
    box.append(h('div', { class: 'row' }, q, h('button', { class: 'btn small', onclick: fill }, svg('search', 14))), list);
    void fill();
    return box;
  };

  const targetRow = (c: RaidTarget) => h('div', { class: `raid-target ${c.block ? 'blocked' : ''}` },
    clanBadge(c.badge, 30),
    h('div', { class: 'rt-main' }, h('b', {}, c.name, ' ', h('span', { class: 'muted', dir: 'ltr' }, `[${c.tag}]`)),
      h('small', { class: 'muted' }, `Lv ${num(c.level)} · ${num(c.members)} ${T('عضو', 'members')} · ${T('قدرت', 'power')} ${num(c.power)} · ${num(c.trophies)} 🏆`.replace(' 🏆', ` ${T('جام', 'trophies')}`))),
    c.block ? h('small', { class: 'rt-block' }, svg('lock', 12), tr(BLOCK[c.block] ?? { fa: c.block, en: c.block }))
      : h('button', { class: 'btn small primary', onclick: () => declareModal(c) }, T('اعلام حمله', 'Declare'), ' ', icon('gem'), num(c.fee)));

  const declareModal = (c: RaidTarget) => {
    const timing = social().raidTiming();
    const options = timing.fast ? [2, 5, 10].map((m) => m * 60_000) : [1, 2, 4, 8, 12, 24].map((x) => x * 3600_000);
    let lead = options[0];
    const chips = h('div', { class: 'row' });
    const drawChips = () => {
      chips.innerHTML = '';
      for (const o of options) chips.append(h('button', { class: `btn small ${o === lead ? 'accent' : 'ghost'}`, onclick: () => { lead = o; drawChips(); } },
        timing.fast ? `${num(o / 60_000)} ${T('دقیقه', 'min')}` : `${num(o / 3600_000)} ${T('ساعت', 'h')}`));
      at.textContent = `${T('شروع', 'Starts')}: ${clockAt(Date.now() + lead)}`;
    };
    const at = h('small', { class: 'muted' });
    drawChips();
    const md = modal(h('div', { class: 'raid-declare-modal' },
      clanBadge(c.badge, 48),
      h('h3', {}, `${T('حمله به', 'Attack')} [${c.tag}] ${c.name}`),
      h('p', { class: 'muted small' }, T('زمان شروع را انتخاب کن. حداقل یک ساعت فاصله لازم است تا مدافع آماده شود. حمله یک ساعت طول می‌کشد و هر عضو ۲ نبرد دارد.', 'Pick the start time. At least one hour ahead so the defenders can prepare. The attack lasts one hour; every member gets 2 fights.')),
      timing.fast ? h('small', { class: 'tag gold' }, T('حالت تست: زمان‌ها کوتاه شده', 'Test mode: shortened timings')) : null,
      chips, at,
      h('div', { class: 'chips' }, h('span', { class: 'cur' }, svg('flag', 14), T('۱ پرچم جنگ', '1 war banner')), h('span', { class: 'cur' }, icon('gem'), `${num(raidFee(c.level))} ${T('از خزانه', 'from treasury')}`)),
      h('button', { class: 'btn primary big', onclick: async () => {
        if (await tryR(social().raidDeclare(c.id, Date.now() + lead + 5000), T('اعلام حمله شد! مدافع خبردار شد.', 'Attack declared! The defenders were notified.')) !== undefined) { md.close(); void load(); }
      } }, svg('swords', 18), T('اعلام جنگ', 'Declare war'))));
  };

  const rulesBox = () => h('details', { class: 'box raid-rules' },
    h('summary', {}, svg('help', 14), ' ', T('قوانین حمله قبیله‌ای', 'Clan attack rules')),
    h('ul', {}, [
      T('رئیس یا معاون با یک پرچم جنگ و پرداخت هزینه از خزانه اعلام حمله می‌کند. هر ۲۴ ساعت یک پرچم (حداکثر ۲).', 'The leader or a deputy declares with a war banner and a treasury fee. One banner per 24 h (max 2).'),
      T('زمان شروع حداقل ۱ ساعت و حداکثر ۴۸ ساعت بعد است. مدافع در این مدت مدافع‌ها را انتخاب می‌کند، استحکامات می‌سازد و از متحدان کمک می‌گیرد.', 'Start is 1–48 hours ahead. Meanwhile the defenders pick their lineup, build walls and call allies.'),
      T('پنجره حمله ۱ ساعت است. هر عضو مهاجم ۲ نبرد با مبارز مدافع‌ها (با ارتقا و جادوی خودشان) دارد.', 'The attack lasts 1 hour. Each attacker gets 2 fights against the defenders\' own fighters, upgrades and spells.'),
      T('ستاره: برد ۱، بدون سقوط +۱، زیر دو دقیقه +۱. با ۵۰٪ ستاره‌ها مهاجم برنده است.', 'Stars: win 1, no falls +1, under two minutes +1. 50% of the stars wins the attack.'),
      T('برنده جام قبیله، رون و سکه می‌گیرد؛ مهاجم پیروز ۱۰٪ خزانه حریف را (تا ۴۰۰) غارت می‌کند.', 'Winners earn clan trophies, runes and coins; a winning attacker loots 10% of the defender\'s treasury (max 400).'),
      T('ضد اسپم: فقط یک حمله در هر زمان، ۱۲ ساعت استراحت بعد از حمله، ۷۲ ساعت تا حمله دوباره به همان قبیله، ۲۴ ساعت سپر برای مدافع، ۴۸ ساعت محافظت قبیله تازه، حریف باید هم‌قدرت باشد (۶۰٪ تا ۱۸۰٪) و به متحد نمی‌شود حمله کرد.', 'Anti-spam: one attack at a time, 12 h cooldown, 72 h before hitting the same clan, 24 h defender shield, 48 h protection for new clans, targets must be 60–180% of your strength, never allies.'),
    ].map((x) => h('li', {}, x))));

  introOnce('raid', [
    { target: '.raid-status', title: { fa: 'حمله قبیله‌ای', en: 'Clan attacks' }, text: { fa: 'پرچم جنگ برای اعلام حمله لازم است. بعد از هر حمله، سپر و زمان استراحت فعال می‌شود تا کسی نتواند پشت سر هم جنگ راه بیندازد.', en: 'War banners are needed to declare. After every attack, shields and cooldowns kick in so nobody can spam wars.' } },
    { target: '.raid-declare', title: { fa: 'انتخاب حریف و زمان', en: 'Pick a target and time' }, text: { fa: 'فقط قبیله‌های هم‌قدرت قابل حمله‌اند. زمان شروع حداقل یک ساعت بعد است تا مدافع آماده شود.', en: 'Only clans of similar strength can be attacked. The start is at least an hour ahead so the defenders can prepare.' } },
  ]);

  void load();
  const off = social().onChange((k) => { if (k === 'raid' || k === 'clan') void load(); });
  timer = window.setInterval(() => {
    let expired = false;
    body.querySelectorAll<HTMLElement>('[data-until]').forEach((el) => {
      const ms = Number(el.dataset.until) - Date.now();
      el.textContent = left(ms);
      if (ms <= 0 && ms > -1500) expired = true;
    });
    if (expired) void load(); // a phase changed (start / end / shield over)
  }, 1000);
  return {
    el: h('div', { class: 'page raidscreen' }, topBar({ back: () => import('./clan.ts').then((m) => show(m.clanScreen)), title: T('حمله قبیله‌ای', 'Clan attack') }), body),
    destroy: () => { off(); clearInterval(timer); },
  };
}
export type { Child };
