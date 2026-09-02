import { engine } from "./audioEngine";
import { scorePlayer } from "./scorePlayer";
import {
  MAX_SCORE_EVENT_DURATION_SECONDS,
  MAX_SCORE_EVENTS,
  MAX_SCORE_NOTE_CHARS,
  MAX_SCORE_START_SECONDS,
  parseWebMCPScore,
  type Score,
} from "./score";
import {
  SA_OPTIONS,
  sargamForKey,
  keyToWestern,
  westernToPitchClass,
  resolveKey,
} from "./pitch";
import {
  MAX_TEACH_BEAT,
  MAX_TEACH_NOTES,
  getTeachProgress,
  parseTeachLesson,
  type TeachLesson,
  type TeachSessionState,
} from "./teachSession";
import type { AppMode } from "./types";

/**
 * In-page WebMCP tools. The page is the tool server: an agent visiting this
 * tab calls the same playNote/stopNote engine the human drives.
 *
 * Everything here is behind feature detection — no WebMCP API means the human
 * UI keeps working and this module is a no-op.
 */

export type WebMCPStatus =
  | { state: "unavailable" }
  | { state: "registered"; tools: string[] }
  | { state: "error"; message: string };

interface WebMCPRegistration {
  status: WebMCPStatus;
  unregister: () => void;
}

export interface WebMCPDeps {
  getMode: () => AppMode;
  getSa: () => string;
  applySa: (sa: string) => void | Promise<void>;
  applyScore: (score: Score) => void | Promise<void>;
  applyTeachLesson: (lesson: TeachLesson) => void | Promise<void>;
  getTeachSession: () => TeachSessionState;
  clearTeachLesson: () => void | Promise<void>;
  waitForVisibleCommit: () => Promise<void>;
}

const LOCKED_MESSAGE =
  "Audio is locked. Ask the human to click the 'Tap to start' button in the web-harmonium page once; after that play_note and play_score will sound.";

const SARGAM_ENUM = [
  "Sa", "komal Re", "Re", "komal Ga", "Ga", "Ma", "tivra Ma", "Pa",
  "komal Dha", "Dha", "komal Ni", "Ni",
];

export interface ModelContext {
  registerTool: (tool: ToolDef, options?: { signal?: AbortSignal }) => Promise<void>;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  execute: (input: unknown, ctx?: { signal?: AbortSignal }) => Promise<unknown>;
}

const NEVER_ABORTED_SIGNAL = new AbortController().signal;
const MAX_PROGRESS_NOTES = 12;
const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, untrustedContentHint: false };
const MUTATING_ANNOTATIONS = { readOnlyHint: false, untrustedContentHint: false };

/** Uniform tool result: every tool returns { ok, tool, error?, ...data }. */
function ok(tool: string, data: Record<string, unknown>): Record<string, unknown> {
  return { ok: true, tool, ...data };
}

function fail(tool: string, error: string): Record<string, unknown> {
  return { ok: false, tool, error };
}

function parseNoteDuration(value: unknown): number {
  if (value === undefined) return 2;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0.1 || value > 10) {
    throw new Error("dur must be from 0.1 to 10 seconds; omit it to use 2 seconds");
  }
  return value;
}

