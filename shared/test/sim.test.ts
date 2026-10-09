import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, step, botInput, createBrain, FIGHTERS, STAGES, Btn, cloneState,
  encodeFighters, applyFighters, newProfile, applyMatch, buyItem, grantIap, claimPass, passTier, PASS_XP_PER_TIER,
  completeTutorial, claimAchievement, featureUnlocked, migrateProfile, type Profile,
  clearMapNode, mapNodes, MAP_SIZE, upgradeStat, fighterMods, learnSpell, equipSpell, claimMilestone, spinWheel, leagueSteps, tierFor,
  claimLeague, filterText,
  type MatchConfig,
} from '../src/index.ts';

function cfg(chars: string[], stage = 'rooftop', stocks = 3): MatchConfig {
  return { stageId: stage, stocks, timeLimit: 0, teams: false, players: chars.map((c, i) => ({ charId: c, skin: 0, team: i, name: 'P' + i })) };
}

test('bot vs bot matches finish on every stage with every fighter', () => {
  for (const [si, stage] of STAGES.entries()) {
    // every fighter appears on every few stages; every stage sees several match-ups
    for (let i = si % 4; i < FIGHTERS.length; i += 4) {
      const a = FIGHTERS[i].id, b = FIGHTERS[(i + 1 + si) % FIGHTERS.length].id;
      const g = createGame(cfg([a, b], stage.id, 2));
      const brains = [createBrain(9, 1 + i), createBrain(9, 99 + i)];
      let f = 0;
      while (!g.over && f < 60 * 60 * 6) {
        step(g, brains.map((br, s) => botInput(g, s, br)));
        f++;
        for (const x of g.fighters) {
          assert.ok(Number.isFinite(x.x) && Number.isFinite(x.y), `NaN position ${x.charId} ${x.action}`);
        }
      }
      assert.ok(g.over, `match ${a} vs ${b} on ${stage.id} did not finish (frame ${f})`);
    }
  }
});

test('4-player FFA finishes', () => {
  const g = createGame(cfg(['blaze', 'boulder', 'pip', 'kira'], 'bazaar', 2));
  const brains = [0, 1, 2, 3].map((i) => createBrain(7, i + 5));
  let f = 0;
  while (!g.over && f < 60 * 60 * 8) { step(g, brains.map((br, s) => botInput(g, s, br))); f++; }
  assert.ok(g.over);
});

test('forward smash KOs a mid-weight from centre around 90-170%', () => {
  const results: number[] = [];
  for (const pct of [60, 80, 100, 120, 140, 160, 180]) {
    const g = createGame(cfg(['blaze', 'blaze'], 'dojo'));
    g.fighters[0].x = 0; g.fighters[1].x = 50; g.fighters[0].facing = 1;
    g.fighters[1].damage = pct;
    for (let i = 0; i < 200; i++) step(g, [0, 0]);
    step(g, [Btn.STRONG, 0]);
    let ko = false;
    for (let i = 0; i < 300; i++) { step(g, [0, 0]); if (g.fighters[1].stocks < 3) { ko = true; break; } }
    if (ko) results.push(pct);
  }
  const first = results[0];
  assert.ok(first !== undefined && first >= 80 && first <= 170, `fsmash first KO at ${first}`);
});

test('ground jump and double jump work', () => {
  const g = createGame(cfg(['blaze', 'boulder']));
  for (let i = 0; i < 200; i++) step(g, [0, 0]);
  assert.ok(g.fighters[0].grounded);
  step(g, [Btn.JUMP, 0]);
  for (let i = 0; i < 6; i++) step(g, [Btn.JUMP, 0]);
  assert.ok(!g.fighters[0].grounded && g.fighters[0].vy < 0);
  for (let i = 0; i < 20; i++) step(g, [0, 0]);
  const before = g.fighters[0].jumps;
  step(g, [Btn.JUMP, 0]);
  assert.equal(g.fighters[0].jumps, before - 1);
});

