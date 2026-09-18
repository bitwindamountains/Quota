# API-key integrations

Implemented in v1.3, reviewed 2026-09-17. These integrations read reporting endpoints without generating prompts. Reporting access depends on your provider account and credential permissions; an ordinary inference key is not always sufficient.

| Tool | Required credential | Reading and scope | Minimum interval | Default environment variable |
|---|---|---|---|---|
| OpenRouter | API key | Selected key allowance and lifetime usage, not account funds | 15 minutes | `OPENROUTER_API_KEY` |
| OpenAI API | Organization admin key with reporting access | Organization reported costs for the current UTC month, not ChatGPT/Codex quotas | 30 minutes | `OPENAI_ADMIN_KEY` |
| Anthropic API | Eligible organization admin key | Organization costs for completed UTC days this month; excludes Priority Tier and Claude chat | 30 minutes | `ANTHROPIC_ADMIN_KEY` |
| Cursor | Team admin API key | Team overall and on-demand spending in the current billing cycle; on-demand is included in overall | 60 minutes | `CURSOR_API_KEY` |
| GitHub Copilot | Personal token with user permission Plan: read | Current-month personal Copilot AI-credit usage, gross and net; excludes organization-paid usage and legacy premium-request reports | 30 minutes | `GITHUB_COPILOT_TOKEN` |
| Mistral | Enterprise organization Admin API key | Monthly completion limit reached/not reached only; counts, costs, remaining capacity and reset remain unknown | 30 minutes | `MISTRAL_ADMIN_KEY` |
| DeepSeek API | API key | Account balance per returned currency (USD/CNY); not chat subscription limits | 15 minutes | `DEEPSEEK_API_KEY` |

## Setup

Add a supported source. Its credential section opens immediately after creation and remains available through Source settings. Choose **Windows-protected key** to enter a write-only key, or **Server environment variable** to select a server-side value. Save credential settings, choose Automatic, then save the source. Configured means a value is present, not that the provider has accepted it.

Dedicated names use `QUOTA_OPENROUTER_`, `QUOTA_OPENAI_`, `QUOTA_ANTHROPIC_`, `QUOTA_CURSOR_`, `QUOTA_COPILOT_`, `QUOTA_MISTRAL_`, or `QUOTA_DEEPSEEK_` followed by 1–80 uppercase letters, digits or underscores. Each source can select only its provider's names. For example, `QUOTA_OPENAI_WORK` cannot be selected for an OpenRouter source. New integrations require explicit selection even if an environment variable already exists. Existing OpenRouter default-variable behavior is preserved. Restart after changing `.env`; never use `VITE_*` secrets.

Windows UI credentials use DPAPI CurrentUser encryption outside SQLite. Environment mode supports launchers and secret managers; a local `.env` is plaintext and not inherently safer. Saved keys cannot be read back through the dashboard. Removing a credential disconnects the source, but does not revoke the provider key. Create a new source when changing keys/accounts to keep history separate. Prefer the narrowest reporting permissions the provider offers: this app's read-only behavior does not restrict an admin key's privileges elsewhere.

## Reading semantics and safeguards

OpenAI and Anthropic normalize decimal costs; Anthropic amounts are cents and OpenAI amounts are dollars. Anthropic's first UTC day has no completed day in the current month, so collection waits instead of inventing a zero. Cursor normalizes cents and checks that every page belongs to the same billing cycle. Copilot discovers the token owner's login through `/user`, validates it, and filters the personal billing report to Copilot credit entries. DeepSeek preserves each currency separately. Mistral uses the Admin API authentication guide's `x-api-key` header and a beta reporting endpoint.

The source scope text is a display label, **not a project/workspace/user filter**. Reports can lag the provider dashboard and do not establish remaining quotas. These adapters do not invent resets from billing periods: their readings cannot automatically schedule reset alarms without a real reset timestamp. Manual observations remain available.

Fixed HTTPS destinations, verified TLS and redirect rejection keep credentials on their selected provider. New adapters enforce 15-second HTTP deadlines, a 55-second overall deadline, a 1 MB limit per response and at most 20 paginated responses. Incomplete, inconsistent or malformed reports fail without publishing partial totals. Authentication failures pause retries; rate limits apply cooldowns. Raw provider bodies and keys are not logged or persisted; normalized aggregate readings are stored. Usage remains visible with its age when collection fails.

Groq, Gemini API and Vertex AI remain manual because no compatible reporting adapter is implemented here. Consumer Claude, ChatGPT and Gemini chat are separate from API billing. Codex continues using its official local CLI authentication. The app does not request keys it cannot use.

## Evidence and validation limits

The implementation is based on these official references:

- [OpenRouter current-key endpoint](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key)
- [OpenAI organization costs](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs)
- [Anthropic usage and cost API](https://platform.claude.com/docs/en/manage-claude/usage-cost-api) and [cost report schema](https://platform.claude.com/docs/en/api/beta/organization/cost_report/retrieve)
- [Cursor team Admin API](https://cursor.com/docs/account/teams/admin-api)
- [GitHub billing usage](https://docs.github.com/en/rest/billing/usage) and [authenticated user](https://docs.github.com/en/rest/users/users#get-the-authenticated-user)
- [Mistral Admin API eligibility](https://docs.mistral.ai/admin/admin-api/overview), [authentication](https://docs.mistral.ai/admin/admin-api/authentication), and [billing status](https://docs.mistral.ai/api/endpoint/beta/admin/billing)
- [DeepSeek balance endpoint](https://api-docs.deepseek.com/api/get-user-balance/)

Tests use synthetic credentials, mocked provider responses, real Windows DPAPI and an isolated browser-test database. No credentialed live request was made to these seven providers. Confirm the first successful reading against your provider's dashboard before relying on it. Official APIs, eligibility and beta schemas may change.
