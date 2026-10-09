import { applyFighters, applyMeta, createGame, decodeProjectiles, remoteConfig, step, type GameEvent, type GameState, type LiveMatchInfo, type ServerMsg } from '@nb/shared';
import { backend } from '../services/backend.ts';
import { net } from '../net/net.ts';
import { track } from '../services/analytics.ts';
import { isFa, num } from '../i18n.ts';
import { h, show, fighterCanvas, toast } from './dom.ts';
import { PLAYER_COLORS } from '../game/art.ts';
import { picon } from './proicons.ts';
import { viewerScreen, modeName, type ViewerSource } from './replays.ts';

type L = { fa: string; en: string };
const D = {
  offline: { fa: 'تماشای زنده به سرور نیاز دارد. نسخه آفلاین به هیچ سروری وصل نیست، پس مسابقه زنده‌ای برای تماشا وجود ندارد. بازپخش مسابقه‌های خودت در زبانه «روی این گوشی» کار می‌کند.', en: 'Live spectating needs the game server. The offline build is not connected to one, so there are no live matches to watch. Replays of your own matches still work in the "On this device" tab.' },
  none: { fa: 'الان مسابقه آنلاین عمومی در جریان نیست. کمی بعد سر بزن.', en: 'No public online matches are running right now. Check back soon.' },
  off: { fa: 'تماشای زنده فعلاً غیرفعال است.', en: 'Spectating is switched off right now.' },
  watch: { fa: 'تماشا', en: 'Watch' },
  inMatch: { fa: 'در مسابقه — تماشا', en: 'In match — watch' },
  delay: { fa: 'تأخیر ۳ ثانیه', en: '3 s delay' },
  watching: { fa: 'تماشاگر', en: 'watching' },
  waiting: { fa: 'در حال اتصال…', en: 'Connecting…' },
  ended: { fa: 'مسابقه تمام شد', en: 'Match over' },
  errors: { fa: 'تماشا ممکن نیست', en: 'Can\'t watch this match' },
  full: { fa: 'ظرفیت تماشاگرها پر است (۲۰ نفر)', en: 'Spectator slots are full (20)' },
  notFound: { fa: 'این مسابقه تمام شده است', en: 'That match has already ended' },
  denied: { fa: 'فقط هم‌قبیله‌ای‌ها می‌توانند این مسابقه را ببینند', en: 'Only clan mates can watch this match' },
  refresh: { fa: 'تازه‌سازی', en: 'Refresh' },
  ago: { fa: 'دقیقه', en: 'min' },
};
const tr = (l: L) => (isFa() ? l.fa : l.en);

// ============================================================================================
// Live matches list (inside the Replays screen)
// ============================================================================================
export function liveList(box: HTMLElement): () => void {
  let alive = true;
  const msg = (text: string) => { box.innerHTML = ''; box.append(h('div', { class: 'rp-empty' }, picon('live', 40), h('p', {}, text))); };
  if (!backend.online) { msg(tr(D.offline)); return () => {}; }
  if (!remoteConfig().flags.spectate || !remoteConfig().flags.liveList) { msg(tr(D.off)); return () => {}; }
  const load = async () => {
    try {
      const { matches } = await backend.api<{ matches: LiveMatchInfo[] }>('GET', '/api/live');
      if (!alive) return;
      box.innerHTML = '';
      box.append(h('div', { class: 'row space rp-live-head' }, h('small', { class: 'muted' }, `${num(matches.length)} · ${tr(D.delay)}`),
        h('button', { class: 'btn small ghost', onclick: load }, tr(D.refresh))));
      if (!matches.length) { box.append(h('div', { class: 'rp-empty' }, picon('live', 40), h('p', {}, tr(D.none)))); return; }
      box.append(...matches.map((m) => h('div', { class: 'rp-row live' },
        h('button', { class: 'rp-play', onclick: () => spectateMatch(m.id, () => import('./replays.ts').then((r) => show(() => r.replaysScreen('live')))), 'aria-label': tr(D.watch) }, picon('eye', 18)),
        h('div', { class: 'rp-fighters' }, m.players.slice(0, 4).map((p, i) => h('span', { class: 'rp-f', style: { borderColor: PLAYER_COLORS[i] } }, fighterCanvas(p.fighter, 0, 34)))),
        h('div', { class: 'rp-main' },
          h('b', {}, m.players.map((p) => p.name).join(isFa() ? ' و ' : ' vs ')),
          h('small', { class: 'muted' }, `${modeName(m.mode)} · ${num(m.avgMmr)} · ${num(Math.max(0, Math.floor((Date.now() - m.startedAt) / 60000)))} ${tr(D.ago)} · ${num(m.spectators)} ${tr(D.watching)}`)),
        h('span', { class: 'rp-res live' }, 'LIVE'),
      )));
    } catch { if (alive) msg(tr(D.offline)); }
  };
  void load();
  const iv = setInterval(load, 15000);
  return () => { alive = false; clearInterval(iv); };
}

