# Quota — AI Usage & Reset Tracker

A private dashboard for AI quotas, reset windows, and credit balances. Built for one person on one computer. Manual tracking works offline; optional automatic collectors read Codex and seven supported key-based reporting APIs.

## Run locally

Requires **Node.js 24 LTS** and npm. Tested on Windows with Node 24.16.0.

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4317**. In Windows PowerShell, use **`npm.cmd`** if execution policy blocks `npm.ps1`. No policy change is needed.

Start with **Add source**, or **Explore the demo** to see synthetic readings. Demo mode is read-only and does not insert records into your real database. Nothing is enabled automatically.

The server binds only to IPv4 loopback. Keep it local; it is not a hosted or multi-user service. Stop a foreground server with Ctrl+C. Closing the browser tab does not stop it.

## What ships

- Responsive dashboard, source filters/search, next-reset summary, light/dark system theme.
- Manual percentage, count, balance, usage-only, advisory budget, limit-reached, and reset-only observations.
- Multiple metrics per tool; unknowns stay unknown and expired resets never invent fresh capacity.
- Source setup, rename, ordering, pause, delete, manual fallback, and conflict-safe edits.
- Codex and supported API read-only collectors with timeouts, cooldowns, retained last-known values, and safe errors.
- Per-window reset alarms, an in-app reminder inbox, optional sound/desktop alerts, and SMTP email reminders.
- SQLite persistence, versioned schema, retention, local backup command, and single-instance protection.
- Same-origin API, signed local sessions, CSRF checks, fixed provider destinations, and no application telemetry.

Version 1.3 extends protected key entry to OpenAI API, Anthropic API, Cursor, GitHub Copilot, Mistral and DeepSeek API alongside OpenRouter. Reports require the provider-specific credentials below; other templates remain manual. Charts, CSV/JSON interchange, tray packaging and start-at-login remain follow-on work.

## Automatic sources

### Codex

1. Install/sign in using the official Codex CLI with ChatGPT.
2. Add **Codex**, choose **Automatic**, and save.
3. If the CLI is not on PATH, set `CODEX_EXECUTABLE` in the server environment (or a local `.env`) to the native executable and restart.

On Windows use the native **codex.exe**, not an npm `.cmd` wrapper. The VS Code extension can also contain a native executable, but its versioned installation path can change after an update.

The app invokes only initialization, `account/read`, and `account/rateLimits/read` over stdio. It does not generate messages, create threads, read auth files, or copy/refresh OAuth tokens. Codex owns its normal authentication maintenance. Adapter analytics/export settings are disabled; no inference session is started.

The CLI interface is version-sensitive. A successful live read was verified on `0.154.0-alpha.6.1`; unsupported clients/accounts remain usable manually. The available account identity is an email-derived hash, not a stable workspace identifier. **Create a new source if you switch Codex workspaces, even under the same email.** Accounts without an email cannot be automatically bound. The app does not claim that Codex limits cover every ChatGPT chat model.

### OpenRouter

For Windows-protected UI entry, add an OpenRouter source, open Source settings, choose **Windows-protected key**, and save the key. Then enable Automatic.

Alternatively, create a local `.env` using `.env.example` as a guide and set:

```dotenv
OPENROUTER_API_KEY=your_key_here
```

Restart, add **OpenRouter**, and select **Automatic**. Never use a `VITE_*` variable for credentials.

This adapter reads `GET /api/v1/key`. It shows the configured **key's allowance** and lifetime usage separately. It does not fetch account-wide credits or infer a reset instant from a policy name. An uncapped key can still belong to an account without funds. The key is read only by the backend and is never returned to the browser.

Each OpenRouter source can use its own Windows-protected key or server environment variable. Add the source, open Source settings, and use the OpenRouter credential section to save, replace, switch, or disconnect credentials. Dedicated environment names use `QUOTA_OPENROUTER_` plus uppercase letters, digits or underscores. If changing keys, create a new source to avoid merging unrelated history. OpenRouter parsing and auth-failure paths are tested; a live credentialed read was not performed during development.

### Other supported API keys

Add **OpenAI API, Anthropic API, Cursor, GitHub Copilot, Mistral, or DeepSeek API**. Credential setup opens immediately after creation. Choose Windows-protected entry or an explicit server environment variable, save the credential, then enable Automatic. Existing sources use Source settings.

OpenAI/Anthropic require organization admin reporting credentials; Cursor requires a team admin key; Copilot requires a personal token with Plan: read; Mistral requires an Enterprise Admin API key. DeepSeek uses a regular API key. These report costs, personal credit usage, balance or limit status according to provider capabilities, not universal subscription quotas. Mistral reports only whether the limit was reached. See [provider setup, permissions, scope and security](docs/integrations/key-providers.md) for the full matrix and environment names. Live credentialed verification remains a user setup check.

## Manual observations

Use the pencil on a card. Select an existing metric or add a new one, then enter exactly what the provider shows. “Unknown” and “Reset time only” are valid entries.

