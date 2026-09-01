# WebMCP evals

Two layers, per `.agents/webmcp-agent-guide.md` §4.

## Layer A — deterministic unit tests (local)

`npm test` runs `src/pitch.test.ts` and `src/score.test.ts` (node:test via tsx).
These cover the pure helpers the WebMCP tools rely on: `resolveKey`, `keyForSargam`,
`parseScore`. Runs locally with no browser. (No GitHub Actions workflow yet.)

## Layer B — isolation and journey fixtures (manual)

The `fixtures/*.json` files run with the
[webmcp-tools evals-cli](https://github.com/GoogleChromeLabs/webmcp-tools/tree/main/evals-cli)
against a flagged Chromium tab (`chrome://flags/#enable-webmcp-testing`) with the
app served on localhost. They are not run in CI.

Every fixture's `applicationState.tools` lists the full five-tool set the page
registers in that state, so isolation results are not inflated by a missing
competitor tool. Tool descriptions are duplicated per fixture on purpose — each
JSON file stays self-contained for the evals-cli.

| Fixture | Failure mode covered | Shape |
|---|---|---|
| `001-play-note-isolation.json` | Wrong tool / wrong args on a direct request | isolation, raw Sargam input |
| `002-play-score-isolation.json` | Wrong args on a structured request | isolation, ambiguous phrasing |
| `003-set-sa-then-state.json` | Wrong order on a two-step journey | ordered chain |

## Manual checks recorded in PRs

- `get_state` returns current Sa, audio lock, active keys
- `play_note` sounds a reed and lights the key in the visible UI
- With the flag off, the human instrument still works fully
