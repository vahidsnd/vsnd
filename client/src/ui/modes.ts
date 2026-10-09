import {
  FIGHTERS, STAGES, COUNTDOWN, TICK_RATE, getFighter, placements, fighterMods, stageUnlocked, featureUnlocked, featureRequirement,
  eventAt, eventConfig, EVENT_CPU_DAILY, EVENT_TRACK, eventStepReward, claimableEvent, ITEM_KINDS, RULE_PRESETS,
  survivalConfig, survivalProgress, SURVIVAL, SURVIVAL_MILESTONES, bossConfig, BOSSES, BOSS_TIERS, CLAN_BOSS, ROUND_NAMES, BRACKET_SIZE,
  type Bracket, type ClanBossView, type EventDef, type FeatureId, type GameState, type ItemKind, type MatchConfig, type MatchRules,
  type MatchSummary, type RuleMode, type TourneyTier, type TSeat, type MatchEndInfo,
} from '@nb/shared';
import { backend } from '../services/backend.ts';
import { modes, type EventInfo, type TourneyInfo } from '../services/modes.ts';
import { social } from '../services/social.ts';
import { net } from '../net/net.ts';
import { ads } from '../services/ads.ts';
import { LocalSession } from '../game/session.ts';
import { drawItemIcon, ITEM_COLORS, ITEM_NAMES } from '../game/modefx.ts';
import { isFa, num, loc, duration } from '../i18n.ts';
import { h, show, topBar, toast, modal, fighterCanvas, rewardReveal, grantedToItems, icon, lockText, type Screen, type Child, type RewardItem } from './dom.ts';
import { svg } from './icons.ts';
import { introOnce, type CoachStep } from './tutorial.ts';
import { homeScreen } from './home.ts';
import { gameScreen, resultsScreen, playerSource } from './play.ts';
import { rewardChips } from './progress.ts';
import { RULE_INFO } from './rulepick.ts';
import './modes.css';

// =====================================================================================
//  Special modes: the arena hub, timed events, the weekend tournament, survival and the
//  clan co-op boss. Every mode plays offline vs the computer; online parts go through
//  services/modes.ts (server routes in server/src/modes.ts).
// =====================================================================================

type Lx = { fa: string; en: string };
const T = (fa: string, en: string) => (isFa() ? fa : en);
const tr = (l: Lx) => (isFa() ? l.fa : l.en);
const home = () => show(homeScreen);
const ltr = (s: string) => h('span', { dir: 'ltr', class: 'ltr' }, s);

const ERR: Record<string, Lx> = {
  funds: { fa: 'سکه یا الماس کافی نداری', en: 'Not enough coins or gems' },
  already: { fa: 'در این هفته ثبت‌نام کرده‌ای', en: 'You are already signed up' },
  'tourney-closed': { fa: 'ثبت‌نام بسته است', en: 'Sign-ups are closed' },
  'tourney-locked': { fa: 'جدول قفل شده؛ انصراف ممکن نیست', en: 'The bracket is locked' },
  limit: { fa: 'تلاش‌های امروزت تمام شده', en: 'No attempts left today' },
  'no-clan': { fa: 'اول عضو یک قبیله شو', en: 'Join a clan first' },
  'boss-in-fight': { fa: 'یک نبرد باز داری', en: 'You already have a fight open' },
  cheat: { fa: 'نتیجه نامعتبر بود و برای پلیس بازی ثبت شد', en: 'The result was invalid and was logged for the Game Police' },
  locked: { fa: 'هنوز باز نشده', en: 'Not unlocked yet' },
  connect: { fa: 'اتصال برقرار نیست', en: 'Not connected' },
  'no-match': { fa: 'مسابقه‌ای برای تو نیست', en: 'No match for you right now' },
};
const errText = (e: unknown) => { const c = (e as Error)?.message ?? String(e); return ERR[c] ? tr(ERR[c]) : c; };

export { RULE_INFO };
const ITEM_TEXT: Record<ItemKind, Lx> = {
  heal: { fa: '۳۵ آسیب را درمان می‌کند', en: 'heals 35 damage' },
  bomb: { fa: 'با دکمه گرفتن پرتابش کن', en: 'throw it with the grab button' },
  boots: { fa: '۸ ثانیه سرعت بیشتر', en: '8 s of extra speed' },
  bubble: { fa: '۵ ثانیه آسیب‌ناپذیر', en: '5 s invulnerable' },
  mana: { fa: 'نوار جادو را پر می‌کند', en: 'fills your spell meter' },
};

export function itemCanvas(kind: ItemKind, size = 26) {
  const q = Math.min(2, window.devicePixelRatio || 1);
  const c = h('canvas', { class: 'item-ico', width: Math.round(size * q), height: Math.round(size * q), style: { width: `${size}px`, height: `${size}px` } });
  const ctx = c.getContext('2d')!;
  ctx.scale(q, q); ctx.translate(size / 2, size / 2 + size * 0.06);
  drawItemIcon(ctx, kind, size * 0.36, 0.4);
  return c;
}

function ruleModeOf(r: MatchRules | undefined): RuleMode | null {
  if (!r) return null;
  if (r.suddenDeath) return 'sudden';
  if (r.stamina) return 'stamina';
  if (r.giant) return 'giant';
  if (r.spellsOnly) return 'spells';
  if (r.gravity && r.gravity < 1) return 'lowgrav';
  if (r.items) return 'items';
  return null;
}

/** Chips describing a rule set (event screen, intros). */
export function ruleChips(r: MatchRules | undefined): HTMLElement {
  const out: Child[] = [];
  if (r?.gravity && r.gravity < 1) out.push(h('span', { class: 'rule-chip' }, svg('sparkles', 13), tr(RULE_INFO.lowgrav.name)));
  if (r?.spellsOnly) out.push(h('span', { class: 'rule-chip' }, svg('wand', 13), tr(RULE_INFO.spells.name)));
  if (r?.giant) out.push(h('span', { class: 'rule-chip' }, svg('zap', 13), tr(RULE_INFO.giant.name)));
  if (r?.stamina) out.push(h('span', { class: 'rule-chip' }, svg('heart', 13), `${tr(RULE_INFO.stamina.name)} · ${num(r.stamina)} HP`));
  if (r?.suddenDeath) out.push(h('span', { class: 'rule-chip' }, svg('flame', 13), `${tr(RULE_INFO.sudden.name)} · ${num(300)}%`));
  if (r?.items) out.push(h('span', { class: 'rule-chip items' }, svg('gift', 13), T('آیتم‌ها', 'Items'), ...(r.itemKinds?.length ? r.itemKinds : ITEM_KINDS).map((k) => itemCanvas(k, 18))));
  else out.push(h('span', { class: 'rule-chip off' }, svg('close', 13), T('بدون آیتم', 'No items')));
  return h('div', { class: 'rule-chips' }, out);
}

