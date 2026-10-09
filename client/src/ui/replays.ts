import './replays.css';
import { COUNTDOWN, decodeReplay, getFighter, ReplayPlayer, TICK_RATE, type GameEvent, type GameState, type ReplayData } from '@nb/shared';
import { backend } from '../services/backend.ts';
import { Renderer } from '../game/renderer.ts';
import { PLAYER_COLORS } from '../game/art.ts';
import { audio } from '../game/audio.ts';
import { isFa, num, loc } from '../i18n.ts';
import { h, show, topBar, fighterCanvas, modal, toast, confirmBox, type Screen } from './dom.ts';
import { svg } from './icons.ts';
import { picon } from './proicons.ts';
import { introOnce } from './tutorial.ts';
import { homeScreen } from './home.ts';
import { track } from '../services/analytics.ts';
import {
  deleteReplay, getReplay, importReplay, listReplays, replaysEnabled, serverReplayCode, serverReplays, toStored, saveReplay,
  type ServerReplay, type StoredReplay,
} from '../services/replays.ts';

type L = { fa: string; en: string };
const D = {
  title: { fa: 'بازپخش‌ها', en: 'Replays' },
  device: { fa: 'روی این گوشی', en: 'On this device' },
  server: { fa: 'بازی‌های آنلاین من', en: 'My online matches' },
  live: { fa: 'مسابقه‌های زنده', en: 'Live matches' },
  empty: { fa: 'هنوز بازپخشی نداری. هر مسابقه‌ای که بازی کنی (کامپیوتر، نقشه، حمله قبیله و آنلاین) اینجا ذخیره می‌شود؛ ۱۵ تای آخر.', en: 'No replays yet. Every match you play (CPU, map, clan attacks and online) is saved here — the last 15.' },
  serverEmpty: { fa: 'هنوز مسابقه آنلاینی نداری. ۵۰ مسابقه آخر آنلاینت روی سرور می‌ماند.', en: 'No online matches yet. Your last 50 online matches are kept on the server.' },
  offline: { fa: 'برای دیدن بازی‌های آنلاینت باید به سرور وصل باشی.', en: 'Connect to the server to see your online matches.' },
  watch: { fa: 'تماشا', en: 'Watch' },
  share: { fa: 'اشتراک', en: 'Share' },
  del: { fa: 'حذف', en: 'Delete' },
  delQ: { fa: 'این بازپخش حذف شود؟', en: 'Delete this replay?' },
  import: { fa: 'وارد کردن', en: 'Import' },
  importTitle: { fa: 'وارد کردن بازپخش', en: 'Import a replay' },
  importHint: { fa: 'کد بازپخش را اینجا بچسبان یا فایل ‎.nbr‎ را انتخاب کن.', en: 'Paste a replay code or pick a .nbr file.' },
  file: { fa: 'انتخاب فایل', en: 'Choose file' },
  bad: { fa: 'کد بازپخش معتبر نیست', en: 'That is not a valid replay code' },
  imported: { fa: 'بازپخش اضافه شد', en: 'Replay added' },
  shareTitle: { fa: 'اشتراک بازپخش', en: 'Share replay' },
  shareHint: { fa: 'این کد کل مسابقه است. دوستت آن را در «بازپخش‌ها ← وارد کردن» می‌چسباند.', en: 'This code is the whole match. Your friend pastes it in Replays → Import.' },
  copy: { fa: 'کپی کد', en: 'Copy code' },
  copied: { fa: 'کپی شد', en: 'Copied' },
  saveFile: { fa: 'ذخیره فایل', en: 'Save file' },
  win: { fa: 'برد', en: 'Win' }, loss: { fa: 'باخت', en: 'Loss' }, draw: { fa: 'مساوی', en: 'Draw' },
  off: { fa: 'بازپخش‌ها فعلاً غیرفعال است.', en: 'Replays are switched off right now.' },
  camera: { fa: 'دوربین', en: 'Camera' }, auto: { fa: 'خودکار', en: 'Auto' },
  hud: { fa: 'اطلاعات', en: 'HUD' },
  end: { fa: 'پایان بازپخش', en: 'End of replay' },
  again: { fa: 'از اول', en: 'From the start' },
  loading: { fa: 'در حال بارگذاری…', en: 'Loading…' },
  replay: { fa: 'بازپخش', en: 'Replay' },
};
const tr = (l: L) => (isFa() ? l.fa : l.en);

