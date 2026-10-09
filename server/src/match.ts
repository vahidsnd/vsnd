import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  applyMatch, botInput, createBrain, createGame, eloDelta, encodeFighters, encodeMeta, encodeProjectiles,
  placements, step, SNAPSHOT_EVERY, TICK_RATE, COUNTDOWN, trackLeague, warReport, clanOf,
  type BotBrain, type GameEvent, type GameState, type MatchConfig, type MatchEndInfo, type ServerMsg,
} from '@nb/shared';
import { markDirty, socialCtx, type UserRec } from './db.ts';
import { notifyClan } from './sockets.ts';

export type MatchMode = 'ranked' | 'casual' | 'private';

export interface Seat {
  user: UserRec | null;
  ws: WebSocket | null;
  bot: BotBrain | null;
  queue: [number, number][];  // [seq, bits]
  nextSeq: number;
  lastBits: number;
  ack: number;
  dcAt: number;
  mmr: number;
}

export const activeMatches = new Map<string, Match>();
export const matchByUser = new Map<string, Match>();

const MAX_QUEUE = 3;          // inputs buffered server-side; more = we're behind, catch up
const DC_TO_BOT_MS = 8000;

export function send(ws: WebSocket | null, msg: ServerMsg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

export class Match {
  id = crypto.randomBytes(6).toString('hex');
  state: GameState;
  private timer: NodeJS.Timeout | null = null;
  private startedAt = 0;
  private ticks = 0;
  private events: GameEvent[] = [];
  private endTicks = -1;
  finished = false;

  constructor(public mode: MatchMode, public cfg: MatchConfig, public seats: Seat[]) {
    this.state = createGame(cfg);
  }

  start() {
    activeMatches.set(this.id, this);
    const ranks = this.seats.map((s) => s.mmr);
    this.seats.forEach((s, slot) => {
      if (s.user) matchByUser.set(s.user.profile.id, this);
      send(s.ws, { t: 'match', matchId: this.id, slot, cfg: this.cfg, mode: this.mode, ranks, startFrame: COUNTDOWN });
    });
    this.startedAt = performance.now();
    // fixed-step loop with drift correction
    this.timer = setInterval(() => {
      const target = Math.floor(((performance.now() - this.startedAt) / 1000) * TICK_RATE);
      let n = 0;
      while (this.ticks < target && n++ < 8 && !this.finished) this.tick();
    }, 1000 / TICK_RATE / 2);
  }

  onInput(user: UserRec, s: number, bits: number[]) {
    const seat = this.seats.find((x) => x.user === user);
    if (!seat || !Array.isArray(bits)) return;
    const first = s - bits.length + 1;
    bits.forEach((b, i) => {
      const seq = first + i;
      if (seq >= seat.nextSeq) { seat.queue.push([seq, b | 0]); seat.nextSeq = seq + 1; }
    });
    if (seat.queue.length > 30) seat.queue.splice(0, seat.queue.length - 30);
  }

  reconnect(user: UserRec, ws: WebSocket) {
    const slot = this.seats.findIndex((x) => x.user === user);
    if (slot < 0) return;
    const seat = this.seats[slot];
    seat.ws = ws; seat.dcAt = 0;
    if (seat.bot && !this.state.over) seat.bot = null;
    seat.queue = []; seat.nextSeq = 0;
    send(ws, { t: 'match', matchId: this.id, slot, cfg: this.cfg, mode: this.mode, ranks: this.seats.map((x) => x.mmr), startFrame: COUNTDOWN });
  }

  disconnect(user: UserRec) {
    const seat = this.seats.find((x) => x.user === user);
    if (seat) { seat.ws = null; seat.dcAt = Date.now(); }
  }

  forfeit(user: UserRec) {
    const slot = this.seats.findIndex((x) => x.user === user);
    if (slot < 0) return;
    const f = this.state.fighters[slot];
    f.stocks = 0; f.action = 'dead';
    this.seats[slot].bot = null;
    this.seats[slot].queue = [];
  }

  emote(user: UserRec, id: number) {
    const slot = this.seats.findIndex((x) => x.user === user);
    if (slot < 0) return;
    for (const s of this.seats) send(s.ws, { t: 'emote', slot, id: id | 0 });
  }

  private tick() {
    this.ticks++;
    const inputs: number[] = [];
    const now = Date.now();
    this.seats.forEach((seat, slot) => {
      if (seat.user && !seat.ws && seat.dcAt && now - seat.dcAt > DC_TO_BOT_MS && !seat.bot) seat.bot = createBrain(5);
      if (seat.bot) { inputs[slot] = botInput(this.state, slot, seat.bot); return; }
      while (seat.queue.length > MAX_QUEUE) { const [sq, b] = seat.queue.shift()!; seat.ack = sq; seat.lastBits = b; }
      const next = seat.queue.shift();
      if (next) { seat.ack = next[0]; seat.lastBits = next[1]; }
      inputs[slot] = seat.lastBits;
    });
    step(this.state, inputs);
    this.events.push(...this.state.events);
    if (this.state.frame % SNAPSHOT_EVERY === 0 || this.state.over) this.broadcast();
    if (this.state.over) {
      if (this.endTicks < 0) this.endTicks = 90;
      if (--this.endTicks <= 0) this.finish();
    }
    // nobody left watching → end early
    if (this.seats.every((s) => !s.ws) && this.ticks > 60) this.finish();
  }

  private broadcast() {
    const d = encodeFighters(this.state.fighters);
    const p = encodeProjectiles(this.state.projectiles);
    const m = encodeMeta(this.state);
    const ev = this.events;
    this.events = [];
    for (const s of this.seats) {
      if (!s.ws) continue;
      send(s.ws, { t: 'snap', f: this.state.frame, ack: s.ack, d, p, m, ev });
    }
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    if (this.timer) clearInterval(this.timer);
    activeMatches.delete(this.id);
    const st = this.state;
    if (!st.over) { st.over = true; st.winnerTeam = -1; }
    const place = placements(st);
    const durationSec = Math.max(0, (st.endFrame || st.frame) - COUNTDOWN) / TICK_RATE;
    const stats = st.fighters.map((f) => f.stats);

    // Elo per human seat: opponent rating = average of enemies
    const deltas = this.seats.map((seat, i) => {
      if (this.mode !== 'ranked' || !seat.user) return 0;
      const me = st.fighters[i];
      const enemies = this.seats.filter((_, j) => st.fighters[j].team !== me.team);
      const opp = enemies.reduce((a, s) => a + s.mmr, 0) / Math.max(1, enemies.length);
      const won = st.winnerTeam === me.team;
      return eloDelta(seat.mmr, opp, won, seat.user.profile.rank.streak);
    });

    this.seats.forEach((seat, i) => {
      if (!seat.user) return;
      const p = seat.user.profile;
      const f = st.fighters[i];
      const won = st.winnerTeam === f.team;
      const reward = applyMatch(p, {
        matchId: this.id, mode: this.mode === 'private' ? 'casual' : this.mode, won, placement: place[i],
        players: st.fighters.length, kos: f.stats.kos, falls: f.stats.falls, dmg: f.stats.dmgDealt,
        smashKOs: f.stats.smashKOs, maxCombo: f.stats.maxCombo, fighter: f.charId, durationSec,
      });
      let mmrDelta: number | undefined;
      if (this.mode === 'ranked') {
        mmrDelta = deltas[i];
        p.rank.mmr = Math.max(0, p.rank.mmr + mmrDelta);
        p.rank.peak = Math.max(p.rank.peak, p.rank.mmr);
        if (won) { p.rank.wins++; p.rank.streak = Math.max(1, p.rank.streak + 1); } else { p.rank.losses++; p.rank.streak = 0; }
        reward.mmrDelta = mmrDelta;
        trackLeague(p);
      }
      if (this.mode !== 'private') {
        const ctx = socialCtx();
        if (warReport(ctx, p.id, won, f.stats.kos)) { const c = clanOf(ctx.db, p.id); if (c) notifyClan(c.id, 'war'); }
      }
      markDirty();
      const info: MatchEndInfo = { winnerTeam: st.winnerTeam, placements: place, stats, reward, mmrDelta, profile: p };
      send(seat.ws, { t: 'end', info });
      if (matchByUser.get(p.id) === this) matchByUser.delete(p.id);
    });
  }
}
