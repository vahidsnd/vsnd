/**
 * One-off migration: copy the JSON file store (DATA_DIR/db.json + DATA_DIR/replays/*.json) into PostgreSQL.
 *   DATA_DIR=./data DATABASE_URL=postgresql://... npx tsx server/scripts/json-to-pg.ts
 * Stop the game server first. Refuses to overwrite a non-empty database unless FORCE=1.
 */
import fs from 'node:fs';
import path from 'node:path';
import { newAnalyticsStore, newSocialDb } from '@nb/shared';
import type { DbShape, ReplayRow } from '../src/storage/adapter.ts';
import { JsonAdapter } from '../src/storage/json.ts';
import { PostgresAdapter } from '../src/storage/postgres.ts';

const dir = process.env.DATA_DIR ?? new URL('../data/', import.meta.url).pathname;
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is required'); process.exit(1); }

const src = new JsonAdapter(dir);
await src.init();
const loaded = await src.load();
if (!loaded) { console.error(`no db.json in ${dir}`); process.exit(1); }
const db = loaded as DbShape;
db.users ??= {}; db.byToken ??= {}; db.usedPurchaseTokens ??= {};
db.social ??= newSocialDb(); db.analytics ??= newAnalyticsStore(); db.analytics.days ??= {};
db.meta ??= {}; db.replayIndex ??= {};

const dst = new PostgresAdapter(url);
await dst.init();
const existing = await dst.load();
if (existing && Object.keys(existing.users).length && process.env.FORCE !== '1') {
  console.error(`target already has ${Object.keys(existing.users).length} users; set FORCE=1 to merge/overwrite`);
  await dst.close();
  process.exit(1);
}
await dst.save(db);

let replays = 0;
const rdir = path.join(dir, 'replays');
for (const f of fs.existsSync(rdir) ? fs.readdirSync(rdir) : []) {
  if (!f.endsWith('.json')) continue;
  try {
    const row = JSON.parse(fs.readFileSync(path.join(rdir, f), 'utf8')) as ReplayRow;
    await dst.putReplay(row);
    replays++;
  } catch (e) { console.warn('skip replay', f, (e as Error).message); }
}
await dst.close();
console.log(`migrated ${Object.keys(db.users).length} users, ${replays} replays → PostgreSQL`);
