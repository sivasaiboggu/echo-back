// EchoBack — pure UI helpers (no DOM, no audio). Unit-tested in
// tests/ui.test.js. These describe what the interface should say and
// where the delay-trail pulse should sit; app.js does the drawing.

import { DELAY_DEFAULT, clampDelay } from './audio-engine.js';

/**
 * Where the delay-trail pulse sits, 0..1 along the tunnel.
 * - idle / error: 0 (no sound travelling).
 * - listening (priming): fills 0 -> 1 over the delay, until the first
 *   echo emerges. `primeStartMs` is when the mic opened.
 * - echoing: loops 0 -> 1 every `delaySeconds`, one pulse per echo.
 */
export function trailProgress({ state, nowMs, primeStartMs, echoAtMs, delaySeconds }) {
  const delay = clampDelay(delaySeconds ?? DELAY_DEFAULT);
  if (state === 'listening' && primeStartMs != null) {
    const elapsed = nowMs - primeStartMs;
    return Math.min(1, Math.max(0, elapsed / (delay * 1000)));
  }
  if (state === 'echoing' && echoAtMs != null) {
    const since = nowMs - echoAtMs;
    if (since < 0) return 0;
    return (since % (delay * 1000)) / (delay * 1000);
  }
  return 0;
}

/** Seconds until the first echo emerges while priming (0 once echoing). */
export function primeRemainingSeconds({ state, nowMs, echoAtMs }) {
  if (state !== 'listening' || echoAtMs == null) return 0;
  return Math.max(0, (echoAtMs - nowMs) / 1000);
}

/** Plain-words caption for a delay value — what that delay feels like. */
export function delayCaption(seconds) {
  const v = clampDelay(seconds);
  if (v < 1) return 'A quick double — easy to miss.';
  if (v <= 2.5) return 'Enough to throw anyone off.';
  return 'Hard to talk over — use with care.';
}

/**
 * Ring offset for the start button, 0..1. While the delay primes the ring
 * fills 0 -> 1; once echoing it stays full. `progress` is trailProgress().
 */
export function primingRingOffset(progress) {
  const p = Math.min(1, Math.max(0, progress ?? 0));
  return 1 - p;
}

/**
 * What the app is doing right now, in plain words.
 * Returns { headline, sub } — the status story shown under the orb.
 */
export function narrationFor({ state, delaySeconds, ducked, primeRemaining, error }) {
  const delay = clampDelay(delaySeconds ?? DELAY_DEFAULT).toFixed(1);
  switch (state) {
    case 'requesting':
      return {
        headline: 'Asking for the microphone…',
        sub: 'Allow mic access when your browser asks.',
      };
    case 'listening':
      return {
        headline: 'Listening.',
        sub: `First echo in ${Math.max(0, primeRemaining ?? 0).toFixed(1)}s.`,
      };
    case 'echoing':
      return ducked
        ? {
            headline: 'Echoing — volume turned down.',
            sub: 'Input is pinned at max. Lower the volume or point the speaker away from the mic.',
          }
        : {
            headline: `Echoing — their audio, ${delay}s late.`,
            sub: `What the mic hears now comes back ${delay} seconds later.`,
          };
    case 'error':
      return {
        headline: 'Microphone unavailable.',
        sub: error || 'Check mic access and try again.',
      };
    case 'idle':
    default:
      return {
        headline: 'Quiet room. Ready when you are.',
        sub: `Tap Start echo. The first echo lands ${delay}s after the mic opens.`,
      };
  }
}
