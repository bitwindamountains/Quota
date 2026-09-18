import { keyIntegrations } from '../shared/integrations.js';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/storage.js';
import { Credentials, childEnvironment, credentialInput } from '../server/credentials.js';
import { openRouterCollector } from '../server/collectors.js';
import { sourceInputSchema } from '../shared/model.js';
const dirs: string[] = [], stores: Store[] = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const store of stores) store.close(); stores.length = 0; for (const dir of dirs) await rm(dir, { recursive: true, force: true }); dirs.length = 0; });
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'quota-credentials-')); dirs.push(dir);
  const store = new Store(join(dir, 'quota.db')); stores.push(store);
  const source = store.add(sourceInputSchema.parse({ provider: 'openrouter', name: 'Test' }));
  return { store, source, dir, vault: new Credentials(store, join(dir, 'credentials')) };
}
it('restricts environment references and keeps provider secrets out of child processes', () => {
  expect(credentialInput.safeParse({ method: 'environment', variable: 'AWS_SECRET_ACCESS_KEY' }).success).toBe(false);
  expect(credentialInput.safeParse({ method: 'environment', variable: 'QUOTA_OPENROUTER_WORK' }).success).toBe(true);
  process.env.QUOTA_OPENROUTER_TEST = 'synthetic-canary';
  try { expect(childEnvironment()).not.toHaveProperty('QUOTA_OPENROUTER_TEST'); } finally { delete process.env.QUOTA_OPENROUTER_TEST; }
});
it('supports independent environment sources, disconnects explicitly, and rejects stale writes', async () => {
  const { vault, source } = await setup();
  process.env.QUOTA_OPENROUTER_TEST = 'synthetic-canary';
  try {
    await vault.save(source.id, 1, { method: 'environment', variable: 'QUOTA_OPENROUTER_TEST' });
    expect(await vault.resolve(source.id)).toBe('synthetic-canary');
    await expect(vault.save(source.id, 1, { method: 'none' })).rejects.toThrow('Source changed');
    await vault.save(source.id, 2, { method: 'none' });
    expect(await vault.resolve(source.id)).toBeUndefined();
  } finally { delete process.env.QUOTA_OPENROUTER_TEST; }
});
it.skipIf(process.platform !== 'win32')('round-trips real DPAPI, excludes plaintext from DB/backup/files, replaces and removes keys', async () => {
  const { vault, source, store, dir } = await setup();
  const key = 'synthetic-key-canary-do-not-use-12345';
  await vault.save(source.id, 1, { method: 'protected', key });
  expect(await vault.resolve(source.id)).toBe(key);
  expect(JSON.stringify(vault.status(source.id))).not.toContain(key);
  const backup = join(dir, 'backup.db'); await store.backup(backup);
  for (const file of [join(dir, 'quota.db'), backup, ...((await readdir(join(dir, 'credentials'))).map(name => join(dir, 'credentials', name)))]) {
    expect((await readFile(file)).includes(Buffer.from(key))).toBe(false);
  }
  await vault.save(source.id, 2, { method: 'protected', key: key + '-replacement' });
  expect(await vault.resolve(source.id)).toBe(key + '-replacement');
  expect(await readdir(join(dir, 'credentials'))).toHaveLength(1);
  await vault.save(source.id, 3, { method: 'none' });
  expect(await vault.resolve(source.id)).toBeUndefined();
  expect(await readdir(join(dir, 'credentials'))).toHaveLength(0);
}, 30000);
it.skipIf(process.platform !== 'win32')('rolls back an OS write when the source is changed while encryption is pending', async () => {
  const { vault, source, store, dir } = await setup();
  const pending = vault.save(source.id, 1, { method: 'protected', key: 'synthetic-key-race-canary' });
  store.update(source.id, 1, sourceInputSchema.parse({ provider: 'openrouter', name: 'Changed' }));
  await expect(pending).rejects.toThrow('another tab');
  expect(vault.status(source.id).method).toBe('environment');
  expect(await readdir(join(dir, 'credentials'))).toHaveLength(0);
}, 15000);

