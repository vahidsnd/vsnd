import {
  applyMatch, addWeekResult, claimEventReward, eventAt, eventCalendar, eventProgress, recordEventMatch, EVENT_TRACK,
  TOURNEY_TIERS, tourneyDb, tourneyPhase, tourneySchedule, offlineSignUp, offlineResolve, offlineFinish, offlineFoeLevel, advanceRound,
  setResult, myBracket, myMatch, payPrizes, placementsOf, seedOf, TourneyError,
  recordSurvival, survivalProgress, survivalLeaderboard,
  type Bracket, type EventClaim, type EventInstance, type EventProgress, type MatchSummary, type Profile, type RewardResult,
  type SurvivalOutcome, type SurvivalRow, type SurvivalRun, type TierDef, type TourneyDb, type TourneyPhase, type TourneyTier, type TrackStep, type TSeat,
} from '@nb/shared';
import { backend } from './backend.ts';
import { store } from './platform.ts';
import { net } from '../net/net.ts';

// =====================================================================================
//  Special modes (events, weekend tournament, survival) behind one façade.
//  Online: the server routes in server/src/modes.ts. Offline: the very same shared rules
//  run against the local profile (and a local tournament db), so the APK plays them all.
//  The clan co-op boss lives with the clan features (services/social.ts).
// =====================================================================================

export interface EventInfo { event: EventInstance; calendar: EventInstance[]; progress: EventProgress; track: TrackStep[] }
export interface BracketView extends Bracket { mine: { round: number; idx: number; foe: TSeat; ready: boolean; live: boolean } | null }
export interface TourneyInfo {
  phase: TourneyPhase | 'offline'; week: number; next: number; tiers: Record<TourneyTier, TierDef>;
  bracket: BracketView | null; last: BracketView | null; trophies: NonNullable<Profile['tTrophies']>; entrants: number; test?: boolean;
  schedule?: { signupStart: number; start: number; end: number };
}
export interface OfflineRoundResult { won: boolean; out: boolean; finished: boolean; place: number }

const view = (b: Bracket | null, uid: string): BracketView | null => {
  if (!b) return null;
  const m = myMatch(b, uid);
  return { ...b, mine: m ? { round: m.round, idx: m.idx, foe: b.seats[m.foe], ready: false, live: false } : null };
};

class ModesService {
  private get p() { return backend.profile; }
  private apply(j: any) { if (j?.profile) backend.applyServerProfile(j.profile); return j; }
  private api<T = any>(method: string, path: string, body?: unknown) { return backend.api<T>(method, path, body).then((j) => this.apply(j) as T); }

  // ---- timed events ----------------------------------------------------------------------
  async event(): Promise<EventInfo> {
    if (backend.online) { try { return await this.api('GET', '/api/event'); } catch { /* fall back to the local calendar */ } }
    const now = Date.now();
    const progress = eventProgress(this.p, now);
    return { event: eventAt(now), calendar: eventCalendar(now, 6), progress, track: EVENT_TRACK };
  }
  async eventClaim(idx: number): Promise<EventClaim | null> {
    if (backend.online) return (await this.api('POST', '/api/event/claim', { idx })).result;
    const r = claimEventReward(this.p, idx, Date.now());
    backend.touch();
    return r;
  }
  /** an event match played on the device (vs CPU) */
  async eventReport(summary: MatchSummary): Promise<{ reward: RewardResult | null; counted: boolean }> {
    if (backend.online) {
      const j = await this.api('POST', '/api/event/cpu', { summary });
      return { reward: j.reward, counted: j.counted };
    }
    const p = this.p;
    addWeekResult(p, summary.won, summary.falls, Date.now());
    const reward = applyMatch(p, summary);
    const counted = recordEventMatch(p, summary.won, Date.now(), true);
    backend.touch();
    return { reward, counted };
  }

