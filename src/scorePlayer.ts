import * as Tone from "tone";
import { engine } from "./audioEngine";
import { scoreDuration, type Score } from "./score";

export type ScoreStatusListener = (playing: boolean) => void;

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

    const total = scoreDuration(score);
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
