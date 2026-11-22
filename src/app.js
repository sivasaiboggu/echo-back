// EchoBack — UI wiring. No audio is recorded, stored, or transmitted.
// The live path is mic -> delay -> speaker only. `?demo=1` runs a clearly
// labelled simulation (animated levels, no mic) so the echoing UI can be
// previewed without a microphone.
//
// The interface tells the story of the delay: violet is the sound the mic
// hears NOW, coral is the echo coming back LATE, and the delay-trail pulse
// shows a packet of sound travelling the tunnel between them.

import {
  DELAY_DEFAULT,
  VOLUME_DEFAULT,
  clampDelay,
  formatTimer,
  rmsFromTimeDomain,
  peakFromTimeDomain,
  EchoState,
  FeedbackGuard,
  createEchoGraph,
  micConstraints,
} from './audio-engine.js';
import {
  trailProgress,
  primeRemainingSeconds,
  delayCaption,
  narrationFor,
  primingRingOffset,
  tickPositions,
  litTicks,
} from './ui-helpers.js';

const $ = (id) => document.getElementById(id);

const els = {
  startBtn: $('startBtn'),
  startLabel: $('startLabel'),
  orbSub: document.querySelector('.orb-sub'),
  statusPill: $('statusPill'),
  timer: $('sessionTimer'),
  delaySlider: $('delaySlider'),
  delayValue: $('delayValue'),
  delayHint: $('delayHint'),
  volumeSlider: $('volumeSlider'),
  volumeValue: $('volumeValue'),
  meter: $('meter'),
  meterFill: $('meterFill'),
  meterLabel: $('meterLabel'),
  inWave: $('inWaveCanvas'),
  wave: $('waveCanvas'),
  echoLabel: $('echoLabel'),
  echoLate: $('echoLate'),
  trailTime: $('trailTime'),
  tunnelCaption: $('tunnelCaption'),
  tunnelFill: $('tunnelFill'),
  tunnelTicks: $('tunnelTicks'),
  tunnelPulse: $('tunnelPulse'),
  themeToggle: $('themeToggle'),
  orbRingSvg: $('orbRingSvg'),
  orbRing: $('orbRing'),
  narrateHead: $('narrateHead'),
  narrateSub: $('narrateSub'),
  warn: $('feedbackWarn'),
  warnText: $('feedbackWarnText'),
  notice: $('notice'),
  demoBadge: $('demoBadge'),
};

const params = new URLSearchParams(window.location.search);
const DEMO = params.get('demo') === '1';

const state = new EchoState();
const guard = new FeedbackGuard();

let audioCtx = null;
let stream = null;
let graph = null;
let rafId = null;
let timerId = null;
let startedAt = null;
let echoAt = null;
let primeStart = null;
let ducked = false;

const inCtx = els.inWave.getContext('2d');
const outCtx = els.wave.getContext('2d');
const inputData = new Uint8Array(2048);
const outputData = new Uint8Array(2048);

// Canvas colours come from the CSS tokens, so the waveforms follow the
// theme. Hex/rgba only — canvas does not take the OKLCH token values.
let palette = {
  live: '#8b7cff', echo: '#ff6a3d',
  ghostLive: 'rgba(139, 124, 255, 0.4)', ghostEcho: 'rgba(255, 106, 61, 0.35)',
  flatLive: 'rgba(139, 124, 255, 0.35)', flatEcho: 'rgba(255, 106, 61, 0.35)',
};

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function readPalette() {
  const next = {
    live: cssVar('--wave-live'),
    echo: cssVar('--wave-echo'),
    ghostLive: cssVar('--ghost-live'),
    ghostEcho: cssVar('--ghost-echo'),
    flatLive: cssVar('--flat-live'),
    flatEcho: cssVar('--flat-echo'),
  };
  for (const [key, value] of Object.entries(next)) {
    if (value) palette[key] = value;
  }
}

// Dark is the default (a night-time tool, used in public); ?theme=light
// previews the light theme, and the header button switches for the session.
function applyTheme(name) {
  document.documentElement.dataset.theme = name;
  els.themeToggle.textContent = name === 'light' ? 'Dark' : 'Light';
  els.themeToggle.setAttribute(
    'aria-label',
    name === 'light' ? 'Switch to dark theme' : 'Switch to light theme',
  );
  readPalette();
}

function currentDelay() {
  return clampDelay(els.delaySlider.value);
}