export const MODE_NAMES: Record<string, L> = {
  cpu: { fa: 'کامپیوتر', en: 'VS CPU' }, map: { fa: 'نقشه', en: 'World map' }, raid: { fa: 'حمله قبیله', en: 'Clan attack' },
  ranked: { fa: 'لیگ', en: 'League' }, casual: { fa: 'آنلاین', en: 'Quick match' }, private: { fa: 'اتاق دوستان', en: 'Friends room' },
};
export const modeName = (m: string) => tr(MODE_NAMES[m] ?? { fa: m, en: m });

const fmtDate = (t: number) => new Date(t).toLocaleString(isFa() ? 'fa-IR' : 'en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtClock = (frames: number) => {
  const s = Math.max(0, Math.floor(frames / TICK_RATE));
  const txt = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return isFa() ? txt.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]) : txt;
};

function resultOf(r: { slot: number; winnerTeam: number; players: { team: number }[] }): 'win' | 'loss' | 'draw' {
  if (r.winnerTeam < 0) return 'draw';
  return r.players[r.slot]?.team === r.winnerTeam ? 'win' : 'loss';
}

// ============================================================================================
// Replays list
// ============================================================================================
type Tab = 'device' | 'server' | 'live';
export function replaysScreen(tab: Tab = 'device'): Screen {
  const back = () => show(homeScreen);
  const list = h('div', { class: 'scroll narrow rp-list' }, h('div', { class: 'muted center' }, '…'));
  const tabs = h('div', { class: 'tabs' },
    (['device', 'server', 'live'] as Tab[]).map((k) => h('button', { class: `tab ${tab === k ? 'on' : ''}`, 'data-t': k, onclick: () => show(() => replaysScreen(k)) },
      k === 'live' ? picon('live', 13) : null, ' ', tr(D[k]))),
    h('span', { class: 'grow' }),
    tab === 'device' ? h('button', { class: 'btn small ghost rp-import', onclick: () => importModal(() => show(() => replaysScreen('device'))) }, picon('upload', 14), tr(D.import)) : null,
  );
  const fill = (rows: (HTMLElement | null)[], empty: string) => {
    list.innerHTML = '';
    const r = rows.filter(Boolean) as HTMLElement[];
    if (!r.length) list.append(h('div', { class: 'rp-empty' }, picon('film', 40), h('p', {}, empty)));
    else list.append(...r);
  };
  const destroyers: (() => void)[] = [];

  if (!replaysEnabled() && tab !== 'live') fill([], tr(D.off));
  else if (tab === 'device') {
    listReplays().then((rows) => fill(rows.map((r) => row(r, {
      watch: () => watchStored(r, () => show(() => replaysScreen('device'))),
      share: () => shareModal(r.code),
      del: async () => { if (await confirmBox(tr(D.delQ))) { await deleteReplay(r.id); show(() => replaysScreen('device')); } },
    })), tr(D.empty))).catch(() => fill([], tr(D.empty)));
  } else if (tab === 'server') {
    if (!backend.online) fill([], tr(D.offline));
    else serverReplays().then((rows) => fill(rows.map((r) => row(r, {
      watch: async () => {
        try {
          const code = await serverReplayCode(r.id);
          const data = decodeReplay(code);
          void saveReplay(toStored(data, code, 'online', r.slot));
          watchData(data, r.slot, () => show(() => replaysScreen('server')));
        } catch { toast(tr(D.bad), 'err'); }
      },
      share: async () => { try { shareModal(await serverReplayCode(r.id)); } catch { toast(tr(D.bad), 'err'); } },
    })), tr(D.serverEmpty))).catch(() => fill([], tr(D.offline)));
  } else {
    import('./spectate.ts').then((m) => destroyers.push(m.liveList(list)));
  }
  const el = h('div', { class: 'page replays' }, topBar({ back, title: tr(D.title) }), tabs, list);
  introOnce('replays', [
    { target: '[data-t=device]', title: { fa: 'بازپخش هر مسابقه', en: 'Every match, replayed' }, text: { fa: 'هر مسابقه‌ات خودکار ذخیره می‌شود. با سرعت ۰٫۵ تا ۴ برابر ببین، جلو و عقب برو و دوربین را روی یک مبارز قفل کن.', en: 'Each match is saved automatically. Watch at 0.5×–4×, scrub back and forth and lock the camera on one fighter.' } },
    { target: '[data-t=live]', title: { fa: 'تماشای زنده', en: 'Watch live' }, text: { fa: 'مسابقه‌های آنلاین در حال اجرای بهترین بازیکن‌ها و هم‌قبیله‌ای‌هایت را با ۳ ثانیه تأخیر تماشا کن.', en: 'Watch top players and your clan mates in running online matches, with a 3-second delay.' } },
  ]);
  return { el, destroy: () => destroyers.forEach((d) => d()) };
}

