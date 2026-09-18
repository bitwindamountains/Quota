import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/storage.js';
import { SQLite } from '../server/sqlite.js';
import { sourceInputSchema, metricSchema } from '../shared/model.js';
const stores: Store[] = [], dirs: string[] = [];
const db = () => { const s = new Store(':memory:'); stores.push(s); return s; };
const input = sourceInputSchema.parse({ provider: 'custom', name: 'Test' });
const metric = (at = Date.now(), used = '10') => metricSchema.parse({ key: 'one', label: 'Weekly', kind: 'quota', unit: 'percent', usedPercent: used, observedAt: new Date(at).toISOString(), provenance: 'user_entered', freshnessSeconds: 600 });
afterEach(() => { stores.forEach(s => s.close()); stores.length = 0; dirs.forEach(d => rmSync(d, { recursive: true, force: true })); dirs.length = 0; });
describe('SQLite lifecycle', () => {
  it('persists manual values through backup and reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'quota-test-')); dirs.push(dir);
    const store = new Store(join(dir, 'one.db')), source = store.add(input);
    store.manual(source.id, source.revision, [metric()]);
    await store.backup(join(dir, 'backup.db')); store.close();
    const reopened = new Store(join(dir, 'backup.db')); stores.push(reopened);
    expect(reopened.get(source.id).metrics[0].usedPercent).toBe('10');
    expect(reopened.db.pragma('foreign_key_check')).toEqual([]);
  });
  it('protects current readings and referenced runs during retention', () => {
    const store = db(), s = store.add(input);
    store.manual(s.id, 1, [metric(Date.now() - 90 * 86400000)]);
    store.cleanup();
    expect(store.get(s.id).metrics).toHaveLength(1);
    expect(store.db.pragma('foreign_key_check')).toEqual([]);
  });
  it('rejects conflicting edits without losing existing data', () => {
    const store = db(), s = store.add(input);
    store.manual(s.id, 1, [metric()]);
    expect(() => store.manual(s.id, 1, [])).toThrow('changed');
    expect(store.get(s.id).metrics).toHaveLength(1);
  });
  it('discards late results and preserves atomicity', () => {
    const store = db(), s = store.add(input), run = store.begin(s, Date.now());
    store.update(s.id, 1, { ...input, enabled: false });
    expect(store.accept(s, run, [metric()], Date.now(), 0)).toBe(false);
    expect(store.get(s.id).metrics).toEqual([]);
  });
  it('keeps newer observations over out-of-order arrivals', () => {
    const store = db(), s = store.add(input);
    store.manual(s.id, 1, [metric(Date.now(), '30')]);
    store.manual(s.id, 2, [metric(Date.now() - 100000, '5')]);
    expect(store.get(s.id).metrics[0].usedPercent).toBe('30');
  });
  it('binds a collector to its first account and prevents mixing accounts', () => {
    const store = db(), s = store.add(input);
    store.accept(s, store.begin(s, Date.now()), [metric()], Date.now(), 0, 'account-a');
    expect(() => store.accept(s, store.begin(s, Date.now()), [metric(Date.now(), '90')], Date.now(), 0, 'account-b')).toThrow('account changed');
    expect(store.get(s.id).metrics[0].usedPercent).toBe('10');
  });
  it('deletes owned records without foreign key errors', () => {
    const store = db(), s = store.add(input); store.manual(s.id, 1, [metric()]);
    store.remove(s.id, 2); expect(store.list()).toEqual([]); expect(store.db.pragma('foreign_key_check')).toEqual([]);
  });
  it('keeps provider provenance only for unchanged observations during manual fallback', () => {
    const store = db(), s = store.add(input);
    const automatic = { ...metric(), provenance: 'provider_reported' as const };
    store.accept(s, store.begin(s, Date.now()), [automatic], Date.now(), 0);
    expect(() => store.manual(s.id, 1, [{ ...automatic, usedPercent: '90' }])).toThrow('user-entered');
    store.manual(s.id, 1, [automatic, { ...metric(), key: 'second' }]);
    expect(store.get(s.id).metrics).toHaveLength(2);
  });
  it('reorders atomically and rolls back conflicts', () => {
    const store = db(), a = store.add(input), b = store.add({ ...input, name: 'Second' });
    store.reorder([{ id: b.id, revision: 1 }, { id: a.id, revision: 1 }]);
    expect(store.list().map(s => s.id)).toEqual([b.id, a.id]);
    expect(() => store.reorder([{ id: a.id, revision: 2 }, { id: b.id, revision: 1 }])).toThrow();
    expect(store.list().map(s => s.id)).toEqual([b.id, a.id]);
  });
  it('refuses corrupt and newer databases without replacing their contents', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quota-test-')); dirs.push(dir);
    const bad = join(dir, 'corrupt.db');
    writeFileSync(bad, 'preserve this recovery evidence');
    expect(() => new Store(bad)).toThrow();
    expect(readFileSync(bad, 'utf8')).toBe('preserve this recovery evidence');
    const future = join(dir, 'future.db'), connection = new SQLite(future);
    connection.exec('PRAGMA user_version = 999'); connection.close();
    const before = readFileSync(future);
    expect(() => new Store(future)).toThrow('newer');
    expect(readFileSync(future)).toEqual(before);
  });
  it('persists failure cooldowns through reopening', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quota-test-')); dirs.push(dir);
    const path = join(dir, 'retry.db'), store = new Store(path), s = store.add(input);
    const next = Date.now() + 120000;
    store.fail(s, store.begin(s, Date.now()), 'Cooldown', next, false);
    store.close();
    const reopened = new Store(path); stores.push(reopened);
    expect(reopened.get(s.id).nextAttempt).toBe(next);
    expect(reopened.get(s.id).failures).toBe(1);
  });
});