function updateNarration() {
  const prime = primeRemainingSeconds({ state: state.state, nowMs: performance.now(), echoAtMs: echoAt });
  const { headline, sub } = narrationFor({
    state: state.state,
    delaySeconds: currentDelay(),
    ducked,
    primeRemaining: prime,
    error: state.error,
  });
  els.narrateHead.textContent = headline;
  els.narrateSub.textContent = sub;
  document.body.dataset.state = state.state;
}

function setStatus(text, kind) {
  els.statusPill.textContent = text;
  els.statusPill.dataset.kind = kind;
}

function showNotice(message, kind = 'info') {
  els.notice.hidden = false;
  els.notice.textContent = message;
  els.notice.dataset.kind = kind;
}

function hideNotice() {
  els.notice.hidden = true;
}

function setRunning(running) {
  els.startBtn.classList.toggle('running', running);
  els.startLabel.textContent = running ? 'Stop echo' : 'Start echo';
  if (els.orbSub) els.orbSub.textContent = running ? 'tap to stop' : 'tap to begin';
  els.startBtn.setAttribute('aria-pressed', String(running));
  els.delaySlider.disabled = false; // delay stays adjustable while echoing
  els.volumeSlider.disabled = false;
}

function setSliderFill(slider) {
  const min = Number(slider.min);
  const max = Number(slider.max);
  const pct = ((Number(slider.value) - min) / (max - min)) * 100;
  slider.style.setProperty('--fill', `${pct}%`);
}

function renderMeter(level, peak) {
  const pct = Math.round(Math.min(1, level) * 100);
  els.meterFill.style.width = `${pct}%`;
  els.meterFill.dataset.hot = peak >= 0.98 ? 'true' : 'false';
  els.meter.setAttribute('aria-valuenow', String(pct));
  els.meterLabel.textContent =
    state.state === 'idle' ? 'Mic idle' : peak >= 0.98 ? 'Input pinned — very loud' : `Input level ${pct}%`;
}

