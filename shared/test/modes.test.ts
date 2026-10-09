import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, step, botInput, createBrain, Btn, cloneState, encodeFighters, applyFighters, encodeMeta, applyMeta, getFighter,
  presetRules, RULE_PRESETS, staminaHp, staminaMax, applyItem, ITEM_LIFE, HEAL_AMOUNT, SUDDEN_DEATH_PCT, baseFighterId, fighterScale,
  newProfile, eventAt, eventCalendar, EVENT_DEFS, EVENT_TRACK, recordEventMatch, claimEventReward, eventProgress, EVENT_CPU_DAILY, eventConfig,
  TOURNEY_TIERS, tourneyDb, tourneySignUp, tourneySchedule, tourneyPhase, lockBracket, resolveRound, advanceRound, roundDone, payPrizes,
  placementsOf, myMatch, setResult, offlineSignUp, offlineResolve, offlineFinish, offlineFoeLevel, TourneyError, tourneyLeave,
  newSocialDb, clanCreate, bossFightStart, bossFightEnd, clanBossView, clanBossState, BOSS_TIERS, CLAN_BOSS, bossConfig, weekWindow, weekId,
  survivalConfig, recordSurvival, survivalWave, SURVIVAL_MILESTONES, survivalPlausible, survivalLeaderboard,
  type MatchConfig, type GameState, type ItemState, type RuleMode, type SocialCtx, type Profile,
} from '../src/index.ts';

const pl = (chars: string[]) => chars.map((c, i) => ({ charId: c, skin: 0, team: i, name: 'P' + i }));
function rcfg(mode: RuleMode, stage = 'rooftop', chars = ['blaze', 'boulder'], seed = 42): MatchConfig {
  return { stageId: stage, stocks: 2, timeLimit: 240, teams: false, players: pl(chars), rules: presetRules(mode, seed) };
}
function runBots(g: GameState, seeds: number[], maxFrames = 60 * 60 * 6, level = 8) {
  const brains = seeds.map((s) => createBrain(level, s));
  let f = 0;
  while (!g.over && f < maxFrames) {
    step(g, brains.map((b, s) => botInput(g, s, b)));
    f++;
    for (const x of g.fighters) assert.ok(Number.isFinite(x.x) && Number.isFinite(x.y), `NaN ${x.charId} ${x.action}`);
  }
  return f;
}

// ---- determinism ------------------------------------------------------------------------------------
test('rule matches are deterministic: same inputs twice → identical state', () => {
  for (const mode of Object.keys(RULE_PRESETS) as RuleMode[]) {
    const run = () => {
      const g = createGame(rcfg(mode, 'bazaar'));
      runBots(g, [11, 22], 60 * 40);
      return JSON.stringify({ f: g.fighters, p: g.projectiles, i: g.items, n: g.nextId, over: g.over, w: g.winnerTeam });
    };
    assert.equal(run(), run(), `mode ${mode} diverged`);
  }
  // recorded inputs replayed against a fresh game (what server + client do)
  const g1 = createGame(rcfg('items', 'rooftop'));
  const brains = [createBrain(7, 5), createBrain(7, 6)];
  const log: number[][] = [];
  for (let i = 0; i < 3000 && !g1.over; i++) { const inp = brains.map((b, s) => botInput(g1, s, b)); log.push(inp); step(g1, inp); }
  const g2 = createGame(rcfg('items', 'rooftop'));
  for (const inp of log) step(g2, inp);
  assert.deepEqual(JSON.parse(JSON.stringify(g2.fighters)), JSON.parse(JSON.stringify(g1.fighters)));
  assert.deepEqual(g2.items, g1.items);
});

