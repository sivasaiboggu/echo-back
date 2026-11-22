# EchoBack

Hears loud reels in public — and plays them back with a 2-second delay, so the
volume comes down on its own. No confrontation. No recording. Nothing leaves
your phone.

Inspired by Bengaluru developer Pankaj Tanwar's lightweight fix for people
playing Instagram Reels, videos, and music loudly in public without earphones
(shared by Raghvendra Singh on LinkedIn, 18 Nov 2026): capture nearby audio
through the microphone and play it back with a delay, creating an irritating
echo that encourages the person to lower their volume themselves.

## Design — a tool, not a landing page

The screen is built around one idea: **you can see the echo**. Two colours
carry the whole story — violet is the sound the mic hears *now*, coral is
the echo coming back *late* — and the delay line between them is the
centrepiece. Everything is flat: solid surfaces, hairline borders, no
ambient glow, no entrance animation, no gradient text. What moves is
functional, not decorative:

- **The delay line** — a live violet waveform (what the mic hears), a tunnel
  with a glowing pulse travelling from mic to speaker over the delay, and a
  coral waveform (what the speaker plays, two seconds late). While the delay
  primes, the tunnel fills; once echoing, the pulse loops every delay. The
  tunnel is also a **ruler**: one tick every 0.5s, lighting up as the pulse
  passes it — violet while priming, coral once echoing — so you can see
  exactly where the sound is in time.
- **The start button** — one flat circle, like a recorder's record button:
  solid violet idle, solid deep coral while echoing. The ring around it fills
  over the delay while priming and stays full while echoing, so the
  decoration does a job. The status line under it says what the app is
  doing in plain words ("Echoing — their audio, 2.0s late.").
- **Idle state** — ghost waveforms drift quietly on both strips, inviting
  the first tap.
- **Sliders** — filled tracks with live readouts; the delay hint says what
  each delay feels like in plain words ("Enough to throw anyone off.").
- Space Grotesk display type + Inter body + **IBM Plex Mono for every
  number** (timer, delay readouts, slider values), so figures never wobble
  as they change. Design tokens are **OKLCH with hex fallbacks**; coral is
  the single accent. Dark is the default — this is a night-time tool, used
  in public, and dark is discreet — with a **light theme** one tap away in
  the header (`?theme=light` previews it). Focus-visible rings,
  keyboard-accessible controls, and a two-column stage on desktop (button
  left, delay line right). Mobile-first at 390px with zero overflow.

The copy is written the way a person would say it — no marketing words, no
clichés, no emoji. `tests/copy.test.js` guards that: it scans the visible
page text, the app strings and every caption the helpers can produce, and
fails the build if a banned word or an emoji shows up.

### Contrast (WCAG AA, 4.5:1 for text, 3:1 for large text)

| Pair | Dark | Light |
| --- | --- | --- |
| Body text on page | 17.38 | 16.08 |
| Body text on card | 15.71 | 17.95 |
| Muted text on card | 8.21 | 7.61 |
| Faint caption on card | 4.98 | 5.24 |
| Violet signal on card | 5.31 | 6.74 |
| Coral accent on card | 6.10 | 4.96 |
| White on running button | 4.30 | 4.96 |
| White on idle button | 4.62 | 8.15 |

Two pairs needed fixing in this round and were fixed, not waived: white on
the running coral button was 2.85:1, so the button now uses a deep coral;
the faint caption grey was 4.22:1 on the dark card, so it was lifted to
4.98:1.

## How it works

1. **Listen.** Your mic picks up the room — the reel, the music, the video
   next to you.
2. **Delay.** The sound waits in a Web Audio `DelayNode` (default 2.0s,
   adjustable 0.5–3.0s live, even while echoing).
3. **Echo.** It plays back from your speaker, half a beat behind the original.
   The clash is deeply annoying — to the person playing it loud.
4. **They turn it down.** Lowering their volume kills the echo. Peace returns,
   nobody had an argument.

