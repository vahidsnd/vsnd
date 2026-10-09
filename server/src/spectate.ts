import type { WebSocket } from 'ws';
import { clanOf, remoteConfig, type LiveMatchInfo, type ServerMsg } from '@nb/shared';
import { config } from './config.ts';
import { socialDb, type UserRec } from './db.ts';
import { activeMatches, send, type Match } from './match.ts';
import { need } from './social.ts';

type Handler = (body: any, user: UserRec | null) => Promise<unknown> | unknown;

/**
 * Spectators of one running match. They get exactly the players' snapshots, but delayed
 * (config.spectate.delayMs, default 3 s) so nobody can ghost a clan war from a second phone.
 * Spectators never send input.
 */
export class SpecFeed {
  viewers = new Set<WebSocket>();
  private buf: { at: number; data: string }[] = [];
  private ended: { at: number; msg: ServerMsg } | null = null;
  constructor(public match: Match) {}

  /** called by the match for every snapshot it broadcasts */
  snap(msg: ServerMsg) {
    if (!this.viewers.size) { this.buf.length = 0; return; }
    this.buf.push({ at: Date.now(), data: JSON.stringify(msg) });
    feeds.add(this);
  }
  end(winnerTeam: number, placements: number[]) {
    this.ended = { at: Date.now(), msg: { t: 'spec_end', matchId: this.match.id, winnerTeam, placements } };
    if (this.viewers.size) feeds.add(this);
  }
  /** sends everything older than the delay; returns false when the feed is finished */
  pump(now: number): boolean {
    const due = now - config.spectate.delayMs;
    let n = 0;
    while (n < this.buf.length && this.buf[n].at <= due) n++;
    if (n) {
      const out = this.buf.splice(0, n);
      for (const ws of this.viewers) if (ws.readyState === 1) for (const o of out) ws.send(o.data);
    }
    if (this.ended && this.ended.at <= due && !this.buf.length) {
      for (const ws of this.viewers) { send(ws, this.ended.msg); specOf.delete(ws); }
      this.viewers.clear();
      return false;
    }
    return this.viewers.size > 0 || !!this.ended;
  }
}

const feeds = new Set<SpecFeed>();
const specOf = new Map<WebSocket, SpecFeed>();
setInterval(() => {
  const now = Date.now();
  for (const f of feeds) if (!f.pump(now)) feeds.delete(f);
}, 33).unref();

/** May `viewer` watch this match? Public matches: anyone; private rooms: clan mates of a player. */
export function canWatch(m: Match, viewerId: string): boolean {
  if (m.finished) return false;
  if (m.seats.some((s) => s.user?.profile.id === viewerId)) return false;
  if (m.mode !== 'private') return true;
  const db = socialDb();
  const mine = clanOf(db, viewerId)?.id;
  return !!mine && m.seats.some((s) => s.user && clanOf(db, s.user.profile.id)?.id === mine);
}

export function spectate(user: UserRec, ws: WebSocket, matchId: string) {
  stopSpectating(ws);
  if (!remoteConfig().flags.spectate) return send(ws, { t: 'error', msg: 'spectate-off' });
  const m = activeMatches.get(String(matchId));
  if (!m) return send(ws, { t: 'error', msg: 'match-not-found' });
  if (!canWatch(m, user.profile.id)) return send(ws, { t: 'error', msg: 'spectate-denied' });
  if (m.spec.viewers.size >= config.spectate.max) return send(ws, { t: 'error', msg: 'spectate-full' });
  m.spec.viewers.add(ws);
  specOf.set(ws, m.spec);
  send(ws, { t: 'spec', matchId: m.id, cfg: m.cfg, mode: m.mode, delayMs: config.spectate.delayMs, spectators: m.spec.viewers.size });
}

export function stopSpectating(ws: WebSocket) {
  const f = specOf.get(ws);
  if (!f) return;
  f.viewers.delete(ws);
  specOf.delete(ws);
}

export function spectatorCount() { let n = 0; for (const m of activeMatches.values()) n += m.spec.viewers.size; return n; }

function info(m: Match): LiveMatchInfo {
  const humans = m.seats.filter((s) => s.user);
  return {
    id: m.id, mode: m.mode, startedAt: m.createdAt, spectators: m.spec.viewers.size,
    avgMmr: Math.round(humans.reduce((a, s) => a + s.mmr, 0) / Math.max(1, humans.length)),
    players: m.cfg.players.map((p, i) => ({ name: p.name, fighter: p.charId, mmr: m.seats[i]?.mmr ?? 0, bot: p.bot || undefined, uid: m.seats[i]?.user?.profile.id })),
  };
}

export const spectateRoutes: Record<string, Handler> = {
  /** top-rated running public matches */
  'GET /api/live': (_b, u) => {
    const me = need(u).profile.id;
    if (!remoteConfig().flags.liveList) return { matches: [] };
    const list = [...activeMatches.values()].filter((m) => m.mode !== 'private' && !m.finished && m.seats.some((s) => s.user) && canWatch(m, me) && !m.state.over)
      .map(info).sort((a, b) => b.avgMmr - a.avgMmr).slice(0, 20);
    return { matches: list };
  },
  /** which of these players are in a match I may watch (clan / friends lists) */
  'POST /api/live/find': (b, u) => {
    const me = need(u).profile.id;
    const uids: string[] = Array.isArray(b.uids) ? b.uids.slice(0, 60).map(String) : [];
    const out: Record<string, string> = {};
    for (const m of activeMatches.values()) {
      if (!canWatch(m, me) || m.state.over) continue;
      for (const s of m.seats) if (s.user && uids.includes(s.user.profile.id)) out[s.user.profile.id] = m.id;
    }
    return { matches: out };
  },
};
