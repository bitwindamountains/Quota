import { acceptsEnvironment, keyIntegration, keyIntegrations } from '../shared/integrations.js';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { AppError, type Store } from './storage.js';

export const environmentName = z.string().max(110).refine(name => Object.keys(keyIntegrations).some(provider => acceptsEnvironment(provider, name)));
export const credentialInput = z.discriminatedUnion('method', [
  z.object({ method: z.literal('environment'), variable: environmentName }).strict(),
  z.object({ method: z.literal('protected'), key: z.string().trim().min(10).max(4096).regex(/^[\x21-\x7e]+$/) }).strict(),
  z.object({ method: z.literal('none') }).strict()
]);
type Configuration = { method: 'environment' | 'protected' | 'none'; variable?: string; reference?: string };

// Provider secrets must not be inherited by the CLI or the protection helper.
export function childEnvironment() {
  const allowed = new Set(['systemroot', 'windir', 'path', 'pathext', 'temp', 'tmp', 'home', 'userprofile', 'localappdata', 'appdata', 'programfiles', 'programfiles(x86)', 'programdata', 'codex_home', 'xdg_config_home']);
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => allowed.has(name.toLowerCase())));
}

const script = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Security
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $bytes = [Convert]::FromBase64String($request.value)
  $scope = [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  if ($request.operation -eq 'protect') {
    $result = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)
  } else {
    $result = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)
  }
  [Console]::Out.Write([Convert]::ToBase64String($result))
} catch { exit 1 }
`;
export function protectData(value: Buffer, operation: 'protect' | 'unprotect'): Promise<Buffer> {
  if (process.platform !== 'win32') return Promise.reject(new AppError(400, 'Protected storage requires Windows. Use an environment variable on this system.'));
  return new Promise((resolve, reject) => {
    const executable = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'], env: childEnvironment()
    });
    let output = '', failed = false;
    const fail = () => { failed = true; child.kill(); reject(new AppError(503, 'Windows-protected storage is unavailable. Your existing credential has not been changed.')); };
    const timer = setTimeout(fail, 10000);
    child.on('error', fail); child.stdin.on('error', fail);
    child.stdout.on('data', chunk => { output += chunk.toString(); if (output.length > 32768) fail(); });
    child.on('close', code => {
      clearTimeout(timer);
      if (failed) return;
      if (code !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(output)) { fail(); return; }
      resolve(Buffer.from(output, 'base64'));
    });
    // The key is sent only over an anonymous pipe, never in argv or a temporary plaintext file.
    child.stdin.end(JSON.stringify({ operation, value: value.toString('base64') }));
  });
}

export class Credentials {
  private busy = false;
  constructor(private store: Store, private directory: string) {}
  private config(id: string): Configuration {
    const row = this.store.db.prepare('SELECT config FROM credentials WHERE source_id=?').get(id) as { config: string } | undefined;
    // Preserve the explicitly documented v1 environment setup on upgrade.
    return row ? JSON.parse(row.config) as Configuration : this.store.get(id).provider === 'openrouter' ? { method: 'environment', variable: 'OPENROUTER_API_KEY' } : { method: 'none' };
  }
  status(id: string) {
    const source = this.checkSource(id);
    const c = this.config(id);
    return { method: c.method, variable: c.variable, configured: c.method === 'protected' ? !!c.reference && existsSync(this.file(c.reference)) : c.method === 'environment' ? acceptsEnvironment(source.provider, c.variable ?? '') && !!process.env[c.variable!] : false, protectedAvailable: process.platform === 'win32' };
  }
  private checkSource(id: string) {
    const source = this.store.get(id);
    if (!keyIntegration(source.provider)) throw new AppError(400, 'This tool does not have a supported key-based usage integration.');
    return source;
  }
  async resolve(id: string): Promise<string | undefined> {
    const source = this.checkSource(id);
    const c = this.config(id);
    if (c.method === 'none') return undefined;
    if (c.method === 'environment') {
      if (!acceptsEnvironment(source.provider, c.variable ?? '')) throw new AppError(400, 'Select an environment variable belonging to this provider.');
      return process.env[c.variable!];
    }
    const bytes = await readFile(this.file(c.reference!));
    if (bytes.length > 16384) throw new Error('Invalid protected credential.');
    return (await protectData(bytes, 'unprotect')).toString('utf8');
  }
  private file(reference: string) { return join(this.directory, z.string().uuid().parse(reference) + '.dpapi'); }
  async discard(reference?: string) {
    if (reference) await unlink(this.file(reference)).catch(e => { if (e.code !== 'ENOENT') throw new AppError(500, 'Could not remove the protected credential file.'); });
  }
  reference(id: string) { return this.config(id).reference; }
  async save(id: string, revision: number, input: z.infer<typeof credentialInput>) {
    if (this.busy) throw new AppError(429, 'Another credential change is in progress. Try again shortly.');
    this.busy = true;
    let reference: string | undefined, committed = false;
    try {
      const source = this.checkSource(id);
      if (source.revision !== revision) throw new AppError(409, 'Source changed. Reopen settings before changing credentials.');
      if (input.method === 'environment' && !acceptsEnvironment(source.provider, input.variable)) throw new AppError(400, 'Select an environment variable belonging to this provider.');
      const previous = this.config(id);
      let config: Configuration;
      if (input.method === 'protected') {
        const encrypted = await protectData(Buffer.from(input.key, 'utf8'), 'protect');
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        reference = randomUUID();
        await writeFile(this.file(reference), encrypted, { flag: 'wx', mode: 0o600 });
        config = { method: 'protected', reference };
      } else config = input;
      this.store.db.transaction(() => {
        // Recheck after the asynchronous OS operation; stale writes cannot replace newer settings.
        this.store.update(id, revision, { provider: source.provider, name: source.name, scope: source.scope, mode: source.mode, enabled: source.enabled, pollSeconds: source.pollSeconds });
        this.store.db.prepare('INSERT INTO credentials(source_id,config) VALUES(?,?) ON CONFLICT(source_id) DO UPDATE SET config=excluded.config').run(id, JSON.stringify(config));
        // A credential edit must not bypass a provider/network cooldown. Auth-paused sources may retry.
        if (source.authPaused || source.failures === 0) this.store.db.prepare('UPDATE sources SET next_attempt=0,failures=0,error=NULL WHERE id=?').run(id);
      })();
      committed = true;
      await this.discard(previous.reference);
      return { ...this.status(id), revision: this.store.get(id).revision };
    } finally {
      try { if (!committed && reference) await this.discard(reference); } finally { this.busy = false; }
    }
  }
}
