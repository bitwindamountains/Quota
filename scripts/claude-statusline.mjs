import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { clearTimeout } from 'node:timers';

// No network, credential reads, transcripts, workspace paths or raw payload persistence.
const destination = process.argv[2];
let input = '';
const timeout = setTimeout(() => process.exit(0), 3000);
try {
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 262144) throw new Error('Oversized input');
  }
  const payload = JSON.parse(input), rate_limits = {};
  for (const key of ['five_hour', 'seven_day']) {
    const value = payload.rate_limits?.[key];
    if (value == null) continue;
    if (!Number.isFinite(value.used_percentage) || value.used_percentage < 0 || value.used_percentage > 100 ||
        !Number.isSafeInteger(value.resets_at) || value.resets_at < 0 || value.resets_at > 253402300799) throw new Error('Invalid window');
    rate_limits[key] = { used_percentage: value.used_percentage, resets_at: value.resets_at };
  }
  const summary = Object.entries(rate_limits).map(([key, value]) => (key === 'five_hour' ? '5h' : '7d') + ': ' + value.used_percentage + '% used');
  console.log(summary.length ? summary.join(' | ') : 'Quota: limits not reported');
  if (destination) {
    let previous;
    try { previous = JSON.parse(await readFile(destination, 'utf8')); } catch { /* First observation. */ }
    // Status lines can repeat cached provider data on timer events. Do not manufacture freshness.
    if (JSON.stringify(previous?.rate_limits) !== JSON.stringify(rate_limits)) {
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      const temporary = destination + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temporary, JSON.stringify({ observedAt: new Date().toISOString(), rate_limits }), { mode: 0o600, flag: 'wx' });
        await rename(temporary, destination);
      } finally { await unlink(temporary).catch(() => {}); }
    }
  }
} catch { console.log('Quota: waiting for valid usage data'); }
finally { clearTimeout(timeout); }