function row(r: StoredReplay | ServerReplay, act: { watch: () => void; share?: () => void; del?: () => void }) {
  const res = resultOf(r);
  const me = r.players[r.slot];
  return h('div', { class: `rp-row ${res}` },
    h('button', { class: 'rp-play', onclick: act.watch, 'aria-label': tr(D.watch) }, svg('play', 18)),
    h('div', { class: 'rp-fighters' }, r.players.slice(0, 4).map((p, i) => h('span', { class: 'rp-f', style: { borderColor: PLAYER_COLORS[i] } }, fighterCanvas(p.fighter, 'skin' in p ? (p as { skin: number }).skin : 0, 34)))),
    h('div', { class: 'rp-main' },
      h('b', {}, r.players.map((p) => p.name).join(isFa() ? ' و ' : ' vs ')),
      h('small', { class: 'muted' }, `${modeName(r.mode)} · ${fmtDate(r.at)} · ${fmtClock(Math.max(0, r.frames - COUNTDOWN))}${me ? ' · ' + loc(getFighter(me.fighter)) : ''}`)),
    h('span', { class: `rp-res ${res}` }, tr(D[res])),
    h('div', { class: 'rp-acts' },
      act.share ? h('button', { class: 'btn icon small ghost', onclick: act.share, title: tr(D.share), 'aria-label': tr(D.share) }, picon('share', 16)) : null,
      act.del ? h('button', { class: 'btn icon small ghost', onclick: act.del, title: tr(D.del), 'aria-label': tr(D.del) }, picon('trash', 16)) : null),
  );
}

// ---- share / import ----------------------------------------------------------------------------
export function shareModal(code: string) {
  track('replay_share');
  const ta = h('textarea', { class: 'input rp-code', readonly: true, dir: 'ltr', spellcheck: 'false' }, code) as HTMLTextAreaElement;
  const m = modal(h('div', { class: 'rp-share' },
    h('h2', {}, tr(D.shareTitle)),
    h('p', { class: 'muted' }, tr(D.shareHint)),
    ta,
    h('small', { class: 'muted', dir: 'ltr' }, `${num(Math.ceil(code.length / 1024))} KB`),
    h('div', { class: 'row' },
      h('button', { class: 'btn accent', onclick: async () => {
        try { await navigator.clipboard.writeText(code); } catch { ta.select(); document.execCommand('copy'); }
        toast(tr(D.copied), 'ok');
      } }, picon('copy', 16), tr(D.copy)),
      h('button', { class: 'btn', onclick: () => {
        const a = h('a', { href: URL.createObjectURL(new Blob([code], { type: 'text/plain' })), download: `neonbrawl-${Date.now()}.nbr` });
        document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      } }, picon('download', 16), tr(D.saveFile)),
      typeof navigator.share === 'function' ? h('button', { class: 'btn', onclick: () => navigator.share({ title: 'Neon Brawl replay', text: code }).catch(() => {}) }, picon('share', 16), tr(D.share)) : null,
    )), { cls: 'rp-modal' });
  return m;
}

export function importModal(after: () => void) {
  const ta = h('textarea', { class: 'input rp-code', dir: 'ltr', placeholder: 'NBR1.…', spellcheck: 'false' }) as HTMLTextAreaElement;
  const file = h('input', { type: 'file', accept: '.nbr,.txt,text/plain', style: { display: 'none' } }) as HTMLInputElement;
  const go = async (text: string) => {
    try { await importReplay(text); m.close(); toast(tr(D.imported), 'ok'); after(); } catch { toast(tr(D.bad), 'err'); }
  };
  file.onchange = async () => { const f = file.files?.[0]; if (f) go(await f.text()); };
  const m = modal(h('div', { class: 'rp-share' },
    h('h2', {}, tr(D.importTitle)),
    h('p', { class: 'muted' }, tr(D.importHint)),
    ta, file,
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => file.click() }, picon('upload', 16), tr(D.file)),
      h('button', { class: 'btn primary', onclick: () => go(ta.value) }, tr(D.import)),
    )), { cls: 'rp-modal' });
}