test('state encoding round-trips fighters', () => {
  const g = createGame(cfg(['blaze', 'volt']));
  for (let i = 0; i < 250; i++) step(g, [Btn.RIGHT, Btn.LEFT | Btn.ATTACK]);
  const c = cloneState(g);
  const enc = JSON.parse(JSON.stringify(encodeFighters(g.fighters)));
  for (const f of c.fighters) { f.x = 999; f.action = 'dead'; }
  applyFighters(c.fighters, enc);
  assert.equal(Math.round(c.fighters[0].x), Math.round(g.fighters[0].x));
  assert.equal(c.fighters[1].action, g.fighters[1].action);
});

test('economy: rewards, shop, iap, pass', () => {
  const p = newProfile('u1', 'Tester', Date.UTC(2026, 9, 8));
  const coins0 = p.coins;
  const r = applyMatch(p, { matchId: 'm1', mode: 'casual', won: true, placement: 1, players: 2, kos: 3, falls: 1, dmg: 250, smashKOs: 1, maxCombo: 3, fighter: 'blaze', durationSec: 120 }, Date.UTC(2026, 9, 8));
  assert.ok(r.firstWin && r.coins > 100);
  assert.equal(p.coins, coins0 + r.coins);
  assert.deepEqual(buyItem(p, 'fighter:zephyr:gems'), { ok: false, reason: 'funds' });
  grantIap(p, 'gems_500');
  assert.ok(buyItem(p, 'fighter:zephyr:gems').ok);
  assert.ok(p.fighters.includes('zephyr'));
  assert.deepEqual(buyItem(p, 'fighter:zephyr:coins'), { ok: false, reason: 'owned' });
  p.pass.xp = PASS_XP_PER_TIER * 5;
  assert.equal(passTier(p), 5);
  assert.ok(claimPass(p, 1, false));
  assert.equal(claimPass(p, 1, false), null);
  assert.equal(claimPass(p, 5, true), null);
  grantIap(p, 'season_pass');
  const pr = claimPass(p, 5, true);
  assert.ok(pr?.reward.skin);
});

test('tutorial reward is paid once, achievements and unlocks progress', () => {
  const p = newProfile('u2', 'T');
  assert.equal(featureUnlocked(p, 'shop'), false);
  const coins = p.coins;
  assert.ok(completeTutorial(p, 'basic'));
  assert.equal(completeTutorial(p, 'basic'), null);
  assert.equal(p.coins, coins + 300 + 170); // tutorial reward + level-2 level-up bonus
  assert.equal(p.level, 2);
  assert.equal(featureUnlocked(p, 'online'), false); // online opens after the world map
  assert.equal(claimAchievement(p, 'first_win'), null);
  applyMatch(p, { matchId: 'm', mode: 'cpu', won: true, placement: 1, players: 2, kos: 3, falls: 0, dmg: 200, smashKOs: 1, maxCombo: 5, fighter: 'blaze', durationSec: 90 });
  assert.equal(featureUnlocked(p, 'shop'), true);
  assert.ok(claimAchievement(p, 'first_win'));
  assert.ok(claimAchievement(p, 'combo_5'));
  assert.equal(claimAchievement(p, 'first_win'), null);
  assert.equal(p.history.length, 1);
  assert.equal(p.fstats.blaze.w, 1);
  // old saves get the new fields
  const old = JSON.parse(JSON.stringify(p)) as Profile;
  delete (old as any).ach; delete (old as any).history; delete (old as any).fstats;
  migrateProfile(old);
  assert.deepEqual(old.ach, []);
});

