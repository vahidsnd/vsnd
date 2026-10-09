import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { PROTOCOL_VERSION, featureUnlocked, leagueBreak, type ClientMsg } from '@nb/shared';
import { config } from './config.ts';
import { loadDb, userByToken, type UserRec } from './db.ts';
import { handleApi } from './api.ts';
import { socketsByUser } from './sockets.ts';
import { socialTick } from './social.ts';
import { presenceOffline, presenceOnline, startAccountsTick } from './accounts.ts';
import { activeMatches, matchByUser, send } from './match.ts';
import { serveAdminPage } from './admin.ts';
import { spectate, spectatorCount, stopSpectating } from './spectate.ts';
import { dequeue, enqueue, inMatch, matchmakeTick, queuedCount, roomCreate, roomJoin, roomLeave, roomStart, roomUpdate } from './matchmaker.ts';

await loadDb();

// Serves the built web client (client/dist) when present so one process can host everything.
const staticDir = path.resolve(new URL('../../client/dist', import.meta.url).pathname);
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

const server = http.createServer(async (req, res) => {
  if (await handleApi(req, res)) return;
  if (serveAdminPage(req, res)) return;
  const url = new URL(req.url ?? '/', 'http://x');
  let file = path.join(staticDir, decodeURIComponent(url.pathname));
  if (!file.startsWith(staticDir)) { res.writeHead(403).end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(staticDir, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404).end('client not built'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  let user: UserRec | null = null;
  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg.t === 'ping') return send(ws, { t: 'pong', ts: msg.ts });
    if (msg.t === 'hello') {
      if (msg.v !== PROTOCOL_VERSION) return send(ws, { t: 'error', msg: 'update-required' });
      user = userByToken(msg.token);
      if (!user) return send(ws, { t: 'error', msg: 'auth' });
      const old = socketsByUser.get(user.profile.id);
      if (old && old !== ws) old.close(4000, 'replaced');
      socketsByUser.set(user.profile.id, ws);
      presenceOnline(user.profile.id);
      send(ws, { t: 'welcome', profile: user.profile, online: socketsByUser.size });
      inMatch(user)?.reconnect(user, ws);
      return;
    }
    if (!user) return;
    switch (msg.t) {
      case 'in': matchByUser.get(user.profile.id)?.onInput(user, msg.s, msg.b); break;
      case 'queue':
        if (inMatch(user)) return;
        if (!config.unlockAll && !featureUnlocked(user.profile, msg.mode === 'ranked' ? 'ranked' : 'online')) return send(ws, { t: 'error', msg: 'locked' });
        if (msg.mode === 'ranked' && leagueBreak(Date.now())) return send(ws, { t: 'error', msg: 'league-break' });
        enqueue({ user, ws, mode: msg.mode === 'ranked' ? 'ranked' : 'casual', format: ['1v1', '2v2', 'ffa'].includes(msg.format) ? msg.format : '1v1', fighter: String(msg.fighter), skin: Number(msg.skin) | 0 });
        break;
      case 'cancel': dequeue(user); break;
      case 'forfeit': matchByUser.get(user.profile.id)?.forfeit(user); break;
      case 'emote': matchByUser.get(user.profile.id)?.emote(user, msg.id); break;
      case 'room_create': if (!config.unlockAll && !featureUnlocked(user.profile, 'friends')) return send(ws, { t: 'error', msg: 'locked' }); roomCreate(user, ws, String(msg.fighter), Number(msg.skin) | 0); break;
      case 'room_join': if (!config.unlockAll && !featureUnlocked(user.profile, 'friends')) return send(ws, { t: 'error', msg: 'locked' }); roomJoin(user, ws, String(msg.code), String(msg.fighter), Number(msg.skin) | 0); break;
      case 'room_update': roomUpdate(user, msg); break;
      case 'room_start': roomStart(user); break;
      case 'room_leave': roomLeave(user); break;
      case 'spectate': spectate(user, ws, String(msg.matchId)); break;
      case 'spectate_stop': stopSpectating(ws); break;
    }
  });
  ws.on('close', () => {
    stopSpectating(ws);
    if (!user) return;
    if (socketsByUser.get(user.profile.id) === ws) { socketsByUser.delete(user.profile.id); presenceOffline(user.profile.id); }
    dequeue(user);
    roomLeave(user);
    matchByUser.get(user.profile.id)?.disconnect(user);
  });
});

setInterval(matchmakeTick, 1000).unref();
setInterval(socialTick, 30_000).unref();
startAccountsTick();
setInterval(() => {
  console.log(`[stats] online=${socketsByUser.size} queued=${queuedCount()} matches=${activeMatches.size} spectators=${spectatorCount()}`);
}, 60_000).unref();

server.listen(config.port, () => console.log(`Neon Brawl server on :${config.port} (iapSandbox=${config.iapSandbox})`));
