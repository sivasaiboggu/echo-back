// Real Chrome renders for review: desktop 1280px + phone 390px,
// idle and echoing (demo mode). Run: node scripts/shots.mjs
// Writes screenshots/*.png. Needs google-chrome on PATH.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const CHROME = process.env.CHROME_BIN
  || ['/opt/meta-chromium/chrome', '/usr/bin/chromium-browser', 'google-chrome']
    .find((c) => c.startsWith('/') ? fs.existsSync(c) : true);

// See tests/layout.test.js — this VM's Hatch Chrome needs a WebGL domain
// policy (contract file + SHA-256) just to start.
function chromeArgs(debugPort, firstUrl) {
  const policy = 'hatch-webgl-allowed-domains-v1\nexample.com\n';
  const file = path.join(os.tmpdir(), 'echo-back-webgl-policy.txt');
  fs.writeFileSync(file, policy);
  const sha = createHash('sha256').update(policy).digest('hex');
  return [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--allow-file-access-from-files',
    `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'echo-back-chrome-'))}`,
    `--hatch-webgl-allowed-domains-file=${file}`,
    `--hatch-webgl-allowed-domains-sha256=${sha}`,
    `--remote-debugging-port=${debugPort}`,
    '--window-size=1280,900',
    firstUrl,
  ];
}

// Pages load over file://, not http://127.0.0.1: this Chrome build blocks
// navigations to local-network servers (ERR_BLOCKED_BY_LOCAL_NETWORK_
// ACCESS_CHECKS) when initiated through DevTools, while file:// pages load
// fine with --allow-file-access-from-files (ES module imports included).
const pageUrl = (page) => `file://${ROOT}/${page}`;
const DEBUG_PORT = 9225;

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    };
  }

  async call(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    const done = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, method, params }));
    return done;
  }

  async waitForEvent(method, timeoutMs = 30000) {
    const start = Date.now();
    for (;;) {
      const i = this.events.findIndex((e) => e.method === method);
      if (i >= 0) return this.events.splice(i, 1)[0];
      if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${method}`);
      await delay(100);
    }
  }

  close() { try { this.ws.close(); } catch (err) { /* already closed */ } }
}

const SHOTS = [
  { name: 'mobile-idle.png', width: 390, url: 'index.html', waitMs: 3500 },
  { name: 'mobile-echoing.png', width: 390, url: 'index.html?demo=1&autostart=1', waitMs: 6000 },
  { name: 'desktop-idle.png', width: 1280, url: 'index.html', waitMs: 3500 },
  { name: 'desktop-echoing.png', width: 1280, url: 'index.html?demo=1&autostart=1', waitMs: 6000 },
  { name: 'mobile-light-idle.png', width: 390, url: 'index.html?theme=light', waitMs: 3500 },
  { name: 'desktop-light-echoing.png', width: 1280, url: 'index.html?demo=1&autostart=1&theme=light', waitMs: 6000 },
];

async function main() {
  const first = SHOTS[0];
  const chrome = spawn(CHROME, chromeArgs(DEBUG_PORT, pageUrl(first.url)));
  try {
    let wsUrl = null;
    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
        const targets = await res.json();
        const page = targets.find((t) => t.type === 'page');
        if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
      } catch (err) { /* not up yet */ }
      await delay(200);
    }
    if (!wsUrl) throw new Error('Chrome DevTools did not come up');
    const cdp = new Cdp(wsUrl);
    await cdp.call('Page.enable');
    for (const shot of SHOTS) {
      await cdp.call('Emulation.setDeviceMetricsOverride', {
        width: shot.width, height: 844, deviceScaleFactor: 1, mobile: shot.width < 600,
      });
      await cdp.call('Page.navigate', { url: pageUrl(shot.url) });
      await cdp.waitForEvent('Page.loadEventFired');
      await delay(shot.waitMs);
      const { data } = await cdp.call('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: true,
      });
      fs.writeFileSync(path.join(ROOT, 'screenshots', shot.name), Buffer.from(data, 'base64'));
      console.log('wrote', shot.name);
    }
    cdp.close();
  } finally {
    chrome.kill('SIGTERM');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
