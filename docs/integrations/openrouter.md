# OpenRouter adapter

- Evidence: [key credit/rate limits](https://openrouter.ai/docs/api_reference/limits).
- Checked: 2026-09-17.
- Fixed endpoint: GET https://openrouter.ai/api/v1/key; Bearer credential resolved per source from Windows-protected storage or an explicit server environment variable.
- No management key or account-credit endpoint required.
- Scope: one configured API key. The credential is hashed to prevent accidentally merging different keys.
- Metrics: current key allowance using limit / limit_remaining, plus separate lifetime key usage. Never subtract lifetime usage from a resetting cap.
- A null limit indicates no key cap; it does not establish unlimited account funds. No inferred reset timestamp.
- Bounds: 15-second HTTP timeout, 60-second overall run deadline, 100 KB response budget, no redirects, verified TLS, no provider payload logging.
- Refresh: 15-minute minimum. 401/403 pauses retries; 429 respects Retry-After, and retry state survives restart.
- Validation: synthetic parser tests, safe missing-credential browser fallback, fixed destination/secret boundary. No live key was supplied or used.

Account-wide credit balance, reset-policy expansion, are outside this release. Multiple key configurations are supported using separate sources. See [credential setup and security](../how-it-works-and-security.md).
