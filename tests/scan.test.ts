import { afterEach, expect, it } from 'vitest';
import { Store } from '../server/storage.js';
import { scanTools } from '../server/scan.js';
import { countdown, metricSchema, parseDuration, sourceInputSchema } from '../shared/model.js';

const stores: Store[] = [];
afterEach(() => { for (const store of stores) store.close(); stores.length = 0; delete process.env.QUOTA_DEEPSEEK_SCAN_TEST; });
const window = (key: string, used: string, observedAt: string, provenance: 'provider_reported' | 'user_entered' = 'provider_reported') => metricSchema.parse({
  key, label: key, kind: 'quota', unit: 'percent', usedPercent: used, allowance: 'finite', observedAt, provenance, freshnessSeconds: 600 });

it('offers configured keys as automatic candidates and skips providers already tracked', async () => {
  process.env.QUOTA_DEEPSEEK_SCAN_TEST = 'scan-secret-canary';
  const found = await scanTools(new Set());
  const deepseek = found.find(c => c.provider === 'deepseek');
  expect(deepseek?.mode).toBe('automatic');
  expect(deepseek?.environment).toMatch(/^(DEEPSEEK_API_KEY|QUOTA_DEEPSEEK_)/);
  expect(JSON.stringify(found)).not.toContain('scan-secret-canary');
  expect((await scanTools(new Set(['deepseek']))).some(c => c.provider === 'deepseek')).toBe(false);
});
it('records a reading on an automatic source for its existing windows, and newer reports win afterwards', () => {
  const store = new Store(':memory:'); stores.push(store);
  let source = store.add(sourceInputSchema.parse({ provider: 'claude-code', name: 'Claude Code', mode: 'automatic' }));
  const old = new Date(Date.now() - 20 * 60000).toISOString();
  store.accept(source, store.begin(source, Date.now()), [window('claude-code:five_hour', '40', old)], Date.now(), Date.now() + 300000);
  source = store.get(source.id);
  const entered = window('claude-code:five_hour', '72', new Date().toISOString(), 'user_entered');
  expect(() => store.manual(source.id, source.revision, [entered, window('extra', '1', new Date().toISOString(), 'user_entered')])).toThrow(/only for the windows/);
  source = store.manual(source.id, source.revision, [entered]);
  expect(source.metrics[0].usedPercent).toBe('72');
  store.accept(source, store.begin(source, Date.now()), [window('claude-code:five_hour', '40', old)], Date.now(), Date.now() + 300000);
  expect(store.get(source.id).metrics[0].usedPercent).toBe('72');
  source = store.get(source.id);
  store.accept(source, store.begin(source, Date.now()), [window('claude-code:five_hour', '80', new Date(Date.now() + 1000).toISOString())], Date.now(), Date.now() + 300000);
  expect(store.get(source.id).metrics[0].usedPercent).toBe('80');
});
it('parses usage-page reset durations and round-trips the dashboard countdown', () => {
  expect(parseDuration('3h 12m')).toBe((3 * 60 + 12) * 60000);
  expect(parseDuration('2d 5h')).toBe((2 * 24 + 5) * 3600000);
  expect(parseDuration('3 hr 12 min')).toBe((3 * 60 + 12) * 60000);
  expect(parseDuration('  ')).toBeNull();
  expect(() => parseDuration('soon')).toThrow();
  const at = new Date(Date.now() + (4 * 24 + 5) * 3600000 + 30000).toISOString();
  expect(parseDuration(countdown(at))).toBe((4 * 24 + 5) * 3600000);
});
