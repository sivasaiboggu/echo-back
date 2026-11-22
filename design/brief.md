# EchoBack redesign

EchoBack is a mobile-first audio tool for someone who wants to hear room sound played back after a short delay. The first useful action is Start echo, followed by the browser’s permission prompt and a two-second wait at the default setting. Demo mode illustrates that flow without playing audio or opening the microphone.

## Visual system

The signature is a pair of audio traces separated by a time ruler. The same offset pulse forms the brand mark and Open Graph art. The source trace stays neutral. Ochre identifies the delayed signal, the ruler cursor and the primary action. In the captured 390 px and 1280 px viewports, at most 1.91% of pixels fell within an RGB distance of 28 from either accent shade.

| Accent considered | Dark-mode swatch | Reason |
| --- | --- | --- |
| Ochre, selected | `#ebd17a` | Reads like a marker on a timing scale and gives the quiet tool one warm reference point. |
| Clay | `#e4a484` | Warmer around the text, though closer to the feedback and error colors. |
| Marine | `#93bbc1` | Clear against deep gray, with a cooler character across the desk. |

The upper section sets a wide, left-aligned headline against a narrower explanation. On desktop the scope takes eight columns and the session and settings take four. On phones the session comes first, followed by the scope and settings in reading order. The guide uses a narrow heading column and one ordered list. Privacy and error pages use the same masthead and type.

- Color uses a twelve-step warm-neutral ramp, one accent in two tones for each theme and semantic warning and error colors. [tokens.json](tokens.json) is the source for [CSS variables](../tokens.css) and the [Tailwind v4 theme](tailwind.css). Current app CSS consumes the variables directly.
- IBM Plex Sans is the single display and reading family, self-hosted as a Latin variable subset. Headings use tight tracking and a fluid scale. Body type runs from 16 to 18 px with 1.6 line height and a 68-character cap. System monospace is reserved for timing, level and slider readouts.
- Layout follows a 4 px spacing scale, with 8 px increments for major groupings, a 4 px frame radius and 2 px slider-thumb radius. The desk uses soft two-layer elevation. The scope has a one-pixel inner edge and fine grain so its grid reads as one surface.
- Controls have hover, press, focus and disabled states. Main controls have at least a 44 px touch target. Native range inputs keep arrow-key and Home/End behavior. The activity label is announced on state changes. The countdown and meter update without a live-region announcement on every reading.
- The ruler indicates elapsed delay, and the scope samples audio 30 times per second. At rest both traces are flat. Reduced motion removes the moving cursor and waveforms, keeps the level readable, and disables the press animation. The button uses a 160 ms spring-like transform.

### Measured contrast

Values are the minimum across the applicable surfaces and the rendered OKLCH colors and hex fallbacks. Decorative grid and divider lines are distinct from controls and data. The audit exits with an error below WCAG AA. Run `npm run contrast`.

| Pair | Dark | Light | AA |
| --- | ---: | ---: | ---: |
| Main text | 13.63 | 14.34 | 4.5 |
| Secondary text | 6.58 | 6.99 | 4.5 |
| Accent text and focus | 10.05 | 6.12 | 4.5 |
| Button label, default | 11.83 | 6.84 | 4.5 |
| Button label, hover/press | 14.36 | 8.87 | 4.5 |
| Feedback warning | 8.82 | 7.21 | 4.5 |
| Microphone error | 8.91 | 6.54 | 4.5 |
| Theme button outline | 4.26 | 5.19 | 3.0 |
| Slider track | 4.26 | 5.19 | 3.0 |
| Slider thumb on track | 3.20 | 3.09 | 3.0 |
| Ruler ticks | 5.01 | 5.19 | 3.0 |
| Mic trace | 4.97 | 3.77 | 3.0 |
| Speaker trace | 7.60 | 3.30 | 3.0 |
| Meter fill | 4.97 | 3.77 | 3.0 |

