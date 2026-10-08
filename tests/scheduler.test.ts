import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../server/storage.js';
import { Scheduler } from '../server/scheduler.js';
import { CollectionError, CollectionWaiting, type Collector } from '../server/collectors.js';
import { sourceInputSchema, metricSchema } from '../shared/model.js';
const resources: { store: Store; scheduler: Scheduler }[] = [];
const metric = () => metricSchema.parse({ key: 'one', label: 'Window', kind: 'quota', unit: 'percent', usedPercent: '42', observedAt: new Date().toISOString(), provenance: 'provider_reported', freshnessSeconds: 600 });
function setup(adapter: Collector) {
  const store = new Store(':memory:');
  const scheduler = new Scheduler(store, { codex: adapter });
  resources.push({ store, scheduler });
  const source = store.add(sourceInputSchema.parse({ provider: 'codex', name: 'Codex', mode: 'automatic' }));
  return { store, scheduler, source };
}
afterEach(async () => { for (const r of resources) { await r.scheduler.stop(); r.store.close(); } resources.length = 0; });
describe('scheduler isolation', () => {
  it('queues excess requests, deduplicates them and drains without another user action', async () => {
    const releases: (() => void)[] = [];
    const adapter = vi.fn(async () => { await new Promise<void>(resolve => releases.push(resolve)); return { metrics: [metric()] }; });
    const { scheduler, store, source } = setup(adapter);
    const others = ['Two', 'Three'].map(name => store.add(sourceInputSchema.parse({ provider: 'codex', name, mode: 'automatic' })));
    expect(scheduler.request(source.id).status).toBe('accepted');
    expect(scheduler.request(others[0].id).status).toBe('accepted');
    expect(scheduler.request(others[1].id).status).toBe('queued');
    expect(scheduler.request(others[1].id).status).toBe('queued');
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[0]();
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    expect(scheduler.isQueued(others[1].id)).toBe(false);
    releases[1](); releases[2]();
    await vi.waitFor(() => expect(scheduler.isRunning(others[1].id)).toBe(false));
    expect(adapter).toHaveBeenCalledTimes(3);
  });
  it('removes cancelled queued sources before using a free slot', async () => {
    const releases: (() => void)[] = [];
    const adapter = vi.fn(async () => { await new Promise<void>(resolve => releases.push(resolve)); return { metrics: [] }; });
    const { scheduler, store, source } = setup(adapter);
    const others = ['Two', 'Three'].map(name => store.add(sourceInputSchema.parse({ provider: 'codex', name, mode: 'automatic' })));
    [source, ...others].forEach(s => scheduler.request(s.id));
    scheduler.cancel(others[1].id);
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases.forEach(release => release());
    await vi.waitFor(() => expect(scheduler.isRunning(source.id)).toBe(false));
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(scheduler.isQueued(others[1].id)).toBe(false);
  });
  it('coalesces concurrent refreshes', async () => {
    let release!: () => void;
    const adapter = vi.fn(async () => { await new Promise<void>(resolve => { release = resolve; }); return { metrics: [metric()] }; });
    const { scheduler, source } = setup(adapter);
    scheduler.request(source.id); scheduler.request(source.id);
    await vi.waitFor(() => expect(adapter).toHaveBeenCalledTimes(1));
    release(); await vi.waitFor(() => expect(scheduler.isRunning(source.id)).toBe(false));
  });
  it('preserves prior readings after a failure and respects Retry-After', async () => {
    const adapter: Collector = async () => { throw new CollectionError('Cooldown', false, 120000); };
    const { store, scheduler, source } = setup(adapter);
    store.accept(source, store.begin(source, Date.now()), [metric()], Date.now(), 0);
    scheduler.request(source.id);
    await vi.waitFor(() => expect(store.get(source.id).failures).toBe(1));
    expect(store.get(source.id).metrics[0].usedPercent).toBe('42');
    expect(store.get(source.id).nextAttempt).toBeGreaterThan(Date.now() + 110000);
    expect(scheduler.request(source.id).status).toBe('cooldown');
  });
  it('isolates a failing source and pauses authentication retries', async () => {
    const adapter: Collector = async s => {
      if (s.name === 'Codex') throw new CollectionError('Sign in', true);
      return { metrics: [metric()] };
    };
    const { store, scheduler, source } = setup(adapter);
    const second = store.add(sourceInputSchema.parse({ provider: 'codex', name: 'Other', mode: 'automatic' }));
    scheduler.tick();
    await vi.waitFor(() => expect(store.get(source.id).authPaused).toBe(true));
    await vi.waitFor(() => expect(store.get(second.id).metrics).toHaveLength(1));
  });
  it('handles synchronous adapter errors without leaking active slots', async () => {
    const { scheduler, source, store } = setup(() => { throw new Error('PRIVATE_PROVIDER_RESPONSE'); });
    scheduler.request(source.id);
    await vi.waitFor(() => expect(store.get(source.id).failures).toBe(1));
    expect(scheduler.isRunning(source.id)).toBe(false);
    expect(store.get(source.id).error).not.toContain('PRIVATE_PROVIDER_RESPONSE');
  });
});
describe('expected waits and local change notifications', () => {
  it('records a wait as a notice without failure backoff, then nudges past the refresh cooldown', async () => {
    let ready = false;
    const adapter = vi.fn(async () => { if (!ready) throw new CollectionWaiting('Waiting for first use.'); return { metrics: [metric()] }; });
    const { scheduler, store, source } = setup(adapter);
    expect(scheduler.request(source.id).status).toBe('accepted');
    await vi.waitFor(() => expect(store.get(source.id).error).toBe('Waiting for first use.'));
    const waited = store.get(source.id);
    expect(waited.failures).toBe(0);
    expect(waited.nextAttempt).toBeGreaterThan(Date.now() + 250000);
    expect(scheduler.request(source.id).status).toBe('cooldown');
    ready = true; scheduler.nudge(source.id);
    await vi.waitFor(() => expect(store.get(source.id).metrics).toHaveLength(1));
    expect(store.get(source.id).error).toBeNull();
    expect(adapter).toHaveBeenCalledTimes(2);
  });
});
