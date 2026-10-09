import { FEATURES, featureUnlocked, getFighter, getStage, type FeatureId, type FighterState, type GameEvent, type GameState } from '@nb/shared';
import { backend } from '../services/backend.ts';
import { store } from '../services/platform.ts';
import { isTouch } from '../game/input.ts';
import { t, isFa, setLang } from '../i18n.ts';
import { h, modal, show } from './dom.ts';
import { svg } from './icons.ts';

type L = { fa: string; en: string };
const tr = (l: L) => (isFa() ? l.fa : l.en);

// =============================================================================================
// Coach marks: spotlight an element and explain it
// =============================================================================================
export interface CoachStep { target?: string; title: L; text: L }

let coachOpen = false;
export function coach(steps: CoachStep[], onDone?: () => void) {
  if (coachOpen || !steps.length) { onDone?.(); return; }
  coachOpen = true;
  let i = 0;
  const block = h('div', { class: 'coach-block' });
  const hole = h('div', { class: 'coach-hole' });
  const bubble = h('div', { class: 'coach-bubble' });
  document.body.append(block, hole, bubble);
  const finish = () => {
    coachOpen = false;
    block.remove(); hole.remove(); bubble.remove();
    removeEventListener('resize', place);
    onDone?.();
  };
  const render = () => {
    const s = steps[i];
    bubble.innerHTML = '';
    bubble.append(
      h('b', {}, tr(s.title)),
      h('p', {}, tr(s.text)),
      h('div', { class: 'row' },
        h('span', { class: 'steps' }, steps.length > 1 ? `${i + 1} / ${steps.length}` : ''),
        h('div', { class: 'row' },
          i < steps.length - 1 ? h('button', { class: 'btn small ghost', onclick: finish }, t('skip')) : null,
          h('button', { class: 'btn small accent', onclick: () => { if (++i >= steps.length) finish(); else render(); } }, i < steps.length - 1 ? t('next') : t('gotIt')),
        )),
    );
    place();
  };
  function place() {
    const s = steps[i];
    const el = s.target ? document.querySelector(s.target) as HTMLElement | null : null;
    const vw = innerWidth, vh = innerHeight;
    if (!el) {
      Object.assign(hole.style, { left: `${vw / 2}px`, top: `${vh / 2}px`, width: '0px', height: '0px' });
      const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
      Object.assign(bubble.style, { left: `${(vw - bw) / 2}px`, top: `${(vh - bh) / 2}px` });
      return;
    }
    const r = el.getBoundingClientRect();
    const pad = 5;
    Object.assign(hole.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
    const bw = bubble.offsetWidth, bh = bubble.offsetHeight, m = 10;
    // prefer beside the target (landscape screens), else below / above
    let x: number, y: number;
    if (r.right + m + bw < vw) { x = r.right + m; y = r.top + r.height / 2 - bh / 2; }
    else if (r.left - m - bw > 0) { x = r.left - m - bw; y = r.top + r.height / 2 - bh / 2; }
    else if (r.bottom + m + bh < vh) { x = r.left + r.width / 2 - bw / 2; y = r.bottom + m; }
    else { x = r.left + r.width / 2 - bw / 2; y = r.top - m - bh; }
    x = Math.max(8, Math.min(vw - bw - 8, x));
    y = Math.max(8, Math.min(vh - bh - 8, y));
    Object.assign(bubble.style, { left: `${x}px`, top: `${y}px` });
  }
  addEventListener('resize', place);
  render();
  requestAnimationFrame(place);
}

/** Runs a screen's intro the first time it is opened. */
export function introOnce(id: string, steps: CoachStep[], pause?: { paused: boolean }) {
  const seen = store.get<string[]>('intros', []);
  if (seen.includes(id)) return;
  setTimeout(() => {
    if (pause) pause.paused = true;
    coach(steps, () => { if (pause) pause.paused = false; store.set('intros', [...store.get<string[]>('intros', []), id]); });
  }, 450);
}
export function resetIntros() { store.set('intros', []); }

// =============================================================================================
// Feature unlocks
// =============================================================================================
export const FEATURE_INFO: Record<FeatureId, { icon: string; target: string; name: L; text: L }> = {
  quests: { icon: 'quests', target: '[data-f=quests]', name: { fa: 'مأموریت‌های روزانه', en: 'Daily quests' }, text: { fa: 'هر روز سه مأموریت جدید داری. انجامشان بده و سکه و الماس بگیر. اگر مأموریتی را دوست نداری، عوضش کن.', en: 'Three new quests every day. Complete them for coins and gems — reroll the ones you don\'t like.' } },
  shop: { icon: 'shop', target: '[data-f=shop]', name: { fa: 'فروشگاه', en: 'Shop' }, text: { fa: 'مبارزهای جدید، اسکین‌ها و جعبه‌ها را اینجا با سکه یا الماس بخر. پیشنهادهای ویژه هم اینجاست.', en: 'Buy new fighters, skins and crates with coins or gems. Special offers live here too.' } },
  achievements: { icon: 'medal', target: '[data-f=achievements]', name: { fa: 'دستاوردها', en: 'Achievements' }, text: { fa: 'اهداف بلندمدت با جایزه‌های بزرگ‌تر. هر دستاوردی که کامل شد را اینجا دریافت کن.', en: 'Long-term goals with bigger rewards. Claim each one here when it\'s done.' } },
  pass: { icon: 'pass', target: '[data-f=pass]', name: { fa: 'پاس فصل', en: 'Season Pass' }, text: { fa: 'با هر مسابقه امتیاز تجربه می‌گیری و مراحل پاس باز می‌شوند. مسیر رایگان برای همه است؛ مسیر ویژه اسکین‌های انحصاری دارد.', en: 'Every match earns XP that unlocks pass tiers. The free track is for everyone; premium adds exclusive skins.' } },
  crates: { icon: 'crate', target: '[data-f=shop]', name: { fa: 'جعبه‌ها', en: 'Crates' }, text: { fa: 'هر ۴ ساعت یک جعبه رایگان در فروشگاه منتظرت است. احتمال هر جایزه را قبل از باز کردن ببین.', en: 'A free crate waits in the shop every 4 hours. Check the drop odds before you open one.' } },
  milestones: { icon: 'flame', target: '[data-f=quests]', name: { fa: 'مایل‌استون مبارزه روزانه', en: 'Daily fight milestones' }, text: { fa: 'هر مبارزه‌ای که امروز انجام بدهی شمرده می‌شود. با ۱، ۳، ۵، ۸، ۱۲، ۱۶ و ۲۰ مبارزه جایزه‌های بزرگ‌تر باز می‌شوند — در صفحه مأموریت‌ها.', en: 'Every fight today counts. 1, 3, 5, 8, 12, 16 and 20 fights unlock bigger rewards — on the quests screen.' } },
  cards: { icon: 'fighters', target: '[data-f=fighters]', name: { fa: 'کارت و ارتقای مبارز', en: 'Fighter cards & upgrades' }, text: { fa: 'از نقشه، جعبه و مسابقه کارت مبارز می‌گیری. با کارت و سکه، حمله، دفاع و سلامت هر مبارز را تا سطح ۱۰ ارتقا بده.', en: 'Earn fighter cards from the map, crates and matches. Spend cards + coins to raise each fighter\'s Attack, Defense and Health up to level 10.' } },
  wheel: { icon: 'gift', target: '[data-f=wheel]', name: { fa: 'گردونه شانس', en: 'Lucky wheel' }, text: { fa: 'هر روز یک چرخش رایگان داری و با دیدن تبلیغ سه چرخش دیگر. جایزه‌ها: سکه، رون، کارت و الماس.', en: 'One free spin every day plus three more by watching an ad. Coins, runes, cards and gems.' } },
  spells: { icon: 'sparkles', target: '[data-f=spells]', name: { fa: 'جادو و رون', en: 'Spells & runes' }, text: { fa: 'رون ارز جادویی است. با آن جادو یاد بگیر و ارتقا بده، بعد برای هر مبارز یک جادو انتخاب کن. در مبارزه وقتی نوار جادو پر شد دکمه جادو را بزن.', en: 'Runes are the magic currency. Learn and level spells, then equip one per fighter. In a fight, press the magic button when the meter is full.' } },
  online: { icon: 'globe', target: '.mode.m-quick', name: { fa: 'بازی آنلاین باز شد!', en: 'Online play unlocked!' }, text: { fa: 'نقشه جهان را فتح کردی. حالا با بازیکن‌های واقعی ۱ به ۱، ۲ به ۲ یا همه با هم مبارزه کن.', en: 'You conquered the world map. Now fight real players 1v1, 2v2 or free-for-all.' } },
  friends: { icon: 'users', target: '.mode.m-friends', name: { fa: 'بازی با دوستان', en: 'Play with friends' }, text: { fa: 'یک اتاق خصوصی بساز و کد ۵ حرفی را برای دوستت بفرست. تا ۴ نفر، تیمی یا همه با هم.', en: 'Create a private room and send the 5-letter code to a friend. Up to 4 players, teams or free-for-all.' } },
  ranked: { icon: 'trophy', target: '.mode.m-ranked', name: { fa: 'لیگ', en: 'League' }, text: { fa: 'نبرد ۱ به ۱ برای امتیاز لیگ: برنزی، نقره‌ای، طلایی، کریستالی و افسانه‌ای. هر لیگ سه دسته دارد و رسیدن به هر دسته جایزه دارد.', en: '1v1 for league points: Bronze, Silver, Gold, Crystal and Legendary. Each league has three divisions and every promotion pays a reward.' } },
  chat: { icon: 'chat', target: '[data-f=chat]', name: { fa: 'چت', en: 'Chat' }, text: { fa: 'چت جهانی با همه، چت قبیله، چت اتحاد و پیام خصوصی بین اعضای قبیله. پیام توهین‌آمیز را گزارش بده تا پلیس بازی رسیدگی کند.', en: 'Global chat, clan chat, alliance chat and private messages between clan mates. Report abuse and the Game Police will handle it.' } },
  clans: { icon: 'shield', target: '.mode.m-clan', name: { fa: 'قبیله', en: 'Clans' }, text: { fa: 'به یک قبیله بپیوند یا بساز (تا ۱۵ نفر). رئیس معاون و زیردست انتخاب می‌کند، با الماس قبیله را ارتقا بدهید و قابلیت بگیرید، کارت هدیه بدهید و با قبیله‌های دیگر متحد شوید.', en: 'Join or found a clan (up to 15). The leader appoints deputies and officers; upgrade the clan with gems for perks, trade cards and ally with other clans.' } },
  clanwar: { icon: 'flame', target: '.mode.m-clan', name: { fa: 'جنگ قبیله‌ای', en: 'Clan wars' }, text: { fa: 'رئیس یا معاون جنگ را شروع می‌کند. هر برد آنلاین اعضا امتیاز جنگ می‌آورد؛ قبیله برنده الماس، رون و سکه می‌گیرد.', en: 'The leader or a deputy starts a war. Every online win scores war points; the winning clan earns gems, runes and coins.' } },
};

/** Shows one pending "feature unlocked" popup + coach mark (called on the home screen). */
export function checkUnlocks(): boolean {
  if (!document.querySelector('.home') || document.querySelector('.modal-wrap, .coach-bubble')) return false;
  const p = backend.profile;
  for (const f of FEATURES) {
    const key = 'unlock:' + f.id;
    if (!featureUnlocked(p, f.id) || backend.seen(key)) continue;
    const info = FEATURE_INFO[f.id];
    backend.completeTutorial(key);
    const m = modal(h('div', { class: 'unlock' },
      h('div', { class: 'art-ico c-cyan' }, svg(info.icon, 42)),
      h('small', { class: 'tag gold' }, t('newUnlock')),
      h('h2', { class: 'title-grad' }, tr(info.name)),
      h('p', { class: 'muted' }, tr(info.text)),
      h('button', { class: 'btn accent big', onclick: () => m.close() }, t('showMe')),
    ), { onClose: () => coach([{ target: info.target, title: info.name, text: info.text }], () => { setTimeout(checkUnlocks, 250); }) });
    return true;
  }
  return false;
}

/** Players who already played before this version: mark existing unlocks as known (no popup storm). */
export function silenceExistingUnlocks() {
  const p = backend.profile;
  for (const f of FEATURES) if (featureUnlocked(p, f.id)) backend.completeTutorial('unlock:' + f.id);
}

// =============================================================================================
// First launch: language → name → tutorial
// =============================================================================================
export function onboarding(startTutorial: () => void, home: () => void) {
  const p = backend.profile;
  const step1 = () => {
    const m = modal(h('div', { class: 'onboard' },
      h('h1', { class: 'logo', style: { fontSize: '40px' } }, 'NEON', h('span', {}, 'BRAWL')),
      h('p', { class: 'muted' }, 'زبان را انتخاب کن · Choose your language'),
      h('div', { class: 'row' },
        h('button', { class: 'btn big accent', onclick: () => { setLang('fa'); backend.saveProfile({ settings: { lang: 'fa' } }); m.close(); step2(); } }, 'فارسی'),
        h('button', { class: 'btn big accent', onclick: () => { setLang('en'); backend.saveProfile({ settings: { lang: 'en' } }); m.close(); step2(); } }, 'English'),
      )), { closable: false });
  };
  const step2 = () => {
    const input = h('input', { class: 'input', value: p.name, maxlength: 16, style: { width: '220px', textAlign: 'center', fontSize: '16px' } }) as HTMLInputElement;
    const m = modal(h('div', { class: 'onboard' },
      h('h2', {}, t('welcome')),
      h('p', { class: 'muted' }, t('pickName')),
      input,
      h('p', { class: 'muted', style: { maxWidth: '380px' } }, t('tutorialPitch')),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => { save(); m.close(); backend.completeTutorial('onboard'); home(); } }, t('skipTutorial')),
        h('button', { class: 'btn big primary', onclick: () => { save(); m.close(); backend.completeTutorial('onboard'); startTutorial(); } }, svg('play', 16), t('startTutorial')),
      )), { closable: false });
    const save = () => { const n = input.value.trim(); if (n) backend.saveProfile({ name: n }); };
    setTimeout(() => input.focus(), 100);
  };
  step1();
  void show;
}