async function registerWebMCPTools(
  mode: AppMode,
  deps: WebMCPDeps,
  modelContext: ModelContext,
  controller: AbortController,
): Promise<WebMCPRegistration> {
  const requireMode = (expected: AppMode, tool: string): Record<string, unknown> | null =>
    deps.getMode() === expected
      ? null
      : fail(
          tool,
          `This tool is available in ${expected === "teach" ? "Teach" : "Play"} Mode. Ask the learner to switch the page, then retry.`,
        );

  const playNoteTool: ToolDef = {
    name: "play_note",
    description:
      "Play one harmonium reed on the visible 39-key keyboard: it sounds and the key lights up. Requires the human to have tapped 'Tap to start' for audio.",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "integer",
          minimum: 0,
          maximum: 38,
          description:
            "Key index 0-38 (key 0 = C3, key 12 = C4 = Sa when Sa is C). Required unless note is given.",
        },
        note: {
          type: "string",
          enum: SARGAM_ENUM,
          description: "Sargam name relative to current Sa, e.g. 'Sa'. Used only when key is absent.",
        },
        dur: {
          type: "number",
          minimum: 0.1,
          maximum: 10,
          description: "Seconds to hold the reed, from 0.1 to 10. Omit it to use 2 seconds.",
        },
      },
      anyOf: [{ required: ["key"] }, { required: ["note"] }],
    },
    annotations: MUTATING_ANNOTATIONS,
    execute: async (input, ctx) => {
      const signal = ctx?.signal ?? NEVER_ABORTED_SIGNAL;
      if (signal.aborted) return fail("play_note", "Tool call was aborted.");
      const inactive = requireMode("play", "play_note");
      if (inactive) return inactive;
      const saPc = Math.max(0, westernToPitchClass(deps.getSa()));
      const key = resolveKey(input ?? {}, saPc);
      if (key === null) {
        return fail(
          "play_note",
          "Invalid input: give key (integer 0-38) or note (Sargam name like 'Sa', 'komal Re').",
        );
      }
      let dur: number;
      try {
        dur = parseNoteDuration((input as { dur?: unknown }).dur);
      } catch (e) {
        return fail("play_note", (e as Error).message);
      }
      if (engine.lockState !== "unlocked") return fail("play_note", LOCKED_MESSAGE);
      if (!engine.playNote(key)) {
        return fail("play_note", "That key is already sounding; wait for it to be released.");
      }
      let finished = false;
      let release = 0;
      const onAbort = () => {
        window.clearTimeout(release);
        finish();
      };
      const finish = () => {
        if (finished) return;
        finished = true;
        signal.removeEventListener("abort", onAbort);
        engine.stopNote(key);
      };
      release = window.setTimeout(finish, dur * 1000);
      if (signal !== NEVER_ABORTED_SIGNAL) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
      try {
        await deps.waitForVisibleCommit();
      } catch (e) {
        finish();
        return fail("play_note", `The note started but its visible state could not update: ${(e as Error).message}`);
      }
      if (signal.aborted) return fail("play_note", "Tool call was aborted and the note was released.");
      return ok("play_note", {
        key,
        note: sargamForKey(key, saPc),
        western: keyToWestern(key),
        dur,
        sa: deps.getSa(),
      });
    },
  };

  const playScoreTool: ToolDef = {
    name: "play_score",
    description:
      "Play a timed score on the visible harmonium after audio is unlocked. Use seconds for t and dur, key 0-38 for pitch, and equal t values for chords.",
    inputSchema: {
      type: "object",
      properties: {
        sa: {
          type: "string",
          enum: [...SA_OPTIONS],
          description: "Movable tonic for labels, e.g. 'C'. Updates the page's Sa; pitches never retune.",
        },
        events: {
          type: "array",
          minItems: 1,
          maxItems: MAX_SCORE_EVENTS,
          items: {
            type: "object",
            properties: {
              t: {
                type: "number",
                minimum: 0,
                maximum: MAX_SCORE_START_SECONDS,
                description: "Start time in seconds from playback start",
              },
              key: { type: "integer", minimum: 0, maximum: 38, description: "Key index 0-38 (source of truth for pitch)" },
              note: {
                type: "string",
                maxLength: MAX_SCORE_NOTE_CHARS,
                description: "Advisory Sargam label; pitch always comes from key",
              },
              dur: {
                type: "number",
                exclusiveMinimum: 0,
                maximum: MAX_SCORE_EVENT_DURATION_SECONDS,
                description: "Duration in seconds",
              },
            },
            required: ["t", "key", "dur"],
          },
        },
      },
      required: ["events"],
    },
    annotations: MUTATING_ANNOTATIONS,
    execute: async (input, ctx) => {
      const signal = ctx?.signal ?? NEVER_ABORTED_SIGNAL;
      if (signal.aborted) return fail("play_score", "Tool call was aborted.");
      const inactive = requireMode("play", "play_score");
      if (inactive) return inactive;
      let score: Score;
      try {
        score = parseWebMCPScore(input ?? {});
      } catch (e) {
        return fail("play_score", `Invalid score: ${(e as Error).message}`);
      }
      if (engine.lockState !== "unlocked") return fail("play_score", LOCKED_MESSAGE);
      let summary: { events: number; duration: number };
      try {
        summary = scorePlayer.play(score);
      } catch (e) {
        return fail("play_score", `Could not play score: ${(e as Error).message}`);
      }
      if (signal.aborted) {
        scorePlayer.stop();
        return fail("play_score", "Tool call was aborted.");
      }
      try {
        await deps.applyScore(score);
      } catch (e) {
        scorePlayer.stop();
        return fail("play_score", `Could not apply score: ${(e as Error).message}`);
      }

      const onAbort = () => scorePlayer.stop();
      let unsubscribe = () => {};
      unsubscribe = scorePlayer.subscribe((playing) => {
        if (playing) return;
        signal.removeEventListener("abort", onAbort);
        unsubscribe();
      });
      signal.addEventListener("abort", onAbort, { once: true });
      return ok("play_score", {
        events: summary.events,
        durationSeconds: Math.round(summary.duration * 100) / 100,
        sa: score.sa ?? deps.getSa(),
      });
    },
  };

  const setSaTool: ToolDef = {
    name: "set_sa",
    description:
      "Set the movable tonic used by visible Sargam labels while keeping every keyboard key at its existing pitch.",
    inputSchema: {
      type: "object",
      properties: {
        sa: { type: "string", enum: [...SA_OPTIONS], description: "Western note name that becomes Sa" },
      },
      required: ["sa"],
    },
    annotations: MUTATING_ANNOTATIONS,
    execute: async (input, ctx) => {
      const signal = ctx?.signal ?? NEVER_ABORTED_SIGNAL;
      if (signal.aborted) return fail("set_sa", "Tool call was aborted.");
      const inactive = requireMode("play", "set_sa");
      if (inactive) return inactive;
      const sa = String((input as { sa?: unknown })?.sa ?? "").trim().toUpperCase();
      if (westernToPitchClass(sa) < 0) {
        return fail("set_sa", `Invalid sa: use one of ${SA_OPTIONS.join(", ")}`);
      }
      try {
        await deps.applySa(sa);
      } catch (e) {
        return fail("set_sa", `Could not update the visible tonic: ${(e as Error).message}`);
      }
      return ok("set_sa", { sa, relabeled: true, retuned: false });
    },
  };

  const stopTool: ToolDef = {
    name: "stop",
    description: "Stop all sounding reeds and any score playback on the visible keyboard.",
    inputSchema: { type: "object", properties: {} },
    annotations: MUTATING_ANNOTATIONS,
    execute: async (_input, ctx) => {
      const signal = ctx?.signal ?? NEVER_ABORTED_SIGNAL;
      if (signal.aborted) return fail("stop", "Tool call was aborted.");
      const inactive = requireMode("play", "stop");
      if (inactive) return inactive;
      scorePlayer.stop();
      await deps.waitForVisibleCommit();
      return ok("stop", { stopped: true });
    },
  };

  const getStateTool: ToolDef = {
    name: "get_state",
    description: "Read the web-harmonium state: current Sa, audio lock, active keys, score playback.",
    inputSchema: { type: "object", properties: {} },
    annotations: READ_ONLY_ANNOTATIONS,
    execute: async (_input, ctx) => {
      const signal = ctx?.signal ?? NEVER_ABORTED_SIGNAL;
      if (signal.aborted) return fail("get_state", "Tool call was aborted.");
      const inactive = requireMode("play", "get_state");
      if (inactive) return inactive;
      return ok("get_state", {
        sa: deps.getSa(),
        audioUnlocked: engine.lockState === "unlocked",
        audioSource: engine.source,
        activeKeys: engine.getActiveKeys(),
        scorePlaying: scorePlayer.isPlaying(),
      });
    },
  };

  const loadLessonTool: ToolDef = {
    name: "load_lesson",
    description:
      "Create or replace the visible Teach Mode exercise in a ready state. Use beat-timed notes; after success, the learner starts it from the page.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          minLength: 1,
          maxLength: 80,
          description: "Short learner-facing exercise name. Defaults to Teach lesson.",
        },
        sa: {
          type: "string",
          enum: [...SA_OPTIONS],
          description: "Movable tonic used for visible Sargam labels. Defaults to the page's current Sa.",
        },
        bpm: {
          type: "integer",
          minimum: 40,
          maximum: 240,
          description: "Lesson tempo in beats per minute; the four-beat count-in uses this tempo.",
        },
        notes: {
          type: "array",
          minItems: 1,
          maxItems: MAX_TEACH_NOTES,
          description: "Target notes. Use the same startBeat for chord notes; provide key or western for each note.",
          items: {
            type: "object",
            properties: {
              key: {
                type: "integer",
                minimum: 0,
                maximum: 38,
                description: "Exact harmonium key, where 0 is C3 and 12 is C4. Use western instead when that is more natural.",
              },
              western: {
                type: "string",
                description: "Exact Western note with octave from C3 through D6, using sharps, for example C4 or F#5.",
              },
              startBeat: {
                type: "number",
                minimum: 0,
                maximum: MAX_TEACH_BEAT,
                description: "Beat when the note reaches the strike line; beat zero follows the four-beat count-in.",
              },
              durationBeats: {
                type: "number",
                minimum: 0.125,
                maximum: 16,
                description: "Visible note-bar length in beats; onset timing, rather than hold length, determines correctness.",
              },
            },
            anyOf: [{ required: ["key"] }, { required: ["western"] }],
            required: ["startBeat", "durationBeats"],
          },
        },
      },
      required: ["bpm", "notes"],
    },
    annotations: MUTATING_ANNOTATIONS,
    execute: async (input, ctx) => {
      const signal = ctx?.signal ?? NEVER_ABORTED_SIGNAL;
      if (signal.aborted) return fail("load_lesson", "Tool call was aborted.");
      const inactive = requireMode("teach", "load_lesson");
      if (inactive) return inactive;
      let lesson: TeachLesson;
      try {
        lesson = parseTeachLesson(input, deps.getSa(), createLessonId());
      } catch (e) {
        return fail("load_lesson", `Invalid lesson: ${(e as Error).message}`);
      }
      if (signal.aborted) return fail("load_lesson", "Tool call was aborted.");
      try {
        await deps.applyTeachLesson(lesson);
      } catch (e) {
        return fail("load_lesson", `The lesson is valid but could not be shown: ${(e as Error).message}`);
      }
      return ok("load_lesson", {
        lessonId: lesson.id,
        title: lesson.title,
        sa: lesson.sa,
        bpm: lesson.bpm,
        noteCount: lesson.notes.length,
        durationBeats: lesson.durationBeats,
        phase: "ready",
      });
    },
  };

  const getLessonProgressTool: ToolDef = {
    name: "get_lesson_progress",
    description:
      "Read the visible Teach Mode result summary and one bounded page of note outcomes. Use nextCursor to continue when more results remain.",
    inputSchema: {
      type: "object",
      properties: {
        cursor: {
          type: "integer",
          minimum: 0,
          description: "Zero-based note offset returned as nextCursor by the previous call. Defaults to 0.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_PROGRESS_NOTES,
          description: `Number of note outcomes to return, from 1 to ${MAX_PROGRESS_NOTES}. Defaults to ${MAX_PROGRESS_NOTES}.`,
        },
      },
    },
    annotations: READ_ONLY_ANNOTATIONS,
    execute: async (input, ctx) => {
      const signal = ctx?.signal ?? NEVER_ABORTED_SIGNAL;
      if (signal.aborted) return fail("get_lesson_progress", "Tool call was aborted.");
      const inactive = requireMode("teach", "get_lesson_progress");
      if (inactive) return inactive;
      const args = typeof input === "object" && input !== null && !Array.isArray(input)
        ? input as { cursor?: unknown; limit?: unknown }
        : {};
      const cursor = args.cursor === undefined ? 0 : args.cursor;
      const limit = args.limit === undefined ? MAX_PROGRESS_NOTES : args.limit;
      if (!Number.isInteger(cursor) || (cursor as number) < 0) {
        return fail("get_lesson_progress", "cursor must be a non-negative integer; use 0 for the first page.");
      }
      if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > MAX_PROGRESS_NOTES) {
        return fail("get_lesson_progress", `limit must be an integer from 1 to ${MAX_PROGRESS_NOTES}.`);
      }
      const cursorNumber = cursor as number;
      const limitNumber = limit as number;
      const progress = getTeachProgress(deps.getTeachSession(), performance.now());
      if (cursorNumber > progress.notes.length) {
        return fail(
          "get_lesson_progress",
          `cursor exceeds ${progress.notes.length} lesson notes; use 0 or a returned nextCursor.`,
        );
      }
      const notes = progress.notes.slice(cursorNumber, cursorNumber + limitNumber);
      const nextCursor = cursorNumber + notes.length < progress.notes.length
        ? cursorNumber + notes.length
        : null;
      return ok("get_lesson_progress", {
        ...progress,
        notes,
        page: { cursor: cursorNumber, nextCursor, total: progress.notes.length },
      });
    },
  };

  const clearLessonTool: ToolDef = {
    name: "clear_lesson",
    description:
      "Clear the visible Teach Mode exercise and return the page to its empty lesson state. Use when the learner wants a fresh exercise.",
    inputSchema: { type: "object", properties: {} },
    annotations: MUTATING_ANNOTATIONS,
    execute: async (_input, ctx) => {
      const signal = ctx?.signal ?? NEVER_ABORTED_SIGNAL;
      if (signal.aborted) return fail("clear_lesson", "Tool call was aborted.");
      const inactive = requireMode("teach", "clear_lesson");
      if (inactive) return inactive;
      try {
        await deps.clearTeachLesson();
      } catch (e) {
        return fail("clear_lesson", `Could not clear the visible lesson: ${(e as Error).message}`);
      }
      return ok("clear_lesson", { cleared: true, phase: "empty" });
    },
  };

  const tools = mode === "play"
    ? [playNoteTool, playScoreTool, setSaTool, stopTool, getStateTool]
    : [loadLessonTool, getLessonProgressTool, clearLessonTool];
  const registered: string[] = [];

  try {
    for (const tool of tools) {
      await modelContext.registerTool(tool, { signal: controller.signal });
      registered.push(tool.name);
    }
  } catch (e) {
    if (controller.signal.aborted) {
      return { status: { state: "unavailable" }, unregister: () => {} };
    }
    // Roll back tools registered earlier in this batch. A partial catalog must
    // not be reported as healthy or keep callbacks to stale app state.
    controller.abort();
    return {
      status: { state: "error", message: String((e as Error)?.message ?? e) },
      unregister: () => {},
    };
  }

  return {
    status: { state: "registered", tools: registered },
    unregister: () => controller.abort(),
  };
}

