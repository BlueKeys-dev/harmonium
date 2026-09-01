import { engine } from "./audioEngine";
import { parseScore, scorePlayer, type Score } from "./scorePlayer";
import { SA_OPTIONS, sargamForKey, keyForSargam, keyToWestern, westernToPitchClass, KEY_COUNT } from "./pitch";

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

function clampDur(v: unknown): number {
  if (typeof v !== "number" || !isFinite(v)) return 2;
  return Math.min(10, Math.max(0.1, v));
}

function resolveKey(input: { key?: unknown; note?: unknown }, saPc: number): number | null {
  if (
    typeof input.key === "number" &&
    Number.isInteger(input.key) &&
    input.key >= 0 &&
    input.key < KEY_COUNT
  ) {
    return input.key;
  }
  if (typeof input.note === "string" && input.note.trim() !== "") {
    return keyForSargam(input.note, saPc);
  }
  return null;
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
    execute: async (input) => {
      if (engine.lockState !== "unlocked") return LOCKED_MESSAGE;
      const saPc = westernToPitchClass(deps.getSa());
      const key = resolveKey(input ?? {}, saPc >= 0 ? saPc : 0);
      if (key === null) {
        return "Invalid input: give key (integer 0-38) or note (Sargam name like 'Sa', 'komal Re').";
      }
      const dur = clampDur((input as { dur?: unknown }).dur);
      engine.playNote(key);
      window.setTimeout(() => engine.stopNote(key), dur * 1000);
      return {
        ok: true,
        key,
        note: sargamForKey(key, saPc >= 0 ? saPc : 0),
        western: keyToWestern(key),
        dur,
      };
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
    execute: async (input, { signal }) => {
      if (engine.lockState !== "unlocked") return LOCKED_MESSAGE;
      let score: Score;
      try {
        score = parseScore(JSON.stringify(input ?? {}));
      } catch (e) {
        return `Invalid score: ${(e as Error).message}`;
      }
      let summary: { events: number; duration: number };
      try {
        summary = scorePlayer.play(score, deps.applySa);
      } catch (e) {
        return `Could not play score: ${(e as Error).message}`;
      }
      signal.addEventListener("abort", () => scorePlayer.stop(), { once: true });
      return {
        ok: true,
        events: summary.events,
        durationSeconds: Math.round(summary.duration * 100) / 100,
        sa: score.sa ?? deps.getSa(),
      };
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
    execute: async (input) => {
      const sa = String((input as { sa?: unknown })?.sa ?? "").trim().toUpperCase();
      if (westernToPitchClass(sa) < 0) {
        return `Invalid sa: use one of ${SA_OPTIONS.join(", ")}`;
      }
      deps.applySa(sa);
      return { ok: true, sa, relabeled: true, retuned: false };
    },
  };

  const stopTool: ToolDef = {
    name: "stop",
    description: "Stop all sounding reeds and any score playback on the visible keyboard.",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      scorePlayer.stop();
      return { ok: true, stopped: true };
    },
  };

  const getStateTool: ToolDef = {
    name: "get_state",
    description: "Read the web-harmonium state: current Sa, audio lock, active keys, score playback.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => ({
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
