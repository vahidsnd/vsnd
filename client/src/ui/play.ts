import {
  FIGHTERS, STAGES, getFighter, placements, TICK_RATE, COUNTDOWN, SPELLS, fighterMods, mapNodes, stageUnlocked, MAP_SIZE, getStage, getSpell,
  type GameState, type MapClear, type FighterMods, type MatchConfig, type MatchEndInfo, type QueueFormat, type RewardResult, type RoomInfo, type ServerMsg,
} from '@nb/shared';
import { backend } from '../services/backend.ts';
import { ads } from '../services/ads.ts';
import { haptic } from '../services/platform.ts';
import { net } from '../net/net.ts';
import { Renderer, displaySkin } from '../game/renderer.ts';
import { PLAYER_COLORS } from '../game/art.ts';
import { audio } from '../game/audio.ts';
import { KeyboardSource, GamepadSource, TouchControls, MergedSource, isTouch, connectedPads, type InputSource } from '../game/input.ts';
import { LocalSession, OnlineSession, type Session } from '../game/session.ts';
import { t, num, isFa, loc, duration } from '../i18n.ts';
import { h, show, topBar, fighterCanvas, modal, toast, confirmBox, icon, rewardReveal, type Screen } from './dom.ts';
import { svg } from './icons.ts';
import { specialsList, basicsList } from './movelist.ts';
import { introOnce, TUTORIAL, tutorialText } from './tutorial.ts';
import { homeScreen } from './home.ts';
import { social } from '../services/social.ts';
import { grantedToItems } from './dom.ts';

const home = () => show(homeScreen);
type Replay = () => void;

// ============================================================================================
// Online: global "match found" handler (also handles reconnect into a running match)
// ============================================================================================
let inGame = false;
let lastOnline: { mode: 'ranked' | 'casual'; format: QueueFormat } | null = null;

net.on('match', (m) => {
  if (inGame) return;
  startOnline(m);
});

function startOnline(m: Extract<ServerMsg, { t: 'match' }>) {
  const src = playerSource(true);
  let session: OnlineSession;
  let renderer: Renderer | null = null;
  const replay: Replay = lastOnline ? (() => { const lo = lastOnline!; show(() => matchmakingScreen(lo.mode, lo.format)); }) : home;
  session = new OnlineSession(m.matchId, m.cfg, m.slot, src, m.mode, (info) => {
    if (info.profile) backend.applyServerProfile(info.profile);
    setTimeout(() => {
      ads.noteMatch();
      show(() => resultsScreen(session.state, m.slot, info, { mode: m.mode as any, replay, online: true, reward: info.reward }));
    }, 1200);
  });
  show(() => gameScreen(session, { online: true, onRenderer: (r) => (renderer = r) }));
  void renderer;
}

function playerSource(single: boolean): InputSource {
  const sources: InputSource[] = [new KeyboardSource()];
  const pads = connectedPads();
  if (pads.length && single) sources.push(new GamepadSource(pads[0]));
  return new MergedSource(sources);
}

// ============================================================================================
// Matchmaking
// ============================================================================================
export function matchmakingScreen(mode: 'ranked' | 'casual', format: QueueFormat): Screen {
  lastOnline = { mode, format };
  const p = backend.profile;
  const start = Date.now();
  const timer = h('div', { class: 'mm-timer' }, duration(0));
  const info = h('div', { class: 'muted' }, '…');
  const iv = setInterval(() => { timer.textContent = duration(Date.now() - start); }, 500);
  const offQ = net.on('queued', (m) => { info.textContent = `${m.mode === 'ranked' ? t('ranked') : t('quick')} · ${m.format === 'ffa' ? t('ffa') : m.format}`; });
  const offE = net.on('error', (m) => { toast(m.msg, 'err'); });
  net.connect().then((ok) => {
    if (!ok) { toast(t('offline'), 'err'); home(); return; }
    net.send({ t: 'queue', mode, format, fighter: p.selFighter, skin: backend.selectedSkin(p.selFighter) });
  });
  const tips = ['tutorial1', 'tutorial2', 'tutorial3', 'tutorial4'];
  const el = h('div', { class: 'page mm' },
    h('div', { class: 'mm-body' },
      h('div', { class: 'mm-ring' }, fighterCanvas(p.selFighter, backend.selectedSkin(p.selFighter), 200, 'run')),
      h('h2', { class: 'pulse' }, t('searching')),
      timer, info,
      h('p', { class: 'tip' }, svg('help', 16), t(tips[Math.floor(Math.random() * tips.length)])),
      h('button', { class: 'btn', onclick: () => { net.send({ t: 'cancel' }); home(); } }, t('cancel')),
    ));
  return { el, destroy: () => { clearInterval(iv); offQ(); offE(); } };
}

