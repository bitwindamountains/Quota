import { expect, it } from 'vitest';
import { metricSchema } from '../shared/model.js';
import { matchWindows, parseResetPhrase, parseUsageText } from '../shared/usage-text.js';

// Wednesday 30 Sep 2026, 10:00 local time.
const now = new Date(2026, 8, 30, 10, 0, 0).getTime();
const claudePage = `Settings
Usage
Plan usage limits
Current session
Resets in 3 hr 12 min
24% used
Weekly limits
Learn more about usage limits
All models
Resets Thu 5:00 AM
42% used
Opus only
Resets Thu 5:00 AM
8% used`;
const metric = (key: string, label: string) => metricSchema.parse({ key, label, kind: 'quota', unit: 'percent', usedPercent: '1', observedAt: new Date(now).toISOString(), provenance: 'provider_reported', freshnessSeconds: 600 });

it('reads Claude usage-page windows with resets that precede the percentage', () => {
  const windows = parseUsageText(claudePage, now);
  expect(windows.map(w => w.usedPercent)).toEqual([24, 42, 8]);
  expect(windows[0].label).toContain('Current session');
  expect(Date.parse(windows[0].resetAt!) - now).toBe((3 * 60 + 12) * 60000);
  expect(new Date(windows[1].resetAt!).getDay()).toBe(4);
  expect(new Date(windows[1].resetAt!).getHours()).toBe(5);
  expect(windows[1].label).toMatch(/Weekly limits · All models/);
});
it('matches pasted windows to Claude Code metrics, preferring the all-models weekly window', () => {
  const metrics = [metric('claude-code:five_hour', '5-hour window'), metric('claude-code:seven_day', 'Weekly window')];
  const { matched, unmatched } = matchWindows(metrics, parseUsageText(claudePage, now));
  expect(matched.get('claude-code:five_hour')?.usedPercent).toBe(24);
  expect(matched.get('claude-code:seven_day')?.usedPercent).toBe(42);
  expect(unmatched.map(w => w.usedPercent)).toEqual([8]);
});
it('handles remaining percentages, trailing resets, and spend ratios', () => {
  const codex = parseUsageText('5 hour usage limit\n62% remaining\nResets 3:40 PM\nWeekly usage limit\n76% left\nResets Oct 7', now);
  expect(codex.map(w => w.usedPercent)).toEqual([38, 24]);
  expect(new Date(codex[0].resetAt!).getHours()).toBe(15);
  expect(new Date(codex[1].resetAt!).getDate()).toBe(7);
  const spend = parseUsageText('Included usage\n$15.00 of $20.00', now);
  expect(spend).toEqual([{ label: 'Included usage', usedPercent: 75, resetAt: null }]);
  expect(parseUsageText('nothing useful here', now)).toEqual([]);
});
it('interprets common reset phrasings relative to now', () => {
  expect(Date.parse(parseResetPhrase('in 2 days 5 hours', now)!) - now).toBe(53 * 3600000);
  expect(new Date(parseResetPhrase('tomorrow at 9am', now)!).getDate()).toBe(1);
  expect(new Date(parseResetPhrase('at 9:00 AM', now)!).getDate()).toBe(1);
  expect(new Date(parseResetPhrase('Tue 5:00 AM', now)!).getDate()).toBe(6);
  expect(parseResetPhrase('whenever', now)).toBeNull();
});
