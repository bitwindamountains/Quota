import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { metricSchema, type Metric, type Source } from '../shared/model.js';
import { keyIntegration } from '../shared/integrations.js';
import { CollectionError, retryAfter, type Collected } from './collectors.js';

const endpoints = {
  openai: 'https://api.openai.com/v1/organization/costs',
  anthropic: 'https://api.anthropic.com/v1/organizations/cost_report',
  cursor: 'https://api.cursor.com/teams/spend',
  copilot: 'https://api.github.com/user',
  mistral: 'https://api.mistral.ai/v1/admin/spend-limit',
  deepseek: 'https://api.deepseek.com/user/balance'
} as const;
type Provider = keyof typeof endpoints;
const cursorToken = z.string().min(1).max(4096).nullable().optional();
const pageSchema = z.object({ data: z.array(z.unknown()).max(200), has_more: z.boolean(), next_page: cursorToken });
const number = z.number().finite();
const amount = z.string().regex(/^-?\d{1,20}(\.\d{1,12})?$/);
const startOfMonth = (now: number) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const common = (now: number) => ({ observedAt: new Date(now).toISOString(), provenance: 'provider_reported', freshnessSeconds: 3600 });
function moneyTotal(key: string, label: string, total: Decimal, now: number, start: number, end: number): Metric {
  if (total.lt(0)) throw new CollectionError('This report contains net negative adjustments. Use the provider dashboard for this period.', true);
  return metricSchema.parse({ ...common(now), key, label, kind: 'usage_total', unit: 'usd', used: total.toDecimalPlaces(12).toString(), allowance: 'not_applicable', provenance: 'derived', periodStart: new Date(start).toISOString(), periodEnd: new Date(end).toISOString() });
}
export function parseCostPages(provider: 'openai' | 'anthropic', pages: unknown[], now: number): Metric[] {
  let sum = new Decimal(0);
  const today = new Date(now); today.setUTCHours(0, 0, 0, 0);
  const seen = new Set<number>();
  for (const raw of pages) {
    const page = pageSchema.parse(raw);
    for (const rawBucket of page.data) {
      const bucket = z.object({ results: z.array(z.unknown()).max(10000) }).parse(rawBucket);
      const dates = provider === 'openai'
        ? (() => { const v = z.object({ start_time: z.number().int(), end_time: z.number().int() }).parse(rawBucket); return [v.start_time * 1000, v.end_time * 1000]; })()
        : (() => { const v = z.object({ starting_at: z.string().datetime({ offset: true }), ending_at: z.string().datetime({ offset: true }) }).parse(rawBucket); return [Date.parse(v.starting_at), Date.parse(v.ending_at)]; })();
      if (dates[0] < startOfMonth(now) || dates[0] >= dates[1] || dates[0] > now || dates[1] > today.getTime() + (provider === 'openai' ? 86400000 : 0) || seen.has(dates[0]))
        throw new CollectionError('The cost report returned overlapping or unexpected time buckets. Previous readings are preserved.', true);
      seen.add(dates[0]);
      for (const result of bucket.results) {
        if (provider === 'openai') {
          const row = z.object({ amount: z.object({ currency: z.literal('usd'), value: number }) }).parse(result);
          sum = sum.plus(String(row.amount.value));
        } else {
          const row = z.object({ currency: z.literal('USD'), amount }).parse(result);
          sum = sum.plus(new Decimal(row.amount).div(100));
        }
      }
    }
  }
  const d = new Date(now), end = provider === 'anthropic' ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : now;
  return [moneyTotal(provider + ':reported-cost', provider === 'openai' ? 'Organization reported costs · UTC month' : 'Organization costs · completed UTC days this month', sum, now, startOfMonth(now), end)];
}
const cursorPage = z.object({
  teamMemberSpend: z.array(z.object({ userId: z.string().min(1), spendCents: number, overallSpendCents: number })).max(1000),
  subscriptionCycleStart: z.number().int().nonnegative(), totalPages: z.number().int().min(0).max(20)
});
export function parseCursorPages(pages: unknown[], now: number): Metric[] {
  let overall = new Decimal(0), onDemand = new Decimal(0), start: number | undefined;
  const seen = new Set<string>();
  for (const raw of pages) {
    const page = cursorPage.parse(raw);
    if (start !== undefined && page.subscriptionCycleStart !== start) throw new CollectionError('Cursor billing cycle changed during the read. Retry shortly.');
    start = page.subscriptionCycleStart;
    for (const row of page.teamMemberSpend) {
      if (seen.has(row.userId)) throw new CollectionError('Cursor returned overlapping pages. Previous readings are preserved.');
      seen.add(row.userId); overall = overall.plus(String(row.overallSpendCents)); onDemand = onDemand.plus(String(row.spendCents));
    }
  }
  if (start === undefined || start >= now) throw new CollectionError('Cursor returned an invalid billing period.', true);
  return [moneyTotal('cursor:overall', 'Team overall spend · current billing cycle', overall.div(100), now, start, now),
    moneyTotal('cursor:on-demand', 'Team on-demand spend · included in overall', onDemand.div(100), now, start, now)];
}
export function parseDeepSeek(raw: unknown, now: number): Metric[] {
  const data = z.object({ is_available: z.boolean(), balance_infos: z.array(z.object({ currency: z.enum(['USD', 'CNY']), total_balance: amount })).min(1).max(2) }).parse(raw);
  if (new Set(data.balance_infos.map(b => b.currency)).size !== data.balance_infos.length) throw new CollectionError('DeepSeek returned duplicate currency balances.', true);
  return data.balance_infos.map(b => metricSchema.parse({ ...common(now), key: 'deepseek:balance:' + b.currency, label: 'API account balance · ' + b.currency, kind: 'balance', unit: b.currency.toLowerCase(), remaining: b.total_balance, allowance: 'not_applicable' }));
}
export function parseMistral(raw: unknown, now: number): Metric[] {
  const data = z.object({ limits: z.object({ completion: z.object({ monthly_limit_reached: z.boolean() }) }) }).parse(raw);
  return [metricSchema.parse({ ...common(now), key: 'mistral:completion-status', label: 'Organization monthly completion limit', kind: 'quota', unit: 'requests', enforcement: 'provider', limitState: data.limits.completion.monthly_limit_reached ? 'reached' : 'not_reached' })];
}
export function parseCopilot(raw: unknown, login: string, now: number): Metric[] {
  const d = new Date(now);
  const data = z.object({ user: z.string(), timePeriod: z.object({ year: z.number().int(), month: z.number().int().optional() }), usageItems: z.array(z.object({
    product: z.string(), unitType: z.string(), grossQuantity: number.nonnegative(), netQuantity: number.nonnegative()
  })).max(10000) }).parse(raw);
  if (data.user.toLowerCase() !== login.toLowerCase() || data.timePeriod.year !== d.getUTCFullYear() || (data.timePeriod.month !== undefined && data.timePeriod.month !== d.getUTCMonth() + 1))
    throw new CollectionError('GitHub returned a different account or reporting period.', true);
  let gross = new Decimal(0), net = new Decimal(0);
  for (const row of data.usageItems.filter(r => /^copilot(?:$|[ -])/i.test(r.product))) {
    if (!['credits', 'ai-credits'].includes(row.unitType)) throw new CollectionError('GitHub returned an unsupported billing unit.', true);
    gross = gross.plus(String(row.grossQuantity)); net = net.plus(String(row.netQuantity));
  }
  return [[gross, 'gross', 'Personal Copilot AI credits used'], [net, 'net', 'Personal Copilot billable AI credits']].map(([value, key, label]) => metricSchema.parse({
    ...common(now), key: 'copilot:' + key, label, kind: 'usage_total', unit: 'credits', used: (value as Decimal).toDecimalPlaces(12).toString(), allowance: 'not_applicable', provenance: 'derived',
    periodStart: new Date(startOfMonth(now)).toISOString(), periodEnd: new Date(now).toISOString()
  }));
}

