// EchoBack — unit tests for the pure UI helpers (src/ui-helpers.js).
// Run: npm test  (node --test tests/*.test.js)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  trailProgress,
  primeRemainingSeconds,
  delayCaption,
  narrationFor,
  primingRingOffset,
  tickPositions,
  litTicks,
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

// --- delay caption ---------------------------------------------------------
describe('delayCaption', () => {
  it('names what each delay feels like, in plain words', () => {
    assert.match(delayCaption(0.5), /quick double/);
    assert.match(delayCaption(2.0), /throw anyone off/);
    assert.match(delayCaption(3.0), /talk over/);
    assert.match(delayCaption(99), /talk over/); // clamps to 3.0
  });
});

// --- priming ring ----------------------------------------------------------
describe('primingRingOffset', () => {
  it('is 1 (empty ring) at 0 progress and 0 (full ring) at 1', () => {
    assert.equal(primingRingOffset(0), 1);
    assert.equal(primingRingOffset(0.5), 0.5);
    assert.equal(primingRingOffset(1), 0);
  });

  it('clamps outside 0..1', () => {
    assert.equal(primingRingOffset(-2), 1);
    assert.equal(primingRingOffset(9), 0);
    assert.equal(primingRingOffset(undefined), 1);
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

  it('clamps to the delay range', () => {
    assert.deepEqual(tickPositions(99), tickPositions(3.0));
    assert.deepEqual(tickPositions(0.1), tickPositions(0.5));
  });
});

describe('litTicks', () => {
  it('lights ticks the pulse has passed, in order', () => {
    const pos = [0.25, 0.5, 0.75];
    assert.deepEqual(litTicks(pos, 0), [false, false, false]);
    assert.deepEqual(litTicks(pos, 0.3), [true, false, false]);
    assert.deepEqual(litTicks(pos, 0.5), [true, true, false]);
    assert.deepEqual(litTicks(pos, 1), [true, true, true]);
  });

  it('clamps progress outside 0..1', () => {
    assert.deepEqual(litTicks([0.5], -1), [false]);
    assert.deepEqual(litTicks([0.5], 9), [true]);
    assert.deepEqual(litTicks([0.5], undefined), [false]);
  });
});

// --- status narration ------------------------------------------------------
describe('narrationFor', () => {
  it('tells the story for every state', () => {
    assert.match(narrationFor({ state: 'idle', delaySeconds: 2 }).headline, /Quiet room/);
    assert.match(narrationFor({ state: 'idle', delaySeconds: 2 }).sub, /Start echo/);
    assert.match(narrationFor({ state: 'requesting' }).headline, /microphone/);
    assert.match(narrationFor({ state: 'listening', primeRemaining: 1.4 }).headline, /Listening/);
    assert.match(narrationFor({ state: 'listening', primeRemaining: 1.4 }).sub, /1\.4s/);
    assert.match(narrationFor({ state: 'echoing', delaySeconds: 2 }).headline, /2\.0s late/);
    assert.match(narrationFor({ state: 'echoing', delaySeconds: 2 }).sub, /2\.0 seconds later/);
    assert.match(
      narrationFor({ state: 'echoing', delaySeconds: 2, ducked: true }).headline,
      /turned down/,
    );
    assert.match(
      narrationFor({ state: 'error', error: 'Microphone permission denied.' }).sub,
      /denied/,
    );
  });
});
