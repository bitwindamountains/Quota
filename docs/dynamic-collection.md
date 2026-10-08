# Automatic collection and quicker navigation (v1.6)

Connect each supported source once. Quota checks it while the local server runs; the PWA does not need to remain open. A sleeping computer or stopped server cannot collect readings or deliver reminders.

## Existing providers: fewer setup steps

Add source defaults to Automatic for supported tools. Codex detects its installed executable and uses its existing sign-in. For the seven key integrations, choose a detected server environment variable when adding a source to configure and enable collection in one save. Alternatively, save a Windows-protected key in the source dialog, then save the automatic source settings. Existing manual sources retain their mode until you change it.

Discovery exposes only nonempty, provider-allowlisted variable **names**, never values. It requires the same local session protections as other API reads. Selecting a variable is explicit consent to use it for that source; discovery alone makes no provider requests. The browser never reads `.env`. Restart the server after changing `.env`. Detection does not verify key permissions: organization reporting APIs may require admin keys, and consumer subscriptions are separate from API billing. See the explanation beside each provider in setup.

## Claude Code: automatic subscription windows

The new **Claude Code** source reads the official status-line `rate_limits` fields. It is separate from the manually tracked Claude chat card and Anthropic API billing. Requires Claude Code **v2.1.251+**, an eligible Pro or Max subscription, and at least one API response in Claude Code. Gateway spend-limit reporting is not supported by this connector.

1. Add **Claude Code** in Automatic mode in Quota and save. Saving connects the bridge; the source dialog shows its status before you save.
2. Use Claude Code normally. Quota imports the latest snapshot at the configured interval (five minutes by default).

`npm run claude:setup` performs the same connection from a terminal and remains available after `npm run build`.

Saving an enabled Automatic Claude Code source (or running setup) adds a status-line command to `~/.claude/settings.json` (or `CLAUDE_CONFIG_DIR`). It backs up an existing settings file, preserves unrelated settings, and refuses to replace an existing custom status line. If you already have one, setup prints the bridge command: adapt your script to send the **same original stdin JSON** to both the bridge and your existing renderer. Do not send formatted output to the bridge. Project-level status-line overrides can take precedence over the user setting. Moving this repository or the Node executable requires updating the configured command.

The bridge reads stdin only, makes no network requests, and writes only percentages, reset timestamps and an observation timestamp to `claude-code.json` in Quota's data directory. It does not read Claude credentials or transcripts and does not retain the payload's session identifier, prompts or workspace paths. It bounds input size, validates percentages and timestamps, and replaces the snapshot atomically. An unchanged snapshot keeps its original observation timestamp because status-line updates may repeat cached data. This conservatively marks unchanged values stale, even if the actual quota has not changed. Missing windows stay unknown; no zero or refill is inferred. A reset passing remains “awaiting update” until new data arrives.

This bridge is for **one local Claude account**. The official payload used here does not supply a verified account identity; multiple accounts writing the same snapshot cannot be separated. Do not use it to track several accounts. Before switching accounts, close the old sessions, remove the old Claude Code source and `claude-code.json`, then create a new source after the new account reports data. Values reflect the latest local session report, not a live account-wide query. Other processes running as your OS user can alter the snapshot; it is not a security boundary against that user.

To disconnect, pause/remove the source and remove only Quota's `statusLine` entry from Claude settings (or remove its invocation from your custom script). The setup backup remains in the Claude configuration folder; protect it like the original settings file. No Claude setting is changed by opening Quota, adding a Manual or paused Claude Code source, or by scheduled checks; only saving an enabled Automatic Claude Code source (or running setup) connects the bridge, and removing the entry later is respected.

Official reference: [Claude Code status-line rate limits](https://code.claude.com/docs/en/statusline#rate-limit-usage).

## Less time in the dashboard

- **Refresh** queues excess checks, runs at most two collectors concurrently, and shows queued/checking state. Duplicate requests coalesce; provider cooldowns remain enforced. Pausing, deleting, or changing a queued source cancels its queued check. Pending manual requests are in memory; after restart normal scheduled collection resumes.
- **Compact view** displays the same metrics and actions with less spacing. Your density and sort choice persist locally; readings and credentials are not stored in browser preferences.
- **/** or **Ctrl+K / Cmd+K** takes you to overview search from another page. Shortcuts do not interrupt form fields or open dialogs. Search matches the provider as well as your source name.
- Source selection labels automatic support explicitly. Unsupported services stay manual; an ordinary model API key does not guarantee a reporting API.

Validation uses synthetic provider data and isolated browser workspaces. Claude Code bridge parsing and privacy have automated tests; no live Claude subscription was used to validate this integration.
