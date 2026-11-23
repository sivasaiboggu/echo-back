# EchoBack v2

EchoBack is a web tool for practicing a spoken phrase out loud and hearing the timing back. The first useful loop is Start echo, allow the mic and wait two seconds. Recording is a separate choice. The default room-audio use remains available through the same controls.

## Design

The signature is a chamfered tunnel receding to the selected delay. The opening geometry appears in the brand icon, the signal view and the social preview. The main instrument uses side-by-side input and output scopes, an audio-time ruler and one column of tactile controls. At phone widths the start/stop transport comes first, followed by the signal and settings. Below the instrument, the takes library uses a playback transport and short rows. Privacy and error pages use the same canvas and typography with a simpler reading layout.

| Accent considered | Dark-mode swatch | Decision |
| --- | --- | --- |
| Signal coral | `#ff8c79` | Selected. Easy to distinguish from the blue-gray surfaces and neutral microphone signal. |
| Soft coral | `#ffab99` | Useful for the pressed and hovered action, with a softer edge than the main signal. |
| Deep coral | `#df695b` | More subdued on dark surfaces, with less contrast for thin traces. |

- Twelve blue-gray neutral steps and one coral signal color define both themes. Semantic warning and error colors appear only with corresponding messages. The [OKLCH and hex source tokens](tokens.json) generate [CSS variables](../tokens.css) and a [Tailwind v4 theme](tailwind.css).
- Self-hosted Chakra Petch Latin 400/600 handles display and body. The fluid scale runs from 16–18 px for body copy at 1.6 line height and caps reading width at 68 characters. Tabular monospace identifies time and measurements.
- The 4 px base governs small gaps. The 8 px grid determines grouping and section spacing. Panel interiors use 16 px on phones and 20 px on desktop. Controls have at least 44 px block targets. Surfaces use 8 px corners, 2 px technical marks and flat, inset or elevated shadow levels. Fine grain on the recessed tunnel is static.
- The entrance and playback reveal use 280 ms opacity and translation. Entry timing uses a 40 ms increment. Hover and press motions take 160 ms. Motion follows state changes, the real delay, signal amplitude or playback. Reduced motion keeps the visual meters and text readable, suppresses moving live traces and removes the traveling delay cursor.
- Labels and empty states tell users what they can do next. The default view distinguishes the delayed speaker signal from the dry mic signal. The download fallback stays visible when storage cannot save a take.

## References reviewed before implementation

| Reference | Pattern used |
| --- | --- |
| [21st.dev Playback Scrubber](https://21st.dev/@sltowl/components/matte-scrub-slider) | Use a waveform as context for a keyboard-accessible playback scrubber. |
| [Designeer](https://designeer.xyz/) | The live site and catalog endpoint returned 403 from this workspace. Indexed catalog descriptions informed the search for independently crafted controls. |
| [React Bits Pro](https://pro.reactbits.dev/changelog) | Signal maps, instrument dials and the waveform player informed the readout hierarchy. EchoBack uses measured canvas traces and native ranges. |
| [Magic UI Animated List](https://magicui.design/docs/components/animated-list) | Place a newly saved take at the start of a stable list with one short entrance. |
| [Uiverse Button Effects](https://uiverse.io/buttons) | Use a small physical hover and press displacement on controls. |
| [Mobbin](https://mobbin.com/) | The public flow examples informed the sequence from permission and first echo to review. The audio-specific collection could not be opened in this workspace. |
| [Inspora glass recorder](https://www.inspora.design/posts/glass-recorder) | Keep elapsed time and Stop/Save close together when recording begins. The `www` reference worked after the bare URL failed. |
| [Refero Styles on Splice](https://styles.refero.design/style/1f69df96-675d-4ee0-aa85-e085d9d39981) | Pull the audio surface forward by reducing color and depth elsewhere. |

## Views and architecture

| View | Flow |
| --- | --- |
| Live echo at `/#live` | Start → mic permission → first echo countdown → live monitor. Cancel drops late mic streams. Stop and interruption release the mic. Pressed presets match the native delay input. |
| Takes at `/#takes` | Record → Save take or Stop echo → play, seek or adjust playback rate. Download exports a WAV. Delete asks for confirmation. The empty state explains how to make the first take. |
| Guide at `/#how` | Three short steps and a silent demo. The demo opens no mic. |
| Privacy, 404, 500 | Explain local audio, missing pages or unavailable pages and give a route back to the console. |

The existing static HTML, CSS and JavaScript fit a browser-based audio tool. Native buttons, ranges and dialog supply keyboard behavior. The audio graph and feedback detector are isolated from UI state. An AudioWorklet captures PCM frames on the audio thread and stops at the 60-second limit. The main thread exports a mono WAV and derives 48 waveform peaks.

IndexedDB v1 stores each take with its UUID, creation time, duration, peaks and WAV blob. The capacity check and write share one transaction. A one-take in-memory fallback enables download when storage fails. The offline worker caches app files including both font subsets and the worklet. Chromium CI verifies controls, layout and axe and publishes a static artifact. The app has no backend or account setup.

[Measured contrast, before/after captures and Lighthouse](verification.md)

## Launch checklist

- [x] Run the full test suite, contrast audit and production build.
- [x] Verify zero horizontal overflow at 320, 390, 768 and 1440 px in both themes.
- [x] Check the live and review states with a synthetic microphone and axe.
- [x] Record Lighthouse mobile against the production build.
- [ ] On real iOS and Android hardware, check permission, headphones, audio interruptions and WAV downloads.
- [ ] On the deployment host, verify HTTPS, canonical and social metadata, status-code routing and response headers.

Local browser storage can be evicted or cleared. Recordings that matter can be downloaded as WAV. Speaker routing and feedback depend on physical hardware. The lab audit covers Chromium with a simulated phone and microphone.

## Follow-up ideas

1. Name takes and edit their titles.
2. Mark a moment worth replaying.
3. Loop a selected phrase.
4. Opt in to remembering the last delay and output volume.
5. Add shortcut keys for start, stop and record.
6. Export a take with optional delay and duration metadata.
7. Let users choose an output device where the browser supports it.
8. Warn when the input signal is too quiet to practice with.
9. Add translations for the guide and permission recovery.
10. Add mobile Safari and Firefox recording coverage.