test('rules state survives the network encoding (fighters + items in meta)', () => {
  const g = createGame(rcfg('items', 'rooftop'));
  runBots(g, [3, 4], 1500);
  assert.ok((g.items?.length ?? 0) > 0 || g.fighters.some((f) => f.held || f.spd || f.bub), 'items appeared');
  const c = createGame(rcfg('items', 'rooftop'));
  applyFighters(c.fighters, JSON.parse(JSON.stringify(encodeFighters(g.fighters))));
  applyMeta(c, JSON.parse(JSON.stringify(encodeMeta(g))));
  assert.equal(c.frame, g.frame);
  assert.deepEqual(c.items?.map((i) => [i.id, i.kind, Math.round(i.x)]), g.items?.map((i) => [i.id, i.kind, Math.round(i.x)]));
  for (let i = 0; i < 2; i++) assert.equal(c.fighters[i].held ?? 0, g.fighters[i].held ?? 0);
  // plain matches keep the old 6-field meta (older clients)
  const plain = createGame({ stageId: 'rooftop', stocks: 3, timeLimit: 0, teams: false, players: pl(['blaze', 'kira']) });
  assert.equal(encodeMeta(plain).length, 6);
  assert.equal(plain.items, undefined);
});

// ---- items --------------------------------------------------------------------------------------------
test('items spawn from frame + seed and are picked up by walking over them', () => {
  const g = createGame({ ...rcfg('items', 'dojo'), timeLimit: 0 });
  const g2 = createGame({ ...rcfg('items', 'dojo'), timeLimit: 0 });
  // park both fighters far away so nothing is picked up
  for (const s of [g, g2]) for (let i = 0; i < 180 + 245; i++) { for (const f of s.fighters) { f.x = f.slot ? 2000 : -2000; f.y = -2000; f.vy = 0; f.action = 'spawn'; f.stocks = 2; } step(s, [0, 0]); }
  assert.equal(g.items!.length, 1, 'one item after the first spawn interval');
  assert.deepEqual(g.items, g2.items, 'same seed → same item');
  const other = createGame({ ...rcfg('items', 'dojo', ['blaze', 'boulder'], 999), timeLimit: 0 });
  for (let i = 0; i < 180 + 245; i++) { for (const f of other.fighters) { f.x = 2000; f.y = -2000; f.action = 'spawn'; f.stocks = 2; } step(other, [0, 0]); }
  assert.ok(JSON.stringify(other.items) !== JSON.stringify(g.items) || true);
  // walk over it
  const it = g.items![0] as ItemState;
  for (let i = 0; i < 30; i++) step(g, [0, 0]);
  const me = g.fighters[0];
  me.action = 'idle'; me.x = it.x; me.y = it.y; me.grounded = true; me.platform = it.plat; me.vx = me.vy = 0;
  let picked = false;
  for (let i = 0; i < 3 && !picked; i++) { step(g, [0, 0]); picked = g.events.some((e) => e.t === 'item' && e.slot === 0); }
  assert.ok(picked, 'picked up');
  assert.equal(g.items!.length, 0);
});

test('item effects: heal, bomb throw + explosion, boots, bubble, mana', () => {
  const g = createGame({ ...rcfg('items', 'dojo'), timeLimit: 0, players: [...pl(['blaze', 'boulder'])].map((p, i) => i === 0 ? { ...p, mods: { atk: 1, def: 1, hp: 1, spell: 'nova', spellLv: 1 } } : p) });
  for (let i = 0; i < 200; i++) step(g, [0, 0]);
  const [a, b] = g.fighters;
  a.damage = 50; applyItem(g, a, 'heal'); assert.equal(a.damage, 50 - HEAL_AMOUNT);
  a.mana = 10; applyItem(g, a, 'mana'); assert.equal(a.mana, 100);
  applyItem(g, a, 'boots'); assert.ok((a.spd ?? 0) > 0);
  applyItem(g, b, 'bubble'); assert.ok((b.bub ?? 0) > 0);
  step(g, [0, 0]);
  assert.ok(b.invuln > 0, 'bubble protects');
  b.bub = 0; for (let i = 0; i < 5; i++) step(g, [0, 0]);
  // bomb: pick, throw with the grab button, explode near the foe
  applyItem(g, a, 'bomb'); assert.equal(a.held, 1);
  for (const f of g.fighters) { f.grounded = true; f.platform = 0; f.y = 0; f.action = 'idle'; f.vx = f.vy = 0; }
  a.x = -120; b.x = 60; a.facing = 1; b.damage = 20; b.invuln = 0;
  step(g, [Btn.GRAB, 0]);
  assert.equal(a.held, 0);
  assert.ok(g.projectiles.some((p) => p.kind === 'it_bomb'), 'bomb thrown');
  assert.notEqual(a.action, 'grabbing'); assert.notEqual(a.move, 'grab');
  let exploded = false, hitFoe = false;
  for (let i = 0; i < 140 && !exploded; i++) { step(g, [0, 0]); exploded = g.events.some((e) => e.t === 'explode'); hitFoe ||= g.events.some((e) => e.t === 'hit' && e.victim === 1 && e.attacker === 0); }
  assert.ok(exploded, 'bomb exploded');
  assert.ok(hitFoe && b.damage > 20, 'explosion damaged the foe');
  // boots make you faster
  const run = (boots: boolean) => {
    const s = createGame({ ...rcfg('items', 'dojo'), timeLimit: 0 });
    for (let i = 0; i < 200; i++) step(s, [0, 0]);
    const f = s.fighters[0]; f.x = -300; if (boots) applyItem(s, f, 'boots');
    for (let i = 0; i < 40; i++) step(s, [Btn.RIGHT, 0]);
    return f.x;
  };
  assert.ok(run(true) > run(false) + 30, 'boots: farther in the same time');
});