// ============================================================================================
// Viewer (replays and live spectating share it)
// ============================================================================================
export interface ViewerSource {
  state: GameState;
  title: string;
  live: boolean;
  /** replay: total / current frame */
  length?: number;
  pos?: number;
  /** one sim frame; returns its events (null = nothing to show yet) */
  advance(): GameEvent[] | null;
  seek?(f: number): void;
  /** background work (keyframes) */
  idle?(): void;
  status?(): string;
  ended?(): boolean;
  pov?: number;
  destroy?(): void;
}

export async function watchStored(r: StoredReplay | string, back: () => void) {
  const st = typeof r === 'string' ? await getReplay(r) : r;
  if (!st) { toast(tr(D.bad), 'err'); return; }
  try { watchData(decodeReplay(st.code), st.slot, back, st.code); } catch { toast(tr(D.bad), 'err'); }
}

export function watchData(data: ReplayData, pov: number, back: () => void, code?: string) {
  track('replay_watch', data.meta.mode);
  const player = new ReplayPlayer(data);
  const src: ViewerSource = {
    get state() { return player.state; },
    title: `${tr(D.replay)} · ${modeName(data.meta.mode)} · ${data.cfg.players.map((p) => p.name).join(' vs ')}`,
    live: false,
    length: player.length,
    get pos() { return player.pos; },
    advance: () => (player.done ? null : player.stepOnce()),
    seek: (f) => player.seek(f),
    idle: () => { player.warm(4); },
    ended: () => player.done,
    pov,
  };
  show(() => viewerScreen(src, back, code));
}