// =============================================================================================
// Interactive tutorial match
// =============================================================================================
export interface TutCtx { state: GameState; events: GameEvent[]; me: FighterState; dummy: FighterState; mem: Record<string, number> }
export interface TutStep {
  id: string;
  title: L;
  hint: L;            // keyboard / gamepad wording
  touch: L;           // touch wording
  btn?: 'attack' | 'special' | 'jump' | 'shield' | 'grab' | 'smash';
  setup?: (c: TutCtx) => void;
  check: (c: TutCtx) => boolean;
}

const swung = (c: TutCtx, moves: string[]) => c.events.some((e) => e.t === 'swing' && e.slot === 0 && moves.includes(e.move));

function placeOffstage(c: TutCtx) {
  const m = getStage(c.state.cfg.stageId).main;
  Object.assign(c.me, { x: m.x2 + 110, y: m.y + 10, vx: 0, vy: -4, kx: 0, ky: 0, facing: -1, action: 'air', af: 0, grounded: false, platform: -1, jumps: 0, usedRecovery: false, usedSide: false, airdodged: false, fastFall: false, invuln: 0 });
}

export const TUTORIAL: TutStep[] = [
  {
    id: 'move', title: { fa: 'حرکت کن', en: 'Move around' },
    hint: { fa: 'با A/D یا کلیدهای جهت به چپ و راست برو', en: 'Use A/D or the arrow keys to walk left and right' },
    touch: { fa: 'جوی‌استیک سمت چپ را به چپ و راست بکش', en: 'Drag the left joystick left and right' },
    check: (c) => { c.mem.dist = (c.mem.dist ?? 0) + Math.abs(c.me.vx); return c.mem.dist > 260; },
  },
  {
    id: 'jump', title: { fa: 'بپر', en: 'Jump' },
    hint: { fa: 'Space را بزن', en: 'Press Space' }, touch: { fa: 'دکمه سبز پرش را بزن', en: 'Tap the green JUMP button' }, btn: 'jump',
    check: (c) => c.events.some((e) => e.t === 'jump' && e.slot === 0),
  },
  {
    id: 'djump', title: { fa: 'پرش دوم در هوا', en: 'Double jump' },
    hint: { fa: 'وقتی در هوا هستی دوباره Space بزن', en: 'Press Space again while airborne' }, touch: { fa: 'در هوا دوباره پرش را بزن', en: 'Tap JUMP again in the air' }, btn: 'jump',
    check: (c) => !c.me.grounded && c.me.jumps < getFighter(c.me.charId).stats.airJumps,
  },
  {
    id: 'jab', title: { fa: 'ضربه بزن', en: 'Basic attack' },
    hint: { fa: 'کنار حریف برو و J را بزن', en: 'Walk up to the dummy and press J' }, touch: { fa: 'کنار حریف برو و دکمه A را بزن', en: 'Get close and tap A' }, btn: 'attack',
    check: (c) => c.events.some((e) => e.t === 'hit' && e.attacker === 0),
  },
  {
    id: 'tilt', title: { fa: 'ضربه جهت‌دار', en: 'Directional attacks' },
    hint: { fa: 'یک جهت (بالا/پایین/جلو) را نگه دار و J را بزن', en: 'Hold a direction (up / down / forward) and press J' },
    touch: { fa: 'جوی‌استیک را به یک جهت نگه دار و A را بزن', en: 'Hold the stick in a direction and tap A' }, btn: 'attack',
    check: (c) => swung(c, ['ftilt', 'utilt', 'dtilt', 'dash']),
  },
  {
    id: 'aerial', title: { fa: 'حمله هوایی', en: 'Aerial attack' },
    hint: { fa: 'بپر و در هوا J را بزن', en: 'Jump, then press J in the air' }, touch: { fa: 'بپر و در هوا A را بزن', en: 'Jump, then tap A in the air' }, btn: 'attack',
    check: (c) => swung(c, ['nair', 'fair', 'bair', 'uair', 'dair']),
  },
  {
    id: 'smash', title: { fa: 'ضربه اسمش (قدرتی)', en: 'Smash attack' },
    hint: { fa: 'I را نگه دار تا شارژ شود و رها کن — با نگه داشتن جهت، اسمش به همان سمت می‌رود', en: 'Hold I to charge, then release — hold a direction to aim it' },
    touch: { fa: 'دکمه نارنجی (صاعقه) را نگه دار تا شارژ شود و رها کن', en: 'Hold the orange SMASH button to charge, then release' }, btn: 'smash',
    check: (c) => swung(c, ['fsmash', 'usmash', 'dsmash']),
  },
  {
    id: 'special', title: { fa: 'حرکت ویژه', en: 'Special move' },
    hint: { fa: 'K را بزن — هر مبارز حرکت‌های خاص خودش را دارد', en: 'Press K — every fighter has unique specials' },
    touch: { fa: 'دکمه آبی B را بزن', en: 'Tap the blue B button' }, btn: 'special',
    check: (c) => swung(c, ['nspecial', 'sspecial', 'dspecial']),
  },
  {
    id: 'shield', title: { fa: 'سپر بگیر', en: 'Shield' },
    hint: { fa: 'L را نگه دار — سپر ضربه‌ها را می‌گیرد اما کم‌کم کوچک می‌شود', en: 'Hold L — the shield blocks hits but shrinks over time' },
    touch: { fa: 'دکمه بنفش سپر را نگه دار', en: 'Hold the purple SHIELD button' }, btn: 'shield',
    check: (c) => { c.mem.sh = c.me.action === 'shield' ? (c.mem.sh ?? 0) + 1 : 0; return c.mem.sh > 40; },
  },
  {
    id: 'dodge', title: { fa: 'جاخالی بده', en: 'Dodge' },
    hint: { fa: 'سپر را نگه دار و یک جهت بزن (غلت) — در هوا سپر = جاخالی هوایی', en: 'Hold shield and tap a direction to roll — in the air, shield = air dodge' },
    touch: { fa: 'سپر را نگه دار و جوی‌استیک را به یک طرف بکش', en: 'Hold SHIELD and flick the stick sideways' }, btn: 'shield',
    check: (c) => ['roll', 'spotdodge', 'airdodge'].includes(c.me.action),
  },
  {
    id: 'grab', title: { fa: 'بگیر و پرتاب کن', en: 'Grab & throw' },
    hint: { fa: 'کنار حریف U را بزن، بعد یک جهت را بزن تا پرتابش کنی. گرفتن سپر را می‌شکند!', en: 'Next to the dummy press U, then a direction to throw. Grabs beat shields!' },
    touch: { fa: 'کنار حریف دکمه زرد را بزن، بعد جوی‌استیک را به یک جهت بکش', en: 'Get close, tap the yellow GRAB button, then push a direction' }, btn: 'grab',
    check: (c) => swung(c, ['fthrow', 'bthrow', 'uthrow', 'dthrow']),
  },
  {
    id: 'recover', title: { fa: 'به صحنه برگرد', en: 'Recover to the stage' },
    hint: { fa: 'بیرون صحنه افتادی! W + K (بالا + ویژه) بزن و به لبه یا صحنه برگرد', en: 'You\'re off stage! Press W + K (up + special) to reach the ledge or the stage' },
    touch: { fa: 'بیرون صحنه افتادی! جوی‌استیک را بالا نگه دار و B را بزن', en: 'You\'re off stage! Hold the stick up and tap B' }, btn: 'special',
    setup: placeOffstage,
    check: (c) => {
      if (c.events.some((e) => e.t === 'ko' && e.slot === 0)) { c.mem.retry = 1; }
      if (c.mem.retry && c.me.action === 'spawn') { c.mem.retry = 0; c.mem.go = 0; placeOffstage(c); }
      // hover in place until the player acts, so there is time to read the instruction
      if (!c.mem.go) {
        if (c.me.inp) c.mem.go = 1;
        else { const m = getStage(c.state.cfg.stageId).main; c.me.x = m.x2 + 110; c.me.y = m.y + 10; c.me.vx = 0; c.me.vy = 0; }
      }
      return (c.me.grounded && c.me.platform === 0) || c.me.action === 'ledge';
    },
  },
  {
    id: 'ko', title: { fa: 'حریف را بیرون بینداز!', en: 'Knock it out!' },
    hint: { fa: 'درصد آسیب حریف بالاست؛ با یک ضربه قوی (اسمش) از صحنه بیرونش بینداز', en: 'The dummy is at high damage — launch it off the stage with a strong (smash) attack' },
    touch: { fa: 'درصد حریف بالاست؛ با دکمه نارنجی اسمش بیرونش بینداز', en: 'The dummy is at high damage — use SMASH to launch it off the stage' }, btn: 'smash',
    setup: (c) => { c.dummy.damage = 140; c.dummy.x = c.me.x + 70 * c.me.facing; c.dummy.y = c.me.y; },
    check: (c) => c.events.some((e) => e.t === 'ko' && e.slot === 1),
  },
];

export function tutorialText(step: TutStep) {
  return { title: tr(step.title), hint: tr(isTouch() ? step.touch : step.hint) };
}
