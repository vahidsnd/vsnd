import { newAnalyticsStore, newSocialDb } from '@nb/shared';
import { persistReplacer, type DbShape, type ReplayRow, type StorageAdapter } from './adapter.ts';

// `pg` is loaded lazily so the default JSON deployment never needs it installed.
type Pool = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }>; end: () => Promise<void> };

/** Schema migrations, applied in order and recorded in nb_schema. */
const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
   CREATE TABLE IF NOT EXISTS tokens (token text PRIMARY KEY, user_id text NOT NULL);
   CREATE INDEX IF NOT EXISTS tokens_user_idx ON tokens(user_id);
   CREATE TABLE IF NOT EXISTS purchases (token text PRIMARY KEY, user_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
   CREATE TABLE IF NOT EXISTS social_state (id int PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
   CREATE TABLE IF NOT EXISTS kv (key text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
   CREATE TABLE IF NOT EXISTS replays (id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), meta jsonb, code text NOT NULL);
   CREATE TABLE IF NOT EXISTS replay_index (user_id text PRIMARY KEY, entries jsonb NOT NULL);
   CREATE TABLE IF NOT EXISTS analytics_daily (day text NOT NULL, key text NOT NULL, count bigint NOT NULL, PRIMARY KEY (day, key));`,
];

const CHUNK = 500;
const json = (v: unknown) => JSON.stringify(v, persistReplacer);
// Postgres jsonb rejects \u0000
const clean = (s: string) => s.replace(/\\u0000/g, '');

/**
 * PostgreSQL storage (used when DATABASE_URL is set). Same write-behind model as the JSON file:
 * everything is loaded on start; save() diffs the snapshot against what was last written and
 * upserts only changed rows, in batches, inside one transaction.
 */
export class PostgresAdapter implements StorageAdapter {
  readonly kind = 'postgres' as const;
  private pool!: Pool;
  private users = new Map<string, string>();
  private tokens = new Set<string>();
  private purchases = new Set<string>();
  private social = '';
  private meta = '';
  private rindex = new Map<string, string>();
  private counters = new Map<string, number>();

  constructor(private url: string, private opts: { schema?: string } = {}) {}

  async init() {
    let mod: any;
    try { mod = await import('pg'); } catch {
      throw new Error('DATABASE_URL is set but the "pg" package is not installed: run `npm install pg --workspace server`');
    }
    const PgPool = mod.default?.Pool ?? mod.Pool;
    const schema = this.opts.schema?.replace(/[^a-z0-9_]/gi, '');
    this.pool = new PgPool({ connectionString: this.url, max: 5, ...(schema ? { options: `-c search_path=${schema}` } : {}) });
    if (schema) await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await this.pool.query('CREATE TABLE IF NOT EXISTS nb_schema (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await this.pool.query('SELECT version FROM nb_schema')).rows.map((r) => Number(r.version)));
    for (let v = 1; v <= MIGRATIONS.length; v++) {
      if (done.has(v)) continue;
      await this.tx(async (q) => {
        await q(MIGRATIONS[v - 1]);
        await q('INSERT INTO nb_schema(version) VALUES ($1) ON CONFLICT DO NOTHING', [v]);
      });
    }
  }

  private async tx(fn: (q: (t: string, v?: unknown[]) => Promise<{ rows: any[] }>) => Promise<void>) {
    const client = await (this.pool as any).connect();
    try {
      await client.query('BEGIN');
      await fn((t, v) => client.query(t, v));
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally { client.release(); }
  }

  async load(): Promise<DbShape | null> {
    const q = (t: string) => this.pool.query(t);
    const [users, tokens, purchases, social, kv, rindex, counters] = await Promise.all([
      q('SELECT id, data FROM users'), q('SELECT token, user_id FROM tokens'), q('SELECT token, user_id FROM purchases'),
      q('SELECT data FROM social_state WHERE id = 1'), q("SELECT key, data FROM kv WHERE key = 'meta'"),
      q('SELECT user_id, entries FROM replay_index'), q('SELECT day, key, count FROM analytics_daily'),
    ]);
    if (!users.rows.length && !social.rows.length && !kv.rows.length) return null;
    const db: DbShape = { users: {}, byToken: {}, usedPurchaseTokens: {}, social: social.rows[0]?.data ?? newSocialDb(), analytics: newAnalyticsStore(), meta: kv.rows[0]?.data ?? {}, replayIndex: {} };
    for (const r of users.rows) { db.users[r.id] = r.data; this.users.set(r.id, clean(json(r.data))); }
    for (const r of tokens.rows) { db.byToken[r.token] = r.user_id; this.tokens.add(r.token); }
    for (const r of purchases.rows) { db.usedPurchaseTokens[r.token] = r.user_id; this.purchases.add(r.token); }
    for (const r of rindex.rows) { db.replayIndex[r.user_id] = r.entries; this.rindex.set(r.user_id, clean(json(r.entries))); }
    for (const r of counters.rows) { (db.analytics.days[r.day] ??= {})[r.key] = Number(r.count); this.counters.set(r.day + '|' + r.key, Number(r.count)); }
    this.social = clean(json(db.social));
    this.meta = clean(json(db.meta));
    return db;
  }

  async save(db: DbShape) {
    const users: { id: string; data: unknown }[] = [];
    const userStr = new Map<string, string>();
    for (const [id, u] of Object.entries(db.users)) {
      const s = clean(json(u));
      if (this.users.get(id) !== s) { users.push({ id, data: JSON.parse(s) }); userStr.set(id, s); }
    }
    const newTokens = Object.entries(db.byToken).filter(([t]) => !this.tokens.has(t)).map(([token, user_id]) => ({ token, user_id }));
    const goneTokens = [...this.tokens].filter((t) => !(t in db.byToken));
    const newPurchases = Object.entries(db.usedPurchaseTokens).filter(([t]) => !this.purchases.has(t)).map(([token, user_id]) => ({ token, user_id }));
    const socialStr = clean(json(db.social));
    const metaStr = clean(json(db.meta));
    const rows: { user_id: string; entries: unknown }[] = [];
    const rStr = new Map<string, string>();
    for (const [uid, e] of Object.entries(db.replayIndex)) {
      const s = clean(json(e));
      if (this.rindex.get(uid) !== s) { rows.push({ user_id: uid, entries: e }); rStr.set(uid, s); }
    }
    const counters: { day: string; key: string; count: number }[] = [];
    for (const [day, c] of Object.entries(db.analytics.days)) for (const [key, count] of Object.entries(c)) {
      if (this.counters.get(day + '|' + key) !== count) counters.push({ day, key, count });
    }
    const goneDays = [...new Set([...this.counters.keys()].map((k) => k.split('|')[0]))].filter((d) => !db.analytics.days[d]);
    if (!users.length && !newTokens.length && !goneTokens.length && !newPurchases.length && socialStr === this.social && metaStr === this.meta && !rows.length && !counters.length && !goneDays.length) return;

    await this.tx(async (q) => {
      for (let i = 0; i < users.length; i += CHUNK) {
        await q(`INSERT INTO users (id, data) SELECT id, data FROM jsonb_to_recordset($1::jsonb) AS x(id text, data jsonb)
                 ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [JSON.stringify(users.slice(i, i + CHUNK))]);
      }
      for (let i = 0; i < newTokens.length; i += CHUNK) {
        await q(`INSERT INTO tokens (token, user_id) SELECT token, user_id FROM jsonb_to_recordset($1::jsonb) AS x(token text, user_id text)
                 ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id`, [JSON.stringify(newTokens.slice(i, i + CHUNK))]);
      }
      if (goneTokens.length) await q('DELETE FROM tokens WHERE token = ANY($1::text[])', [goneTokens]);
      for (let i = 0; i < newPurchases.length; i += CHUNK) {
        await q(`INSERT INTO purchases (token, user_id) SELECT token, user_id FROM jsonb_to_recordset($1::jsonb) AS x(token text, user_id text)
                 ON CONFLICT (token) DO NOTHING`, [JSON.stringify(newPurchases.slice(i, i + CHUNK))]);
      }
      if (socialStr !== this.social) await q('INSERT INTO social_state (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()', [socialStr]);
      if (metaStr !== this.meta) await q("INSERT INTO kv (key, data) VALUES ('meta', $1::jsonb) ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()", [metaStr]);
      for (let i = 0; i < rows.length; i += CHUNK) {
        await q(`INSERT INTO replay_index (user_id, entries) SELECT user_id, entries FROM jsonb_to_recordset($1::jsonb) AS x(user_id text, entries jsonb)
                 ON CONFLICT (user_id) DO UPDATE SET entries = EXCLUDED.entries`, [JSON.stringify(rows.slice(i, i + CHUNK))]);
      }
      for (let i = 0; i < counters.length; i += CHUNK) {
        await q(`INSERT INTO analytics_daily (day, key, count) SELECT day, key, count FROM jsonb_to_recordset($1::jsonb) AS x(day text, key text, count bigint)
                 ON CONFLICT (day, key) DO UPDATE SET count = EXCLUDED.count`, [JSON.stringify(counters.slice(i, i + CHUNK))]);
      }
      if (goneDays.length) await q('DELETE FROM analytics_daily WHERE day = ANY($1::text[])', [goneDays]);
    });
    // commit succeeded → remember what is stored
    for (const [id, s] of userStr) this.users.set(id, s);
    for (const t of newTokens) this.tokens.add(t.token);
    for (const t of goneTokens) this.tokens.delete(t);
    for (const p of newPurchases) this.purchases.add(p.token);
    this.social = socialStr; this.meta = metaStr;
    for (const [uid, s] of rStr) this.rindex.set(uid, s);
    for (const c of counters) this.counters.set(c.day + '|' + c.key, c.count);
    for (const k of [...this.counters.keys()]) if (goneDays.includes(k.split('|')[0])) this.counters.delete(k);
  }

  async putReplay(row: ReplayRow) {
    await this.pool.query('INSERT INTO replays (id, created_at, meta, code) VALUES ($1, to_timestamp($2 / 1000.0), $3::jsonb, $4) ON CONFLICT (id) DO NOTHING',
      [row.id, row.at, JSON.stringify(row.meta ?? null), row.code]);
  }
  async getReplay(id: string): Promise<ReplayRow | null> {
    const r = await this.pool.query('SELECT id, extract(epoch from created_at) * 1000 AS at, meta, code FROM replays WHERE id = $1', [id]);
    const x = r.rows[0];
    return x ? { id: x.id, at: Math.round(Number(x.at)), meta: x.meta ?? undefined, code: x.code } : null;
  }
  async deleteReplays(ids: string[]) {
    if (ids.length) await this.pool.query('DELETE FROM replays WHERE id = ANY($1::text[])', [ids]);
  }
  async close() { await this.pool?.end(); }

  /** test helper: drops everything in the adapter's schema */
  async dropAll() {
    await this.pool.query('DROP TABLE IF EXISTS users, tokens, purchases, social_state, kv, replays, replay_index, analytics_daily, nb_schema');
  }
}
