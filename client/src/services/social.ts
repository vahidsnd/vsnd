import {
  allyBreak, allyRequest, allyRespond, cardDonate, cardRequest, chatHistory, chatPost, clanCreate, clanDonateGems, clanEdit, clanJoin,
  clanKick, clanLeaderboard, clanLeave, clanOf, clanRespond, clanSearch, clanSetRole, clanTouch, clanUpgrade, clanView, collectDonations,
  dmThreads, FIGHTERS, isMuted, matchWars, moderate, newSocialDb, policeView, promoCreate, promoToggle, redeemCode, reportPlayer, setStaff,
  SocialError, warCancel, warReport, warSearch, warTick, warVsBot,
  type ChatMsg, type ClanInput, type ClanMember, type ClanRole, type ClanSummary, type ClanView, type Granted, type ModAction,
  type PoliceView, type Profile, type SocialCtx, type SocialDb, type StaffRole, type Clan,
} from '@nb/shared';
import { backend } from './backend.ts';
import { store } from './platform.ts';
import { net } from '../net/net.ts';

/**
 * Social features (clans, chat, game police, promo codes) behind one interface.
 *  - ServerSocial talks to the real backend (HTTP + websocket pushes).
 *  - DemoSocial runs the very same shared engine locally against a simulated world
 *    (computer-run clans, members and chatter) so the offline test build shows every feature.
 */
export interface SocialService {
  readonly demo: boolean;
  myClan(): Promise<ClanView | null>;
  search(q: string): Promise<ClanSummary[]>;
  view(id: string): Promise<ClanView>;
  create(inp: ClanInput): Promise<ClanView | null>;
  join(id: string): Promise<'joined' | 'requested'>;
  leave(): Promise<void>;
  respond(uid: string, accept: boolean): Promise<ClanView | null>;
  kick(uid: string): Promise<ClanView | null>;
  setRole(uid: string, role: ClanRole): Promise<ClanView | null>;
  edit(inp: Partial<ClanInput>): Promise<ClanView | null>;
  donateGems(amount: number): Promise<ClanView | null>;
  upgrade(): Promise<ClanView | null>;
  requestCards(fighter: string): Promise<ClanView | null>;
  donateCard(reqId: string): Promise<ClanView | null>;
  collectCards(): Promise<number>;
  allyRequest(id: string): Promise<ClanView | null>;
  allyRespond(id: string, accept: boolean): Promise<ClanView | null>;
  allyBreak(id: string): Promise<ClanView | null>;
  warSearch(): Promise<ClanView | null>;
  warCancel(): Promise<ClanView | null>;
  clanLeaderboard(): Promise<(ClanSummary & { pos: number })[]>;
  history(ch: string): Promise<{ msgs: ChatMsg[]; muted: number }>;
  post(ch: string, text: string): Promise<ChatMsg>;
  dms(): Promise<{ id: string; name: string; role: ClanRole; last: ChatMsg | null }[]>;
  report(inp: { target: string; targetName?: string; msgId?: string; reason: string }): Promise<void>;
  police(): Promise<PoliceView & { mutes: { id: string; until: number; name?: string }[]; bans: { id: string; reason: string; name?: string }[] }>;
  act(inp: { action: ModAction; target: string; minutes?: number; msgId?: string; reportId?: string; note?: string }): Promise<void>;
  staff(target: string, role: StaffRole | null): Promise<void>;
  promoCreate(inp: { code: string; reward: unknown; maxUses?: number; days?: number; minLevel?: number; note?: string }): Promise<void>;
  promoToggle(code: string, off: boolean): Promise<void>;
  lookup(id: string): Promise<{ id: string; name: string; level: number; mmr: number; matches: number; muted: number; banned: string | null; warns: number }>;
  redeem(code: string): Promise<Granted>;
  /** is the current player a moderator/admin (shows the police panel) */
  staffRole(): StaffRole | null;
  onChat(fn: (m: ChatMsg) => void): () => void;
  onChange(fn: (kind: string) => void): () => void;
  /** offline matches report war points in the demo world */
  matchPlayed(won: boolean, kos: number): void;
}