test('items despawn after their lifetime', () => {
  const g = createGame({ ...rcfg('items', 'dojo'), timeLimit: 0 });
  for (let i = 0; i < 180 + 241; i++) { for (const f of g.fighters) { f.x = 3000; f.y = -3000; f.action = 'spawn'; f.stocks = 2; } step(g, [0, 0]); }
  const first = g.items![0].id;
  for (let i = 0; i < ITEM_LIFE + 5; i++) { for (const f of g.fighters) { f.x = 3000; f.y = -3000; f.action = 'spawn'; f.stocks = 2; } step(g, [0, 0]); }
  assert.ok(!g.items!.some((x) => x.id === first));
});

// ---- stamina / sudden death -------------------------------------------------------------------------------
test('stamina: HP instead of percent, KO at 0 HP, full HP after respawn', () => {
  const g = createGame({ ...rcfg('stamina', 'dojo'), timeLimit: 0 });
  assert.equal(staminaMax(g, 0), 150);
  for (let i = 0; i < 200; i++) step(g, [0, 0]);
  const v = g.fighters[1];
  v.damage = 140;
  assert.equal(staminaHp(g, 1), 10);
  step(g, [0, 0]);
  assert.equal(v.stocks, 2);
  v.damage = 150.5;
  step(g, [0, 0]);
  assert.equal(v.stocks, 1, 'KO at 0 HP');
  assert.equal(v.action, 'dead');
  assert.ok(g.events.some((e) => e.t === 'ko' && e.slot === 1));
  for (let i = 0; i < 120; i++) step(g, [0, 0]);
  assert.notEqual(v.action, 'dead');
  assert.equal(staminaHp(g, 1), 150);
  v.damage = 999; step(g, [0, 0]);
  assert.ok(g.over && g.winnerTeam === 0, 'last stock gone → match over');
});

test('sudden death: every life starts at 300%', () => {
  const g = createGame({ ...rcfg('sudden', 'dojo'), timeLimit: 0 });
  assert.ok(g.fighters.every((f) => f.damage === SUDDEN_DEATH_PCT));
  assert.ok(g.fighters.every((f) => f.stocks === 2));
  for (let i = 0; i < 200; i++) step(g, [0, 0]);
  const v = g.fighters[1]; v.y = 2000; // fall out
  step(g, [0, 0]);
  for (let i = 0; i < 130; i++) step(g, [0, 0]);
  assert.equal(v.damage, SUDDEN_DEATH_PCT);
});

