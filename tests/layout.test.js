import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { launchBrowser, serve, waitForState } from '../scripts/browser.mjs';

let site;
let browser;

before(async () => {
  site = await serve(new URL('..', import.meta.url).pathname);
  browser = await launchBrowser();
});

after(async () => {
  await browser?.close();
  site?.close();
});

for (const { width, theme } of [
  { width: 320, theme: 'dark' },
  { width: 320, theme: 'light' },
  { width: 390, theme: 'dark' },
  { width: 390, theme: 'light' },
  { width: 768, theme: 'dark' },
  { width: 768, theme: 'light' },
  { width: 1440, theme: 'dark' },
  { width: 1440, theme: 'light' },
  { width: 1280, theme: 'dark' },
  { width: 1280, theme: 'light' },
]) {
  test(`no horizontal overflow at ${width}px in ${theme} mode`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 860 }, isMobile: width < 500 });
    try {
      await page.goto(`${site.origin}/?theme=${theme}&demo=1`);
      await page.evaluate(() => document.fonts.ready);

      async function check() {
        const size = await page.evaluate(() => ({
          viewport: document.documentElement.clientWidth,
          content: document.documentElement.scrollWidth,
        }));
        assert.equal(size.viewport, width);
        assert.equal(size.content, size.viewport);
      }

      await check();
      await page.getByRole('button', { name: 'Start echo' }).click();
      await waitForState(page, 'listening');
      await check();
      await waitForState(page, 'echoing');
      await check();
    } finally {
      await page.close();
    }
  });
}

test('demo controls work by keyboard, update the ruler, and stop cleanly', async () => {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  try {
    await page.goto(`${site.origin}/?demo=1`);
    await page.keyboard.press('Tab');
    assert.match(await page.locator(':focus').innerText(), /Skip/);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator(':focus').getAttribute('id'), 'startBtn');
    await page.keyboard.press('Enter');
    await waitForState(page, 'listening');
    const delay = page.getByRole('slider', { name: 'Echo delay' });
    await delay.press('Home');
    assert.equal(await delay.getAttribute('aria-valuetext'), '0.5 seconds');
    await waitForState(page, 'echoing');
    assert.equal(await page.locator('#rulerLabels').innerText(), '0 s\n+0.5 s');
    assert.equal(await page.locator('#rulerMarker').isVisible(), false);

    const volume = page.getByRole('slider', { name: 'Output volume' });
    await volume.press('Home');
    assert.equal(await volume.getAttribute('aria-valuetext'), '0 percent');
    assert.equal(await page.locator('#speakerStatus').innerText(), 'Muted');

    await page.getByRole('button', { name: 'Stop echo' }).press('Enter');
    await waitForState(page, 'idle');
    assert.equal(await page.locator('#sessionTimer').innerText(), '00:00');
  } finally {
    await page.close();
  }
});

test('microphone denial shows a recovery step and permits a retry', async () => {
  const page = await browser.newPage();
  try {
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Denied', 'NotAllowedError'));
    });
    await page.goto(site.origin);
    await page.getByRole('button', { name: 'Start echo' }).click();
    await waitForState(page, 'error');
    assert.match(await page.locator('#sessionNote').innerText(), /browser settings/);
    await page.getByRole('button', { name: 'Start echo' }).click();
    await waitForState(page, 'error');
  } finally {
    await page.close();
  }
});

test('a late microphone response after Cancel cannot interrupt a new session', async () => {
  const page = await browser.newPage({ permissions: ['microphone'] });
  try {
    await page.addInitScript(() => {
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.pendingMicrophones = [];
      navigator.mediaDevices.getUserMedia = (constraints) => new Promise((resolve, reject) => {
        window.pendingMicrophones.push(async () => {
          try {
            const stream = await getUserMedia(constraints);
            window.lastMicrophone = stream;
            resolve(stream);
          } catch (error) { reject(error); }
        });
      });
    });
    await page.goto(site.origin);
    const start = page.getByRole('button', { name: 'Start echo' });
    await start.click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await waitForState(page, 'idle');
    await start.click();
    await waitForState(page, 'requesting');
    await page.evaluate(() => window.pendingMicrophones.shift()());
    await page.waitForFunction(() => window.lastMicrophone.getAudioTracks()[0].readyState === 'ended');
    await waitForState(page, 'requesting');
    await page.evaluate(() => window.pendingMicrophones.shift()());
    await waitForState(page, 'listening');
    assert.equal(await page.evaluate(() => window.lastMicrophone.getAudioTracks()[0].readyState), 'live');
    await waitForState(page, 'echoing');
    await page.getByRole('button', { name: 'Stop echo' }).click();
    await waitForState(page, 'idle');
    assert.equal(await page.evaluate(() => window.lastMicrophone.getAudioTracks()[0].readyState), 'ended');
  } finally {
    await page.close();
  }
});

test('theme and privacy links stay in sync', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(site.origin);
    await page.getByRole('link', { name: 'Nothing is recorded' }).click();
    await page.getByRole('button', { name: 'Light mode' }).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await page.getByRole('link', { name: 'Back to EchoBack' }).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    assert.equal(await page.getByRole('heading', { level: 1 }).innerText(), 'Room sound,\non a delay.');
  } finally {
    await page.close();
  }
});

test('feedback warning appears and clears with the live audio guard', async () => {
  const page = await browser.newPage({ permissions: ['microphone'] });
  try {
    await page.addInitScript(() => {
      window.micIsLoud = true;
      AnalyserNode.prototype.getByteTimeDomainData = (buffer) => {
        buffer.fill(window.micIsLoud ? 255 : 128);
      };
    });
    await page.goto(site.origin);
    await page.getByRole('button', { name: 'Start echo' }).click();
    const warning = page.locator('#feedbackWarn');
    await warning.filter({ hasText: /Output volume lowered/ }).waitFor();
    await page.evaluate(() => { window.micIsLoud = false; });
    await warning.waitFor({ state: 'hidden' });
    assert.equal(await warning.innerText(), '');
    await page.getByRole('button', { name: 'Stop echo' }).click();
    await waitForState(page, 'idle');
  } finally {
    await page.close();
  }
});