// ---- server -------------------------------------------------------------------------------------------
class ServerSocial implements SocialService {
  readonly demo = false;
  private role: StaffRole | null = null;
  private chatL = new Set<(m: ChatMsg) => void>();
  private changeL = new Set<(k: string) => void>();
  constructor() {
    net.on('chat', (m) => this.chatL.forEach((f) => f(m.msg)));
    net.on('social', (m) => this.changeL.forEach((f) => f(m.kind)));
  }
  private api<T = any>(method: string, path: string, body?: unknown) { return backend.api<T>(method, path, body); }
  private async clan(path: string, body?: unknown) {
    const j = await this.api('POST', path, body ?? {});
    if (j.profile) backend.applyServerProfile(j.profile);
    return (j.clan ?? null) as ClanView | null;
  }
  async myClan() { const j = await this.api('GET', '/api/clan/mine'); if (j.profile) backend.applyServerProfile(j.profile); void net.connect(); return j.clan as ClanView | null; }
  async search(q: string) { return (await this.api('POST', '/api/clan/search', { q })).clans; }
  async view(id: string) { return (await this.api('POST', '/api/clan/view', { id })).clan; }
  create(inp: ClanInput) { return this.clan('/api/clan/create', inp); }
  async join(id: string) { const j = await this.api('POST', '/api/clan/join', { id }); if (j.profile) backend.applyServerProfile(j.profile); return j.result; }
  async leave() { await this.clan('/api/clan/leave'); }
  respond(uid: string, accept: boolean) { return this.clan('/api/clan/respond', { uid, accept }); }
  kick(uid: string) { return this.clan('/api/clan/kick', { uid }); }
  setRole(uid: string, role: ClanRole) { return this.clan('/api/clan/role', { uid, role }); }
  edit(inp: Partial<ClanInput>) { return this.clan('/api/clan/edit', inp); }
  donateGems(amount: number) { return this.clan('/api/clan/donate', { amount }); }
  upgrade() { return this.clan('/api/clan/upgrade'); }
  requestCards(fighter: string) { return this.clan('/api/clan/cards/request', { fighter }); }
  donateCard(id: string) { return this.clan('/api/clan/cards/donate', { id }); }
  async collectCards() { const j = await this.api('POST', '/api/clan/cards/collect', {}); if (j.profile) backend.applyServerProfile(j.profile); return j.n as number; }
  allyRequest(id: string) { return this.clan('/api/clan/ally/request', { id }); }
  allyRespond(id: string, accept: boolean) { return this.clan('/api/clan/ally/respond', { id, accept }); }
  allyBreak(id: string) { return this.clan('/api/clan/ally/break', { id }); }
  warSearch() { return this.clan('/api/clan/war/search'); }
  warCancel() { return this.clan('/api/clan/war/cancel'); }
  async clanLeaderboard() { return (await this.api('GET', '/api/clan/leaderboard')).top; }
  history(ch: string) { void net.connect(); return this.api('POST', '/api/chat/history', { ch }); }
  async post(ch: string, text: string) { return (await this.api('POST', '/api/chat/post', { ch, text })).msg; }
  async dms() { return (await this.api('GET', '/api/chat/dms')).threads; }
  async report(inp: { target: string; targetName?: string; msgId?: string; reason: string }) { await this.api('POST', '/api/report', inp); }
  async police() { const v = await this.api('GET', '/api/police'); this.role = v.role; return v; }
  async act(inp: object) { await this.api('POST', '/api/police/act', inp); }
  async staff(target: string, role: StaffRole | null) { await this.api('POST', '/api/police/staff', { target, role }); }
  async promoCreate(inp: object) { await this.api('POST', '/api/police/promo', inp); }
  async promoToggle(code: string, off: boolean) { await this.api('POST', '/api/police/promo/toggle', { code, off }); }
  async lookup(id: string) { return (await this.api('POST', '/api/police/lookup', { id })).user; }
  async redeem(code: string) { const j = await this.api('POST', '/api/redeem', { code }); backend.applyServerProfile(j.profile); return j.granted; }
  staffRole() { return this.role; }
  /** probes the police endpoint once so the menu knows whether to show the panel */
  async probeStaff() { try { await this.police(); } catch { this.role = null; } }
  onChat(fn: (m: ChatMsg) => void) { this.chatL.add(fn); return () => this.chatL.delete(fn); }
  onChange(fn: (k: string) => void) { this.changeL.add(fn); return () => this.changeL.delete(fn); }
  matchPlayed() { /* the server scores wars itself */ }
}

