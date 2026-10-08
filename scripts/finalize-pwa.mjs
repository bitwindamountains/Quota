import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const hash = createHash('sha256');
for (const name of ['sw.js', 'offline.html', 'offline.css', 'icons/quota-192.png', 'icons/quota-512.png', 'icons/quota-maskable.png']) {
  hash.update(await readFile('dist/web/' + name));
}
const worker = await readFile('dist/web/sw.js', 'utf8');
await writeFile('dist/web/sw.js', worker.replace('quota-offline-v1', 'quota-offline-' + hash.digest('hex').slice(0, 16)));
