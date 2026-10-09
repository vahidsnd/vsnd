import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, step, botInput, createBrain, cloneState, SPELLS,
  ReplayRecorder, encodeReplay, decodeReplay, simulateReplay, ReplayPlayer, forfeitSlot, expandInputs, REPLAY_PREFIX,
  validateRemoteConfig, mergeRemoteConfig, DEFAULT_REMOTE_CONFIG, setRemoteConfig, remoteConfig, activeMotd, matchCoinMultiplier,
  newProfile, applyMatch, shopCatalog, spinWheel, dayKey,
  newAnalyticsStore, aggregateEvents, noteActive, noteInstall, analyticsSeries, retentionSummary, sumByPrefix, parsePrice, addDays, pruneAnalytics,
  type MatchConfig, type GameState,
} from '../src/index.ts';

const strip = (s: GameState) => JSON.stringify({ ...s, events: [] });

function botMatch(frames: number, players = 2, forfeitAt = -1) {
  const cfg: MatchConfig = {
    stageId: 'bazaar', stocks: 2, timeLimit: 0, teams: false,
    players: Array.from({ length: players }, (_, i) => ({ charId: ['blaze', 'kira', 'boulder', 'pip'][i], skin: i, team: i, name: 'P' + i, mods: { atk: 1.1, def: 0.95, hp: 1, spell: SPELLS[i].id, spellLv: 2 } })),
  };
  const g = createGame(cfg);
  const rec = new ReplayRecorder(cfg);
  const brains = Array.from({ length: players }, (_, i) => createBrain(8, 7 + i));
  for (let f = 0; f < frames; f++) {
    if (f === forfeitAt) { rec.mark(g.frame, 1); forfeitSlot(g, 1); }
    const inp = brains.map((b, s) => botInput(g, s, b));
    rec.push(inp);
    step(g, inp);
  }
  return { g, rec };
}

test('replay: encode/decode round trip is lossless and compact', () => {
  const { g, rec } = botMatch(3600, 3);
  const data = rec.build({ id: 'r1', at: 1, mode: 'cpu', slot: 0, winnerTeam: g.winnerTeam, placements: [] });
  const code = encodeReplay(data);
  assert.ok(code.startsWith(REPLAY_PREFIX));
  assert.match(code.slice(REPLAY_PREFIX.length), /^[A-Za-z0-9_-]+$/);
  const back = decodeReplay('  some text ' + code + '\n');
  assert.deepEqual(back, JSON.parse(JSON.stringify(data)));
  assert.deepEqual(Array.from(expandInputs(back)).length, 3600 * 3);
  // 60 s of 3 bots: well under the raw 10 800 inputs
  assert.ok(code.length < 20000, `code is ${code.length} chars`);
  assert.throws(() => decodeReplay(code.slice(0, code.length - 40)));
  assert.throws(() => decodeReplay('hello'));
});

test('replay: re-simulating the recorded inputs reproduces the final state exactly', () => {
  const { g, rec } = botMatch(60 * 60 * 3, 2);
  const data = decodeReplay(encodeReplay(rec.build({ id: 'r2', at: 1, mode: 'cpu', slot: 0, winnerTeam: g.winnerTeam, placements: [] })));
  const end = simulateReplay(data);
  assert.equal(strip(end), strip(g));
  assert.equal(end.winnerTeam, g.winnerTeam);
});

test('replay: forfeit marks are replayed', () => {
  const { g, rec } = botMatch(900, 2, 400);
  assert.equal(g.fighters[1].stocks, 0);
  const end = simulateReplay(rec.build({ id: 'r3', at: 1, mode: 'ranked', slot: -1, winnerTeam: g.winnerTeam, placements: [] }));
  assert.equal(strip(end), strip(g));
  assert.equal(end.winnerTeam, 0);
});

test('replay: keyframe seeking matches straight playback', () => {
  const { rec } = botMatch(2000, 2);
  const data = rec.build({ id: 'r4', at: 1, mode: 'cpu', slot: 0, winnerTeam: -1, placements: [] });
  const ref = new ReplayPlayer(data);
  const states: string[] = [];
  while (!ref.done) { ref.stepOnce(); states[ref.pos] = strip(ref.state); }
  const p = new ReplayPlayer(data);
  while (!p.warm(50)) { /* compute every keyframe */ }
  assert.equal(p.keyframeCount(), Math.floor(2000 / 300) + 1);
  for (const t of [1500, 37, 1999, 600, 601, 0, 2000, 899]) {
    p.seek(t);
    assert.equal(p.pos, t);
    if (t > 0) assert.equal(strip(p.state), states[t], `seek ${t}`);
  }
  const fresh = createGame(data.cfg);
  p.seek(0);
  assert.equal(strip(p.state), strip(fresh));
  void cloneState;
});

