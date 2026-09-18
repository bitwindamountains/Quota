import { describe, it, expect } from 'vitest';
import { metricSchema, measurement, freshness, countdown, manualSchema } from '../shared/model.js';
import { parseCodex, parseOpenRouter, retryAfter } from '../server/collectors.js';
const now = Date.parse('2026-09-17T10:00:00Z');
const metric = (patch: Record<string, unknown> = {}) => metricSchema.parse({
  key: 'one', label: 'Window', kind: 'quota', unit: 'requests', observedAt: new Date(now).toISOString(),
  provenance: 'user_entered', freshnessSeconds: 600, ...patch
});
describe('measurement semantics', () => {
  it('keeps missing data distinct from zero', () => {
    expect(measurement(metric()).remaining).toBeNull();
    expect(measurement(metric({ used: '0', limit: '100' })).remaining).toBe('100');
    expect(measurement(metric({ remaining: '0' })).remaining).toBe('0');
  });
  it('uses decimal-safe arithmetic and preserves overage', () => {
    expect(measurement(metric({ used: '0.1', limit: '0.3' })).remaining).toBe('0.2');
    expect(measurement(metric({ used: '12', limit: '10' }))).toMatchObject({ remaining: '-2', percent: 120, bar: 100 });
  });
  it('does not divide by zero or invent a balance percentage', () => {
    expect(measurement(metric({ used: '0', limit: '0' })).percent).toBeNull();
    expect(measurement(metric({ kind: 'balance', remaining: '-5', unit: 'usd' })).percent).toBeNull();
  });
  it('supports percent-only, remaining-only and reached-only observations', () => {
    expect(measurement(metric({ unit: 'percent', usedPercent: '35' })).remaining).toBe('65');
    expect(measurement(metric({ remaining: '17' })).percent).toBeNull();
    expect(metric({ limitState: 'reached' }).limit).toBeNull();
  });
  it('rejects contradictory, impossible and misleading entries', () => {
    expect(() => metric({ used: '3', remaining: '9', limit: '10' })).toThrow();
    expect(() => metric({ usedPercent: '101' })).toThrow();
    expect(() => metric({ kind: 'budget', enforcement: 'provider' })).toThrow();
    expect(() => metric({ kind: 'usage_total', remaining: '12' })).toThrow();
    expect(() => metric({ allowance: 'unlimited', limit: '5' })).toThrow();
  });
  it('does not refill or advance expired windows', () => {
    const m = metric({ used: '80', limit: '100', resetAt: new Date(now - 1).toISOString() });
    expect(freshness(m, now)).toBe('reset_due');
    expect(measurement(m).remaining).toBe('20');
    expect(countdown(m.resetAt!, now)).toBe('Reset due');
    expect(freshness(metric(), now + 601000)).toBe('stale');
  });
  it('uses actual timestamps across DST and month boundaries', () => {
    expect(countdown('2026-11-01T02:00:00-08:00', Date.parse('2026-11-01T01:00:00-07:00'))).toBe('2h 0m');
    expect(countdown('2027-01-01T00:00:00Z', Date.parse('2026-12-31T23:00:00Z'))).toBe('1h 0m');
  });
  it('rejects duplicate keys', () => {
    expect(manualSchema.safeParse({ revision: 1, metrics: [metric(), metric()] }).success).toBe(false);
  });
});
describe('provider normalization', () => {
  it('uses actual Codex durations and Unix seconds, nullable secondaries', () => {
    const result = parseCodex({ rateLimitsByLimitId: { codex: { primary: { usedPercent: 12, windowDurationMins: 15, resetsAt: now / 1000 + 900 }, secondary: null } } }, now);
    expect(result).toHaveLength(1); expect(result[0].label).toBe('15-minute window');
    expect(result[0].resetAt).toBe(new Date(now + 900000).toISOString());
  });
  it('keeps multiple buckets separate and rejects incomplete schemas', () => {
    expect(parseCodex({ rateLimitsByLimitId: { a: { primary: { usedPercent: 1 } }, b: { primary: { usedPercent: 2 } } } }, now)).toHaveLength(2);
    expect(() => parseCodex({})).toThrow();
    expect(() => parseCodex({ rateLimits: { primary: { remaining: 1 } } })).toThrow();
  });
  it('does not subtract lifetime OpenRouter usage from a resetting cap', () => {
    const metrics = parseOpenRouter({ data: { limit: 10, limit_remaining: 6, usage: 400 } }, now);
    expect(metrics[0].used).toBe('4'); expect(metrics[1].used).toBe('400'); expect(metrics[0].resetAt).toBeNull();
  });
  it('does not turn an uncapped key into an unlimited account balance', () => {
    const [m] = parseOpenRouter({ data: { limit: null, limit_remaining: null, usage: 4 } });
    expect(m.allowance).toBe('unlimited'); expect(m.key).toBe('key:allowance'); expect(m.remaining).toBeNull();
  });
  it('handles both Retry-After formats', () => {
    expect(retryAfter('12', now)).toBe(12000);
    expect(retryAfter(new Date(now + 60000).toUTCString(), now)).toBe(60000);
    expect(retryAfter('bad', now)).toBe(0);
  });
});