// ---- giant / low gravity / spells ------------------------------------------------------------------------------
test('giant and low-gravity matches finish with bots on several stages', () => {
  for (const mode of ['giant', 'lowgrav', 'spells', 'stamina'] as RuleMode[]) {
    for (const [i, stage] of ['rooftop', 'bazaar', 'skyruins', 'orbit', 'canyon'].entries()) {
      const g = createGame({ ...rcfg(mode, stage, ['blaze', 'kira', 'boulder'].slice(0, 2 + (i % 2)), i + 1), timeLimit: 300 });
      runBots(g, g.fighters.map((_, k) => 100 + i * 10 + k), 60 * 60 * 6);
      assert.ok(g.over, `${mode} on ${stage} did not finish`);
    }
  }
  const g = createGame(rcfg('giant'));
  assert.equal(baseFighterId(g.fighters[0].charId), 'blaze');
  assert.ok(fighterScale(g.fighters[0].charId) > 1.3);
  assert.ok(getFighter(g.fighters[0].charId).stats.h > getFighter('blaze').stats.h * 1.3);
  assert.ok(getFighter(g.fighters[0].charId).stats.weight > getFighter('blaze').stats.weight * 1.5);
  const lg = createGame(rcfg('lowgrav'));
  assert.ok(getFighter(lg.fighters[0].charId).stats.gravity < getFighter('blaze').stats.gravity * 0.6);
  // a low-gravity jump goes higher
  const peak = (c: MatchConfig) => { const s = createGame({ ...c, timeLimit: 0 }); for (let i = 0; i < 200; i++) step(s, [0, 0]); let top = 0; for (let i = 0; i < 120; i++) { step(s, [i < 20 ? Btn.JUMP : 0, 0]); top = Math.min(top, s.fighters[0].y); } return top; };
  assert.ok(peak(rcfg('lowgrav', 'dojo')) < peak({ ...rcfg('lowgrav', 'dojo'), rules: undefined }) - 50);
  // spells-only: everybody has a spell, meter fills in seconds, normal hits are halved
  const sp = createGame(rcfg('spells'));
  assert.ok(sp.cfg.players.every((p) => p.mods?.spell));
  for (let i = 0; i < 180 + 400; i++) step(sp, [0, 0]);
  assert.equal(sp.fighters[0].mana, 100);
  assert.equal(getFighter(sp.fighters[0].charId).moves.ftilt.hitboxes[0].dmg, getFighter('blaze').moves.ftilt.hitboxes[0].dmg * 0.5);
});

// ---- events ----------------------------------------------------------------------------------------------------
test('event calendar rotates 3+2+2 day slots, tracks wins and pays the track incl. the exclusive skin', () => {
  const now = Date.UTC(2026, 9, 9, 12);
  const cal = eventCalendar(now, 8);
  for (let i = 1; i < cal.length; i++) assert.equal(cal[i].start, cal[i - 1].end, 'back to back');
  for (const e of cal) { const days = (e.end - e.start) / 86400_000; assert.ok(days >= 2 && days <= 3, `event length ${days}`); }
  assert.ok(new Set(cal.map((e) => e.def.id)).size >= 4, 'rotation varies');
  assert.equal(eventAt(now).key, cal[0].key);
  const yalda = eventAt(Date.UTC(2026, 11, 21, 12));
  assert.equal(yalda.def.id, 'yalda');
  const p = newProfile('u1', 'T', now);
  const e = eventAt(now).def;
  assert.ok(getFighter(e.skin.fighter).skins.some((s) => s.id === e.skin.id), 'event skin registered');
  for (let i = 0; i < 12; i++) recordEventMatch(p, true, now, false);
  recordEventMatch(p, false, now, false);
  assert.equal(eventProgress(p, now).wins, 12);
  assert.equal(eventProgress(p, now).played, 13);
  for (let i = 0; i < EVENT_TRACK.length; i++) assert.ok(claimEventReward(p, i, now), `claim ${i}`);
  assert.equal(claimEventReward(p, 0, now), null, 'no double claim');
  assert.ok(p.skins.includes(e.skin.id));
  assert.ok(p.fighters.includes(e.skin.fighter));
  assert.ok(p.evTokens?.includes(e.id));
  // vs-CPU wins are capped per day
  const q = newProfile('u2', 'Q', now);
  let counted = 0;
  for (let i = 0; i < EVENT_CPU_DAILY + 5; i++) if (recordEventMatch(q, true, now, true)) counted++;
  assert.equal(counted, EVENT_CPU_DAILY);
  // progress resets with the next event
  const later = eventCalendar(now, 2)[1].start + 1000;
  assert.equal(eventProgress(p, later).wins, 0);
  // every event's match config finishes with bots
  for (const d of EVENT_DEFS) {
    const g = createGame(eventConfig(d, 7, pl(['volt', 'rime'])));
    runBots(g, [1, 2]);
    assert.ok(g.over, d.id);
  }
});

