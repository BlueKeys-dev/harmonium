import { engine } from "./audioEngine";
import { scorePlayer } from "./scorePlayer";
import { parseScore, type Score } from "./score";
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
  execute: (input: unknown, ctx: { signal: AbortSignal }) => Promise<unknown>;
}

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

export async function registerWebMCPTools(
  deps: RegisterDeps,
): Promise<{ status: WebMCPStatus; unregister: () => void }> {
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
    execute: async (input, { signal }) => {
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
      engine.playNote(key);
      const release = window.setTimeout(() => engine.stopNote(key), dur * 1000);
      signal.addEventListener(
        "abort",
        () => {
          window.clearTimeout(release);
          engine.stopNote(key);
        },
        { once: true },
      );
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
          items: {
            type: "object",
            properties: {
              t: { type: "number", description: "Start time in seconds from playback start" },
              key: { type: "integer", minimum: 0, maximum: 38, description: "Key index 0-38 (source of truth for pitch)" },
              note: { type: "string", description: "Advisory Sargam label; pitch always comes from key" },
              dur: { type: "number", description: "Duration in seconds" },
            },
            required: ["t", "key", "dur"],
          },
        },
      },
      required: ["events"],
    },
    annotations: { readOnlyHint: false },
    execute: async (input, { signal }) => {
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
    return {
      status: { state: "error", message: String((e as Error)?.message ?? e) },
      unregister: () => controller.abort(),
    };
  }

  return {
    status: { state: "registered", tools: registered },
    unregister: () => controller.abort(),
  };
}
