import {
  DELAY_DEFAULT,
  FEEDBACK_PEAK,
  VOLUME_DEFAULT,
  clampDelay,
  createEchoGraph,
  EchoState,
  FeedbackGuard,
  formatTimer,
  micConstraints,
  peakFromTimeDomain,
  rmsFromTimeDomain,
} from './audio-engine.js';
import { narrationFor, tickPositions, trailProgress, primeRemainingSeconds } from './ui-helpers.js';

const byId = (id) => document.getElementById(id);
const startButton = byId('startBtn');
const delaySlider = byId('delaySlider');
const volumeSlider = byId('volumeSlider');
const status = byId('sessionStatus');
const note = byId('sessionNote');
const timer = byId('sessionTimer');
const warning = byId('feedbackWarn');
const meter = byId('meter');
const meterFill = byId('meterFill');
const meterLabel = byId('meterLabel');
const speakerStatus = byId('speakerStatus');
const rulerFill = byId('rulerFill');
const rulerMarker = byId('rulerMarker');
const rulerTrack = rulerMarker.parentElement;
const rulerTicks = byId('rulerTicks');
const rulerLabels = byId('rulerLabels');
const inputTrace = makeTrace('inWaveCanvas');
const outputTrace = makeTrace('outWaveCanvas');
const mediaMotion = matchMedia('(prefers-reduced-motion: reduce)');
const forcedColors = matchMedia('(forced-colors: active)');
const params = new URLSearchParams(location.search);
const demo = params.get('demo') === '1';
const state = new EchoState();

let palette;
let session = null;
let frame = 0;
let rulerWidth = 0;
let tickElements = [];
let lastDraw = -Infinity;

const delaySeconds = () => clampDelay(delaySlider.value);
const seconds = (value) => `${value.toFixed(1)} s`;
const micActive = () => state.state === 'listening' || state.state === 'echoing';
const statusLabels = {
  idle: 'Ready',
  requesting: 'Allow mic access',
  listening: 'Listening',
  echoing: 'Echoing',
  error: 'Mic unavailable',
};

function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

function makeTrace(id) {
  const canvas = byId(id);
  return { canvas, context: canvas.getContext('2d'), samples: new Uint8Array(2048) };
}

function syncTheme() {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const color = (role) => style.getPropertyValue(`--${role}`).trim();
  palette = { grid: color('line'), trace: color('trace'), accent: color('accent') };
  if (forcedColors.matches) palette = { grid: 'ButtonBorder', trace: 'CanvasText', accent: 'Highlight' };
  if (inputTrace.scale) drawTraces();
}

function fitTraces() {
  const ratio = Math.min(devicePixelRatio || 1, 2);
  let resized = false;
  for (const trace of [inputTrace, outputTrace]) {
    const { canvas } = trace;
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (trace.scale === ratio && canvas.width === width && canvas.height === height) continue;
    canvas.width = width;
    canvas.height = height;
    trace.scale = ratio;
    resized = true;
  }
  rulerWidth = rulerTrack.clientWidth;
  if (resized) drawTraces();
}

