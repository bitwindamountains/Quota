# Quota as a local PWA

Version 1.4 adds an installable app window, offline help, Windows launch controls and automatic native Codex discovery. Node 24 and the backend still run on your computer. This is not a hosted service or a standalone executable installer.

## First run and installation

From the project folder in PowerShell:

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd run local:start
```

The Windows launcher starts the backend with a hidden window and opens `http://127.0.0.1:4317` in your default browser. Use Edge or Chrome for installation. Select **Install app** in Quota or the browser's install control, and complete its confirmation. The browser controls the actual installation prompt; Quota provides instructions if the prompt is unavailable. Use the same address and port consistently: `localhost` and `127.0.0.1` are different browser origins.

Installing the PWA does not start Node. Keep the server running, or start it before opening the installed app. Its shortcut opens a standalone app window; `local:start` opens the dashboard in your default browser. If another Quota instance was started in a terminal, stop it there with Ctrl+C before switching to the launcher. Ordinary `npm.cmd start` remains supported on all supported Node platforms.

## Windows convenience commands

| Command | Behavior |
|---|---|
| `npm.cmd run local:start` | Start the backend quietly and open the dashboard; reuse a launcher-owned instance |
| `npm.cmd run local:stop` | Stop the launcher-owned backend after checking its process identity |
| `npm.cmd run local:shortcuts` | Create Start and Stop Quota shortcuts on your desktop |
| `npm.cmd run local:autostart` | Opt in to starting the backend at Windows sign-in, without opening a browser |
| `npm.cmd run local:no-autostart` | Remove that sign-in shortcut |

Start-at-login is **not enabled automatically**. Shortcuts are per Windows user and point to this checkout. Recreate them if you move the project. They use PowerShell's execution-policy bypass only for that invocation; no system execution policy is changed. Node must remain available on PATH. The launcher reads `.env` through Node's parser and uses the configured `PORT` and data directory. Logs are `launcher.stdout.log` and `launcher.stderr.log` in the application data directory. If a hidden shortcut fails, run the matching npm command in a terminal to see its error.

The Stop command terminates the process on Windows. SQLite recovers its WAL and a stale process lock is recovered on restart. Stopping during an SMTP send can leave delivery uncertain; the reminder system does not automatically resend an ambiguous delivery. Use a foreground server and Ctrl+C when you need its normal shutdown path. Stopping the backend does not uninstall the PWA or remove saved data.

## Automatic Codex discovery

When `CODEX_EXECUTABLE` is absent or empty, Quota checks native executables on PATH, expected user installation directories, official-extension folders under `.vscode`, `.vscode-insiders` and `.cursor`, and known Windows npm native-binary layouts. Extension versions are checked newest first. The search is bounded; it does not crawl your drive or execute shell wrappers.

Candidates must be files and return a compatible `codex-cli` version from a bounded `--version` check. A successful path is remembered in memory and searched again if it disappears. **Detect Codex again** in source settings explicitly rechecks. At most three existing candidates are probed per search, with a five-second deadline each; unsupported layouts may still require a manual path.

An explicit `CODEX_EXECUTABLE` takes precedence, including if it is broken. To use automatic discovery, remove or comment out that line in `.env` and restart. The app never silently edits `.env`, changes sign-in, or copies credentials. Codex must be signed in separately; finding an executable does not establish account eligibility. See [official CLI setup](https://learn.chatgpt.com/docs/codex/cli).

## Offline, privacy and updates

The service worker caches only `offline.html`, `offline.css` and three public icons. It never caches API responses, usage data, credentials, the dashboard HTML or application bundles. If the server cannot be reached on navigation, the app shows **Local server is offline** with startup instructions and a retry link. With the page already open, connection failures display the reconnect message. No edits are queued while disconnected.

Manual tracking needs the running local server but does not require internet access. Provider reads and email need their network connections. Collection and email stop with the server; desktop/sound alerts also require an open dashboard. A PWA does not wake a sleeping computer.

After updating code, rebuild and restart the backend. Reload the app for the new frontend. Offline assets have a content-based cache version; a newly installed worker waits for existing windows to close before activating, so it cannot force-reload an unsaved form. Close all Quota tabs/windows and reopen when updating offline help. Browser uninstall/clearing site data removes browser installation/cache state, not the backend SQLite database or protected key files.

The local origin is eligible for installability without an HTTPS certificate, as described in [MDN's installability guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable). Worker lifecycle behavior follows [MDN's service-worker guide](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).

## Verified scope

On Windows with Node 24: production build, lint, 71 unit tests, and nine Chromium browser tests passed. Browser checks verify manifest/icon serving, Chromium installability errors (none), worker control, the exact cache allowlist, API failure while offline, recovery, and discovery UI. The real Codex executable was found both with the existing override and using automatic discovery. Hidden launcher start, duplicate-start reuse and stop were exercised against isolated test data.

The native browser installation confirmation and Windows sign-in itself require interactive/manual verification; automated tests do not claim that the app has been installed on your desktop. No real provider request or SMTP message was sent for this release. The ten-second DPAPI helper deadline is unchanged; the browser success assertion now waits longer than that deadline instead of failing after five seconds while an operation is still pending.