it('sends only the selected credential to the fixed HTTPS endpoint and disallows redirects', async () => {
  const { source } = await setup();
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { limit: 10, limit_remaining: 7, usage: 13 } }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const result = await openRouterCollector(source, new AbortController().signal, async () => 'selected-synthetic-key');
  expect(fetch).toHaveBeenCalledWith('https://openrouter.ai/api/v1/key', expect.objectContaining({ headers: { Authorization: 'Bearer selected-synthetic-key' }, redirect: 'error' }));
  expect(result.metrics[0].used).toBe('3');
  expect(JSON.stringify(result)).not.toContain('selected-synthetic-key');
});
it.skipIf(process.platform !== 'win32')('fails closed if protected data cannot be decrypted, even when an environment key exists', async () => {
  const { source, vault, dir } = await setup();
  await vault.save(source.id, 1, { method: 'protected', key: 'synthetic-damaged-key' });
  const { writeFile } = await import('node:fs/promises');
  const filename = (await readdir(join(dir, 'credentials')))[0];
  await writeFile(join(dir, 'credentials', filename), 'damaged');
  await expect(vault.resolve(source.id)).rejects.toThrow('Windows-protected storage is unavailable');
}, 15000);
it('upgrades a v1 database with a pre-migration backup and preserves sources', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'quota-credentials-migration-')); dirs.push(dir);
  const path = join(dir, 'quota.db');
  const old = new Store(path);
  const source = old.add(sourceInputSchema.parse({ provider: 'openrouter', name: 'Existing source' }));
  old.db.exec('DROP TABLE reminder_events; DROP TABLE alarms; DROP TABLE credentials; PRAGMA user_version = 1;'); old.close();
  const upgraded = new Store(path); stores.push(upgraded);
  expect(upgraded.get(source.id).name).toBe('Existing source');
  expect(new Credentials(upgraded, join(dir, 'credentials')).status(source.id).variable).toBe('OPENROUTER_API_KEY');
  expect((await readdir(dir)).some(name => name.includes('.before-v2-'))).toBe(true);
});

it('credential changes preserve an active provider cooldown', async () => {
  const { vault, store, source } = await setup();
  const until = Date.now() + 600000;
  store.db.prepare('UPDATE sources SET failures=1,next_attempt=?,error=? WHERE id=?').run(until, 'Provider cooldown', source.id);
  await vault.save(source.id, 1, { method: 'environment', variable: 'QUOTA_OPENROUTER_TEST' });
  expect(store.get(source.id).nextAttempt).toBe(until);
  expect(store.get(source.id).failures).toBe(1);
});

it('keeps environment selection provider-specific and requires explicit opt-in for new integrations', async () => {
  const { store, vault } = await setup();
  for (const provider of ['openai', 'anthropic', 'cursor', 'mistral', 'deepseek', 'copilot'] as const) {
    const source = store.add(sourceInputSchema.parse({ provider, name: provider }));
    const variable = keyIntegrations[provider].variable;
    const previous = process.env[variable]; process.env[variable] = 'SYNTHETIC_' + provider;
    try {
      expect(vault.status(source.id).method).toBe('none'); expect(await vault.resolve(source.id)).toBeUndefined();
      await expect(vault.save(source.id, 1, { method: 'environment', variable: 'OPENROUTER_API_KEY' })).rejects.toThrow('belonging');
      await vault.save(source.id, 1, { method: 'environment', variable });
      expect(await vault.resolve(source.id)).toBe('SYNTHETIC_' + provider);
      expect(JSON.stringify(vault.status(source.id))).not.toContain('SYNTHETIC_');
    } finally { if (previous === undefined) delete process.env[variable]; else process.env[variable] = previous; }
  }
});
it.skipIf(process.platform !== 'win32')('protects keys independently for every supported new provider', async () => {
  const { store, vault } = await setup();
  for (const provider of ['openai', 'anthropic', 'cursor', 'mistral', 'deepseek', 'copilot'] as const) {
    const source = store.add(sourceInputSchema.parse({ provider, name: provider }));
    await vault.save(source.id, 1, { method: 'protected', key: 'synthetic-provider-key-' + provider });
    expect(await vault.resolve(source.id)).toBe('synthetic-provider-key-' + provider);
    expect(JSON.stringify(store.list())).not.toContain('synthetic-provider-key');
    await vault.save(source.id, 2, { method: 'none' }); expect(await vault.resolve(source.id)).toBeUndefined();
  }
}, 30000);
it('does not accept an unused key for unsupported consumer or API-only tools', async () => {
  const { store, vault } = await setup();
  for (const provider of ['claude', 'chatgpt', 'groq', 'gemini-api', 'vertex'] as const) {
    const source = store.add(sourceInputSchema.parse({ provider, name: provider }));
    await expect(vault.save(source.id, 1, { method: 'protected', key: 'synthetic-unused-key' })).rejects.toThrow('supported key-based');
  }
});
