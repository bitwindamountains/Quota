import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../server/storage.js';
import { Scheduler } from '../server/scheduler.js';
import { CollectionError, type Collector } from '../server/collectors.js';
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