// ============================================================================================
// Private rooms
// ============================================================================================
export function roomScreen(): Screen {
  const p = backend.profile;
  const body = h('div', { class: 'scroll narrow' });
  const codeIn = h('input', { class: 'input code', placeholder: t('enterCode'), maxlength: 5 }) as HTMLInputElement;
  let room: RoomInfo | null = null;

  const renderLobby = () => {
    body.innerHTML = '';
    if (!room) {
      body.append(
        h('button', { class: 'btn primary big', onclick: () => net.send({ t: 'room_create', fighter: p.selFighter, skin: backend.selectedSkin(p.selFighter) }) }, t('createRoom')),
        h('div', { class: 'row' }, codeIn, h('button', { class: 'btn', onclick: () => net.send({ t: 'room_join', code: codeIn.value.trim().toUpperCase(), fighter: p.selFighter, skin: backend.selectedSkin(p.selFighter) }) }, t('joinRoom'))),
      );
      return;
    }
    const me = room.players.find((x) => x.name === p.name);
    const isHost = !!me?.host;
    body.append(
      h('div', { class: 'room-code', onclick: () => navigator.clipboard?.writeText(room!.code).then(() => toast('✓', 'ok')) }, h('small', {}, t('roomCode')), h('b', {}, room.code)),
      h('div', { class: 'room-players' }, room.players.map((pl, i) => h('div', { class: 'rp', style: { borderColor: PLAYER_COLORS[i] } },
        fighterCanvas(pl.fighter, pl.skin, 90), h('b', {}, pl.name), pl.host ? h('small', {}, t('host')) : null,
        room!.teams ? h('button', { class: 'btn small', onclick: () => pl.name === p.name && net.send({ t: 'room_update', team: pl.team ? 0 : 1 }) }, pl.team ? t('teamBlue') : t('teamRed')) : null)),
        Array.from({ length: room.bots }, (_, i) => h('div', { class: 'rp bot' }, svg('bot', 40), h('b', {}, `CPU ${i + 1}`)))),
      isHost ? h('div', { class: 'room-opts' },
        h('select', { class: 'input', onchange: (e: Event) => net.send({ t: 'room_update', stage: (e.target as HTMLSelectElement).value }) },
          STAGES.map((s) => h('option', { value: s.id, selected: s.id === room!.stage }, loc(s)))),
        h('label', {}, t('stocks'), ' ', h('input', { class: 'input small', type: 'number', min: 1, max: 5, value: room.stocks, onchange: (e: Event) => net.send({ t: 'room_update', stocks: Number((e.target as HTMLInputElement).value) }) })),
        h('label', { class: 'toggle' }, h('span', {}, t('teams')), h('input', { type: 'checkbox', checked: room.teams, onchange: (e: Event) => net.send({ t: 'room_update', teams: (e.target as HTMLInputElement).checked }) })),
        h('div', { class: 'row' }, t('bots'), ' ',
          h('button', { class: 'btn small', onclick: () => net.send({ t: 'room_update', bots: room!.bots - 1 }) }, '−'), num(room.bots),
          h('button', { class: 'btn small', onclick: () => net.send({ t: 'room_update', bots: room!.bots + 1 }) }, '+')),
        h('button', { class: 'btn primary big', onclick: () => net.send({ t: 'room_start' }) }, t('start')),
      ) : h('p', { class: 'muted pulse' }, t('waitingHost')),
      h('button', { class: 'btn ghost', onclick: () => net.send({ t: 'room_leave' }) }, t('leave')),
    );
  };

  const offR = net.on('room', (m) => { room = m.room; renderLobby(); });
  const offE = net.on('error', (m) => toast(m.msg, 'err'));
  net.connect().then((ok) => { if (!ok) { toast(t('offline'), 'err'); home(); } });
  renderLobby();
  const el = h('div', { class: 'page room' }, topBar({ back: () => { net.send({ t: 'room_leave' }); home(); }, title: t('friends') }), body);
  return { el, destroy: () => { offR(); offE(); } };
}

