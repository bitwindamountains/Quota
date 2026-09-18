import { keyIntegration, minimumPoll } from './integrations.js';
import { z } from 'zod';
import { Decimal } from 'decimal.js';

export const providers = [
  { id: 'codex', name: 'Codex', category: 'Coding assistant', mark: '⌘', color: '#252a33', url: 'https://chatgpt.com/codex' },
  { id: 'claude', name: 'Claude', category: 'Chat & reasoning', mark: '✳', color: '#b76749', url: 'https://claude.ai/settings/usage' },
  { id: 'chatgpt', name: 'ChatGPT', category: 'Chat & reasoning', mark: '◉', color: '#16846c', url: 'https://chatgpt.com' },
  { id: 'cursor', name: 'Cursor', category: 'Coding assistant', mark: '↗', color: '#303746', url: 'https://cursor.com/dashboard' },
  { id: 'copilot', name: 'GitHub Copilot', category: 'Coding assistant', mark: '∞', color: '#7156b2', url: 'https://github.com/settings/billing' },
  { id: 'openrouter', name: 'OpenRouter', category: 'API & credits', mark: '⇄', color: '#5268ca', url: 'https://openrouter.ai/settings/credits' },
  { id: 'gemini', name: 'Gemini', category: 'Chat & reasoning', mark: '✦', color: '#477bdd', url: 'https://gemini.google.com' },
  { id: 'anthropic', name: 'Anthropic API', category: 'API & credits', mark: 'A', color: '#ac735b', url: 'https://console.anthropic.com' },
  { id: 'openai', name: 'OpenAI API', category: 'API & credits', mark: '◎', color: '#16846c', url: 'https://platform.openai.com/usage' },
  { id: 'groq', name: 'Groq', category: 'API & credits', mark: 'g', color: '#d56c40', url: 'https://console.groq.com/settings/limits' },
  { id: 'mistral', name: 'Mistral', category: 'API & credits', mark: 'M', color: '#d99533', url: 'https://console.mistral.ai' },
  { id: 'gemini-api', name: 'Gemini API', category: 'API & credits', mark: '✦', color: '#477bdd', url: 'https://aistudio.google.com' },
  { id: 'vertex', name: 'Vertex AI', category: 'API & credits', mark: 'V', color: '#428878', url: 'https://console.cloud.google.com/vertex-ai' },
  { id: 'cline', name: 'Cline', category: 'Coding assistant', mark: 'C', color: '#627587', url: 'https://app.cline.bot' },
  { id: 'deepseek', name: 'DeepSeek API', category: 'API & credits', mark: 'D', color: '#4b6bda', url: 'https://platform.deepseek.com' },
  { id: 'custom', name: 'Custom tool', category: 'Other', mark: '◇', color: '#72788a', url: '' }
] as const;
export type ProviderId = typeof providers[number]['id'];
export const providerFor = (id: string) => providers.find(p => p.id === id) ?? providers[providers.length - 1];
export const supportsAuto = (id: string) => id === 'codex' || !!keyIntegration(id);

