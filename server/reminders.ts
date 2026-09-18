import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { alarmInput, type Alarm, type ReminderEvent, type ReminderState } from '../shared/reminders.js';
import { AppError, type Store } from './storage.js';
import { createMailer, EmailFailure, type Mailer } from './email.js';

type AlarmRow = { id: string; source_id: string; metric_key: string; revision: number; enabled: number; email: string | null; due_at: string | null };
type EventRow = { id: string; alarm_id: string; source_name: string; metric_label: string; due_at: string; email: string | null; email_state: ReminderEvent['emailState']; email_error: string | null; attempts: number; notified: number; dismissed: number };
const day = 86400000;

export class Reminders {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopped = false;
  private nextSend = 0;
  constructor(private store: Store, private mailer: Mailer = createMailer(), private clock = Date.now) {
    // Delivery could have succeeded just before a crash. Never blindly retry an in-flight message.
    store.db.prepare("UPDATE reminder_events SET email_state='uncertain',email_error='Delivery was interrupted; acceptance is unknown. Check your inbox.' WHERE email_state='sending'").run();
  }
  private alarm(row: AlarmRow): Alarm {
    return { id: row.id, sourceId: row.source_id, metricKey: row.metric_key, revision: row.revision, enabled: !!row.enabled, email: row.email, dueAt: row.due_at };
  }
  state(): ReminderState {
    const alarms = this.store.db.prepare('SELECT * FROM alarms').all() as AlarmRow[];
    const events = this.store.db.prepare('SELECT * FROM reminder_events ORDER BY due_at DESC LIMIT 100').all() as EventRow[];
    return { alarms: alarms.map(r => this.alarm(r)), events: events.map(r => ({ id: r.id, sourceName: r.source_name, metricLabel: r.metric_label, dueAt: r.due_at, emailState: r.email_state, emailError: r.email_error, notified: !!r.notified, dismissed: !!r.dismissed })), emailConfigured: this.mailer.configured };
  }
  save(sourceId: string, input: z.infer<typeof alarmInput>): Alarm {
    return this.store.db.transaction(() => {
      const source = this.store.get(sourceId);
      if (source.revision !== input.sourceRevision) throw new AppError(409, 'Source changed. Reopen the alarm settings.');
      const metric = source.metrics.find(m => m.key === input.metricKey);
      if (!metric) throw new AppError(404, 'This reset window is no longer available.');
      const old = this.store.db.prepare('SELECT * FROM alarms WHERE source_id=? AND metric_key=?').get(sourceId, input.metricKey) as AlarmRow | undefined;
      if ((old?.revision ?? 0) !== input.revision) throw new AppError(409, 'Alarm changed in another tab. Reopen its settings.');
      if (input.enabled && !source.enabled) throw new AppError(400, 'Enable this source before setting an alarm.');
      if (input.enabled && (!metric.resetAt || Date.parse(metric.resetAt) <= this.clock())) throw new AppError(400, 'Add or refresh a future reset time before setting this alarm.');
      if (input.enabled && input.email && !this.mailer.configured) throw new AppError(400, 'Configure SMTP in the server .env and restart before enabling email reminders.');
      const id = old?.id ?? randomUUID();
      this.store.db.prepare(`INSERT INTO alarms(id,source_id,metric_key,enabled,email,due_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(source_id,metric_key) DO UPDATE SET enabled=excluded.enabled,email=excluded.email,due_at=excluded.due_at,revision=alarms.revision+1`)
        .run(id, sourceId, input.metricKey, Number(input.enabled), input.email, input.enabled ? metric.resetAt : null);
      if (old) this.cancelPending(id);
      return this.alarm(this.store.db.prepare('SELECT * FROM alarms WHERE id=?').get(id) as AlarmRow);
    })();
  }
  private cancelPending(id: string) {
    this.store.db.prepare("UPDATE reminder_events SET email_state=CASE WHEN email_state='pending' THEN 'cancelled' ELSE email_state END,notified=1 WHERE alarm_id=?").run(id);
  }
  claim(id: string): boolean {
    return Number(this.store.db.prepare('UPDATE reminder_events SET notified=1 WHERE id=? AND notified=0 AND dismissed=0 AND due_at>=?').run(id, new Date(this.clock() - day).toISOString()).changes) === 1;
  }
  dismiss(id: string) { this.store.db.prepare('UPDATE reminder_events SET dismissed=1,notified=1 WHERE id=?').run(id); }
  start() {
    this.timer = setInterval(() => { void this.tick().catch(() => { /* No raw database or SMTP diagnostics in logs. */ }); }, 1000);
    this.timer.unref();
    void this.tick().catch(() => {});
  }
  tick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.process().finally(() => { this.running = undefined; });
    return this.running;
  }
  private async process() {
    const now = this.clock();
    this.store.db.transaction(() => {
      const sources = new Map(this.store.list().map(s => [s.id, s]));
      for (const alarm of this.store.db.prepare('SELECT * FROM alarms').all() as AlarmRow[]) {
        const source = sources.get(alarm.source_id), metric = source?.metrics.find(m => m.key === alarm.metric_key);
        if (!alarm.enabled || !source?.enabled || !metric?.resetAt) {
          this.cancelPending(alarm.id);
          this.store.db.prepare('UPDATE alarms SET due_at=NULL WHERE id=?').run(alarm.id);
          continue;
        }
        let due = alarm.due_at;
        // Corrected timestamps replace alarms that have not yet become due.
        if (due && Date.parse(due) > now && due !== metric.resetAt) due = null;
        if (due && Date.parse(due) <= now) {
          this.store.db.prepare(`INSERT OR IGNORE INTO reminder_events(id,alarm_id,source_name,metric_label,due_at,email,email_state,notified)
            VALUES(?,?,?,?,?,?,?,?)`).run(randomUUID(), alarm.id, source.name, metric.label, due, alarm.email,
            !alarm.email ? 'none' : now - Date.parse(due) > day ? 'expired' : 'pending', Number(now - Date.parse(due) > day));
          due = null;
        }
        if (!due && Date.parse(metric.resetAt) > now) due = metric.resetAt;
        this.store.db.prepare('UPDATE alarms SET due_at=? WHERE id=?').run(due, alarm.id);
      }
      this.store.db.prepare("UPDATE reminder_events SET email_state='expired',email_error='Reminder is over 24 hours old; email was not sent.' WHERE email_state='pending' AND due_at<?").run(new Date(now - day).toISOString());
      this.store.db.prepare('DELETE FROM reminder_events WHERE due_at<?').run(new Date(now - 30 * day).toISOString());
    })();
    if (!this.mailer.configured || this.stopped || now < this.nextSend) return;
    const event = this.store.db.prepare("SELECT * FROM reminder_events WHERE email_state='pending' AND next_attempt<=? ORDER BY due_at LIMIT 1").get(now) as EventRow | undefined;
    if (!event) return;
    this.nextSend = now + 5000;
    this.store.db.prepare("UPDATE reminder_events SET email_state='sending',attempts=attempts+1 WHERE id=?").run(event.id);
    try {
      await this.mailer.send({ id: event.id, to: event.email!, sourceName: event.source_name, metricLabel: event.metric_label, dueAt: event.due_at });
      this.store.db.prepare("UPDATE reminder_events SET email_state='sent',email_error=NULL WHERE id=?").run(event.id);
    } catch (error) {
      const outcome = error instanceof EmailFailure ? error.outcome : 'uncertain';
      const retry = outcome === 'retry' && event.attempts < 2;
      this.store.db.prepare('UPDATE reminder_events SET email_state=?,email_error=?,next_attempt=? WHERE id=?').run(
        retry ? 'pending' : outcome === 'uncertain' ? 'uncertain' : 'failed',
        retry ? 'Email could not be sent. A retry is scheduled.' : outcome === 'uncertain' ? 'Email acceptance is unknown. Check your inbox; no automatic resend.' : 'Email failed. Check SMTP configuration and the recipient address.',
        now + 60000 * 2 ** event.attempts, event.id);
    }
  }
  async stop() { this.stopped = true; clearInterval(this.timer); await this.running; }
}
