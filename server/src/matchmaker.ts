import type { WebSocket } from 'ws';
import { createBrain, FIGHTERS, STAGES, SPELLS, fighterMods, type MatchConfig, type QueueFormat, type QueueMode, type RoomInfo } from '@nb/shared';
import { config } from './config.ts';
import type { UserRec } from './db.ts';
import { Match, matchByUser, send, type Seat } from './match.ts';

interface Ticket { user: UserRec; ws: WebSocket; mode: QueueMode; format: QueueFormat; fighter: string; skin: number; since: number; mmr: number }

const queues = new Map<string, Ticket[]>();
const BOT_NAMES = ['Nova', 'Raptor', 'Sable', 'Kiwi', 'Echo', 'Tofu', 'Rook', 'Mango', 'Pixel', 'Orbit', 'Dash', 'Saffron'];
const SIZE: Record<QueueFormat, number> = { '1v1': 2, '2v2': 4, ffa: 4 };

export function enqueue(t: Omit<Ticket, 'since' | 'mmr'>) {
  dequeue(t.user);
  const key = `${t.mode}:${t.format}`;
  const list = queues.get(key) ?? [];
  list.push({ ...t, since: Date.now(), mmr: t.user.profile.rank.mmr });
  queues.set(key, list);
  send(t.ws, { t: 'queued', mode: t.mode, format: t.format, players: list.length });
}

export function dequeue(user: UserRec) {
  for (const list of queues.values()) {
    const i = list.findIndex((x) => x.user === user);
    if (i >= 0) list.splice(i, 1);
  }
}

export function queuedCount() {
  let n = 0;
  for (const l of queues.values()) n += l.length;
  return n;
}

function ownedOrDefault(u: UserRec, fighter: string, skin: number) {
  const p = u.profile;
  const f = p.fighters.includes(fighter) ? fighter : p.fighters[0];
  const def = FIGHTERS.find((x) => x.id === f)!;
  const sk = skin === 0 || p.skins.includes(def.skins[skin]?.id) ? skin : 0;
  return { f, sk };
}

function botSeat(mmr: number): Seat {
  const level = Math.max(2, Math.min(9, Math.round((mmr - 700) / 150)));
  return { user: null, ws: null, bot: createBrain(level), queue: [], nextSeq: 0, lastBits: 0, ack: 0, dcAt: 0, mmr };
}

function humanSeat(t: { user: UserRec; ws: WebSocket }): Seat {
  return { user: t.user, ws: t.ws, bot: null, queue: [], nextSeq: 0, lastBits: 0, ack: 0, dcAt: 0, mmr: t.user.profile.rank.mmr };
}

function randomStage(_unlockLevel = 99) {
  return STAGES[Math.floor(Math.random() * STAGES.length)].id;
}

function botMods() {
  return { atk: 1, def: 1, hp: 1, spell: SPELLS[Math.floor(Math.random() * SPELLS.length)].id, spellLv: 1 };
}

function launch(mode: QueueMode, format: QueueFormat, group: Ticket[]) {
  const size = SIZE[format];
  const teams = format === '2v2';
  const avgMmr = group.reduce((a, t) => a + t.mmr, 0) / group.length;
  const seats: Seat[] = group.map(humanSeat);
  const players: MatchConfig['players'] = group.map((t, i) => {
    const { f, sk } = ownedOrDefault(t.user, t.fighter, t.skin);
    return { charId: f, skin: sk, team: teams ? i % 2 : i, name: t.user.profile.name, mods: fighterMods(t.user.profile, f) };
  });
  while (seats.length < size) {
    const i = seats.length;
    seats.push(botSeat(avgMmr));
    const def = FIGHTERS[Math.floor(Math.random() * FIGHTERS.length)];
    players.push({ charId: def.id, skin: Math.floor(Math.random() * 3), team: teams ? i % 2 : i, name: BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)], bot: true, mods: botMods() });
  }
  const minLevel = Math.min(...group.map((t) => t.user.profile.level));
  const cfg: MatchConfig = { stageId: randomStage(minLevel), stocks: format === '1v1' ? 3 : 2, timeLimit: format === '1v1' ? 300 : 240, teams, players };
  new Match(mode, cfg, seats).start();
}

/** Called every second: group tickets by rating window, fill with bots after a wait. */
export function matchmakeTick() {
  const now = Date.now();
  for (const [key, list] of queues) {
    const [mode, format] = key.split(':') as [QueueMode, QueueFormat];
    const size = SIZE[format];
    list.sort((a, b) => a.since - b.since);
    // drop closed sockets
    for (let i = list.length - 1; i >= 0; i--) if (list[i].ws.readyState !== 1) list.splice(i, 1);
    while (list.length) {
      const anchor = list[0];
      const waited = (now - anchor.since) / 1000;
      const window = mode === 'ranked' ? config.matchmaking.mmrWindowStart + waited * config.matchmaking.mmrWindowGrowPerSec : Infinity;
      const group = [anchor, ...list.slice(1).filter((t) => Math.abs(t.mmr - anchor.mmr) <= window)].slice(0, size);
      const fillAfter = config.matchmaking.botFillAfterMs[mode];
      if (group.length === size || now - anchor.since > fillAfter) {
        for (const t of group) list.splice(list.indexOf(t), 1);
        launch(mode, format, group);
      } else break;
    }
  }
}