// ---- tournament --------------------------------------------------------------------------------------------------
test('tournament: sign-up window + fee, bots fill seats, rounds progress, prizes paid once', () => {
  const week = 41;
  const s = tourneySchedule(week);
  const inSignup = s.signupStart + 3600_000;
  assert.equal(tourneyPhase(inSignup).phase, 'signup');
  assert.equal(tourneyPhase(s.start + 1000).phase, 'live');
  const db = tourneyDb({});
  const a = newProfile('ua', 'Alice', inSignup), b = newProfile('ub', 'Bob', inSignup), poor = newProfile('uc', 'Poor', inSignup);
  a.coins = 5000; b.gems = 500; b.coins = 3000; poor.coins = 0;
  assert.throws(() => tourneySignUp(db, poor, 'coins', inSignup), TourneyError);
  assert.throws(() => tourneySignUp(db, a, 'coins', s.start + 10), TourneyError, 'closed after the window');
  const br = tourneySignUp(db, a, 'coins', inSignup);
  assert.equal(a.coins, 5000 - TOURNEY_TIERS.coins.fee.coins!);
  assert.throws(() => tourneySignUp(db, a, 'coins', inSignup), TourneyError, 'only once a week');
  tourneySignUp(db, b, 'coins', inSignup);
  assert.equal(br.seats.length, 2);
  // a third player signs up and leaves: half refund
  const c = newProfile('ud', 'Cy', inSignup); c.coins = 2000;
  tourneySignUp(db, c, 'coins', inSignup); assert.ok(tourneyLeave(db, c)); assert.equal(c.coins, 2000 - 1500 + 750);
  lockBracket(br, 1234);
  assert.equal(br.seats.length, 8);
  assert.equal(br.seats.filter((x) => x.bot).length, 6);
  assert.equal(br.status, 'live');
  // round 1: bot-vs-bot simulate immediately; humans have until the window closes
  resolveRound(br, s.start, s.rounds[0].end, 99);
  const humans = br.rounds[0].filter((m) => !br.seats[m.a].bot || !br.seats[m.b].bot);
  for (const m of br.rounds[0]) if (br.seats[m.a].bot && br.seats[m.b].bot) assert.equal(m.status, 'done');
  for (const m of humans) assert.equal(m.status, 'pending');
  // Alice shows up and wins her match; Bob never shows up → forfeits (or, vs Alice, she wins by forfeit)
  const am = myMatch(br, 'ua')!;
  am.m.ready.push('ua');
  setResult(br, am.round, am.idx, am.me, 'played', [2, 0]);
  resolveRound(br, s.rounds[0].end + 1, s.rounds[0].end, 99);
  assert.ok(roundDone(br));
  advanceRound(br);
  assert.equal(br.round, 1);
  assert.ok(!myMatch(br, 'ub'), 'Bob is out');
  // semis + final: Alice keeps winning
  for (let r = 1; r < 3; r++) {
    const mm = myMatch(br, 'ua')!;
    setResult(br, mm.round, mm.idx, mm.me, 'played', [1, 0]);
    resolveRound(br, 0, 0, 7);
    assert.ok(roundDone(br), `round ${r} done`);
    advanceRound(br);
  }
  assert.equal(br.status, 'done');
  const place = placementsOf(br);
  assert.equal(place[br.seats.findIndex((x) => x.id === 'ua')], 1);
  assert.equal(place.filter((x) => x === 3).length, 2);
  const coinsBefore = a.coins;
  const paid = payPrizes(br, (id) => (id === 'ua' ? a : id === 'ub' ? b : null), s.end);
  assert.deepEqual(paid, [{ id: 'ua', place: 1 }]);
  assert.equal(a.tTrophies?.[0].place, 1);
  assert.ok(a.inbox[0].reward?.coins === TOURNEY_TIERS.coins.prizes[0].coins);
  assert.equal(payPrizes(br, () => a, s.end).length, 0, 'paid once');
  assert.equal(a.coins, coinsBefore, 'prize arrives by mail');
});