// ============================================================================================
// VS CPU
// ============================================================================================
export function cpuSetupScreen(): Screen {
  const p = backend.profile;
  const st = { stage: STAGES[0].id, opponents: 1, level: Math.min(9, 2 + Math.floor(p.level / 3)), stocks: 3, teams: false, slots: ['cpu', 'cpu', 'cpu'] as string[] };
  const body = h('div', { class: 'scroll cpu-body' });
  const render = () => {
    body.innerHTML = '';
    const pads = connectedPads();
    body.append(
      h('h3', {}, t('stage')),
      h('div', { class: 'stages' }, STAGES.map((s) => {
        const locked = !stageUnlocked(p, s.id);
        const req = STAGES.findIndex((x) => x.id === s.id) + 1;
        return h('button', { class: `stage-card ${s.id === st.stage ? 'sel' : ''} ${locked ? 'locked' : ''}`, style: { background: `linear-gradient(180deg, ${s.theme.sky[0]}, ${s.theme.sky[1]})` },
          onclick: () => { if (locked) { toast(isFa() ? `در مرحله ${num(req)} نقشه باز می‌شود` : `Opens at map stage ${num(req)}`, 'err'); return; } st.stage = s.id; render(); } },
          h('b', {}, loc(s)), locked ? h('small', {}, svg('lock', 12), ` ${isFa() ? 'نقشه' : 'Map'} ${num(req)}`) : null);
      })),
      h('div', { class: 'opts' },
        h('div', { class: 'opt' }, h('span', {}, t('opponents')), [1, 2, 3].map((n) => h('button', { class: `btn small ${st.opponents === n ? 'primary' : ''}`, onclick: () => { st.opponents = n; render(); } }, num(n)))),
        h('div', { class: 'opt' }, h('span', {}, t('difficulty')), h('input', { type: 'range', min: 1, max: 9, value: st.level, oninput: (e: Event) => { st.level = Number((e.target as HTMLInputElement).value); lvl.textContent = num(st.level); } }), (() => { const s = h('b', {}, num(st.level)); lvl = s; return s; })()),
        h('div', { class: 'opt' }, h('span', {}, t('stocks')), [1, 2, 3, 4, 5].map((n) => h('button', { class: `btn small ${st.stocks === n ? 'primary' : ''}`, onclick: () => { st.stocks = n; render(); } }, num(n)))),
        st.opponents === 3 ? h('label', { class: 'toggle' }, h('span', {}, t('teams') + ' 2v2'), h('input', { type: 'checkbox', checked: st.teams, onchange: (e: Event) => { st.teams = (e.target as HTMLInputElement).checked; } })) : null,
        pads.length ? h('div', { class: 'opt' }, h('span', {}, svg('gamepad', 18)), Array.from({ length: st.opponents }, (_, i) =>
          h('button', { class: 'btn small', onclick: () => { const opts = ['cpu', ...pads.map((x) => 'pad' + x)]; st.slots[i] = opts[(opts.indexOf(st.slots[i]) + 1) % opts.length]; render(); } },
            `P${i + 2}: ${st.slots[i] === 'cpu' ? 'CPU' : 'Pad ' + st.slots[i].slice(3)}`))) : null,
      ),
      h('button', { class: 'btn primary big', style: { alignSelf: 'center', minWidth: '220px' }, onclick: () => startCpuMatch({ stage: st.stage, opponents: st.opponents, level: st.level, stocks: st.stocks, teams: st.teams && st.opponents === 3, slots: st.slots }) }, t('start')),
    );
  };
  let lvl: HTMLElement;
  render();
  return { el: h('div', { class: 'page cpu' }, topBar({ back: home, title: t('vsCpu') }), body) };
}

/** Random spell for CPU opponents once the player has spells themselves. */
function cpuMods(level: number): FighterMods | undefined {
  if ((backend.profile.map?.cleared ?? 0) < 3 && !backend.profile.dev) return undefined;
  return { atk: 1, def: 1, hp: 1, spell: SPELLS[Math.floor(Math.random() * SPELLS.length)].id, spellLv: Math.max(1, Math.min(5, Math.ceil(level / 2))) };
}

