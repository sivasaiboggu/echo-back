// Layout regression test — the app must fit the viewport with no
// horizontal overflow, at desktop (1280px) and at a true 390px phone
// width. Drives real headless Chrome over CDP (device metrics override
// gives a true 390px viewport — --window-size alone bottoms out at
// 500px) and reads the ?layoutcheck=1 report the page writes into its
// own DOM (see src/app.js).
import test from 'node:test';
import assert from 'node:assert/strict';
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

// This VM's Hatch Chrome build refuses to start without a WebGL domain
// policy: a file whose first line is the contract marker followed by
// registrable domains, plus its SHA-256. The policy only gates WebGL
// origins; this test needs DOM + 2D canvas only, so any valid contract
// (example.com) is enough to get the browser up.
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
const DEBUG_PORT = 9224;

// ---------- tiny CDP client (built-in WebSocket, no deps) ----------

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

  async evaluate(expression) {
    const { result } = await this.call('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`evaluate failed: ${JSON.stringify(result.exceptionDetails)}`);
    return result.value;
  }

  close() { try { this.ws.close(); } catch (err) { /* already closed */ } }
}

async function withBrowser(fn) {
  const firstUrl = pageUrl('index.html');
  const chrome = spawn(CHROME, chromeArgs(DEBUG_PORT, firstUrl));
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
    assert.ok(wsUrl, 'Chrome DevTools did not come up');
    const cdp = new Cdp(wsUrl);
    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');
    await fn(cdp);
    cdp.close();
  } finally {
    chrome.kill('SIGTERM');
  }
}

async function layoutReport(cdp, url, width, waitMs) {
  await cdp.call('Emulation.setDeviceMetricsOverride', {
    width, height: 844, deviceScaleFactor: 2, mobile: width < 600,
  });
  await cdp.call('Page.navigate', { url });
  await cdp.waitForEvent('Page.loadEventFired');
  await delay(waitMs);
  const raw = await cdp.evaluate(`(document.getElementById('layout-check') || {}).textContent || ''`);
  assert.ok(raw, `no layout-check report in ${url} (page may not have loaded)`);
  return JSON.parse(raw);
}

test('no horizontal overflow at 390px (phone), idle and echoing', { timeout: 240000 }, async () => {
  await withBrowser(async (cdp) => {
    for (const page of ['index.html', 'index.html?demo=1&autostart=1']) {
      const sep = page.includes('?') ? '&' : '?';
      const report = await layoutReport(cdp, pageUrl(`${page}${sep}layoutcheck=1`), 390, 4000);
      assert.equal(report.vw, 390, page);
      assert.equal(report.overflow, false, `${page} overflows at 390px: ${JSON.stringify(report.offenders)}`);
    }
  });
});

test('no horizontal overflow at 1280px (desktop), idle and echoing', { timeout: 240000 }, async () => {
  await withBrowser(async (cdp) => {
    for (const page of ['index.html', 'index.html?demo=1&autostart=1']) {
      const sep = page.includes('?') ? '&' : '?';
      const report = await layoutReport(cdp, pageUrl(`${page}${sep}layoutcheck=1`), 1280, 4000);
      assert.equal(report.overflow, false, `${page} overflows at 1280px: ${JSON.stringify(report.offenders)}`);
    }
  });
});

test('no horizontal overflow in the light theme at 390px (phone), idle and echoing', { timeout: 240000 }, async () => {
  await withBrowser(async (cdp) => {
    for (const page of ['index.html?theme=light', 'index.html?demo=1&autostart=1&theme=light']) {
      const sep = page.includes('?') ? '&' : '?';
      const report = await layoutReport(cdp, pageUrl(`${page}${sep}layoutcheck=1`), 390, 4000);
      assert.equal(report.vw, 390, page);
      assert.equal(report.overflow, false, `${page} overflows at 390px: ${JSON.stringify(report.offenders)}`);
    }
  });
});
