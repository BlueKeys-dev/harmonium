import { KEY_COUNT, westernToPitchClass } from "./pitch";

export const MAX_SCORE_JSON_CHARS = 1_000_000;
export const MAX_SCORE_EVENTS = 1_024;
export const MAX_SCORE_START_SECONDS = 1_800;
export const MAX_SCORE_EVENT_DURATION_SECONDS = 30;
export const MAX_SCORE_NOTE_CHARS = 80;

export interface ScoreEvent {
  t: number;
  key: number;
  note: string;
  dur: number;
}

export interface Score {
  sa: string | null;
  events: ScoreEvent[];
}

/**
 * Validates agent/human JSON into a Score. `key` is the source of truth for
 * pitch; `note` is advisory. Never throws on messy note strings — drops or
 * repairs events instead.
 */
export function parseScore(raw: string): Score {
  if (raw.length > MAX_SCORE_JSON_CHARS) {
    throw new Error(`Score JSON is too large (maximum ${MAX_SCORE_JSON_CHARS} characters)`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("Score must be an object: { sa, events: [...] }");
  }
  const obj = data as Record<string, unknown>;
  const eventsRaw = obj.events;
  if (!Array.isArray(eventsRaw) || eventsRaw.length === 0) {
    throw new Error("Score needs a non-empty events array");
  }
  if (eventsRaw.length > MAX_SCORE_EVENTS) {
    throw new Error(`Score has too many events (maximum ${MAX_SCORE_EVENTS})`);
  }

  let sa: string | null = null;
  if (typeof obj.sa === "string" && obj.sa.trim() !== "") {
    const name = obj.sa.trim().toUpperCase();
    if (westernToPitchClass(name) < 0) {
      throw new Error(
        `Invalid sa "${obj.sa.trim()}": use C, C#, D, D#, E, F, F#, G, G#, A, A#, B`,
      );
    }
    sa = name;
  }

  const events: ScoreEvent[] = [];
  for (let i = 0; i < eventsRaw.length; i++) {
    const candidate = eventsRaw[i];
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) continue;
    const e = candidate as Record<string, unknown>;
    const t =
      typeof e.t === "number" &&
      isFinite(e.t) &&
      e.t >= 0 &&
      e.t <= MAX_SCORE_START_SECONDS
        ? e.t
        : null;
    if (t === null) continue;
    let key: number | null = null;
    if (typeof e.key === "number" && Number.isInteger(e.key) && e.key >= 0 && e.key < KEY_COUNT) {
      key = e.key;
    }
    const note = typeof e.note === "string" ? e.note.slice(0, MAX_SCORE_NOTE_CHARS) : "";
    const dur =
      typeof e.dur === "number" && isFinite(e.dur) && e.dur > 0
        ? Math.min(e.dur, MAX_SCORE_EVENT_DURATION_SECONDS)
        : 0.5;
    if (key === null) continue; // no trustworthy pitch -> drop the event
    events.push({ t, key, note, dur });
  }
  if (events.length === 0) {
    throw new Error("No valid events (each needs t >= 0 and integer key 0-38)");
  }
  events.sort((a, b) => a.t - b.t);
  return { sa, events };
}

export function scoreDuration(score: Score): number {
  let total = 0;
  for (const event of score.events) {
    total = Math.max(total, event.t + event.dur);
  }
  if (!Number.isFinite(total)) throw new Error("Score duration must be finite");
  return total;
}

/** Built-in demo: Sa Re Ga Ma Pa Dha Ni Sa' up and back down. */
export function demoScoreText(): string {
  const seq = [12, 14, 16, 17, 19, 21, 23, 24, 23, 21, 19, 17, 14, 12];
  const names = [
    "Sa", "Re", "Ga", "Ma", "Pa", "Dha", "Ni", "Sa'",
    "Ni", "Dha", "Pa", "Ma", "Ga", "Re",
  ];
  const step = 0.45;
  const events = seq.map((key, i) => ({
    t: Math.round(i * step * 100) / 100,
    key,
    note: names[i],
    dur: i === seq.length - 1 ? 1.2 : 0.4,
  }));
  return JSON.stringify({ sa: "C", events }, null, 2);
}