export function startCpuMatch(o: { fighter?: string; skin?: number; trial?: boolean; stage?: string; opponents?: number; level?: number; stocks?: number; teams?: boolean; slots?: string[] }) {
  const p = backend.profile;
  const fighter = o.fighter ?? p.selFighter;
  const skin = o.skin ?? backend.selectedSkin(fighter);
  const opp = o.opponents ?? 1;
  const level = o.level ?? Math.min(9, 2 + Math.floor(p.level / 3));
  const stagePool = STAGES.filter((s) => stageUnlocked(p, s.id));
  const stage = o.stage ?? stagePool[Math.floor(Math.random() * stagePool.length)].id;
  const players: MatchConfig['players'] = [{ charId: fighter, skin, team: 0, name: p.name, mods: o.trial ? undefined : fighterMods(p, fighter) }];
  const sources: (InputSource | null)[] = [null];
  const bots: (number | null)[] = [null];
  for (let i = 0; i < opp; i++) {
    const kind = o.slots?.[i] ?? 'cpu';
    const def = FIGHTERS[Math.floor(Math.random() * FIGHTERS.length)];
    players.push({ charId: def.id, skin: Math.floor(Math.random() * 3), team: o.teams ? (i === 0 ? 0 : 1) : i + 1, name: kind === 'cpu' ? `CPU ${i + 1}` : `P${i + 2}`, bot: kind === 'cpu', mods: kind === 'cpu' ? cpuMods(level) : undefined });
    sources.push(kind === 'cpu' ? null : new GamepadSource(Number(kind.slice(3))));
    bots.push(kind === 'cpu' ? level : null);
  }
  // player 1 = keyboard (+ first pad unless used by someone else) (+ touch is attached by the game screen)
  const usedPads = new Set((o.slots ?? []).filter((s) => s.startsWith('pad')).map((s) => Number(s.slice(3))));
  const p1: InputSource[] = [new KeyboardSource()];
  const free = connectedPads().find((x) => !usedPads.has(x));
  if (free !== undefined) p1.push(new GamepadSource(free));
  sources[0] = new MergedSource(p1);
  const cfg: MatchConfig = { stageId: stage, stocks: o.stocks ?? 3, timeLimit: 0, teams: !!o.teams, players };
  const session = new LocalSession(cfg, sources, bots);
  const replay: Replay = () => startCpuMatch(o);
  show(() => gameScreen(session, {
    online: false, trialSlot: o.trial ? 0 : undefined,
    onLocalEnd: async (state) => {
      ads.noteMatch();
      const f = state.fighters[0];
      const place = placements(state);
      const durationSec = Math.max(0, state.endFrame - COUNTDOWN) / TICK_RATE;
      const won = state.winnerTeam === f.team;
      const reward = await backend.reportCpu({
        matchId: 'cpu-' + Date.now(), mode: 'cpu', won, placement: place[0], players: state.fighters.length,
        kos: f.stats.kos, falls: f.stats.falls, dmg: f.stats.dmgDealt, smashKOs: f.stats.smashKOs, maxCombo: f.stats.maxCombo, fighter, durationSec,
      }).catch(() => null);
      if (social().demo) social().matchPlayed(won, f.stats.kos);
      show(() => resultsScreen(state, 0, { winnerTeam: state.winnerTeam, placements: place, stats: state.fighters.map((x) => x.stats) }, { mode: 'cpu', replay, online: false, reward: reward ?? undefined }));
    },
  }));
}

/** A world-map battle: fixed arena, foes and allies from the node definition. */
export function startMapNode(i: number) {
  const p = backend.profile;
  const node = mapNodes()[i];
  if (!node) return;
  const fighter = p.selFighter;
  const players: MatchConfig['players'] = [{ charId: fighter, skin: backend.selectedSkin(fighter), team: 0, name: p.name, mods: fighterMods(p, fighter) }];
  const sources: (InputSource | null)[] = [playerSource(true)];
  const bots: (number | null)[] = [null];
  const teams = node.kind === 'team';
  if (node.ally) { players.push({ charId: node.ally.charId, skin: 1, team: 0, name: isFa() ? 'هم‌تیمی' : 'Ally', bot: true }); sources.push(null); bots.push(node.ally.lv); }
  node.foes.forEach((f, k) => {
    players.push({ charId: f.charId, skin: node.kind === 'boss' ? 3 : 2, team: teams ? 1 : players.length, name: node.kind === 'boss' ? (isFa() ? 'رئیس ' : 'Boss ') + loc(getFighter(f.charId)) : loc(getFighter(f.charId)), bot: true, mods: f.mods ?? cpuMods(f.lv) });
    sources.push(null); bots.push(f.lv);
    void k;
  });
  const cfg: MatchConfig = { stageId: node.stage, stocks: node.stocks, timeLimit: 0, teams, players };
  const session = new LocalSession(cfg, sources, bots);
  show(() => gameScreen(session, {
    online: false,
    onLocalEnd: async (state) => {
      ads.noteMatch();
      const f = state.fighters[0];
      const place = placements(state);
      const won = state.winnerTeam === f.team;
      const durationSec = Math.max(0, state.endFrame - COUNTDOWN) / TICK_RATE;
      const res = await backend.reportMap(i, {
        matchId: 'map-' + i + '-' + Date.now(), mode: 'map', won, placement: place[0], players: state.fighters.length,
        kos: f.stats.kos, falls: f.stats.falls, dmg: f.stats.dmgDealt, smashKOs: f.stats.smashKOs, maxCombo: f.stats.maxCombo, fighter, durationSec,
      }).catch(() => ({ reward: null, map: null }));
      if (social().demo) social().matchPlayed(won, f.stats.kos);
      show(() => resultsScreen(state, 0, { winnerTeam: state.winnerTeam, placements: place, stats: state.fighters.map((x) => x.stats) },
        { mode: 'cpu', replay: () => startMapNode(i), online: false, reward: res.reward ?? undefined, map: res.map ? { node: i, clear: res.map } : undefined }));
    },
  }));
  if (i === 0) introOnce('map-fight', [{ title: { fa: 'اولین نبرد نقشه', en: 'First map battle' }, text: { fa: 'حریف را از صحنه بیرون بینداز. بدون سقوط ببری ۳ ستاره می‌گیری!', en: 'Knock your foe off the stage. Win without falling for 3 stars!' } }]);
}

