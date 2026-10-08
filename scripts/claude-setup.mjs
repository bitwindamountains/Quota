import { dataDir } from '../dist/server/paths.js';
import { installBridge } from '../dist/server/claude-bridge.js';

// Optional: saving a Claude Code source in Automatic mode performs the same setup from the dashboard.
try {
  const result = await installBridge(dataDir());
  if (result.state === 'custom') {
    console.log('Your existing status line was preserved. To integrate manually, pass the same stdin JSON to this command from your status-line script:');
    console.log(result.command);
    console.log('See docs/dynamic-collection.md. Do not pipe the formatted status-line output into the bridge.');
    process.exitCode = 1;
  } else console.log('Claude Code bridge configured. Add a Claude Code automatic source in Quota, then use Claude Code. One local account is supported.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
