import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
export const dataDir = () => resolve(process.env.AI_TRACKER_DATA_DIR || (process.platform === 'win32'
  ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'AIUsageTracker')
  : join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'ai-usage-tracker')));
