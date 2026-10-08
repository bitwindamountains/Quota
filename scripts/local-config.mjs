import { dataDir } from '../dist/server/paths.js';
// Used by the Windows launcher: do not expose the rest of the environment.
console.log(JSON.stringify({ dir: dataDir(), port: Number(process.env.PORT || 4317) }));