function drawWaveOn(ctx, canvas, data, stroke, idlePhase) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.lineWidth = 2 * (window.devicePixelRatio || 1);
  ctx.strokeStyle = stroke;
  ctx.beginPath();
  if (idlePhase != null) {
    // Gentle ghost wave while idle — the room is quiet, the app is waiting.
    for (let x = 0; x < w; x++) {
      const env = Math.sin((x / w) * Math.PI); // swell in the middle
      const y = h / 2 + Math.sin(x / 26 + idlePhase) * (h / 2 - 6) * 0.18 * env;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  } else {
    const step = Math.max(1, Math.floor(data.length / w));
    for (let x = 0; x < w; x++) {
      const v = (data[x * step] - 128) / 128;
      const y = h / 2 + v * (h / 2 - 4);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

function drawFlat(ctx, canvas, stroke) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 2 * (window.devicePixelRatio || 1);
  ctx.strokeStyle = stroke;
  ctx.beginPath();
  ctx.moveTo(0, canvas.height / 2);
  ctx.lineTo(canvas.width, canvas.height / 2);
  ctx.stroke();
}

function fitCanvas() {
  for (const [canvas] of [[els.inWave], [els.wave]]) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
  }
}

let tickPos = [];

function renderTicks() {
  tickPos = tickPositions(currentDelay());
  els.tunnelTicks.replaceChildren(...tickPos.map((p) => {
    const tick = document.createElement('span');
    tick.className = 'tunnel-tick';
    tick.style.left = `${p * 100}%`;
    return tick;
  }));
}

function renderTunnel(now) {
  const progress = trailProgress({
    state: state.state,
    nowMs: now,
    primeStartMs: primeStart,
    echoAtMs: echoAt,
    delaySeconds: currentDelay(),
  });
  const active = state.state === 'listening' || state.state === 'echoing';
  els.tunnelPulse.classList.toggle('on', active);
  els.tunnelPulse.style.left = `${progress * 100}%`;
  els.tunnelFill.style.width = state.state === 'echoing' ? '100%' : `${progress * 100}%`;
  // The ruler ticks light up as the pulse passes them — violet while the
  // delay primes, coral once the echo is looping.
  const lit = litTicks(tickPos, active ? progress : 0);
  [...els.tunnelTicks.children].forEach((tick, i) => {
    tick.classList.toggle('lit-live', state.state === 'listening' && lit[i]);
    tick.classList.toggle('lit-echo', state.state === 'echoing' && lit[i]);
  });
  // The ring around the start button is the same progress, made useful:
  // it fills while the delay primes and stays full while echoing.
  if (state.state === 'listening') {
    els.orbRingSvg.dataset.mode = 'listening';
    els.orbRingSvg.classList.add('on');
    els.orbRing.style.strokeDashoffset = String(primingRingOffset(progress) * 100);
  } else if (state.state === 'echoing') {
    els.orbRingSvg.dataset.mode = 'echoing';
    els.orbRingSvg.classList.add('on');
    els.orbRing.style.strokeDashoffset = '0';
  } else {
    els.orbRingSvg.classList.remove('on');
  }
  els.echoLabel.textContent =
    state.state === 'idle' ? 'Speaker idle'
    : state.state === 'listening' ? 'Waiting'
    : state.state === 'echoing' ? 'Live'
    : 'Speaker idle';
}

// Demo simulation: a loud "reel" that swells and dips, so the meter,
// waveforms, and echo state can be seen without a mic.
function demoSample(t) {
  const env = 0.55 + 0.4 * Math.sin(t / 900) * Math.sin(t / 3100);
  for (let i = 0; i < outputData.length; i++) {
    const s = Math.sin(i / 9 + t / 90) * 0.55 + Math.sin(i / 3.1 - t / 47) * 0.3;
    outputData[i] = 128 + Math.round(s * 127 * Math.max(0.05, env));
    inputData[i] = outputData[i];
  }
  return { rms: rmsFromTimeDomain(inputData), peak: peakFromTimeDomain(inputData) };
}

function tick() {
  const now = performance.now();
  if (state.state === 'idle' || state.state === 'error') {
    renderMeter(0, 0);
    const phase = now / 1400;
    drawWaveOn(inCtx, els.inWave, null, palette.ghostLive, phase);
    drawWaveOn(outCtx, els.wave, null, palette.ghostEcho, phase + 1.2);
    renderTunnel(now);
    rafId = requestAnimationFrame(tick);
    return;
  }
  if (DEMO) {
    const { rms, peak } = demoSample(now);
    renderMeter(rms, peak);
    drawWaveOn(inCtx, els.inWave, inputData, palette.live);
    drawWaveOn(outCtx, els.wave, outputData, palette.echo);
    if (state.state === 'listening' && echoAt && now >= echoAt) {
      state.go('echoing');
      setStatus('Echoing', 'echoing');
    }
    if (state.state === 'echoing') setStatus('Echoing', 'echoing');
  } else if (graph) {
    graph.inputAnalyser.getByteTimeDomainData(inputData);
    graph.outputAnalyser.getByteTimeDomainData(outputData);
    const rms = rmsFromTimeDomain(inputData);
    const peak = peakFromTimeDomain(inputData);
    renderMeter(rms, peak);
    drawWaveOn(inCtx, els.inWave, inputData, palette.live);
    drawWaveOn(outCtx, els.wave, outputData, palette.echo);
    const action = guard.update(peak, now);
    if (action === 'duck') {
      ducked = true;
      graph.duck();
      els.warn.hidden = false;
      els.warnText.textContent =
        'Input is pinned at max, so the output was turned down. Lower the volume or point the speaker away from the mic.';
    } else if (action === 'restore') {
      ducked = false;
      graph.restore();
      els.warn.hidden = true;
    }
    if (state.state === 'listening' && echoAt && now >= echoAt) {
      state.go('echoing');
      setStatus('Echoing', 'echoing');
    }
    if (state.state === 'echoing') setStatus('Echoing', 'echoing');
  }
  renderTunnel(now);
  updateNarration();
  rafId = requestAnimationFrame(tick);
}

function startTimer() {
  startedAt = Date.now();
  els.timer.textContent = '00:00';
  timerId = setInterval(() => {
    els.timer.textContent = formatTimer((Date.now() - startedAt) / 1000);
  }, 500);
}

function stopTimer() {
  if (timerId) clearInterval(timerId);
  timerId = null;
}

function beginListening() {
  state.go('listening');
  setStatus('Listening', 'listening');
  primeStart = performance.now();
  echoAt = performance.now() + currentDelay() * 1000;
  updateNarration();
  fitCanvas();
  if (!rafId) tick(); // the loop is already running from init; don't double it
}

async function start() {
  hideNotice();
  els.warn.hidden = true;
  ducked = false;
  if (!state.go('requesting')) return;
  setStatus('Requesting microphone…', 'busy');
  updateNarration();
  setRunning(true);
  startTimer();

  if (DEMO) {
    beginListening();
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    state.fail('This browser cannot access a microphone.');
    showNotice('Your browser cannot access a microphone. Open EchoBack in a modern mobile browser (Chrome or Safari) and allow mic access.', 'error');
    setStatus('Microphone unavailable', 'error');
    setRunning(false);
    stopTimer();
    updateNarration();
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia(micConstraints());
    if (state.state !== 'requesting') {
      // Tapped Stop while the permission prompt was open: the mic arrived
      // after the user already walked away. Drop the stream, stay stopped.
      stopTracks();
      return;
    }
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    graph = createEchoGraph(audioCtx, stream, {
      delaySeconds: Number(els.delaySlider.value),
      volumePercent: Number(els.volumeSlider.value),
    });
    beginListening();
  } catch (err) {
    if (state.state !== 'requesting') {
      // Same walk-away: a denied prompt after Stop must not flip the
      // stopped UI into an error state.
      stopTracks();
      return;
    }
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    state.fail(denied ? 'Microphone permission denied.' : 'Microphone unavailable.');
    showNotice(
      denied
        ? 'Microphone permission was denied. Allow mic access in your browser settings, then tap Start echo again.'
        : 'Could not open the microphone. Check another app is not using it, then try again.',
      'error',
    );
    setStatus('Microphone unavailable', 'error');
    setRunning(false);
    stopTimer();
    stopTracks();
    updateNarration();
  }
}

function stopTracks() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (graph) {
    graph.disconnect();
    graph = null;
  }
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
}

