import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseClaudeCode, claudeCodeCollector } from '../server/claude-code.js';
import { CollectionWaiting } from '../server/collectors.js';
import { Store } from '../server/storage.js';
import { createApp } from '../server/app.js';

const directories: string[] = [];
afterEach(() => { for (const directory of directories) rmSync(directory, { recursive: true, force: true }); directories.length = 0; });
const rate_limits = { five_hour: { used_percentage: 42, resets_at: 1900000000 } };
it('maps only reported windows and preserves observation age', () => {
  const observedAt = '2026-01-01T00:00:00.000Z';
  const metrics = parseClaudeCode({ observedAt, rate_limits });
  expect(metrics).toHaveLength(1);
  expect(metrics[0]).toMatchObject({ usedPercent: '42', observedAt, resetBasis: 'provider_reported', used: null, limit: null });
  expect(parseClaudeCode({ observedAt, rate_limits: {} })).toEqual([]);
  expect(() => parseClaudeCode({ observedAt, rate_limits: { five_hour: { used_percentage: 101, resets_at: 1900000000 } } })).toThrow();
  expect(() => parseClaudeCode({ observedAt: '2099-01-01T00:00:00.000Z', rate_limits })).toThrow();
});
it('bridge strips private data, preserves unchanged timestamps and clears absent windows', () => {
  const directory = mkdtempSync(join(tmpdir(), 'quota-claude-test-')); directories.push(directory);
  const destination = join(directory, 'claude-code.json');
  const run = (input: unknown) => spawnSync(process.execPath, [resolve('scripts/claude-statusline.mjs'), destination], { input: JSON.stringify(input), encoding: 'utf8', timeout: 5000 });
  expect(run({ rate_limits, transcript_path: 'PRIVATE_TRANSCRIPT', session_id: 'PRIVATE_SESSION', api_key: 'PRIVATE_KEY' }).status).toBe(0);
  const first = readFileSync(destination, 'utf8');
  expect(first).not.toContain('PRIVATE');
  expect(parseClaudeCode(JSON.parse(first))).toHaveLength(1);
  run({ rate_limits }); expect(readFileSync(destination, 'utf8')).toBe(first);
  run({ rate_limits: { five_hour: { used_percentage: -1 } } }); expect(readFileSync(destination, 'utf8')).toBe(first);
  run({}); expect(JSON.parse(readFileSync(destination, 'utf8')).rate_limits).toEqual({});
});
it('setup preserves custom status lines and unrelated settings', () => {
  const directory = mkdtempSync(join(tmpdir(), 'quota-claude-setup-test-')); directories.push(directory);
  const settings = join(directory, 'settings.json');
  const run = () => spawnSync(process.execPath, [resolve('scripts/claude-setup.mjs')], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: directory, AI_TRACKER_DATA_DIR: directory }, encoding: 'utf8', timeout: 5000
  });
  const custom = JSON.stringify({ statusLine: { type: 'command', command: 'existing-command' }, privateSetting: 'PRIVATE_CANARY' });
  writeFileSync(settings, custom);
  const refused = run();
  expect(refused.status).toBe(1); expect(refused.stdout).not.toContain('PRIVATE_CANARY');
  expect(readFileSync(settings, 'utf8')).toBe(custom);
  writeFileSync(settings, JSON.stringify({ privateSetting: 'PRIVATE_CANARY' }));
  expect(run().status).toBe(0);
  const saved = JSON.parse(readFileSync(settings, 'utf8'));
  expect(saved.privateSetting).toBe('PRIVATE_CANARY'); expect(saved.statusLine.command).toContain('claude-statusline.mjs');
  const first = readFileSync(settings, 'utf8'); expect(run().status).toBe(0); expect(readFileSync(settings, 'utf8')).toBe(first);
});
it('saving an automatic Claude Code source connects the bridge without replacing custom status lines', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'quota-claude-auto-test-')); directories.push(directory);
  const settings = join(directory, 'settings.json');
  const store = new Store(':memory:');
  const { app } = await createApp(store, { schedule: false, webRoot: 'does-not-exist', claudeSettings: settings });
  try {
    const base = { host: '127.0.0.1:4317', 'x-quota-client': '1' };
    const session = await app.inject({ url: '/api/session', headers: base });
    const headers = { ...base, cookie: session.cookies.map(c => c.name + '=' + c.value).join('; '), 'x-csrf-token': session.json().csrf, 'content-type': 'application/json' };
    const add = (mode: string) => app.inject({ method: 'POST', url: '/api/sources', headers, payload: { provider: 'claude-code', name: 'Claude Code', scope: mode, mode } });
    writeFileSync(settings, JSON.stringify({ privateSetting: 'PRIVATE_CANARY' }));
    expect((await app.inject({ url: '/api/claude-code/bridge', headers })).json().state).toBe('missing');
    expect((await add('manual')).statusCode).toBe(201);
    expect(JSON.parse(readFileSync(settings, 'utf8')).statusLine).toBeUndefined();
    expect((await add('automatic')).statusCode).toBe(201);
    const saved = JSON.parse(readFileSync(settings, 'utf8'));
    expect(saved.privateSetting).toBe('PRIVATE_CANARY'); expect(saved.statusLine.command).toContain('claude-statusline.mjs');
    expect((await app.inject({ url: '/api/claude-code/bridge', headers })).json().state).toBe('configured');
    const custom = JSON.stringify({ statusLine: { type: 'command', command: 'existing-command' } });
    writeFileSync(settings, custom);
    expect((await add('automatic')).statusCode).toBe(201);
    expect(readFileSync(settings, 'utf8')).toBe(custom);
    expect((await app.inject({ url: '/api/claude-code/bridge', headers })).json().state).toBe('custom');
    writeFileSync(settings, '{ not json');
    expect((await add('automatic')).statusCode).toBe(409);
    expect(readFileSync(settings, 'utf8')).toBe('{ not json');
  } finally { await app.close(); store.close(); }
});
it('reports a missing snapshot as an expected wait rather than a failure', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'quota-claude-wait-test-')); directories.push(directory);
  const collect = claudeCodeCollector(directory);
  await expect(collect({} as never, new AbortController().signal)).rejects.toBeInstanceOf(CollectionWaiting);
  writeFileSync(join(directory, 'claude-code.json'), '{ broken');
  const failure = await collect({} as never, new AbortController().signal).catch(error => error);
  expect(failure).not.toBeInstanceOf(CollectionWaiting);
});
