import { mkdirSync, openSync, closeSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from './storage.js';
import { createApp } from './app.js';
import { dataDir } from './paths.js';

const dir = dataDir();
mkdirSync(dir, { recursive: true, mode: 0o700 });
const lock = join(dir, 'app.lock');
function acquireLock() {
  try { return openSync(lock, 'wx', 0o600); }
  catch {
    const pid = Number(readFileSync(lock, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid app.lock. Verify no tracker is running before removing it.');
    let running = true;
    try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') running = false; }
    if (running) throw new Error('Quota is already running with this data directory.');
    unlinkSync(lock); return openSync(lock, 'wx', 0o600);
  }
}
let fd: number | undefined;
let store: Store | undefined;
let server: Awaited<ReturnType<typeof createApp>> | undefined;
let closing = false;
async function shutdown(code = 0) {
  if (closing) return; closing = true;
  await server?.app.close(); store?.close();
  if (fd !== undefined) { closeSync(fd); unlinkSync(lock); }
  process.exitCode = code;
}
try {
  fd = acquireLock(); writeFileSync(fd, String(process.pid));
  const port = Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535.');
  store = new Store(join(dir, 'quota.db'));
  server = await createApp(store, { port, development: process.env.NODE_ENV === 'development' });
  await server.app.listen({ port, host: '127.0.0.1' });
  console.log('Quota is ready at http://127.0.0.1:' + port);
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  console.error(code === 'EADDRINUSE' ? 'This local port is in use. Stop the existing app or set PORT in .env.' : 'Unable to start Quota. Check the data directory, app.lock, and database compatibility. Existing data was not replaced.');
  await shutdown(1);
}