function drawTrace(trace, active, stroke) {
  const { canvas, context, samples, scale } = trace;
  if (!context) return;
  const { width, height } = canvas;
  const mid = height / 2;
  context.clearRect(0, 0, width, height);

  context.strokeStyle = palette.grid;
  context.lineWidth = scale;
  context.beginPath();
  for (let i = 0; i <= 16; i++) {
    const x = Math.min(width - .5, Math.floor(i * width / 16) + .5);
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }
  for (let i = 0; i <= 4; i++) {
    const y = Math.min(height - .5, Math.floor(i * height / 4) + .5);
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.stroke();

  context.strokeStyle = active ? stroke : palette.trace;
  context.lineWidth = scale * (active ? 1.5 : 1);
  context.beginPath();
  if (!active || mediaMotion.matches) {
    context.moveTo(0, mid);
    context.lineTo(width, mid);
  } else {
    const points = Math.min(width, samples.length);
    for (let i = 0; i < points; i++) {
      const x = i * width / Math.max(1, points - 1);
      const sample = samples[Math.floor(i * samples.length / points)];
      const y = mid - ((sample - 128) / 128) * mid * .9;
      if (i === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
  }
  context.stroke();
}

function speakerAudible() {
  return state.state === 'echoing' && Number(volumeSlider.value) > 0;
}

function drawTraces() {
  drawTrace(inputTrace, micActive(), palette.trace);
  drawTrace(outputTrace, speakerAudible(), palette.accent);
}

function renderMeter(rms = 0, peak = 0) {
  const percent = Math.round(rms * 100);
  meterFill.style.transform = `scaleX(${rms})`;
  meterFill.toggleAttribute('data-hot', peak >= FEEDBACK_PEAK);
  const value = String(percent);
  if (meter.getAttribute('aria-valuenow') !== value) meter.setAttribute('aria-valuenow', value);
  setText(meterLabel, micActive() ? (peak >= FEEDBACK_PEAK ? 'Peak' : `${percent}%`) : 'Off');
}

function renderRuler(progress = 0) {
  const active = micActive();
  const echoing = state.state === 'echoing';
  const steady = echoing && mediaMotion.matches;
  rulerMarker.hidden = !active;
  rulerMarker.style.transform = `translateX(${progress * Math.max(0, rulerWidth - 4)}px)`;
  rulerFill.style.transform = `scaleX(${echoing ? 1 : progress})`;
  for (const { element, fraction } of tickElements) {
    element.toggleAttribute('data-passed', active && (steady || progress >= fraction));
  }
}

function renderStatus(now = performance.now()) {
  const phase = state.state;
  document.body.dataset.state = phase;
  status.dataset.kind = phase;
  setText(status, statusLabels[phase]);
  startButton.toggleAttribute('data-active', Boolean(session));
  setText(byId('startLabel'), phase === 'requesting' ? 'Cancel' : session ? 'Stop echo' : 'Start echo');
  renderSpeaker();
  renderNote(now);
}

function renderNote(now) {
  const phase = state.state;
  setText(note, narrationFor({
    state: phase,
    delaySeconds: delaySeconds(),
    primeRemaining: primeRemainingSeconds({ state: phase, nowMs: now, echoAtMs: session?.echoAt }),
    error: state.error,
    demo,
  }));
}

function syncDelay() {
  const delay = delaySeconds();
  const text = seconds(delay);
  setText(byId('delayValue'), text);
  delaySlider.setAttribute('aria-valuetext', `${delay.toFixed(1)} seconds`);
  setText(byId('trailTime'), `${text} delay`);

  tickElements = [0, ...tickPositions(delay), 1].map((fraction) => {
    const element = document.createElement('span');
    element.className = 'ruler-tick';
    element.style.left = `${fraction * 100}%`;
    return { element, fraction };
  });
  rulerTicks.replaceChildren(...tickElements.map(({ element }) => element));

  // Only the ends and whole seconds are labelled so short intervals
  // stay legible on a phone. Intermediate half seconds still have ticks.
  const marks = [0];
  for (let mark = 1; mark <= delay - .35; mark++) marks.push(mark);
  marks.push(delay);
  rulerLabels.replaceChildren(...marks.map((mark, index) => {
    const label = document.createElement('span');
    label.className = 'ruler-label';
    if (index > 0 && index < marks.length - 1) label.style.left = `${mark / delay * 100}%`;
    label.textContent = mark === 0 ? '0 s' : `+${seconds(mark)}`;
    return label;
  }));

  if (micActive()) {
    session.graph?.setDelay(delay);
    const now = performance.now();
    if (state.state === 'listening') {
      session.primeStart = now;
      session.echoAt = now + delay * 1000;
    } else {
      session.echoAt = now;
    }
  }
  renderRuler();
  renderStatus();
}

function renderSpeaker() {
  const phase = state.state;
  setText(speakerStatus, phase === 'listening' ? 'Waiting' : phase === 'echoing'
    ? (speakerAudible() ? 'On' : 'Muted')
    : 'Off');
}

function syncVolume() {
  const value = Number(volumeSlider.value);
  setText(byId('volumeValue'), `${value}%`);
  volumeSlider.setAttribute('aria-valuetext', `${value} percent`);
  session?.graph?.setVolume(value);
  renderSpeaker();
  if (micActive()) drawTraces();
}

function sampleDemo(samples, time) {
  const phase = time * .00012;
  for (let i = 0; i < samples.length; i++) {
    const x = i / samples.length;
    const phrase = Math.sin(2 * Math.PI * (x * 2.2 - phase));
    const envelope = .14 + .73 * Math.max(0, phrase) ** 1.7;
    const carrier = .68 * Math.sin(i * .071 + phase * 20) + .28 * Math.sin(i * .23 - phase * 36);
    samples[i] = 128 + Math.round(127 * envelope * carrier);
  }
}

function animate(now) {
  const current = session;
  if (!current || !micActive()) return;
  const { graph, guard, primeStart, echoAt, startedAt } = current;
  if (state.state === 'listening' && now >= echoAt) {
    state.go('echoing');
    renderStatus(now);
  }
  const echoing = state.state === 'echoing';

  if (graph) {
    graph.inputAnalyser.getByteTimeDomainData(inputTrace.samples);
    const action = guard.update(peakFromTimeDomain(inputTrace.samples), now);
    if (action === 'duck') {
      graph.duck();
      setText(warning, 'Output volume lowered. Turn it down or point the speaker away from the mic.');
    } else if (action === 'restore') {
      graph.restore();
      setText(warning, '');
    }
  }

  // The display needs fewer updates than the feedback guard. Reduced
  // motion keeps the traces still and samples the numeric level once a second.
  if (now - lastDraw >= (mediaMotion.matches ? 1000 : 1000 / 30)) {
    if (demo) {
      sampleDemo(inputTrace.samples, now - startedAt);
      if (echoing) sampleDemo(outputTrace.samples, now - startedAt - delaySeconds() * 1000);
    } else if (echoing && !mediaMotion.matches) {
      graph.outputAnalyser.getByteTimeDomainData(outputTrace.samples);
    }
    renderMeter(rmsFromTimeDomain(inputTrace.samples), peakFromTimeDomain(inputTrace.samples));
    drawTraces();
    lastDraw = now;
  }

  if (!echoing) renderNote(now);
  renderRuler(trailProgress({
    state: state.state, nowMs: now, primeStartMs: primeStart, echoAtMs: echoAt, delaySeconds: delaySeconds(),
  }));
  setText(timer, formatTimer((now - startedAt) / 1000));
  frame = requestAnimationFrame(animate);
}

function beginListening(current) {
  current.startedAt = performance.now();
  current.primeStart = current.startedAt;
  current.echoAt = current.primeStart + delaySeconds() * 1000;
  state.go('listening');
  renderStatus();
  lastDraw = -Infinity;
  frame = requestAnimationFrame(animate);
}

function releaseSession() {
  const current = session;
  session = null;
  cancelAnimationFrame(frame);
  current?.graph?.disconnect();
  current?.stream?.getTracks().forEach((track) => track.stop());
  current?.context?.close().catch(() => {});
  setText(timer, '00:00');
  setText(warning, '');
}

function renderRest() {
  renderStatus();
  renderMeter();
  renderRuler();
  drawTraces();
}

function stop() {
  releaseSession();
  state.reset();
  renderRest();
}

function fail(message) {
  releaseSession();
  state.fail(message);
  renderRest();
}

async function start() {
  if (!state.go('requesting')) return;
  const current = { guard: new FeedbackGuard() };
  session = current;
  renderStatus();
  if (demo) {
    beginListening(current);
    return;
  }

  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!navigator.mediaDevices?.getUserMedia || !Audio) {
    fail(window.isSecureContext
      ? 'This browser cannot open the microphone. Try a current version of Chrome or Safari.'
      : 'Open EchoBack over HTTPS to use your microphone.');
    return;
  }

  try {
    current.context = new Audio();
    // Resume during the button gesture on mobile. Capture any rejection
    // while the browser permission prompt is still open.
    const resumed = current.context.resume().then(() => true, () => false);
    const stream = await navigator.mediaDevices.getUserMedia(micConstraints());
    if (session !== current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    current.stream = stream;
    const playing = await resumed;
    if (session !== current) return;
    if (!playing) throw new Error('Audio output unavailable');

    current.graph = createEchoGraph(current.context, stream, {
      delaySeconds: delaySeconds(),
      volumePercent: Number(volumeSlider.value),
    });
    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        if (session === current) fail('The microphone disconnected. Check it and start again.');
      }, { once: true });
    }
    beginListening(current);
  } catch (error) {
    if (session !== current) return;
    const denied = ['NotAllowedError', 'SecurityError'].includes(error.name);
    fail(denied
      ? 'Allow microphone access in your browser settings, then start again.'
      : 'Could not open the microphone. Check that it’s connected, then try again.');
  }
}

startButton.addEventListener('click', () => session ? stop() : start());
delaySlider.addEventListener('input', syncDelay);
volumeSlider.addEventListener('input', syncVolume);
document.addEventListener('themechange', syncTheme);
mediaMotion.addEventListener('change', drawTraces);
forcedColors.addEventListener('change', syncTheme);
window.addEventListener('pagehide', () => { if (session) stop(); });

delaySlider.value = String(DELAY_DEFAULT);
volumeSlider.value = String(VOLUME_DEFAULT);
byId('demoBadge').hidden = !demo;
syncTheme();
syncDelay();
syncVolume();
fitTraces();
new ResizeObserver(fitTraces).observe(inputTrace.canvas);
if (demo && params.get('autostart') === '1') start();

if (document.documentElement.dataset.offline === 'true' && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // Network use remains available if the browser disables offline storage.
  });
}
