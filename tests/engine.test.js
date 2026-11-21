// EchoBack — unit tests for the pure logic and the audio graph (mocked).
// Run: npm test  (node --test tests/*.test.js)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DELAY_MIN,
  DELAY_MAX,
  DELAY_DEFAULT,
  GAIN_CAP,
  clampDelay,
  clampGain,
  formatTimer,
  rmsFromTimeDomain,
  peakFromTimeDomain,
  EchoState,
  FeedbackGuard,
  createEchoGraph,
  micConstraints,
} from '../src/audio-engine.js';

// --- mock Web Audio --------------------------------------------------------
function mockParam(value = 0) {
  return {
    value,
    calls: [],
    setTargetAtTime(v, t, c) { this.calls.push(['setTargetAtTime', v, t, c]); this.value = v; },
    linearRampToValueAtTime(v) { this.calls.push(['linearRamp', v]); this.value = v; },
  };
}

function mockNode() {
  return { connections: [], connect(n) { this.connections.push(n); }, disconnect() {} };
}

function mockAudioContext() {
  const nodes = [];
  const ctx = {
    currentTime: 1.5,
    destination: mockNode(),
    created: nodes,
    createMediaStreamSource() { const n = mockNode(); n.kind = 'source'; nodes.push(n); return n; },
    createAnalyser() { const n = mockNode(); n.kind = 'analyser'; n.fftSize = 0; nodes.push(n); return n; },
    createDelay(max) { const n = mockNode(); n.kind = 'delay'; n.maxDelay = max; n.delayTime = mockParam(0); nodes.push(n); return n; },
    createDynamicsCompressor() {
      const n = mockNode(); n.kind = 'compressor';
      n.threshold = mockParam(0); n.knee = mockParam(0); n.ratio = mockParam(0);
      n.attack = mockParam(0); n.release = mockParam(0); nodes.push(n); return n;
    },
    createGain() { const n = mockNode(); n.kind = 'gain'; n.gain = mockParam(0); nodes.push(n); return n; },
  };
  return ctx;
}

// --- delay clamping --------------------------------------------------------
describe('clampDelay', () => {
  it('keeps values inside 0.5–3.0s', () => {
    assert.equal(clampDelay(2.0), 2.0);
    assert.equal(clampDelay(0.5), DELAY_MIN);
    assert.equal(clampDelay(3.0), DELAY_MAX);
    assert.equal(clampDelay(0.1), DELAY_MIN);
    assert.equal(clampDelay(9), DELAY_MAX);
  });
  it('falls back to the 2.0s default for non-numbers', () => {
    assert.equal(clampDelay(undefined), DELAY_DEFAULT);
    assert.equal(clampDelay('loud'), DELAY_DEFAULT);
    assert.equal(clampDelay(NaN), DELAY_DEFAULT);
  });
  it('accepts numeric strings', () => {
    assert.equal(clampDelay('1.2'), 1.2);
  });
});

// --- gain limits -----------------------------------------------------------
describe('clampGain', () => {
  it('maps 0–100% to 0–GAIN_CAP', () => {
    assert.equal(clampGain(0), 0);
    assert.equal(clampGain(100), GAIN_CAP);
    assert.equal(clampGain(50), GAIN_CAP / 2);
    assert.equal(clampGain(70), 0.7 * GAIN_CAP);
  });
  it('clamps out-of-range and non-numeric input', () => {
    assert.equal(clampGain(250), GAIN_CAP);
    assert.equal(clampGain(-20), 0);
    assert.equal(clampGain('nope'), 0);
  });
});

// --- timer -----------------------------------------------------------------
describe('formatTimer', () => {
  it('formats mm:ss', () => {
    assert.equal(formatTimer(0), '00:00');
    assert.equal(formatTimer(5), '00:05');
    assert.equal(formatTimer(65), '01:05');
    assert.equal(formatTimer(600), '10:00');
    assert.equal(formatTimer(3599), '59:59');
  });
  it('floors fractions and guards bad input', () => {
    assert.equal(formatTimer(2.9), '00:02');
    assert.equal(formatTimer(-3), '00:00');
    assert.equal(formatTimer(undefined), '00:00');
  });
});

