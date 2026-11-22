# EchoBack

EchoBack plays back what your microphone hears through your speaker, two seconds late by default. The delay is adjustable from 0.5 to 3 seconds. The app processes audio in your browser and creates no recordings or uploads.

## Run and verify

Use Node.js 24, Python 3 and Chromium or Chrome. The lockfile pins the browser test driver to Playwright Core 1.65.1.

```sh
npm ci
npm start
```

Open [http://localhost:8000](http://localhost:8000). Use `?demo=1` for silent simulated audio or `?theme=light` to start in light mode. Use HTTPS or localhost for live microphone access.

```sh
npm run contrast
npm test
npm run build
npm run screenshots
```

Set `CHROME_BIN` to the browser executable if the test or screenshot runner cannot find it. To reproduce before-and-after images, pass a baseline checkout and an output directory to `npm run screenshots -- /path/to/baseline /path/to/output`.

## Build and launch

`npm run build` validates the JavaScript and generated tokens, then writes the static site to `dist/`. Serve that directory over HTTPS. Optionally set `ECHOBACK_PUBLIC_URL` to the final HTTPS directory URL, including any path prefix, before building. The build then emits absolute canonical and Open Graph URLs and resolves assets from that directory on host-served error pages.

The production build includes a manifest and a versioned offline cache for app files. The server can use `404.html` and `500.html` as custom responses. The pull request workflow runs tests and uploads a build artifact for preview.

## Audio and controls

The Web Audio graph is microphone → input analyser → delay → output analyser → compressor → capped gain → speaker. The scope shows input and delayed signal. Settings remain adjustable during a session. The feedback guard lowers output after 500 ms of sustained peaks and restores it after two seconds of quiet input. Stop releases the microphone and clears the session. Leaving the page also stops the audio.

Keep the volume moderate and point the speaker away from the mic. Keep sessions brief in shared spaces.

[Design brief, contrast table and launch checklist](design/brief.md)

Inspired by Pankaj Tanwar’s Bengaluru fix for loud reels.
