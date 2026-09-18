export const keyIntegrations = {
  openrouter: { name: 'OpenRouter', credentialLabel: 'OpenRouter API key', variable: 'OPENROUTER_API_KEY', prefix: 'QUOTA_OPENROUTER_', minimumPoll: 900,
    description: 'Reads this key\'s allowance and lifetime usage, not your account-wide balance.', docs: 'https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key' },
  openai: { name: 'OpenAI API', credentialLabel: 'OpenAI organization admin key', variable: 'OPENAI_ADMIN_KEY', prefix: 'QUOTA_OPENAI_', minimumPoll: 1800,
    description: 'Requires an organization admin key with reporting access. Reads organization-wide reported costs for the current UTC month. Regular project keys and ChatGPT/Codex subscriptions are not supported by this endpoint. Scope is a display label, not a project filter.', docs: 'https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs' },
  anthropic: { name: 'Anthropic API', credentialLabel: 'Anthropic organization admin key', variable: 'ANTHROPIC_ADMIN_KEY', prefix: 'QUOTA_ANTHROPIC_', minimumPoll: 1800,
    description: 'Requires an eligible organization admin key. Reads organization-wide reported costs for completed UTC days this month; Priority Tier costs are excluded by the endpoint. This does not read Claude chat subscription limits. Scope is a display label, not a workspace filter.', docs: 'https://platform.claude.com/docs/en/manage-claude/usage-cost-api' },
  cursor: { name: 'Cursor', credentialLabel: 'Cursor team admin API key', variable: 'CURSOR_API_KEY', prefix: 'QUOTA_CURSOR_', minimumPoll: 3600,
    description: 'Requires a team admin API key. Reads team-wide on-demand and overall spending for the current billing cycle. It does not read a personal subscription quota. Scope is a display label, not a user filter.', docs: 'https://cursor.com/docs/account/teams/admin-api' },
  copilot: { name: 'GitHub Copilot', credentialLabel: 'GitHub personal token with Plan: read', variable: 'GITHUB_COPILOT_TOKEN', prefix: 'QUOTA_COPILOT_', minimumPoll: 1800,
    description: 'Requires a personal GitHub token with Plan: read permission. Reads current-month Copilot AI-credit usage billed to that user. Organization-paid plans and legacy premium-request reports are not covered. This is usage, not remaining allowance; scope is only a display label.', docs: 'https://docs.github.com/en/rest/billing/usage' },
  mistral: { name: 'Mistral', credentialLabel: 'Mistral organization admin API key', variable: 'MISTRAL_ADMIN_KEY', prefix: 'QUOTA_MISTRAL_', minimumPoll: 1800,
    description: 'Requires an Enterprise organization Admin API key. Reads whether the monthly completion spending limit has been reached. Counts, costs, remaining capacity and the reset time stay unknown. The reporting API is beta.', docs: 'https://docs.mistral.ai/api/endpoint/beta/admin/billing' },
  deepseek: { name: 'DeepSeek API', credentialLabel: 'DeepSeek API key', variable: 'DEEPSEEK_API_KEY', prefix: 'QUOTA_DEEPSEEK_', minimumPoll: 900,
    description: 'Reads the API account balance separately for each returned currency. This is not a DeepSeek chat subscription quota.', docs: 'https://api-docs.deepseek.com/api/get-user-balance/' }
} as const;
export type KeyProvider = keyof typeof keyIntegrations;
export function keyIntegration(provider: string) { return Object.hasOwn(keyIntegrations, provider) ? keyIntegrations[provider as KeyProvider] : undefined; }
export const minimumPoll = (provider: string) => keyIntegration(provider)?.minimumPoll ?? 300;
export function environmentPattern(provider: string) {
  const integration = keyIntegration(provider);
  return integration ? '(' + integration.variable + '|' + integration.prefix + '[A-Z0-9_]{1,80})' : '(?!)';
}
export const acceptsEnvironment = (provider: string, name: string) => new RegExp('^' + environmentPattern(provider) + '$').test(name);
export function manualReason(provider: string) {
  if (provider === 'groq' || provider === 'gemini-api') return 'A model API key alone does not give this tracker a verified usage-reporting endpoint. Use manual tracking; no key is requested.';
  if (provider === 'claude' || provider === 'chatgpt' || provider === 'gemini') return 'Consumer chat usage is separate from API billing. Use manual tracking for this subscription.';
  if (provider === 'vertex') return 'Cloud monitoring needs project configuration and appropriately scoped Google credentials. This connector is not implemented.';
  return 'This tool uses manual tracking. For BYOK tools, track the upstream provider when supported.';
}