export function startTraining() {
  const p = backend.profile;
  const cfg: MatchConfig = {
    stageId: 'dojo', stocks: 99, timeLimit: 0, teams: false,
    players: [{ charId: p.selFighter, skin: backend.selectedSkin(p.selFighter), team: 0, name: p.name, mods: fighterMods(p, p.selFighter) }, { charId: 'boulder', skin: 0, team: 1, name: t('dummy'), bot: true }],
  };
  const session = new LocalSession(cfg, [playerSource(true), null], [null, null], true);
  session.state.frame = COUNTDOWN; // skip countdown
  show(() => gameScreen(session, { online: false, training: true }));
  introOnce('training', [
    { target: '.train-bar', title: { fa: 'آزمایشگاه تمرین', en: 'Training lab' }, text: { fa: 'حریف تمرینی هرگز نمی‌بازد. رفتارش را عوض کن (ایستاده، پرش، سپر، کامپیوتر)، ناحیه ضربه‌ها را ببین و کمبوهایت را تمرین کن.', en: 'The dummy never runs out of lives. Change its behaviour (idle, jump, shield, CPU), show hitboxes and practise your combos.' } },
  ]);
}

/** Interactive tutorial: a guided match against a dummy, one mechanic per step. */
export function startTutorial() {
  const p = backend.profile;
  const cfg: MatchConfig = {
    stageId: 'dojo', stocks: 99, timeLimit: 0, teams: false,
    players: [{ charId: 'blaze', skin: backend.selectedSkin('blaze'), team: 0, name: p.name }, { charId: 'boulder', skin: 0, team: 1, name: t('dummy'), bot: true }],
  };
  const session = new LocalSession(cfg, [playerSource(true), null], [null, null], true);
  session.state.frame = COUNTDOWN - 1;
  let i = 0;
  let mem: Record<string, number> = {};
  let okTimer = 0;
  const panel = h('div', { class: 'tut-panel' });
  const render = () => {
    const st = TUTORIAL[i];
    const txt = tutorialText(st);
    panel.className = 'tut-panel';
    panel.innerHTML = '';
    panel.append(
      h('div', { class: 'tut-top' }, svg('help', 14), `${t('tutorialTitle')} `, h('span', { dir: 'ltr' }, `${num(i + 1)} / ${num(TUTORIAL.length)}`),
        h('div', { class: 'bar' }, h('div', { style: { width: `${(i / TUTORIAL.length) * 100}%` } }))),
      h('b', {}, txt.title),
      h('div', { class: 'tut-hint' }, txt.hint),
      h('button', { class: 'skip', onclick: () => finish(false) }, t('skip')),
    );
    document.querySelectorAll('.tb.hl').forEach((b) => b.classList.remove('hl'));
    if (st.btn) document.querySelector(`.tb-${st.btn}`)?.classList.add('hl');
  };
  const ctx = () => ({ state: session.state, events: session.events, me: session.state.fighters[0], dummy: session.state.fighters[1], mem });
  const finish = async (completed: boolean) => {
    stopGame?.();
    if (completed) {
      const r = await backend.completeTutorial('basic');
      const m = rewardReveal(t('tutDone'), r ? [{ kind: 'coin', amount: r.coins }, { kind: 'gem', amount: r.gems }, { kind: 'xp', amount: r.xp }] : []);
      m.el.querySelector('.reveal')?.insertBefore(h('p', { class: 'muted' }, t('tutDoneDesc')), m.el.querySelector('.reveal .btn'));
    } else backend.completeTutorial('onboard');
    home();
  };
  let stopGame: (() => void) | undefined;
  const screen = gameScreen(session, {
    online: false, tutorial: true, overlay: panel,
    onTick: () => {
      if (okTimer > 0) { if (--okTimer === 0) { if (++i >= TUTORIAL.length) { finish(true); return; } mem = {}; TUTORIAL[i].setup?.(ctx()); render(); } return; }
      if (TUTORIAL[i].check(ctx())) {
        okTimer = 50; audio.reward();
        panel.classList.add('ok');
        const b = panel.querySelector('b'); if (b) b.textContent = `✓ ${t('tutNice')}`;
      }
    },
  });
  stopGame = screen.destroy;
  show(() => screen);
  render();
}

