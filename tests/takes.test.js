import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { launchBrowser, serve, waitForState } from '../scripts/browser.mjs';
import { waveFile } from '../src/take-recording.js';

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

test('the recorder caps PCM frames exactly and flushes the final block', async () => {
  const script = await readFile(new URL('../src/record-worklet.js', import.meta.url), 'utf8');
  class Processor {
    port = { messages: [], postMessage(message) { this.messages.push(message); } };
  }
  let Recorder;
  runInNewContext(script, {
    AudioWorkletProcessor: Processor,
    sampleRate: 80,
    registerProcessor(name, constructor) {
      assert.equal(name, 'take-recorder');
      Recorder = constructor;
    },
  });
  const recorder = new Recorder({ processorOptions: { seconds: 60 } });
  const signal = new Float32Array(4096).fill(.5);
  assert.equal(recorder.process([[signal]]), true);
  assert.equal(recorder.process([[signal]]), false);
  const [full, tail, end] = recorder.port.messages;
  assert.equal(full.length, 4096);
  assert.equal(tail.length, 704);
  assert.equal(full[0], 16383);
  assert.equal(end, 'finished');
  recorder.port.onmessage({ data: 'finish' });
  assert.equal(recorder.port.messages.length, 3);
});

test('WAV export retains all samples and declares a seekable PCM duration', async () => {
  const { blob, duration } = waveFile([Int16Array.of(-32768, 0), Int16Array.of(32767)], 48000);
  assert.equal(blob.type, 'audio/wav');
  assert.equal(duration, 3 / 48000);
  const bytes = Buffer.from(await blob.arrayBuffer());
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.readUInt16LE(22), 1);
  assert.equal(bytes.readUInt32LE(24), 48000);
  assert.equal(bytes.toString('ascii', 36, 40), 'data');
  assert.equal(bytes.readUInt32LE(40), 6);
  assert.deepEqual([44, 46, 48].map((offset) => bytes.readInt16LE(offset)), [-32768, 0, 32767]);
});

async function startTake(page) {
  await page.getByRole('button', { name: 'Start echo' }).click();
  await waitForState(page, 'listening');
  const volume = page.getByRole('slider', { name: 'Output volume' });
  await volume.press('Home');
  await page.getByRole('button', { name: 'Record take' }).click();
  await page.getByRole('button', { name: 'Save take' }).waitFor();
  await page.locator('#recordClock').filter({ hasText: '00:01' }).waitFor();
}

test('stopping the mic saves a dry take that survives reload and supports playback, seek, download and deletion', async () => {
  const page = await browser.newPage({ permissions: ['microphone'], viewport: { width: 320, height: 800 } });
  try {
    await page.goto(site.origin);
    await startTake(page);
    await page.getByRole('button', { name: 'Stop echo' }).click();
    await waitForState(page, 'idle');
    await page.locator('#recordStatus').filter({ hasText: 'Take saved' }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: /^Play take from/ }).click();
    const audio = page.locator('#takeAudio');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const seek = page.getByRole('slider', { name: 'Playback position' });
    await seek.press('Home');
    await seek.press('ArrowRight');
    await page.waitForFunction(() => document.getElementById('takeAudio').currentTime > 0);
    await page.getByRole('combobox', { name: 'Speed' }).selectOption('.75');
    assert.equal(await audio.evaluate((element) => element.playbackRate), .75);
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download' }).click();
    const file = await download;
    assert.match(file.suggestedFilename(), /^echoback-.*\.wav$/);
    const bytes = await readFile(await file.path());
    assert.ok(bytes.readUInt32LE(40) >= bytes.readUInt32LE(28), 'the downloaded WAV holds at least one second');
    assert.ok(bytes.some((value, index) => index >= 44 && value !== 0), 'zero monitor volume does not mute the recorded mic');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 320);
    await page.getByRole('button', { name: /^Delete take from/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Keep take' }).click();
    assert.equal(await page.getByRole('button', { name: /^Play take from/ }).count(), 1);
    await page.getByRole('button', { name: /^Delete take from/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete take', exact: true }).click();
    await page.locator('#takeMessage').filter({ hasText: 'Take deleted' }).waitFor();
    await page.reload();
    await page.locator('#takesEmpty').filter({ hasText: 'No takes yet' }).waitFor();
  } finally {
    await page.close();
  }
});

test('a failed storage write preserves the recording for download', async () => {
  const page = await browser.newPage({ permissions: ['microphone'] });
  try {
    await page.addInitScript(() => {
      IDBObjectStore.prototype.add = function () {
        this.transaction.abort();
      };
    });
    await page.goto(site.origin);
    await startTake(page);
    await page.getByRole('button', { name: 'Save take' }).click();
    await page.locator('#recordStatus').filter({ hasText: 'Could not save this take' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Record take' }).isDisabled(), true);
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download' }).click();
    await download;
    assert.equal(await page.getByRole('button', { name: 'Record take' }).isEnabled(), true);
  } finally {
    await page.close();
  }
});

test('concurrent saves respect the shared library capacity', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(site.origin);
    const counts = await page.evaluate(async () => {
      const { loadTakes, saveTake, TAKE_CAPACITY } = await import('/src/take-store.js');
      const results = await Promise.all(Array.from({ length: TAKE_CAPACITY + 1 }, (_, index) =>
        saveTake({ id: String(index), createdAt: Date.now(), blob: new Blob(), duration: 1 })));
      return [results.filter(Boolean).length, (await loadTakes()).length, TAKE_CAPACITY];
    });
    assert.deepEqual(counts, [12, 12, 12]);
  } finally {
    await page.close();
  }
});
