import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { newProfile, newSocialDb, refreshDaily, clanTouch, publicBadges, type Profile, type SocialCtx, type SocialDb } from '@nb/shared';
import { config } from './config.ts';

/**
 * Tiny JSON-file persistence. Good enough for a soft launch on a single node;
 * swap for Postgres/Redis by re-implementing this module's exports.
 */
interface UserRec {
  token: string;
  profile: Profile;
  purchaseTokens: string[];
  ads: { day: string; count: number };
  cpu?: { day: string; count: number };
  recent?: number[];
  banned?: boolean;
}

interface DbShape { users: Record<string, UserRec>; byToken: Record<string, string>; usedPurchaseTokens: Record<string, string>; social: SocialDb }

const file = path.join(config.dataDir, 'db.json');
let db: DbShape = { users: {}, byToken: {}, usedPurchaseTokens: {}, social: newSocialDb() };
let dirty = false;

export function loadDb() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (fs.existsSync(file)) db = JSON.parse(fs.readFileSync(file, 'utf8'));
  db.social ??= newSocialDb();
  db.social.rate = {};
  setInterval(flush, 5000).unref();
  process.on('SIGINT', () => { flush(); process.exit(0); });
  process.on('SIGTERM', () => { flush(); process.exit(0); });
}

export function flush() {
  if (!dirty) return;
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, (k, v) => (k === 'rate' ? undefined : v)));
  fs.renameSync(tmp, file);
  dirty = false;
}

export function markDirty() { dirty = true; }

export function createGuest(name?: string): UserRec {
  const id = 'u_' + crypto.randomBytes(6).toString('hex');
  const token = crypto.randomBytes(24).toString('base64url');
  const nick = sanitizeName(name) || 'Player' + Math.floor(1000 + Math.random() * 9000);
  const rec: UserRec = { token, profile: newProfile(id, nick), purchaseTokens: [], ads: { day: '', count: 0 } };
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