// ============================================================================================
// In-match view
// ============================================================================================
interface GameOpts {
  online: boolean;
  training?: boolean;
  tutorial?: boolean;
  trialSlot?: number;
  overlay?: HTMLElement;
  onTick?: () => void;
  onLocalEnd?: (s: GameState) => void;
  onRenderer?: (r: Renderer) => void;
}

function gameScreen(session: Session, o: GameOpts): Screen {
  inGame = true;
  (window as any).__session = session; // handy for QA / debugging from devtools
  const canvas = h('canvas', { class: 'game-canvas' });
  const top = h('div', { class: 'game-top' });
  const el = h('div', { class: 'game' }, canvas, top);
  if (o.overlay) el.append(o.overlay);
  const renderer = new Renderer(canvas);
  o.onRenderer?.(renderer);
  if (o.trialSlot !== undefined) renderer.trialSlots.add(o.trialSlot);
  const touch = isTouch() ? new TouchControls(el) : null;
  const mySlot0 = session.localSlots[0] ?? 0;
  const mySpell = getSpell(session.state.cfg.players[mySlot0]?.mods?.spell);
  const magicBtn = touch?.el.querySelector('.tb-magic') as HTMLElement | null;
  if (touch && mySpell) { touch.el.classList.add('has-magic'); magicBtn?.style.setProperty('border-color', mySpell.color); }
  let magicReady = false;
  if (mySpell && !o.online && !o.tutorial) setTimeout(() => introOnce('magic-fight', [{ target: touch ? '.tb-magic' : undefined, title: { fa: 'جادو آماده است', en: 'Your spell' }, text: { fa: `نوار بنفش زیر درصد آسیبت با ضربه زدن پر می‌شود. وقتی پر شد ${touch ? 'دکمه جادو' : 'کلید E'} را بزن تا «${mySpell.nameFa}» اجرا شود.`, en: `The bar under your damage fills as you fight. When it's full, press ${touch ? 'the magic button' : 'E'} to cast ${mySpell.name}.` } }]), 3200);
  // touch augments player-1 input
  if (touch) {
    const s = session as any;
    if (s.source) s.source = new MergedSource([s.source, touch]);
    else if (s.sources) s.sources[0] = s.sources[0] ? new MergedSource([s.sources[0], touch]) : touch;
  }

  // top bar: pause, training tools, emotes
  top.append(h('button', { class: 'btn icon pause-btn', onclick: () => openMenu() }, svg('pause', 18)));
  if (o.training) {
    const ls = session as LocalSession;
    const modes: [LocalSession['dummy'], string][] = [['idle', t('dIdle')], ['jump', t('dJump')], ['shield', t('dShield')], ['cpu', t('dCpu')]];
    const modeBtn = h('button', { class: 'btn small' }, `${t('dummy')}: ${modes[0][1]}`);
    modeBtn.onclick = () => { const k = (modes.findIndex((m) => m[0] === ls.dummy) + 1) % modes.length; ls.dummy = modes[k][0]; modeBtn.textContent = `${t('dummy')}: ${modes[k][1]}`; };
    const hbBtn = h('button', { class: 'btn small' }, t('hitboxes'));
    hbBtn.onclick = () => { renderer.showHitboxes = !renderer.showHitboxes; hbBtn.classList.toggle('accent', renderer.showHitboxes); };
    top.append(h('div', { class: 'train-bar' },
      h('button', { class: 'btn small', onclick: () => ls.resetTraining() }, svg('refresh', 14), t('resetDummy')),
      modeBtn, hbBtn, h('span', { class: 'info combo' })));
  }
  if (o.online) {
    const emotes = ['GG', 'GL', '!', '?', '👍'];
    top.append(h('div', { class: 'emotes' }, emotes.map((e, i) => h('button', { class: 'btn icon small', onclick: () => net.send({ t: 'emote', id: i }) }, e))));
    const offEm = net.on('emote', (m) => {
      const b = h('div', { class: 'emote-pop', style: { color: PLAYER_COLORS[m.slot] } }, `P${m.slot + 1}: ${emotes[m.id] ?? '?'}`);
      el.append(b); setTimeout(() => b.remove(), 1800);
    });
    (el as any)._cleanup = offEm;
  } else top.append(h('span'));

  const me = session.state.fighters[session.localSlots[0] ?? 0];
  const openMenu = async () => {
    if (o.online) {
      if (await confirmBox(t('confirmForfeit'))) (session as OnlineSession).forfeit();
      return;
    }
    session.paused = true;
    const m = modal(h('div', { class: 'pause' },
      h('div', { class: 'pause-col' },
        h('h2', {}, t('pause')),
        h('button', { class: 'btn primary big', onclick: () => { m.close(); } }, svg('play', 16), t('resume')),
        o.tutorial ? null : h('button', { class: 'btn ghost', onclick: () => { m.close(); stop(); home(); } }, t('quit')),
      ),
      h('div', { class: 'pause-col' },
        h('h3', {}, t('specials')), specialsList(me.charId),
        h('h3', {}, t('basics')), basicsList()),
    ), { onClose: () => { session.paused = false; } });
  };

  const onResize = () => renderer.resize();
  addEventListener('resize', onResize);
  const onKey = (e: KeyboardEvent) => { if (e.code === 'Escape' || e.code === 'KeyP') openMenu(); };
  addEventListener('keydown', onKey);

  audio.stopMusic();
  audio.startMusic('battle');

  let raf = 0;
  let last = performance.now();
  let acc = 0;
  let endT = -1;
  let running = true;
  const t0 = performance.now();
  const sfx = (e: any) => {
    const local = e.slot !== undefined ? session.localSlots.includes(e.slot) : true;
    audio.event(e, local);
    if (e.t === 'hit' && session.localSlots.includes(e.victim) && e.kb > 60) haptic('heavy');
  };
  const frame = (now: number) => {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    acc += Math.min(100, now - last);
    renderer.noteFrame(now - last);
    last = now;
    const stepMs = 1000 / TICK_RATE;
    let n = 0;
    while (acc >= stepMs && n < 5 && running) {
      session.update();
      for (const c of session.corrections) {
        const off = renderer.offsets[c.slot] ?? (renderer.offsets[c.slot] = { x: 0, y: 0 });
        off.x += c.dx; off.y += c.dy;
      }
      session.corrections = [];
      renderer.onEvents(session.state, session.events, sfx);
      if (!session.paused) o.onTick?.();
      acc -= stepMs; n++;
    }
    if (!running) return;
    if (n === 5) acc = 0;
    const st = session.state;
    renderer.draw(st, { localSlots: session.localSlots, time: (now - t0) / 1000, training: o.training || o.tutorial, ping: o.online ? session.ping : undefined });
    if (magicBtn && mySpell) {
      const ready = (st.fighters[mySlot0]?.mana ?? 0) >= 100;
      if (ready !== magicReady) { magicReady = ready; magicBtn.classList.toggle('ready', ready); }
    }
    if (o.training) {
      const v = st.fighters[1];
      const c = el.querySelector('.combo');
      if (c) c.textContent = `${num(Math.floor(v.damage))}% · ${t('combo')} ${num(v.combo)}`;
    }
    if (!o.online && st.over && o.onLocalEnd) {
      if (endT < 0) endT = now;
      if (now - endT > 1800) { const cb = o.onLocalEnd; o.onLocalEnd = undefined; stop(); cb(st); }
    }
    if (o.online && performance.now() - (session as OnlineSession).lastSnapAt > 3000) renderer.ctx.fillText(t('reconnecting'), 20, 40);
  };
  raf = requestAnimationFrame(frame);
  const stop = () => {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    removeEventListener('resize', onResize);
    removeEventListener('keydown', onKey);
    session.destroy();
    touch?.destroy();
    inGame = false;
    audio.stopMusic();
    audio.startMusic('menu');
  };
  return { el, destroy: stop };
}

