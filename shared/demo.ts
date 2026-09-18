import { metricSchema, type Source, type Metric } from './model.js';
export function demoSources(now = Date.now()): Source[] {
  const iso = (offset: number) => new Date(now + offset).toISOString();
  const metric = (key: string, label: string, used: number, reset: number) => metricSchema.parse({
    key, label, kind: 'quota', unit: 'percent', usedPercent: String(used),
    allowance: 'finite', enforcement: 'provider', provenance: 'user_entered',
    observedAt: iso(-180000), freshnessSeconds: 86400,
    resetAt: iso(reset), resetKind: 'fixed', resetBasis: 'user_entered'
  });
  const make = (provider: Source['provider'], name: string, metrics: Metric[], i: number): Source => ({
    id: 'demo-' + provider, provider, name, scope: 'Personal · sample data', mode: 'manual', enabled: true,
    pollSeconds: 300, revision: 1, position: i, metrics, lastAttempt: iso(-180000),
    lastSuccess: iso(-180000), error: null, failures: 0, nextAttempt: 0, authPaused: false
  });
  return [
    make('codex', 'Codex', [metric('session', '5-hour window', 38, 9240000), metric('weekly', 'Weekly window', 24, 365400000)], 0),
    make('claude', 'Claude', [metric('session', 'Current session', 76, 3300000), metric('weekly', 'Weekly · all models', 42, 185400000)], 1),
    make('chatgpt', 'ChatGPT', [metric('weekly', 'Thinking · weekly', 18, 451800000)], 2),
    make('cursor', 'Cursor', [metric('monthly', 'Included usage', 91, 624600000)], 3),
    make('copilot', 'GitHub Copilot', [metric('monthly', 'Monthly allowance', 34, 711000000)], 4),
    make('openrouter', 'OpenRouter', [metricSchema.parse({ key: 'balance', label: 'Account credits', kind: 'balance', unit: 'usd', remaining: '18.42', allowance: 'not_applicable', provenance: 'user_entered', observedAt: iso(-300000), freshnessSeconds: 86400, resetKind: 'none' })], 5)
  ];
}