// ============================================================================================
// Spectating one match: delayed server snapshots, smoothed by local prediction in between
// ============================================================================================
class SpectateSource implements ViewerSource {
  state: GameState;
  live = true;
  title: string;
  pov = -1;
  private queue: { f: number; d: unknown[]; p: unknown[]; m: unknown[]; ev: GameEvent[] }[] = [];
  private started = false;
  private done: { winnerTeam: number } | null = null;
  private watchers: number;
  private off: (() => void)[] = [];
  constructor(public matchId: string, spec: Extract<ServerMsg, { t: 'spec' }>) {
    this.state = createGame(spec.cfg);
    this.watchers = spec.spectators;
    this.title = `${modeName(spec.mode)} · ${spec.cfg.players.map((p) => p.name).join(' vs ')}`;
    this.off.push(net.on('snap', (m) => { this.queue.push(m); }));
    this.off.push(net.on('spec_end', (m) => { if (m.matchId === this.matchId) this.done = { winnerTeam: m.winnerTeam }; }));
  }
  private apply(s: SpectateSource['queue'][number]) {
    applyFighters(this.state.fighters, s.d);
    this.state.projectiles = decodeProjectiles(s.p);
    applyMeta(this.state, s.m);
  }
  advance(): GameEvent[] | null {
    if (!this.queue.length && !this.started) return null;
    this.started = true;
    // fall far behind (tab in background) → jump
    while (this.queue.length > 8) this.apply(this.queue.shift()!);
    const next = this.queue[0];
    if (next && next.f <= this.state.frame + 1) {
      this.queue.shift();
      this.apply(next);
      return next.ev;
    }
    if (!this.queue.length && this.done) return null;
    // between snapshots: predict one frame with everyone's last input
    step(this.state, this.state.fighters.map((f) => f.inp));
    return [];
  }
  status() {
    if (this.done) return tr(D.ended);
    if (!this.started) return tr(D.waiting);
    return `${tr(D.delay)} · ${num(this.watchers)} ${tr(D.watching)}`;
  }
  ended() { return !!this.done && !this.queue.length; }
  destroy() { this.off.forEach((f) => f()); net.send({ t: 'spectate_stop' }); }
}

export async function spectateMatch(matchId: string, back: () => void) {
  if (!backend.online) { toast(tr(D.offline), 'err'); return; }
  const ok = await net.connect();
  if (!ok) { toast(tr(D.offline), 'err'); return; }
  const cleanup: (() => void)[] = [];
  const done = () => cleanup.forEach((f) => f());
  const timer = setTimeout(() => { done(); toast(tr(D.errors), 'err'); }, 8000);
  cleanup.push(() => clearTimeout(timer));
  cleanup.push(net.on('error', (m) => {
    const map: Record<string, L> = { 'spectate-full': D.full, 'match-not-found': D.notFound, 'spectate-denied': D.denied, 'spectate-off': D.off };
    if (!map[m.msg]) return;
    done(); toast(tr(map[m.msg]), 'err');
  }));
  cleanup.push(net.on('spec', (m) => {
    if (m.matchId !== matchId) return;
    done();
    track('spectate', m.mode);
    const src = new SpectateSource(matchId, m);
    show(() => viewerScreen(src, back));
  }));
  net.send({ t: 'spectate', matchId });
}

// ============================================================================================
// Hook for the clan screen (and any friends list): "in match — watch" for a member.
// Returns null offline; otherwise a placeholder that fills in if the player is in a match
// this viewer may watch (lookups are batched and cached for 10 s).
// ============================================================================================
let pending = new Map<string, ((matchId: string | undefined) => void)[]>();
let batchTimer = 0;
const cache = new Map<string, { at: number; matchId?: string }>();

function lookup(userId: string): Promise<string | undefined> {
  const c = cache.get(userId);
  if (c && Date.now() - c.at < 10_000) return Promise.resolve(c.matchId);
  return new Promise((res) => {
    const l = pending.get(userId) ?? [];
    l.push(res);
    pending.set(userId, l);
    if (!batchTimer) batchTimer = window.setTimeout(flushLookups, 60);
  });
}
async function flushLookups() {
  batchTimer = 0;
  const batch = pending;
  pending = new Map();
  let found: Record<string, string> = {};
  try { found = (await backend.api<{ matches: Record<string, string> }>('POST', '/api/live/find', { uids: [...batch.keys()] })).matches; } catch { /* treat as not playing */ }
  for (const [uid, cbs] of batch) {
    cache.set(uid, { at: Date.now(), matchId: found[uid] });
    cbs.forEach((cb) => cb(found[uid]));
  }
}

export function watchButton(userId: string): HTMLElement | null {
  if (!backend.online || !remoteConfig().flags.spectate || userId === backend.profile.id) return null;
  const slot = h('span', { class: 'watch-slot' });
  void lookup(userId).then((matchId) => {
    if (!matchId) return;
    slot.append(h('button', { class: 'btn small watch-btn', onclick: (e: Event) => {
      e.stopPropagation();
      spectateMatch(matchId, () => import('./clan.ts').then((m) => show(m.clanScreen)));
    } }, picon('eye', 13), tr(D.inMatch)));
  });
  return slot;
}
