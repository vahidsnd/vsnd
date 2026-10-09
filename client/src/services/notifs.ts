import { Capacitor } from '@capacitor/core';
import { newNotifDb, notifPush, notifRead, notifUnread, scanNotifs, notifText, type Notif, type NotifDb, type NotifInput, type SocialDb } from '@nb/shared';
import { backend } from './backend.ts';
import { store, isNative } from './platform.ts';
import { net } from '../net/net.ts';

/**
 * Notification center behind one interface:
 *  - ServerNotifs: list from the server, live pushes over the websocket, FCM device token
 *    registration through the Capacitor PushNotifications plugin when the build has it.
 *  - DemoNotifs: the offline build generates the same notifications locally (time-based
 *    reminders from the demo world + friend events) and shows system notifications through
 *    LocalNotifications / the test shell bridge / the Web Notification API when available.
 * Every native call is guarded: nothing here may throw when a plugin is missing.
 */
export interface NotifService {
  readonly demo: boolean;
  list(): Notif[];
  unread(): number;
  refresh(): Promise<void>;
  markRead(ids: string[] | 'all'): Promise<void>;
  onChange(fn: () => void): () => void;
  /** a new notification arrived (for toasts / invite prompts) */
  onNew(fn: (n: Notif) => void): () => void;
  /** offline only: add a locally generated notification */
  add(n: NotifInput): Notif | null;
  /** ask for OS notification permission (from a user tap) */
  enableSystem(): Promise<boolean>;
  systemState(): 'on' | 'off' | 'unsupported';
}

const fa = () => backend.profile?.settings.lang !== 'en';
const plugin = (name: string): any => {
  try { return Capacitor.isPluginAvailable(name) ? (Capacitor as any).Plugins?.[name] ?? null : null; } catch { return null; }
};
const bridge = (): { notify?: (t: string, b: string) => void; requestNotifications?: () => void; notificationsEnabled?: () => boolean } | null => {
  try { return (window as any).AndroidBridge ?? null; } catch { return null; }
};

abstract class Base implements NotifService {
  abstract readonly demo: boolean;
  protected items: Notif[] = [];
  protected changeL = new Set<() => void>();
  protected newL = new Set<(n: Notif) => void>();
  list() { return this.items; }
  unread() { return this.items.filter((n) => !n.read).length; }
  onChange(fn: () => void) { this.changeL.add(fn); return () => this.changeL.delete(fn); }
  onNew(fn: (n: Notif) => void) { this.newL.add(fn); return () => this.newL.delete(fn); }
  protected emit(n?: Notif) { this.changeL.forEach((f) => f()); if (n) this.newL.forEach((f) => f(n)); }
  abstract refresh(): Promise<void>;
  abstract markRead(ids: string[] | 'all'): Promise<void>;
  add(_n: NotifInput): Notif | null { return null; }
  async enableSystem(): Promise<boolean> {
    try {
      const ln = plugin('LocalNotifications') ?? plugin('PushNotifications');
      if (ln?.requestPermissions) { const r = await ln.requestPermissions(); return (r?.display ?? r?.receive) === 'granted'; }
      const br = bridge();
      if (br?.requestNotifications) { br.requestNotifications(); store.set('sysNotif', true); return true; }
      if (typeof Notification !== 'undefined') { const r = await Notification.requestPermission(); return r === 'granted'; }
    } catch { /* not available */ }
    return false;
  }
  systemState(): 'on' | 'off' | 'unsupported' {
    try {
      if (plugin('LocalNotifications') || plugin('PushNotifications')) return store.get('sysNotif', false) ? 'on' : 'off';
      const br = bridge();
      if (br?.notify) return br.notificationsEnabled ? (br.notificationsEnabled() ? 'on' : 'off') : store.get('sysNotif', false) ? 'on' : 'off';
      if (typeof Notification !== 'undefined') return Notification.permission === 'granted' ? 'on' : 'off';
    } catch { /* ignore */ }
    return 'unsupported';
  }
}