  // ---- weekend tournament -------------------------------------------------------------------
  private localDb(): TourneyDb { return tourneyDb(store.get<{ tourney?: TourneyDb }>('tourney', {})); }
  private saveDb(db: TourneyDb) { store.set('tourney', { tourney: db }); backend.touch(); }

  async tourney(): Promise<TourneyInfo> {
    if (backend.online) return this.api('GET', '/api/tourney');
    const db = this.localDb();
    const b = myBracket(db, this.p.id);
    const now = Date.now();
    const ph = tourneyPhase(now);
    const active = b && b.status !== 'done' ? b : null;
    return {
      phase: 'offline', week: ph.week, next: 0, tiers: TOURNEY_TIERS, bracket: view(active, this.p.id), last: active ? null : view(b, this.p.id),
      trophies: this.p.tTrophies ?? [], entrants: 0, schedule: tourneySchedule(ph.week),
    };
  }
  async tourneySignUp(tier: TourneyTier): Promise<TourneyInfo> {
    if (backend.online) return this.api('POST', '/api/tourney/signup', { tier });
    const db = this.localDb();
    try { offlineSignUp(db, this.p, tier, Date.now(), Math.floor(Math.random() * 1e9)); } catch (e) { throw e instanceof TourneyError ? new Error(e.code) : e; }
    this.saveDb(db);
    return this.tourney();
  }
  async tourneyLeave(): Promise<TourneyInfo> { return this.api('POST', '/api/tourney/leave', {}); }
  /** online: "I'm here" for the current round; the server starts the match when the foe is ready too */
  async tourneyReady(): Promise<TourneyInfo & { started: boolean }> {
    await net.connect();
    return this.api('POST', '/api/tourney/ready', {});
  }
  /** offline: the player's opponent this round, with the escalating CPU level */
  offlineFoe(): { b: Bracket; foe: TSeat; level: number; round: number } | null {
    const db = this.localDb();
    const b = myBracket(db, this.p.id);
    if (!b || b.status !== 'live') return null;
    const m = myMatch(b, this.p.id);
    if (!m) return null;
    return { b, foe: b.seats[m.foe], level: offlineFoeLevel(b.tier, m.round), round: m.round };
  }
  /** offline: records the player's match, simulates the rest of the round, pays prizes at the end */
  offlineReport(won: boolean, score?: [number, number]): OfflineRoundResult | null {
    const db = this.localDb();
    const b = myBracket(db, this.p.id);
    if (!b || b.status !== 'live') return null;
    const m = myMatch(b, this.p.id);
    if (!m) return null;
    const seed = seedOf(b.id);
    setResult(b, m.round, m.idx, won ? m.me : m.foe, 'played', score);
    offlineResolve(b, this.p.id, seed);
    advanceRound(b);
    if (!won) offlineFinish(b, this.p.id, seed);
    const me = b.seats.findIndex((s) => s.id === this.p.id);
    let place = 0;
    const done = (b.status as string) === 'done';
    if (done) {
      place = placementsOf(b)[me];
      payPrizes(b, (id) => (id === this.p.id ? this.p : null), Date.now());
    }
    this.saveDb(db);
    return { won, out: !won, finished: done, place };
  }

  // ---- survival ---------------------------------------------------------------------------------
  async survivalReport(stage: string, run: SurvivalRun): Promise<SurvivalOutcome> {
    if (backend.online) return (await this.api('POST', '/api/survival/report', { stage, ...run })).result;
    const r = recordSurvival(this.p, stage, run, Date.now());
    backend.touch();
    return r;
  }
  async survivalBoard(): Promise<{ top: SurvivalRow[]; me: { best: number; pos: number }; local: boolean }> {
    if (backend.online) { try { return { ...(await this.api('GET', '/api/survival/leaderboard')), local: false }; } catch { /* offline view */ } }
    const s = survivalProgress(this.p, Date.now());
    const top = survivalLeaderboard([this.p]);
    return { top, me: { best: s.best, pos: top.length ? 1 : 0 }, local: true };
  }
}

export const modes = new ModesService();
