# EchoBack

EchoBack plays what your microphone hears through your headphones or speakers. The delay defaults to two seconds and can be adjusted from 0.5 to 3 seconds. Choose **Record take** to capture up to 60 seconds of undelayed mic audio. Takes are stored in this browser and can be played, downloaded as WAV, or deleted. EchoBack sends no audio over the network.

## Run and verify

Use Node.js 24, Python 3, and Chromium or Chrome. The lockfile pins the test tools to Playwright Core 1.65.1 and axe-core 4.14.1.

```sh
npm ci
npm start
```

Open [http://localhost:8000](http://localhost:8000). Use `?demo=1` for a silent signal demo or `?theme=light` to start in light mode. Microphone access needs HTTPS or localhost. Set `CHROME_BIN` when the test runner needs a custom browser path.

```sh
npm run contrast
npm test
npm run build
ECHOBACK_SHOT_ROOT=dist npm run screenshots -- /path/to/baseline /path/to/output
```

## Build and deploy

`npm run build` validates JavaScript and generated design tokens, then writes the static site to `dist/`. Serve that directory over HTTPS. There are no required environment variables. Set `ECHOBACK_PUBLIC_URL` to an HTTPS directory URL, with any path prefix, to generate absolute canonical and Open Graph links and resolve assets on host-served error pages.

The production build includes an install manifest and a versioned offline cache for app files. The server can use `404.html` and `500.html` as custom responses. The pull request workflow runs tests and uploads the build for preview.

## Audio and storage

The mic feeds two buffered delay taps. When the delay changes, the app adjusts the silent tap and fades to it. The live output passes through a compressor and capped gain stage. Sustained input peaks lower the monitor level, which recovers after two quiet seconds. Use headphones or keep the speaker at a moderate level.

Recording starts only when you select **Record take**. A mono AudioWorklet taps the input before the echo and volume controls. Stop echo saves the active take and releases the mic. Opening playback stops live monitoring. Playback supports seeking and three speeds.

The local library holds 12 takes. When storage is full or unavailable, the current take remains available for download until you leave. Clearing browser site data deletes saved takes. Downloaded WAV files remain wherever you saved them.

[Design rationale and launch checklist](design/brief.md)
