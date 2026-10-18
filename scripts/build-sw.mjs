import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const assets = ['/'];
async function walk(dir, prefix = '') {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.isDirectory()) await walk(`${dir}/${entry.name}`, `${prefix}${entry.name}/`);
    else if (!['sw.js', '_headers', '_redirects'].includes(entry.name))
      assets.push(`/${prefix}${entry.name}`);
  }
}
await walk('dist');
let source = await readFile('public/sw.js', 'utf8');
// Include all asset bytes and worker logic: icon-only and worker-only releases
// must create a new cache too, even when index.html has not changed.
const hash = createHash('sha256').update(source);
for (const asset of assets) {
  hash.update(asset).update(await readFile(asset === '/' ? 'dist/index.html' : `dist${asset}`));
}
const digest = hash.digest('hex').slice(0, 12);
source = source.replace("'lifts-coach-v1'", JSON.stringify(`lifts-coach-${digest}`));
source = source.replace(
  "['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png']",
  JSON.stringify(assets),
);
await writeFile('dist/sw.js', source);
console.log(`Precached ${assets.length} application assets (${digest}).`);