Audio graph: `MediaStreamSource → Analyser → DelayNode → Analyser →
DynamicsCompressor → GainNode → destination`. The analysers drive the live
level meter and waveform; the compressor tames loud peaks; the master gain is
capped at 0.85.

## Feedback safety

A mic and a speaker in the same room can loop. EchoBack guards against that:

- **Compressor** (threshold −20 dB, ratio 12:1) tames sudden peaks.
- **Gain cap** — output gain never exceeds 0.85, whatever the slider says.
- **Feedback guard** — if the input peak stays pinned at max (≥ 0.98) for
  0.5 s, the output is ducked to 30% and a warning appears. Once the input
  has been calm for 2 s, the volume restores itself.
- **Tip in the UI** — keep the volume moderate, point the speaker away from
  the mic.
- **Stop means stop** — if Stop is tapped while the mic permission prompt is
  still open, a late answer to that prompt is dropped and the app stays
  stopped; it never starts echoing after the user walked away.

## Privacy — private by design

Live passthrough only. There is **no recording, no storage, no upload, no
account, no server**. No `MediaRecorder`, no audio buffer kept past the delay
line, no network call. The audio never leaves the page. The mic is requested
with echo cancellation, noise suppression, and auto-gain control all off, so
the mic hears the room as it is.

## Use it to nudge, not to harass

EchoBack only plays back what your own microphone hears, in the moment. It is
a nudge for shared spaces — buses, trains, waiting rooms — not a weapon. Keep
the volume moderate, never aim it at one person for a long time, and switch it
off once the volume drops. If someone asks what that sound is, tell them: it
is their own audio, two seconds late.

## Run it

No build step, no server, no keys. Open `index.html` directly, or:

```sh
npm start        # serves on http://localhost:8000
```

Use it on a phone in a modern mobile browser (Chrome or Safari) and allow mic
access when asked. Microphone access needs a secure context (localhost or
HTTPS).

Preview the echoing UI without a mic: open `index.html?demo=1` — clearly
labelled simulated audio, no microphone in use.

## Tests

```sh
npm test         # node --test tests/*.test.js — 47 tests
```

- 26 engine tests: delay/gain clamping, timer, state machine, feedback guard,
  level helpers, and the Web Audio graph with a mock `AudioContext`.
- 14 UI-helper tests: delay-trail pulse math, priming countdown, delay
  captions, the status narration for every state, the priming-ring
  offset math, and the delay-ruler tick positions and lighting.
- 4 copy-guard tests: no emoji or decorative symbols, no banned marketing
  words or retired phrasing, and the word "orb" never reaches the user.
- 3 layout tests: no horizontal overflow at 390px (phone) and 1280px
  (desktop), idle and echoing, plus the light theme at 390px, driven over
  CDP against real headless Chrome.
  Renders: `node scripts/shots.mjs` writes `screenshots/*.png` (dark idle
  and echoing at both widths, plus light idle on mobile and light echoing
  on desktop).

Live mic behaviour cannot be exercised headlessly (no mic in a VM) — the
real-device mic test is still to be done on a phone.

## Files

- `index.html` — the whole app (mobile-first, ink-violet theme, light theme toggle)
- `styles.css` — styling, OKLCH design tokens, light theme, motion
- `src/audio-engine.js` — pure logic + Web Audio graph + feedback guard
- `src/ui-helpers.js` — pure UI helpers: delay-trail math, captions, narration, delay-ruler ticks
- `src/app.js` — UI wiring, start button, priming ring, delay tunnel and ruler, meter/waveforms, timer, theme, demo mode
- `tests/engine.test.js` — 26 unit tests (engine + graph)
- `tests/ui.test.js` — 14 unit tests (UI helpers + priming ring + ruler)
- `tests/copy.test.js` — 4 copy-guard tests (no emoji, no marketing clichés)
- `tests/layout.test.js` — 3 CDP layout tests (390px + 1280px, idle + echoing, light theme at 390px)
- `scripts/shots.mjs` — real Chrome renders for review (`screenshots/`)
