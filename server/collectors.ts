import { childEnvironment } from './credentials.js';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { metricSchema, type Metric, type Source } from '../shared/model.js';

export class CollectionError extends Error {
  constructor(message: string, public pause = false, public retryAfter = 0) { super(message); }
}
export type Collected = { metrics: Metric[]; fingerprint?: string };
export type Collector = (source: Source, signal: AbortSignal) => Promise<Collected>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const windowSchema = z.object({
  usedPercent: z.number().min(0).max(100),
  windowDurationMins: z.number().positive().nullable().optional(),
  resetsAt: z.number().int().nonnegative().nullable().optional()
});
const bucketSchema = z.object({
  limitId: z.string().nullable().optional(),
  primary: windowSchema.nullable().optional(),
  secondary: windowSchema.nullable().optional()
});
const limitsSchema = z.object({
  rateLimits: bucketSchema.nullable().optional(),
  rateLimitsByLimitId: z.record(z.string(), bucketSchema).nullable().optional()
}).refine(v => !!v.rateLimits || !!v.rateLimitsByLimitId, 'Missing rate limits');

export function parseCodex(data: unknown, now = Date.now()): Metric[] {
  const parsed = limitsSchema.parse(data);
  const buckets = parsed.rateLimitsByLimitId ?? { [parsed.rateLimits?.limitId ?? 'codex']: parsed.rateLimits! };
  const metrics: Metric[] = [];
  for (const [id, bucket] of Object.entries(buckets)) {
    for (const role of ['primary', 'secondary'] as const) {
      const w = bucket[role]; if (!w) continue;
      const mins = w.windowDurationMins;
      const duration = !mins ? role : mins % 1440 === 0 ? mins / 1440 + '-day' : mins % 60 === 0 ? mins / 60 + '-hour' : mins + '-minute';
      metrics.push(metricSchema.parse({
        key: 'codex:' + hash(id).slice(0, 20) + ':' + role,
        label: (id === 'codex' ? '' : id.slice(0, 35) + ' · ') + duration + ' window',
        kind: 'quota', unit: 'percent', usedPercent: String(w.usedPercent),
        allowance: 'finite', enforcement: 'provider',
        limitState: w.usedPercent >= 100 ? 'reached' : 'not_reached',
        resetAt: w.resetsAt == null ? null : new Date(w.resetsAt * 1000).toISOString(),
        resetKind: 'unknown', resetBasis: w.resetsAt == null ? 'unknown' : 'provider_reported',
        observedAt: new Date(now).toISOString(), provenance: 'provider_reported', freshnessSeconds: 600
      }));
    }
  }
  if (!metrics.length) throw new CollectionError('This account did not return readable quota windows. Use manual tracking.', true);
  return metrics;
}

