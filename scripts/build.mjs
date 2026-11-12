import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist');
const nativeBuild = process.argv.includes('--native');
await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, 'js'), { recursive: true });
await mkdir(resolve(dist, 'assets'), { recursive: true });
const config = JSON.parse(await readFile(resolve(root, 'app.config.json'), 'utf8'));
const url = process.env.SCHEDULE_DATA_URL ?? config.scheduleDataUrl ?? '';
if (url && !url.startsWith('https://')) throw new Error('SCHEDULE_DATA_URL musi używać HTTPS');
for (const file of ['index.html', 'style.css', 'data.json', 'schedule.php', 'privacy.html', 'manifest.webmanifest', 'assets/icon.svg', 'assets/icon-192.png', 'assets/icon-512.png']) await copyFile(resolve(root, file), resolve(dist, file));
for (const name of ['calendar', 'services', 'planner', 'app']) {
  await build({ entryPoints: [resolve(root, `js/${name}.js`)], outfile: resolve(dist, `js/${name}.js`), target: ['safari15', 'chrome80'], minify: false,
    banner: name === 'app' ? { js: `window.APP_DATA_URL = ${JSON.stringify(url)};` } : undefined });
}
const hash = createHash('sha256');
for (const file of ['index.html', 'style.css', 'data.json', 'schedule.php', 'privacy.html', 'manifest.webmanifest', 'assets/icon.svg', 'assets/icon-192.png', 'assets/icon-512.png', 'js/calendar.js', 'js/services.js', 'js/planner.js', 'js/app.js', 'sw.js']) {
  hash.update(await readFile(resolve(file === 'sw.js' ? root : dist, file)));
}
const worker = (await readFile(resolve(root, 'sw.js'), 'utf8')).replace('ranizow-APP_VERSION', 'ranizow-' + hash.digest('hex').slice(0, 16));
await writeFile(resolve(dist, 'sw.js'), worker);
if (!nativeBuild) await cp(resolve(root, 'downloads'), resolve(dist, 'downloads'), { recursive: true });
console.log('Zbudowano dist/ — web/PWA oraz zasoby Android/iOS.');
