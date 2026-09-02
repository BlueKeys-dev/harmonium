# Teach Mode With Piano-Roll Grading

## Summary

Add a user-controlled **Play / Teach** switch. Teach Mode hides the normal score editor, export, notation, and playback controls, leaving a focused piano roll, progress HUD, Start/Restart control, and the existing clickable/computer keyboard input.

The agent creates exercises through three structured WebMCP tools. The learner starts the lesson, receives a four-beat visual count-in, and plays the notes. Correct bars turn green; missed bars turn red; wrong keys produce a short red lane flash without consuming the expected note.

## Public Contract

Teach Mode exposes exactly these tools:

| Tool | Behavior |
|---|---|
| `load_lesson` | Validate and atomically load a structured lesson without starting it |
| `get_lesson_progress` | Return lesson phase, timing, per-note results, target accuracy, and wrong-note count |
| `clear_lesson` | Stop and remove the current lesson |

`load_lesson` input:

```ts
interface TeachLessonInput {
  title?: string; // 1-80 characters
  sa?: "C" | "C#" | "D" | "D#" | "E" | "F" | "F#" | "G" | "G#" | "A" | "A#" | "B";
  bpm: number; // integer, 40-240
  notes: Array<{
    key: number;          // integer, 0-38
    startBeat: number;    // 0-512
    durationBeats: number; // 0.125-16
  }>; // 1-256 notes
}
```

Reject the entire lesson on invalid data, duplicate `{key, startBeat}` targets, or a note ending after beat 512. Never clamp values or silently drop notes. Generate stable IDs from original note indexes, sort an internal copy for playback, and derive note labels from `key` and resolved `sa`.

`get_lesson_progress` returns:

```ts
{
  phase: "empty" | "ready" | "countIn" | "running" | "complete";
  lessonId: string | null;
  bpm: number | null;
  elapsedBeat: number;
  counts: {
    total: number;
    correct: number;
    missed: number;
    pending: number;
    wrong: number;
  };
  accuracy: number; // correct / total
  notes: Array<{
    id: string;
    status: "pending" | "correct" | "missed";
    offsetMs?: number;
  }>;
}
```

Play Mode retains its existing five tools. Mode switching unregisters the old catalog before registering the new one. Do not pass `exposedTo`; tools remain same-origin by default. Agents cannot switch modes or start/restart lessons.

## Implementation

1. Add a pure `TeachSession` state machine containing validated targets, phase, start timestamp, result status, wrong-note count, and progress calculations. Use `performance.now()` as the monotonic clock rather than Tone Transport.

2. Start with a four-beat visual count-in using `60000 / bpm` milliseconds per beat. Lesson beat zero begins after the count-in. Restart resets every target and result while retaining the lesson.

3. On note-down, find the closest pending target with the same key inside an inclusive ±300 ms window. Consume it once, record timing offset and input source, and mark it green. Chord notes remain independent.

4. If no target matches, show a roughly 180 ms red pulse in that key lane and increment `wrong`; do not modify pending targets. Once a pending target exceeds its scheduled time by 300 ms, mark it permanently missed/red. A missed note cannot later become correct.

5. Add a source-aware input router shared by the computer and clickable keyboards. Identify holds as `keyboard:<code>`, `pointer:<pointerId>`, or `onscreen:<key>`. Capture timestamps before starting audio, ignore repeated downs, release the exact originating hold, and only stop a reed after its final owner releases it.

6. Preserve the current computer-key mapping and blur cleanup. Use pointer capture plus `pointerup`, `pointercancel`, and `lostpointercapture` for on-screen notes. Release every held source on mode changes, clear, unmount, or window blur so no notes remain stuck.

7. Add a dedicated `TeachVisualizer` instead of adding mode conditionals throughout the existing playback visualizer. Render neutral upcoming bars, green correct bars, red missed bars, and the transient wrong-key pulse. Keep resolved bars visible for approximately 1.25 seconds after crossing the strike line.

8. Avoid React state updates every animation frame. Keep lesson timing in refs, draw with one cancellable `requestAnimationFrame` loop, and update reducer state only when the count-in number, note status, or lesson phase changes. Limit lessons to 256 notes.

9. In Teach Mode, render the persistent mode switch, audio unlock gate, full-height piano roll, compact progress HUD, Start/Restart button, and existing 39-key clickable keyboard. Start remains disabled until audio is unlocked and a lesson is ready.

10. Make feedback accessible without relying only on color: correct bars receive a check treatment, missed bars receive a diagonal/cross treatment, and an `aria-live` status announces correct, missed, wrong, and completed events.

11. Replace the page-lifetime fixed WebMCP singleton with a mode-aware registration manager. Use an abort controller per catalog and a monotonically increasing registration generation so a stale asynchronous registration cannot overwrite the current mode.

12. Every Teach tool must verify that Teach Mode is still active before mutating state and accept an optional execution context using `ctx?.signal ?? fallbackSignal`. Invalid or aborted calls preserve the current lesson. A valid replacement lesson stops the current run only after validation succeeds.

13. If Teach tool registration fails, keep the human Teach UI functional, expose no mixed or fallback Play catalog, and display an agent-tools-unavailable status. Switching back to Play re-registers the original five tools.

14. Update the repository map and manual WebMCP evaluation fixtures. Preserve the existing Play Mode, score parser, JSON editor, audio engine, and agent score visualizer behavior.

## Test Plan

Add pure unit tests for strict lesson validation, no clamping/dropping, sorting without input mutation, duplicate rejection, boundary hits at ±300 ms, nearest-target selection, one-time consumption, chords, wrong-note behavior, missed deadlines, restart, clear, and completion accuracy.

Add input-router tests for repeat suppression, exact source release, two sources holding one pitch, replacing a source’s held key, blur cleanup, pointer cancellation, and mode-switch cleanup.

Add registration tests or a deterministic test harness proving:

- Play Mode exposes exactly five existing tools.
- Teach Mode exposes exactly `load_lesson`, `get_lesson_progress`, and `clear_lesson`.
- Rapid mode changes cannot leave a stale or mixed catalog.
- Partial registration failure aborts the whole new catalog.
- Missing `ctx` never throws.
- Invalid and aborted lessons preserve existing state.

Run:

```bash
npm run typecheck
npm test
npm run check
npm run build
npm run dev
```

Browser acceptance:

- Switch to Teach and verify normal editing/playback controls disappear.
- Load a lesson through WebMCP and verify it remains `ready`.
- Press Start and verify a four-beat count-in.
- Hit notes through both computer and pointer input.
- Verify correct bars become green, missed bars become red, and wrong notes only flash red.
- Hold the same pitch from two sources and verify releasing one does not stop the other.
- Clear the lesson and switch back to Play; verify the original five tools and normal visualizer return.
- Confirm there are no console errors, stuck notes, timer leaks, or animation loops after switching modes repeatedly.

## Assumptions

- The feature is named **Teach Mode**.
- The agent composes lessons; the human learner plays them.
- Timing uses beats plus BPM.
- Correctness grades pitch and onset only, with ±300 ms tolerance.
- Four-beat count-in is visual and does not add a metronome sound.
- Teach Mode supports computer keys and the existing clickable keyboard.
- Leaving Teach Mode cancels the active run, releases notes, resets results to `ready`, and retains the loaded lesson until clear or replacement.
- No MIDI, microphone pitch detection, lesson persistence, backend, adaptive difficulty, or cross-origin `exposedTo` configuration is included in this version.
