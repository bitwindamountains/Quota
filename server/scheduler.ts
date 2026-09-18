import { ZodError } from 'zod';
import { Store, AppError } from './storage.js';
import { collectors, CollectionError, type Collector } from './collectors.js';

export class Scheduler {
  private active = new Map<string, { abort: AbortController; done: Promise<void> }>();
  private timer?: ReturnType<typeof setInterval>;
  private stopping = false;
  private lastCleanup = 0;
  constructor(private store: Store, private adapters: Record<string, Collector> = collectors) {}
  start() {
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref();
    this.tick();
  }
  tick() {
    if (this.stopping) return;
    const now = Date.now();
    if (now - this.lastCleanup > 86400000) { this.store.cleanup(now); this.lastCleanup = now; }
    for (const source of this.store.list()) {
      if (this.active.size >= 2) break;
      if (source.enabled && source.mode === 'automatic' && !source.authPaused && source.nextAttempt <= now && !this.active.has(source.id))
        this.run(source.id);
    }
  }
  request(id: string) {
    const s = this.store.get(id);
    if (!s.enabled || s.mode !== 'automatic') throw new AppError(400, 'Only enabled automatic sources can refresh.');
    if (this.active.has(id)) return { status: 'running' };
    if (s.nextAttempt > Date.now() && (s.failures > 0 || (s.lastAttempt && Date.now() - Date.parse(s.lastAttempt) < 30000)))
      return { status: 'cooldown', nextAttempt: s.nextAttempt };
    if (this.active.size >= 2) return { status: 'busy' };
    this.store.permitRetry(id); this.run(id);
    return { status: 'accepted' };
  }
  private run(id: string) {
    const source = this.store.get(id), adapter = this.adapters[source.provider];
    if (!adapter || this.stopping) return;
    const abort = new AbortController();
    const runId = this.store.begin(source, Date.now());
    const done = Promise.resolve().then(async () => {
      const deadline = setTimeout(() => abort.abort(), 60000);
      try {
        const result = await adapter(source, abort.signal);
        if (abort.signal.aborted) throw new CollectionError('Collection was cancelled.');
        this.store.accept(source, runId, result.metrics, Date.now(), Date.now() + source.pollSeconds * 1000 + Math.random() * 5000, result.fingerprint);
      } catch (error) {
        const safe = error instanceof CollectionError ? error : error instanceof ZodError ? new CollectionError('Provider data changed. Previous readings are preserved.', true)
          : error instanceof AppError ? new CollectionError(error.message, true) : new CollectionError('Unable to read usage. Check your connection and retry.');
        const delay = Math.max(safe.retryAfter, Math.min(3600000, 30000 * 2 ** Math.min(source.failures, 7))) + Math.random() * 2000;
        this.store.fail(source, runId, safe.message, Date.now() + delay, safe.pause);
      } finally { clearTimeout(deadline); this.active.delete(id); }
    });
    this.active.set(id, { abort, done });
  }
  cancel(id: string) { this.active.get(id)?.abort.abort(); }
  async stop() {
    this.stopping = true; clearInterval(this.timer);
    const tasks = [...this.active.values()]; tasks.forEach(t => t.abort.abort());
    await Promise.allSettled(tasks.map(t => t.done));
  }
  isRunning(id: string) { return this.active.has(id); }
}
