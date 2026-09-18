# Release validation — 2026-09-17

## Environment

Windows, Node 24.16.0, npm 11.13.0, bundled SQLite 3.53.0. Workspace path contains spaces. Dependencies are exact-pinned with a lockfile. A clean install exposed an unavailable addon binary; storage was moved to Node's bundled SQLite to eliminate the C++ build prerequisite.

## Completed checks

- Clean `npm ci` passed with bundled SQLite and no C++ build tools.
- TypeScript checks and production client/backend compilation passed.
- ESLint passed.
- **33 Vitest tests passed:** domain, provider parsing, SQLite, backup/restore, corrupt/newer database preservation, cooldown persistence, scheduler, and API security.
- **4 Playwright tests passed:** desktop/mobile manual workflow, persistence after reload, multi-metric entry, demo isolation, dialog keyboard behavior, source pause/remove, missing-credential fallback, dark theme, effective 200% desktop layout, and horizontal overflow.
- Live Codex account/rate-limit read returned two valid normalized windows. Only structural success was logged.
- Production dependency audit reported no known vulnerabilities at the time checked.
- The production server returned HTTP 200 at `http://127.0.0.1:4317`; the listener was verified to bind only to `127.0.0.1`.
- `npm run backup` successfully created a consistent backup while the production server was running.

Browser tests use a fresh isolated database; screenshots contain synthetic values:

- [Desktop](screenshots/dashboard-desktop.png)
- [Mobile](screenshots/dashboard-mobile.png)
- [Dark / narrow desktop](screenshots/dashboard-dark.png)

## Material limits

- OpenRouter has parser and failure-path verification, not a credentialed live read.
- Live Codex values were not independently compared to the provider's dashboard. Validate scope/period against the official tool during setup.
- Codex identity binding detects email changes, not workspace changes under one email.
- No claims of production-scale multi-user security, hosted deployment, macOS/Linux validation, or desktop packaging.
- The in-app browser execution tool was unavailable. Browser verification used standalone Playwright Chromium.
- History charts, notifications, import/export, and additional automatic adapters are deferred per the plan.


## v1.1 credential/security update

- Build/typecheck and lint passed; **42 Vitest tests** and **5 Playwright tests** passed.
- Real Windows DPAPI round-trip, replacement/removal, corrupt-ciphertext rejection, stale-write rollback, plaintext-exclusion and credential API boundaries were verified using synthetic keys.
- Schema v1 upgrade preserves sources and creates a backup; credential updates preserve provider cooldowns.
- Live Codex still returned two valid windows after subprocess environment filtering.
- Full dependency audit reported zero known vulnerabilities. The updated loopback server reports v1.1.0 and a post-upgrade online backup succeeded.
- See the [deployment readiness review](deployment-readiness.md) for scope and remaining limits, and [credential settings](screenshots/credential-settings.png) for the reviewed UI.


## v1.2 reset reminder update

- Production build/typecheck, lint and dependency audit passed; audit reported zero known vulnerabilities.
- **54 Vitest tests** cover existing behavior plus alarm scheduling, independent windows, correction/re-arming, paused/deleted sources, late catch-up, duplicate suppression, safe retries, uncertain delivery, email validation and TLS transport configuration.
- **6 Playwright tests** cover previous workflows plus per-window alarm creation, persistence after reload, a real scheduled local reset event, inbox dismissal and alarm disabling. SMTP environment variables are excluded from the browser-test server.
- The local v1.2.0 server responds successfully on `127.0.0.1:4317`; the reminder endpoint is available and correctly reports email as not configured. Online backups succeeded before and after schema v3 migration.
- No real SMTP delivery was attempted. Email transport behavior was checked with mocks; configure your own account and verify receipt before relying on it.


## v1.3 provider key expansion

- Production build/typecheck and lint passed. **68 Vitest tests** and **7 Playwright Chromium tests** passed. The final version-string adjustment was rebuilt successfully.
- Additional providers: OpenAI API, Anthropic API, Cursor, GitHub Copilot, Mistral and DeepSeek API. Synthetic fixtures verify endpoint/auth selection, pagination, cost units, report bounds, malformed responses, rate limits and missing credentials. Provider-specific environment isolation and real Windows DPAPI round-trips are tested.
- Browser checks cover immediate credential setup after adding every new supported provider, environment configuration, password masking and unsupported-provider manual fallback. See [provider settings screenshot](screenshots/provider-key-settings.png).
- Full dependency audit reported zero known vulnerabilities. No dependencies or database migration were added (schema remains v3).
- Local v1.3.0 state/health and homepage checks passed; HTTP 200, no-store response headers and the exclusive 127.0.0.1:4317 listener were verified. Online backups succeeded before and after restart.
- No real provider credentials were used. These adapters require live verification with an eligible account and the documented permissions. No new SMTP delivery test was performed. See [provider scope and official evidence](integrations/key-providers.md).
