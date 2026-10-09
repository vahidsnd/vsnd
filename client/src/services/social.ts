import {
  allyBreak, allyRequest, allyRespond, cardDonate, cardRequest, chatHistory, chatPost, clanCreate, clanDonateGems, clanEdit, clanJoin,
  clanKick, clanLeaderboard, clanLeave, clanOf, clanRespond, clanSearch, clanSetRole, clanTouch, clanUpgrade, clanView, collectDonations,
  dmThreads, FIGHTERS, isMuted, matchWars, moderate, newSocialDb, policeView, promoCreate, promoToggle, redeemCode, reportPlayer, setStaff,
  SocialError, warCancel, warReport, warSearch, warTick, warVsBot,
  type ChatMsg, type ClanInput, type ClanMember, type ClanRole, type ClanSummary, type ClanView, type Granted, type ModAction,
  type PoliceView, type Profile, type SocialCtx, type SocialDb, type StaffRole, type Clan,
  raidDeclare, raidFightEnd, raidFightStart, raidFortify, raidHelp, raidSetLineup, raidTargets, raidTick, raidView, raidWithdraw, raidState, raidOf, RAID,
  allianceLeaderboard, weekId, weekWindow, weekStats, rankWeek, demoRivals, awardWeek,
  type Raid, type RaidFight, type RaidView, type FightResult, type WeekEntry, type WeekStats,
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
  // ---- clan attacks ----
  raid(): Promise<RaidView>;
  raidTargets(q: string): Promise<RaidTarget[]>;
  raidDeclare(target: string, start: number): Promise<Raid>;
  raidWithdraw(): Promise<void>;
  raidLineup(raid: string, uids: string[]): Promise<void>;
  raidFortify(raid: string): Promise<void>;
  raidHelp(raid: string): Promise<void>;
  raidFight(raid: string, slot: number): Promise<RaidFight>;
  raidReport(fight: string, res: FightResult): Promise<{ stars: number; raid: Raid }>;
  /** lead time / length (the demo's test mode shortens them) */
  raidTiming(): { minLead: number; duration: number; fast: boolean };
  // ---- leaderboards & weekly league ----
  allianceLeaderboard(): Promise<AllianceRow[]>;
  winsLeaderboard(): Promise<{ pos: number; id: string; name: string; wins: number; mmr: number; fighter: string; trophies: number }[]>;
  weekStandings(): Promise<{ week: number; tier: number; top: WeekEntry[]; myPos: number; me: WeekStats }>;
}
export type RaidTarget = { id: string; name: string; tag: string; badge: number; level: number; members: number; power: number; trophies: number; fee: number; block: string | null };
export type AllianceRow = ReturnType<typeof allianceLeaderboard>[number];

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
  async raid() { return (await this.api('GET', '/api/raid')).raid; }
  async raidTargets(q: string) { return (await this.api('POST', '/api/raid/targets', { q })).targets; }
  async raidDeclare(target: string, start: number) { return (await this.api('POST', '/api/raid/declare', { target, start })).raid; }
  async raidWithdraw() { await this.api('POST', '/api/raid/withdraw', {}); }
  async raidLineup(raid: string, uids: string[]) { await this.api('POST', '/api/raid/lineup', { raid, uids }); }
  async raidFortify(raid: string) { await this.api('POST', '/api/raid/fortify', { raid }); }
  async raidHelp(raid: string) { await this.api('POST', '/api/raid/help', { raid }); }
  async raidFight(raid: string, slot: number) { return (await this.api('POST', '/api/raid/fight', { raid, slot })).fight; }
  async raidReport(fight: string, res: FightResult) { return this.api('POST', '/api/raid/report', { fight, ...res }); }
  raidTiming() { return { minLead: RAID.minLead, duration: RAID.duration, fast: false }; }
  async allianceLeaderboard() { return (await this.api('GET', '/api/alliance/leaderboard')).top; }
  async winsLeaderboard() { return (await this.api('GET', '/api/leaderboard/wins')).top; }
  async weekStandings() { return this.api('GET', '/api/league/week'); }
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