// ---- offline demo world ---------------------------------------------------------------------------------
const DEMO_WAR_MS = 15 * 60_000;
const BOT_NAMES = ['Arash', 'Sara', 'Kian', 'Nika', 'Dariush', 'Mina', 'Reza', 'Shirin', 'Omid', 'Yasmin', 'Babak', 'Leila', 'Farhad', 'Parisa', 'Navid', 'Roya', 'Sina', 'Tara', 'Kaveh', 'Ava', 'Milad', 'Neda', 'Pouya', 'Hana', 'Max', 'Lena', 'Kai', 'Zoe', 'Leo', 'Mia'];
const CLAN_SEEDS: [string, string, string][] = [
  ['Persian Lions', 'شیرهای پارسی', 'LION'], ['Night Owls', 'جغدهای شب', 'OWL'], ['Neon Ronin', 'رونین نئون', 'RONIN'], ['Iron Wolves', 'گرگ‌های آهنین', 'WOLF'],
  ['Crimson Oath', 'پیمان سرخ', 'OATH'], ['Storm Born', 'زادگان طوفان', 'STORM'], ['Golden Simurgh', 'سیمرغ طلایی', 'SIMRG'], ['Ashen Crown', 'تاج خاکستر', 'ASH'],
  ['Frost Giants', 'غول‌های یخ', 'FROST'], ['Shadow Guild', 'انجمن سایه', 'SHADE'],
];
const BOT_LINES = {
  fa: ['کسی پایه‌ی یه دست هست؟', 'GG بچه‌ها', 'این مبارز جدید خیلی قویه', 'جنگ قبیله کِی شروع میشه؟', 'کارت بلیز لازم دارم 🙏', 'امروز سه تا برد پشت هم 🔥', 'لیگ طلایی رسیدم!', 'کی جادوی صاعقه داره؟', 'سلام به همه', 'نقشه رو تموم کردم بالاخره'],
  en: ['anyone up for a match?', 'GG all', 'that new fighter is strong', 'when does the clan war start?', 'need Blaze cards pls', '3 wins in a row today 🔥', 'just hit Gold league!', 'who runs Thunder Strike?', 'hey everyone', 'finally beat the world map'],
};

interface DemoState { db: SocialDb; seeded: boolean; lastTick: number }

class DemoSocial implements SocialService {
  readonly demo = true;
  private st: DemoState;
  private chatL = new Set<(m: ChatMsg) => void>();
  private changeL = new Set<(k: string) => void>();
  private timer: number | null = null;
  private seed = 1;

