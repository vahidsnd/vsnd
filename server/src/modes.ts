import {
  applyMatch, checkSummary, claimEventReward, dayKey, eventAt, eventCalendar, eventProgress, featureUnlocked, flagCheat, recordEventMatch,
  rewardsWithheld, EVENT_TRACK, TOURNEY_TIERS, tourneyDb, tourneyPhase, tourneySchedule, tourneySignUp, tourneyLeave, myBracket, myMatch,
  lockBracket, resolveRound, advanceRound, roundDone, payPrizes, setResult, seedOf, TourneyError, SocialError, placements, botSeat as tBotSeat,
  clanOf, clanBossView, bossFightStart, bossFightEnd, clanBossState, settleClanBoss, recordSurvival, survivalLeaderboard, survivalPlausible, weekId,
  fighterMods, STAGES,
  type Bracket, type FeatureId, type MatchConfig, type MatchSummary, type Profile, type TourneyTier, type TourneyTiming, type TMatch,
} from '@nb/shared';
import { config } from './config.ts';
import { allProfiles, markDirty, socialCtx, socialDb, userById, type UserRec } from './db.ts';
import { HttpError, need } from './social.ts';
import { activeMatches, Match, matchByUser, type Seat } from './match.ts';
import { botSeat, humanSeat } from './matchmaker.ts';
import { notifyClan, sendTo, socketsByUser } from './sockets.ts';

// =====================================================================================
//  Special modes on the server: timed events, weekend tournament, clan co-op boss, survival.
//  The rules live in shared/ (events.ts, tournament.ts, clanboss.ts, survival.ts); these
//  routes wrap them and the tick drives the tournament brackets.
// =====================================================================================

type Handler = (body: any, user: UserRec | null) => Promise<unknown> | unknown;

function gate(p: Profile, f: FeatureId) {
  if (!config.unlockAll && !featureUnlocked(p, f)) throw new HttpError(403, 'locked');
}
function run<T>(fn: () => T): T {
  try { const out = fn(); markDirty(); return out; } catch (e) {
    if (e instanceof SocialError || e instanceof TourneyError) throw new HttpError(400, e.code);
    throw e;
  }
}
const clampN = (v: unknown, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; };

// ---- tournament clock ---------------------------------------------------------------------------------------
/** In test mode sign-ups stay open (clock pinned inside the window) until an admin starts the brackets. */
let testStarted = 0;
function timing(): TourneyTiming { return { signupMs: 44 * 3600_000, roundMs: config.tourneyRoundMs }; }
function tourneyNow(now = Date.now()) {
  if (!config.tourneyTest) return now;
  const week = tourneyPhase(Date.now(), timing()).week;
  const s = tourneySchedule(week, timing());
  return testStarted ? Math.max(s.start + 1, now) : s.signupStart + 3600_000;
}

function bracketView(b: Bracket | null, userId: string) {
  if (!b) return null;
  const mine = myMatch(b, userId);
  return { ...b, mine: mine ? { round: mine.round, idx: mine.idx, foe: b.seats[mine.foe], ready: mine.m.ready.includes(userId), live: !!mine.m.matchId && activeMatches.has(mine.m.matchId) } : null };
}

function tourneyInfo(u: UserRec) {
  const now = tourneyNow();
  const ph = tourneyPhase(now, timing());
  const db = tourneyDb(socialDb());
  const b = myBracket(db, u.profile.id);
  const current = b && (b.week === ph.week || b.status !== 'done') ? b : null;
  return {
    phase: ph.phase, week: ph.week, next: config.tourneyTest ? 0 : ph.next, schedule: tourneySchedule(ph.week, timing()), tiers: TOURNEY_TIERS,
    bracket: bracketView(current, u.profile.id), last: b && b !== current ? bracketView(b, u.profile.id) : null,
    trophies: u.profile.tTrophies ?? [], test: config.tourneyTest,
    entrants: Object.values(db.brackets).filter((x) => x.week === ph.week && !x.offline).reduce((a, x) => a + x.seats.filter((s) => !s.bot).length, 0),
  };
}

