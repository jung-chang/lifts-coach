import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const assets = ['/'];
async function walk(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) await walk(`${dir}/${entry.name}`, `${prefix}${entry.name}/`);
    else if (entry.name !== 'sw.js') assets.push(`/${prefix}${entry.name}`);
  }
}
await walk('dist');
const digest = createHash('sha256')
  .update(await readFile('dist/index.html'))
  .digest('hex')
  .slice(0, 12);
let source = await readFile('public/sw.js', 'utf8');
source = source.replace("'lifts-coach-v1'", JSON.stringify(`lifts-coach-${digest}`));
source = source.replace(
  "['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png']",
  JSON.stringify(assets),
);
await writeFile('dist/sw.js', source);
console.log(`Precached ${assets.length} application assets (${digest}).`);
