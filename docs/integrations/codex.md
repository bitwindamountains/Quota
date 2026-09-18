# Codex adapter

- Evidence: [official app-server documentation](https://learn.chatgpt.com/docs/app-server), [authentication](https://learn.chatgpt.com/docs/auth).
- Checked: 2026-09-17; installed native client: 0.154.0-alpha.6.1.
- Transport: owned stdio subprocess; fixed methods initialize, initialized, account/read with refreshToken false, account/rateLimits/read.
- Credentials: owned by Codex. No tracker access to auth.json, refresh tokens, or OS credential storage.
- Scope: currently signed-in ChatGPT-backed Codex account. API-key-only mode falls back to manual.
- Normalization: prefer rateLimitsByLimitId; otherwise single bucket. Nullable windows supported. Percent used stays a percent; duration labels come from response, Unix seconds become UTC instants.
- Coverage: returned quota windows only. Credit pools, earned resets, token activity, and chat-model limits are not claimed.
- Refresh: five minutes by default; configurable minimum five minutes. Freshness is twice the interval. No notifications are subscribed to in this release; a short-lived process handles each check.
- Bounds: 60-second run deadline, two-megabyte stdout budget, stderr suppressed, fixed allowlisted requests, owned process terminated after read.
- Live validation: successful account/limit read; two normalized windows, valid timestamps, identity hash available. No raw values or identifiers logged. No generation/session was started. The independent provider-dashboard comparison is still a setup check.
- Identity limitation: an email-derived SHA-256 fingerprint detects changes to that identity, not workspace changes under the same email. Missing email cannot be bound. Create a new source when changing workspace.
- Error handling: safe generic messages; unsupported login/RPC/schema pauses automatic retry, manual fallback remains available.
- Synthetic parser fixtures: tests/domain.test.ts. Tests cover nullable secondary, nonstandard durations, multiple IDs, malformed data, and seconds conversion.

The local app-server command is marked experimental by the inspected client. Future versions must be revalidated.