// --- level helpers ---------------------------------------------------------
describe('level helpers', () => {
  it('silence reads 0 rms and 0 peak', () => {
    const silent = new Uint8Array(16).fill(128);
    assert.equal(rmsFromTimeDomain(silent), 0);
    assert.equal(peakFromTimeDomain(silent), 0);
  });
  it('full-scale reads ~1 peak and high rms', () => {
    const loud = new Uint8Array(16);
    for (let i = 0; i < 16; i++) loud[i] = i % 2 ? 255 : 0;
    assert.ok(peakFromTimeDomain(loud) > 0.99);
    assert.ok(rmsFromTimeDomain(loud) > 0.9);
  });
  it('handles empty input', () => {
    assert.equal(rmsFromTimeDomain(new Uint8Array(0)), 0);
    assert.equal(peakFromTimeDomain(null), 0);
  });
});

// --- state machine ---------------------------------------------------------
describe('EchoState', () => {
  it('walks idle -> requesting -> listening -> echoing -> idle', () => {
    const s = new EchoState();
    assert.equal(s.state, 'idle');
    assert.equal(s.go('requesting'), true);
    assert.equal(s.go('listening'), true);
    assert.equal(s.go('echoing'), true);
    assert.equal(s.go('idle'), true);
  });
  it('rejects illegal jumps', () => {
    const s = new EchoState();
    assert.equal(s.go('echoing'), false);
    assert.equal(s.state, 'idle');
    s.go('requesting');
    assert.equal(s.go('echoing'), false);
    assert.equal(s.state, 'requesting');
  });
  it('records errors and recovers', () => {
    const s = new EchoState();
    s.go('requesting');
    s.fail('Mic denied.');
    assert.equal(s.state, 'error');
    assert.equal(s.error, 'Mic denied.');
    assert.equal(s.go('requesting'), true);
    assert.equal(s.error, null);
    s.reset();
    assert.equal(s.state, 'idle');
  });
});

// --- feedback guard --------------------------------------------------------
describe('FeedbackGuard', () => {
  it('ducks after the input stays pinned for 500ms', () => {
    const g = new FeedbackGuard();
    assert.equal(g.update(0.99, 0), null);
    assert.equal(g.update(0.99, 300), null);
    assert.equal(g.update(0.99, 500), 'duck');
    assert.equal(g.ducked, true);
  });
  it('does not duck on a brief loud spike', () => {
    const g = new FeedbackGuard();
    assert.equal(g.update(1.0, 0), null);
    assert.equal(g.update(0.4, 200), null);
    assert.equal(g.update(1.0, 400), null);
    assert.equal(g.ducked, false);
  });
  it('restores after 2s calm below 0.85', () => {
    const g = new FeedbackGuard();
    g.update(0.99, 0);
    assert.equal(g.update(0.99, 500), 'duck');
    assert.equal(g.update(0.5, 600), null);
    assert.equal(g.update(0.5, 2000), null);
    assert.equal(g.update(0.5, 2600), 'restore');
    assert.equal(g.ducked, false);
  });
  it('does not restore while the input is still hot', () => {
    const g = new FeedbackGuard();
    g.update(0.99, 0);
    g.update(0.99, 500);
    assert.equal(g.update(0.9, 600), null);
    assert.equal(g.update(0.9, 3000), null);
    assert.equal(g.ducked, true);
  });
  it('a quiet room never triggers it', () => {
    const g = new FeedbackGuard();
    for (let t = 0; t <= 5000; t += 100) {
      assert.equal(g.update(0.3, t), null);
    }
    assert.equal(g.ducked, false);
  });
});

