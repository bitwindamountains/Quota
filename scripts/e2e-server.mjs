import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
// A new isolated database each run. Never points at the real workspace.
const data = mkdtempSync(join(tmpdir(), 'quota-e2e-'));
const child = spawn(process.execPath, ['dist/server/index.js'], {
  stdio: 'inherit', env: { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('QUOTA_') && !['OPENAI_ADMIN_KEY', 'ANTHROPIC_ADMIN_KEY', 'CURSOR_API_KEY', 'MISTRAL_ADMIN_KEY', 'DEEPSEEK_API_KEY', 'GITHUB_COPILOT_TOKEN'].includes(name))), AI_TRACKER_DATA_DIR: data, PORT: '4320', NODE_ENV: 'test', OPENROUTER_API_KEY: '' }, windowsHide: true
});
child.on('exit', code => { process.exitCode = code ?? 0; });
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
