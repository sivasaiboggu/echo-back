import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

export async function serve(directory) {
  const root = resolve(directory);
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + sep)) {
      response.writeHead(400).end('Bad request');
      return;
    }
    try {
      const contents = await readFile(file);
      response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
      response.end(contents);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
        .end('<!doctype html><title>Page not found</title><h1>Page not found</h1>');
    }
  });
  await new Promise((ready, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', ready);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => { server.closeAllConnections(); server.close(); },
  };
}

export function launchBrowser() {
  const executablePath = process.env.CHROME_BIN || [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/opt/meta-chromium/chrome',
  ].find(existsSync);
  if (!executablePath) throw new Error('Install Chromium or set CHROME_BIN to its executable path.');
  return chromium.launch({
    executablePath,
    args: ['--use-fake-device-for-media-stream'],
  });
}

export function waitForState(page, state) {
  return page.waitForFunction((expected) => document.body.dataset.state === expected, state);
}
