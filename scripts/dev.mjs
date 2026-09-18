import { spawn } from 'node:child_process';
const children = [
  spawn(process.execPath, ['--env-file-if-exists=.env', '--import', 'tsx', 'server/index.ts'], {
    stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' }
  }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' })
];
let closing = false;
function stop(code = 0) {
  if (closing) return;
  closing = true;
  children.forEach(child => child.kill());
  process.exitCode = code;
}
children.forEach(child => child.on('exit', code => stop(code ?? 1)));
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
