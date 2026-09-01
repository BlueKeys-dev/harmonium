import * as Tone from "tone";
import { engine } from "./audioEngine";
import { KEY_COUNT } from "./pitch";

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

export type ScoreStatusListener = (playing: boolean) => void;

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
    sa = obj.sa.trim();
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

export class ScorePlayer {
  private part: Tone.Part | null = null;
  private endId: number | null = null;
  private playingFlag = false;
  private generation = 0;
  private listeners = new Set<ScoreStatusListener>();

  isPlaying(): boolean {
    return this.playingFlag;
  }

  subscribe(l: ScoreStatusListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private setPlaying(p: boolean): void {
    if (this.playingFlag !== p) {
      this.playingFlag = p;
      for (const l of this.listeners) l(p);
    }
  }

  /**
   * Play a validated score on the audio clock (Tone.Transport), lighting keys
   * through Tone.Draw so visuals match the sound.
   */
  play(score: Score, applySa: (sa: string) => void): { events: number; duration: number } {
    if (engine.lockState !== "unlocked") {
      throw new Error("Audio locked: the human must tap 'Tap to start' in the page first");
    }
    this.stop();
    if (score.sa) applySa(score.sa);

    const transport = Tone.getTransport();
    transport.stop();
    transport.cancel(0);

    const draw = Tone.getDraw();
    const gen = ++this.generation;
    const live = () => gen === this.generation;
    this.part = new Tone.Part((time, ev) => {
      engine.triggerAt(ev.key, ev.dur, time);
      draw.schedule(() => {
        if (live()) engine.setKeyActive(ev.key, true);
      }, time);
      draw.schedule(() => {
        if (live()) engine.setKeyActive(ev.key, false);
      }, time + ev.dur);
    }, score.events.map((e) => ({ time: e.t, key: e.key, note: e.note, dur: e.dur })));

    const last = score.events[score.events.length - 1];
    const total = last.t + last.dur;
    this.endId = transport.scheduleOnce((time) => {
      draw.schedule(() => this.stop(), time);
    }, total + 0.02);

    this.part.start(0);
    transport.start();
    this.setPlaying(true);
    return { events: score.events.length, duration: total };
  }

  /** Stop playback, cancel future events, release held reeds. */
  stop(): void {
    // Invalidate any in-flight visual callbacks from this playback.
    this.generation++;
    if (this.part) {
      this.part.dispose();
      this.part = null;
    }
    const transport = Tone.getTransport();
    if (this.endId !== null) {
      transport.clear(this.endId);
      this.endId = null;
    }
    transport.stop();
    transport.cancel(0);
    Tone.getDraw().cancel();
    engine.stopAllNotes();
    this.setPlaying(false);
  }
}

export const scorePlayer = new ScorePlayer();
