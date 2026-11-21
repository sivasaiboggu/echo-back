// Copy guard — EchoBack's user-facing words must stay plain, human and
// free of AI-marketing clichés and decorative symbols. Scans the visible
// text of index.html, every string literal in src/app.js, and every
// caption/narration the UI helpers can produce, then asserts:
//   - no emoji or pictographic symbols anywhere
//   - no banned marketing words or retired phrasing
//   - no invented UI word ("orb") leaking into what the user reads
// Run: npm test (node --test tests/*.test.js)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { delayCaption, narrationFor } from '../src/ui-helpers.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

function stringLiterals(js) {
  const out = [];
  const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(js)) !== null) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  return out.join(' ');
}

// Every user-facing string the helpers can emit, across all states.
function helperCopy() {
  const parts = [delayCaption(0.5), delayCaption(1.0), delayCaption(2.0), delayCaption(3.0)];
  for (const state of ['idle', 'requesting', 'listening', 'echoing', 'error']) {
    for (const ducked of [false, true]) {
      const { headline, sub } = narrationFor({
        state, delaySeconds: 2, ducked, primeRemaining: 1.4, error: 'Microphone permission denied.',
      });
      parts.push(headline, sub);
    }
  }
  return parts.join(' ');
}

const BANNED_WORDS = [
  'seamless', 'effortless', 'supercharge', 'elevate', 'cutting-edge',
  'revolutionary', 'game-changer', 'game changer', 'unleash', 'delight',
  'magical', 'sweet spot', 'deeply unbearable', 'deeply annoying',
  'slapback', 'unbearable', 'half a beat', 'private by design',
  'house rules', "nudge, don't harass", 'send the noise back',
  'feedback guard', 'priming', 'tamed',
];
const BANNED_IN_VISIBLE_COPY = ['orb']; // class names may keep it; users must never read it

// Emoji / pictographs / decorative dingbats. Plain punctuation
// (— · … ’ “ ”) is fine and is not matched by these ranges.
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/u;

describe('copy guard', () => {
  const htmlVisible = visibleText(read('index.html'));
  const appStrings = stringLiterals(read('src/app.js'));
  const helperStrings = stringLiterals(read('src/ui-helpers.js'));
  const copy = helperCopy();

  it('has no emoji or decorative symbols in user-facing text', () => {
    for (const [name, text] of [
      ['index.html visible text', htmlVisible],
      ['src/app.js strings', appStrings],
      ['ui-helpers output', copy],
    ]) {
      assert.doesNotMatch(text, EMOJI_RE, `${name} contains an emoji or decorative symbol`);
    }
  });

  it('has no banned marketing words or retired phrasing', () => {
    const haystacks = [
      ['index.html visible text', htmlVisible.toLowerCase()],
      ['src/app.js strings', appStrings.toLowerCase()],
      ['src/ui-helpers.js strings', helperStrings.toLowerCase()],
      ['ui-helpers output', copy.toLowerCase()],
    ];
    for (const word of BANNED_WORDS) {
      for (const [name, text] of haystacks) {
        assert.ok(!text.includes(word), `"${word}" found in ${name}`);
      }
    }
  });

  it('never calls the button an "orb" where the user can read it', () => {
    for (const [name, text] of [
      ['index.html visible text', htmlVisible.toLowerCase()],
      ['ui-helpers output', copy.toLowerCase()],
    ]) {
      for (const word of BANNED_IN_VISIBLE_COPY) {
        assert.ok(!text.includes(word), `"${word}" found in ${name}`);
      }
    }
  });

  it('still says the two things that matter, plainly', () => {
    assert.match(htmlVisible, /two seconds late/i);
    assert.match(htmlVisible, /Nothing is recorded/i);
  });
});
