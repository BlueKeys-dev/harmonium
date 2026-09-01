# Repository map

## Application route

- `index.html` loads `src/main.tsx`.
- `src/main.tsx` mounts the single React root and exposes the debug-only
  `window.__harmonium` engine/player handle.
- `src/App.tsx` owns page state and connects UI input, score playback, audio,
  the JSON editor, and WebMCP status.

## Ownership

- `src/audioEngine.ts`: canonical note playback, sample preload/fallback,
  active-key ownership, safe source upgrades, and Tone output.
- `src/score.ts`: canonical bounded score types, parsing, validation, duration,
  and demo score.
- `src/scorePlayer.ts`: Tone Transport/Part scheduling and synchronized visual
  callbacks.
- `src/pitch.ts`: key/MIDI/Western/Sargam conversion and keyboard layout.
- `src/webmcp.ts`: five page tools that reuse the audio engine and score player;
  playback tools bound public work and accept hosts with or without per-call
  cancellation signals.
- `src/components/Keyboard.tsx`: pointer keyboard layout and interaction.
- `src/hooks/useComputerKeys.ts`: physical-key mapping and octave shifts.
- `src/components/Visualizer.tsx`: continuously rendered Canvas2D score preview
  and playback animation.
- `src/components/jsonEditorTab.ts`: same-origin popup editor and `postMessage`
  handshake with `App.tsx`.
- `src/index.css`: layout, responsive behavior, and visual effects.

## Assets and deployment

- `index.html`: document shell; loads `/src/main.tsx` and declares the SVG/ICO
  favicon links from `public/`.
- `public/favicon.svg` / `public/favicon.ico`: static browser favicon assets;
  Vite serves them from the site root without imports.
- `public/samples/harmonium/`: CC-BY harmonium samples copied into the static
  build.
- `vite.config.ts`: Vite React configuration.
- `package.json` / `package-lock.json`: npm dependency and script source of
  truth. Vite 7 requires Node `^20.19.0 || >=22.12.0`.
- `dist/`: ignored generated build output.

## Verification routes

- `npm run typecheck`: TypeScript without emit.
- `npm test`: pitch and score unit tests.
- `npm run check`: keyboard layout assertions.
- `npm run build`: typecheck plus production bundle.
- `npm run dev`: local runtime smoke check.
- `evals/webmcp/fixtures/`: manual WebMCP isolation and journey fixtures.

## Change routing

- Pitch or keyboard-range changes: start in `src/pitch.ts`, then inspect its
  tests, keyboard rendering, score validation, and WebMCP schemas.
- Playback changes: start in `src/audioEngine.ts`; inspect `scorePlayer.ts`,
  `App.tsx`, and `webmcp.ts` callers.
- Score-contract changes: start in `src/score.ts`; keep editor and WebMCP input
  boundaries aligned.
- Rendering/GPU investigations: start in `src/components/Visualizer.tsx` and
  relevant effects in `src/index.css`; Tone DSP is audio/CPU work, not GPU.
- Dependency or hosting changes: inspect `package.json`, `package-lock.json`,
  `vite.config.ts`, `index.html`, and `import.meta.env.BASE_URL` usage.
