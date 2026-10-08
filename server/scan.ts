import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { keyIntegrations } from '../shared/integrations.js';
import { providerFor, type ProviderId } from '../shared/model.js';
import { availableEnvironments } from './credentials.js';
import { codexExecutable } from './codex-discovery.js';

export type Candidate = { provider: ProviderId; name: string; mode: 'automatic' | 'manual'; found: string; environment?: string };

// Detection checks only whether well-known paths exist. It never reads file contents, credentials or history.
const home = homedir(), local = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
const anyExists = (...paths: string[]) => paths.some(path => { try { return existsSync(path); } catch { return false; } });
const onPath = (...names: string[]) => (process.env.PATH ?? '').split(delimiter).filter(Boolean).some(dir => anyExists(...names.map(name => join(dir, name))));
function extension(prefix: string) {
  for (const dir of [join(home, '.vscode', 'extensions'), join(home, '.cursor', 'extensions'), join(home, '.vscode-insiders', 'extensions')]) {
    try { if (readdirSync(dir).some(name => name.toLowerCase().startsWith(prefix))) return true; } catch { /* Editor not installed. */ }
  }
  return false;
}
const exe = (name: string) => process.platform === 'win32' ? [name + '.exe', name + '.cmd'] : [name];

export async function scanTools(existing: Set<string>): Promise<Candidate[]> {
  const found: Candidate[] = [];
  const add = (provider: ProviderId, mode: Candidate['mode'], detail: string, environment?: string) => {
    if (existing.has(provider) || found.some(c => c.provider === provider)) return;
    found.push({ provider, name: providerFor(provider).name, mode, found: detail, ...(environment ? { environment } : {}) });
  };
  const keyed = (provider: keyof typeof keyIntegrations, detail: string) => {
    const [environment] = availableEnvironments(provider);
    add(provider, environment ? 'automatic' : 'manual', environment ? detail + ' · ' + environment + ' configured' : detail, environment);
  };
  try { const codex = await codexExecutable(); add('codex', 'automatic', 'Codex CLI ' + codex.version); } catch { /* Not installed. */ }
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(home, '.claude');
  if (onPath(...exe('claude')) || anyExists(join(home, '.local', 'bin', exe('claude')[0]), join(claudeDir, 'settings.json')))
    add('claude-code', 'automatic', 'Claude Code installed');
  if (anyExists(join(local, 'Programs', 'cursor'), '/Applications/Cursor.app', join(home, '.cursor'))) keyed('cursor', 'Cursor app installed');
  if (extension('github.copilot')) keyed('copilot', 'Copilot editor extension installed');
  if (anyExists(join(home, '.gemini')) || onPath(...exe('gemini'))) add('gemini', 'manual', 'Gemini CLI installed');
  if (extension('saoudrizwan.claude-dev')) add('cline', 'manual', 'Cline editor extension installed');
  for (const provider of Object.keys(keyIntegrations) as (keyof typeof keyIntegrations)[]) {
    if (availableEnvironments(provider).length) keyed(provider, 'API key configured');
  }
  return found;
}
