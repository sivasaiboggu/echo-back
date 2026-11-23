import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import axe from 'axe-core';
import { launchBrowser, serve, waitForState } from '../scripts/browser.mjs';

let browser;
let site;
before(async () => {
  site = await serve(fileURLToPath(new URL('..', import.meta.url)));
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
  site?.close();
});

async function audit(page, label) {
  await page.evaluate(axe.source);
  const violations = await page.evaluate(async () => (await window.axe.run()).violations.map(({ id, nodes }) => ({
    id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
  })));
  assert.deepEqual(violations, [], label);
}

for (const theme of ['dark', 'light']) {
  test(`axe finds no violations in ready and echoing states or secondary pages in ${theme} mode`, async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
    try {
      await page.goto(`${site.origin}/?demo=1&theme=${theme}`);
      await audit(page, 'ready');
      await page.getByRole('button', { name: '0.5 s', exact: true }).click();
      await page.getByRole('button', { name: 'Start echo' }).click();
      await waitForState(page, 'echoing');
      await audit(page, 'echoing');
      for (const route of ['privacy.html', '404.html', '500.html']) {
        await page.goto(`${site.origin}/${route}?theme=${theme}`);
        await audit(page, route);
      }
    } finally {
      await page.close();
    }
  });
}

test('axe finds no violations in recording, take playback or delete confirmation', async () => {
  const page = await browser.newPage({ permissions: ['microphone'], viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(site.origin);
    await page.getByRole('button', { name: 'Start echo' }).click();
    await waitForState(page, 'listening');
    await page.getByRole('button', { name: 'Record take' }).click();
    await page.getByRole('button', { name: 'Save take' }).waitFor();
    await audit(page, 'recording');
    await page.getByRole('button', { name: 'Save take' }).click();
    await page.getByRole('button', { name: /^Play take from/ }).click();
    await audit(page, 'playback');
    await page.getByRole('button', { name: /^Delete take from/ }).click();
    await audit(page, 'delete confirmation');
  } finally {
    await page.close();
  }
});
