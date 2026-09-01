import { KEY_COUNT, westernToPitchClass } from "./pitch";

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
    const e = eventsRaw[i] as Record<string, unknown>;
    const t = typeof e.t === "number" && isFinite(e.t) && e.t >= 0 ? e.t : null;
    if (t === null) continue;
    let key: number | null = null;
    if (typeof e.key === "number" && Number.isInteger(e.key) && e.key >= 0 && e.key < KEY_COUNT) {
      key = e.key;
    }
    const note = typeof e.note === "string" ? e.note : "";
    const dur = typeof e.dur === "number" && isFinite(e.dur) && e.dur > 0 ? e.dur : 0.5;
    if (key === null) continue; // no trustworthy pitch -> drop the event
    events.push({ t, key, note, dur });
  }
  if (events.length === 0) {
    throw new Error("No valid events (each needs t >= 0 and integer key 0-38)");
  }
  events.sort((a, b) => a.t - b.t);
  return { sa, events };
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