export function viewerScreen(src: ViewerSource, back: () => void, code?: string): Screen {
  const canvas = h('canvas', { class: 'game-canvas' });
  const renderer = new Renderer(canvas);
  let speed = 1, playing = true, follow: number | undefined, hud = true, running = true, scrubbing = false;
  const n = src.state.fighters.length;

  const camBtn = h('button', { class: 'btn small rv-cam' }, picon('camera', 14), h('span', {}, tr(D.auto)));
  const camLabel = () => {
    const sp = camBtn.querySelector('span')!;
    sp.textContent = follow === undefined ? tr(D.auto) : (src.state.cfg.players[follow]?.name ?? `P${follow + 1}`).slice(0, 10);
    camBtn.style.borderColor = follow === undefined ? '' : PLAYER_COLORS[follow];
  };
  camBtn.onclick = () => { follow = follow === undefined ? 0 : follow + 1 >= n ? undefined : follow + 1; camLabel(); };
  const hudBtn = h('button', { class: 'btn small rv-hud on' }, picon('eye', 14), tr(D.hud));
  hudBtn.onclick = () => { hud = !hud; hudBtn.classList.toggle('on', hud); hudBtn.replaceChild(picon(hud ? 'eye' : 'eyeoff', 14), hudBtn.firstChild!); };

  const top = h('div', { class: 'rv-top' },
    h('button', { class: 'btn icon pause-btn rv-back', onclick: () => back(), 'aria-label': 'back' }, svg(isFa() ? 'chevron' : 'back', 18)),
    h('div', { class: 'rv-title' }, src.live ? h('span', { class: 'rv-live' }, picon('live', 12), 'LIVE') : null, h('b', {}, src.title), h('small', { class: 'rv-status muted' })),
    h('span', { class: 'grow' }),
    camBtn, hudBtn,
    code ? h('button', { class: 'btn icon small rv-share', onclick: () => shareModal(code), 'aria-label': tr(D.share) }, picon('share', 15)) : null,
  );

  // transport (replays only)
  const playBtn = h('button', { class: 'btn icon rv-play' }, svg('pause', 18));
  const setPlaying = (v: boolean) => { playing = v; playBtn.replaceChildren(svg(v ? 'pause' : 'play', 18)); };
  playBtn.onclick = () => {
    if (src.ended?.() && src.seek) { src.seek(0); renderer.reset(); }
    setPlaying(!playing);
  };
  const speeds = [0.5, 1, 2, 4];
  const speedSeg = h('div', { class: 'seg rv-speed' }, speeds.map((s) => h('button', { class: s === speed ? 'on' : '', onclick: (e: Event) => {
    speed = s; speedSeg.querySelectorAll('button').forEach((b) => b.classList.remove('on')); (e.currentTarget as HTMLElement).classList.add('on');
  } }, `${isFa() ? String(s).replace('.', '٫').replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]) : s}×`)));
  const seek = h('input', { type: 'range', class: 'rv-seek', min: 0, max: src.length ?? 0, step: 1, value: 0, dir: 'ltr' }) as HTMLInputElement;
  const clock = h('span', { class: 'rv-clock', dir: 'ltr' });
  const doSeek = () => { src.seek?.(Number(seek.value)); renderer.reset(); drawNow(true); };
  seek.addEventListener('pointerdown', () => { scrubbing = true; });
  seek.addEventListener('input', doSeek);
  const endScrub = () => { scrubbing = false; };
  seek.addEventListener('pointerup', endScrub);
  seek.addEventListener('change', () => { doSeek(); endScrub(); });
  const bottom = src.live ? null : h('div', { class: 'rv-bottom' },
    h('button', { class: 'btn icon small rv-restart', onclick: () => { src.seek?.(0); renderer.reset(); setPlaying(true); }, 'aria-label': tr(D.again) }, picon('skipback', 15)),
    playBtn, speedSeg, h('div', { class: 'rv-track', dir: 'ltr' }, seek), clock);

  const el = h('div', { class: 'game replay-view' }, canvas, top, bottom);
  // tap the arena to hide / show the controls
  canvas.addEventListener('click', () => el.classList.toggle('ui-hidden'));

  const t0 = performance.now();
  const drawNow = (instant = false) => {
    renderer.draw(src.state, { localSlots: src.pov !== undefined && src.pov >= 0 ? [src.pov] : [], time: (performance.now() - t0) / 1000, follow, hud, instantCam: instant });
  };
  const sfx = (e: GameEvent) => { if (speed <= 1 && playing) audio.event(e as any, false); };
  let raf = 0, last = performance.now(), acc = 0, lastUi = 0;
  const statusEl = top.querySelector('.rv-status') as HTMLElement;
  const frame = (now: number) => {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(100, now - last);
    last = now;
    renderer.noteFrame(dt);
    if (playing && !scrubbing) {
      acc += dt * (src.live ? 1 : speed);
      const stepMs = 1000 / TICK_RATE;
      let k = 0;
      while (acc >= stepMs && k < 24) {
        const ev = src.advance();
        if (ev === null) { acc = 0; if (!src.live && src.ended?.()) setPlaying(false); break; }
        renderer.onEvents(src.state, ev, sfx);
        acc -= stepMs; k++;
      }
      if (k === 24) acc = 0;
    }
    src.idle?.();
    drawNow();
    if (now - lastUi > 120) {
      lastUi = now;
      if (!src.live && src.length !== undefined) {
        if (!scrubbing) seek.value = String(src.pos ?? 0);
        seek.style.setProperty('--p', `${((src.pos ?? 0) / Math.max(1, src.length)) * 100}%`);
        clock.textContent = `${fmtClock(Math.max(0, (src.pos ?? 0) - COUNTDOWN))} / ${fmtClock(Math.max(0, src.length - COUNTDOWN))}`;
      }
      statusEl.textContent = src.status?.() ?? '';
      // keep the HUD cards clear of the transport bar while it is shown
      renderer.bottomInset = bottom && !el.classList.contains('ui-hidden') ? bottom.offsetHeight + 6 : 0;
      el.classList.toggle('at-end', !!src.ended?.());
    }
  };
  raf = requestAnimationFrame(frame);
  const onResize = () => renderer.resize();
  addEventListener('resize', onResize);
  const onKey = (e: KeyboardEvent) => {
    if (e.code === 'Space') { e.preventDefault(); playBtn.click(); }
    if (e.code === 'Escape') back();
  };
  addEventListener('keydown', onKey);
  audio.stopMusic();
  if (!src.live) introOnce('replay-viewer', [
    { target: '.rv-bottom', title: { fa: 'کنترل بازپخش', en: 'Replay controls' }, text: { fa: 'توقف و ادامه، سرعت ۰٫۵ تا ۴ برابر و نوار زمان برای رفتن به هر لحظه.', en: 'Pause / play, 0.5× to 4× speed and a timeline to jump to any moment.' } },
    { target: '.rv-cam', title: { fa: 'دوربین و اطلاعات', en: 'Camera & HUD' }, text: { fa: 'دوربین را روی یک مبارز قفل کن یا اطلاعات صفحه را پنهان کن. روی صحنه بزن تا دکمه‌ها مخفی شوند.', en: 'Lock the camera on one fighter or hide the HUD. Tap the arena to hide the buttons.' } },
  ]);
  return {
    el,
    destroy: () => {
      running = false;
      cancelAnimationFrame(raf);
      removeEventListener('resize', onResize);
      removeEventListener('keydown', onKey);
      src.destroy?.();
      audio.startMusic('menu');
    },
  };
}