// Only fixed provider endpoints are reachable; pagination tokens are query values, never URLs.
async function read(provider: Provider, key: string, signal: AbortSignal, params?: URLSearchParams, body?: object, githubLogin?: string): Promise<unknown> {
  const url = new URL(endpoints[provider]); if (params) url.search = params.toString();
  if (provider === 'copilot' && githubLogin) url.pathname = '/users/' + z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/).parse(githubLogin) + '/settings/billing/ai_credit/usage';
  const headers: Record<string, string> = provider === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
    : provider === 'mistral' ? { 'x-api-key': key }
    : { Authorization: provider === 'cursor' ? 'Basic ' + Buffer.from(key + ':').toString('base64') : 'Bearer ' + key };
  if (body) headers['Content-Type'] = 'application/json';
  if (provider === 'copilot') { headers.Accept = 'application/vnd.github+json'; headers['X-GitHub-Api-Version'] = '2026-03-10'; headers['User-Agent'] = 'Quota-Usage-Tracker'; }
  const response = await fetch(url.toString(), { method: body ? 'POST' : 'GET', headers, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
  const name = keyIntegration(provider)!.name;
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401 || response.status === 403) throw new CollectionError(name + ' rejected the credential or reporting permissions. Check the required key type in source settings.', true);
    if (response.status === 429) throw new CollectionError(name + ' requested a cooldown.', false, retryAfter(response.headers.get('retry-after')));
    throw new CollectionError(name + ' reporting is unavailable. Previous readings are preserved.', response.status >= 400 && response.status < 500);
  }
  const reader = response.body?.getReader(); if (!reader) throw new CollectionError(name + ' returned an empty response.');
  let text = '', size = 0; const decoder = new TextDecoder();
  try {
    for (;;) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1000000) { await reader.cancel(); throw new CollectionError(name + ' report is too large for this local collector.', true); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode(); return JSON.parse(text) as unknown;
  } finally { reader.releaseLock(); }
}
export async function keyCollector(source: Source, signal: AbortSignal, credential: () => Promise<string | undefined>, now = Date.now()): Promise<Collected> {
  if (!Object.hasOwn(endpoints, source.provider)) throw new CollectionError('This provider has no key-based collector.', true);
  const provider = source.provider as Provider, integration = keyIntegration(provider)!;
  const key = await credential();
  if (!key) throw new CollectionError('Configure a ' + integration.credentialLabel + ' in source settings, then retry.', true);
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(55000)]);
  let metrics: Metric[];
  if (provider === 'openai' || provider === 'anthropic') {
    const d = new Date(now), start = startOfMonth(now), end = provider === 'anthropic' ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : Math.floor(now / 1000) * 1000;
    if (end <= start) throw new CollectionError('No completed reporting interval is available yet this UTC month. Retry after the first reporting interval.', false, Math.max(60000, start + 86400000 - now));
    const params = new URLSearchParams(provider === 'openai' ? { start_time: String(start / 1000), end_time: String(end / 1000), bucket_width: '1d', limit: '31' }
      : { starting_at: new Date(start).toISOString(), ending_at: new Date(end).toISOString(), bucket_width: '1d', limit: '31' });
    const pages: unknown[] = [], tokens = new Set<string>();
    for (let count = 0; count < 20; count++) {
      const page = pageSchema.parse(await read(provider, key, bounded, params)); pages.push(page);
      if (!page.has_more) break;
      if (!page.next_page || tokens.has(page.next_page) || count === 19) throw new CollectionError('The cost report could not be fully paginated. Previous readings are preserved.', true);
      tokens.add(page.next_page); params.set('page', page.next_page);
    }
    metrics = parseCostPages(provider, pages, now);
  } else if (provider === 'cursor') {
    const pages: unknown[] = []; let totalPages: number | undefined;
    for (let page = 1; page <= 20; page++) {
      const data = cursorPage.parse(await read(provider, key, bounded, undefined, { page, pageSize: 100 }));
      if (totalPages !== undefined && data.totalPages !== totalPages) throw new CollectionError('Cursor pagination changed during the read. Retry shortly.');
      totalPages = data.totalPages; pages.push(data); if (page >= totalPages) break;
    }
    metrics = parseCursorPages(pages, now);
  } else if (provider === 'copilot') {
    const account = z.object({ login: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/) }).parse(await read(provider, key, bounded));
    const d = new Date(now);
    const data = await read(provider, key, bounded, new URLSearchParams({ year: String(d.getUTCFullYear()), month: String(d.getUTCMonth() + 1) }), undefined, account.login);
    metrics = parseCopilot(data, account.login, now);
  } else {
    const data = await read(provider, key, bounded);
    metrics = provider === 'deepseek' ? parseDeepSeek(data, now) : parseMistral(data, now);
  }
  return { metrics: metrics.map(m => ({ ...m, freshnessSeconds: source.pollSeconds * 2 })), fingerprint: createHash('sha256').update(provider + '\0' + key).digest('hex') };
}
