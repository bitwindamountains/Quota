import nodemailer from 'nodemailer';
import { z } from 'zod';

export type ResetEmail = { id: string; to: string; sourceName: string; metricLabel: string; dueAt: string };
export interface Mailer { configured: boolean; send(message: ResetEmail): Promise<void> }
export class EmailFailure extends Error {
  constructor(public outcome: 'retry' | 'failed' | 'uncertain') { super('Email delivery could not be confirmed.'); }
}
export function createMailer(env: NodeJS.ProcessEnv = process.env): Mailer {
  const config = z.object({
    host: z.string().min(1).max(253).regex(/^[a-zA-Z0-9.-]+$/),
    port: z.enum(['465', '587']), from: z.email(),
    user: z.string().min(1), pass: z.string().min(1)
  }).safeParse({ host: env.QUOTA_SMTP_HOST, port: env.QUOTA_SMTP_PORT || '587', from: env.QUOTA_SMTP_FROM, user: env.QUOTA_SMTP_USER, pass: env.QUOTA_SMTP_PASSWORD });
  if (!config.success) return { configured: false, send: async () => { throw new EmailFailure('failed'); } };
  const c = config.data;
  const transport = nodemailer.createTransport({
    host: c.host, port: Number(c.port), secure: c.port === '465', requireTLS: true,
    auth: { user: c.user, pass: c.pass }, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000, dnsTimeout: 10000,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true
  });
  return { configured: true, async send(message) {
    const name = message.sourceName.replace(/[\r\n]/g, ' '), label = message.metricLabel.replace(/[\r\n]/g, ' ');
    try {
      const result = await transport.sendMail({
        from: c.from, to: z.email().parse(message.to),
        messageId: '<' + message.id + '@quota.local>',
        subject: 'Reset reminder: ' + name + ' — ' + label,
        text: name + ' / ' + label + '\n\nThe tracked reset was scheduled for ' + message.dueAt + ' (UTC).\nCheck the provider to confirm availability. This reminder does not confirm that your quota has replenished.\n\nYou enabled this reminder in Quota on your computer. Disable it using the alarm button on this reset window.',
        disableFileAccess: true, disableUrlAccess: true
      });
      if (!result.accepted?.length) throw new EmailFailure('failed');
    } catch (error) {
      if (error instanceof EmailFailure) throw error;
      const e = error as { responseCode?: number; command?: string; code?: string };
      if (e.responseCode && e.responseCode >= 500) throw new EmailFailure('failed');
      if (e.responseCode && e.responseCode >= 400) throw new EmailFailure('retry');
      if (['CONN', 'EHLO', 'HELO', 'STARTTLS', 'AUTH', 'MAIL FROM', 'RCPT TO'].includes(e.command || '') || ['EDNS', 'ECONNECTION'].includes(e.code || '')) throw new EmailFailure('retry');
      // A connection loss during DATA may follow acceptance. Do not automatically send a duplicate.
      throw new EmailFailure('uncertain');
    }
  } };
}