// ---- private rooms ---------------------------------------------------------------------------
interface RoomMember { user: UserRec; ws: WebSocket; fighter: string; skin: number; team: number }
interface Room { code: string; host: UserRec; members: RoomMember[]; stage: string; stocks: number; teams: boolean; bots: number }
const rooms = new Map<string, Room>();
const roomByUser = new Map<string, Room>();

function roomInfo(r: Room): RoomInfo {
  return {
    code: r.code, stage: r.stage, stocks: r.stocks, teams: r.teams, bots: r.bots,
    players: r.members.map((m) => ({ name: m.user.profile.name, fighter: m.fighter, skin: m.skin, team: m.team, host: m.user === r.host })),
  };
}
function pushRoom(r: Room) { for (const m of r.members) send(m.ws, { t: 'room', room: roomInfo(r) }); }

export function roomCreate(user: UserRec, ws: WebSocket, fighter: string, skin: number) {
  roomLeave(user);
  let code = '';
  do { code = Math.random().toString(36).slice(2, 7).toUpperCase(); } while (rooms.has(code));
  const { f, sk } = ownedOrDefault(user, fighter, skin);
  const r: Room = { code, host: user, members: [{ user, ws, fighter: f, skin: sk, team: 0 }], stage: 'rooftop', stocks: 3, teams: false, bots: 0 };
  rooms.set(code, r);
  roomByUser.set(user.profile.id, r);
  pushRoom(r);
}

export function roomJoin(user: UserRec, ws: WebSocket, code: string, fighter: string, skin: number) {
  const r = rooms.get(String(code).toUpperCase());
  if (!r) return send(ws, { t: 'error', msg: 'room-not-found' });
  if (r.members.length + r.bots >= 4) return send(ws, { t: 'error', msg: 'room-full' });
  roomLeave(user);
  const { f, sk } = ownedOrDefault(user, fighter, skin);
  r.members.push({ user, ws, fighter: f, skin: sk, team: r.members.length % 2 });
  roomByUser.set(user.profile.id, r);
  pushRoom(r);
}

export function roomUpdate(user: UserRec, u: { fighter?: string; skin?: number; team?: number; stage?: string; stocks?: number; teams?: boolean; bots?: number }) {
  const r = roomByUser.get(user.profile.id);
  if (!r) return;
  const m = r.members.find((x) => x.user === user)!;
  if (u.fighter !== undefined || u.skin !== undefined) {
    const { f, sk } = ownedOrDefault(user, u.fighter ?? m.fighter, u.skin ?? m.skin);
    m.fighter = f; m.skin = sk;
  }
  if (u.team === 0 || u.team === 1) m.team = u.team;
  if (r.host === user) {
    if (u.stage && STAGES.some((s) => s.id === u.stage)) r.stage = u.stage;
    if (u.stocks && u.stocks >= 1 && u.stocks <= 5) r.stocks = Math.round(u.stocks);
    if (typeof u.teams === 'boolean') r.teams = u.teams;
    if (u.bots !== undefined) r.bots = Math.max(0, Math.min(4 - r.members.length, Math.round(u.bots)));
  }
  pushRoom(r);
}

export function roomStart(user: UserRec) {
  const r = roomByUser.get(user.profile.id);
  if (!r || r.host !== user) return;
  if (r.members.length + r.bots < 2) return send(r.members[0].ws, { t: 'error', msg: 'need-2-players' });
  const seats: Seat[] = r.members.map(humanSeat);
  const players: MatchConfig['players'] = r.members.map((m, i) => ({ charId: m.fighter, skin: m.skin, team: r.teams ? m.team : i, name: m.user.profile.name, mods: fighterMods(m.user.profile, m.fighter) }));
  for (let b = 0; b < r.bots; b++) {
    const i = seats.length;
    seats.push(botSeat(1100));
    const def = FIGHTERS[Math.floor(Math.random() * FIGHTERS.length)];
    players.push({ charId: def.id, skin: 0, team: r.teams ? i % 2 : i, name: 'CPU ' + (b + 1), bot: true, mods: botMods() });
  }
  const cfg: MatchConfig = { stageId: r.stage, stocks: r.stocks, timeLimit: 0, teams: r.teams, players };
  for (const m of r.members) roomByUser.delete(m.user.profile.id);
  rooms.delete(r.code);
  for (const m of r.members) send(m.ws, { t: 'room', room: null });
  new Match('private', cfg, seats).start();
}

export function roomLeave(user: UserRec) {
  const r = roomByUser.get(user.profile.id);
  if (!r) return;
  roomByUser.delete(user.profile.id);
  const leaving = r.members.find((m) => m.user === user);
  r.members = r.members.filter((m) => m.user !== user);
  if (leaving) send(leaving.ws, { t: 'room', room: null });
  if (!r.members.length) { rooms.delete(r.code); return; }
  if (r.host === user) r.host = r.members[0].user;
  pushRoom(r);
}

export function inMatch(user: UserRec) { return matchByUser.get(user.profile.id); }