const decimal = z.string().regex(/^-?\d{1,20}(\.\d{1,12})?$/, 'Enter a decimal number (up to 12 decimal places).');
const nonnegative = decimal.refine(v => new Decimal(v).gte(0), 'Must be zero or greater.');
const instant = z.string().datetime({ offset: true }).refine(v => Number.isFinite(Date.parse(v)), 'Invalid date.');
export const metricSchema = z.object({
  key: z.string().min(1).max(140).regex(/^[a-zA-Z0-9:_-]+$/),
  label: z.string().trim().min(1).max(80),
  kind: z.enum(['quota', 'rate_limit', 'balance', 'usage_total', 'budget']),
  unit: z.string().trim().min(1).max(30),
  used: nonnegative.nullable().default(null),
  remaining: decimal.nullable().default(null),
  limit: nonnegative.nullable().default(null),
  usedPercent: decimal.nullable().default(null),
  allowance: z.enum(['finite', 'unlimited', 'unknown', 'not_applicable']).default('unknown'),
  enforcement: z.enum(['provider', 'advisory', 'unknown', 'not_applicable']).default('unknown'),
  limitState: z.enum(['reached', 'not_reached', 'unknown']).default('unknown'),
  resetAt: instant.nullable().default(null),
  resetKind: z.enum(['fixed', 'rolling', 'refill', 'none', 'unknown']).default('unknown'),
  resetBasis: z.enum(['provider_reported', 'user_entered', 'derived', 'unknown']).default('unknown'),
  observedAt: instant,
  provenance: z.enum(['provider_reported', 'user_entered', 'derived', 'estimated']),
  freshnessSeconds: z.number().int().min(10).max(2678400),
  periodStart: instant.nullable().default(null),
  periodEnd: instant.nullable().default(null)
}).strict().superRefine((m, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (m.usedPercent !== null && (new Decimal(m.usedPercent).lt(0) || new Decimal(m.usedPercent).gt(100))) fail('Percent must be between 0 and 100.');
  if (m.usedPercent !== null && (m.used !== null || m.remaining !== null || m.limit !== null)) fail('Enter a percentage or native counts, not both.');
  if (m.allowance === 'unlimited' && (m.limit !== null || m.usedPercent !== null)) fail('Unlimited metrics cannot have a finite cap or percentage.');
  if (m.kind === 'balance' && (m.used !== null || m.limit !== null || m.usedPercent !== null)) fail('Balances have a remaining value, not a quota percentage.');
  if (m.kind === 'usage_total' && (m.remaining !== null || m.limit !== null || m.usedPercent !== null)) fail('Usage totals cannot imply a remaining quota.');
  if (m.kind === 'budget' && m.enforcement !== 'advisory') fail('Personal budgets must be advisory.');
  if (m.used !== null && m.limit !== null && m.remaining !== null && !new Decimal(m.limit).minus(m.used).eq(m.remaining)) fail('Used, remaining, and limit disagree.');
  if (m.periodStart && m.periodEnd && Date.parse(m.periodStart) >= Date.parse(m.periodEnd)) fail('Period end must follow start.');
  if (m.resetKind === 'none' && m.resetAt) fail('A non-resetting metric cannot have a reset time.');
});
export type Metric = z.infer<typeof metricSchema>;
export const sourceInputSchema = z.object({
  provider: z.enum(providers.map(p => p.id) as [ProviderId, ...ProviderId[]]),
  name: z.string().trim().min(1).max(60),
  scope: z.string().trim().min(1).max(80).default('Personal'),
  mode: z.enum(['manual', 'automatic']).default('manual'),
  enabled: z.boolean().default(true),
  pollSeconds: z.number().int().min(300).max(86400).default(300)
}).strict().superRefine((s, ctx) => {
  if (s.mode === 'automatic' && !supportsAuto(s.provider)) ctx.addIssue({ code: 'custom', message: 'This provider currently supports manual tracking only.' });
  if (s.mode === 'automatic' && s.pollSeconds < minimumPoll(s.provider)) ctx.addIssue({ code: 'custom', message: 'Refresh interval must be at least ' + minimumPoll(s.provider) / 60 + ' minutes for this provider.' });
});
export type SourceInput = z.infer<typeof sourceInputSchema>;
export type Source = SourceInput & {
  id: string; revision: number; position: number; metrics: Metric[];
  lastAttempt: string | null; lastSuccess: string | null;
  error: string | null; failures: number; nextAttempt: number; authPaused: boolean;
};
export type State = { sources: Source[]; serverTime: string; version: string; demo: boolean };
export const manualSchema = z.object({
  revision: z.number().int().positive(),
  metrics: z.array(metricSchema).max(20)
}).strict().superRefine((data, ctx) => {
  if (new Set(data.metrics.map(m => m.key)).size !== data.metrics.length) ctx.addIssue({ code: 'custom', message: 'Metric names must have unique keys.' });
  if (data.metrics.some(m => Date.parse(m.observedAt) > Date.now() + 60_000)) ctx.addIssue({ code: 'custom', message: 'Observation time cannot be in the future.' });
});

export function measurement(m: Metric) {
  let remaining = m.remaining;
  let percent = m.usedPercent === null ? null : Number(m.usedPercent);
  if (m.limit !== null && m.used !== null && remaining === null) remaining = new Decimal(m.limit).minus(m.used).toString();
  if (percent === null && m.limit !== null && new Decimal(m.limit).gt(0)) {
    if (m.used !== null) percent = new Decimal(m.used).div(m.limit).times(100).toNumber();
    else if (remaining !== null) percent = new Decimal(1).minus(new Decimal(remaining).div(m.limit)).times(100).toNumber();
  }
  if (m.unit === 'percent' && percent !== null && remaining === null) remaining = new Decimal(100).minus(percent).toString();
  return { remaining, percent, bar: percent === null ? null : Math.min(100, Math.max(0, percent)) };
}
export function freshness(m: Metric, now = Date.now()): 'fresh' | 'stale' | 'reset_due' {
  if (m.resetAt && Date.parse(m.resetAt) <= now) return 'reset_due';
  return now - Date.parse(m.observedAt) > m.freshnessSeconds * 1000 ? 'stale' : 'fresh';
}
export function formatValue(value: string | null, unit = '') {
  if (value === null) return 'Unknown';
  const n = new Decimal(value);
  const formatted = n.abs().gte('1000000000000000') ? n.toString() : Number(n.toFixed(4)).toLocaleString(undefined, { maximumFractionDigits: 4 });
  return unit === 'usd' ? '$' + formatted : unit === 'cny' ? 'CN\u00a5' + formatted : formatted + (unit === 'percent' ? '%' : '');
}
export function countdown(at: string, now = Date.now()) {
  const seconds = Math.max(0, Math.ceil((Date.parse(at) - now) / 1000));
  if (!seconds) return 'Reset due';
  const d = Math.floor(seconds / 86400), h = Math.floor(seconds % 86400 / 3600), m = Math.floor(seconds % 3600 / 60);
  return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + m + 'm' : m ? m + 'm ' + seconds % 60 + 's' : seconds + 's';
}
export function age(at: string | null, now = Date.now()) {
  if (!at) return 'Not checked';
  const minutes = Math.max(0, Math.floor((now - Date.parse(at)) / 60000));
  return minutes < 1 ? 'Just now' : minutes < 60 ? minutes + 'm ago' : minutes < 1440 ? Math.floor(minutes / 60) + 'h ago' : Math.floor(minutes / 1440) + 'd ago';
}