## Screen plan and implementation

| View | Layout and copy | Interaction |
| --- | --- | --- |
| Ready | The scope is at rest. The session shows “Ready” and “Start echo, then allow microphone access.” | Start is the primary control. Delay and volume can be set before opening the mic. |
| Permission pending | The session shows “Allow mic access” with the speaker off. | Cancel returns to Ready and closes any stream that arrives after cancellation. |
| Listening | The microphone trace responds and the ruler fills for the real delay. “First echo in 1.4 s” illustrates the countdown. | The speaker reads “Waiting” until playback begins. The delay can be adjusted during the wait. |
| Echoing and muted | The speaker trace and time ruler communicate the delayed signal. The timer remains beside Stop echo. | Adjust delay and gain live. Zero volume reads “Muted.” Stop releases the mic and resets the timer and traces. |
| Feedback and mic error | Warnings sit below the session control. Denial points to browser permissions, and disconnect tells the person to check the mic. | Automatic gain reduction and recovery use the same guard. The start control remains available after errors. |
| Demo | The scope names demo audio explicitly. | Delayed traces show simulated playback without opening the mic. |
| Settings and guide | Two labelled ranges stay close to the session. The guide explains listen, wait and playback in three steps. | Native form semantics and keyboard controls. The masthead guide link jumps to the instructions on wider screens. |
| Privacy | A short editorial page explains microphone permissions, in-memory delay, offline files and how to clear site data. | Links back to the console and carries the current theme across navigation. |
| 404 and 500 | A single headline explains the error and gives the next action. | Return to the controls. Hosts can serve these documents with their respective status codes. |

The sitemap is the console at `/`, the guide at `/#how`, privacy at `/privacy.html`, and static `/404.html` and `/500.html` documents. The console handles all audio states in place.

## Architecture

The app uses native HTML controls, CSS and JavaScript modules. A static frontend fits the single route and the browser-managed microphone. `src/app.js` owns one live session at a time and hands audio processing to `src/audio-engine.js`. Pure state copy and ruler calculations live in `src/ui-helpers.js`. Labels are HTML or module strings, and each document declares its language.

Settings live in the native controls for the page session. The audio graph holds transient samples for the delay and analysis. The service worker stores versioned static files locally. There is no application data schema, login, backend, analytics or network audio path. Range limits are defined by the native controls and enforced again in the audio engine.

The preview workflow builds a static artifact and has read-only repository permissions. The screenshot runner starts local servers for the current code and an optional baseline, captures each state in Chromium and uses a fake mic for the feedback case.

## Launch checklist

- [x] Verify build, contrast, keyboard controls, viewport widths and browser simulation against the production UI.
- [x] Exercise the cancel-and-restart path with Chromium’s fake microphone.
- [x] Verify the install manifest and offline app shell in the production build.
- [ ] Listen on physical iOS and Android devices. Check permission, start, stop, output routing, feedback reduction and audio interruptions.
- [ ] Build with the final HTTPS URL and check canonical links, social preview and nested-path error responses on the host.
- [ ] Confirm the host’s permissions, framing and cache headers before publishing.
- [ ] Repeat the performance measurement on the production host and a representative midrange phone.

### Remaining release risks

Browser permissions, speaker routing and acoustic feedback depend on the physical device. Browser tests exercise the graph with a synthetic input. The error documents require host routing, and offline mode needs one successful online load.

### Ten v2 ideas

1. Add an optional time limit for a session.
2. Offer a visible mute shortcut while echoing.
3. Add a one-tap reset for delay and volume.
4. Let people opt into remembering their own settings on the device.
5. Add a short guide to choosing a speaker when the browser supports it.
6. Show when the OS interrupts a session.
7. Add localized help and permission instructions.
8. Offer a one-step demo link in the first-run instructions.
9. Add snapshots for forced colors and 200% zoom to regression coverage.
10. Save the audited performance results for release comparisons.