interface DemoState { db: SocialDb; seeded: boolean; lastTick: number; weeksDone?: number[] }

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
    // sample anti-cheat cases so the police panel shows what flagged players look like
    if (!this.st.db.cheats) {
      const n = Date.now(), c3 = this.st.db.clans.demo3?.members[2], c7 = this.st.db.clans.demo7?.members[5];
      this.st.db.cheats = {};
      if (c3) this.st.db.cheats[c3.id] = { score: 12, at: n, name: c3.name, reported: true, flags: [
        { t: n - 900_000, kind: 'offline', detail: 'win in 6s; 9 KOs > possible 3', pts: 8 }, { t: n - 400_000, kind: 'raid', detail: 'claimed 240s in 31s, dmg 410', pts: 4 }] };
      if (c7) this.st.db.cheats[c7.id] = { score: 3, at: n, name: c7.name, flags: [{ t: n - 2000_000, kind: 'speed', detail: 'input seq jumped 300 frames', pts: 3 }] };
    }
    this.timer = window.setInterval(() => this.tick(), 6000);
    this.settleWeeks();
  }

  /** Pays the tester's weekly league podium against the computer bracket once a week ends. */
  private settleWeeks() {
    const p = this.me, w = p.lweek;
    const done = (this.st.weeksDone ??= []);
    if (!w || w.id >= weekId(Date.now()) || done.includes(w.id) || w.w + w.l === 0) return;
    done.push(w.id);
    const end = weekWindow(w.id).end;
    const ranked = rankWeek([...demoRivals(w.id, w.tier, end, BOT_NAMES), { id: p.id, name: p.name, pts: w.pts, w: w.w, l: w.l, t: w.t, tier: w.tier }]);
    const place = ranked.findIndex((e) => e.id === p.id) + 1;
    if (place >= 1 && place <= 3) awardWeek(p, w.id, w.tier, place, Date.now());
    this.save();
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
    if (mine) this.tickRaids(ctx, mine);
    const hadWar = !!mine?.war;
    warTick(ctx);
    if (hadWar && !mine?.war) this.changeL.forEach((f) => f('war'));
    this.st.lastTick = Date.now();
    store.set('social', this.st);
  }

  /** demo clan attacks: bots join small clans, bot clans sometimes attack, bot mates/foes fight */
  private tickRaids(ctx: SocialCtx, mine: Clan) {
    const db = this.st.db;
    // a growing clan: computer players join open clans with few members
    if (mine.type === 'open' && mine.members.length < 8 && Math.random() < 0.12) {
      const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
      const id = 'joiner' + Date.now().toString(36);
      mine.members.push({ id, name, role: 'member', joined: Date.now(), mmr: 950 + Math.floor(Math.random() * 400), level: 3 + Math.floor(Math.random() * 15), fighter: FIGHTERS[Math.floor(Math.random() * FIGHTERS.length)].id, donated: 0, gemsGiven: 0, warPts: 0, seen: Date.now(), bot: true });
      db.userClan[id] = mine.id;
      this.changeL.forEach((f) => f('clan'));
    }
    const rd = raidState(mine);
    const t = this.raidTiming();
    // now and then a computer clan declares an attack on us (so the defense side can be tried)
    if (!rd.in && Date.now() > rd.shieldUntil && Math.random() < (t.fast ? 0.03 : 0.004)) {
      const foes = Object.values(db.clans).filter((x) => x.bot && !raidState(x).out && !mine.allies.includes(x.id));
      const foe = foes[Math.floor(Math.random() * foes.length)];
      if (foe) {
        foe.level = Math.max(foe.level, 2); foe.bank = Math.max(foe.bank, 2000);
        raidState(foe).banners = 1; raidState(foe).cdUntil = 0;
        const leader = { ...this.me, id: foe.members[0].id } as Profile;
        try { raidDeclare(ctx, leader, mine.id, Date.now() + t.minLead, t); this.changeL.forEach((f) => f('raid')); } catch { /* not allowed right now */ }
      }
    }
    const live = (id: string | null) => { const r = id ? raidOf(ctx, id) : null; return r && r.status === 'live' ? r : null; };
    // our computer clan mates attack in our raid
    const out = live(rd.out);
    if (out) for (const m of mine.members.filter((x) => x.bot)) {
      if ((out.used[m.id] ?? 0) >= RAID.attacksPerMember || Math.random() > 0.2) continue;
      const open = out.slots.map((s, i) => [s, i] as const).filter(([s]) => s.stars < 3);
      if (!open.length) break;
      const [s, i] = open[Math.floor(Math.random() * open.length)];
      const stars = Math.random() < 0.25 ? 0 : 1 + Math.floor(Math.random() * 3);
      out.used[m.id] = (out.used[m.id] ?? 0) + 1; s.stars = Math.max(s.stars, stars);
      out.attacks.unshift({ uid: m.id, name: m.name, slot: i, stars, t: Date.now() });
      this.changeL.forEach((f) => f('raid'));
    }
    // the enemy attacks our defenders (fortifications make it harder)
    const inc = live(rd.in);
    if (inc && Math.random() < 0.3) {
      const open = inc.slots.map((s, i) => [s, i] as const).filter(([s]) => s.stars < 3);
      if (open.length) {
        const [s, i] = open[Math.floor(Math.random() * open.length)];
        const stars = Math.max(0, Math.min(3, Math.floor(Math.random() * 4) - (inc.fort > 1 ? 1 : 0)));
        s.stars = Math.max(s.stars, stars);
        inc.attacks.unshift({ uid: 'enemy', name: inc.attTag, slot: i, stars, t: Date.now() });
        this.changeL.forEach((f) => f('raid'));
      }
    }
    const before = JSON.stringify([rd.out, rd.in]);
    raidTick(ctx);
    if (JSON.stringify([rd.out, rd.in]) !== before) this.changeL.forEach((f) => f('raid'));
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
  raid() { return this.wrap((c) => raidView(c, clanOf(c.db, this.me.id) ?? (() => { throw new SocialError('no-clan'); })())); }
  raidTargets(q: string) { return this.wrap((c) => raidTargets(c, this.me, q)); }
  raidDeclare(target: string, start: number) { return this.wrap((c) => raidDeclare(c, this.me, target, start, this.raidTiming())); }
  raidWithdraw() { return this.wrap((c) => { raidWithdraw(c, this.me); }); }
  raidLineup(raid: string, uids: string[]) { return this.wrap((c) => { raidSetLineup(c, this.me, raid, uids); }); }
  raidFortify(raid: string) { return this.wrap((c) => { raidFortify(c, this.me, raid); }); }
  raidHelp(raid: string) { return this.wrap((c) => { raidHelp(c, this.me, raid); }); }
  raidFight(raid: string, slot: number) { return this.wrap((c) => raidFightStart(c, this.me, raid, slot)); }
  raidReport(fight: string, res: FightResult) { return this.wrap((c) => raidFightEnd(c, this.me, fight, res)); }
  /** test mode (Settings) shortens the 1-hour lead and window to minutes so the flow can be tried */
  raidTiming() { return this.me.dev ? { minLead: 2 * 60_000, duration: 10 * 60_000, fast: true } : { minLead: RAID.minLead, duration: RAID.duration, fast: false }; }
  allianceLeaderboard() { return this.wrap((c) => allianceLeaderboard(c.db, 30)); }
  winsLeaderboard() {
    return this.wrap((c) => {
      const rows = Object.values(c.db.clans).flatMap((x) => x.members).filter((m) => m.bot).map((m) => ({ id: m.id, name: m.name, wins: Math.round((m.mmr - 900) / 4 + m.level * 3), mmr: m.mmr, fighter: m.fighter, trophies: m.level > 20 ? 1 : 0 }));
      const me = this.me;
      rows.push({ id: me.id, name: me.name, wins: me.stats.leagueWins ?? 0, mmr: me.rank.mmr, fighter: me.selFighter, trophies: me.trophies.length });
      return rows.sort((a, b) => b.wins - a.wins || b.mmr - a.mmr).slice(0, 100).map((x, i) => ({ pos: i + 1, ...x }));
    });
  }
  weekStandings() {
    return this.wrap(() => {
      const now = Date.now();
      this.settleWeeks();
      const me = weekStats(this.me, now);
      const ranked = rankWeek([...demoRivals(me.id, me.tier, now, BOT_NAMES), { id: this.me.id, name: this.me.name, pts: me.pts, w: me.w, l: me.l, t: me.t || now, tier: me.tier }]);
      return { week: me.id, tier: me.tier, top: ranked.slice(0, 50), myPos: ranked.findIndex((x) => x.id === this.me.id) + 1, me };
    });
  }
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
