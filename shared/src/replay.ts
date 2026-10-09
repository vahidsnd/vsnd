// =============================================================================================
//  Replays
//  The simulation is deterministic, so a replay is just the match config + every frame's input
//  bits per slot. Inputs are run-length encoded per slot ([value, count] pairs), packed as
//  varints and shipped as a base64url "replay code" (also used for sharing / files).
// =============================================================================================
import { cloneState, createGame, step } from './sim.ts';
import type { GameEvent, GameState, MatchConfig } from './types.ts';

export interface ReplayMeta {
  id: string;
  at: number;              // ms epoch when recorded
  mode: string;            // cpu | map | raid | ranked | casual | private
  slot: number;            // the recording player's slot (-1 = spectator / none)
  winnerTeam: number;
  placements: number[];
  frames: number;          // number of recorded steps
  online?: boolean;
}

/** A forfeit / out-of-band change applied right before the step of frame `f`. */
export interface ReplayMark { f: number; slot: number; k: 'ff' }

export interface ReplayData {
  v: 1;
  meta: ReplayMeta;
  cfg: MatchConfig;
  /** per slot: flat RLE pairs [bits, count, bits, count, …] covering meta.frames frames */
  inputs: number[][];
  marks: ReplayMark[];
}

export const REPLAY_PREFIX = 'NBR1.';
/** keyframe interval for fast seeking (5 s) */
export const REPLAY_KEY_EVERY = 300;

// ---- recording --------------------------------------------------------------------------------
export class ReplayRecorder {
  private runs: number[][];
  private marks: ReplayMark[] = [];
  frames = 0;
  constructor(public cfg: MatchConfig) {
    this.runs = cfg.players.map(() => []);
  }
  /** call once per sim step with the exact inputs passed to step() */
  push(inputs: ArrayLike<number>) {
    for (let s = 0; s < this.runs.length; s++) {
      const r = this.runs[s];
      const b = (inputs[s] ?? 0) | 0;
      const n = r.length;
      if (n && r[n - 2] === b) r[n - 1]++;
      else r.push(b, 1);
    }
    this.frames++;
  }
  /** a forfeit applied to `state` before the step of frame `frame` */
  mark(frame: number, slot: number) { this.marks.push({ f: frame, slot, k: 'ff' }); }
  build(meta: Omit<ReplayMeta, 'frames'>): ReplayData {
    return { v: 1, meta: { ...meta, frames: this.frames }, cfg: structuredClone(this.cfg), inputs: this.runs.map((r) => r.slice()), marks: this.marks.slice() };
  }
}

/** The out-of-band forfeit mutation (identical on the server and in replays). */
export function forfeitSlot(state: GameState, slot: number) {
  const f = state.fighters[slot];
  if (!f) return;
  f.stocks = 0; f.action = 'dead';
}

