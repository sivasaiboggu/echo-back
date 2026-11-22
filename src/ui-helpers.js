// Delay ruler and session copy shared by the UI and its unit tests.
import { DELAY_DEFAULT, clampDelay } from './audio-engine.js';

export function trailProgress({ state, nowMs, primeStartMs, echoAtMs, delaySeconds }) {
  const duration = clampDelay(delaySeconds ?? DELAY_DEFAULT) * 1000;
  if (state === 'listening' && primeStartMs != null) {
    return Math.min(1, Math.max(0, (nowMs - primeStartMs) / duration));
  }
  if (state === 'echoing' && echoAtMs != null && nowMs >= echoAtMs) {
    return ((nowMs - echoAtMs) % duration) / duration;
  }
  return 0;
}

export function primeRemainingSeconds({ state, nowMs, echoAtMs }) {
  if (state !== 'listening' || echoAtMs == null) return 0;
  return Math.max(0, (echoAtMs - nowMs) / 1000);
}

// Half-second marks fall at their actual times, even if the final
// interval is shorter than half a second. The view adds the endpoints.
export function tickPositions(delaySeconds) {
  const delay = clampDelay(delaySeconds ?? DELAY_DEFAULT);
  const positions = [];
  for (let mark = .5; mark < delay; mark += .5) positions.push(mark / delay);
  return positions;
}

export function narrationFor({ state, delaySeconds, primeRemaining, error, demo }) {
  switch (state) {
    case 'requesting':
      return 'Allow microphone access when your browser asks.';
    case 'listening':
      return `First echo in ${Math.max(0, primeRemaining ?? 0).toFixed(1)} s.`;
    case 'echoing':
      return `Playing back ${clampDelay(delaySeconds ?? DELAY_DEFAULT).toFixed(1)} seconds late.`;
    case 'error':
      return error || 'Check microphone access and try again.';
    default:
      return demo ? 'Start echo to see the delay with demo audio.' : 'Start echo, then allow microphone access.';
  }
}
