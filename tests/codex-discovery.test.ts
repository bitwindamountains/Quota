import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverCodex } from '../server/codex-discovery.js';
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function setup() { const home = await mkdtemp(join(tmpdir(), 'quota-discovery-')); dirs.push(home); return home; }
async function file(path: string) { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, 'synthetic executable fixture'); return path; }
it('discovers the newest working extension and retries after an update removes it', async () => {
  const home = await setup();
  const old = await file(join(home, '.vscode', 'extensions', 'openai.chatgpt-2.9.0-win32-x64', 'bin', 'windows-x86_64', 'codex.exe'));
  const recent = await file(join(home, '.vscode', 'extensions', 'openai.chatgpt-2.10.0-win32-x64', 'bin', 'windows-x86_64', 'codex.exe'));
  const options = { home, env: {}, platform: 'win32' as const, probe: async () => '1.0.0' };
  expect((await discoverCodex(options)).path).toBe(recent);
  await rm(recent);
  expect((await discoverCodex(options)).path).toBe(old);
});
it('honors an explicit native override and never silently falls back from a broken override', async () => {
  const home = await setup(), path = await file(join(home, 'codex.exe'));
  expect(await discoverCodex({ home, env: { CODEX_EXECUTABLE: path }, platform: 'win32', probe: async () => '1.2.3' })).toMatchObject({ path, method: 'override' });
  await expect(discoverCodex({ home, env: { CODEX_EXECUTABLE: join(home, 'missing.exe'), PATH: home }, platform: 'win32' })).rejects.toThrow('Remove that setting');
  await expect(discoverCodex({ home, env: { CODEX_EXECUTABLE: 'codex.cmd' }, platform: 'win32' })).rejects.toThrow('native Codex');
});
it('skips incompatible candidates and does not search the current working directory', async () => {
  const home = await setup(), path = await file(join(home, '.codex', 'bin', 'codex.exe'));
  await file(join(home, 'codex.exe'));
  const seen: string[] = [];
  const result = await discoverCodex({ home, env: { PATH: home }, platform: 'win32', probe: async p => { seen.push(p); if (p !== path) throw new Error('invalid'); return '1.0'; } });
  expect(result.path).toBe(path); expect(seen).toHaveLength(2);
  await rm(path);
  await expect(discoverCodex({ home, env: { PATH: '.' }, platform: 'win32', probe: async () => '1.0' })).rejects.toThrow('not detected');
});