test('remote config: validation, clamping, merge and economy hooks', () => {
  const { patch, errors } = validateRemoteConfig({ economy: { matchCoinMult: 50, cratePriceMult: '2', nope: 1, wheelRewards: 'yes' }, flags: { replays: false }, junk: {}, motd: { fa: 'سلام', kind: 'bad' } });
  assert.equal(patch.economy?.matchCoinMult, 10);
  assert.equal(patch.economy?.cratePriceMult, 2);
  assert.ok(errors.some((e) => e.startsWith('economy.matchCoinMult')));
  assert.ok(errors.includes('economy.nope: unknown') && errors.includes('junk: unknown') && errors.includes('economy.wheelRewards: boolean') && errors.includes('motd.kind: info|event|warn'));
  const c = mergeRemoteConfig({ economy: { matchCoinMult: 2, cratePriceMult: 0.5, wheelRewards: false }, events: { doubleCoins: true }, motd: { en: 'Hi', until: 1000 }, version: 7 });
  assert.equal(c.version, 7);
  assert.equal(c.economy.matchXpMult, 1, 'untouched keys keep defaults');
  assert.equal(matchCoinMultiplier(c), 4);
  assert.equal(activeMotd(500, c)?.en, 'Hi');
  assert.equal(activeMotd(2000, c), null);
  assert.deepEqual(mergeRemoteConfig(null), DEFAULT_REMOTE_CONFIG);
  assert.equal(mergeRemoteConfig({ motd: null }).motd, null);

  const summary = { matchId: 'm', mode: 'casual' as const, won: true, placement: 1, players: 2, kos: 2, falls: 0, dmg: 100, smashKOs: 0, maxCombo: 3, fighter: 'blaze', durationSec: 120 };
  const base = applyMatch(newProfile('a', 'A'), { ...summary });
  try {
    setRemoteConfig(c);
    const p = newProfile('b', 'B');
    const boosted = applyMatch(p, { ...summary });
    assert.equal(boosted.coins - 100, Math.round((base.coins - 100) * 4), 'match coins x2 multiplier x2 event (first-win bonus excluded)');
    assert.equal(shopCatalog().find((x) => x.id === 'crate')?.cost.gems, 45);
    assert.equal(spinWheel(p, dayKey(Date.now()), false), null, 'wheel switched off');
  } finally { setRemoteConfig(mergeRemoteConfig({})); }
  assert.equal(remoteConfig().economy.matchCoinMult, 1);
});

test('analytics: whitelisted aggregation, DAU and D1/D7/D30 retention', () => {
  const st = newAnalyticsStore();
  const n = aggregateEvents(st, '2026-10-01', [{ n: 'screen', d: 'Home!' }, { n: 'screen', d: 'home' }, { n: 'hack' }, null, { n: 'match_end', d: 'cpu' }, { n: 'purchase', d: { x: 1 } }]);
  assert.equal(n, 4);
  assert.equal(st.days['2026-10-01']['ev:screen'], 2);
  assert.equal(st.days['2026-10-01']['ev:screen:home'], 2);
  assert.equal(st.days['2026-10-01']['ev:purchase'], 1);
  assert.equal(st.days['2026-10-01']['ev:hack'], undefined);
  assert.equal(aggregateEvents(st, '2026-10-01', 'nope'), 0);

  const users = Array.from({ length: 10 }, () => ({}));
  users.forEach((u) => noteInstall(st, u, '2026-09-01'));
  users.forEach((u) => noteActive(st, u, '2026-09-01'));
  users.slice(0, 6).forEach((u) => { noteActive(st, u, '2026-09-02'); noteActive(st, u, '2026-09-02'); });
  users.slice(0, 3).forEach((u) => noteActive(st, u, '2026-09-08'));
  users.slice(0, 1).forEach((u) => noteActive(st, u, '2026-10-01'));
  assert.equal(st.days['2026-09-02'].dau, 6, 'DAU counted once per user per day');
  const rows = analyticsSeries(st, '2026-10-01', 31);
  const cohort = rows.find((r) => r.day === '2026-09-01')!;
  assert.equal(cohort.installs, 10);
  assert.equal(cohort.d1, 0.6);
  assert.equal(cohort.d7, 0.3);
  assert.equal(cohort.d30, 0.1);
  assert.equal(rows.at(-1)!.d1, null, 'too young to measure');
  const sum = retentionSummary(st, '2026-10-01');
  assert.equal(sum.d1, 0.6);
  assert.deepEqual(parsePrice('$4.99'), { usd: 499 });
  assert.deepEqual(parsePrice('۱۴۹٬۰۰۰ تومان'), { toman: 149000 });
  assert.equal(sumByPrefix(st, 'ev:screen')[''], 2);
  pruneAnalytics(st, addDays('2026-10-01', 200));
  assert.deepEqual(st.days, {});
});
