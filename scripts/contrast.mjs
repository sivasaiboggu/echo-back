import { readFile } from 'node:fs/promises';

const { colors, themes } = JSON.parse(await readFile(new URL('../design/tokens.json', import.meta.url), 'utf8'));
const text = 4.5;
const control = 3;
const pairs = [
  ['Main text', 'ink', ['page', 'surface', 'raised', 'recess'], text],
  ['Secondary text', 'muted', ['page', 'surface', 'raised', 'recess'], text],
  ['Accent text and focus', 'accent', ['page', 'surface', 'raised', 'recess'], text],
  ['Button label, default', 'on-accent', ['accent'], text],
  ['Button label, hover/press', 'on-accent', ['accent-active'], text],
  ['Feedback warning', 'warning', ['raised'], text],
  ['Microphone error', 'error', ['raised'], text],
  ['Theme button outline', 'control-line', ['page', 'raised'], control],
  ['Slider track', 'control-line', ['raised'], control],
  ['Slider thumb on track', 'ink', ['control-line'], control],
  ['Ruler ticks', 'control-line', ['recess'], control],
  ['Mic trace', 'trace', ['recess', 'line'], control],
  ['Speaker trace', 'accent', ['recess', 'line'], control],
  ['Meter fill', 'trace', ['recess', 'line'], control],
];

function linear(srgb) {
  return srgb <= .04045 ? srgb / 12.92 : ((srgb + .055) / 1.055) ** 2.4;
}

function luminance(rgb) {
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}

function fromHex(hex) {
  return luminance([1, 3, 5].map((start) => linear(parseInt(hex.slice(start, start + 2), 16) / 255)));
}

function fromOklch(oklch) {
  const [light, chroma, hue] = oklch.slice(6, -1).split(' ').map(Number);
  const angle = hue * Math.PI / 180;
  const a = chroma * Math.cos(angle);
  const b = chroma * Math.sin(angle);
  const l = (light + .3963377774 * a + .2158037573 * b) ** 3;
  const m = (light - .1055613458 * a - .0638541728 * b) ** 3;
  const s = (light - .0894841775 * a - 1.291485548 * b) ** 3;
  return luminance([
    4.0767416621 * l - 3.3077115913 * m + .2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
    -.0041960863 * l - .7034186147 * m + 1.707614701 * s,
  ].map((channel) => Math.max(0, Math.min(1, channel))));
}

function ratio(a, b) {
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

console.log('| Pair | Dark | Light | AA |');
console.log('| --- | ---: | ---: | ---: |');
for (const [label, foreground, backgrounds, minimum] of pairs) {
  const results = ['dark', 'light'].map((theme) => {
    const token = (role) => colors[themes[theme][role]];
    const ratios = backgrounds.flatMap((background) => [
      ratio(fromOklch(token(foreground).oklch), fromOklch(token(background).oklch)),
      ratio(fromHex(token(foreground).hex), fromHex(token(background).hex)),
    ]);
    return Math.min(...ratios);
  });
  if (results.some((value) => value < minimum)) process.exitCode = 1;
  console.log(`| ${label} | ${results[0].toFixed(2)} | ${results[1].toFixed(2)} | ${minimum.toFixed(1)} |`);
}
