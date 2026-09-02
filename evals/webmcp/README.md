# WebMCP evals

The suite separates deterministic browser/tool behavior from probabilistic
agent tool selection. Both layers are required before changing a tool contract.

## Layer A — deterministic unit tests (local)

`npm test` runs the explicit `node:test` files listed in `package.json` through
`tsx`. Coverage includes pitch/score parsing, strict Teach lesson validation,
grading, source-aware input ownership, exact mode catalogs, optional execution
contexts, stale and partial registration, bounded progress output, and awaited
UI callbacks. Runs locally with no browser. (No GitHub Actions workflow yet.)

## Layer B — isolation and journey fixtures (manual)

The `fixtures/*.json` files run with the
[webmcp-tools evals-cli](https://github.com/GoogleChromeLabs/webmcp-tools/tree/main/evals-cli)
against a flagged Chromium tab (`chrome://flags/#enable-webmcp-testing`) with the
app served on localhost. They are not run in CI.

Every fixture's `applicationState.tools` lists the complete catalog for its page
mode: five tools in Play and three in Teach. Isolation results therefore include
all real competitor tools. Descriptions are duplicated intentionally so each
fixture remains self-contained for the evals-cli.

| Fixture | Failure mode covered | Shape |
|---|---|---|
| `001-play-note-isolation.json` | Wrong tool / wrong args on a direct request | isolation, raw Sargam input |
| `002-play-score-isolation.json` | Wrong args on a structured request | isolation, ambiguous phrasing |
| `003-set-sa-then-state.json` | Wrong order on a two-step journey | ordered chain |
| `004-teach-load-lesson.json` | Select load and extract human-friendly Western notes | Teach isolation, empty state |
| `005-teach-progress-isolation.json` | Select the read tool for ambiguous result intent | Teach isolation, complete state |
| `006-teach-clear-isolation.json` | Select destructive state reset only when requested | Teach isolation, complete state |

The Teach journey is: the agent loads an exercise, the human starts and plays it
in the page, the agent may read progress, and clear runs only when the human asks
for a fresh state. Human Start/Restart is intentionally not an agent tool.

Mid-chain and runtime failures stay deterministic: `src/webmcp.test.ts` proves
invalid or aborted loads preserve the lesson, stale mode tools fail, partial
registration rolls back, output stays bounded, and mutations wait for their UI
callback before returning success.

## Manual checks recorded in PRs

- `get_state` returns current Sa, audio lock, active keys
- `play_note` sounds a reed and lights the key in the visible UI
- `load_lesson` updates the Teach title, bars, tonic, and Start state before returning
- `clear_lesson` removes the visible lesson before returning
- switching modes replaces the whole catalog without a mixed-tool interval
- With the flag off, the human instrument still works fully
