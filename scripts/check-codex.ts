import { codexCollector } from '../server/collectors.js';
import { sourceInputSchema, type Source } from '../shared/model.js';
const s: Source = { ...sourceInputSchema.parse({ provider: 'codex', name: 'Validation', mode: 'automatic' }), id: 'validation',
  revision: 1, position: 0, metrics: [], lastAttempt: null, lastSuccess: null, error: null, failures: 0, nextAttempt: 0, authPaused: false };
try {
  const result = await codexCollector(s, AbortSignal.timeout(30000));
  // Never print quota values, identifiers, email, tokens, or raw provider payloads.
  console.log(JSON.stringify({ success: true, windowCount: result.metrics.length,
    allHaveObservationTime: result.metrics.every(m => !!m.observedAt),
    resetTimesValid: result.metrics.every(m => !m.resetAt || Number.isFinite(Date.parse(m.resetAt))),
    accountBound: !!result.fingerprint }));
} catch {
  console.log(JSON.stringify({ success: false, reason: 'No compatible signed-in read interface was available. Manual tracking remains usable.' }));
  process.exitCode = 1;
}