// --- audio graph (mocked) --------------------------------------------------
describe('createEchoGraph', () => {
  it('wires source -> analyser -> delay -> analyser -> compressor -> gain -> destination', () => {
    const ctx = mockAudioContext();
    const graph = createEchoGraph(ctx, {}, { delaySeconds: 2, volumePercent: 70 });
    const kinds = ctx.created.map((n) => n.kind);
    assert.deepEqual(kinds, ['source', 'analyser', 'delay', 'analyser', 'compressor', 'gain']);
    const [source, inAn, delay, outAn, comp, gain] = ctx.created;
    assert.deepEqual(source.connections, [inAn]);
    assert.deepEqual(inAn.connections, [delay]);
    assert.deepEqual(delay.connections, [outAn]);
    assert.deepEqual(outAn.connections, [comp]);
    assert.deepEqual(comp.connections, [gain]);
    assert.deepEqual(gain.connections, [ctx.destination]);
    assert.equal(delay.maxDelay, 3.0);
    assert.equal(delay.delayTime.value, 2.0);
    assert.equal(gain.gain.value, 0.7 * GAIN_CAP);
  });
  it('caps the delay line at 3.0s and clamps the delay value', () => {
    const ctx = mockAudioContext();
    const graph = createEchoGraph(ctx, {}, { delaySeconds: 9, volumePercent: 100 });
    const delay = ctx.created.find((n) => n.kind === 'delay');
    const gain = ctx.created.find((n) => n.kind === 'gain');
    assert.equal(delay.delayTime.value, DELAY_MAX);
    assert.equal(gain.gain.value, GAIN_CAP);
  });
  it('compressor is set to tame loud peaks', () => {
    const ctx = mockAudioContext();
    createEchoGraph(ctx, {}, {});
    const comp = ctx.created.find((n) => n.kind === 'compressor');
    assert.equal(comp.threshold.value, -20);
    assert.equal(comp.ratio.value, 12);
  });
  it('setDelay clamps and ramps; setVolume re-applies the cap', () => {
    const ctx = mockAudioContext();
    const graph = createEchoGraph(ctx, {}, { delaySeconds: 2, volumePercent: 70 });
    assert.equal(graph.setDelay(0.2), DELAY_MIN);
    assert.equal(graph.setDelay(2.5), 2.5);
    assert.equal(graph.setVolume(120), GAIN_CAP);
    assert.equal(graph.setVolume(0), 0);
  });
  it('duck() drops the gain to 30% and restore() brings it back', () => {
    const ctx = mockAudioContext();
    const graph = createEchoGraph(ctx, {}, { delaySeconds: 2, volumePercent: 70 });
    const gain = ctx.created.find((n) => n.kind === 'gain');
    const base = 0.7 * GAIN_CAP;
    graph.duck();
    assert.equal(graph.ducked, true);
    assert.ok(Math.abs(gain.gain.value - base * 0.3) < 1e-9);
    graph.duck(); // second duck is a no-op
    assert.ok(Math.abs(gain.gain.value - base * 0.3) < 1e-9);
    graph.restore();
    assert.equal(graph.ducked, false);
    assert.ok(Math.abs(gain.gain.value - base) < 1e-9);
  });
  it('setVolume while ducked keeps the ducked level', () => {
    const ctx = mockAudioContext();
    const graph = createEchoGraph(ctx, {}, { delaySeconds: 2, volumePercent: 70 });
    const gain = ctx.created.find((n) => n.kind === 'gain');
    graph.duck();
    graph.setVolume(100);
    assert.ok(Math.abs(gain.gain.value - GAIN_CAP * 0.3) < 1e-9);
    assert.equal(graph.baseGain, GAIN_CAP);
  });
  it('disconnect() does not throw', () => {
    const ctx = mockAudioContext();
    const graph = createEchoGraph(ctx, {}, {});
    assert.doesNotThrow(() => graph.disconnect());
  });
});

describe('micConstraints', () => {
  it('requests raw room audio: no echo cancellation, no noise suppression', () => {
    const c = micConstraints();
    assert.equal(c.audio.echoCancellation, false);
    assert.equal(c.audio.noiseSuppression, false);
    assert.equal(c.audio.autoGainControl, false);
    assert.equal(c.video, false);
  });
});
