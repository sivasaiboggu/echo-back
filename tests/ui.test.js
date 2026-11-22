// EchoBack — unit tests for the pure UI helpers (src/ui-helpers.js).
// Run: npm test  (node --test tests/*.test.js)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  trailProgress,
  primeRemainingSeconds,
  narrationFor,
  tickPositions,
} from '../src/ui-helpers.js';

// --- delay-trail pulse -----------------------------------------------------
describe('trailProgress', () => {
  it('is 0 when idle or in error', () => {
    assert.equal(trailProgress({ state: 'idle', nowMs: 5000, delaySeconds: 2 }), 0);
    assert.equal(trailProgress({ state: 'error', nowMs: 5000, delaySeconds: 2 }), 0);
  });

  it('fills 0 -> 1 over the delay while priming', () => {
    const base = { state: 'listening', primeStartMs: 1000, delaySeconds: 2 };
    assert.equal(trailProgress({ ...base, nowMs: 1000 }), 0);
    assert.equal(trailProgress({ ...base, nowMs: 2000 }), 0.5);
    assert.equal(trailProgress({ ...base, nowMs: 3000 }), 1);
    assert.equal(trailProgress({ ...base, nowMs: 9000 }), 1); // clamps at 1
  });

  it('loops 0 -> 1 every delay while echoing', () => {
    const base = { state: 'echoing', echoAtMs: 5000, delaySeconds: 2 };
    assert.equal(trailProgress({ ...base, nowMs: 5000 }), 0);
    assert.equal(trailProgress({ ...base, nowMs: 6000 }), 0.5);
    assert.equal(trailProgress({ ...base, nowMs: 7000 }), 0); // wraps
    assert.equal(trailProgress({ ...base, nowMs: 7500 }), 0.25);
  });

  it('is 0 before the first echo time', () => {
    assert.equal(
      trailProgress({ state: 'echoing', echoAtMs: 5000, nowMs: 4000, delaySeconds: 2 }),
      0,
    );
  });
});

// --- priming countdown -----------------------------------------------------
describe('primeRemainingSeconds', () => {
  it('counts down to the first echo while listening', () => {
    assert.equal(
      primeRemainingSeconds({ state: 'listening', nowMs: 1000, echoAtMs: 3000 }),
      2,
    );
    assert.equal(
      primeRemainingSeconds({ state: 'listening', nowMs: 2900, echoAtMs: 3000 }),
      0.1,
    );
  });

  it('is 0 outside listening', () => {
    assert.equal(primeRemainingSeconds({ state: 'echoing', nowMs: 1000, echoAtMs: 3000 }), 0);
    assert.equal(primeRemainingSeconds({ state: 'idle', nowMs: 1000, echoAtMs: null }), 0);
  });
});

// --- delay ruler -----------------------------------------------------------
describe('tickPositions', () => {
  it('places one tick every 0.5s, strictly inside the rail', () => {
    assert.deepEqual(tickPositions(0.5), []);
    assert.deepEqual(tickPositions(1.0), [0.5]);
    assert.deepEqual(tickPositions(2.0), [0.25, 0.5, 0.75]);
    assert.deepEqual(tickPositions(3.0), [1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6]);
  });

  it('keeps half-second ticks at their exact times for fractional delays', () => {
    assert.deepEqual(tickPositions(0.6), [0.5 / 0.6]);
    assert.deepEqual(tickPositions(2.3), [0.5 / 2.3, 1 / 2.3, 1.5 / 2.3, 2 / 2.3]);
  });

  it('clamps to the delay range', () => {
    assert.deepEqual(tickPositions(99), tickPositions(3.0));
    assert.deepEqual(tickPositions(0.1), tickPositions(0.5));
  });
});

describe('narrationFor', () => {
  it('gives the next step when idle or waiting for permission', () => {
    assert.match(narrationFor({ state: 'idle' }), /Start echo, then allow microphone/);
    assert.match(narrationFor({ state: 'idle', demo: true }), /demo audio/);
    assert.match(narrationFor({ state: 'requesting' }), /browser asks/);
  });

  it('reports the countdown and selected delay', () => {
    assert.match(narrationFor({ state: 'listening', primeRemaining: 1.4 }), /1\.4 s/);
    assert.match(narrationFor({ state: 'echoing', delaySeconds: 2 }), /2\.0 seconds late/);
  });

  it('provides a fallback when the browser gives no explanation', () => {
    assert.match(narrationFor({ state: 'error' }), /try again/);
    assert.equal(narrationFor({ state: 'error', error: 'Mic permission denied.' }), 'Mic permission denied.');
  });
});
