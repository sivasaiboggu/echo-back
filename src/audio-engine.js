export const DELAY_MIN = 0.5; // seconds
export const DELAY_MAX = 3.0; // seconds
export const DELAY_DEFAULT = 2.0; // seconds — the delay from the original post
export const VOLUME_DEFAULT = 70; // percent, slider position
export const GAIN_CAP = 0.85; // master gain never exceeds this (feedback safety)
export const DUCK_FACTOR = 0.3; // gain multiplier while the feedback guard is ducked
export const FEEDBACK_PEAK = 0.98; // input pinned at/above this = feedback risk
export const FEEDBACK_HOLD_MS = 500; // sustained pinned time before ducking
const DELAY_FADE_SECONDS = 0.09;
export const FEEDBACK_RECOVER_MS = 2000; // calm time before restoring gain

/** Clamp a delay in seconds to the slider range. Non-numbers fall back to default. */
export function clampDelay(seconds) {
  const v = Number(seconds);
  if (!Number.isFinite(v)) return DELAY_DEFAULT;
  return Math.min(DELAY_MAX, Math.max(DELAY_MIN, v));
}

/** Map a 0–100 volume slider value to a master gain, capped for safety. */
export function clampGain(volumePercent) {
  const v = Number(volumePercent);
  if (!Number.isFinite(v)) return 0;
  const pct = Math.min(100, Math.max(0, v));
  return (pct / 100) * GAIN_CAP;
}

/** mm:ss for the session timer. */
export function formatTimer(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** RMS level (0–1) of a Uint8Array of time-domain samples (128 centred). */
export function rmsFromTimeDomain(data) {
  if (!data || data.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = (data[i] - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / data.length));
}

/** Peak level (0–1) of a Uint8Array of time-domain samples. */
export function peakFromTimeDomain(data) {
  if (!data || data.length === 0) return 0;
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i] - 128) / 128;
    if (v > peak) peak = v;
  }
  return Math.min(1, peak);
}

// ---------------------------------------------------------------------------
// Session state machine: idle -> requesting -> listening -> echoing -> idle
// (echoing begins once the delay line is primed, i.e. delay seconds after
// the mic opens; error can be entered from requesting/listening/echoing).
// ---------------------------------------------------------------------------
export const STATES = ['idle', 'requesting', 'listening', 'echoing', 'error'];

const TRANSITIONS = {
  idle: ['requesting'],
  requesting: ['listening', 'error', 'idle'],
  listening: ['echoing', 'error', 'idle'],
  echoing: ['error', 'idle'],
  error: ['idle', 'requesting'],
};

export class EchoState {
  constructor() {
    this.state = 'idle';
    this.error = null;
  }

  /** Move to `next` if the transition is legal; returns true on success. */
  go(next) {
    if (!TRANSITIONS[this.state].includes(next)) return false;
    this.state = next;
    if (next !== 'error') this.error = null;
    return true;
  }

  fail(message) {
    this.error = message || 'Microphone unavailable.';
    this.state = 'error';
    return true;
  }

  reset() {
    this.state = 'idle';
    this.error = null;
  }
}

// ---------------------------------------------------------------------------
// Feedback guard. The mic and the speaker share the same room, so a loud
// loop can build. If the input peak stays pinned at max for FEEDBACK_HOLD_MS
// we duck the output gain and raise a warning; once the input has been calm
// for FEEDBACK_RECOVER_MS we restore it. Pure logic — time is injected so
// tests can drive it deterministically.
// ---------------------------------------------------------------------------
export class FeedbackGuard {
  constructor() {
    this.ducked = false;
    this._pinnedSince = null;
    this._calmSince = null;
  }

  /**
   * Feed one peak sample (0–1) at time `nowMs`. Returns 'duck' when the
   * guard engages, 'restore' when it releases, or null for no change.
   */
  update(peak, nowMs) {
    if (peak >= FEEDBACK_PEAK) {
      this._calmSince = null;
      if (this._pinnedSince === null) this._pinnedSince = nowMs;
      if (!this.ducked && nowMs - this._pinnedSince >= FEEDBACK_HOLD_MS) {
        this.ducked = true;
        return 'duck';
      }
      return null;
    }
    // Below the pin threshold: not a feedback loop.
    this._pinnedSince = null;
    if (this.ducked) {
      if (peak < 0.85) {
        if (this._calmSince === null) this._calmSince = nowMs;
        if (nowMs - this._calmSince >= FEEDBACK_RECOVER_MS) {
          this.ducked = false;
          this._calmSince = null;
          return 'restore';
        }
      } else {
        this._calmSince = null;
      }
    }
    return null;
  }
}