function stop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  stopTimer();
  stopTracks();
  state.reset();
  ducked = false;
  echoAt = null;
  primeStart = null;
  setStatus('Idle', 'idle');
  setRunning(false);
  renderMeter(0, 0);
  renderTunnel(performance.now());
  drawFlat(inCtx, els.inWave, palette.flatLive);
  drawFlat(outCtx, els.wave, palette.flatEcho);
  els.timer.textContent = '00:00';
  els.warn.hidden = true;
  updateNarration();
  tick(); // keep the idle ghost wave breathing
}

function syncDelayUI() {
  const v = currentDelay();
  els.delayValue.textContent = `${v.toFixed(1)}s`;
  els.trailTime.textContent = `${v.toFixed(1)}s late`;
  els.echoLate.textContent = `${v.toFixed(1)}s`;
  els.tunnelCaption.textContent =
    `Sound travels the delay line — what the mic hears now reaches the speaker ${v.toFixed(1)} seconds later.`;
  els.delayHint.textContent = `${delayCaption(v)} Adjustable while echoing.`;
  setSliderFill(els.delaySlider);
  renderTicks();
}

els.startBtn.addEventListener('click', () => {
  if (state.state === 'idle' || state.state === 'error') start();
  else stop();
});

els.delaySlider.addEventListener('input', () => {
  syncDelayUI();
  const v = currentDelay();
  if (graph) graph.setDelay(v);
  if (state.state === 'listening' || state.state === 'echoing') {
    echoAt = performance.now() + v * 1000;
  }
  updateNarration();
});

els.volumeSlider.addEventListener('input', () => {
  const v = Math.round(Number(els.volumeSlider.value));
  els.volumeValue.textContent = `${v}%`;
  setSliderFill(els.volumeSlider);
  if (graph) graph.setVolume(v);
});

// Initial paint.
const themeParam = params.get('theme');
applyTheme(themeParam === 'light' ? 'light' : 'dark');
els.themeToggle.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
});
els.delaySlider.value = String(DELAY_DEFAULT);
els.volumeSlider.value = String(VOLUME_DEFAULT);
els.volumeValue.textContent = `${VOLUME_DEFAULT}%`;
syncDelayUI();
setSliderFill(els.volumeSlider);
setStatus('Idle', 'idle');
renderMeter(0, 0);
updateNarration();
fitCanvas();
window.addEventListener('resize', fitCanvas);
tick(); // idle ghost wave + tunnel at rest
if (DEMO) {
  els.demoBadge.hidden = false;
  showNotice('Demo mode — simulated audio, no microphone in use. On a real phone, tap Start echo and allow mic access.', 'info');
  if (params.get('autostart') === '1') start();
}

// Layout-check hook for tests/layout.test.js: ?layoutcheck=1 writes a
// report into the DOM describing viewport width and horizontal overflow.
if (params.get('layoutcheck') === '1') {
  const report = () => {
    const vw = document.documentElement.clientWidth;
    const offenders = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > vw + 1 || r.right > vw + 1 || r.left < -1) {
        offenders.push(`${el.tagName}.${String(el.className).split(' ')[0]} w=${Math.round(r.width)} right=${Math.round(r.right)}`);
      }
    }
    const pre = document.createElement('pre');
    pre.id = 'layout-check';
    pre.style.display = 'none';
    pre.textContent = JSON.stringify({ vw, overflow: offenders.length > 0, offenders: offenders.slice(0, 10) });
    document.body.appendChild(pre);
  };
  window.addEventListener('load', () => setTimeout(report, 400));
  setTimeout(report, 1500);
}