test('progression: map, upgrades, spells, milestones, wheel, leagues', () => {
  const p = newProfile('u3', 'M');
  assert.equal(mapNodes().length, MAP_SIZE);
  assert.equal(clearMapNode(p, 3, true, 0), null);       // can't skip ahead
  const c = clearMapNode(p, 0, true, 0)!;
  assert.ok(c.firstClear && c.stars === 3 && p.map.cleared === 1);
  assert.equal(clearMapNode(p, 0, true, 2)!.firstClear, false);
  for (let i = 1; i < MAP_SIZE; i++) clearMapNode(p, i, true, 1);
  assert.equal(featureUnlocked(p, 'online'), true);
  assert.ok(p.fighters.length > 2, 'bosses unlock fighters');
  // card upgrades
  p.cards.blaze = 100; p.coins = 100000;
  assert.ok(upgradeStat(p, 'blaze', 'atk'));
  assert.ok(fighterMods(p, 'blaze').atk > 1);
  // spells
  p.runes = 1000;
  assert.ok(learnSpell(p, 'thunder'));
  assert.ok(equipSpell(p, 'blaze', 'thunder'));
  assert.equal(fighterMods(p, 'blaze').spell, 'thunder');
  // milestones
  p.daily.fights = 3;
  assert.ok(claimMilestone(p, 0)); assert.ok(claimMilestone(p, 1)); assert.equal(claimMilestone(p, 2), null);
  // wheel: one free spin a day
  assert.ok(spinWheel(p, 'd1', false)); assert.equal(spinWheel(p, 'd1', false), null);
  // leagues
  assert.equal(leagueSteps().length, 13);
  assert.equal(tierFor(1000).tier.id, 'bronze');
  assert.equal(tierFor(1900).tier.id, 'legendary');
  p.rank.peak = 1320;
  assert.ok(claimLeague(p, 'gold3')); assert.equal(claimLeague(p, 'crystal3'), null);
  assert.ok(filterText('you are a fuck').flagged);
});

test('spells and upgrades work in the simulation', () => {
  const base = cfg(['blaze', 'blaze'], 'dojo');
  base.players[0].mods = { atk: 1.2, def: 1, hp: 1, spell: 'nova', spellLv: 3 };
  const g = createGame(base);
  for (let i = 0; i < 200; i++) step(g, [0, 0]);
  g.fighters[0].x = 0; g.fighters[1].x = 40; g.fighters[0].mana = 100;
  step(g, [Btn.MAGIC, 0]);
  assert.equal(g.fighters[0].mana, 0);
  for (let i = 0; i < 20; i++) step(g, [0, 0]);
  assert.ok(g.fighters[1].damage >= 16, 'nova hits with level + attack bonus: ' + g.fighters[1].damage);
});

test('weekly league: Saturday 15:00 → next Saturday 14:00 Tehran, podium prizes and trophies', async () => {
  const L = await import('../src/index.ts');
  const w = L.weekWindow(L.weekId(Date.UTC(2026, 9, 10, 12, 0)));
  // 11:30 UTC = 15:00 Tehran on a Saturday, closes 10:30 UTC = 14:00 Tehran the next Saturday
  assert.equal(new Date(w.start).getUTCDay(), 6);
  assert.equal(new Date(w.start).getUTCHours() * 60 + new Date(w.start).getUTCMinutes(), 11 * 60 + 30);
  assert.equal(w.end - w.start, 7 * 86400_000 - 3600_000);
  assert.ok(L.leagueBreak(w.end + 1000) && !L.leagueBreak(w.end - 1000));
  const now = w.start + 3600_000;
  const ps = [0, 1, 2, 3].map((i) => L.newProfile('w' + i, 'W' + i, now));
  ps.forEach((p, i) => { for (let k = 0; k <= i; k++) L.addWeekResult(p, true, 0, now); });
  L.settleWeek(L.weekId(now), ps, w.end + 10);
  assert.equal(ps[3].trophies[0].place, 1);
  assert.equal(ps[2].trophies[0].place, 2);
  assert.equal(ps[1].trophies[0].place, 3);
  assert.equal(ps[0].trophies.length, 0);
  assert.ok(ps[3].inbox[0].reward!.runes! >= 300);
  // settling twice pays once
  L.settleWeek(L.weekId(now), ps, w.end + 20);
  assert.equal(ps[3].trophies.length, 1);
});

