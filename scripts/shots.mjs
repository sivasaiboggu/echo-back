import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser, serve, waitForState } from './browser.mjs';

const [, , baseline, directory = 'screenshots'] = process.argv;
const root = fileURLToPath(new URL('..', import.meta.url));
const desktop = { width: 1440, height: 960 };
const phone = { width: 390, height: 844 };
const cases = [
  { name: 'desktop-idle', viewport: desktop },
  { name: 'desktop-echoing', viewport: desktop, state: 'echoing' },
  { name: 'phone-idle', viewport: phone },
  { name: 'phone-echoing-light', viewport: phone, state: 'echoing', light: true },
  { name: 'microphone-request', viewport: desktop, state: 'requesting' },
  { name: 'first-echo', viewport: desktop, state: 'listening' },
  { name: 'microphone-denied', viewport: desktop, state: 'error' },
  { name: 'output-lowered', viewport: desktop, state: 'warning' },
];
const newPages = [
  { name: 'recording', viewport: desktop, state: 'recording' },
  { name: 'take-playback', viewport: phone, state: 'playback' },
  { name: 'privacy-light', viewport: desktop, path: 'privacy.html', light: true },
  { name: 'not-found', viewport: desktop, path: '404.html' },
  { name: 'unavailable', viewport: desktop, path: '500.html' },
];

async function prepare(page, state) {
  if (state === 'requesting') {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => new Promise(() => {});
    });
  }
  if (state === 'error') {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Denied', 'NotAllowedError'));
    });
  }
  if (state === 'warning') {
    await page.addInitScript(() => {
      const sample = AnalyserNode.prototype.getByteTimeDomainData;
      AnalyserNode.prototype.getByteTimeDomainData = function (buffer) {
        sample.call(this, buffer);
        // Feed a pinned peak through the real feedback guard with a fake mic.
        buffer[0] = 255;
      };
    });
  }
}

async function capture(browser, origin, shot, file) {
  const { name, viewport, light, state, path = 'index.html' } = shot;
  const page = await browser.newPage({
    viewport,
    isMobile: viewport.width < 500,
    locale: 'en-US',
    timezoneId: 'UTC',
    permissions: ['warning', 'recording', 'playback'].includes(state) ? ['microphone'] : [],
  });
  try {
    await prepare(page, state);
    const url = new URL(path, origin);
    if (light) url.searchParams.set('theme', 'light');
    if (state === 'listening' || state === 'echoing') url.searchParams.set('demo', '1');
    await page.goto(url.href);
    await page.evaluate(() => document.fonts.ready);
    if (state) {
      await page.getByRole('button', { name: /Start echo/ }).click();
      if (state === 'recording' || state === 'playback') {
        await waitForState(page, 'listening');
        await page.getByRole('button', { name: 'Record take' }).click();
        const save = page.getByRole('button', { name: 'Save take' });
        await save.waitFor();
        await page.locator('#recordClock').filter({ hasText: '00:03' }).waitFor();
        if (state === 'playback') {
          await save.click();
          await page.getByRole('button', { name: /^Play take from/ }).click();
          await page.getByRole('button', { name: 'Pause', exact: true }).click();
          await page.locator('#takePlayer').scrollIntoViewIfNeeded();
        }
      } else {
        await waitForState(page, state === 'warning' ? 'echoing' : state);
      }
      if (state === 'warning') {
        await page.locator('#feedbackWarn').filter({ hasText: /volume (lowered|turned down)/i }).waitFor();
      } else if (state === 'listening') {
        await page.waitForTimeout(680);
      } else if (state === 'echoing') {
        await page.waitForTimeout(550);
      }
    }
    const pathToImage = resolve(directory, `${file}-${name}.png`);
    if (state === 'playback') {
      await page.locator('#takes').screenshot({ path: pathToImage, animations: 'disabled' });
    } else {
      await page.screenshot({
        path: pathToImage,
        fullPage: !state || state === 'echoing',
        animations: 'disabled',
      });
    }
    console.log(`Captured ${file}-${name}`);
  } finally {
    await page.close();
  }
}

const browser = await launchBrowser();
try {
  await mkdir(directory, { recursive: true });
  for (const [kind, source] of [['before', baseline], ['after', process.env.ECHOBACK_SHOT_ROOT || root]]) {
    if (!source) continue;
    const site = await serve(source);
    try {
      for (const shot of kind === 'after' ? [...cases, ...newPages] : cases) {
        await capture(browser, site.origin, shot, kind);
      }
    } finally {
      site.close();
    }
  }
} finally {
  await browser.close();
}
