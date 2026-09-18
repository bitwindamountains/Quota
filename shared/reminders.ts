import { z } from 'zod';

export const alarmInput = z.object({
  revision: z.number().int().nonnegative(),
  sourceRevision: z.number().int().positive(),
  metricKey: z.string().min(1).max(140),
  enabled: z.boolean(),
  email: z.email().max(254).nullable()
}).strict();
export type Alarm = {
  id: string; sourceId: string; metricKey: string; revision: number;
  enabled: boolean; email: string | null; dueAt: string | null;
};
export type ReminderEvent = {
  id: string; sourceName: string; metricLabel: string; dueAt: string;
  emailState: 'none' | 'pending' | 'sending' | 'sent' | 'failed' | 'uncertain' | 'expired' | 'cancelled';
  emailError: string | null; notified: boolean; dismissed: boolean;
};
export type ReminderState = { alarms: Alarm[]; events: ReminderEvent[]; emailConfigured: boolean };
