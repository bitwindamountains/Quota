import { SQLite } from './sqlite.js';
import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { metricSchema, type Metric, type Source, type SourceInput } from '../shared/model.js';

export class AppError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
type Row = { id: string; config: string; revision: number; position: number; last_attempt: string | null; last_success: string | null; error: string | null; failures: number; next_attempt: number; auth_paused: number; fingerprint: string | null };
export class Store {
  db: SQLite;
  constructor(public path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const existed = path !== ':memory:' && existsSync(path);
    this.db = new SQLite(path);
    try {
      this.db.pragma('foreign_keys = ON'); this.db.pragma('busy_timeout = 5000');
      if (this.db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('Database check failed. Restore a backup; original files have been preserved.');
      const version = this.db.pragma('user_version', { simple: true }) as number;
      if (version > 3) throw new Error('Database is newer than this app. Use the matching app version.');
      if (version < 1) {
        if (existed) this.db.exec("VACUUM INTO '" + path.replaceAll("'", "''") + ".before-v1-" + Date.now() + "'");
        this.db.transaction(() => {
          this.db.exec(`
            CREATE TABLE sources (
              id TEXT PRIMARY KEY, config TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
              position INTEGER NOT NULL, last_attempt TEXT, last_success TEXT, error TEXT,
              failures INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0,
              auth_paused INTEGER NOT NULL DEFAULT 0, fingerprint TEXT
            );
            CREATE TABLE runs (
              id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
              started_at TEXT NOT NULL, finished_at TEXT, outcome TEXT NOT NULL, error TEXT
            );
            CREATE TABLE metrics (
              source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
              metric_key TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
              PRIMARY KEY(source_id, metric_key)
            );
            CREATE TABLE observations (
              id TEXT PRIMARY KEY, source_id TEXT NOT NULL, metric_key TEXT NOT NULL,
              run_id TEXT NOT NULL REFERENCES runs(id), observed_at TEXT NOT NULL, payload TEXT NOT NULL,
              FOREIGN KEY(source_id, metric_key) REFERENCES metrics(source_id, metric_key) ON DELETE CASCADE,
              UNIQUE(run_id, source_id, metric_key), UNIQUE(id, source_id, metric_key)
            );
            CREATE TABLE current_observations (
              source_id TEXT NOT NULL, metric_key TEXT NOT NULL, observation_id TEXT NOT NULL,
              PRIMARY KEY(source_id, metric_key),
              FOREIGN KEY(observation_id, source_id, metric_key) REFERENCES observations(id, source_id, metric_key) ON DELETE CASCADE
            );
            CREATE INDEX observations_history ON observations(source_id, metric_key, observed_at DESC);
            CREATE INDEX runs_history ON runs(source_id, started_at DESC);
            PRAGMA user_version = 1;
          `);
        })();
      }
      if (version < 2) {
        if (existed && version >= 1) this.db.exec("VACUUM INTO '" + path.replaceAll("'", "''") + ".before-v2-" + Date.now() + "'");
        this.db.transaction(() => {
          this.db.exec('CREATE TABLE credentials (source_id TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE, config TEXT NOT NULL); PRAGMA user_version = 2;');
        })();
      }
      if (version < 3) {
        if (existed && version >= 2) this.db.exec("VACUUM INTO '" + path.replaceAll("'", "''") + ".before-v3-" + Date.now() + "'");
        this.db.transaction(() => {
          this.db.exec(`
            CREATE TABLE alarms (
              id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
              metric_key TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL,
              email TEXT, due_at TEXT, UNIQUE(source_id, metric_key)
            );
            CREATE TABLE reminder_events (
              id TEXT PRIMARY KEY, alarm_id TEXT NOT NULL REFERENCES alarms(id) ON DELETE CASCADE,
              source_name TEXT NOT NULL, metric_label TEXT NOT NULL, due_at TEXT NOT NULL,
              email TEXT, email_state TEXT NOT NULL, email_error TEXT,
              attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0,
              notified INTEGER NOT NULL DEFAULT 0, dismissed INTEGER NOT NULL DEFAULT 0,
              UNIQUE(alarm_id, due_at)
            );
            CREATE INDEX reminder_email_queue ON reminder_events(email_state, next_attempt);
            PRAGMA user_version = 3;
          `);
        })();
      }
      this.db.pragma('journal_mode = WAL');
      // An interrupted process never turns an in-flight attempt into success.
      this.db.prepare("UPDATE runs SET outcome = 'interrupted' WHERE outcome = 'running'").run();
      if (path !== ':memory:' && process.platform !== 'win32') chmodSync(path, 0o600);
    } catch (e) { this.db.close(); throw e; }
  }
  list(): Source[] {
    return (this.db.prepare('SELECT * FROM sources ORDER BY position, id').all() as Row[]).map(row => this.fromRow(row));
  }
  get(id: string): Source {
    const row = this.db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new AppError(404, 'Source not found.');
    return this.fromRow(row);
  }
  private fromRow(row: Row): Source {
    const data = this.db.prepare(`SELECT o.payload FROM current_observations c
      JOIN observations o ON o.id = c.observation_id JOIN metrics m ON m.source_id=c.source_id AND m.metric_key=c.metric_key
      WHERE c.source_id = ? AND m.active = 1 ORDER BY o.rowid`).all(row.id) as { payload: string }[];
    return { ...JSON.parse(row.config) as SourceInput, id: row.id, revision: row.revision,
      position: row.position, metrics: data.map(r => metricSchema.parse(JSON.parse(r.payload))),
      lastAttempt: row.last_attempt, lastSuccess: row.last_success, error: row.error,
      failures: row.failures, nextAttempt: row.next_attempt, authPaused: !!row.auth_paused };
  }
  add(input: SourceInput): Source {
    if (this.list().length >= 50) throw new AppError(400, 'This workspace supports up to 50 sources.');
    const id = randomUUID();
    this.db.prepare('INSERT INTO sources(id,config,position) VALUES(?,?,?)').run(id, JSON.stringify(input), Math.max(-1, ...this.list().map(s => s.position)) + 1);
    return this.get(id);
  }
  update(id: string, revision: number, input: SourceInput, position?: number): Source {
    const old = this.get(id);
    if (old.revision !== revision) throw new AppError(409, 'This source changed in another tab. Close and reopen the editor.');
    if (input.provider !== old.provider || input.scope !== old.scope) throw new AppError(400, 'Create a new source to change provider or account scope.');
    this.db.prepare(`UPDATE sources SET config=?, position=?, revision=revision+1, auth_paused=0
      WHERE id=?`).run(JSON.stringify(input), position ?? old.position, id);
    return this.get(id);
  }
  remove(id: string, revision: number) {
    if (this.get(id).revision !== revision) throw new AppError(409, 'Source changed. Reload before removing it.');
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM current_observations WHERE source_id=?').run(id);
      this.db.prepare('DELETE FROM observations WHERE source_id=?').run(id);
      this.db.prepare('DELETE FROM sources WHERE id=?').run(id);
    })();
  }
  reorder(order: { id: string; revision: number }[]) {
    this.db.transaction(() => {
      const sources = this.list();
      if (sources.length !== order.length || new Set(order.map(s => s.id)).size !== sources.length)
        throw new AppError(409, 'The source list changed. Refresh and try again.');
      for (const [position, item] of order.entries()) {
        const current = sources.find(s => s.id === item.id);
        if (!current || current.revision !== item.revision) throw new AppError(409, 'The source list changed. Refresh and try again.');
        this.db.prepare('UPDATE sources SET position=?,revision=revision+1 WHERE id=?').run(position, item.id);
      }
    })();
  }
  begin(source: Source, now: number) {
    const id = randomUUID(), at = new Date(now).toISOString();
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO runs(id,source_id,started_at,outcome) VALUES(?,?,?,?)').run(id, source.id, at, 'running');
      this.db.prepare('UPDATE sources SET last_attempt=? WHERE id=?').run(at, source.id);
    })();
    return id;
  }
  accept(source: Source, runId: string, metrics: Metric[], now: number, nextAttempt: number, fingerprint?: string) {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT * FROM sources WHERE id=?').get(source.id) as Row | undefined;
      if (!row || row.revision !== source.revision) {
        this.db.prepare("UPDATE runs SET outcome='superseded',finished_at=? WHERE id=?").run(new Date(now).toISOString(), runId);
        return false;
      }
      if (fingerprint && row.fingerprint && row.fingerprint !== fingerprint) throw new AppError(409, 'The connected account changed. Create a new source for that account.');
      this.db.prepare('UPDATE metrics SET active=0 WHERE source_id=?').run(source.id);
      for (const input of metrics) {
        const m = metricSchema.parse(input);
        this.db.prepare('INSERT INTO metrics(source_id,metric_key,active) VALUES(?,?,1) ON CONFLICT DO UPDATE SET active=1').run(source.id, m.key);
        const current = this.db.prepare('SELECT o.observed_at FROM current_observations c JOIN observations o ON o.id=c.observation_id WHERE c.source_id=? AND c.metric_key=?').get(source.id, m.key) as { observed_at: string } | undefined;
        if (current && Date.parse(current.observed_at) > Date.parse(m.observedAt)) continue;
        const oid = randomUUID();
        this.db.prepare('INSERT INTO observations(id,source_id,metric_key,run_id,observed_at,payload) VALUES(?,?,?,?,?,?)').run(oid, source.id, m.key, runId, m.observedAt, JSON.stringify(m));
        this.db.prepare('INSERT INTO current_observations VALUES(?,?,?) ON CONFLICT DO UPDATE SET observation_id=excluded.observation_id').run(source.id, m.key, oid);
      }
      this.db.prepare('DELETE FROM current_observations WHERE source_id=? AND metric_key IN (SELECT metric_key FROM metrics WHERE source_id=? AND active=0)').run(source.id, source.id);
      this.db.prepare("UPDATE runs SET finished_at=?, outcome='ok' WHERE id=?").run(new Date(now).toISOString(), runId);
      this.db.prepare('UPDATE sources SET last_success=?,error=NULL,failures=0,auth_paused=0,next_attempt=?,fingerprint=COALESCE(?,fingerprint) WHERE id=?')
        .run(new Date(now).toISOString(), nextAttempt, fingerprint ?? null, source.id);
      return true;
    })();
  }
  manual(id: string, revision: number, metrics: Metric[]) {
    this.db.transaction(() => {
      const source = this.get(id);
      if (source.revision !== revision) throw new AppError(409, 'This source changed. Close and reopen the editor.');
      if (source.mode !== 'manual') throw new AppError(400, 'Switch to manual mode before entering values.');
      for (const metric of metrics) {
        if (metric.provenance !== 'user_entered' && JSON.stringify(source.metrics.find(m => m.key === metric.key)) !== JSON.stringify(metric))
          throw new AppError(400, 'New or changed manual readings must be labeled user-entered.');
      }
      const now = Date.now(), run = this.begin(source, now);
      this.accept(source, run, metrics, now, 0);
      this.db.prepare('UPDATE sources SET revision=revision+1 WHERE id=?').run(id);
    })();
    return this.get(id);
  }
  fail(source: Source, runId: string, error: string, next: number, pause: boolean) {
    this.db.transaction(() => {
      this.db.prepare("UPDATE runs SET finished_at=?,outcome='error',error=? WHERE id=?").run(new Date().toISOString(), error, runId);
      this.db.prepare('UPDATE sources SET error=?,failures=failures+1,next_attempt=?,auth_paused=? WHERE id=? AND revision=?').run(error, next, Number(pause), source.id, source.revision);
    })();
  }
  permitRetry(id: string) { this.db.prepare('UPDATE sources SET auth_paused=0 WHERE id=?').run(id); }
  cleanup(now = Date.now()) {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM observations WHERE observed_at < ? AND id NOT IN (SELECT observation_id FROM current_observations)').run(new Date(now - 30 * 86400000).toISOString());
      this.db.prepare('DELETE FROM runs WHERE started_at < ? AND id NOT IN (SELECT run_id FROM observations)').run(new Date(now - 7 * 86400000).toISOString());
      this.db.prepare('UPDATE runs SET error=NULL WHERE started_at < ?').run(new Date(now - 7 * 86400000).toISOString());
    })();
  }
  async backup(path: string) { await this.db.backup(path); }
  close() { this.db.close(); }
}
