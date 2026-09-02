# Repository map

## Application route

- `index.html` loads `src/main.tsx`.
- `src/main.tsx` mounts the single React root and exposes the debug-only
  `window.__harmonium` engine/player handle.
- `src/App.tsx` owns page state and connects UI input, score playback, audio,
  the JSON editor, and WebMCP status. Successfully started agent scores are
  committed here so the visualizer, export, tonic, and editor stay synchronized;
  it also owns the human-selected Play/Teach mode and Teach session lifecycle.

## Ownership

- `src/audioEngine.ts`: canonical note playback, sample preload/fallback,
  active-key ownership, safe source upgrades, and Tone output.
- `src/score.ts`: canonical bounded score types, parsing, validation, duration,
  and demo score; WebMCP uses its strict all-or-nothing object parser while the
  human JSON editor keeps the forgiving text parser.
- `src/scorePlayer.ts`: transactional Tone Transport/Part scheduling and
  synchronized visual callbacks; callers publish UI state after startup.
- `src/teachSession.ts`: strict beat-based lesson validation and pure Teach
  count-in, grading, miss, restart, clear, and progress state transitions.
- `src/inputRouter.ts`: source-aware computer/pointer note ownership so one
  input cannot release a reed that another input still holds.
- `src/pitch.ts`: key/MIDI/Western/Sargam conversion and keyboard layout.
- `src/webmcp.ts`: five page tools that reuse the audio engine and score player;
  Teach Mode replaces them with three lesson tools through generation-safe,
  abortable registration. Tools accept hosts with or without per-call signals,
  await visible UI commits, and paginate large Teach progress responses.
- `src/components/Keyboard.tsx`: pointer keyboard layout and interaction.
- `src/hooks/useComputerKeys.ts`: physical-key mapping and octave shifts.
- `src/components/Visualizer.tsx`: continuously rendered Canvas2D score preview
  and playback animation.
- `src/components/TeachVisualizer.tsx`: dedicated beat-clock piano roll with
  pending, correct, missed, wrong-input, and active-key feedback.
- `src/components/TeachMode.tsx`: focused Teach header, progress, count-in,
  visualizer, accessible announcements, and clickable keyboard composition.
- `src/components/jsonEditorTab.ts`: same-origin popup editor and `postMessage`
  handshake with `App.tsx`; self-echoes are suppressed and unsaved drafts are
  preserved when an external score arrives.
- `src/index.css`: layout, responsive behavior, and visual effects.

## Assets and deployment

- `.openai/hosting.json`: ChatGPT Sites project binding and static `dist`
  deployment contract.
- `index.html`: document shell; loads `/src/main.tsx` and declares favicon and
  ChatGPT Sites social-preview metadata for assets from `public/`.
- `public/favicon.svg` / `public/favicon.ico`: static browser favicon assets;
  Vite serves them from the site root without imports.
- `public/og.png`: branded social preview card for ChatGPT Sites sharing.
- `public/samples/harmonium/`: CC-BY harmonium samples copied into the static
  build.
- `vite.config.ts`: Vite React configuration.
- `package.json` / `package-lock.json`: npm dependency and script source of
  truth. Vite 7 requires Node `^20.19.0 || >=22.12.0`.
- `dist/`: ignored generated build output.

## Verification routes

- `npm run typecheck`: TypeScript without emit.
- `npm test`: pitch, score, teach, input-router, and WebMCP registrar unit tests.
- `npm run check`: keyboard layout assertions.
- `npm run build`: typecheck plus production bundle.
- `npm run dev`: local runtime smoke check.
- `evals/webmcp/fixtures/`: self-contained Play and Teach isolation/journey
  fixtures with each mode's complete competing tool catalog.

## Change routing

- Pitch or keyboard-range changes: start in `src/pitch.ts`, then inspect its
  tests, keyboard rendering, score validation, and WebMCP schemas.
- Playback changes: start in `src/audioEngine.ts`; inspect `scorePlayer.ts`,
  `App.tsx`, and `webmcp.ts` callers.
- Teach changes: start in `src/teachSession.ts`; inspect `inputRouter.ts`,
  `TeachMode.tsx`, `TeachVisualizer.tsx`, `App.tsx`, and the Teach WebMCP tools.
- Score-contract changes: start in `src/score.ts`; keep editor and WebMCP input
  boundaries aligned.
- Rendering/GPU investigations: start in `src/components/Visualizer.tsx` and
  relevant effects in `src/index.css`; Tone DSP is audio/CPU work, not GPU.
- Dependency or hosting changes: inspect `package.json`, `package-lock.json`,
  `vite.config.ts`, `index.html`, and `import.meta.env.BASE_URL` usage.
