import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { metricSchema } from '../shared/model.js';
import { CollectionError, CollectionWaiting, type Collector } from './collectors.js';

const window = z.object({ used_percentage: z.number().min(0).max(100), resets_at: z.number().int().nonnegative().max(253402300799) }).strict();
const snapshot = z.object({ observedAt: z.string().datetime(), rate_limits: z.object({ five_hour: window.optional(), seven_day: window.optional() }).strict() }).strict();
export function parseClaudeCode(input: unknown, now = Date.now()) {
  const data = snapshot.parse(input);
  if (Date.parse(data.observedAt) > now + 60000) throw new CollectionError('Claude Code observation time is in the future. Check your system clock.');
  return Object.entries(data.rate_limits).map(([key, value]) => metricSchema.parse({
    key: 'claude-code:' + key, label: key === 'five_hour' ? '5-hour window' : 'Weekly window', kind: 'quota', unit: 'percent',
    usedPercent: String(value.used_percentage), allowance: 'finite', enforcement: 'provider',
    resetAt: new Date(value.resets_at * 1000).toISOString(), resetKind: 'rolling', resetBasis: 'provider_reported',
    observedAt: data.observedAt, provenance: 'provider_reported', freshnessSeconds: 600
  }));
}
export function claudeCodeCollector(directory: string): Collector {
  return async () => {
    const file = join(directory, 'claude-code.json');
    try {
      if ((await stat(file)).size > 8192) throw new Error('Oversized snapshot');
      const metrics = parseClaudeCode(JSON.parse(await readFile(file, 'utf8')));
      return { metrics };
    } catch (error) {
      if (error instanceof CollectionError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new CollectionWaiting('Waiting for your first Claude Code session. Send a message in Claude Code in a terminal; usage appears here automatically.');
      throw new CollectionError('No Claude Code usage reported yet. Use Claude Code with a Pro or Max subscription. If you have a custom status line, see Source settings or docs/dynamic-collection.md.');
    }
  };
}