// ============================================================================================
// Results
// ============================================================================================
interface ResultOpts { mode: 'ranked' | 'casual' | 'private' | 'cpu'; replay: Replay; online: boolean; reward?: RewardResult; map?: { node: number; clear: MapClear } }

function resultsScreen(state: GameState, mySlot: number, info: MatchEndInfo, o: ResultOpts): Screen {
  const me = state.fighters[mySlot];
  const won = info.winnerTeam === me.team;
  const draw = info.winnerTeam < 0;
  const r = o.reward;
  const order = state.fighters.map((f, i) => ({ f, i, place: info.placements[i] })).sort((a, b) => a.place - b.place);

  const rows = order.map(({ f, i, place }) => {
    const s = info.stats[i] ?? f.stats;
    const pl = state.cfg.players[i];
    return h('div', { class: `res-row ${i === mySlot ? 'me' : ''}`, style: { borderColor: PLAYER_COLORS[i] } },
      h('span', { class: 'place' }, num(place)),
      fighterCanvas(f.charId, displaySkin(state, i), 40),
      h('div', { class: 'who' },
        h('b', {}, pl.name, pl.bot ? h('small', { class: 'muted' }, ` · ${t('bot')}`) : null),
        h('small', { class: 'muted' }, `${t('kos')} ${num(s.kos)} · ${t('falls')} ${num(s.falls)} · ${t('damage')} ${num(Math.round(s.dmgDealt))}% · ${t('combo')} ${num(s.maxCombo)}`)));
  });

  const coinsEl = h('b', {}, num(r?.coins ?? 0));
  const rewards = r ? h('div', { class: 'rewards' },
    h('h3', {}, t('rewards')),
    h('div', { class: 'row' },
      h('span', { class: 'cur big' }, icon('coin'), coinsEl),
      r.gems ? h('span', { class: 'cur big' }, icon('gem'), num(r.gems)) : null,
      h('span', { class: 'cur big' }, svg('star', 16), `+${num(r.xp)} XP`),
      r.runes ? h('span', { class: 'cur big rune' }, icon('rune'), `+${num(r.runes)}`) : null,
      r.cards ? h('span', { class: 'cur big' }, svg('fighters', 16), `+${num(r.cards)}`) : null,
      r.mmrDelta !== undefined ? h('span', { class: `cur big ${r.mmrDelta >= 0 ? 'up' : 'down'}` }, `${r.mmrDelta >= 0 ? '▲' : '▼'} ${num(Math.abs(r.mmrDelta))}`) : null,
    ),
    r.firstWin ? h('div', { class: 'tag gold' }, svg('medal', 12), t('firstWin')) : null,
    r.questsDone.length ? h('div', { class: 'tag ok' }, svg('quests', 12), t('questDone'), ` ×${num(r.questsDone.length)}`) : null,
    r.canDouble && r.coins > 0 ? h('button', { class: 'btn ad big', onclick: async (e: Event) => {
      const btn = e.currentTarget as HTMLButtonElement;
      if (!(await ads.rewarded('double'))) return;
      const id = backend.profile.lastReward?.id ?? '';
      const g = await backend.adReward('double', id).catch(() => 0);
      if (g) { coinsEl.textContent = num((r.coins ?? 0) + g); audio.coin(); btn.remove(); }
    } }, svg('ad', 18), t('doubleCoins')) : null,
  ) : null;

  if (r?.levelUps.length) setTimeout(() => rewardReveal(`${t('levelUp')} ${num(r.levelUps[r.levelUps.length - 1].level)}`,
    r.levelUps.flatMap((l) => [{ kind: 'coin' as const, amount: l.coins }, ...(l.gems ? [{ kind: 'gem' as const, amount: l.gems }] : [])])), 900);

  const next = async (fn: () => void) => { await ads.maybeInterstitial(); fn(); };
  const mc = o.map?.clear;
  const mapBlock = o.map && mc ? h('div', { class: 'res-map' },
    h('span', { class: 'stars big' }, [1, 2, 3].map((k) => h('i', { class: k <= mc.stars ? 'on' : '' }))),
    mc.firstClear ? h('b', { class: 'tag gold' }, isFa() ? `مرحله ${num(o.map.node + 1)} فتح شد!` : `Stage ${num(o.map.node + 1)} cleared!`) : null) : null;
  if (mc?.granted) {
    const g = mc.granted;
    setTimeout(() => {
      rewardReveal(isFa() ? 'جایزه فتح مرحله' : 'Stage reward', grantedToItems(g));
      if (o.map!.node + 1 === MAP_SIZE) setTimeout(() => toast(isFa() ? 'نقشه فتح شد! بازی آنلاین باز شد' : 'World conquered! Online play unlocked', 'ok'), 400);
    }, 700);
  }
  const nextNode = o.map && mc?.firstClear && o.map.node + 1 < MAP_SIZE ? o.map.node + 1 : -1;
  const el = h('div', { class: `page results ${won ? 'win' : draw ? '' : 'lose'}` },
    h('div', { class: 'res-head' },
      fighterCanvas(me.charId, displaySkin(state, mySlot), 110, won ? 'air' : 'idle'),
      h('h1', { class: 'title-grad' }, draw ? t('draw') : won ? t('victory') : t('defeat')),
    ),
    h('div', { class: 'res-body' }, h('div', { class: 'res-table' }, rows), h('div', { class: 'res-side' }, mapBlock, rewards)),
    h('div', { class: 'res-actions' },
      h('button', { class: 'btn big', onclick: () => next(home) }, t('home')),
      o.map ? h('button', { class: 'btn big', onclick: () => next(() => import('./progress.ts').then((m) => show(() => m.mapScreen(o.map!.node)))) }, svg('map', 18), isFa() ? 'نقشه' : 'Map') : null,
      nextNode >= 0
        ? h('button', { class: 'btn primary big', onclick: () => next(() => startMapNode(nextNode)) }, svg('swords', 18), isFa() ? 'مرحله بعد' : 'Next stage')
        : h('button', { class: 'btn primary big', onclick: () => next(o.replay) }, svg('refresh', 18), o.map ? (isFa() ? 'دوباره' : 'Retry') : t('playAgain')),
    ),
  );
  if (won) audio.reward();
  return { el };
}

export { getFighter, isFa };