  constructor() {
    this.st = store.get<DemoState | null>('social', null) ?? { db: newSocialDb(), seeded: false, lastTick: 0 };
    if (!this.st.seeded) this.seedWorld();
    this.st.db.roles[this.me.id] = 'admin'; // the tester can try the police panel
    this.timer = window.setInterval(() => this.tick(), 6000);
  }
  private get me(): Profile { return backend.profile; }
  private rand = () => { this.seed = (this.seed * 16807) % 2147483647; return (this.seed % 100000) / 100000; };
  private ctx(): SocialCtx {
    return { db: this.st.db, now: Date.now(), rand: Math.random, warMs: DEMO_WAR_MS, profileOf: (id) => (id === this.me.id ? this.me : null) };
  }
  private save() { store.set('social', this.st); backend.touch(); }
  private wrap<T>(fn: (c: SocialCtx) => T): Promise<T> {
    try { const c = this.ctx(); clanTouch(c, this.me); const r = fn(c); this.save(); return Promise.resolve(r); } catch (e) {
      return Promise.reject(e instanceof SocialError ? new Error(e.code) : e);
    }
  }
  private viewOf(c: Clan | null) { return c ? clanView(this.st.db, c, this.me.id, (id) => id === this.me.id || this.rand() < 0.4) : null; }
  private mineView() { return this.viewOf(clanOf(this.st.db, this.me.id)); }

  private seedWorld() {
    const db = this.st.db;
    const now = Date.now();
    let n = 0;
    CLAN_SEEDS.forEach(([en, fa, tag], i) => {
      const size = 6 + ((i * 7) % 9);
      const members: ClanMember[] = Array.from({ length: size }, (_, k) => ({
        id: `bot${i}_${k}`, name: BOT_NAMES[(n++) % BOT_NAMES.length] + (k > 9 ? k : ''), role: k === 0 ? 'leader' : k < 3 ? 'co' : k < 6 ? 'elder' : 'member',
        joined: now - k * 86400_000, mmr: 1000 + Math.round(((i * 37 + k * 53) % 900)), level: 3 + ((i + k) % 25), fighter: FIGHTERS[(i + k) % FIGHTERS.length].id,
        donated: (k * 13) % 40, gemsGiven: (k * 70) % 500, warPts: 0, seen: now, bot: true,
      }));
      const clan: Clan = {
        id: `demo${i}`, name: i % 2 ? fa : en, tag, badge: (i * 11) % 64, desc: i % 2 ? 'قبیله فعال، روزانه جنگ می‌کنیم' : 'Active clan, we war every day',
        type: i % 3 === 0 ? 'invite' : 'open', minMmr: i % 4 === 0 ? 1100 : 0, members, level: 1 + (i % 6), bank: (i * 130) % 900, created: now - 40 * 86400_000,
        requests: [], cardReqs: [], allies: [], allyIn: [], allyOut: [], war: null, warLog: [], warWins: (i * 3) % 17, searching: false, log: [], bot: true,
      };
      db.clans[clan.id] = clan;
      for (const m of members) db.userClan[m.id] = clan.id;
    });
    // a couple of alliances and some global chatter
    const a = db.clans.demo0, b = db.clans.demo6;
    a.allies.push(b.id); b.allies.push(a.id);
    for (let i = 0; i < 8; i++) this.botSay('global', i);
    // sample reports so the police panel has something to review
    db.reports.push({ id: 'p_demo1', t: now - 600_000, by: 'bot1_2', byName: db.clans.demo1.members[2].name, target: 'bot3_4', targetName: db.clans.demo3.members[4].name, text: '***** noob', ch: 'global', reason: 'abuse', status: 'open' });
    db.reports.push({ id: 'p_demo2', t: now - 300_000, by: 'bot2_1', byName: db.clans.demo2.members[1].name, target: 'bot5_6', targetName: db.clans.demo5.members[6].name, text: 'buy gems cheap [link]', ch: 'global', reason: 'spam', status: 'open' });
    // promo codes for testing (admins can create more from the police panel)
    const promo = (code: string, reward: object, note: string) => { db.promos[code] = { code, reward, maxUses: 100000, uses: 0, expires: 0, minLevel: 0, created: now, by: 'console', note }; };
    promo('NEON2026', { gems: 200, runes: 150, coins: 3000 }, 'launch gift');
    promo('VSND', { fighters: [FIGHTERS[7]?.id ?? 'zephyr'], anyCards: 20 }, 'fighter gift');
    promo('ARCANE', { runes: 500, spells: ['meteor'] }, 'spell gift');
    this.st.seeded = true;
    store.set('social', this.st);
  }

