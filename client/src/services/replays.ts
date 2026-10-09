import { decodeReplay, encodeReplay, remoteConfig, ReplayRecorder, type GameState, type ReplayData, type ReplayMeta } from '@nb/shared';
import { backend } from './backend.ts';

/** A replay kept on this device (newest first, MAX_LOCAL kept, size-guarded). */
export interface StoredReplay {
  id: string; at: number; mode: string; slot: number; frames: number; winnerTeam: number;
  players: { name: string; fighter: string; skin: number; team: number; bot?: boolean }[];
  source: 'local' | 'online' | 'import';
  code: string;
}
/** Index row from the server's per-player list (code fetched on demand). */
export interface ServerReplay { id: string; at: number; mode: string; frames: number; winnerTeam: number; slot: number; players: { name: string; fighter: string; team: number; bot?: boolean }[] }

export const MAX_LOCAL = 15;
/** total bytes of codes kept on the device */
export const MAX_LOCAL_BYTES = 1_500_000;
const LS_KEY = 'nb.replays';

// ---- storage: IndexedDB (one record holding the list), localStorage fallback ------------------
let dbp: Promise<IDBDatabase | null> | null = null;
function idb(): Promise<IDBDatabase | null> {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open('neonbrawl', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}
async function readAll(): Promise<StoredReplay[]> {
  const db = await idb();
  if (db) {
    const v = await new Promise<StoredReplay[] | undefined>((res) => {
      try {
        const r = db.transaction('kv').objectStore('kv').get('replays');
        r.onsuccess = () => res(r.result as StoredReplay[] | undefined);
        r.onerror = () => res(undefined);
      } catch { res(undefined); }
    });
    if (v) return v;
  }
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}
async function writeAll(list: StoredReplay[]) {
  const db = await idb();
  if (db) {
    const ok = await new Promise<boolean>((res) => {
      try {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(list, 'replays');
        tx.oncomplete = () => res(true);
        tx.onerror = () => res(false);
        tx.onabort = () => res(false);
      } catch { res(false); }
    });
    if (ok) { try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ } return; }
  }
  // fallback: localStorage, dropping the oldest until it fits
  const l = list.slice();
  while (l.length) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(l)); return; } catch { l.pop(); }
  }
}

/** keeps the newest MAX_LOCAL replays and at most MAX_LOCAL_BYTES of codes */
export function trimReplays(list: StoredReplay[]): StoredReplay[] {
  const out: StoredReplay[] = [];
  let bytes = 0;
  for (const r of list.sort((a, b) => b.at - a.at)) {
    if (out.length >= MAX_LOCAL) break;
    if (bytes + r.code.length > MAX_LOCAL_BYTES) continue;
    bytes += r.code.length;
    out.push(r);
  }
  return out;
}

let cache: StoredReplay[] | null = null;
let chain: Promise<unknown> = Promise.resolve();
export async function listReplays(): Promise<StoredReplay[]> {
  if (!cache) cache = await readAll();
  return cache.slice();
}
export async function getReplay(id: string): Promise<StoredReplay | null> {
  return (await listReplays()).find((r) => r.id === id) ?? null;
}
export function saveReplay(r: StoredReplay) {
  chain = chain.then(async () => {
    const list = (await listReplays()).filter((x) => x.id !== r.id);
    cache = trimReplays([r, ...list]);
    await writeAll(cache);
  });
  return chain;
}
export function deleteReplay(id: string) {
  chain = chain.then(async () => {
    cache = (await listReplays()).filter((x) => x.id !== id);
    await writeAll(cache);
  });
  return chain;
}

export function toStored(data: ReplayData, code: string, source: StoredReplay['source'], slot = data.meta.slot): StoredReplay {
  const m = data.meta;
  return {
    id: m.id, at: m.at, mode: m.mode, slot, frames: m.frames, winnerTeam: m.winnerTeam, source, code,
    players: data.cfg.players.map((p, i) => ({ name: p.name, fighter: p.charId, skin: p.skin, team: data.cfg.teams ? p.team : i, bot: p.bot || undefined })),
  };
}

// ---- recording -----------------------------------------------------------------------------------
export function replaysEnabled() { return remoteConfig().flags.replays; }

export function newRecorder(state: GameState): ReplayRecorder | undefined {
  // only fresh matches (frame 0) can be replayed from their config
  return replaysEnabled() && state.frame === 0 ? new ReplayRecorder(state.cfg) : undefined;
}

/** Finishes a local recording and stores it; returns the stored entry (sync, saving runs behind). */
export function storeLocal(rec: ReplayRecorder | undefined, state: GameState, mode: string, slot = 0): StoredReplay | undefined {
  if (!rec || !rec.frames) return undefined;
  const meta: Omit<ReplayMeta, 'frames'> = {
    id: 'L' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), at: Date.now(), mode, slot,
    winnerTeam: state.winnerTeam, placements: [],
  };
  const data = rec.build(meta);
  const st = toStored(data, encodeReplay(data), 'local', slot);
  void saveReplay(st);
  return st;
}

/** An online match's replay from the server's 'end' message. */
export function storeOnline(code: string | undefined, slot: number): StoredReplay | undefined {
  if (!code || !replaysEnabled()) return undefined;
  try {
    const st = toStored(decodeReplay(code), code, 'online', slot);
    void saveReplay(st);
    return st;
  } catch { return undefined; }
}

/** Imports a shared code / file; returns the stored entry. */
export async function importReplay(text: string): Promise<StoredReplay> {
  const data = decodeReplay(text);
  const code = encodeReplay(data);
  const st = toStored(data, code, 'import', data.meta.slot >= 0 ? data.meta.slot : 0);
  st.id = 'I' + data.meta.id;
  await saveReplay(st);
  return st;
}

// ---- server list (online players: last 50 of their online matches) --------------------------------
export async function serverReplays(): Promise<ServerReplay[]> {
  if (!backend.online) return [];
  return (await backend.api<{ replays: ServerReplay[] }>('GET', '/api/replays')).replays;
}
export async function serverReplayCode(id: string): Promise<string> {
  return (await backend.api<{ code: string }>('POST', '/api/replay/get', { id })).code;
}