test('clan attacks: declaration rules, live fights, result', async () => {
  const S = await import('../src/index.ts');
  const db = S.newSocialDb();
  const profiles: Record<string, Profile> = {};
  let now = Date.UTC(2026, 9, 10);
  const ctx = () => ({ db, now, rand: Math.random, profileOf: (id: string) => profiles[id] ?? null });
  const mk = (id: string) => { const p = S.newProfile(id, id, now); p.coins = 99999; p.gems = 99999; profiles[id] = p; return p; };
  const a = [mk('a1'), mk('a2'), mk('a3')], d = [mk('d1'), mk('d2'), mk('d3')];
  const A = S.clanCreate(ctx(), a[0], { name: 'Attackers', tag: 'ATK', badge: 1, desc: '', type: 'open', minMmr: 0 });
  const D = S.clanCreate(ctx(), d[0], { name: 'Defenders', tag: 'DEF', badge: 2, desc: '', type: 'open', minMmr: 0 });
  for (const p of a.slice(1)) S.clanJoin(ctx(), p, A.id);
  for (const p of d.slice(1)) S.clanJoin(ctx(), p, D.id);
  // level 1 clan can't attack; new clans are protected
  assert.throws(() => S.raidDeclare(ctx(), a[0], D.id, now + 2 * 3600_000), /raid-level/);
  S.clanDonateGems(ctx(), a[0], 2000); S.clanUpgrade(ctx(), a[0]);
  assert.throws(() => S.raidDeclare(ctx(), a[0], D.id, now + 2 * 3600_000), /raid-shield/);
  now += 49 * 3600_000;
  // must be at least one hour ahead
  assert.throws(() => S.raidDeclare(ctx(), a[0], D.id, now + 10 * 60_000), /raid-time/);
  // a plain member can't declare
  assert.throws(() => S.raidDeclare(ctx(), a[1], D.id, now + 2 * 3600_000), /perm/);
  const r = S.raidDeclare(ctx(), a[0], D.id, now + 3600_000);
  assert.equal(r.slots.length, 3);
  // only one outgoing raid
  assert.throws(() => S.raidDeclare(ctx(), a[0], D.id, now + 3600_000), /raid-busy/);
  // defenders prepare
  S.clanDonateGems(ctx(), d[0], 500);
  S.raidFortify(ctx(), d[0], r.id);
  assert.equal(r.fort, 1);
  // can't fight before it opens
  assert.throws(() => S.raidFightStart(ctx(), a[1], r.id, 0), /raid-closed/);
  now = r.start + 1000; S.raidTick(ctx());
  assert.equal(r.status, 'live');
  // an impossible report (400 s claimed 1 s after the ticket) is rejected and flagged
  const cf = S.raidFightStart(ctx(), a[2], r.id, 2);
  now += 1000;
  assert.throws(() => S.raidFightEnd(ctx(), a[2], cf.id, { won: true, falls: 0, kos: 3, durationSec: 400, dmg: 300 }), /cheat/);
  assert.ok(db.cheats!.a3.score > 0);
  for (let slot = 0; slot < 3; slot++) {
    const p = a[slot];
    const f = S.raidFightStart(ctx(), p, r.id, slot);
    now += 100_000;
    const out = S.raidFightEnd(ctx(), p, f.id, { won: true, falls: 0, kos: 2, durationSec: 95, dmg: 300 });
    assert.equal(out.stars, 3);
  }
  assert.throws(() => S.raidFightStart(ctx(), a[0], r.id, 0), /raid-cleared/);
  now = r.end + 1; S.raidTick(ctx());
  assert.equal(r.status, 'done');
  assert.ok(r.result!.won);
  assert.ok((D.rd!.shieldUntil) > now, 'defender gets a shield');
  assert.ok(A.rd!.cdUntil > now, 'attacker gets a cooldown');
  assert.ok(profiles.a1.inbox.some((m) => m.reward?.runes));
});

test('anti-cheat: implausible offline results add suspicion', async () => {
  const S = await import('../src/index.ts');
  const chk = S.checkSummary({ matchId: 'x', mode: 'cpu', won: true, placement: 1, players: 2, kos: 9, falls: 0, dmg: 900, smashKOs: 0, maxCombo: 3, fighter: 'blaze', durationSec: 5 }, { foes: 1, stocks: 3, recentPerHour: 3 });
  assert.ok(chk.pts >= 10, chk.reasons.join());
  const ok = S.checkSummary({ matchId: 'y', mode: 'cpu', won: true, placement: 1, players: 2, kos: 3, falls: 1, dmg: 320, smashKOs: 1, maxCombo: 4, fighter: 'blaze', durationSec: 140 }, { foes: 1, stocks: 3, recentPerHour: 3 });
  assert.equal(ok.pts, 0);
});
