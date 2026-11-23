# v2 verification

Before was captured from current `main` at `830f3f45e4b75df9aab52390a535a1a16cc72643`. After was captured from the production build. The [repo-owned screenshot runner](../scripts/shots.mjs) starts separate local servers, sets viewport and theme, and drives each state with Playwright and a silent demo or synthetic microphone.

| View | Before | After |
| --- | --- | --- |
| Ready at 1440 px | [Main](screenshots/v2/before-desktop-idle.webp) | [Audio tunnel](screenshots/v2/after-desktop-idle.webp) |
| Echoing at 1440 px | [Main](screenshots/v2/before-desktop-echoing.webp) | [Audio tunnel](screenshots/v2/after-desktop-echoing.webp) |
| Ready at 390 px | [Main](screenshots/v2/before-phone-idle.webp) | [Audio tunnel](screenshots/v2/after-phone-idle.webp) |
| Echoing at 390 px, light | [Main](screenshots/v2/before-phone-echoing-light.webp) | [Audio tunnel](screenshots/v2/after-phone-echoing-light.webp) |
| Recording and review | — | [Recording](screenshots/v2/after-recording.webp) · [Take playback](screenshots/v2/after-take-playback.webp) |

The largest accent share among the captured viewports was 1.97%. Pixel counts use a radius of 28 in sRGB distance from either theme’s signal coral and its active shade.

## Contrast

The minimum across the rendered OKLCH colors, hex fallbacks and applicable surfaces is listed for each pair. The check treats grid lines and tunnel walls as decorative.

| Pair | Dark | Light | AA |
| --- | ---: | ---: | ---: |
| Main text | 15.64 | 15.47 | 4.5 |
| Secondary text | 7.34 | 6.61 | 4.5 |
| Accent text and focus | 7.29 | 5.67 | 4.5 |
| Button label, default | 8.34 | 6.56 | 4.5 |
| Button label, hover/press | 10.60 | 8.41 | 4.5 |
| Feedback warning | 9.73 | 7.66 | 4.5 |
| Microphone error | 9.92 | 6.88 | 4.5 |
| Theme button outline | 4.45 | 5.23 | 3.0 |
| Slider track | 4.45 | 5.23 | 3.0 |
| Slider thumb on track | 3.52 | 3.42 | 3.0 |
| Ruler ticks | 5.09 | 5.23 | 3.0 |
| Mic trace | 3.24 | 4.92 | 3.0 |
| Speaker trace | 5.31 | 4.22 | 3.0 |
| Meter fill | 3.24 | 4.92 | 3.0 |

## Browser checks

- `npm test` covers existing behavior, dual-tap scheduling, recording limits, playback and storage recovery. Layout checks cover both themes at 320, 390, 768 and 1440 px.
- axe-core 4.14.1 reported zero violations across ready, echoing, recording, playback, delete confirmation, privacy and error cases.
- A separate production smoke check covered offline load, worklet recording, and review playback. It also checked the take player and secondary pages for overflow at all four widths in both themes.

## Lighthouse mobile

Lighthouse 13.6.0 and Chromium 156 used simulated mobile throttling on the production build served on localhost. Performance 99, accessibility 100, best practices 100, SEO 100. LCP 1.06 s, TBT 98 ms, CLS 0. This is a lab result. See the [recorded settings and measurements](lighthouse-mobile.json).

To reproduce, build and serve `dist/`, then run the audit with Lighthouse’s default mobile settings.

```sh
npm run build
python3 -m http.server 8128 --directory dist
```

```sh
CHROME_PATH=/usr/bin/chromium npm exec --yes --package=lighthouse@13.6.0 -- lighthouse \
  http://127.0.0.1:8128/ --chrome-flags='--headless' --output=json \
  --output-path=./lighthouse-mobile.json
```
