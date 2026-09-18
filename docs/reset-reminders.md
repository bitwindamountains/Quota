# Reset alarms and email reminders

## Set an alarm

1. Add a tool and record its reset time, or let a supported automatic collector provide one.
2. Click **Set alarm** beside the desired window on its card: for example, Five hour, Weekly, or Monthly.
3. Leave **Alarm on this reset window** enabled. Optionally select **Email reminder** and enter one recipient address.
4. Click **Save alarm**. Each window has its own independent alarm.

An unknown reset time cannot be scheduled. Add a manual reset observation or refresh the provider first. Times are stored as UTC instants and displayed in your browser's local timezone, so calendar changes do not rely on a hardcoded number of hours.

When due, the dashboard shows a persistent reminder banner and an item under **Reminders**. The alarm follows later reset timestamps for that same metric. Automatic collection can supply them; manual entries need a new reset time after each occurrence. The app never assumes that five hours, seven days, or a month should be added to an old timestamp. A reminder says the tracked reset is due, not that the provider has actually replenished anything.

Use **Edit alarm** to disable it. Paused tools do not trigger alarms or unsent email. Deleting a tool removes its alarms and reminder history. Removing a metric or clearing its reset time cancels its scheduled alarm. Dismissing an inbox item only acknowledges the in-app reminder; it does not cancel a queued email. Disable the alarm to cancel unsent email. A message already being sent cannot be recalled.

## Sound and desktop alerts

Saving an alarm enables audio for that browser tab when permitted. **Enable / test sound** plays a short chime; it is also available in the Reminders inbox. After reopening or reloading the page, use that button again if your browser blocks audio without a new gesture.

**Enable desktop alerts** asks the browser for notification permission. Denying permission does not disable visual reminders or email. Notifications, background timer delivery, and sound depend on browser/OS policies, the tab remaining open, and the computer being awake. They are best-effort alerts, not a background Windows alarm service. Multiple tabs coordinate through a server claim so an occurrence is not deliberately sounded by every tab; the inbox remains available even if the claiming tab closes before it can alert.

## Enable email

Email is optional. The recipient is set per alarm in the UI; the sending account is configured once on the backend. Add these to the private, ignored `.env` in the project directory:

```dotenv
QUOTA_SMTP_HOST=smtp.example.com
QUOTA_SMTP_PORT=587
QUOTA_SMTP_USER=your-smtp-user
QUOTA_SMTP_PASSWORD="your-app-password"
QUOTA_SMTP_FROM=you@example.com
```

Use the SMTP details issued by your email provider. `QUOTA_SMTP_FROM` must be a sender the provider permits. Use a dedicated SMTP credential or app password where supported. Providers that require OAuth-only SMTP need a different transport configuration; this release supports SMTP username/password authentication, not interactive OAuth setup. Do not paste a password into the recipient field or any `VITE_*` variable.

Restart the server, reopen the alarm settings, enable **Email reminder**, and enter one recipient. The checkbox is unavailable until the server has structurally valid SMTP configuration. "Configured" does not confirm authentication, sender permission, recipient validity, or inbox delivery. After enabling your first reminder, check the Reminders inbox for delivery status and your mailbox/spam folder.

Port **587** requires STARTTLS. Port **465** uses TLS immediately. Certificate verification remains enabled and TLS 1.2 or later is required; plaintext SMTP and self-signed-certificate bypasses are not offered. The implementation uses [Nodemailer's SMTP transport](https://nodemailer.com/smtp), with logging, file access and URL content loading disabled.

The mail contains the tool display name, window label and scheduled reset in UTC, plus a note to confirm the provider's availability. It does not contain an API key, SMTP password, raw usage response, prompt or chat. These reminder details and the recipient necessarily leave your computer via your mail provider. Email contents and recipient addresses may also be retained by that provider.

## Timing, failures and duplicates

- The backend checks alarm timestamps approximately every second. The open dashboard checks the reminder inbox every five seconds. These are polling intervals, not hard real-time delivery guarantees.
- The backend must be running and the computer awake to send mail. Closing the browser does not stop email; stopping the backend or sleeping the machine pauses it.
- A saved alarm that became due while offline catches up on restart if no more than 24 hours late. Older occurrences are recorded without sending stale email or sounding a fresh alert. Paused sources do not catch up past resets when re-enabled.
- A corrected future timestamp replaces the pending alarm. If the saved timestamp was already due when a newer provider reading arrives, the due occurrence is recorded before following the new future reset.
- Occurrences are stored in SQLite with a unique alarm/reset-time pair. Ordinary polling and restarts do not create the same occurrence again. Alarm configuration uses revision checks to reject stale edits.
- SMTP sends are serialized with a minimum five-second spacing. Definite temporary rejection or pre-delivery connection failure retries at most three attempts, with one- and two-minute delays.
- A timeout/disconnect during message submission may mean the SMTP server accepted the message. Ambiguous failures and sends interrupted by a restart become **delivery unconfirmed**, without an automatic resend. A stable Message-ID assists tracing but does not guarantee inbox deduplication.
- **Email accepted by mail server** means SMTP acceptance, not a delivery/read receipt. Spam filters, bounces, delays and provider limits are outside the app's control. Permanent failures appear in the Reminders inbox with safe generic guidance.

No system can guarantee exactly-once delivery across a local database and an independent SMTP server. This release favors avoiding automatic duplicates when acceptance is uncertain. If sending fails, check the SMTP account, sender authorization and recipient, then validate a subsequent newly scheduled reminder.

## Storage and security

Schema v3 adds alarm configurations and reminder events, included in normal SQLite backups. Recipients, display names and delivery statuses are personal data stored in the private database; they are not encrypted by the application. Reminder events are retained for 30 days; the inbox returns the latest 100. Protect backups accordingly. Restoring an older backup can restore old alarm state and potentially repeat an occurrence; review alarms before starting a restored server.

SMTP credentials remain in the server environment / `.env`. They are not returned in API responses, stored in the database, or inherited by the Codex/DPAPI subprocesses. `.env` is plaintext, so protect it with normal OS access controls. Protected API-key entry applies to supported provider API keys; it does not currently manage SMTP passwords.

Alarm writes, notification claims and dismissals use the same local session, same-origin and CSRF protections as other settings. Recipient validation accepts a single email address, not headers or recipient lists. No SMTP server address can be supplied by the browser. Provider/API secrets and raw SMTP error messages are not written into reminder records.

No real email was sent during development. Unit tests use a fake mailer and a mocked SMTP transport; browser tests clear SMTP environment variables. Configure your own mail account and verify delivery before relying on the reminders.
