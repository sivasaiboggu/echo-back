import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tailwind, variables } from './tokens.mjs';

const path = (file) => new URL(`../${file}`, import.meta.url);
const output = (file) => path(`dist/${file}`);
const source = (file) => readFile(path(file), 'utf8');
const publicUrl = process.env.ECHOBACK_PUBLIC_URL ? new URL(process.env.ECHOBACK_PUBLIC_URL) : null;

if (publicUrl && (publicUrl.protocol !== 'https:' || publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password)) {
  throw new Error('ECHOBACK_PUBLIC_URL must be a public HTTPS directory URL.');
}
if (publicUrl && !publicUrl.pathname.endsWith('/')) publicUrl.pathname += '/';

const assets = [
  '404.html', '500.html', 'index.html', 'privacy.html', 'tokens.css', 'styles.css',
  'manifest.webmanifest', 'src/app.js', 'src/audio-engine.js', 'src/ui-helpers.js', 'src/theme.js',
  'assets/mark.svg', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/echo-back-og.png',
  'assets/grain.png', 'assets/ibm-plex-sans-latin.woff2', 'assets/OFL.txt',
];

for (const [file, expected] of [['tokens.css', variables], ['design/tailwind.css', tailwind]]) {
  if (await source(file) !== expected) throw new Error(`${file} is stale. Run npm run tokens.`);
}

const worker = await source('sw.js');
const version = createHash('sha256').update(worker);
const files = new Map();
for (const file of assets) {
  let contents = await readFile(path(file));
  if (file.endsWith('.html')) {
    let html = contents.toString('utf8');
    if (file === 'index.html') {
      html = html.replace('<html lang="en"', '<html lang="en" data-offline="true"');
      if (publicUrl) html = html.replace(
        '<meta property="og:image" content="./assets/echo-back-og.png">',
        `<meta property="og:image" content="${new URL('assets/echo-back-og.png', publicUrl)}">\n`
          + `  <link rel="canonical" href="${publicUrl}">\n  <meta property="og:url" content="${publicUrl}">`,
      );
    }
    if (publicUrl) html = html.replace('<base href="./">', `<base href="${publicUrl}">`);
    contents = Buffer.from(html);
  }
  if (file.endsWith('.js')) {
    const check = spawnSync(process.execPath, ['--check', fileURLToPath(path(file))], { stdio: 'inherit' });
    if (check.status !== 0) throw new Error(`Could not validate ${file}`);
  }
  version.update(file).update(contents);
  files.set(file, contents);
}

const builtWorker = worker.replace('__BUILD_VERSION__', version.digest('hex').slice(0, 16))
  .replace('__APP_FILES__', JSON.stringify(assets));
const workerCheck = spawnSync(process.execPath, ['--check'], { input: builtWorker, stdio: ['pipe', 'inherit', 'inherit'] });
if (workerCheck.status !== 0) throw new Error('Could not validate service worker');
files.set('sw.js', builtWorker);

for (const [file, contents] of files) {
  await mkdir(new URL('.', output(file)), { recursive: true });
  await writeFile(output(file), contents);
}
console.log(`Built ${files.size} files in dist/.`);