function notifyBracket(b: Bracket) {
  for (const s of b.seats) if (!s.bot) sendTo(s.id, { t: 'social', kind: 'tourney' });
}

/** Starts a real online match for a tournament pairing (human vs human or human vs bot). */
function startTourneyMatch(b: Bracket, round: number, idx: number): boolean {
  const m = b.rounds[round][idx];
  const sides = [m.a, m.b].map((si) => b.seats[si]);
  const seats: Seat[] = [];
  const players: MatchConfig['players'] = [];
  for (let k = 0; k < 2; k++) {
    const s = sides[k];
    if (s.bot) {
      const bs = botSeat(s.mmr);
      bs.bot!.level = s.level;
      seats.push(bs);
      players.push({ charId: s.fighter, skin: s.skin, team: k, name: s.name, bot: true, mods: s.mods });
    } else {
      const u = userById(s.id), ws = socketsByUser.get(s.id);
      if (!u || !ws || ws.readyState !== 1 || matchByUser.get(s.id)) return false;
      seats.push(humanSeat({ user: u, ws }));
      const p = u.profile;
      const f = p.fighters.includes(p.selFighter) ? p.selFighter : s.fighter;
      players.push({ charId: f, skin: p.selSkin?.[f] ?? 0, team: k, name: p.name, mods: fighterMods(p, f) });
    }
  }
  const stages = ['rooftop', 'dojo', 'canyon', 'garden', 'temple', 'orbit', 'forge'];
  const cfg: MatchConfig = { stageId: stages[(b.week + round * 3 + idx) % stages.length], stocks: 3, timeLimit: 300, teams: false, players };
  const match = new Match('tourney', cfg, seats);
  m.matchId = match.id; m.status = 'live';
  match.onEnd = (mt) => {
    const st = mt.state;
    const place = placements(st);
    const winSide = place[0] === 1 ? 0 : 1;
    if (m.status !== 'done') {
      m.status = 'pending';
      setResult(b, round, idx, winSide === 0 ? m.a : m.b, 'played', [st.fighters[0].stocks, st.fighters[1].stocks]);
    }
    markDirty();
    notifyBracket(b);
  };
  match.start();
  return true;
}

/** Drives every bracket: lock at the start time, resolve rounds, advance, pay prizes. */
function tourneyTick() {
  const now = tourneyNow();
  const db = tourneyDb(socialDb());
  const ph = tourneyPhase(now, timing());
  let changed = false;
  for (const b of Object.values(db.brackets)) {
    if (b.offline) continue;
    if (b.status === 'signup' && (b.week < ph.week || ph.phase !== 'signup')) {
      lockBracket(b, seedOf(b.id));
      b.windowEnd = Date.now() + config.tourneyRoundMs;
      changed = true; notifyBracket(b);
    }
    if (b.status !== 'live') continue;
    const before = JSON.stringify(b.rounds[b.round]);
    resolveRound(b, Date.now(), b.windowEnd ?? 0, seedOf(b.id), (m: TMatch) => !!m.matchId && activeMatches.has(m.matchId));
    if (roundDone(b)) {
      const done = advanceRound(b);
      b.windowEnd = Date.now() + config.tourneyRoundMs;
      changed = true;
      if (done) payPrizes(b, (id) => userById(id)?.profile ?? null, Date.now()).forEach((x) => sendTo(x.id, { t: 'profile', profile: userById(x.id)!.profile }));
      notifyBracket(b);
    } else if (JSON.stringify(b.rounds[b.round]) !== before) { changed = true; notifyBracket(b); }
  }
  // forget brackets older than four weeks
  for (const [id, b] of Object.entries(db.brackets)) if (b.week < ph.week - 4) { delete db.brackets[id]; for (const s of b.seats) if (db.byUser[s.id] === id) delete db.byUser[s.id]; changed = true; }
  if (changed) markDirty();
}