/** Coach marks for the first match of each special mode (pauses the match). */
export function rulesIntro(key: string, rules: MatchRules | undefined, pause: { paused: boolean }) { modeIntro(key, rules, pause); }
function modeIntro(key: string, rules: MatchRules | undefined, pause: { paused: boolean }, extra: CoachStep[] = []) {
  const steps: CoachStep[] = [...extra];
  const m = ruleModeOf(rules);
  if (m && m !== 'items') steps.push({ title: RULE_INFO[m].name, text: RULE_INFO[m].text });
  if (rules?.items) {
    const kinds = rules.itemKinds?.length ? rules.itemKinds : ITEM_KINDS;
    steps.push({
      target: '.tb-grab',
      title: { fa: 'آیتم‌ها', en: 'Items' },
      text: { fa: `آیتم‌ها روی صحنه ظاهر می‌شوند؛ از رویشان رد شو تا برداری. ${kinds.map((k) => `${ITEM_NAMES[k].fa}: ${ITEM_TEXT[k].fa}`).join('، ')}.`, en: `Items pop up on the stage — walk over one to pick it up. ${kinds.map((k) => `${ITEM_NAMES[k].en}: ${ITEM_TEXT[k].en}`).join('; ')}.` },
    });
  }
  if (steps.length) setTimeout(() => introOnce(`mode-${key}`, steps, pause), 300);
}

/** Intro for online event / tournament matches (started by the server). */
export function onlineModeIntro(mode: string, cfg: MatchConfig) {
  const s = (window as any).__session as { paused: boolean } | undefined;
  // online matches can't pause: the coach mark only explains (no pause object)
  const key = mode === 'tourney' ? 'tourney-online' : `event-${ruleModeOf(cfg.rules) ?? 'x'}`;
  modeIntro(key, cfg.rules, { paused: false }, mode === 'tourney' ? [{ title: { fa: 'مسابقه تورنمنت', en: 'Tournament match' }, text: { fa: 'برنده به دور بعد جدول می‌رود. موفق باشی!', en: 'The winner moves on in the bracket. Good luck!' } }] : []);
  void s;
}

function summaryOf(state: GameState, id: string, fighter: string): MatchSummary {
  const f = state.fighters[0];
  const place = placements(state);
  return {
    matchId: id, mode: 'cpu', won: state.winnerTeam === f.team, placement: place[0], players: state.fighters.length,
    kos: f.stats.kos, falls: f.stats.falls, dmg: f.stats.dmgDealt, smashKOs: f.stats.smashKOs, maxCombo: f.stats.maxCombo, fighter,
    durationSec: Math.max(0, state.endFrame - COUNTDOWN) / TICK_RATE,
  };
}
const endInfo = (state: GameState): MatchEndInfo => ({ winnerTeam: state.winnerTeam, placements: placements(state), stats: state.fighters.map((x) => x.stats) });
const randFighter = () => FIGHTERS[Math.floor(Math.random() * FIGHTERS.length)].id;
const cpuLevel = () => Math.min(8, 3 + Math.floor(backend.profile.level / 4));

// =============================================================================================
// Arena hub
// =============================================================================================
export function arenaScreen(): Screen {
  const p = backend.profile;
  const now = Date.now();
  const ev = eventAt(now);
  const open = (f: FeatureId) => featureUnlocked(p, f);
  const card = (cls: string, f: FeatureId, art: Child, title: string, sub: Child, fn: () => void, badge = 0) => {
    const ok = open(f);
    return h('button', { class: `arena-card ${cls} ${ok ? '' : 'locked'}`, 'data-f': cls, onclick: () => (ok ? fn() : toast(`${T('باز می‌شود در', 'Unlocks at')} ${lockText(featureRequirement(f))}`, 'info')) },
      h('div', { class: 'ac-art' }, art),
      h('b', {}, title), h('small', {}, ok ? sub : h('span', {}, svg('lock', 12), ' ', lockText(featureRequirement(f)))),
      ok && badge ? h('span', { class: 'badge' }, num(badge)) : null);
  };
  const sv = survivalProgress(p, now);
  const grid = h('div', { class: 'arena-grid' },
    card('a-event', 'events', h('div', { class: 'ac-ico', style: { '--c': ev.def.color } as any }, svg(ev.def.icon, 34)), tr({ fa: ev.def.nameFa, en: ev.def.name }),
      h('span', {}, svg('calendar', 12), ' ', duration(ev.end - now)), () => show(eventScreen), claimableEvent(p, now)),
    card('a-tourney', 'tournament', h('div', { class: 'ac-ico', style: { '--c': '#ffd23f' } as any }, svg('trophy', 34)), T('تورنمنت آخر هفته', 'Weekend tournament'),
      T('جدول حذفی ۸ نفره', '8-player knockout'), () => show(tourneyScreen)),
    card('a-survival', 'survival', h('div', { class: 'ac-ico', style: { '--c': '#ff4f6d' } as any }, svg('skull', 34)), T('بقا', 'Survival'),
      `${T('رکورد', 'Best')}: ${T('موج', 'wave')} ${num(sv.best)}`, () => show(survivalScreen)),
    card('a-boss', 'clanboss', h('div', { class: 'ac-ico', style: { '--c': '#2ee6a6' } as any }, svg('shield', 34)), T('غول قبیله', 'Clan boss'),
      p.clan ? `[${p.clan.tag}] ${T('هفتگی', 'weekly')}` : T('نیاز به قبیله', 'Needs a clan'), () => show(clanBossScreen)),
  );
  introOnce('arena', [{ target: '.arena-grid', title: { fa: 'میدان‌های ویژه', en: 'Special arenas' }, text: { fa: 'رویداد چرخشی با جایزه انحصاری، تورنمنت آخر هفته، حالت بقا و غول هفتگی قبیله — همه را اینجا پیدا می‌کنی.', en: 'The rotating event with its exclusive prize, the weekend tournament, survival and the weekly clan boss — all in one place.' } }]);
  return { el: h('div', { class: 'page arena' }, topBar({ back: home, title: T('میدان‌های ویژه', 'Arena') }), h('div', { class: 'scroll' }, grid)) };
}

