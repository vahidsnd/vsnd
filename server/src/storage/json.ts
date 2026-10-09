import fs from 'node:fs';
import path from 'node:path';
import { persistReplacer, type DbShape, type ReplayRow, type StorageAdapter } from './adapter.ts';

const safeId = (id: string) => String(id).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);

/** Default storage: one JSON file (atomic rename) + one small file per replay. */
export class JsonAdapter implements StorageAdapter {
  readonly kind = 'json' as const;
  private file: string;
  private replayDir: string;
  constructor(private dir: string) {
    this.file = path.join(dir, 'db.json');
    this.replayDir = path.join(dir, 'replays');
  }
  async init() {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.mkdirSync(this.replayDir, { recursive: true });
  }
  async load(): Promise<DbShape | null> {
    if (!fs.existsSync(this.file)) return null;
    return JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }
  async save(db: DbShape) { this.saveSync(db); }
  saveSync(db: DbShape) {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, persistReplacer));
    fs.renameSync(tmp, this.file);
  }
  async putReplay(row: ReplayRow) {
    const id = safeId(row.id);
    if (!id) return;
    fs.writeFileSync(path.join(this.replayDir, id + '.json'), JSON.stringify(row));
  }
  async getReplay(id: string): Promise<ReplayRow | null> {
    const f = path.join(this.replayDir, safeId(id) + '.json');
    if (!safeId(id) || !fs.existsSync(f)) return null;
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
  }
  async deleteReplays(ids: string[]) {
    for (const id of ids) { try { fs.unlinkSync(path.join(this.replayDir, safeId(id) + '.json')); } catch { /* already gone */ } }
  }
  async close() { /* nothing to release */ }
}
