import { parseDuration, type Metric } from './model.js';

// Reads usage windows out of text copied from a provider's usage page (Ctrl+A, Ctrl+C).
// Heuristic by design: results always prefill a form the user reviews before saving.
export type ParsedWindow = { label: string; usedPercent: number; resetAt: string | null };

const PERCENT = /(\d{1,3}(?:\.\d+)?)\s*%\s*(used|remaining|left|consumed|available)?/i;
const OF = /(?:^|\s)\$?(\d[\d,]*(?:\.\d+)?)\s*(?:\/|of)\s*\$?(\d[\d,]*(?:\.\d+)?)(?:\s|$)/i;
const RESET = /\b(?:resets?|renews?|refreshes|available again)\b\s*(.*)$/i;
const NOISE = /learn more|upgrade|manage|settings|privacy|terms|help|log ?out|sign ?out|^\W*$/i;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function clockOf(text: string): [number, number] | null {
  const match = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(text);
  if (!match || (!match[2] && !match[3])) return null;
  let hours = Number(match[1]); const minutes = Number(match[2] ?? 0), meridiem = match[3]?.toLowerCase();
  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;
  return hours < 24 && minutes < 60 ? [hours, minutes] : null;
}
// "in 3 hr 12 min", "Tue 5:00 AM", "tomorrow at 9am", "at 3:40 PM", "Oct 7, 5:00 AM".
export function parseResetPhrase(phrase: string, now = Date.now()): string | null {
  const text = phrase.trim().toLowerCase().replace(/[·•]/g, ' ');
  if (!text) return null;
  const relative = /^in\s+(.+)$/.exec(text);
  if (relative) {
    try { const ms = parseDuration(relative[1].replace(/\b(\d+)\s*(days?|hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/g, (_, n, u) => n + u[0])); return ms ? new Date(now + ms).toISOString() : null; }
    catch { return null; }
  }
  const clock = clockOf(text), base = new Date(now);
  const at = (date: Date) => { date.setHours(clock?.[0] ?? 0, clock?.[1] ?? 0, 0, 0); return date; };
  const weekday = WEEKDAYS.findIndex(day => new RegExp('\\b' + day).test(text));
  if (/\btomorrow\b/.test(text)) { const date = at(new Date(base)); date.setDate(date.getDate() + 1); return date.toISOString(); }
  if (weekday >= 0) {
    const date = at(new Date(base)); date.setDate(date.getDate() + ((weekday - base.getDay() + 7) % 7));
    if (date.getTime() <= now) date.setDate(date.getDate() + 7);
    return date.toISOString();
  }
  const month = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/.exec(text);
  if (month) {
    const date = at(new Date(base.getFullYear(), 'janfebmaraprmayjunjulaugsepoctnovdec'.indexOf(month[1]) / 3, Number(month[2])));
    if (date.getTime() <= now - 86400000) date.setFullYear(date.getFullYear() + 1);
    return date.toISOString();
  }
  if (clock) { const date = at(new Date(base)); if (date.getTime() <= now) date.setDate(date.getDate() + 1); return date.toISOString(); }
  return null;
}

export function parseUsageText(input: string, now = Date.now()): ParsedWindow[] {
  const lines = input.split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 400);
  const windows: ParsedWindow[] = [];
  let labels: string[] = [], reset: string | null = null, last: ParsedWindow | null = null;
  for (const line of lines) {
    const resetMatch = RESET.exec(line), percent = PERCENT.exec(line), ratio = percent ? null : OF.exec(line);
    if (resetMatch) {
      const at = parseResetPhrase(resetMatch[1], now);
      // A reset right after a reading belongs to it; otherwise it precedes the next reading.
      if (last && !last.resetAt && !labels.length) last.resetAt = at; else reset = at;
    }
    if (percent || ratio) {
      let used = percent ? Number(percent[1]) : Number(ratio![1].replaceAll(',', '')) / Number(ratio![2].replaceAll(',', '')) * 100;
      if (percent && /remaining|left|available/i.test(percent[2] ?? '')) used = 100 - used;
      if (!Number.isFinite(used) || used < 0 || used > 100) continue;
      const inline = line.replace(PERCENT, '').replace(OF, ' ').replace(RESET, '').trim();
      const label = [...labels, ...(inline && !NOISE.test(inline) && /[a-z]/i.test(inline) ? [inline] : [])].slice(-2).join(' · ') || 'Usage';
      last = { label, usedPercent: Math.round(used * 100) / 100, resetAt: reset };
      windows.push(last); labels = []; reset = null;
      continue;
    }
    if (!resetMatch && !NOISE.test(line) && /[a-z]/i.test(line) && line.length <= 60) labels.push(line);
  }
  return windows;
}

// Groups window names so "Current session" finds "5-hour window" and "Weekly · All models" finds "Weekly window".
function family(text: string) {
  const t = text.toLowerCase();
  if (/session|5[- ]?h|five[ _-]?hour/.test(t)) return 'session';
  if (/week|7[- ]?d|seven[ _-]?day/.test(t)) return 'week';
  if (/month|billing|cycle/.test(t)) return 'month';
  if (/day|daily/.test(t)) return 'day';
  return 'other';
}
const words = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2));
// Pairs each existing metric with the best parsed window. Unmatched windows are returned separately.
export function matchWindows(metrics: Metric[], parsed: ParsedWindow[]) {
  const matched = new Map<string, ParsedWindow>(), used = new Set<ParsedWindow>();
  for (const metric of metrics) {
    const kind = family(metric.label + ' ' + metric.key);
    const options = parsed.filter(p => !used.has(p) && (kind !== 'other' ? family(p.label) === kind : [...words(metric.label)].some(word => words(p.label).has(word))));
    // Prefer the account-wide window over model-specific ones ("All models" rather than "Opus only").
    const best = options.find(p => !/\bonly\b/i.test(p.label)) ?? options[0];
    if (best) { matched.set(metric.key, best); used.add(best); }
  }
  if (metrics.length === 1 && !matched.size && parsed.length === 1) { matched.set(metrics[0].key, parsed[0]); used.add(parsed[0]); }
  return { matched, unmatched: parsed.filter(p => !used.has(p)) };
}