/** Home-screen banner for the running event. */
export function eventBanner(): HTMLElement | null {
  const p = backend.profile;
  if (!featureUnlocked(p, 'events')) return null;
  const now = Date.now();
  const ev = eventAt(now);
  const n = claimableEvent(p, now);
  return h('button', { class: 'event-banner', 'data-f': 'event', style: { '--c': ev.def.color } as any, onclick: () => show(eventScreen) },
    svg(ev.def.icon, 16), h('b', {}, tr({ fa: ev.def.nameFa, en: ev.def.name })), h('small', {}, duration(ev.end - now)),
    n ? h('span', { class: 'badge' }, num(n)) : null);
}

// =============================================================================================
// Timed event
// =============================================================================================
export function eventScreen(): Screen {
  const body = h('div', { class: 'ev-body' }, h('p', { class: 'muted center' }, '…'));
  let info: EventInfo | null = null;
  let timer = 0;
  const load = async () => {
    try { info = await modes.event(); render(); } catch (e) { toast(errText(e), 'err'); }
  };
  const render = () => {
    if (!info) return;
    const p = backend.profile;
    const now = Date.now();
    const def = info.event.def;
    const pr = info.progress;
    const rules = eventConfig(def, 1, []).rules;
    const skinIdx = getFighter(def.skin.fighter).skins.findIndex((s) => s.id === def.skin.id);
    const maxWins = EVENT_TRACK[EVENT_TRACK.length - 1].wins;
    body.innerHTML = '';
    const head = h('div', { class: 'ev-head', style: { '--c': def.color } as any },
      h('div', { class: 'ev-title' }, h('div', { class: 'ev-ico' }, svg(def.icon, 26)),
        h('div', {}, h('h2', {}, tr({ fa: def.nameFa, en: def.name })), h('small', { class: 'muted' }, svg('calendar', 12), ' ', T('پایان در', 'Ends in'), ' ', h('b', { 'data-until': String(info.event.end) }, duration(info.event.end - now))))),
      h('p', {}, tr({ fa: def.descFa, en: def.desc })),
      ruleChips(rules),
      h('div', { class: 'ev-play' },
        h('button', { class: 'btn primary', onclick: () => startEventMatch(1) }, svg('bot', 16), T('۱ به ۱ با کامپیوتر', '1v1 vs CPU')),
        h('button', { class: 'btn', onclick: () => startEventMatch(3) }, svg('users', 16), T('۴ نفره', '4-player FFA')),
        h('button', { class: `btn accent ${backend.online ? '' : 'disabled'}`, 'data-f': 'evonline', onclick: () => import('./play.ts').then((m) => show(() => m.matchmakingScreen('event', '1v1'))) }, svg('globe', 16), T('صف آنلاین', 'Online queue')),
      ),
      h('small', { class: 'muted' }, `${T('بردهای با کامپیوتر امروز', 'CPU wins today')}: ${num(pr.cpuDay === new Date(now + 3.5 * 3600_000).toISOString().slice(0, 10) ? pr.cpu ?? 0 : 0)}/${num(EVENT_CPU_DAILY)} · ${T('بردهای آنلاین نامحدود', 'online wins unlimited')}`),
    );
    const track = h('div', { class: 'ev-track box' },
      h('div', { class: 'ev-prog' }, h('b', {}, `${T('برد', 'Wins')} ${num(pr.wins)}/${num(maxWins)}`), h('div', { class: 'xpbar wide' }, h('div', { style: { width: `${Math.min(100, (pr.wins / maxWins) * 100)}%`, background: def.color } }))),
      EVENT_TRACK.map((s, i) => {
        const claimed = pr.claimed.includes(i), ready = pr.wins >= s.wins && !claimed;
        const r = eventStepReward(def, s);
        return h('div', { class: `ev-step ${claimed ? 'got' : ready ? 'ready' : ''} ${s.skin ? 'top' : ''}` },
          h('span', { class: 'ev-need' }, svg('trophy', 12), num(s.wins)),
          h('div', { class: 'ev-rew' }, rewardChips({ ...r, skins: undefined }), s.skin ? h('span', { class: 'tag gold' }, svg('star', 11), T('اسکین انحصاری', 'Exclusive skin')) : null, s.token ? h('span', { class: 'tag' }, svg('medal', 11), tr({ fa: def.token.nameFa, en: def.token.name })) : null),
          claimed ? h('span', { class: 'tag ok' }, svg('check', 12)) : ready ? h('button', { class: 'btn small gold', onclick: async () => {
            try {
              const c = await modes.eventClaim(i);
              if (c) {
                const items: RewardItem[] = grantedToItems(c.granted).filter((x) => !(x.kind === 'skin' && c.skin));
                if (c.skin) items.unshift({ kind: 'skin', id: c.skin });
                rewardReveal(tr({ fa: def.nameFa, en: def.name }), items);
              }
              load();
            } catch (e) { toast(errText(e), 'err'); }
          } }, T('دریافت', 'Claim')) : h('span', { class: 'muted small' }, `${num(Math.max(0, s.wins - pr.wins))} ${T('برد مانده', 'to go')}`));
      }));
    const owned = p.skins.includes(def.skin.id);
    const prize = h('div', { class: 'ev-prize box', style: { '--c': def.color } as any },
      fighterCanvas(def.skin.fighter, Math.max(0, skinIdx), 120),
      h('b', {}, tr({ fa: def.skin.nameFa, en: def.skin.name })),
      h('small', { class: 'muted' }, loc(getFighter(def.skin.fighter))),
      owned ? h('span', { class: 'tag ok' }, svg('check', 11), T('داری', 'Owned')) : h('span', { class: 'tag gold' }, T(`با ${num(maxWins)} برد`, `at ${num(maxWins)} wins`)));
    const cal = h('div', { class: 'ev-cal box' }, h('h3', {}, svg('calendar', 14), T('تقویم رویدادها', 'Event calendar')),
      info.calendar.slice(1, 5).map((e) => h('div', { class: 'ev-cal-row', style: { '--c': e.def.color } as any },
        svg(e.def.icon, 14), h('b', {}, tr({ fa: e.def.nameFa, en: e.def.name })),
        h('small', { class: 'muted' }, new Date(e.start).toLocaleDateString(isFa() ? 'fa-IR' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' })),
        e.special ? h('span', { class: 'tag gold' }, T('ویژه', 'Special')) : null)));
    body.append(h('div', { class: 'ev-col' }, head, cal), h('div', { class: 'ev-col' }, h('div', { class: 'ev-row' }, prize, track)));
  };
  timer = window.setInterval(() => body.querySelectorAll<HTMLElement>('[data-until]').forEach((el) => { el.textContent = duration(Number(el.dataset.until) - Date.now()); }), 1000);
  load();
  introOnce('event-screen', [
    { target: '.ev-head', title: { fa: 'رویداد ویژه', en: 'Special event' }, text: { fa: 'هر ۲ تا ۳ روز یک حالت جدید. با کامپیوتر یا در صف آنلاین بازی کن؛ هر برد یک قدم در مسیر جایزه است.', en: 'A new mode every 2–3 days. Play vs the CPU or in the online queue — every win is a step on the reward track.' } },
    { target: '.ev-prize', title: { fa: 'جایزه انحصاری', en: 'Exclusive prize' }, text: { fa: 'این اسکین فقط از همین رویداد به دست می‌آید.', en: 'This skin can only be earned in this event.' } },
  ]);
  return { el: h('div', { class: 'page event' }, topBar({ back: () => show(arenaScreen), title: T('رویداد', 'Event') }), body), destroy: () => clearInterval(timer) };
}

export function startEventMatch(opponents: 1 | 3) {
  const p = backend.profile;
  const def: EventDef = eventAt(Date.now()).def;
  const fighter = p.selFighter;
  const lv = cpuLevel();
  const players: MatchConfig['players'] = [{ charId: fighter, skin: backend.selectedSkin(fighter), team: 0, name: p.name, mods: fighterMods(p, fighter) }];
  for (let i = 0; i < opponents; i++) players.push({ charId: randFighter(), skin: Math.floor(Math.random() * 3), team: i + 1, name: `CPU ${i + 1}`, bot: true });
  const cfg = eventConfig(def, Math.floor(Math.random() * 1e9), players);
  const session = new LocalSession(cfg, [playerSource(true), ...players.slice(1).map(() => null)], [null, ...players.slice(1).map(() => lv)]);
  show(() => gameScreen(session, {
    online: false,
    onLocalEnd: async (state) => {
      ads.noteMatch();
      const s = summaryOf(state, 'ev-' + Date.now(), fighter);
      const r = await modes.eventReport(s).catch(() => ({ reward: null, counted: false }));
      if (social().demo) social().matchPlayed(s.won, s.kos);
      const pr = backend.profile.ev;
      const extra = h('div', { class: 'res-mode', style: { '--c': def.color } as any }, svg(def.icon, 16), h('b', {}, tr({ fa: def.nameFa, en: def.name })),
        h('small', {}, r.counted ? T('برد ثبت شد! ', 'Win counted! ') : s.won ? T('سقف بردهای امروز با کامپیوتر پر شده. ', 'Daily CPU win cap reached. ') : '',
          `${T('برد رویداد', 'Event wins')}: ${num(pr?.wins ?? 0)}/${num(EVENT_TRACK[EVENT_TRACK.length - 1].wins)}`));
      show(() => resultsScreen(state, 0, endInfo(state), { mode: 'cpu', replay: () => startEventMatch(opponents), online: false, reward: r.reward ?? undefined, extra, back: { label: T('رویداد', 'Event'), fn: () => show(eventScreen) } }));
    },
  }));
  modeIntro(`event-${def.mode}`, cfg.rules, session, [{ title: { fa: def.nameFa, en: def.name }, text: { fa: def.descFa, en: def.desc } }]);
}

// =============================================================================================
// Weekend tournament
// =============================================================================================
const roundName = (r: number) => tr(ROUND_NAMES[r] ?? ROUND_NAMES[2]);
const placeName = (pl: number) => [T('قهرمان', 'Champion'), T('فینالیست', 'Finalist'), T('نیمه‌نهایی', 'Semi-finalist')][pl - 1] ?? T('یک‌چهارم', 'Quarter-finalist');

function bracketEl(b: Bracket, me: string): HTMLElement {
  const seatEl = (si: number, m: Bracket['rounds'][number][number], score?: number) => {
    if (si < 0) return h('div', { class: 'bk-seat tbd' }, h('span', {}, '?'));
    const s = b.seats[si];
    const lost = m.status === 'done' && m.winner !== si, won = m.status === 'done' && m.winner === si;
    return h('div', { class: `bk-seat ${s.id === me ? 'me' : ''} ${lost ? 'lost' : ''} ${won ? 'won' : ''}` },
      fighterCanvas(s.fighter, s.skin, 26), h('span', { class: 'nm' }, s.id === me ? T('تو', 'You') : s.name),
      s.bot ? h('small', { class: 'lv' }, `${num(s.level)}`) : null,
      score !== undefined && m.status === 'done' ? h('small', { class: 'sc' }, num(score)) : null);
  };
  const cols = b.rounds.map((ms, r) => h('div', { class: `bk-col ${r === b.round && b.status === 'live' ? 'cur' : ''}` },
    h('small', { class: 'bk-rn' }, roundName(r)),
    h('div', { class: 'bk-ms' }, ms.map((m) => h('div', { class: `bk-m ${m.status}` }, seatEl(m.a, m, m.score?.[0]), seatEl(m.b, m, m.score?.[1]),
      m.how === 'forfeit' ? h('small', { class: 'bk-how' }, T('غیبت', 'forfeit')) : m.how === 'sim' ? h('small', { class: 'bk-how' }, T('شبیه‌سازی', 'simulated')) : null)))));
  const f = b.rounds[2]?.[0];
  const champ = f?.status === 'done' ? b.seats[f.winner] : null;
  cols.push(h('div', { class: 'bk-col champ' }, h('small', { class: 'bk-rn' }, T('قهرمان', 'Champion')),
    h('div', { class: 'bk-ms' }, h('div', { class: 'bk-trophy' }, svg('trophy', 28), champ ? h('b', {}, champ.id === me ? T('تو!', 'You!') : champ.name) : h('span', { class: 'muted' }, '?')))));
  return h('div', { class: 'bracket', dir: 'ltr' }, cols);
}

export function tourneyScreen(): Screen {
  const body = h('div', { class: 'scroll tn-body' }, h('p', { class: 'muted center' }, '…'));
  let info: TourneyInfo | null = null;
  let timer = 0;
  let waiting = false;
  const load = async () => {
    try { info = await modes.tourney(); render(); } catch (e) { body.innerHTML = ''; body.append(h('p', { class: 'muted center' }, errText(e))); }
  };
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { toast(errText(e), 'err'); } load(); };
  const render = () => {
    if (!info) return;
    const p = backend.profile;
    const offline = info.phase === 'offline';
    const b = info.bracket;
    body.innerHTML = '';
    // status strip
    const phaseTxt = offline ? T('حالت آفلاین: جام تمرینی با ۷ مبارز کامپیوتری که هر دور قوی‌تر می‌شوند', 'Offline: a practice cup against 7 computer fighters that get tougher every round')
      : info.phase === 'signup' ? T('ثبت‌نام باز است', 'Sign-ups open') : info.phase === 'live' ? T('مسابقات در جریان است', 'Tournament in progress') : T('ثبت‌نام بسته است', 'Sign-ups closed');
    body.append(h('div', { class: 'tn-status' },
      h('div', { class: 'rs' }, svg('trophy', 16), h('b', {}, phaseTxt),
        !offline && info.next ? h('small', { class: 'muted' }, info.phase === 'signup' ? T('شروع در ', 'Starts in ') : info.phase === 'closed' ? T('ثبت‌نام بعدی ', 'Next sign-up ') : '', h('b', { 'data-until': String(info.next) }, duration(info.next - Date.now()))) : null,
        !offline ? h('small', { class: 'muted' }, `${T('شرکت‌کننده‌ها', 'Entrants')}: ${num(info.entrants)}`) : null),
      h('div', { class: 'rs' }, svg('medal', 16), h('b', {}, num(info.trophies.length)), h('small', {}, T('جام‌ها', 'Trophies')),
        h('small', { class: 'muted' }, info.trophies.slice(0, 3).map((x) => `${placeName(x.place)} · ${tr({ fa: info!.tiers[x.tier].nameFa, en: info!.tiers[x.tier].name })}`).join(' / '))),
    ));
    if (b) {
      const mine = b.mine;
      const me = b.seats.find((s) => s.id === p.id);
      const myOut = b.rounds.some((ms) => ms.some((m) => m.status === 'done' && (b.seats[m.a]?.id === p.id || b.seats[m.b]?.id === p.id) && b.seats[m.winner]?.id !== p.id));
      const tier = info.tiers[b.tier];
      const panel = h('div', { class: 'tn-next box', style: { '--c': tier.color } as any },
        h('b', {}, tr({ fa: tier.nameFa, en: tier.name }), ' · ', b.status === 'signup' ? `${T('در انتظار', 'Waiting')} ${num(b.seats.length)}/${num(BRACKET_SIZE)}` : b.status === 'done' ? T('پایان یافت', 'Finished') : roundName(b.round)));
      if (b.status === 'signup') panel.append(h('small', { class: 'muted' }, T('جدول در زمان شروع قفل می‌شود و جاهای خالی با مبارزهای کامپیوتری پر می‌شوند.', 'The bracket locks at the start time; empty seats are filled with computer fighters.')),
        h('button', { class: 'btn ghost small', onclick: () => act(() => modes.tourneyLeave()) }, T('انصراف (نصف ورودی برمی‌گردد)', 'Leave (half the fee back)')));
      else if (mine) {
        const foe = mine.foe;
        panel.append(h('div', { class: 'tn-vs' }, fighterCanvas(me?.fighter ?? p.selFighter, me?.skin ?? 0, 64), h('b', { class: 'vs' }, 'VS'), fighterCanvas(foe.fighter, foe.skin, 64)),
          h('small', {}, `${foe.name}${foe.bot ? ` · ${T('کامپیوتر', 'CPU')} ${num(offline ? (modes.offlineFoe()?.level ?? foe.level) : foe.level)}` : ''}`),
          offline
            ? h('button', { class: 'btn primary big', 'data-f': 'tnplay', onclick: () => startOfflineTourneyMatch() }, svg('swords', 18), T('مبارزه', 'Fight'))
            : h('button', { class: `btn primary big ${waiting ? 'pulse' : ''}`, 'data-f': 'tnplay', onclick: () => act(async () => {
              const r = await modes.tourneyReady();
              if (!r.started) { waiting = true; toast(T('منتظر حریف… مسابقه خودکار شروع می‌شود', 'Waiting for your opponent… the match starts automatically'), 'info'); }
            }) }, svg('swords', 18), waiting || mine.ready ? T('منتظر حریف…', 'Waiting…') : T('آماده‌ام', 'I\'m ready')),
          !offline && b.windowEnd ? h('small', { class: 'muted' }, T('پایان مهلت این دور ', 'Round window ends in '), h('b', { 'data-until': String(b.windowEnd) }, duration(b.windowEnd - Date.now()))) : '');
      } else if (b.status === 'live') panel.append(h('small', { class: 'muted' }, myOut ? T('حذف شدی؛ بقیه جدول در حال انجام است.', 'You are out; the rest of the bracket is being played.') : T('منتظر نتیجه بقیه مسابقه‌های این دور…', 'Waiting for the other matches of this round…')));
      else if (b.status === 'done') {
        const idx = b.seats.findIndex((s) => s.id === p.id);
        const f = b.rounds[2][0];
        const place = f.winner === idx ? 1 : (f.a === idx || f.b === idx) ? 2 : b.rounds[1].some((m) => m.a === idx || m.b === idx) ? 3 : 0;
        panel.append(h('b', { class: 'tn-place' }, place ? placeName(place) : T('حذف در یک‌چهارم', 'Out in the quarter-finals')),
          place ? h('small', { class: 'muted' }, T('جایزه به صندوق پیامت فرستاده شد.', 'Your prize was sent to your inbox.')) : '',
          offline ? h('button', { class: 'btn accent', onclick: () => { b.status = 'done'; info!.last = b; info!.bracket = null; render(); } }, T('تورنمنت جدید', 'New tournament')) : '');
      }
      body.append(h('div', { class: 'tn-main' }, panel, bracketEl(b, p.id)));
    }
    if (!b || (offline && b.status === 'done' && !info.bracket)) {
      const canSign = offline || info.phase === 'signup';
      body.append(h('div', { class: 'tn-tiers' }, (Object.keys(info.tiers) as TourneyTier[]).map((k) => {
        const t = info!.tiers[k];
        const fee = t.fee.coins ? h('span', { class: 'cur' }, icon('coin'), num(t.fee.coins)) : h('span', { class: 'cur' }, icon('gem'), num(t.fee.gems ?? 0));
        return h('div', { class: 'tn-tier box', style: { '--c': t.color } as any },
          h('div', { class: 'tn-cup' }, svg('trophy', 30)), h('b', {}, tr({ fa: t.nameFa, en: t.name })),
          t.prizes.map((r, i) => h('div', { class: 'tn-prize' }, h('small', {}, placeName(i + 1)), rewardChips(r))),
          h('button', { class: `btn ${k === 'gems' ? 'gem' : 'gold'} ${canSign ? '' : 'disabled'}`, 'data-f': `tn-${k}`, onclick: () => act(() => modes.tourneySignUp(k)) }, T('ثبت‌نام', 'Sign up'), ' · ', fee));
      })),
      h('details', { class: 'tn-rules box' }, h('summary', {}, T('قوانین', 'Rules')), h('ul', {},
        h('li', {}, T('ثبت‌نام: جمعه ۰۰:۰۰ تا شنبه ۲۰:۰۰ (تهران). هر ۸ نفر یک جدول.', 'Sign-up: Friday 00:00 → Saturday 20:00 (Tehran). Every 8 entrants make a bracket.')),
        h('li', {}, T('جاهای خالی را مبارزهای کامپیوتری پر می‌کنند.', 'Empty seats are filled by computer fighters.')),
        h('li', {}, T('هر دور ۳۰ دقیقه مهلت دارد؛ اگر حاضر نشوی می‌بازی. اگر هیچ‌کدام نیایید، نتیجه شبیه‌سازی می‌شود.', 'Each round has a 30-minute window; no-shows forfeit. If neither player shows up the match is simulated.')),
        h('li', {}, T('قهرمان، فینالیست و نیمه‌نهایی‌ها جایزه و جام می‌گیرند.', 'Champion, finalist and semi-finalists win prizes and a trophy.')),
        h('li', {}, T('آفلاین: همان جدول با ۷ مبارز کامپیوتری که هر دور سخت‌تر می‌شوند.', 'Offline: the same bracket vs 7 computer fighters that get harder every round.')))));
    }
    if (info.last && info.bracket) void 0;
  };
  timer = window.setInterval(() => body.querySelectorAll<HTMLElement>('[data-until]').forEach((el) => { el.textContent = duration(Number(el.dataset.until) - Date.now()); }), 1000);
  const offSocial = net.on('social', (m) => { if (m.kind === 'tourney') load(); });
  load();
  introOnce('tourney-screen', [
    { target: '.tn-body', title: { fa: 'تورنمنت آخر هفته', en: 'Weekend tournament' }, text: { fa: 'ورودی بده و در جدول حذفی ۸ نفره ثبت‌نام کن. سه برد پشت سر هم = قهرمانی، جایزه بزرگ و جام.', en: 'Pay the entry and join an 8-player knockout bracket. Three wins in a row = champion, a big prize and a trophy.' } },
  ]);
  return { el: h('div', { class: 'page tourney' }, topBar({ back: () => show(arenaScreen), title: T('تورنمنت', 'Tournament') }), body), destroy: () => { clearInterval(timer); offSocial(); } };
}

export function startOfflineTourneyMatch() {
  const f = modes.offlineFoe();
  if (!f) { show(tourneyScreen); return; }
  const p = backend.profile;
  const fighter = p.selFighter;
  const stages = ['rooftop', 'dojo', 'canyon', 'garden', 'temple', 'orbit', 'forge'].filter((s) => STAGES.some((x) => x.id === s));
  const cfg: MatchConfig = {
    stageId: stages[(f.round * 3 + f.b.week) % stages.length], stocks: 3, timeLimit: 300, teams: false,
    players: [
      { charId: fighter, skin: backend.selectedSkin(fighter), team: 0, name: p.name, mods: fighterMods(p, fighter) },
      { charId: f.foe.fighter, skin: f.foe.skin, team: 1, name: f.foe.name, bot: true, mods: f.foe.mods },
    ],
  };
  const session = new LocalSession(cfg, [playerSource(true), null], [null, f.level]);
  show(() => gameScreen(session, {
    online: false,
    onLocalEnd: (state) => {
      const won = state.winnerTeam === state.fighters[0].team;
      const r = modes.offlineReport(won, [state.fighters[0].stocks, state.fighters[1].stocks]);
      const extra = h('div', { class: 'res-mode', style: { '--c': '#ffd23f' } as any }, svg('trophy', 16), h('b', {}, roundName(f.round)),
        h('small', {}, r?.finished ? (r.place ? `${placeName(r.place)}! ${T('جایزه در صندوق پیام', 'Prize in your inbox')}` : T('حذف شدی', 'Knocked out')) : won ? `${T('صعود به', 'Through to the')} ${roundName(f.round + 1)}` : T('حذف شدی', 'Knocked out')));
      show(() => resultsScreen(state, 0, endInfo(state), { mode: 'cpu', replay: () => show(tourneyScreen), again: T('جدول', 'Bracket'), online: false, extra }));
      if (r?.finished && r.place) setTimeout(() => modal(h('div', { class: 'tn-win' }, h('div', { class: 'tn-cup big' }, svg('trophy', 64)), h('h2', { class: 'title-grad' }, placeName(r.place)),
        h('p', { class: 'muted' }, T('جام به قفسه افتخاراتت اضافه شد و جایزه در صندوق پیام است.', 'A trophy was added to your cabinet and the prize is in your inbox.')))), 900);
    },
  }));
  if (f.round === 0) modeIntro('tourney-offline', undefined, session, [{ title: { fa: 'مسابقه تورنمنت', en: 'Tournament match' }, text: { fa: 'برنده به دور بعد می‌رود و حریف‌ها هر دور قوی‌تر می‌شوند. ۳ جان، ۵ دقیقه.', en: 'The winner moves on and opponents get stronger every round. 3 lives, 5 minutes.' } }]);
}

// =============================================================================================
// Survival
// =============================================================================================
let survivalStage = '';
export function survivalScreen(): Screen {
  const p = backend.profile;
  const s = survivalProgress(p, Date.now());
  const pool = STAGES.filter((x) => stageUnlocked(p, x.id));
  if (!pool.some((x) => x.id === survivalStage)) survivalStage = pool[0]?.id ?? STAGES[0].id;
  const board = h('div', { class: 'sv-board box' }, h('h3', {}, svg('star', 14), T('جدول رکوردها', 'Leaderboard')), h('p', { class: 'muted small' }, '…'));
  const stagesEl = h('div', { class: 'sv-stages' });
  const renderStages = () => {
    stagesEl.innerHTML = '';
    stagesEl.append(...pool.map((st) => h('button', { class: `sv-stage ${st.id === survivalStage ? 'sel' : ''}`, style: { background: `linear-gradient(180deg, ${st.theme.sky[0]}, ${st.theme.sky[1]})` }, onclick: () => { survivalStage = st.id; renderStages(); } }, h('b', {}, loc(st)))));
  };
  renderStages();
  const left = h('div', { class: 'sv-col' },
    h('div', { class: 'sv-head box' },
      h('div', { class: 'sv-best' }, svg('skull', 30), h('div', {}, h('small', { class: 'muted' }, T('بهترین رکورد', 'Personal best')), h('b', {}, `${T('موج', 'Wave')} ${num(s.best)}`)),
        h('button', { class: 'btn primary big', 'data-f': 'svstart', onclick: () => startSurvival(survivalStage) }, svg('swords', 18), T('شروع', 'Start'))),
      h('small', { class: 'muted' }, T('موج‌های بی‌پایان مبارزهای کامپیوتری؛ هر موج تعداد و سطح دشمن‌ها بالا می‌رود. بین موج‌ها کمی درمان می‌شوی و هر ۵ موج یک جان اضافه.', 'Endless waves of computer fighters — each wave brings more and tougher foes. You heal a little between waves and earn an extra life every 5 waves.')),
      h('small', {}, `${T('سکه برای هر موج', 'Coins per wave')}: ${num(SURVIVAL.coinsPerWave)} · ${T('دورهای با جایزه امروز', 'Rewarded runs today')}: ${num(Math.max(0, SURVIVAL.rewardedRunsPerDay - s.paid))}/${num(SURVIVAL.rewardedRunsPerDay)}`)),
    h('h3', {}, T('میدان', 'Arena')), stagesEl);
  const ms = h('div', { class: 'sv-ms box' }, h('h3', {}, svg('flag', 14), T('جایزه موج‌ها', 'Wave milestones')),
    SURVIVAL_MILESTONES.map((m, i) => h('div', { class: `sv-m ${s.ms.includes(i) ? 'got' : ''}` }, h('b', {}, `${T('موج', 'Wave')} ${num(m.wave)}`), rewardChips(m.reward), s.ms.includes(i) ? h('span', { class: 'tag ok' }, svg('check', 11)) : h('span'))));
  modes.survivalBoard().then((r) => {
    board.innerHTML = '';
    board.append(h('h3', {}, svg('star', 14), T('جدول رکوردها', 'Leaderboard')));
    if (r.local) board.append(h('p', { class: 'muted small' }, T('آفلاین: فقط رکورد خودت ذخیره می‌شود.', 'Offline: only your own best is kept.')));
    if (!r.top.length) board.append(h('p', { class: 'muted small' }, T('هنوز رکوردی نیست', 'No records yet')));
    board.append(...r.top.slice(0, 10).map((x) => h('div', { class: `sv-row ${x.id === p.id ? 'me' : ''}` }, h('span', {}, num(x.pos)), fighterCanvas(x.fighter, 0, 24), h('b', {}, x.name), h('span', {}, `${T('موج', 'W')} ${num(x.best)}`))));
    if (!r.local && r.me.best && r.me.pos === 0) board.append(h('small', { class: 'muted' }, `${T('رکورد تو', 'Your best')}: ${num(r.me.best)}`));
  }).catch(() => { board.lastElementChild!.textContent = '—'; });
  introOnce('survival-screen', [{ target: '.sv-head', title: { fa: 'حالت بقا', en: 'Survival' }, text: { fa: 'تا جایی که می‌توانی دوام بیاور! موج‌های ۳، ۵، ۸، ۱۲ و بعد جایزه یک‌باره دارند.', en: 'Last as long as you can! Waves 3, 5, 8, 12 and beyond pay one-time rewards.' } }]);
  return { el: h('div', { class: 'page survival' }, topBar({ back: () => show(arenaScreen), title: T('بقا', 'Survival') }), h('div', { class: 'scroll' }, h('div', { class: 'sv-grid' }, left, ms, board))) };
}

export function startSurvival(stage: string) {
  const p = backend.profile;
  const cfg = survivalConfig(p, stage, Math.floor(Math.random() * 1e9));
  const session = new LocalSession(cfg, [playerSource(true), ...cfg.players.slice(1).map(() => null)], [null, ...cfg.players.slice(1).map(() => 2)]);
  show(() => gameScreen(session, {
    online: false,
    onLocalEnd: async (state) => {
      ads.noteMatch();
      const me = state.fighters[0];
      const waves = Math.max(0, (state.sv?.wave ?? 1) - 1);
      const durationSec = Math.max(0, state.endFrame - COUNTDOWN) / TICK_RATE;
      let out = null;
      try { out = await modes.survivalReport(stage, { waves, durationSec, kos: me.stats.kos }); } catch (e) { toast(errText(e), 'err'); }
      const extra = h('div', { class: 'res-mode sv', style: { '--c': '#ff4f6d' } as any }, svg('skull', 18),
        h('b', {}, `${T('موج‌های پشت سر گذاشته', 'Waves cleared')}: ${num(waves)}`),
        h('small', {}, out?.best ? T('رکورد جدید!', 'New personal best!') : `${T('رکورد', 'Best')}: ${num(backend.profile.surv?.best ?? 0)}`, out?.coins ? [' · ', icon('coin'), `+${num(out.coins)}`] : null));
      show(() => resultsScreen(state, 0, endInfo(state), { mode: 'cpu', replay: () => startSurvival(stage), online: false, extra, title: `${T('موج', 'Wave')} ${num(state.sv?.wave ?? 1)}`, back: { label: T('بقا', 'Survival'), fn: () => show(survivalScreen) } }));
      if (out?.milestones.length) setTimeout(() => rewardReveal(`${T('موج', 'Wave')} ${num(out!.reached[out!.reached.length - 1])}`, out!.milestones.flatMap((g) => grantedToItems(g))), 700);
    },
  }));
  modeIntro('survival', cfg.rules, session, [{ title: { fa: 'حالت بقا', en: 'Survival' }, text: { fa: 'همه دشمن‌های هر موج را بیرون بینداز تا موج بعد بیاید. ۳ جان داری.', en: 'Knock out every foe of a wave to bring the next one. You have 3 lives.' } }]);
}

// =============================================================================================
// Clan co-op boss
// =============================================================================================
export function clanBossScreen(): Screen {
  const body = h('div', { class: 'scroll cb-body' }, h('p', { class: 'muted center' }, '…'));
  let timer = 0;
  const load = async () => {
    let v: ClanBossView;
    try { v = await social().clanBoss(); } catch (e) {
      body.innerHTML = '';
      body.append(h('div', { class: 'box center' }, h('p', { class: 'muted' }, errText(e)), h('button', { class: 'btn accent', onclick: () => import('./clan.ts').then((m) => show(m.clanScreen)) }, svg('shield', 16), T('قبیله', 'Clan'))));
      return;
    }
    render(v);
  };
  const render = (v: ClanBossView) => {
    const p = backend.profile;
    const boss = v.boss;
    const max = BOSS_TIERS[BOSS_TIERS.length - 1].dmg;
    body.innerHTML = '';
    const head = h('div', { class: 'cb-head box', style: { '--c': boss.color } as any },
      h('div', { class: 'cb-art' }, fighterCanvas(boss.charId, 3, 140)),
      h('div', { class: 'cb-info' },
        h('h2', {}, loc(boss)), h('small', { class: 'muted' }, isFa() ? boss.titleFa : boss.title),
        h('small', {}, svg('calendar', 12), ' ', T('ریست هفتگی در ', 'Weekly reset in '), h('b', { 'data-until': String(v.endsAt) }, duration(v.endsAt - Date.now()))),
        h('div', { class: 'cb-stats' },
          h('span', {}, h('small', {}, T('آسیب قبیله', 'Clan damage')), h('b', {}, num(v.total))),
          h('span', {}, h('small', {}, T('آسیب تو', 'Your damage')), h('b', {}, num(v.myDmg))),
          h('span', {}, h('small', {}, T('تلاش امروز', 'Attempts today')), h('b', {}, `${num(v.attemptsLeft)}/${num(CLAN_BOSS.attemptsPerDay)}`))),
        h('button', { class: `btn primary big ${v.attemptsLeft > 0 ? '' : 'disabled'}`, 'data-f': 'cbfight', onclick: () => startBossFight() }, svg('swords', 18), T('نبرد با غول', 'Fight the boss'))));
    const bar = h('div', { class: 'cb-bar box' },
      h('div', { class: 'cb-track' }, h('div', { class: 'cb-fill', style: { width: `${Math.min(100, (v.total / max) * 100)}%` } }),
        BOSS_TIERS.map((t, i) => h('span', { class: `cb-mark ${i < v.reached ? 'on' : ''}`, style: { [isFa() ? 'right' : 'left']: `${(t.dmg / max) * 100}%` } }, num(i + 1)))),
      h('div', { class: 'cb-tiers' }, BOSS_TIERS.map((t, i) => h('div', { class: `cb-tier ${i < v.reached ? 'on' : ''}` }, h('b', {}, `${T('مرحله', 'Tier')} ${num(i + 1)} · ${num(t.dmg)}`), rewardChips(t.reward)))),
      h('small', { class: 'muted' }, T('در پایان هفته، هر عضوی که به غول آسیب زده باشد جایزه همه مرحله‌های رسیده را می‌گیرد.', 'When the week ends every member who damaged the boss receives the rewards of every tier reached.')));
    const top = h('div', { class: 'cb-top box' }, h('h3', {}, svg('star', 14), T('بیشترین آسیب', 'Top damage')),
      v.top.length ? v.top.slice(0, 10).map((x) => h('div', { class: `sv-row ${x.id === p.id ? 'me' : ''}` }, h('span', {}, num(x.pos)), h('b', {}, x.name), h('span', {}, num(x.dmg))))
        : h('p', { class: 'muted small' }, T('هنوز کسی نجنگیده', 'Nobody has fought yet')));
    body.append(h('div', { class: 'cb-grid' }, head, top), bar);
  };
  timer = window.setInterval(() => body.querySelectorAll<HTMLElement>('[data-until]').forEach((el) => { el.textContent = duration(Number(el.dataset.until) - Date.now()); }), 1000);
  const off = social().onChange((k) => { if (k === 'boss') load(); });
  load();
  introOnce('clanboss-screen', [{ target: '.cb-head', title: { fa: 'غول هفتگی قبیله', en: 'Weekly clan boss' }, text: { fa: `هر عضو روزی ${CLAN_BOSS.attemptsPerDay} بار ${CLAN_BOSS.fightSec} ثانیه با غول می‌جنگد. آسیب همه جمع می‌شود و مرحله‌های جایزه باز می‌شوند.`, en: `Every member fights the boss ${CLAN_BOSS.attemptsPerDay}× a day for ${CLAN_BOSS.fightSec} s. All damage adds up and unlocks reward tiers.` } }]);
  return { el: h('div', { class: 'page clanboss' }, topBar({ back: () => show(arenaScreen), title: T('غول قبیله', 'Clan boss') }), body), destroy: () => { clearInterval(timer); off(); } };
}

export async function startBossFight() {
  let fight;
  try { fight = await social().bossFight(); } catch (e) { toast(errText(e), 'err'); return; }
  const p = backend.profile;
  const cfg = bossConfig(fight, p);
  const def = BOSSES.find((b) => b.id === fight.boss) ?? BOSSES[0];
  cfg.players[1].name = loc(def);
  const session = new LocalSession(cfg, [playerSource(true), null], [null, 6]);
  const id = fight.id;
  show(() => gameScreen(session, {
    online: false,
    onRenderer: (r) => { r.bossName = loc(def); },
    onLocalEnd: async (state) => {
      const won = state.winnerTeam === state.fighters[0].team;
      const dmg = Math.round(state.boss?.dmg[0] ?? 0);
      const durationSec = Math.max(0, state.endFrame - COUNTDOWN) / TICK_RATE;
      let res = null;
      try { res = await social().bossReport(id, { dmg, durationSec, won }); } catch (e) { toast(errText(e), 'err'); }
      const extra = h('div', { class: 'res-mode', style: { '--c': def.color } as any }, svg('skull', 16), h('b', {}, `${T('آسیب به غول', 'Boss damage')}: ${num(dmg)}`),
        res ? h('small', {}, `${T('مجموع قبیله', 'Clan total')}: ${num(res.total)} · ${T('مرحله', 'Tier')} ${num(res.tiers)}/${num(BOSS_TIERS.length)} · `, icon('coin'), `+${num(res.personal.coins ?? 0)}`) : null);
      show(() => resultsScreen(state, 0, endInfo(state), { mode: 'cpu', replay: () => show(clanBossScreen), again: T('غول قبیله', 'Clan boss'), online: false, extra }));
    },
  }));
  modeIntro('clanboss', cfg.rules, session, [{ title: { fa: loc(def), en: def.name }, text: { fa: `غول ${num(CLAN_BOSS.hpMax)} جان دارد و زره سنگین. ${num(CLAN_BOSS.fightSec)} ثانیه وقت داری تا بیشترین آسیب را بزنی؛ بیرون انداختنش ۱۲٪ جانش را کم می‌کند.`, en: `The boss has ${num(CLAN_BOSS.hpMax)} HP and heavy armor. You have ${num(CLAN_BOSS.fightSec)} s to deal as much damage as you can; knocking it off the stage costs it 12% HP.` } }]);
}

export { RULE_PRESETS, ITEM_COLORS };
