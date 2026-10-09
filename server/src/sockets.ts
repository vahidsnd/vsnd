import type { WebSocket } from 'ws';
import { clanOf, type ChatMsg, type ServerMsg } from '@nb/shared';
import { socialDb } from './db.ts';

/** One live socket per user (a new login replaces the old one). */
export const socketsByUser = new Map<string, WebSocket>();

export function sendTo(userId: string, msg: ServerMsg) {
  const ws = socketsByUser.get(userId);
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

/** Pushes chat messages to everyone allowed to read their channel. */
export function deliverChat(msgs: ChatMsg[]) {
  const db = socialDb();
  for (const m of msgs) {
    const payload: ServerMsg = { t: 'chat', msg: m };
    if (m.ch === 'global') {
      const data = JSON.stringify(payload);
      for (const ws of socketsByUser.values()) if (ws.readyState === 1) ws.send(data);
    } else if (m.ch.startsWith('clan:') || m.ch.startsWith('ally:')) {
      const c = db.clans[m.ch.slice(5)];
      for (const mem of c?.members ?? []) sendTo(mem.id, payload);
    } else if (m.ch.startsWith('dm:')) {
      for (const id of m.ch.slice(3).split('|')) sendTo(id, payload);
    }
  }
}

export function notifyClan(clanId: string, kind: string) {
  const c = socialDb().clans[clanId];
  for (const m of c?.members ?? []) sendTo(m.id, { t: 'social', kind });
}
export function isOnline(userId: string) { return socketsByUser.has(userId); }
export { clanOf };