let lessonSequence = 0;

function createLessonId(): string {
  lessonSequence += 1;
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `lesson-${Date.now()}-${lessonSequence}`;
}

function currentModelContext(): ModelContext | null {
  const context =
    (document as unknown as { modelContext?: ModelContext }).modelContext ??
    (navigator as unknown as { modelContext?: ModelContext }).modelContext;
  return context && typeof context.registerTool === "function" ? context : null;
}

export class WebMCPRegistrar {
  private generation = 0;
  private controller: AbortController | null = null;
  private disposed = false;

  async setMode(
    mode: AppMode,
    deps: WebMCPDeps,
    modelContext: ModelContext | null = currentModelContext(),
  ): Promise<WebMCPRegistration> {
    const generation = ++this.generation;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    if (!modelContext) {
      return { status: { state: "unavailable" }, unregister: () => controller.abort() };
    }

    const registration = await registerWebMCPTools(mode, deps, modelContext, controller);
    if (this.disposed || generation !== this.generation) {
      registration.unregister();
      return { status: { state: "unavailable" }, unregister: () => {} };
    }
    return registration;
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
  }
}

const webmcpRegistrar = new WebMCPRegistrar();

/** Replace the registered catalog atomically when the human changes mode. */
export function setWebMCPMode(mode: AppMode, deps: WebMCPDeps): Promise<WebMCPRegistration> {
  return webmcpRegistrar.setMode(mode, deps).catch((e: unknown): WebMCPRegistration => ({
    status: { state: "error", message: String((e as Error)?.message ?? e) },
    unregister: () => {},
  }));
}

// Vite replaces modules without unloading the page. Dispose only for HMR;
// React component cleanup must leave page-lifetime tools registered.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    webmcpRegistrar.dispose();
  });
}