// Both delay taps keep the same input history. Retune the silent tap before
// fading to it so changing the delay does not bend the pitch of the old tap.
function connectDelayTaps(context, input, first, destination) {
  const second = context.createDelay(DELAY_MAX);
  second.delayTime.value = first.delayTime.value;
  const taps = [first, second].map((delay, index) => {
    const level = context.createGain();
    level.gain.value = index === 0 ? 1 : 0;
    input.connect(delay);
    delay.connect(level);
    level.connect(destination);
    return { delay, level: level.gain };
  });
  let current = 0;
  let target = first.delayTime.value;
  let fadeEnds = 0;

  function advance() {
    const now = context.currentTime;
    if (now < fadeEnds || taps[current].delay.delayTime.value === target) return;
    const next = 1 - current;
    const time = taps[next].delay.delayTime;
    time.value = target;
    // Change the delay one Web Audio render quantum before raising the tap.
    const start = now + 128 / context.sampleRate;
    fadeEnds = start + DELAY_FADE_SECONDS;
    for (const [index, tap] of taps.entries()) {
      tap.level.cancelScheduledValues(now);
      tap.level.setValueAtTime(index === current ? 1 : 0, now);
      tap.level.setValueAtTime(index === current ? 1 : 0, start);
      tap.level.linearRampToValueAtTime(index === next ? 1 : 0, fadeEnds);
    }
    current = next;
  }

  return {
    advance,
    set(seconds, priming) {
      target = seconds;
      if (priming) {
        for (const tap of taps) tap.delay.delayTime.value = target;
      } else {
        advance();
      }
    },
  };
}

export function createEchoGraph(audioCtx, stream, options = {}) {
  const delaySeconds = clampDelay(options.delaySeconds ?? DELAY_DEFAULT);
  const gainValue = clampGain(options.volumePercent ?? VOLUME_DEFAULT);

  const source = audioCtx.createMediaStreamSource(stream);

  const inputAnalyser = audioCtx.createAnalyser();
  inputAnalyser.fftSize = 2048;

  const delay = audioCtx.createDelay(DELAY_MAX);
  delay.delayTime.value = delaySeconds;

  const outputAnalyser = audioCtx.createAnalyser();
  outputAnalyser.fftSize = 2048;

  const compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value = 20;
  compressor.ratio.value = 12;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;

  const gain = audioCtx.createGain();
  gain.gain.value = gainValue;

  source.connect(inputAnalyser);
  compressor.connect(gain);
  let taps;
  let gate;
  if (options.smoothDelay) {
    taps = connectDelayTaps(audioCtx, inputAnalyser, delay, compressor);
    gate = audioCtx.createGain();
    gate.gain.value = 0;
    gain.connect(gate);
    gate.connect(outputAnalyser);
    outputAnalyser.connect(audioCtx.destination);
  } else {
    inputAnalyser.connect(delay);
    delay.connect(outputAnalyser);
    outputAnalyser.connect(compressor);
    gain.connect(audioCtx.destination);
  }
  const connectedAt = audioCtx.currentTime;
  let echoAt = connectedAt + delaySeconds;
  function prime() {
    gate.gain.cancelScheduledValues(audioCtx.currentTime);
    gate.gain.setValueAtTime(0, audioCtx.currentTime);
    gate.gain.setValueAtTime(0, Math.max(audioCtx.currentTime, echoAt));
    gate.gain.linearRampToValueAtTime(1, Math.max(audioCtx.currentTime, echoAt) + .012);
  }
  if (gate) prime();

  const graph = {
    source,
    inputAnalyser,
    delay,
    outputAnalyser,
    compressor,
    gain,
    baseGain: gainValue,
    ducked: false,
    connectedAt,
    get echoAt() { return echoAt; },

    advance() { taps?.advance(); },

    setDelay(seconds) {
      const v = clampDelay(seconds);
      if (taps) {
        const priming = audioCtx.currentTime < echoAt;
        taps.set(v, priming);
        if (priming) {
          echoAt = Math.max(audioCtx.currentTime, connectedAt + v);
          prime();
        }
      } else if (delay.delayTime.setTargetAtTime) {
        delay.delayTime.setTargetAtTime(v, audioCtx.currentTime, 0.05);
      } else {
        delay.delayTime.value = v;
      }
      return v;
    },

    setVolume(volumePercent) {
      const v = clampGain(volumePercent);
      this.baseGain = v;
      const target = this.ducked ? v * DUCK_FACTOR : v;
      if (gain.gain.setTargetAtTime) {
        gain.gain.setTargetAtTime(target, audioCtx.currentTime, 0.05);
      } else {
        gain.gain.value = target;
      }
      return v;
    },

    duck() {
      if (this.ducked) return;
      this.ducked = true;
      const target = this.baseGain * DUCK_FACTOR;
      if (gain.gain.setTargetAtTime) {
        gain.gain.setTargetAtTime(target, audioCtx.currentTime, 0.05);
      } else {
        gain.gain.value = target;
      }
    },

    restore() {
      if (!this.ducked) return;
      this.ducked = false;
      if (gain.gain.setTargetAtTime) {
        gain.gain.setTargetAtTime(this.baseGain, audioCtx.currentTime, 0.1);
      } else {
        gain.gain.value = this.baseGain;
      }
    },

    disconnect() {
      try { source.disconnect(); } catch { /* already gone */ }
      try { (gate ? outputAnalyser : gain).disconnect(); } catch { /* already gone */ }
    },
  };

  return graph;
}

/** Mic constraints: raw room audio, no echo cancellation / noise suppression. */
export function micConstraints() {
  return {
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    video: false,
  };
}
