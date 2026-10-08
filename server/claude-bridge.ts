import { readFile, writeFile, mkdir, copyFile, rename, unlink } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type BridgeStatus = { state: 'configured' | 'missing' | 'custom'; settings: string; command: string };

export const claudeSettingsPath = () => join(resolve(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')), 'settings.json');
// Resolves from server/*.ts (tsx) and dist/server/*.js (build) alike.
function bridgeScript() {
  const candidates = ['../scripts/claude-statusline.mjs', '../../scripts/claude-statusline.mjs'].map(path => fileURLToPath(new URL(path, import.meta.url)));
  const found = candidates.find(path => existsSync(path));
  if (!found) throw new Error('Quota status-line script is missing. Rebuild Quota from its project folder.');
  return found;
}
// Double-quoted native paths are accepted by Windows cmd and the documented Git Bash shell.
// Reject shell metacharacters instead of trying to support ambiguous executable paths.
const quote = (value: string) => {
  const normalized = value.replaceAll('\\', '/');
  if (/["$`%\r\n!]/.test(normalized)) throw new Error('Unsupported shell characters in setup path.');
  return '"' + normalized + '"';
};
export const bridgeCommand = (dataDirectory: string) => [process.execPath, bridgeScript(), join(dataDirectory, 'claude-code.json')].map(quote).join(' ');

async function readSettings(settings: string) {
  let original: string | null = null, config: Record<string, unknown> = {};
  try { original = await readFile(settings, 'utf8'); config = JSON.parse(original); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Cannot parse Claude settings. Settings were not changed.', { cause: error }); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid Claude settings. Settings were not changed.');
  return { original, config };
}
const stateOf = (config: Record<string, unknown>, command: string): BridgeStatus['state'] => {
  const line = config.statusLine as { command?: unknown } | undefined;
  return !line ? 'missing' : line.command === command ? 'configured' : 'custom';
};

export async function bridgeStatus(dataDirectory: string, settings = claudeSettingsPath()): Promise<BridgeStatus> {
  const command = bridgeCommand(dataDirectory), { config } = await readSettings(settings);
  return { state: stateOf(config, command), settings, command };
}

// Adds Quota's status line, preserving unrelated settings. Never replaces an existing custom status line.
export async function installBridge(dataDirectory: string, settings = claudeSettingsPath()): Promise<BridgeStatus> {
  const command = bridgeCommand(dataDirectory), { original, config } = await readSettings(settings);
  const state = stateOf(config, command);
  if (state !== 'missing') return { state, settings, command };
  await mkdir(dirname(settings), { recursive: true });
  if (original !== null) await copyFile(settings, settings + '.quota-backup-' + Date.now(), constants.COPYFILE_EXCL);
  config.statusLine = { type: 'command', command };
  const serialized = JSON.stringify(config, null, 2) + '\n';
  if (original === null) await writeFile(settings, serialized, { flag: 'wx', mode: 0o600 });
  else {
    const temporary = settings + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, serialized, { flag: 'wx', mode: 0o600 });
      // Recheck before replacing to avoid discarding edits made while setup was preparing.
      if (await readFile(settings, 'utf8') !== original) throw new Error('Claude settings changed during setup; retry.');
      await rename(temporary, settings);
    } finally { await unlink(temporary).catch(() => {}); }
  }
  return { state: 'configured', settings, command };
}
