import crypto from 'node:crypto';
import {
  newProfile, newSocialDb, refreshDaily, clanTouch, newAnalyticsStore, noteActive, noteInstall, publicBadges, dayKey, mergeRemoteConfig, setRemoteConfig,
  type Profile, type SocialCtx, type SocialDb,
} from '@nb/shared';
import { config } from './config.ts';
import type { DbShape, StorageAdapter, UserRec } from './storage/adapter.ts';
import { JsonAdapter } from './storage/json.ts';
import { PostgresAdapter } from './storage/postgres.ts';

/**
 * In-memory game database with write-behind persistence through a storage adapter:
 *  - default: JSON file in DATA_DIR (single node, soft launch)
 *  - DATABASE_URL set: PostgreSQL (batched upserts of changed rows every few seconds)
 * Everything is loaded on start; markDirty() schedules the next flush.
 */
let db: DbShape = emptyDb();
let dirty = false;
let saving: Promise<void> | null = null;
let adapter: StorageAdapter;

function emptyDb(): DbShape {
  return { users: {}, byToken: {}, usedPurchaseTokens: {}, social: newSocialDb(), analytics: newAnalyticsStore(), meta: {}, replayIndex: {} };
}

export function createAdapter(): StorageAdapter {
  return config.databaseUrl ? new PostgresAdapter(config.databaseUrl) : new JsonAdapter(config.dataDir);
}

export async function loadDb(a: StorageAdapter = createAdapter()) {
  adapter = a;
  await adapter.init();
  const loaded = await adapter.load();
  db = { ...emptyDb(), ...(loaded ?? {}) };
  db.social ??= newSocialDb();
  db.analytics ??= newAnalyticsStore();
  db.analytics.days ??= {};
  db.meta ??= {};
  db.replayIndex ??= {};
  db.social.rate = {};
  setRemoteConfig(mergeRemoteConfig(db.meta.remoteConfig ?? {}));
  console.log(`[db] ${adapter.kind} storage, ${Object.keys(db.users).length} users`);
  setInterval(() => { void flush(); }, config.flushMs).unref();
  const bye = () => { flush().catch((e) => console.error('[db] final flush failed', e)).finally(() => process.exit(0)); };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
}

export function storage() { return adapter; }

/** Writes pending changes (no-op when nothing changed; never overlaps itself). */
export async function flush(): Promise<void> {
  if (saving) { await saving; if (!dirty) return; }
  if (!dirty || !adapter) return;
  dirty = false;
  saving = adapter.save(db).catch((e) => { dirty = true; console.error('[db] save failed, will retry', e); }).finally(() => { saving = null; });
  await saving;
}

export function markDirty() { dirty = true; }

export function createGuest(name?: string): UserRec {
  const id = 'u_' + crypto.randomBytes(6).toString('hex');
  const token = crypto.randomBytes(24).toString('base64url');
  const nick = sanitizeName(name) || 'Player' + Math.floor(1000 + Math.random() * 9000);
  const rec: UserRec = { token, profile: newProfile(id, nick), purchaseTokens: [], ads: { day: '', count: 0 } };
  noteInstall(db.analytics, (rec.act = {}), dayKey(Date.now()));
  db.users[id] = rec;
  db.byToken[token] = id;
  markDirty();
  return rec;
}

export function userByToken(token: string | undefined | null): UserRec | null {
  if (!token) return null;
  const id = db.byToken[token];
  const u = id ? db.users[id] : null;
  if (!u || u.banned || db.social.bans[u.profile.id]) return null;
  refreshDaily(u.profile);
  clanTouch(socialCtx(), u.profile);
  if (noteActive(db.analytics, (u.act ??= { installDay: dayKey(u.profile.createdAt || Date.now()) }), dayKey(Date.now()))) markDirty();
  return u;
}

export function userById(id: string): UserRec | null {
  return db.users[id] ?? null;
}

export function isPurchaseTokenUsed(token: string) { return !!db.usedPurchaseTokens[token]; }
export function markPurchaseToken(token: string, userId: string) { db.usedPurchaseTokens[token] = userId; markDirty(); }

export function leaderboard(limit = 100) {
  return Object.values(db.users)
    .filter((u) => u.profile.rank.wins + u.profile.rank.losses > 0)
    .sort((a, b) => b.profile.rank.mmr - a.profile.rank.mmr)
    .slice(0, limit)
    .map((u, i) => ({
      pos: i + 1, id: u.profile.id, name: u.profile.name, mmr: u.profile.rank.mmr,
      wins: u.profile.rank.wins, losses: u.profile.rank.losses, fighter: u.profile.selFighter, level: u.profile.level, ...publicBadges(u.profile),
    }));
}

export function sanitizeName(name?: string) {
  return (name ?? '').replace(/[^\p{L}\p{N}_ .-]/gu, '').trim().slice(0, 16);
}

export type { UserRec };
export function dbSnapshot() { return db; }
export function analyticsStore() { return db.analytics; }
export function dbMeta() { return db.meta; }
export function allUsers() { return Object.values(db.users); }
export function replayIndex() { return db.replayIndex; }

export function socialDb() { return db.social; }
/** Context for the shared social engine: every profile is reachable on the server. */
export function socialCtx(): SocialCtx {
  return { db: db.social, now: Date.now(), rand: Math.random, profileOf: (id) => db.users[id]?.profile ?? null };
}
export function isBanned(token: string) {
  const id = db.byToken[token];
  return !!id && !!db.social.bans[id];
}

export function allProfiles() { return Object.values(db.users).map((u) => u.profile); }

/** All-time league (ranked) wins. */
export function winsLeaderboard(limit = 100) {
  return Object.values(db.users)
    .filter((u) => (u.profile.stats.leagueWins ?? 0) > 0 || u.profile.rank.wins > 0)
    .map((u) => ({ id: u.profile.id, name: u.profile.name, wins: Math.max(u.profile.stats.leagueWins ?? 0, u.profile.rank.wins), mmr: u.profile.rank.mmr, fighter: u.profile.selFighter, trophies: (u.profile.trophies ?? []).length, ...publicBadges(u.profile) }))
    .sort((a, b) => b.wins - a.wins || b.mmr - a.mmr).slice(0, limit).map((x, i) => ({ pos: i + 1, ...x }));
}
