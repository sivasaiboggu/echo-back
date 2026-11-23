export const TAKE_LIMIT_SECONDS = 60;

export function waveFile(chunks, sampleRate) {
  const frames = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const dataLength = frames * 2;
  const wav = new DataView(new ArrayBuffer(44 + dataLength));
  const string = (offset, value) => {
    for (let i = 0; i < value.length; i++) wav.setUint8(offset + i, value.charCodeAt(i));
  };
  string(0, 'RIFF');
  wav.setUint32(4, 36 + dataLength, true);
  string(8, 'WAVEfmt ');
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true);
  wav.setUint16(22, 1, true);
  wav.setUint32(24, sampleRate, true);
  wav.setUint32(28, sampleRate * 2, true);
  wav.setUint16(32, 2, true);
  wav.setUint16(34, 16, true);
  string(36, 'data');
  wav.setUint32(40, dataLength, true);
  const peaks = new Uint8Array(48);
  let offset = 44;
  let frame = 0;
  for (const chunk of chunks) {
    for (const value of chunk) {
      wav.setInt16(offset, value, true);
      const index = Math.floor(frame++ * peaks.length / frames);
      peaks[index] = Math.max(peaks[index], Math.round(Math.abs(value) / 32768 * 255));
      offset += 2;
    }
  }
  return { blob: new Blob([wav], { type: 'audio/wav' }), duration: frames / sampleRate, peaks };
}

export async function prepareRecorder(context) {
  await context.audioWorklet.addModule(new URL('./record-worklet.js', import.meta.url));
}

export function recordTake(context, source, onFinish) {
  const node = new AudioWorkletNode(context, 'take-recorder', {
    channelCount: 1,
    channelCountMode: 'explicit',
    processorOptions: { seconds: TAKE_LIMIT_SECONDS },
  });
  const chunks = [];
  const startedAt = context.currentTime;
  let finished = false;
  let timeout;

  function complete(result) {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    source.disconnect(node);
    node.disconnect();
    node.port.close();
    onFinish(result);
  }

  function finalize() {
    complete(chunks.length ? waveFile(chunks, context.sampleRate) : null);
  }

  node.port.onmessage = ({ data }) => {
    if (data === 'finished') finalize();
    else chunks.push(data);
  };
  node.addEventListener('processorerror', finalize, { once: true });
  // The worklet outputs silence. Its output connection keeps it in the
  // render graph without adding a second monitor signal.
  source.connect(node);
  node.connect(context.destination);

  return {
    seconds: () => Math.min(TAKE_LIMIT_SECONDS, context.currentTime - startedAt),
    finish() {
      if (finished || timeout) return;
      node.port.postMessage('finish');
      // A suspended or interrupted context may no longer render callbacks.
      timeout = setTimeout(finalize, 400);
    },
    discard() { complete(null); },
  };
}