export async function codexCollector(source: Source, signal: AbortSignal): Promise<Collected> {
  const exe = process.env.CODEX_EXECUTABLE || 'codex';
  if (/\.(cmd|bat)$/i.test(exe)) throw new CollectionError('Point CODEX_EXECUTABLE to the native codex.exe, not a shell wrapper.', true);
  const child = spawn(exe, ['app-server', '-c', 'analytics.enabled=false', '-c', 'otel.exporter="none"', '-c', 'features.apps=false'],
    { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, env: childEnvironment(), cwd: process.env.TEMP || process.cwd() });
  let nextId = 0, buffered = '', bytes = 0, ended = false;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const fail = (error: Error) => { ended = true; for (const p of pending.values()) p.reject(error); pending.clear(); };
  const abort = () => { fail(new CollectionError('The Codex read timed out or was cancelled.')); child.kill(); };
  signal.addEventListener('abort', abort, { once: true });
  child.on('error', () => fail(new CollectionError('Codex could not start. Install the CLI or set CODEX_EXECUTABLE to its native executable.', true)));
  child.on('exit', () => fail(new CollectionError('Codex closed before returning usage. Check CLI compatibility and sign-in.')));
  child.stdin.on('error', () => fail(new CollectionError('The Codex connection closed.')));
  child.stdout.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > 2_000_000) { fail(new CollectionError('Codex returned too much data.')); child.kill(); return; }
    buffered += chunk.toString('utf8');
    let end: number;
    while ((end = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, end); buffered = buffered.slice(end + 1);
      try {
        const msg = JSON.parse(line) as { id?: number; method?: string; result?: unknown; error?: { code?: number } };
        if (msg.method && msg.id !== undefined) {
          // Never approve tool calls, OAuth flows, or token exchange requests.
          child.stdin.write(JSON.stringify({ id: msg.id, error: { code: -32601, message: 'Read-only client' } }) + '\n');
          continue;
        }
        if (msg.id === undefined) continue;
        const p = pending.get(msg.id); if (!p) continue; pending.delete(msg.id);
        if (msg.error) p.reject(new CollectionError('Codex could not read account limits. Check sign-in and CLI version, or use manual tracking.', true));
        else p.resolve(msg.result);
      } catch { fail(new CollectionError('Codex returned an unsupported response.')); child.kill(); }
    }
  });
  const rpc = (method: 'initialize' | 'account/read' | 'account/rateLimits/read', params: object) => new Promise<unknown>((resolve, reject) => {
    if (ended || signal.aborted) { reject(new CollectionError('Codex is unavailable.')); return; }
    const id = ++nextId; pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  try {
    await rpc('initialize', { clientInfo: { name: 'ai_usage_tracker', title: 'Quota', version: '1.3.0' } });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    const accountResponse = z.object({ account: z.object({ type: z.string(), email: z.string().nullable().optional() }).nullable() }).parse(await rpc('account/read', { refreshToken: false }));
    if (accountResponse.account?.type !== 'chatgpt') throw new CollectionError('Sign in to Codex with ChatGPT in the official CLI, then retry. API-key mode has no subscription windows.', true);
    const limits = await rpc('account/rateLimits/read', {});
    return { metrics: parseCodex(limits).map(m => ({ ...m, freshnessSeconds: source.pollSeconds * 2 })),
      fingerprint: accountResponse.account.email ? hash(accountResponse.account.email) : undefined };
  } finally {
    signal.removeEventListener('abort', abort);
    child.stdin.end(); child.kill();
  }
}

const routerSchema = z.object({ data: z.object({
  limit: z.number().nonnegative().nullable(),
  limit_remaining: z.number().nullable(),
  usage: z.number().nonnegative()
}) });
export function parseOpenRouter(data: unknown, now = Date.now()): Metric[] {
  const { data: d } = routerSchema.parse(data);
  const base = { observedAt: new Date(now).toISOString(), provenance: 'provider_reported', freshnessSeconds: 1800 };
  const metrics = [metricSchema.parse({ ...base, key: 'key:allowance', label: 'Key allowance', kind: 'quota', unit: 'usd',
    limit: d.limit === null ? null : String(d.limit), remaining: d.limit_remaining === null ? null : String(d.limit_remaining),
    used: d.limit !== null && d.limit_remaining !== null ? new Decimal(d.limit).minus(d.limit_remaining).toString() : null,
    allowance: d.limit === null ? 'unlimited' : 'finite', enforcement: 'provider'
  })];
  metrics.push(metricSchema.parse({ ...base, key: 'key:lifetime', label: 'Lifetime key usage', kind: 'usage_total', unit: 'usd', used: String(d.usage), allowance: 'not_applicable' }));
  return metrics;
}
export function retryAfter(value: string | null, now = Date.now()) {
  if (!value) return 0;
  const ms = /^\d+(\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) ? Math.max(0, ms) : 0;
}
export async function openRouterCollector(source: Source, signal: AbortSignal, credential?: () => Promise<string | undefined>): Promise<Collected> {
  const key = credential ? await credential() : process.env.OPENROUTER_API_KEY;
  if (!key) throw new CollectionError('Configure a protected key or OPENROUTER_API_KEY in source settings, then retry.', true);
  const response = await fetch('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: 'Bearer ' + key }, redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)])
  });
  if (response.status === 401 || response.status === 403) { await response.body?.cancel(); throw new CollectionError('OpenRouter rejected this key. Check the server credential and retry.', true); }
  if (response.status === 429) { await response.body?.cancel(); throw new CollectionError('OpenRouter requested a cooldown.', false, retryAfter(response.headers.get('retry-after'))); }
  if (!response.ok) { await response.body?.cancel(); throw new CollectionError('OpenRouter is temporarily unavailable.'); }
  const reader = response.body?.getReader();
  if (!reader) throw new CollectionError('OpenRouter returned an empty response.');
  let text = '', size = 0; const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 100_000) { await reader.cancel(); throw new CollectionError('OpenRouter returned an oversized response.'); }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return { metrics: parseOpenRouter(JSON.parse(text)).map(m => ({ ...m, freshnessSeconds: source.pollSeconds * 2 })), fingerprint: hash(key) };
}
export const collectors: Record<string, Collector> = { codex: codexCollector, openrouter: openRouterCollector };
