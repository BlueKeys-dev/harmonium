import * as Tone from "tone";
import { keyToWestern, KEY_COUNT } from "./pitch";

export type AudioSource = "samples" | "synth";
export type AudioLockState = "locked" | "unlocked";

type Listener = () => void;

/**
 * The one audio engine. Mouse, computer keyboard, JSON score playback and
 * WebMCP tools all go through playNote / stopNote here.
 */

// Chromatic anchors C3..D5, minus F#4 (missing from the upstream pack).
// Tone.Sampler retunes the nearest anchor for every other key.
const SAMPLE_NAMES = [
  "C3", "Cs3", "D3", "Ds3", "E3", "F3", "Fs3", "G3", "Gs3", "A3", "As3", "B3",
  "C4", "Cs4", "D4", "Ds4", "E4", "F4", "G4", "Gs4", "A4", "As4", "B4",
  "C5", "Cs5", "D5",
];

const FALLBACK_LOAD_MS = 12_000;
const POST_TAP_WAIT_MS = 6_000;

class HarmoniumEngine {
  private bus: Tone.Gain | null = null;
  private analyser: Tone.Analyser | null = null;
  private sampler: Tone.Sampler | null = null;
  private synth: Tone.PolySynth | null = null;

  private loadPromise: Promise<boolean> | null = null;
  private active = new Map<number, string>();
  private visualKeys = new Set<number>();
  private listeners = new Set<Listener>();

  lockState: AudioLockState = "locked";
  source: AudioSource | null = null;

  /** Kick off sample download early (no user gesture needed for network load). */
  preload(): void {
    this.ensureSampler();
  }

  private ensureSampler(): Promise<boolean> {
    if (this.loadPromise) return this.loadPromise;
    const urls: Record<string, string> = {};
    for (const n of SAMPLE_NAMES) {
      // File names use "Cs" for sharps; Tone note names use "#".
      urls[n.replace(/([A-G])s/, "$1#")] = `${n}.mp3`;
    }
    let resolveLoad!: (ok: boolean) => void;
    this.loadPromise = new Promise<boolean>((resolve) => {
      resolveLoad = resolve;
      setTimeout(() => resolve(false), FALLBACK_LOAD_MS);
    });
    this.sampler = new Tone.Sampler({
      urls,
      baseUrl: `${import.meta.env.BASE_URL}samples/harmonium/`,
      release: 0.4,
      onload: () => resolveLoad(true),
    }).connect(this.ensureBus());
    return this.loadPromise;
  }

  private ensureSynth(): Tone.PolySynth {
    if (!this.synth) {
      // Sustained reed-ish voice: detuned saw stack through a lowpass, slow-ish
      // attack and high sustain so it does not ping like a piano.
      const filter = new Tone.Filter(1800, "lowpass").connect(this.ensureBus());
      this.synth = new Tone.PolySynth({
        maxPolyphony: 32,
        voice: Tone.Synth,
        options: {
          oscillator: { type: "fatsawtooth", count: 3, spread: 26 },
          envelope: { attack: 0.015, decay: 0.2, sustain: 0.9, release: 0.45 },
        },
      }).connect(filter);
    }
    return this.synth;
  }

  private ensureBus(): Tone.Gain {
    if (!this.bus) {
      this.analyser = new Tone.Analyser("waveform", 256);
      this.bus = new Tone.Gain(0.7);
      this.bus.connect(this.analyser);
      this.bus.toDestination();
    }
    return this.bus;
  }

  /** Output level in dB (for status/tests); -120 = silence. JSON-safe (no -Infinity). */
  getLevel(): number {
    if (!this.analyser) return -120;
    const buf = this.analyser.getValue() as Float32Array;
    if (!buf || buf.length === 0) return -120;
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    if (!isFinite(rms) || rms <= 0) return -120;
    return 20 * Math.log10(rms);
  }

  private voice(): Tone.Sampler | Tone.PolySynth {
    return this.source === "synth" ? this.ensureSynth() : (this.sampler as Tone.Sampler);
  }

  private noteName(key: number): string {
    return keyToWestern(key);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getActiveKeys(): number[] {
    return [...this.visualKeys].sort((a, b) => a - b);
  }

  isKeyActive(key: number): boolean {
    return this.visualKeys.has(key);
  }

  /** Resume the AudioContext on a user gesture, then pick sampler or synth. */
  async unlock(): Promise<AudioSource> {
    if (this.lockState === "unlocked" && this.source) return this.source;
    await Tone.start();
    // Samples may still be downloading; wait a little, then fall back.
    const loaded = await Promise.race([
      this.ensureSampler(),
      new Promise<false>((r) => setTimeout(() => r(false), POST_TAP_WAIT_MS)),
    ]);
    if (loaded && this.sampler?.loaded) {
      this.source = "samples";
    } else {
      this.source = "synth";
      this.ensureSynth();
    }
    this.lockState = "unlocked";
    this.notify();
    return this.source;
  }

  /** Attack a key and sustain it until stopNote(key). No-op while locked. */
  playNote(key: number): void {
    if (this.lockState !== "unlocked" || key < 0 || key >= KEY_COUNT) return;
    const name = this.noteName(key);
    if (this.active.has(key)) return;
    this.active.set(key, name);
    try {
      this.voice().triggerAttack(name, Tone.now());
    } catch {
      this.active.delete(key);
      return;
    }
    this.visualKeys.add(key);
    this.notify();
  }

  stopNote(key: number): void {
    if (!this.active.has(key)) {
      if (this.visualKeys.delete(key)) this.notify();
      return;
    }
    const name = this.active.get(key);
    this.active.delete(key);
    try {
      this.voice().triggerRelease(name as string);
    } catch {
      /* voice already gone */
    }
    this.visualKeys.delete(key);
    this.notify();
  }

  stopAllNotes(): void {
    if (this.active.size > 0) {
      const v = this.voice();
      for (const name of this.active.values()) {
        try {
          v.triggerRelease(name);
        } catch {
          /* voice already gone */
        }
      }
      this.active.clear();
    }
    if (this.visualKeys.size > 0) {
      this.visualKeys.clear();
      this.notify();
    }
  }

  /**
   * Sample-accurate trigger used by score playback: attack at `time`
   * (audio-context seconds), auto-release after `dur` seconds.
   */
  triggerAt(key: number, dur: number, time: number): void {
    if (this.lockState !== "unlocked") return;
    if (!Number.isInteger(key) || key < 0 || key >= KEY_COUNT) return;
    const name = this.noteName(key);
    try {
      this.voice().triggerAttackRelease(name, Math.max(0.05, dur), time);
    } catch {
      /* out of voices */
    }
  }

  /** Visual-only key state, driven through Tone.Draw in sync with sound. */
  setKeyActive(key: number, active: boolean): void {
    if (key < 0 || key >= KEY_COUNT) return;
    const had = this.visualKeys.has(key);
    if (active && !had) {
      this.visualKeys.add(key);
      this.notify();
    } else if (!active && had) {
      this.visualKeys.delete(key);
      this.notify();
    }
  }

  clearVisualKeys(): void {
    if (this.visualKeys.size > 0) {
      this.visualKeys.clear();
      this.notify();
    }
  }
}

export const engine = new HarmoniumEngine();
