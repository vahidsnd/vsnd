import type { GameEvent, GameState, MatchConfig, FighterState, ProjectileState } from './types.ts';
import type { Profile, RewardResult } from './economy.ts';
import type { ChatMsg } from './social.ts';
import { applyRules, encodeRules } from './rules.ts';

export type QueueMode = 'ranked' | 'casual' | 'event';
export type QueueFormat = '1v1' | '2v2' | 'ffa';

export type ClientMsg =
  | { t: 'hello'; token: string; v: number }
  | { t: 'queue'; mode: QueueMode; format: QueueFormat; fighter: string; skin: number }
  | { t: 'cancel' }
  | { t: 'room_create'; fighter: string; skin: number }
  | { t: 'room_join'; code: string; fighter: string; skin: number }
  | { t: 'room_update'; fighter?: string; skin?: number; team?: number; stage?: string; stocks?: number; teams?: boolean; bots?: number; rules?: string }
  | { t: 'room_start' }
  | { t: 'room_leave' }
  | { t: 'in'; s: number; b: number[] }   // latest input seq + last N input bits (oldest first) for redundancy
  | { t: 'forfeit' }
  | { t: 'emote'; id: number }
  | { t: 'ping'; ts: number }
  | { t: 'spectate'; matchId: string }   // watch a running match (snapshots only, delayed)
  | { t: 'spectate_stop' };

export interface RoomPlayer { name: string; fighter: string; skin: number; team: number; host: boolean; bot?: boolean }
export interface RoomInfo { code: string; players: RoomPlayer[]; stage: string; stocks: number; teams: boolean; bots: number; rules?: import('./rules.ts').RuleMode }

export interface MatchEndInfo {
  winnerTeam: number;
  placements: number[];
  stats: FighterState['stats'][];
  reward?: RewardResult;
  mmrDelta?: number;
  profile?: Profile;
  /** replay code of the whole match (see replay.ts) */
  replay?: string;
}

/** A running match as listed for spectators. */
export interface LiveMatchInfo { id: string; mode: string; startedAt: number; players: { name: string; fighter: string; mmr: number; bot?: boolean; uid?: string }[]; avgMmr: number; spectators: number }

export type ServerMsg =
  | { t: 'welcome'; profile: Profile; online: number }
  | { t: 'queued'; mode: QueueMode; format: QueueFormat; players: number }
  | { t: 'match'; matchId: string; slot: number; cfg: MatchConfig; mode: string; ranks: number[]; startFrame: number }
  | { t: 'snap'; f: number; ack: number; d: unknown[]; p: unknown[]; m: unknown[]; ev: GameEvent[] }
  | { t: 'end'; info: MatchEndInfo }
  | { t: 'room'; room: RoomInfo | null }
  | { t: 'emote'; slot: number; id: number }
  | { t: 'pong'; ts: number }
  | { t: 'chat'; msg: ChatMsg }
  | { t: 'social'; kind: string }
  | { t: 'profile'; profile: Profile }
  | { t: 'notif'; notif: import('./notify.ts').Notif; unread: number }
  | { t: 'error'; msg: string }
  | { t: 'spec'; matchId: string; cfg: MatchConfig; mode: string; delayMs: number; spectators: number }
  | { t: 'spec_end'; matchId: string; winnerTeam: number; placements: number[] };

export const PROTOCOL_VERSION = 2;
export const SNAPSHOT_EVERY = 2;   // frames (30 Hz)
export const INPUT_REDUNDANCY = 4; // inputs repeated per packet against packet loss

// ---- compact state encoding -------------------------------------------------------------
const F_KEYS = [
  'x', 'y', 'vx', 'vy', 'kx', 'ky', 'facing', 'grounded', 'platform', 'jumps', 'damage', 'stocks',
  'action', 'af', 'move', 'charge', 'hitIds', 'multiTick', 'hitlag', 'hitstun', 'shield', 'shieldStun',
  'invuln', 'intang', 'fastFall', 'dropThrough', 'airdodged', 'usedRecovery', 'ledgeRegrab', 'ledgeSide',
  'grabPartner', 'respawn', 'inp', 'prev', 'tapX', 'tapY', 'tapT', 'lastHitBy', 'lastHitMove', 'combo',
  'lag', 'grabT', 'ledgeGrabs', 'usedSide', 'mana',
  'spd', 'bub', 'held', // match rules (appended: older clients ignore them)
] as const satisfies readonly (keyof FighterState)[];

const r2 = (v: unknown) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v);

export function encodeFighters(fs: FighterState[]): unknown[] {
  return fs.map((f) => F_KEYS.map((k) => r2(f[k])));
}

export function applyFighters(fs: FighterState[], data: unknown[]) {
  data.forEach((arr, i) => {
    const f = fs[i] as unknown as Record<string, unknown>;
    if (!f) return;
    (arr as unknown[]).forEach((v, j) => { f[F_KEYS[j]] = v; });
  });
}

export function encodeProjectiles(ps: ProjectileState[]): unknown[] {
  return ps.map((p) => [p.id, p.owner, p.team, p.kind, r2(p.x), r2(p.y), r2(p.vx), r2(p.vy), p.life, p.hit, p.facing, p.def]);
}

export function decodeProjectiles(data: unknown[]): ProjectileState[] {
  return (data as unknown[][]).map((a) => ({
    id: a[0] as number, owner: a[1] as number, team: a[2] as number, kind: a[3] as string,
    x: a[4] as number, y: a[5] as number, vx: a[6] as number, vy: a[7] as number,
    life: a[8] as number, hit: a[9] as number[], facing: a[10] as 1 | -1, def: a[11] as ProjectileState['def'],
  }));
}

/** meta: frame-level fields */
export function encodeMeta(s: GameState): unknown[] {
  const m: unknown[] = [s.frame, s.nextId, s.timer, s.over ? 1 : 0, s.winnerTeam, s.endFrame];
  const r = encodeRules(s); // items / boss tally (appended: older clients ignore it)
  if (r) m.push(r);
  return m;
}
export function applyMeta(s: GameState, m: unknown[]) {
  s.frame = m[0] as number; s.nextId = m[1] as number; s.timer = m[2] as number;
  s.over = m[3] === 1; s.winnerTeam = m[4] as number; s.endFrame = m[5] as number;
  if (m.length > 6) applyRules(s, m[6]);
}
