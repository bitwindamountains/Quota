import { afterEach, expect, it, vi } from 'vitest';
import { keyCollector, parseCostPages, parseCursorPages, parseDeepSeek, parseMistral, parseCopilot } from '../server/key-collectors.js';
import { sourceInputSchema, supportsAuto, type Source } from '../shared/model.js';
import { minimumPoll } from '../shared/integrations.js';
const now = Date.parse('2026-09-17T12:00:00Z');
const source = (provider: Source['provider']): Source => ({ ...sourceInputSchema.parse({ provider, name: provider, mode: 'automatic', pollSeconds: minimumPoll(provider) }), id: 'test', revision: 1, position: 0, metrics: [], lastAttempt: null, lastSuccess: null, error: null, failures: 0, nextAttempt: 0, authPaused: false });
const openaiPage = (values: number[], day = 1, more = false, token: string | null = null) => ({ data: [{ start_time: Date.UTC(2026, 8, day) / 1000, end_time: Date.UTC(2026, 8, day + 1) / 1000, results: values.map(value => ({ amount: { value, currency: 'usd' } })) }], has_more: more, next_page: token });
const anthropicPage = (value = '123.78912') => ({ data: [{ starting_at: '2026-09-01T00:00:00Z', ending_at: '2026-09-02T00:00:00Z', results: [{ amount: value, currency: 'USD' }] }], has_more: false, next_page: null });
const cursorPage = (user = 'a', pages = 1) => ({ teamMemberSpend: [{ userId: user, spendCents: 25.5, overallSpendCents: 100.125 }], subscriptionCycleStart: Date.UTC(2026, 8, 1), totalPages: pages });
afterEach(() => vi.unstubAllGlobals());
it('uses decimal-safe reporting units without inventing balances or reset times', () => {
  expect(parseCostPages('openai', [openaiPage([0.1, 0.2])], now)[0]).toMatchObject({ used: '0.3', kind: 'usage_total', unit: 'usd', remaining: null, resetAt: null });
  expect(parseCostPages('anthropic', [anthropicPage()], now)[0]).toMatchObject({ used: '1.2378912', periodEnd: '2026-09-17T00:00:00.000Z' });
  expect(parseCursorPages([cursorPage()], now).map(m => m.used)).toEqual(['1.00125', '0.255']);
  expect(parseMistral({ limits: { completion: { monthly_limit_reached: false } } }, now)[0]).toMatchObject({ used: null, remaining: null, resetAt: null, limitState: 'not_reached' });
  expect(parseDeepSeek({ is_available: true, balance_infos: [{ currency: 'USD', total_balance: '10.05' }, { currency: 'CNY', total_balance: '20' }] }, now).map(m => [m.unit, m.remaining])).toEqual([['usd', '10.05'], ['cny', '20']]);
});
it('rejects missing amounts, mismatched currencies and overlapping reports instead of zero-filling', () => {
  expect(() => parseCostPages('openai', [{ ...openaiPage([]), data: [{ start_time: 1, end_time: 2, results: [{}] }] }], now)).toThrow();
  expect(() => parseCostPages('openai', [openaiPage([1]), openaiPage([1])], now)).toThrow('overlapping');
  expect(() => parseCostPages('anthropic', [{ ...anthropicPage(), data: [{ starting_at: '2026-09-01T00:00:00Z', ending_at: '2026-09-02T00:00:00Z', results: [{ amount: '1', currency: 'EUR' }] }] }], now)).toThrow();
  expect(() => parseCursorPages([cursorPage(), cursorPage()], now)).toThrow('overlapping');
  expect(() => parseDeepSeek({ is_available: true, balance_infos: [] }, now)).toThrow();
});
it('fully paginates OpenAI reports at the fixed endpoint with a provider-only bearer credential', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(openaiPage([0.1], 1, true, 'next/a?b'))).mockResolvedValueOnce(Response.json(openaiPage([0.2], 2)));
  vi.stubGlobal('fetch', fetch);
  const result = await keyCollector(source('openai'), new AbortController().signal, async () => 'OPENAI_CANARY', now);
  expect(result.metrics[0].used).toBe('0.3'); expect(fetch).toHaveBeenCalledTimes(2);
  const [url, options] = fetch.mock.calls[1];
  expect(new URL(url).origin).toBe('https://api.openai.com'); expect(new URL(url).searchParams.get('page')).toBe('next/a?b');
  expect(options).toMatchObject({ method: 'GET', redirect: 'error', headers: { Authorization: 'Bearer OPENAI_CANARY' } });
  expect(JSON.stringify(result)).not.toContain('OPENAI_CANARY');
});
it('uses the correct Anthropic reporting headers and a completed-day interval', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(anthropicPage())); vi.stubGlobal('fetch', fetch);
  await keyCollector(source('anthropic'), new AbortController().signal, async () => 'ANTHROPIC_CANARY', now);
  const [url, options] = fetch.mock.calls[0]; expect(new URL(url).searchParams.get('ending_at')).toBe('2026-09-17T00:00:00.000Z');
  expect(options.headers).toEqual({ 'x-api-key': 'ANTHROPIC_CANARY', 'anthropic-version': '2023-06-01' });
});
it('uses only the documented read-only Cursor POST and completes all pages', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(cursorPage('a', 2))).mockResolvedValueOnce(Response.json(cursorPage('b', 2))); vi.stubGlobal('fetch', fetch);
  const result = await keyCollector(source('cursor'), new AbortController().signal, async () => 'CURSOR_CANARY', now);
  expect(result.metrics[0].used).toBe('2.0025'); expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1]).toEqual(['https://api.cursor.com/teams/spend', expect.objectContaining({ method: 'POST', body: JSON.stringify({ page: 2, pageSize: 100 }), headers: { Authorization: 'Basic ' + Buffer.from('CURSOR_CANARY:').toString('base64'), 'Content-Type': 'application/json' } })]);
});
it('supports Mistral admin status and DeepSeek API balance with their own authentication', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ limits: { completion: { monthly_limit_reached: true } } })).mockResolvedValueOnce(Response.json({ is_available: true, balance_infos: [{ currency: 'USD', total_balance: '5' }] })); vi.stubGlobal('fetch', fetch);
  await keyCollector(source('mistral'), new AbortController().signal, async () => 'MISTRAL_CANARY', now);
  await keyCollector(source('deepseek'), new AbortController().signal, async () => 'DEEPSEEK_CANARY', now);
  expect(fetch.mock.calls[0]).toEqual(['https://api.mistral.ai/v1/admin/spend-limit', expect.objectContaining({ method: 'GET', headers: { 'x-api-key': 'MISTRAL_CANARY' } })]);
  expect(fetch.mock.calls[1]).toEqual(['https://api.deepseek.com/user/balance', expect.objectContaining({ headers: { Authorization: 'Bearer DEEPSEEK_CANARY' } })]);
});
it('rejects pagination loops and report-size limits without accepting a partial total', async () => {
  let fetch = vi.fn().mockImplementation(async () => Response.json(openaiPage([1], 1, true, 'same'))); vi.stubGlobal('fetch', fetch);
  await expect(keyCollector(source('openai'), new AbortController().signal, async () => 'secret', now)).rejects.toThrow('fully paginated');
  fetch = vi.fn().mockImplementation(async () => new Response('x'.repeat(1000001))); vi.stubGlobal('fetch', fetch);
  await expect(keyCollector(source('deepseek'), new AbortController().signal, async () => 'secret', now)).rejects.toThrow('too large');
});
it('fails closed on authentication errors, honors Retry-After, and makes no call without a selected credential', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response('SECRET_PROVIDER_BODY', { status: 403 })).mockResolvedValueOnce(new Response('SECRET_PROVIDER_BODY', { status: 429, headers: { 'Retry-After': '90' } })); vi.stubGlobal('fetch', fetch);
  await expect(keyCollector(source('openai'), new AbortController().signal, async () => undefined, now)).rejects.toThrow('Configure'); expect(fetch).not.toHaveBeenCalled();
  await expect(keyCollector(source('openai'), new AbortController().signal, async () => 'secret', now)).rejects.toMatchObject({ pause: true });
  await expect(keyCollector(source('openai'), new AbortController().signal, async () => 'secret', now)).rejects.toMatchObject({ retryAfter: 90000 });
});
it('advertises only implemented integrations and enforces provider polling minimums', () => {
  for (const provider of ['openai', 'anthropic', 'cursor', 'mistral', 'deepseek', 'copilot'] as const) {
    expect(supportsAuto(provider)).toBe(true);
    expect(sourceInputSchema.safeParse({ provider, name: provider, mode: 'automatic', pollSeconds: 300 }).success).toBe(false);
    expect(sourceInputSchema.safeParse({ provider, name: provider, mode: 'automatic', pollSeconds: minimumPoll(provider) }).success).toBe(true);
  }
  for (const provider of ['chatgpt', 'claude', 'gemini', 'groq', 'gemini-api', 'vertex']) expect(supportsAuto(provider)).toBe(false);
});
it('reads only the authenticated GitHub user and separates gross from billable AI credits', async () => {
  const report = { user: 'sample-user', timePeriod: { year: 2026, month: 9 }, usageItems: [
    { product: 'Copilot AI Credits', unitType: 'ai-credits', grossQuantity: 100, netQuantity: 20 },
    { product: 'Actions', unitType: 'minutes', grossQuantity: 500, netQuantity: 400 }
  ] };
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ login: 'sample-user' })).mockResolvedValueOnce(Response.json(report)); vi.stubGlobal('fetch', fetch);
  const result = await keyCollector(source('copilot'), new AbortController().signal, async () => 'GITHUB_CANARY', now);
  expect(result.metrics.map(m => m.used)).toEqual(['100', '20']);
  expect(result.metrics.every(m => m.remaining === null && m.resetAt === null)).toBe(true);
  expect(fetch.mock.calls[0][0]).toBe('https://api.github.com/user');
  expect(fetch.mock.calls[1][0]).toBe('https://api.github.com/users/sample-user/settings/billing/ai_credit/usage?year=2026&month=9');
  expect(fetch.mock.calls[1][1].headers).toMatchObject({ Authorization: 'Bearer GITHUB_CANARY', 'X-GitHub-Api-Version': '2026-03-10' });
  expect(() => parseCopilot({ ...report, user: 'other-user' }, 'sample-user', now)).toThrow('different account');
  expect(() => parseCopilot({ ...report, timePeriod: { year: 2025 } }, 'sample-user', now)).toThrow('reporting period');
});
it('rejects provider-supplied path injection in a GitHub login before any billing call', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ login: '../organizations/secret' })); vi.stubGlobal('fetch', fetch);
  await expect(keyCollector(source('copilot'), new AbortController().signal, async () => 'GITHUB_CANARY', now)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});
