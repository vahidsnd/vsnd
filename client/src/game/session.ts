import {
  Btn, applyFighters, applyMeta, botInput, cloneState, createBrain, createGame, decodeProjectiles, step,
  INPUT_REDUNDANCY, type BotBrain, type GameEvent, type GameState, type MatchConfig, type MatchEndInfo,
} from '@nb/shared';
import type { InputSource } from './input.ts';
import { net } from '../net/net.ts';

export interface Session {
  state: GameState;
  localSlots: number[];
  events: GameEvent[];
  ping?: number;
  paused: boolean;
  canPause: boolean;
  /** visual correction to apply this frame (online) */
  corrections: { slot: number; dx: number; dy: number }[];
  update(): void;
  destroy(): void;
}

// ---- local (offline, vs CPU, training, local multiplayer) ----------------------------------------
export class LocalSession implements Session {
  state: GameState;
  events: GameEvent[] = [];
  paused = false;
  canPause = true;
  corrections = [];
  private brains: (BotBrain | null)[];
  /** training dummy behaviour (slot 1) */
  dummy: 'idle' | 'jump' | 'shield' | 'cpu' = 'idle';
  private dummyBrain = createBrain(4);

  constructor(cfg: MatchConfig, private sources: (InputSource | null)[], botLevels: (number | null)[], public training = false) {
    this.state = createGame(cfg);
    this.brains = botLevels.map((l) => (l ? createBrain(l) : null));
    if (training) for (const f of this.state.fighters) f.stocks = 99;
  }

  get localSlots() { return this.sources.map((s, i) => (s ? i : -1)).filter((i) => i >= 0); }

  update() {
    if (this.paused) { this.events = []; return; }
    const inputs = this.state.fighters.map((_, i) => {
      const src = this.sources[i];
      if (src) return src.read();
      const b = this.brains[i];
      if (this.training && i === 1 && !b) {
        if (this.dummy === 'cpu') return botInput(this.state, i, this.dummyBrain);
        if (this.dummy === 'shield') return Btn.SHIELD;
        if (this.dummy === 'jump') return this.state.frame % 70 < 6 ? Btn.JUMP : 0;
        return 0;
      }
      return b ? botInput(this.state, i, b) : 0;
    });
    step(this.state, inputs);
    this.events = this.state.events;
    if (this.training) for (const f of this.state.fighters) if (f.stocks < 99) f.stocks = 99;
  }

  resetTraining() {
    for (const f of this.state.fighters) { f.damage = 0; }
  }

  destroy() { this.sources.forEach((s) => s?.destroy()); }
}

// ---- online (server authoritative + client prediction & reconciliation) ----------------------------
export class OnlineSession implements Session {
  state: GameState;           // predicted state that we render
  private confirmed: GameState;
  events: GameEvent[] = [];
  paused = false;
  canPause = false;
  corrections: { slot: number; dx: number; dy: number }[] = [];
  private seq = 0;
  private pending: { seq: number; bits: number }[] = [];
  private recent: number[] = [];
  private unsub: (() => void)[] = [];
  endInfo: MatchEndInfo | null = null;
  lastSnapAt = performance.now();

  constructor(public matchId: string, cfg: MatchConfig, public slot: number, private source: InputSource, public mode: string, public onEnd: (i: MatchEndInfo) => void) {
    this.confirmed = createGame(cfg);
    this.state = cloneState(this.confirmed);
    this.unsub.push(net.on('snap', (m) => this.onSnap(m)));
    this.unsub.push(net.on('end', (m) => { this.endInfo = m.info; this.onEnd(m.info); }));
  }

  get localSlots() { return [this.slot]; }
  get ping() { return net.ping; }

  private onSnap(m: { f: number; ack: number; d: unknown[]; p: unknown[]; m: unknown[] }) {
    this.lastSnapAt = performance.now();
    const c = this.confirmed;
    applyFighters(c.fighters, m.d);
    c.projectiles = decodeProjectiles(m.p);
    applyMeta(c, m.m);
    c.events = [];
    while (this.pending.length && this.pending[0].seq <= m.ack) this.pending.shift();
    if (this.pending.length > 40) this.pending.splice(0, this.pending.length - 40);

    // re-simulate our unacknowledged inputs on top of the authoritative state
    const before = this.state.fighters.map((f) => ({ x: f.x, y: f.y }));
    const next = cloneState(c);
    for (const p of this.pending) step(next, this.inputsFor(next, p.bits));
    next.events = [];
    this.corrections = next.fighters.map((f, i) => ({ slot: i, dx: before[i].x - f.x, dy: before[i].y - f.y }))
      .filter((k) => Math.abs(k.dx) + Math.abs(k.dy) > 0.5 && Math.abs(k.dx) + Math.abs(k.dy) < 250);
    this.state = next;
  }

  private inputsFor(s: GameState, myBits: number) {
    return s.fighters.map((f, i) => (i === this.slot ? myBits : f.inp));
  }

  update() {
    const bits = this.source.read();
    this.seq++;
    this.pending.push({ seq: this.seq, bits });
    this.recent.push(bits);
    if (this.recent.length > INPUT_REDUNDANCY) this.recent.shift();
    net.send({ t: 'in', s: this.seq, b: this.recent });
    step(this.state, this.inputsFor(this.state, bits));
    this.events = this.state.events;
  }

  forfeit() { net.send({ t: 'forfeit' }); }

  destroy() {
    this.unsub.forEach((u) => u());
    this.source.destroy();
  }
}