// ---- server ---------------------------------------------------------------------------------------------
class ServerNotifs extends Base {
  readonly demo = false;
  private unreadN = 0;
  constructor() {
    super();
    net.on('notif', (m) => {
      this.items = [m.notif, ...this.items.filter((x) => x.id !== m.notif.id)].slice(0, 60);
      this.unreadN = m.unread;
      this.emit(m.notif);
    });
    void this.refresh();
    void this.registerPush();
  }
  unread() { return Math.max(this.unreadN, super.unread()); }
  async refresh() {
    try {
      const j = await backend.api<{ list: Notif[]; unread: number }>('GET', '/api/notifs');
      this.items = j.list; this.unreadN = j.unread; this.emit();
    } catch { /* offline for a moment */ }
  }
  async markRead(ids: string[] | 'all') {
    for (const n of this.items) if (ids === 'all' || ids.includes(n.id)) n.read = true;
    this.unreadN = this.items.filter((n) => !n.read).length;
    this.emit();
    try { const j = await backend.api<{ unread: number }>('POST', '/api/notifs/read', { ids }); this.unreadN = j.unread; this.emit(); } catch { /* retried on next refresh */ }
  }
  /** FCM device token via @capacitor/push-notifications when the native build includes it. */
  private async registerPush() {
    const P = plugin('PushNotifications');
    if (!P || !isNative) return;
    try {
      await P.addListener('registration', (t: { value: string }) => { void backend.api('POST', '/api/push/register', { token: t.value, platform: 'android' }).catch(() => {}); });
      await P.addListener('pushNotificationActionPerformed', () => { (window as any).nbOpenNotifs?.(); });
      const perm = await P.checkPermissions?.();
      if (perm?.receive === 'granted' || store.get('sysNotif', false)) await P.register();
    } catch { /* plugin present but failed: ignore */ }
  }
  async enableSystem() {
    const ok = await super.enableSystem();
    if (ok) { store.set('sysNotif', true); try { await plugin('PushNotifications')?.register?.(); } catch { /* ignore */ } }
    return ok;
  }
}

// ---- offline demo -----------------------------------------------------------------------------------------
class DemoNotifs extends Base {
  readonly demo = true;
  private db: NotifDb = store.get<NotifDb | null>('notifs', null) ?? newNotifDb();
  private nid = 1;
  constructor() {
    super();
    this.items = this.db.inbox[this.me] ?? [];
    setTimeout(() => this.scan(), 1500);
    window.setInterval(() => this.scan(), 15_000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.scan(); });
  }
  private get me() { return backend.profile?.id ?? 'local'; }
  private save() { store.set('notifs', this.db); this.items = this.db.inbox[this.me] ?? []; }
  async refresh() { this.scan(); }
  /** reminders from the demo world: clan attacks, wars, weekly league, free crate */
  private scan() {
    try {
      const social = store.get<{ db: SocialDb } | null>('social', null)?.db ?? null;
      const made = scanNotifs({ db: this.db, now: Date.now(), social, profiles: [backend.profile] });
      if (!made.length) return;
      this.save();
      for (const m of made) { this.system(m.notif); this.emit(m.notif); }
    } catch (e) { console.warn('notif scan', e); }
  }
  add(n: NotifInput) {
    const out = notifPush(this.db, this.me, n, Date.now());
    if (!out) return null;
    this.save();
    this.system(out);
    this.emit(out);
    return out;
  }
  async markRead(ids: string[] | 'all') { notifRead(this.db, this.me, ids); this.save(); this.emit(); }
  unread() { return notifUnread(this.db, this.me); }
  async enableSystem() { const ok = await super.enableSystem(); if (ok) store.set('sysNotif', true); return ok; }
  /** OS notification while the game is in the background (in-app toasts cover the foreground). */
  private system(n: Notif) {
    if (!document.hidden) return;
    const { title, body } = notifText(n, fa());
    try {
      const ln = plugin('LocalNotifications');
      if (ln?.schedule) { void ln.schedule({ notifications: [{ id: (this.nid++ % 100000) + 1, title, body }] }).catch(() => {}); return; }
      const br = bridge();
      if (br?.notify) { br.notify(title, body); return; }
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(title, { body, tag: n.id });
    } catch { /* unavailable */ }
  }
}

let instance: NotifService | null = null;
export function notifs(): NotifService {
  const wantDemo = !backend.online;
  if (!instance || instance.demo !== wantDemo) instance = wantDemo ? new DemoNotifs() : new ServerNotifs();
  return instance;
}
