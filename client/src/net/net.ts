import { PROTOCOL_VERSION, type ClientMsg, type ServerMsg } from '@nb/shared';
import { backend } from '../services/backend.ts';
import { serverWs } from '../services/platform.ts';

type Handler<T extends ServerMsg['t']> = (m: Extract<ServerMsg, { t: T }>) => void;

class Net {
  ws: WebSocket | null = null;
  ready = false;
  online = 0;
  ping = 0;
  private handlers = new Map<string, Set<(m: any) => void>>();
  private connecting: Promise<boolean> | null = null;
  private pingTimer: number | null = null;
  private wanted = false;

  on<T extends ServerMsg['t']>(t: T, fn: Handler<T>): () => void {
    let s = this.handlers.get(t);
    if (!s) { s = new Set(); this.handlers.set(t, s); }
    s.add(fn);
    return () => s!.delete(fn);
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  connect(): Promise<boolean> {
    this.wanted = true;
    if (this.ready) return Promise.resolve(true);
    if (this.connecting) return this.connecting;
    if (!backend.online) return Promise.resolve(false);
    this.connecting = new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (ok: boolean) => { if (!done) { done = true; this.connecting = null; resolve(ok); } };
      const ws = new WebSocket(serverWs());
      this.ws = ws;
      const to = setTimeout(() => { ws.close(); finish(false); }, 8000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token: backend.token, v: PROTOCOL_VERSION } satisfies ClientMsg));
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data) as ServerMsg;
        if (m.t === 'welcome') {
          clearTimeout(to);
          this.ready = true; this.online = m.online;
          backend.applyServerProfile(m.profile);
          this.startPing();
          finish(true);
        }
        if (m.t === 'profile') backend.applyServerProfile(m.profile);
        if (m.t === 'pong') this.ping = this.ping ? this.ping * 0.8 + (performance.now() - m.ts) * 0.2 : performance.now() - m.ts;
        this.handlers.get(m.t)?.forEach((h) => h(m));
      };
      ws.onclose = () => {
        clearTimeout(to);
        this.ready = false; this.ws = null;
        if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
        this.handlers.get('close')?.forEach((h) => h({}));
        finish(false);
        if (this.wanted) setTimeout(() => { if (this.wanted && !this.ready) this.connect(); }, 2000);
      };
      ws.onerror = () => { /* onclose follows */ };
    });
    return this.connecting;
  }

  private startPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    const p = () => this.send({ t: 'ping', ts: performance.now() });
    p();
    this.pingTimer = window.setInterval(p, 2000);
  }

  disconnect() { this.wanted = false; this.ws?.close(); }
}

export const net = new Net();
