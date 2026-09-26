import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
async function files(dir) {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(e => e.isDirectory() ? files(`${dir}/${e.name}`) : `${dir}/${e.name}`))).flat();
}
const assets = ['/offline', '/favicon.ico', '/android-chrome-192x192.png',
  ...(await files('.next/static')).filter(p => !p.endsWith('.map')).map(p => p.replace('.next/', '/_next/'))];
const template = await readFile('scripts/sw-template.js', 'utf8');
// Next's build ID also changes when only the HTML/server components change.
const buildId = await readFile('.next/BUILD_ID', 'utf8');
const version = createHash('sha256').update(template + buildId + JSON.stringify(assets)).digest('hex').slice(0,16);
await writeFile('public/sw.js', template.replace('__VERSION__', version).replace('__ASSETS__', JSON.stringify(assets)));
console.log(`Offline shell: ${assets.length} resources, version ${version}`);