// ---- clan boss weekly sweep -----------------------------------------------------------------------------------
function bossSweep() {
  const ctx = socialCtx();
  const week = weekId(ctx.now);
  for (const [clanId, s] of Object.entries(ctx.db.cboss ?? {})) if (s.week !== week) { settleClanBoss(ctx, clanId, s); markDirty(); }
}

let ticks = 0;
export function modesTick() {
  try { tourneyTick(); } catch (e) { console.error('[tourney]', e); }
  if (++ticks % 30 === 0) try { bossSweep(); } catch (e) { console.error('[clanboss]', e); }
}

// ---- offline-played results (event vs CPU) ---------------------------------------------------------------------
function cleanSummary(s: any, mode: MatchSummary['mode']): MatchSummary {
  if (!s) throw new HttpError(400, 'bad-summary');
  return {
    matchId: String(s.matchId).slice(0, 40), mode, won: !!s.won,
    placement: clampN(s.placement, 1, 4), players: clampN(s.players, 2, 4),
    kos: clampN(s.kos, 0, 12), falls: clampN(s.falls, 0, 12), dmg: clampN(s.dmg, 0, 2000),
    smashKOs: clampN(s.smashKOs, 0, 12), maxCombo: clampN(s.maxCombo, 0, 20),
    fighter: String(s.fighter), durationSec: clampN(s.durationSec, 0, 900),
  };
}
/** Shared anti-farm / anti-cheat path for matches played on the device. Returns null when rewards are withheld. */
function offlineGuard(rec: UserRec, s: MatchSummary): boolean {
  const today = dayKey(Date.now());
  if (!rec.cpu || rec.cpu.day !== today) rec.cpu = { day: today, count: 0 };
  rec.recent = (rec.recent ?? []).filter((t) => Date.now() - t < 3600_000);
  rec.recent.push(Date.now());
  const sc = socialCtx();
  const chk = checkSummary(s, { foes: Math.max(1, s.players - 1), stocks: 3, recentPerHour: rec.recent.length });
  if (chk.pts) flagCheat(sc, rec.profile, 'offline', chk.reasons.join('; '), chk.pts);
  if (rewardsWithheld(sc, rec.profile)) return false;
  if (rec.cpu.count >= 40) return false;
  rec.cpu.count++;
  return true;
}