  private botSay(ch: string, i = Math.floor(Math.random() * 1000), clan?: Clan) {
    const db = this.st.db;
    const pool = clan ? clan.members.filter((m) => m.bot) : Object.values(db.clans).flatMap((c) => c.members);
    if (!pool.length) return;
    const m = pool[i % pool.length];
    const c = clanOf(db, m.id);
    const lines = Math.random() < 0.6 ? BOT_LINES.fa : BOT_LINES.en;
    const msg: ChatMsg = { id: 'b' + Date.now().toString(36) + i, ch, uid: m.id, name: m.name, tag: c?.tag, role: m.role, lvl: m.level, text: lines[i % lines.length], t: Date.now() };
    const list = (db.chats[ch] ??= []);
    list.push(msg); if (list.length > 60) list.splice(0, list.length - 60);
    this.chatL.forEach((f) => f(msg));
  }

  /** simulated world: chatter, bots answering requests, war progress */
  private tick() {
    const db = this.st.db;
    const ctx = this.ctx();
    if (Math.random() < 0.35) this.botSay('global');
    const mine = clanOf(db, this.me.id);
    if (mine) {
      if (Math.random() < 0.25) this.botSay(`clan:${mine.id}`, Math.floor(Math.random() * 1000), mine);
      // bot clans answer alliance proposals
      for (const id of [...mine.allyOut]) {
        const o = db.clans[id];
        if (o?.bot && Math.random() < 0.7) {
          // the bot clan's leader answers through the real engine rules
          const leader = { ...this.me, id: o.members[0].id } as Profile;
          try { allyRespond(ctx, leader, mine.id, true); } catch { o.allyIn = o.allyIn.filter((x) => x !== mine.id); mine.allyOut = mine.allyOut.filter((x) => x !== id); }
          this.changeL.forEach((f) => f('ally'));
        }
      }
      // bot clan mates fill card requests
      for (const r of mine.cardReqs) {
        if (r.uid === this.me.id && r.got < r.need && Math.random() < 0.6) {
          const give = Math.min(r.need - r.got, 1 + Math.floor(Math.random() * 3));
          r.got += give; (r as typeof r & { pending?: number }).pending = ((r as typeof r & { pending?: number }).pending ?? 0) + give;
          this.changeL.forEach((f) => f('clan'));
        }
      }
      // bots ask for cards sometimes
      if (Math.random() < 0.08 && mine.cardReqs.filter((r) => r.uid !== this.me.id && r.got < r.need).length < 3) {
        const m = mine.members.find((x) => x.bot && !mine.cardReqs.some((r) => r.uid === x.id && r.got < r.need));
        if (m) mine.cardReqs.unshift({ id: 'r' + Date.now().toString(36), uid: m.id, name: m.name, fighter: FIGHTERS[Math.floor(Math.random() * 6)].id, need: 10, got: Math.floor(Math.random() * 4), t: Date.now(), donors: {} });
      }
      // bot mates earn war points too
      if (mine.war && Date.now() < mine.war.end) {
        for (const m of mine.members) if (m.bot && Math.random() < 0.18) { const p = 1 + Math.floor(Math.random() * 5); mine.war.pts[m.id] = (mine.war.pts[m.id] ?? 0) + p; m.warPts += p; }
      }
      if (mine.searching) { matchWars(ctx); if (!mine.war) warVsBot(ctx, mine.id); this.changeL.forEach((f) => f('war')); }
      // a stranger occasionally asks to join an invite-only clan we lead
      if (mine.type === 'invite' && Math.random() < 0.05 && mine.requests.length < 4 && mine.members.length < 15) {
        const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
        mine.requests.push({ uid: 'stranger' + Date.now().toString(36), name, mmr: 1000 + Math.floor(Math.random() * 500), level: 2 + Math.floor(Math.random() * 20), t: Date.now() });
      }
    }
    const hadWar = !!mine?.war;
    warTick(ctx);
    if (hadWar && !mine?.war) this.changeL.forEach((f) => f('war'));
    this.st.lastTick = Date.now();
    store.set('social', this.st);
  }

