class TakeRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.limit = sampleRate * options.processorOptions.seconds;
    this.frames = 0;
    this.buffer = new Int16Array(4096);
    this.used = 0;
    this.finished = false;
    this.port.onmessage = ({ data }) => {
      if (data === 'finish') this.finish();
    };
  }

  flush() {
    const chunk = this.buffer.subarray(0, this.used);
    this.port.postMessage(chunk, [chunk.buffer]);
    this.buffer = new Int16Array(4096);
    this.used = 0;
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    if (this.used) this.flush();
    this.port.postMessage('finished');
  }

  process(inputs) {
    if (this.finished) return false;
    const mic = inputs[0][0];
    if (!mic) return true;
    for (let i = 0; i < mic.length && this.frames < this.limit; i++, this.frames++) {
      const sample = Math.max(-1, Math.min(1, mic[i]));
      this.buffer[this.used++] = sample < 0 ? sample * 32768 : sample * 32767;
      if (this.used === this.buffer.length) this.flush();
    }
    if (this.frames === this.limit) this.finish();
    return !this.finished;
  }
}

registerProcessor('take-recorder', TakeRecorder);
