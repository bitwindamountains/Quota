import { beforeEach, expect, it, vi } from 'vitest';
const { createTransport, sendMail } = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport } }));
import { createMailer } from '../server/email.js';
const env = { QUOTA_SMTP_HOST: 'smtp.example.com', QUOTA_SMTP_PORT: '587', QUOTA_SMTP_USER: 'user', QUOTA_SMTP_PASSWORD: 'SMTP_CANARY', QUOTA_SMTP_FROM: 'sender@example.com' };
const message = { id: 'synthetic-event', to: 'recipient@example.com', sourceName: 'Example\r\nTool', metricLabel: 'Weekly', dueAt: '2030-01-01T00:00:00.000Z' };
beforeEach(() => { vi.clearAllMocks(); createTransport.mockReturnValue({ sendMail }); sendMail.mockResolvedValue({ accepted: ['recipient@example.com'] }); });
it('requires valid SMTP config, verified TLS and no file/URL access or logging', async () => {
  expect(createMailer({}).configured).toBe(false); expect(createTransport).not.toHaveBeenCalled();
  const mailer = createMailer(env); await mailer.send(message);
  expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: false, requireTLS: true, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false }));
  const sent = sendMail.mock.calls[0][0];
  expect(sent.subject).not.toMatch(/[\r\n]/); expect(sent.text).toContain('does not confirm'); expect(JSON.stringify(sent)).not.toContain('SMTP_CANARY');
  expect(sent.messageId).toBe('<synthetic-event@quota.local>');
  createMailer({ ...env, QUOTA_SMTP_PORT: '465' }); expect(createTransport).toHaveBeenLastCalledWith(expect.objectContaining({ secure: true }));
});
it('classifies safe retry, rejection and ambiguous DATA failures without leaking credentials', async () => {
  const mailer = createMailer(env);
  for (const [error, outcome] of [[{ responseCode: 451 }, 'retry'], [{ responseCode: 550 }, 'failed'], [{ command: 'CONN' }, 'retry'], [{ command: 'DATA', message: 'SMTP_CANARY' }, 'uncertain']] as const) {
    sendMail.mockRejectedValueOnce(error);
    await expect(mailer.send(message)).rejects.toMatchObject({ outcome, message: 'Email delivery could not be confirmed.' });
  }
});
