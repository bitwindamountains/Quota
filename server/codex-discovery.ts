import { access, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { childEnvironment } from './credentials.js';

const execute = promisify(execFile);
type Found = { path: string; version: string; method: 'override' | 'automatic' };
type Options = { env?: NodeJS.ProcessEnv; home?: string; platform?: NodeJS.Platform; probe?: (path: string) => Promise<string> };
const missing = 'Codex was not detected. Install the Codex CLI or VS Code extension, sign in, then detect again.';
async function probe(path: string) {
  const { stdout } = await execute(path, ['--version'], { windowsHide: true, timeout: 5000, maxBuffer: 8192, env: childEnvironment() });
  const match = /^codex-cli\s+([\w.+-]+)\s*$/m.exec(stdout);
  if (!match) throw new Error('Not a compatible Codex executable.');
  return match[1];
}
export async function discoverCodex(options: Options = {}): Promise<Found> {
  const env = options.env ?? process.env, home = options.home ?? homedir(), platform = options.platform ?? process.platform;
  const windows = platform === 'win32', native = windows ? 'codex.exe' : 'codex';
  const check = options.probe ?? probe;
  async function valid(path: string) {
    if (!isAbsolute(path) || /\.(cmd|bat|ps1)$/i.test(path) || (windows && !/\.exe$/i.test(path))) throw new Error('Native executable required.');
    if (!(await stat(path)).isFile()) throw new Error('File missing.');
    await access(path, windows ? constants.F_OK : constants.X_OK);
    return check(path);
  }
  if (env.CODEX_EXECUTABLE?.trim()) {
    const path = env.CODEX_EXECUTABLE.trim();
    try { return { path, version: await valid(path), method: 'override' }; }
    catch { throw new Error('CODEX_EXECUTABLE is unavailable or is not a native Codex executable. Remove that setting to use automatic discovery, or correct its absolute path and restart.'); }
  }
  const candidates: string[] = [];
  const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  for (const directory of pathValue.split(delimiter)) {
    if (isAbsolute(directory)) candidates.push(join(directory, native));
  }
  candidates.push(join(home, '.local', 'bin', native), join(home, '.codex', 'bin', native));
  if (windows && env.LOCALAPPDATA) candidates.push(join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin', native));
  const architectures = windows ? ['windows-x86_64', 'windows-aarch64'] : platform === 'darwin' ? ['macos-aarch64', 'macos-x86_64'] : ['linux-x86_64', 'linux-aarch64'];
  for (const folder of ['.vscode', '.vscode-insiders', '.cursor']) {
    const root = join(home, folder, 'extensions');
    const names = await readdir(root).catch(() => [] as string[]);
    for (const name of names.filter(n => /^openai\.chatgpt-\d[\w.-]*$/.test(n)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
      for (const architecture of architectures) candidates.push(join(root, name, 'bin', architecture, native));
    }
  }
  if (windows && env.APPDATA) {
    const root = join(env.APPDATA, 'npm', 'node_modules', '@openai');
    for (const arch of ['x86_64', 'aarch64']) {
      candidates.push(join(root, 'codex', 'vendor', arch + '-pc-windows-msvc', 'codex', native));
      candidates.push(join(root, 'codex', 'node_modules', '@openai', 'codex-win32-' + (arch === 'x86_64' ? 'x64' : 'arm64'), 'vendor', arch + '-pc-windows-msvc', 'codex', native));
    }
  }
  // Bounded search of expected locations, never the working directory or entire drive.
  let probes = 0;
  for (const path of [...new Set(candidates.map(p => resolve(p)))].slice(0, 200)) {
    if (!(await stat(path).catch(() => undefined))?.isFile()) continue;
    if (++probes > 3) break;
    try { return { path, version: await valid(path), method: 'automatic' }; } catch { /* Try the next native candidate. */ }
  }
  throw new Error(missing);
}

let cached: Found | undefined, pending: Promise<Found> | undefined;
export async function codexExecutable(force = false): Promise<Found> {
  if (!force && cached && (process.env.CODEX_EXECUTABLE?.trim() ?? '') === (cached.method === 'override' ? cached.path : '')) {
    if ((await stat(cached.path).catch(() => undefined))?.isFile()) return cached;
  }
  if (!pending) pending = discoverCodex().then(value => { cached = value; return value; }).finally(() => { pending = undefined; });
  return pending;
}
