import { engine } from "./audioEngine";
import { scorePlayer } from "./scorePlayer";
import {
  MAX_SCORE_EVENT_DURATION_SECONDS,
  MAX_SCORE_EVENTS,
  MAX_SCORE_NOTE_CHARS,
  MAX_SCORE_START_SECONDS,
  parseScore,
  type Score,
} from "./score";
import {
  SA_OPTIONS,
  sargamForKey,
  keyToWestern,
  westernToPitchClass,
  resolveKey,
} from "./pitch";

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

interface RegisterDeps {
  getSa: () => string;
  applySa: (sa: string) => void;
}

const LOCKED_MESSAGE =
  "Audio is locked. Ask the human to click the 'Tap to start' button in the web-harmonium page once; after that play_note and play_score will sound.";

const SARGAM_ENUM = [
  "Sa", "komal Re", "Re", "komal Ga", "Ga", "Ma", "tivra Ma", "Pa",
  "komal Dha", "Dha", "komal Ni", "Ni",
];

interface ModelContext {
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

/** Uniform tool result: every tool returns { ok, tool, error?, ...data }. */
function ok(tool: string, data: Record<string, unknown>): Record<string, unknown> {
  return { ok: true, tool, ...data };
}

function fail(tool: string, error: string): Record<string, unknown> {
  return { ok: false, tool, error };
}

function clampDur(v: unknown): number {
  if (typeof v !== "number" || !isFinite(v)) return 2;
  return Math.min(10, Math.max(0.1, v));
}

async function registerWebMCPTools(deps: RegisterDeps): Promise<WebMCPRegistration> {
  const modelContext =
    (document as unknown as { modelContext?: ModelContext }).modelContext ??
    (navigator as unknown as { modelContext?: ModelContext }).modelContext;

  if (!modelContext || typeof modelContext.registerTool !== "function") {
    return { status: { state: "unavailable" }, unregister: () => {} };
  }

  const controller = new AbortController();

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
        dur: { type: "number", description: "Seconds to hold the reed before releasing. Default 2." },
      },
      anyOf: [{ required: ["key"] }, { required: ["note"] }],
    },
    annotations: { readOnlyHint: false },
    execute: async (input, ctx) => {
      const signal = ctx?.signal ?? NEVER_ABORTED_SIGNAL;
      if (signal.aborted) return fail("play_note", "Tool call was aborted.");
      if (engine.lockState !== "unlocked") return fail("play_note", LOCKED_MESSAGE);
      const saPc = Math.max(0, westernToPitchClass(deps.getSa()));
      const key = resolveKey(input ?? {}, saPc);
      if (key === null) {
        return fail(
          "play_note",
          "Invalid input: give key (integer 0-38) or note (Sargam name like 'Sa', 'komal Re').",
        );
      }
      const dur = clampDur((input as { dur?: unknown }).dur);
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
      "Play a JSON score { sa, events: [{ t, key, note, dur }] } on the visible keyboard with audio-clock timing. t and dur are seconds; key 0-38 is the pitch source of truth; note is an advisory Sargam label; overlapping events are chords. Requires the human to have tapped 'Tap to start' for audio.",
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
    annotations: { readOnlyHint: false },
    execute: async (input, ctx) => {
      const signal = ctx?.signal ?? NEVER_ABORTED_SIGNAL;
      if (signal.aborted) return fail("play_score", "Tool call was aborted.");
      if (engine.lockState !== "unlocked") return fail("play_score", LOCKED_MESSAGE);
      let score: Score;
      try {
        score = parseScore(JSON.stringify(input ?? {}));
      } catch (e) {
        return fail("play_score", `Invalid score: ${(e as Error).message}`);
      }
      let summary: { events: number; duration: number };
      try {
        summary = scorePlayer.play(score, deps.applySa);
      } catch (e) {
        return fail("play_score", `Could not play score: ${(e as Error).message}`);
      }
      if (signal.aborted) {
        scorePlayer.stop();
        return fail("play_score", "Tool call was aborted.");
      }
      signal.addEventListener("abort", () => scorePlayer.stop(), { once: true });
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
      "Set the movable tonic Sa for Sargam labels on the visible keyboard. Relabels only; frequencies never retune.",
    inputSchema: {
      type: "object",
      properties: {
        sa: { type: "string", enum: [...SA_OPTIONS], description: "Western note name that becomes Sa" },
      },
      required: ["sa"],
    },
    annotations: { readOnlyHint: false },
    execute: async (input) => {
      const sa = String((input as { sa?: unknown })?.sa ?? "").trim().toUpperCase();
      if (westernToPitchClass(sa) < 0) {
        return fail("set_sa", `Invalid sa: use one of ${SA_OPTIONS.join(", ")}`);
      }
      deps.applySa(sa);
      return ok("set_sa", { sa, relabeled: true, retuned: false });
    },
  };

  const stopTool: ToolDef = {
    name: "stop",
    description: "Stop all sounding reeds and any score playback on the visible keyboard.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: false },
    execute: async () => {
      scorePlayer.stop();
      return ok("stop", { stopped: true });
    },
  };

  const getStateTool: ToolDef = {
    name: "get_state",
    description: "Read the web-harmonium state: current Sa, audio lock, active keys, score playback.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () =>
      ok("get_state", {
        sa: deps.getSa(),
        audioUnlocked: engine.lockState === "unlocked",
        audioSource: engine.source,
        activeKeys: engine.getActiveKeys(),
        scorePlaying: scorePlayer.isPlaying(),
      }),
  };

  const tools = [playNoteTool, playScoreTool, setSaTool, stopTool, getStateTool];
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

let pendingRegistration: Promise<WebMCPRegistration> | null = null;
let unregisterCurrent = () => {};
let moduleDisposed = false;

/** Register once for this document, even when React StrictMode re-runs effects. */
export function ensureWebMCPTools(deps: RegisterDeps): Promise<WebMCPRegistration> {
  if (!pendingRegistration) {
    pendingRegistration = registerWebMCPTools(deps)
      .then((registration): WebMCPRegistration => {
        if (moduleDisposed) {
          registration.unregister();
          return { status: { state: "unavailable" }, unregister: () => {} };
        }
        unregisterCurrent = registration.unregister;
        return registration;
      })
      .catch((e: unknown): WebMCPRegistration => {
        pendingRegistration = null;
        return {
          status: { state: "error", message: String((e as Error)?.message ?? e) },
          unregister: () => {},
        };
      });
  }
  return pendingRegistration;
}

// Vite replaces modules without unloading the page. Dispose only for HMR;
// React component cleanup must leave page-lifetime tools registered.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    moduleDisposed = true;
    unregisterCurrent();
  });
}