  myClan() { return this.wrap(() => this.mineView()); }
  search(q: string) { return this.wrap((c) => clanSearch(c.db, q)); }
  view(id: string) { return this.wrap((c) => this.viewOf(c.db.clans[id] ?? null) ?? (() => { throw new SocialError('not-found'); })()); }
  create(inp: ClanInput) { return this.wrap((c) => this.viewOf(clanCreate(c, this.me, inp))); }
  join(id: string) {
    return this.wrap((c) => {
      const r = clanJoin(c, this.me, id);
      if (r === 'requested') {
        // bot clans accept quickly in the demo
        setTimeout(() => {
          const cl = this.st.db.clans[id];
          if (!cl || clanOf(this.st.db, this.me.id) || !cl.requests.some((q) => q.uid === this.me.id)) return;
          const leader = { ...this.me, id: cl.members[0].id } as Profile;
          this.st.db.userClan[leader.id] = cl.id;
          try { clanRespond(this.ctx(), leader, this.me.id, true); } catch { /* full */ }
          clanTouch(this.ctx(), this.me);
          this.save(); this.changeL.forEach((f) => f('clan'));
        }, 4000);
      }
      return r;
    });
  }
  leave() { return this.wrap((c) => clanLeave(c, this.me)); }
  respond(uid: string, accept: boolean) {
    return this.wrap((c) => {
      const cl = clanOf(c.db, this.me.id);
      const req = cl?.requests.find((r) => r.uid === uid);
      clanRespond(c, this.me, uid, accept);
      const m = cl?.members.find((x) => x.id === uid);
      if (m && req) { m.bot = true; m.fighter = FIGHTERS[Math.floor(Math.random() * FIGHTERS.length)].id; }
      return this.mineView();
    });
  }
  kick(uid: string) { return this.wrap((c) => { clanKick(c, this.me, uid); return this.mineView(); }); }
  setRole(uid: string, role: ClanRole) { return this.wrap((c) => { clanSetRole(c, this.me, uid, role); return this.mineView(); }); }
  edit(inp: Partial<ClanInput>) { return this.wrap((c) => { clanEdit(c, this.me, inp); return this.mineView(); }); }
  donateGems(amount: number) { return this.wrap((c) => { clanDonateGems(c, this.me, amount); return this.mineView(); }); }
  upgrade() { return this.wrap((c) => { clanUpgrade(c, this.me); return this.mineView(); }); }
  requestCards(fighter: string) { return this.wrap((c) => { cardRequest(c, this.me, fighter); return this.mineView(); }); }
  donateCard(id: string) { return this.wrap((c) => { cardDonate(c, this.me, id); return this.mineView(); }); }
  collectCards() { return this.wrap((c) => collectDonations(c, this.me)); }
  allyRequest(id: string) { return this.wrap((c) => { allyRequest(c, this.me, id); return this.mineView(); }); }
  allyRespond(id: string, accept: boolean) { return this.wrap((c) => { allyRespond(c, this.me, id, accept); return this.mineView(); }); }
  allyBreak(id: string) { return this.wrap((c) => { allyBreak(c, this.me, id); return this.mineView(); }); }
  warSearch() { return this.wrap((c) => { warSearch(c, this.me); return this.mineView(); }); }
  warCancel() { return this.wrap((c) => { warCancel(c, this.me); return this.mineView(); }); }
  clanLeaderboard() { return this.wrap((c) => clanLeaderboard(c.db, 50)); }
  history(ch: string) { return this.wrap((c) => ({ msgs: chatHistory(c.db, this.me.id, ch), muted: isMuted(c.db, this.me.id, c.now) ? c.db.mutes[this.me.id] : 0 })); }
  post(ch: string, text: string) {
    return this.wrap((c) => {
      const out = chatPost(c, this.me, ch, text);
      out.forEach((m) => this.chatL.forEach((f) => f(m)));
      // somebody answers in a lively chat
      if (Math.random() < 0.5) {
        const cl = clanOf(c.db, this.me.id);
        const key = out[0].ch;
        setTimeout(() => {
          if (key === 'global') this.botSay('global');
          else if (key.startsWith('dm:')) {
            const other = key.slice(3).split('|').find((x) => x !== this.me.id)!;
            const m = cl?.members.find((x) => x.id === other);
            if (m?.bot) {
              const msg: ChatMsg = { id: 'b' + Date.now().toString(36), ch: key, uid: m.id, name: m.name, tag: cl!.tag, role: m.role, lvl: m.level, text: Math.random() < 0.5 ? '👍' : 'باشه، بریم یه دست', t: Date.now() };
              (this.st.db.chats[key] ??= []).push(msg); this.chatL.forEach((f) => f(msg));
            }
          } else if (cl) this.botSay(key, Math.floor(Math.random() * 1000), cl);
          store.set('social', this.st);
        }, 1500 + Math.random() * 2500);
      }
      return out[0];
    });
  }
  dms() { return this.wrap((c) => dmThreads(c.db, this.me.id)); }
  report(inp: { target: string; targetName?: string; msgId?: string; reason: string }) { return this.wrap((c) => { reportPlayer(c, this.me, inp); }); }
  police() {
    return this.wrap((c) => {
      const v = policeView(c, this.me);
      const name = (id: string) => Object.values(c.db.clans).flatMap((x) => x.members).find((m) => m.id === id)?.name ?? id;
      return { ...v, mutes: v.mutes.map((m) => ({ ...m, name: name(m.id) })), bans: v.bans.map((b) => ({ ...b, name: name(b.id) })) };
    });
  }
  act(inp: { action: ModAction; target: string; minutes?: number; msgId?: string; reportId?: string; note?: string }) { return this.wrap((c) => moderate(c, this.me, inp)); }
  staff(target: string, role: StaffRole | null) { return this.wrap((c) => setStaff(c, this.me, target, role)); }
  promoCreate(inp: { code: string; reward: unknown; maxUses?: number; days?: number; minLevel?: number; note?: string }) { return this.wrap((c) => { promoCreate(c, this.me, inp); }); }
  promoToggle(code: string, off: boolean) { return this.wrap((c) => { promoToggle(c, this.me, code, off); }); }
  lookup(id: string) {
    return this.wrap((c) => {
      const m = Object.values(c.db.clans).flatMap((x) => x.members).find((x) => x.id === id);
      if (!m && id !== this.me.id) throw new SocialError('not-found');
      const name = m?.name ?? this.me.name;
      return { id, name, level: m?.level ?? this.me.level, mmr: m?.mmr ?? this.me.rank.mmr, matches: 0, muted: c.db.mutes[id] ?? 0, banned: c.db.bans[id] ?? null, warns: c.db.warns[id] ?? 0 };
    });
  }
  redeem(code: string) { return this.wrap((c) => redeemCode(c, this.me, code)); }
  staffRole() { return this.st.db.roles[this.me.id] ?? null; }
  onChat(fn: (m: ChatMsg) => void) { this.chatL.add(fn); return () => this.chatL.delete(fn); }
  onChange(fn: (k: string) => void) { this.changeL.add(fn); return () => this.changeL.delete(fn); }
  matchPlayed(won: boolean, kos: number) {
    const c = this.ctx();
    if (warReport(c, this.me.id, won, kos)) { store.set('social', this.st); this.changeL.forEach((f) => f('war')); }
  }
}

let instance: SocialService | null = null;
/** Picks the server implementation when online, otherwise the offline demo world. */
export function social(): SocialService {
  const wantDemo = !backend.online;
  if (!instance || instance.demo !== wantDemo) {
    instance = wantDemo ? new DemoSocial() : new ServerSocial();
    if (!wantDemo) void (instance as ServerSocial).probeStaff();
  }
  return instance!;
}