- Percentage bars represent used capacity; the headline prioritizes remaining capacity.
- Credit balances and usage-only totals have no invented percentage.
- Reset input uses the displayed browser timezone; quick buttons set a one-off time from now.
- A past reset remains “Reset due — awaiting update” until new evidence arrives.
- Freshness defaults to 24 hours for manual observations and twice the configured interval for automatic ones.
- Switching to Manual preserves existing observations and their provenance. Saving one metric does not change the other metrics' observation timestamps.
- Scope is immutable. Create a new source for a different account/project.
- For Cline BYOK, track its upstream provider. Use a separate Cline source for managed credits/subscriptions.

## Configuration

Optional server-side environment variables:

| Variable | Default / purpose |
|---|---|
| `PORT` | `4317`; integer 1024–65535 |
| `AI_TRACKER_DATA_DIR` | Override the application data directory |
| `CODEX_EXECUTABLE` | `codex` resolved from PATH; native executable only |
| `OPENROUTER_API_KEY` | Optional key for the OpenRouter collector |

Editable source settings live in SQLite. Keys entered in the UI are encrypted with Windows DPAPI for the current user and stored outside SQLite. Environment mode remains available; `.env` is plaintext, not inherently safer. Use normal OS access controls and do not share credential files.

Data locations:

- Windows: `%LOCALAPPDATA%\AIUsageTracker\quota.db`
- Other systems: `$XDG_DATA_HOME/ai-usage-tracker/quota.db`, falling back to `~/.local/share/ai-usage-tracker`

Windows is the validated platform. Storage uses Node 24's bundled `node:sqlite`; no native addon or Visual Studio C++ installation is required. The original addon approach was replaced after a clean-install test failed to obtain its native binary.

## Backup, restore, and recovery

```sh
npm run backup
```

This uses SQLite's online backup facility and writes a timestamped database under the data directory's `backups` folder. Backups include source metadata/history, not environment credentials or protected key files. Restored sources may need their credentials configured again. Treat usage data as private.

To restore:

1. Stop every running tracker process.
2. Preserve the existing database and any `quota.db-wal` / `quota.db-shm` files together in a separate recovery folder.
3. Copy a selected backup into the data directory as `quota.db`. Do not leave old WAL/SHM sidecars next to the restored database.
4. Start the tracker and verify the restored readings.

Never copy only the main database from a live WAL-mode database. Startup checks database integrity/version; it does not silently replace a corrupt database. Existing databases are backed up before schema migration.

History retention is 30 days and diagnostic retention is seven days. Current active readings remain protected even if older. Cleanup runs at startup and daily. Removed/retired metric observations can age out. Deleting a source explicitly deletes its local history; pausing preserves it.

An `app.lock` prevents competing backend processes. A stale lock whose process is gone is recovered automatically. If startup reports a lock issue, first verify that no tracker process owns that directory; do not blindly delete a live lock.

## Development and checks

```sh
npm run dev
# http://127.0.0.1:5173 — Vite proxies to the backend on 4317
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Keep the default backend port for `npm run dev` (the Vite proxy targets 4317). Production can use any configured loopback port.

Vitest tests arithmetic, provider parsing, time boundaries, persistence, backup/restore, retention, revisions, scheduler failures, and HTTP security. Browser tests use a fresh temporary database on port 4320 and no real provider keys. Screenshot fixtures are synthetic. Temporary E2E databases are left in the OS temp directory for failure inspection; they can be removed through normal temp-file cleanup.

Optional live Codex verification:

```sh
node --env-file-if-exists=.env --import tsx scripts/check-codex.ts
```

This makes read-only account/limit requests and prints only structural success information, never quota values or account identifiers.

## Security and operational limits

The API checks Host, Origin/Fetch Metadata, a custom request header, signed local sessions, and CSRF tokens. The dedicated credential endpoint accepts write-only keys with session and CSRF protection; no endpoint returns saved keys. External links open the provider normally; no cookie extraction or interception is involved. Normal errors avoid raw provider responses and child-process stderr.

Only trusted code running as your OS user should have access to the machine. Loopback protections do not isolate the app from local malware. HTTPS is used for provider reads; the local browser connection is HTTP loopback.

Polling stops when the backend or machine stops. Resume coalesces pending checks instead of replaying every missed interval. Provider errors leave old readings visible. A 429 cooldown persists across restart; explicit refresh cannot bypass it. “Refresh” does not change manual readings.

The installed Codex interface does not expose a stable account/workspace ID, so automatic workspace-change detection is incomplete. OpenRouter live verification requires your own key. Independent comparison of live readings against provider dashboards remains a user setup check.

See [validation notes](docs/validation.md), [integration evidence](docs/integrations/README.md), and the [project plan](ai-usage-tracker-project-plan.md).

Read [how every tool is tracked and how credentials are protected](docs/how-it-works-and-security.md), and the [deployment readiness review](docs/deployment-readiness.md).

## Reset alarms and email

Click **Set alarm** beside any known reset time. Each window has its own alarm. Enable optional email after configuring the `QUOTA_SMTP_*` variables in `.env` and restarting. See [reset reminder setup and delivery behavior](docs/reset-reminders.md). Keep the server running for email; sound and desktop alerts also require the dashboard to remain open.
