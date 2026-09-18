# Deployment readiness review - v1.3.0

Reviewed 2026-09-17. **Ready for the documented single-user Windows loopback deployment**, subject to the setup checks below. This is not approval for public hosting or multi-user use.

## Changes reviewed

- Per-source supported-provider credential configuration: write-only password input, Windows DPAPI CurrentUser encryption, explicit allowlisted environment variables, and disconnect/removal.
- No retrieval of saved keys. No key material in SQLite, ordinary backups, browser persistence, request logs, child-process arguments or inherited provider-key environment variables.
- Immutable encrypted files and transactional revision checks prevent a delayed save from overwriting a newer configuration. Replacement removes the previous referenced blob.
- Auth, CSRF and JSON validation cover credential endpoints. Generic validation errors avoid echoing attacker-controlled field names/values. Credential writes are bounded and serialized.
- Method selection never falls back to another credential. Different key identities cannot merge into existing successful source history.
- Provider cooldowns survive credential changes. Auth-paused sources can retry after correction.
- Migration from schema v1 to v2 preserves source data and creates a pre-migration database backup.
- Static serving preserves the application's no-store header instead of overriding it with public cache settings.

## Verification evidence

| Check | Result |
|---|---|
| Production build / TypeScript | Passed |
| ESLint | Passed |
| Vitest | 68 tests passed across domain, storage, scheduler, API and credentials |
| Playwright Chromium | 7 tests passed: manual workflow, mobile, auth fallback, dark/narrow layout, protected credential lifecycle, reset alarm lifecycle, additional provider credential setup |
| Real Windows DPAPI | Encrypt/decrypt, replacement, removal, corrupt-blob failure and stale-write rollback passed with synthetic keys |
| Secret persistence | Synthetic plaintext absent from database, backup and protected-file contents; status/state responses do not disclose it |
| Credential isolation | Environment allowlist, child-process environment filtering, explicit disconnect and fixed provider destinations and cross-provider variable isolation verified |
| Upgrade and recovery | v1 migration preserves sources and writes a backup; existing SQLite backup/restore tests pass |
| Live Codex | Read-only check still returned two normalized windows with valid observation/reset timestamps after environment hardening |
| Dependency audit | `npm audit --json`: zero known vulnerabilities across production and development dependencies at review time |
| Production smoke | v1.3.0 homepage/health returned 200; listener restricted to `127.0.0.1:4317`; post-upgrade online backup succeeded |

A clean dependency install passed during the preceding local release; v1.2 adds exact-pinned Nodemailer 10.0.10 for SMTP. Windows Node 24.16.0/npm 11.13.0 were used. Browser tests use an isolated temporary data directory, synthetic keys and manual sources for protected-key testing; no real OpenRouter request is made by those tests. See [validation history](validation.md) and [credential settings screenshot](screenshots/credential-settings.png).

## Operator setup checks

1. Run as your normal Windows user with a private data directory. Do not expose the port through a reverse proxy, tunnel or firewall forwarding rule.
2. Use Node 24 and the lockfile: `npm ci`, `npm run build`, `npm start`. PowerShell may require `npm.cmd`.
3. Keep existing data/backups private. Schema v3 cannot be opened by the older v1/v2-schema servers; rollback requires restoring the matching pre-upgrade backup while the server is stopped.
4. Configure the selected provider credential method or sign in through the official Codex CLI. Configured means present, not provider-validated.
5. Check one successful live observation against the provider's own dashboard, including account, window, units and scope.
6. Confirm backups are recoverable and retain independent provider access. A database backup does not contain reusable protected keys or environment values.

## Remaining limits and follow-up work

- None of the seven key-based integrations was verified with real user credentials. Synthetic parsing, transport boundaries, failure behavior and key storage were verified. Admin/team eligibility and beta reporting schemas require a live setup check.
- Codex's experimental interface is version-sensitive. Its email fingerprint cannot distinguish workspaces under one email; use a new source after changing workspace.
- Codex and seven key-based providers have automatic adapters. Each reports only its documented scope; see the [integration matrix](integrations/key-providers.md). Other templates remain manual.
- DPAPI protects at rest for the Windows profile; it does not defend against same-user malware, malicious browser extensions, administrators or process-memory access. Windows ACLs are inherited from the selected data directory, not specially provisioned by this app. `.env` and usage data are plaintext.
- A crash during protected-file replacement may leave an unreferenced encrypted blob. Backups and disk recovery can retain deleted ciphertext; deletion is not secure erasure. Restoring old database references may require entering credentials again.
- There is no internet-facing authentication/tenant model, hosted secrets service, HTTPS termination, service installer, automatic patcher, code-signed desktop package, or start-at-login integration. Those need a separate deployment design.
- macOS/Linux deployment and an independent penetration test were not performed. The checks establish the documented local release behavior, not a universal security guarantee.

For the data flow, all tool-specific behavior and security rationale, read [how it works and security](how-it-works-and-security.md).


## Reset reminder review (v1.2)

Per-window alarms and their occurrences are persisted in schema v3. Source/metric removal and pause cancel unsent work; observed future timestamps control recurrence. SMTP is optional, server-configured, TLS-required and certificate-verified. Email settings are not configured on the running workspace yet; setup is documented in [reset reminders](reset-reminders.md).

Tests cover separate windows, reload persistence, alarm firing/dismissal/disable, corrected timestamps, restart deduplication, expired catch-up, safe retry limits, interrupted/ambiguous delivery, stale edits, invalid recipients, CSRF, and SMTP security options. Mail transport tests are mocked; no real SMTP account was used or email sent. SMTP acceptance is not guaranteed inbox delivery. The database was backed up before and after upgrading the local running server to v1.2.0.

The server must remain running for email. Browser sound/desktop alerts need an open tab and browser permission; there is no Windows background alarm service. An older restored backup can replay an occurrence, so review alarms before starting a restored server. Recipients and reminder metadata are included in database backups; SMTP credentials are not.


## API-key expansion review (v1.3)

OpenAI, Anthropic, Cursor, GitHub Copilot, Mistral and DeepSeek join OpenRouter in the shared credential UI. The setup stays open after source creation. Provider-specific variable allowlists are enforced both when saving and resolving credentials. New providers default to disconnected; legacy OpenRouter behavior is retained. No schema migration or dependency change is required (schema remains v3).

Fixtures verify cost units, time bounds, pagination, response limits, permissions failures, retry delays, fixed hosts and login path validation. Real DPAPI synthetic round-trips cover each new provider. UI tests exercise immediate credential setup and environment configuration for every new provider. Official references and report limitations are recorded in [key integration notes](integrations/key-providers.md). No credentials were sent to live providers during this release review.