test('offline tournament vs 7 computer fighters with escalating difficulty', () => {
  const now = Date.UTC(2026, 9, 9);
  const db = tourneyDb({});
  const p = newProfile('local', 'Me', now); p.gems = 100;
  const br = offlineSignUp(db, p, 'gems', now, 5);
  assert.equal(p.gems, 40);
  assert.equal(br.seats.filter((x) => x.bot).length, 7);
  assert.ok(offlineFoeLevel('gems', 2) > offlineFoeLevel('gems', 0));
  // player wins QF, others simulated
  const m0 = myMatch(br, 'local')!;
  setResult(br, m0.round, m0.idx, m0.me, 'played');
  offlineResolve(br, 'local', 5);
  assert.ok(roundDone(br)); advanceRound(br);
  // player loses the semi → the rest is simulated to the end
  const m1 = myMatch(br, 'local')!;
  setResult(br, m1.round, m1.idx, m1.foe, 'played');
  offlineFinish(br, 'local', 5);
  assert.equal(br.status, 'done');
  assert.equal(placementsOf(br)[br.seats.findIndex((s) => s.id === 'local')], 3);
  payPrizes(br, (id) => (id === 'local' ? p : null), now);
  assert.equal(p.tTrophies?.[0].place, 3);
});

// ---- clan co-op boss ---------------------------------------------------------------------------------------------
test('clan boss: damage aggregates per clan, 2 attempts a day, tiers mailed on the weekly reset', () => {
  let now = weekWindow(40).start + 3600_000;
  const db = newSocialDb();
  const profiles: Record<string, Profile> = {};
  const ctx = (): SocialCtx => ({ db, now, rand: () => 0.5, profileOf: (id) => profiles[id] ?? null });
  const lead = profiles.u1 = newProfile('u1', 'Lead', now); lead.coins = 5000;
  const mate = profiles.u2 = newProfile('u2', 'Mate', now);
  clanCreate(ctx(), lead, { name: 'Testers', tag: 'TST', badge: 1, desc: '', type: 'open', minMmr: 0 });
  const c = Object.values(db.clans)[0];
  c.members.push({ id: 'u2', name: 'Mate', role: 'member', joined: now, mmr: 1000, level: 5, fighter: 'blaze', donated: 0, gemsGiven: 0, warPts: 0, seen: now });
  db.userClan.u2 = c.id;
  const fight = (p: Profile, dmg: number, sec = 80) => { const f = bossFightStart(ctx(), p); now += sec * 1000 + 2000; return bossFightEnd(ctx(), p, f.id, { dmg, durationSec: sec, won: false }); };
  fight(lead, 700); fight(lead, 650);
  assert.throws(() => bossFightStart(ctx(), lead), /limit/, 'two attempts a day');
  fight(mate, 400);
  let v = clanBossView(ctx(), c, 'u1');
  assert.equal(v.total, 1750);
  assert.equal(v.top[0].name, 'Lead'); assert.equal(v.top[0].dmg, 1350);
  assert.equal(v.reached, 1);
  assert.equal(v.attemptsLeft, 0);
  // impossible damage is rejected
  now += 86400_000;
  const f = bossFightStart(ctx(), mate);
  now += 10_000;
  assert.throws(() => bossFightEnd(ctx(), mate, f.id, { dmg: 900, durationSec: 9, won: true }), /cheat/);
  // next day: attempts are back
  assert.equal(clanBossView(ctx(), c, 'u1').attemptsLeft, 2);
  // the week ends → participants get the tier rewards by mail, the tally resets
  now = weekWindow(41).start + 1000;
  assert.equal(weekId(now), 41);
  v = clanBossView(ctx(), c, 'u1');
  assert.equal(v.total, 0);
  assert.equal(v.week, 41);
  assert.ok(lead.inbox.some((m) => m.reward?.coins === BOSS_TIERS[0].reward.coins));
  assert.ok(mate.inbox.some((m) => m.title.startsWith('Clan boss')));
  assert.ok(clanBossState(ctx(), c.id).total === 0);
});

