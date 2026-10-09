import { bump, dayKey, type ReplayData } from '@nb/shared';
import { config } from './config.ts';
import { analyticsStore, markDirty, replayIndex, storage, type UserRec } from './db.ts';
import type { ReplayIndexEntry } from './storage/adapter.ts';
import { HttpError, need } from './social.ts';

type Handler = (body: any, user: UserRec | null) => Promise<unknown> | unknown;

/**
 * Stores an online match replay once and indexes it for every human player
 * (newest first, last REPLAYS_PER_USER kept; codes nobody references any more are deleted).
 */
export async function storeMatchReplay(data: ReplayData, code: string, humans: { uid: string; slot: number }[]) {
  bump(analyticsStore(), dayKey(Date.now()), 'online_matches');
  if (!humans.length) return;
  const idx = replayIndex();
  const base: Omit<ReplayIndexEntry, 'slot'> = {
    id: data.meta.id, at: data.meta.at, mode: data.meta.mode, frames: data.meta.frames, winnerTeam: data.meta.winnerTeam,
    players: data.cfg.players.map((p, i) => ({ name: p.name, fighter: p.charId, team: data.cfg.teams ? p.team : i, bot: p.bot || undefined })),
  };
  const dropped: string[] = [];
  humans.forEach(({ uid, slot }) => {
    const list = (idx[uid] ??= []);
    list.unshift({ ...base, slot });
    if (list.length > config.replaysPerUser) dropped.push(...list.splice(config.replaysPerUser).map((e) => e.id));
  });
  markDirty();
  try {
    await storage().putReplay({ id: data.meta.id, at: data.meta.at, code, meta: base });
    const orphans = [...new Set(dropped)].filter((id) => !Object.values(idx).some((l) => l.some((e) => e.id === id)));
    if (orphans.length) await storage().deleteReplays(orphans);
  } catch (e) { console.error('[replays] store failed', e); }
}

export const replayRoutes: Record<string, Handler> = {
  /** my last online replays (index only) */
  'GET /api/replays': (_b, u) => ({ replays: replayIndex()[need(u).profile.id] ?? [] }),
  /** a replay code by id (ids are unguessable, so shared links work for anyone signed in) */
  'POST /api/replay/get': async (b, u) => {
    need(u);
    const row = await storage().getReplay(String(b.id ?? ''));
    if (!row) throw new HttpError(404, 'not-found');
    return { id: row.id, code: row.code };
  },
};
