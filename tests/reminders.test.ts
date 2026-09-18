import { afterEach, expect, it, vi } from 'vitest';
import { Store } from '../server/storage.js';
import { Reminders } from '../server/reminders.js';
import { EmailFailure } from '../server/email.js';
import { metricSchema, sourceInputSchema } from '../shared/model.js';

const stores: Store[] = [];
afterEach(() => { stores.forEach(s => s.close()); stores.length = 0; });
function setup(emailConfigured = true) {
  let now = Date.now();
  const store = new Store(':memory:'); stores.push(store);
  const send = vi.fn().mockResolvedValue(undefined);
  const reminders = new Reminders(store, { configured: emailConfigured, send }, () => now);
  const original = store.add(sourceInputSchema.parse({ provider: 'custom', name: 'Example tool' }));
  const makeMetric = (key: string, due: number) => metricSchema.parse({ key, label: key, kind: 'quota', unit: 'percent', usedPercent: '90', resetAt: new Date(due).toISOString(), resetKind: 'fixed', resetBasis: 'user_entered', observedAt: new Date(now).toISOString(), provenance: 'user_entered', freshnessSeconds: 3600 });
  const source = store.manual(original.id, 1, [makeMetric('five-hour', now + 1000), makeMetric('weekly', now + 7 * 86400000)]);
  const save = (metricKey = 'five-hour', email: string | null = 'owner@example.com') => reminders.save(source.id, { revision: 0, sourceRevision: source.revision, metricKey, enabled: true, email });
  return { store, source, send, reminders, save, makeMetric, time: () => now, advance: (ms: number) => { now += ms; } };
}
it('fires each window independently and persists duplicate suppression across restarts', async () => {
  const t = setup(); t.save(); t.save('weekly');
  await t.reminders.tick(); expect(t.send).not.toHaveBeenCalled();
  t.advance(1500); await Promise.all([t.reminders.tick(), t.reminders.tick()]);
  expect(t.send).toHaveBeenCalledTimes(1);
  expect(t.reminders.state().events).toHaveLength(1);
  const event = t.reminders.state().events[0]; expect(event.emailState).toBe('sent');
  expect(t.reminders.claim(event.id)).toBe(true); expect(t.reminders.claim(event.id)).toBe(false);
  const resumed = new Reminders(t.store, { configured: true, send: t.send }, t.time);
  await resumed.tick(); expect(t.send).toHaveBeenCalledTimes(1);
  resumed.dismiss(event.id); expect(resumed.state().events[0].dismissed).toBe(true);
});
it('follows a corrected future timestamp and re-arms only from a newly known future reset', async () => {
  const t = setup(); t.save();
  const source = t.store.manual(t.source.id, t.source.revision, [t.makeMetric('five-hour', t.time() + 5000)]);
  t.advance(1500); await t.reminders.tick();
  // An overdue saved reset is still reported when observation polling advanced first.
  expect(t.send).toHaveBeenCalledTimes(1);
  t.advance(5000); await t.reminders.tick(); expect(t.send).toHaveBeenCalledTimes(2);
  t.advance(100000); await t.reminders.tick(); expect(t.send).toHaveBeenCalledTimes(2);
  t.store.manual(source.id, source.revision, [t.makeMetric('five-hour', t.time() + 5000)]);
  await t.reminders.tick(); t.advance(5001); await t.reminders.tick(); expect(t.send).toHaveBeenCalledTimes(3);
});
it('replaces an alarm before it is due when the reset time is corrected', async () => {
  const t = setup(); t.save();
  t.store.manual(t.source.id, t.source.revision, [t.makeMetric('five-hour', t.time() + 5000)]);
  await t.reminders.tick(); t.advance(1500); await t.reminders.tick(); expect(t.send).not.toHaveBeenCalled();
  t.advance(4000); await t.reminders.tick(); expect(t.send).toHaveBeenCalledTimes(1);
});
it('cancels alarms for paused sources and missing windows; deletion cascades', async () => {
  const t = setup(); t.save();
  let source = t.store.update(t.source.id, t.source.revision, sourceInputSchema.parse({ provider: 'custom', name: 'Example tool', enabled: false }));
  t.advance(1500); await t.reminders.tick(); expect(t.send).not.toHaveBeenCalled();
  source = t.store.update(source.id, source.revision, sourceInputSchema.parse({ provider: 'custom', name: 'Example tool' }));
  await t.reminders.tick(); expect(t.send).not.toHaveBeenCalled();
  source = t.store.manual(source.id, source.revision, []); await t.reminders.tick();
  t.store.remove(source.id, source.revision); expect(t.reminders.state().alarms).toHaveLength(0);
});
it('catches up within 24 hours and skips old email alarms', async () => {
  const t = setup(); t.save(); t.advance(25 * 3600000); await t.reminders.tick();
  expect(t.send).not.toHaveBeenCalled(); expect(t.reminders.state().events[0].emailState).toBe('expired');
  expect(t.reminders.state().events[0].notified).toBe(true);
});
it('bounds safe retries and never exposes raw SMTP errors', async () => {
  const t = setup(); t.save(); t.send.mockRejectedValue(new EmailFailure('retry'));
  t.advance(1500); await t.reminders.tick(); expect(t.send).toHaveBeenCalledTimes(1);
  await t.reminders.tick(); expect(t.send).toHaveBeenCalledTimes(1);
  t.advance(60000); await t.reminders.tick(); t.advance(120000); await t.reminders.tick();
  expect(t.send).toHaveBeenCalledTimes(3); expect(t.reminders.state().events[0].emailState).toBe('failed');
  t.advance(3600000); await t.reminders.tick(); expect(t.send).toHaveBeenCalledTimes(3);
});
it('does not retry ambiguous or interrupted delivery', async () => {
  const t = setup(); t.save(); t.send.mockRejectedValue(new Error('SENTINEL_SMTP_SECRET'));
  t.advance(1500); await t.reminders.tick();
  expect(t.reminders.state().events[0].emailState).toBe('uncertain');
  expect(JSON.stringify(t.reminders.state())).not.toContain('SENTINEL_SMTP_SECRET');
  t.store.db.exec("UPDATE reminder_events SET email_state='sending'");
  const resumed = new Reminders(t.store, { configured: true, send: t.send }, t.time);
  await resumed.tick(); expect(t.send).toHaveBeenCalledTimes(1); expect(resumed.state().events[0].emailState).toBe('uncertain');
});
it('rejects stale edits, unknown/past resets and email before configuration', () => {
  const t = setup(false);
  expect(() => t.save()).toThrow('Configure SMTP');
  const alarm = t.save('five-hour', null);
  expect(() => t.save('five-hour', null)).toThrow('another tab');
  expect(() => t.save('missing', null)).toThrow('no longer available');
  t.advance(2000);
  expect(() => t.reminders.save(t.source.id, { revision: alarm.revision, sourceRevision: t.source.revision, metricKey: 'five-hour', enabled: true, email: null })).toThrow('future reset');
  expect(t.reminders.save(t.source.id, { revision: alarm.revision, sourceRevision: t.source.revision, metricKey: 'five-hour', enabled: false, email: null }).enabled).toBe(false);
});
it('disabling a queued alarm cancels unsent mail', async () => {
  const t = setup(); const alarm = t.save(); t.send.mockRejectedValue(new EmailFailure('retry'));
  t.advance(1500); await t.reminders.tick();
  t.reminders.save(t.source.id, { revision: alarm.revision, sourceRevision: t.source.revision, metricKey: 'five-hour', enabled: false, email: null });
  t.advance(60000); await t.reminders.tick();
  expect(t.send).toHaveBeenCalledTimes(1); expect(t.reminders.state().events[0].emailState).toBe('cancelled');
});