// ---- binary packing ---------------------------------------------------------------------------
function pushVar(out: number[], n: number) {
  n = Math.max(0, Math.floor(n));
  while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
  out.push(n);
}
function readVar(b: Uint8Array, pos: { i: number }): number {
  let n = 0, mul = 1;
  for (;;) {
    if (pos.i >= b.length) throw new Error('replay-truncated');
    const c = b[pos.i++];
    n += (c & 0x7f) * mul;
    if (c < 0x80) return n;
    mul *= 128;
    if (mul > 2 ** 49) throw new Error('replay-corrupt');
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function bytesToB64url(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < b.length) s += B64[(n >> 6) & 63];
    if (i + 2 < b.length) s += B64[n & 63];
  }
  return s;
}
export function b64urlToBytes(s: string): Uint8Array {
  const clean = s.replace(/[\s=]/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (i + k < clean.length ? B64.indexOf(clean[i + k]) : 0));
    if (v.some((x) => x < 0)) throw new Error('replay-bad-code');
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length && i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (o < out.length && i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Replay → compact shareable code ("NBR1." + base64url). */
export function encodeReplay(r: ReplayData): string {
  const head = enc.encode(JSON.stringify({ meta: r.meta, cfg: r.cfg, marks: r.marks }));
  const out: number[] = [1];
  pushVar(out, head.length);
  for (const b of head) out.push(b);
  pushVar(out, r.inputs.length);
  for (const runs of r.inputs) {
    pushVar(out, runs.length / 2);
    for (const v of runs) pushVar(out, v);
  }
  return REPLAY_PREFIX + bytesToB64url(Uint8Array.from(out));
}

/** Code (or file contents) → replay. Throws on anything malformed. */
export function decodeReplay(code: string): ReplayData {
  let s = String(code ?? '').trim();
  const at = s.indexOf(REPLAY_PREFIX);
  if (at < 0) throw new Error('replay-bad-code');
  s = s.slice(at + REPLAY_PREFIX.length).split(/[^A-Za-z0-9_\-+/=\s]/)[0];
  const b = b64urlToBytes(s);
  const pos = { i: 0 };
  if (b[pos.i++] !== 1) throw new Error('replay-version');
  const hl = readVar(b, pos);
  if (pos.i + hl > b.length) throw new Error('replay-truncated');
  const head = JSON.parse(dec.decode(b.subarray(pos.i, pos.i + hl)));
  pos.i += hl;
  const slots = readVar(b, pos);
  if (slots > 8) throw new Error('replay-corrupt');
  const inputs: number[][] = [];
  for (let s2 = 0; s2 < slots; s2++) {
    const n = readVar(b, pos);
    if (n > 2_000_000) throw new Error('replay-corrupt');
    const runs: number[] = [];
    for (let k = 0; k < n * 2; k++) runs.push(readVar(b, pos));
    inputs.push(runs);
  }
  const r: ReplayData = { v: 1, meta: head.meta, cfg: head.cfg, inputs, marks: Array.isArray(head.marks) ? head.marks : [] };
  validateReplay(r);
  return r;
}

export function validateReplay(r: ReplayData) {
  const m = r.meta;
  if (!m || !r.cfg || !Array.isArray(r.cfg.players) || r.cfg.players.length < 1 || r.cfg.players.length > 8) throw new Error('replay-corrupt');
  if (!Number.isInteger(m.frames) || m.frames < 0 || m.frames > 60 * 60 * 30) throw new Error('replay-corrupt');
  if (r.inputs.length !== r.cfg.players.length) throw new Error('replay-corrupt');
  for (const runs of r.inputs) {
    let total = 0;
    for (let i = 1; i < runs.length; i += 2) total += runs[i];
    if (total !== m.frames) throw new Error('replay-corrupt');
  }
}

/** Expands the RLE streams into one flat frame-major array: inputs[frame * slots + slot]. */
export function expandInputs(r: ReplayData): Uint16Array {
  const S = r.inputs.length, F = r.meta.frames;
  const out = new Uint16Array(F * S);
  r.inputs.forEach((runs, s) => {
    let f = 0;
    for (let i = 0; i < runs.length; i += 2) for (let k = 0; k < runs[i + 1]; k++) out[(f++) * S + s] = runs[i];
  });
  return out;
}

// ---- playback -----------------------------------------------------------------------------------
/**
 * Deterministic playback with keyframes for fast seeking: states are cached every
 * REPLAY_KEY_EVERY steps, seeking restores the nearest earlier keyframe and re-simulates.
 */
export class ReplayPlayer {
  state: GameState;
  /** number of steps applied to `state` */
  pos = 0;
  readonly length: number;
  private flat: Uint16Array;
  private slots: number;
  private keys = new Map<number, GameState>();
  private marksAt = new Map<number, ReplayMark[]>();
  private buf: number[];

  constructor(public data: ReplayData, private keyEvery = REPLAY_KEY_EVERY) {
    this.flat = expandInputs(data);
    this.slots = data.inputs.length;
    this.length = data.meta.frames;
    this.buf = new Array(this.slots).fill(0);
    for (const m of data.marks) { const l = this.marksAt.get(m.f) ?? []; l.push(m); this.marksAt.set(m.f, l); }
    this.state = createGame(structuredClone(data.cfg));
    this.keys.set(0, cloneState(this.state));
  }

  get done() { return this.pos >= this.length; }

  /** applies one recorded frame; returns that frame's events */
  stepOnce(): GameEvent[] {
    if (this.pos >= this.length) { this.state.events = []; return []; }
    for (const m of this.marksAt.get(this.state.frame) ?? []) if (m.k === 'ff') forfeitSlot(this.state, m.slot);
    const base = this.pos * this.slots;
    for (let s = 0; s < this.slots; s++) this.buf[s] = this.flat[base + s];
    step(this.state, this.buf);
    this.pos++;
    if (this.pos % this.keyEvery === 0 && !this.keys.has(this.pos)) this.keys.set(this.pos, cloneState(this.state));
    return this.state.events;
  }

  /** jumps to `target` steps (0..length) using the nearest cached keyframe */
  seek(target: number) {
    target = Math.max(0, Math.min(this.length, Math.floor(target)));
    if (target === this.pos) return;
    if (target < this.pos || target - this.pos > this.keyEvery) {
      let best = 0;
      for (const k of this.keys.keys()) if (k <= target && k > best) best = k;
      if (target < this.pos || best > this.pos) { this.state = cloneState(this.keys.get(best)!); this.pos = best; }
    }
    while (this.pos < target) this.stepOnce();
    this.state.events = [];
  }

  keyframeCount() { return this.keys.size; }

  private scout: { state: GameState; pos: number } | null = null;
  /**
   * Computes keyframes ahead of the playhead in the background (call from idle time) so later
   * seeks are instant. Returns true once every keyframe exists.
   */
  warm(budgetMs = 6): boolean {
    let last = 0;
    for (const k of this.keys.keys()) if (k > last) last = k;
    if (last + this.keyEvery > this.length) return true;
    if (!this.scout || this.scout.pos < last) this.scout = { state: cloneState(this.keys.get(last)!), pos: last };
    const sc = this.scout, t0 = Date.now(), buf = new Array(this.slots).fill(0);
    while (Date.now() - t0 < budgetMs && sc.pos < this.length) {
      for (const m of this.marksAt.get(sc.state.frame) ?? []) if (m.k === 'ff') forfeitSlot(sc.state, m.slot);
      const base = sc.pos * this.slots;
      for (let s = 0; s < this.slots; s++) buf[s] = this.flat[base + s];
      step(sc.state, buf);
      sc.pos++;
      if (sc.pos % this.keyEvery === 0) {
        if (!this.keys.has(sc.pos)) this.keys.set(sc.pos, cloneState(sc.state));
        last = sc.pos;
        if (last + this.keyEvery > this.length) { this.scout = null; return true; }
      }
    }
    return false;
  }
}

/** Runs the whole replay and returns the final state. */
export function simulateReplay(r: ReplayData): GameState {
  const p = new ReplayPlayer(r, 1e9);
  while (!p.done) p.stepOnce();
  return p.state;
}

export function replayDurationSec(r: { meta: { frames: number } }) { return r.meta.frames / 60; }
