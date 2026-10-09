import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newAnalyticsStore, newProfile, newSocialDb } from '@nb/shared';
import type { DbShape, StorageAdapter } from '../src/storage/adapter.ts';
import { JsonAdapter } from '../src/storage/json.ts';
import { PostgresAdapter } from '../src/storage/postgres.ts';

/** Plain-JSON view of a snapshot as an adapter persists it (the rate limiter is never stored). */
const norm = (db: DbShape) => JSON.parse(JSON.stringify(db, (k, v) => (k === 'rate' ? undefined : v)));

function sampleDb(): DbShape {
  const social = newSocialDb();
  (social as any).rate = { u1: [1, 2, 3] };
  const db: DbShape = {
    users: {}, byToken: {}, usedPurchaseTokens: {}, social, analytics: newAnalyticsStore(), meta: { remoteConfig: { economy: { matchCoinMult: 2 } } }, replayIndex: {},
  };
  for (let i = 0; i < 3; i++) {
    const id = 'u' + i;
    db.users[id] = { token: 't' + i, profile: newProfile(id, 'Player ' + i), purchaseTokens: [], ads: { day: '', count: 0 }, act: { installDay: '2026-10-01', lastDay: '2026-10-02' } };
    db.byToken['t' + i] = id;
  }
  db.usedPurchaseTokens['gp-1'] = 'u1';
  db.analytics.days['2026-10-01'] = { installs: 3, dau: 3, 'ev:screen:home': 7 };
  db.analytics.days['2026-10-02'] = { dau: 2, ret1: 2 };
  db.replayIndex.u0 = [{ id: 'm1', at: 1, mode: 'casual', frames: 600, winnerTeam: 0, slot: 0, players: [{ name: 'A', fighter: 'blaze', team: 0 }, { name: 'B', fighter: 'kira', team: 1 }] }];
  return db;
}

/** The contract every storage adapter must satisfy. `reopen` gives a fresh instance on the same store. */
async function contract(reopen: () => StorageAdapter) {
  let a = reopen();
  await a.init();
  await a.init(); // migrations are idempotent
  assert.equal(await a.load(), null, 'empty store loads as null');

  const db = sampleDb();
  await a.save(db);
  await a.save(db); // unchanged → no-op, must not fail
  await a.close();

  a = reopen();
  await a.init();
  let back = await a.load();
  assert.ok(back);
  assert.equal((back!.social as any).rate, undefined, 'rate limiter not persisted');
  assert.deepEqual(norm(back!), norm(db));

  // changes: edit a user, add a user, drop a token, drop an analytics day, change meta / social / index
  back!.users.u1.profile.coins = 4242;
  back!.users.u9 = { token: 't9', profile: newProfile('u9', 'New'), purchaseTokens: [], ads: { day: '2026-10-03', count: 1 } };
  back!.byToken.t9 = 'u9';
  delete back!.byToken.t2;
  delete back!.analytics.days['2026-10-01'];
  back!.analytics.days['2026-10-02'].dau = 5;
  back!.meta.broadcasts = [{ t: 5, title: 'hi', recipients: 3 }];
  back!.social.reports.push({ id: 'r1', t: 1, by: 'u0', target: 'u1', reason: 'spam' } as any);
  back!.replayIndex.u1 = [];
  await a.save(back!);
  await a.close();

  a = reopen();
  await a.init();
  const again = await a.load();
  assert.deepEqual(norm(again!), norm(back!));
  assert.equal(again!.users.u1.profile.coins, 4242);
  assert.equal(again!.byToken.t2, undefined);
  assert.equal(again!.analytics.days['2026-10-01'], undefined);

  // replay blobs live outside the snapshot
  assert.equal(await a.getReplay('nope'), null);
  await a.putReplay({ id: 'm1', at: 1_700_000_000_000, code: 'NBR1.AAAA', meta: { mode: 'casual' } });
  await a.putReplay({ id: 'm2', at: 1_700_000_000_500, code: 'NBR1.BBBB' });
  const r1 = await a.getReplay('m1');
  assert.equal(r1?.code, 'NBR1.AAAA');
  assert.equal(r1?.at, 1_700_000_000_000);
  await a.deleteReplays(['m1', 'missing']);
  assert.equal(await a.getReplay('m1'), null);
  assert.equal((await a.getReplay('m2'))?.code, 'NBR1.BBBB');
  await a.close();
}

test('storage contract: JSON file adapter', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-store-'));
  try {
    await contract(() => new JsonAdapter(dir));
    assert.ok(fs.existsSync(path.join(dir, 'db.json')));
    assert.equal(fs.existsSync(path.join(dir, 'db.json.tmp')), false, 'atomic rename leaves no temp file');
    // path traversal in replay ids is neutralised
    const a = new JsonAdapter(dir);
    await a.init();
    await a.putReplay({ id: '../../evil', at: 1, code: 'x' });
    assert.equal(fs.existsSync(path.join(dir, '..', 'evil.json')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('storage contract: PostgreSQL adapter (only when DATABASE_URL is set)', { skip: !process.env.DATABASE_URL && 'DATABASE_URL not set' }, async () => {
  const schema = 'nb_test_' + Math.random().toString(36).slice(2, 8);
  const open = () => new PostgresAdapter(process.env.DATABASE_URL!, { schema });
  try {
    await contract(open);
  } finally {
    const a = open();
    await a.init();
    await a.dropAll();
    await (a as any).pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await a.close();
  }
});