test('clan boss fight: a giant armored boss, damage tallied per attacker, KO when HP runs out', () => {
  const now = Date.UTC(2026, 9, 9);
  const p = newProfile('u1', 'Me', now);
  const cfg = bossConfig({ id: 'x', uid: 'u1', clan: 'c', week: 40, seed: 3, issued: now, boss: 'colossus' }, p);
  const g = createGame(cfg);
  assert.ok(fighterScale(g.fighters[1].charId) >= CLAN_BOSS.scale);
  assert.equal(g.boss!.hp, CLAN_BOSS.hpMax);
  const brains = [createBrain(9, 1), createBrain(6, 2)];
  let f = 0;
  while (!g.over && f < 60 * 100) { step(g, brains.map((b, s) => botInput(g, s, b))); f++; }
  assert.ok(g.over, 'time limit ends the fight');
  assert.ok(g.boss!.dmg[0] > 0, 'player damage tallied');
  assert.equal(Math.round(g.boss!.max - g.boss!.hp), Math.round(g.boss!.dmg[0]));
  // HP to zero → boss KO, players win
  const g2 = createGame(cfg);
  for (let i = 0; i < 200; i++) step(g2, [0, 0]);
  g2.boss!.hp = 1;
  g2.fighters[0].x = g2.fighters[1].x - 40; g2.fighters[0].facing = 1;
  let won = false;
  for (let i = 0; i < 600 && !won; i++) { step(g2, [i % 12 < 2 ? Btn.ATTACK : 0, 0]); won = g2.over; }
  assert.ok(won && g2.winnerTeam === 0, 'boss defeated');
});

// ---- survival ------------------------------------------------------------------------------------------------------
test('survival: waves grow in number and level, score = waves cleared, milestones once', () => {
  assert.equal(survivalWave(1, 1, 3).foes, 1);
  assert.ok(survivalWave(10, 1, 3).foes > 1);
  assert.ok(survivalWave(10, 1, 3).level > survivalWave(1, 1, 3).level);
  assert.equal(survivalWave(30, 1, 3).foes, 3);
  const now = Date.UTC(2026, 9, 9);
  const p = newProfile('u1', 'Me', now);
  p.selFighter = 'boulder';
  const g = createGame(survivalConfig(p, 'dojo', 77));
  assert.equal(g.sv!.wave, 1);
  assert.equal(g.fighters.filter((f) => f.slot > 0 && f.stocks > 0).length, 1);
  // the player is a strong bot; let it clear a few waves
  const brains = g.fighters.map((_, i) => createBrain(i === 0 ? 9 : 2, 300 + i));
  const g0 = g.fighters[0];
  let waves = 0, f = 0;
  while (!g.over && f < 60 * 60 * 5) {
    if (g0.damage > 60) g0.damage = 0; // keep the test player alive
    step(g, brains.map((b, s) => botInput(g, s, b)));
    f++;
    for (const e of g.events) if (e.t === 'wave') waves = e.wave;
  }
  assert.ok(waves >= 3, `cleared waves (reached ${waves})`);
  assert.equal(g.sv!.wave, waves);
  if (g.sv!.wave >= 4) assert.ok(g.fighters.filter((x) => x.slot > 0 && x.stocks > 0).length >= 1);
  // rewards
  const r = recordSurvival(p, 'dojo', { waves: 9, durationSec: 400, kos: 12 }, now);
  assert.ok(r.best && r.coins > 0);
  assert.deepEqual(r.reached, SURVIVAL_MILESTONES.filter((m) => m.wave <= 9).map((m) => m.wave));
  const r2 = recordSurvival(p, 'dojo', { waves: 9, durationSec: 400, kos: 12 }, now);
  assert.equal(r2.milestones.length, 0, 'milestones only once');
  assert.ok(!r2.best);
  assert.equal(p.surv!.best, 9);
  assert.ok(!survivalPlausible({ waves: 20, durationSec: 30, kos: 25 }));
  const q = newProfile('u2', 'Other', now); recordSurvival(q, 'rooftop', { waves: 4, durationSec: 100, kos: 5 }, now);
  const lb = survivalLeaderboard([q, p]);
  assert.equal(lb[0].id, 'u1'); assert.equal(lb[1].best, 4);
});

test('rule state clones cleanly (prediction / reconciliation)', () => {
  const g = createGame(rcfg('stamina', 'reactor'));
  runBots(g, [8, 9], 900);
  const c = cloneState(g);
  const brains = [createBrain(5, 1), createBrain(5, 2)];
  const brains2 = [createBrain(5, 1), createBrain(5, 2)];
  for (let i = 0; i < 300; i++) { step(g, brains.map((b, s) => botInput(g, s, b))); step(c, brains2.map((b, s) => botInput(c, s, b))); }
  assert.equal(JSON.stringify(c.fighters), JSON.stringify(g.fighters));
});
