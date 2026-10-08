import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { newProfile, refreshDaily, type Profile } from '@nb/shared';
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
  banned?: boolean;
}

interface DbShape { users: Record<string, UserRec>; byToken: Record<string, string>; usedPurchaseTokens: Record<string, string> }

const file = path.join(config.dataDir, 'db.json');
let db: DbShape = { users: {}, byToken: {}, usedPurchaseTokens: {} };
let dirty = false;

export function loadDb() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  if (fs.existsSync(file)) db = JSON.parse(fs.readFileSync(file, 'utf8'));
  setInterval(flush, 5000).unref();
  process.on('SIGINT', () => { flush(); process.exit(0); });
  process.on('SIGTERM', () => { flush(); process.exit(0); });
}

export function flush() {
  if (!dirty) return;
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
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
  if (!u || u.banned) return null;
  refreshDaily(u.profile);
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
      wins: u.profile.rank.wins, losses: u.profile.rank.losses, fighter: u.profile.selFighter, level: u.profile.level,
    }));
}

export function sanitizeName(name?: string) {
  return (name ?? '').replace(/[^\p{L}\p{N}_ .-]/gu, '').trim().slice(0, 16);
}

export type { UserRec };
