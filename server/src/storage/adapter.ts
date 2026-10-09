import type { ActivityRec, AnalyticsStore, Profile, SocialDb } from '@nb/shared';

/** One player account as kept in memory (write-behind cache). */
export interface UserRec {
  token: string;
  profile: Profile;
  purchaseTokens: string[];
  ads: { day: string; count: number };
  cpu?: { day: string; count: number };
  recent?: number[];
  banned?: boolean;
  /** install / last-active day for DAU + retention counters (no PII) */
  act?: ActivityRec;
}

/** Light index entry of a stored replay (the code itself lives in the adapter's replay store). */
export interface ReplayIndexEntry {
  id: string; at: number; mode: string; frames: number; winnerTeam: number;
  players: { name: string; fighter: string; team: number; bot?: boolean }[];
  slot: number;
}

export interface DbMeta {
  /** remote-config overrides set from the admin panel */
  remoteConfig?: unknown;
  /** promo / broadcast audit log for the admin panel */
  broadcasts?: { t: number; title: string; recipients: number; reward?: unknown }[];
}

export interface DbShape {
  users: Record<string, UserRec>;
  byToken: Record<string, string>;
  usedPurchaseTokens: Record<string, string>;
  social: SocialDb;
  analytics: AnalyticsStore;
  meta: DbMeta;
  /** per user: their last online replays (newest first) */
  replayIndex: Record<string, ReplayIndexEntry[]>;
}

export interface ReplayRow { id: string; at: number; code: string; meta?: unknown }

/**
 * Storage backend. The game server keeps everything in memory (load on start) and calls
 * save() every few seconds when something changed (write-behind). Replay codes are large,
 * so they are stored outside the snapshot through putReplay/getReplay.
 */
export interface StorageAdapter {
  readonly kind: 'json' | 'postgres';
  /** create directories / tables (idempotent migrations) */
  init(): Promise<void>;
  /** full snapshot, or null for an empty store */
  load(): Promise<DbShape | null>;
  /** persists the snapshot; implementations write only what changed when they can */
  save(db: DbShape): Promise<void>;
  /** last-chance synchronous save on shutdown (JSON only) */
  saveSync?(db: DbShape): void;
  putReplay(row: ReplayRow): Promise<void>;
  getReplay(id: string): Promise<ReplayRow | null>;
  deleteReplays(ids: string[]): Promise<void>;
  close(): Promise<void>;
}

/** JSON replacer used by every adapter: never persist the in-memory rate limiter. */
export const persistReplacer = (k: string, v: unknown) => (k === 'rate' ? undefined : v);