export const modeRoutes: Record<string, Handler> = {
  // ---- timed events ----
  'GET /api/event': (_b, u) => {
    const p = need(u).profile; const now = Date.now();
    const e = eventAt(now);
    return { event: e, calendar: eventCalendar(now, 6), progress: eventProgress(p, now), track: EVENT_TRACK };
  },
  'POST /api/event/claim': (b, u) => {
    const p = need(u).profile; gate(p, 'events');
    const r = claimEventReward(p, Number(b.idx), Date.now());
    markDirty();
    return { result: r, profile: p };
  },
  'POST /api/event/cpu': (b, u) => {
    const rec = need(u); const p = rec.profile; gate(p, 'events');
    const s = cleanSummary(b.summary, 'cpu');
    const ok = offlineGuard(rec, s);
    const reward = ok ? applyMatch(p, s) : null;
    const counted = ok ? recordEventMatch(p, s.won, Date.now(), true) : false;
    markDirty();
    return { reward, counted, progress: eventProgress(p, Date.now()), profile: p };
  },

  // ---- weekend tournament ----
  'GET /api/tourney': (_b, u) => tourneyInfo(need(u)),
  'POST /api/tourney/signup': (b, u) => {
    const r = need(u); gate(r.profile, 'tournament');
    const tier: TourneyTier = b.tier === 'gems' ? 'gems' : 'coins';
    run(() => tourneySignUp(tourneyDb(socialDb()), r.profile, tier, tourneyNow(), timing()));
    return { ...tourneyInfo(r), profile: r.profile };
  },
  'POST /api/tourney/leave': (_b, u) => {
    const r = need(u);
    if (!run(() => tourneyLeave(tourneyDb(socialDb()), r.profile))) throw new HttpError(400, 'tourney-locked');
    return { ...tourneyInfo(r), profile: r.profile };
  },
  'POST /api/tourney/ready': (_b, u) => {
    const r = need(u);
    const b = myBracket(tourneyDb(socialDb()), r.profile.id);
    if (!b) throw new HttpError(400, 'not-found');
    const mm = myMatch(b, r.profile.id);
    if (!mm) throw new HttpError(400, 'no-match');
    if (mm.m.matchId && activeMatches.has(mm.m.matchId)) throw new HttpError(400, 'in-match');
    if (!mm.m.ready.includes(r.profile.id)) mm.m.ready.push(r.profile.id);
    const foe = b.seats[mm.foe];
    const foeReady = foe.bot || mm.m.ready.includes(foe.id);
    let started = false;
    if (foeReady) {
      if (!socketsByUser.has(r.profile.id)) throw new HttpError(400, 'connect');
      started = startTourneyMatch(b, mm.round, mm.idx);
    }
    markDirty();
    notifyBracket(b);
    return { started, ...tourneyInfo(r) };
  },
  /** operator / tests: lock this week's brackets now (TOURNEY_TEST) */
  'POST /api/admin/tourney/start': () => {
    testStarted = Date.now();
    tourneyTick();
    return { ok: true, brackets: Object.values(tourneyDb(socialDb()).brackets).filter((x) => !x.offline).length };
  },
  /** operator / tests: close the current round window now (absent players forfeit) */
  'POST /api/admin/tourney/round': () => {
    for (const b of Object.values(tourneyDb(socialDb()).brackets)) if (b.status === 'live') b.windowEnd = 0;
    tourneyTick();
    return { ok: true };
  },

  // ---- clan co-op boss ----
  'GET /api/clanboss': (_b, u) => {
    const r = need(u);
    const c = clanOf(socialDb(), r.profile.id);
    if (!c) throw new HttpError(400, 'no-clan');
    return { boss: run(() => clanBossView(socialCtx(), c, r.profile.id)) };
  },
  'POST /api/clanboss/fight': (_b, u) => {
    const r = need(u); gate(r.profile, 'clanboss');
    const f = run(() => bossFightStart(socialCtx(), r.profile));
    return { fight: f };
  },
  'POST /api/clanboss/report': (b, u) => {
    const r = need(u);
    const out = run(() => bossFightEnd(socialCtx(), r.profile, String(b.fight), { dmg: clampN(b.dmg, 0, 5000), durationSec: clampN(b.durationSec, 0, 600), won: !!b.won }));
    const c = clanOf(socialDb(), r.profile.id);
    if (c) { notifyClan(c.id, 'boss'); clanBossState(socialCtx(), c.id); }
    return { ...out, profile: r.profile };
  },

  // ---- survival ----
  'POST /api/survival/report': (b, u) => {
    const rec = need(u); const p = rec.profile; gate(p, 'survival');
    const run1 = { waves: clampN(b.waves, 0, 500), durationSec: clampN(b.durationSec, 0, 7200), kos: clampN(b.kos, 0, 2000) };
    if (!survivalPlausible(run1)) { flagCheat(socialCtx(), p, 'survival', `${run1.waves} waves in ${Math.round(run1.durationSec)}s, ${run1.kos} KOs`, 4); throw new HttpError(400, 'cheat'); }
    const stage = STAGES.some((x) => x.id === b.stage) ? String(b.stage) : STAGES[0].id;
    const out = recordSurvival(p, stage, run1, Date.now());
    markDirty();
    return { result: out, profile: p };
  },
  'GET /api/survival/leaderboard': (_b, u) => {
    const p = need(u).profile;
    const top = survivalLeaderboard(allProfiles(), 50);
    return { top, me: { best: p.surv?.best ?? 0, pos: top.findIndex((x) => x.id === p.id) + 1 } };
  },
};
void tBotSeat;
