export const KEY_COUNT = 39;
export const MIDI_START = 48; // C3
export const MIDI_END = 86; // D6

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);

export type WesternName = (typeof SHARP_NAMES)[number];
export const SA_OPTIONS: WesternName[] = [...SHARP_NAMES];

/** Degree (0-11) relative to Sa -> Sargam label. */
const SARGAM_DEGREES = [
  "Sa",
  "komal Re",
  "Re",
  "komal Ga",
  "Ga",
  "Ma",
  "tivra Ma",
  "Pa",
  "komal Dha",
  "Dha",
  "komal Ni",
  "Ni",
] as const;

export type SargamName = (typeof SARGAM_DEGREES)[number];

export function keyToMidi(key: number): number {
  return MIDI_START + key;
}

export function midiToWestern(midi: number): string {
  return `${SHARP_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

export function westernToPitchClass(name: string): number {
  return SHARP_NAMES.indexOf(name.trim().toUpperCase() as WesternName);
}

export function isBlackKey(key: number): boolean {
  return BLACK_PITCH_CLASSES.has(keyToMidi(key) % 12);
}

export function keyToWestern(key: number): string {
  return midiToWestern(keyToMidi(key));
}

export function sargamForKey(key: number, saPitchClass: number): SargamName {
  const degree = (((keyToMidi(key) % 12) - saPitchClass) % 12 + 12) % 12;
  return SARGAM_DEGREES[degree];
}

/** Keyboard display: komal swaras drop the "komal " prefix and use lowercase. */
export function sargamDisplay(label: SargamName): string {
  return label.startsWith("komal ") ? label.slice(6).toLowerCase() : label;
}

/** Resolve a Sargam label (or Western note name) to a key index, given Sa. */
export function keyForSargam(label: string, saPitchClass: number): number | null {
  const norm = label.trim().toLowerCase();
  const degree = SARGAM_DEGREES.findIndex((d) => d.toLowerCase() === norm);
  let pitchClass: number;
  if (degree >= 0) {
    pitchClass = (saPitchClass + degree) % 12;
  } else {
    const base = norm.toUpperCase().match(/^([A-G][#]?)/);
    if (!base) return null;
    const pc = SHARP_NAMES.indexOf(base[1] as WesternName);
    if (pc < 0) return null;
    pitchClass = pc;
  }
  let best: number | null = null;
  for (let k = 0; k < KEY_COUNT; k++) {
    if (keyToMidi(k) % 12 === pitchClass) {
      // Prefer the octave nearest C4 (key 12) so agents land on a singable Sa.
      if (best === null || Math.abs(k - 12) < Math.abs(best - 12)) best = k;
    }
  }
  return best;
}

/**
 * Resolve an agent/tool input to a key index. An explicit integer key wins;
 * otherwise a Sargam note label resolves relative to Sa.
 */
export function resolveKey(input: { key?: unknown; note?: unknown }, saPitchClass: number): number | null {
  if (
    typeof input.key === "number" &&
    Number.isInteger(input.key) &&
    input.key >= 0 &&
    input.key < KEY_COUNT
  ) {
    return input.key;
  }
  if (typeof input.note === "string" && input.note.trim() !== "") {
    return keyForSargam(input.note, saPitchClass);
  }
  return null;
}

export interface KeyInfo {
  key: number;
  midi: number;
  isBlack: boolean;
  western: string;
  /** Index among white keys only, for layout. */
  whiteIndex: number;
  whiteCount: number;
}

export function buildKeyInfos(saPitchClass: number): Array<KeyInfo & { sargam: SargamName }> {
  const keys: Array<KeyInfo & { sargam: SargamName }> = [];
  let whiteIndex = 0;
  for (let k = 0; k < KEY_COUNT; k++) {
    const black = isBlackKey(k);
    keys.push({
      key: k,
      midi: keyToMidi(k),
      isBlack: black,
      western: keyToWestern(k),
      sargam: sargamForKey(k, saPitchClass),
      whiteIndex: black ? -1 : whiteIndex++,
      whiteCount: 0,
    });
  }
  for (const k of keys) k.whiteCount = whiteIndex;
  return keys;
}

// Self-check: the instrument must be 39 keys, 23 white, 16 black (C3..D6).
{
  const whites = Array.from({ length: KEY_COUNT }, (_, k) => !isBlackKey(k)).filter(Boolean).length;
  const blacks = KEY_COUNT - whites;
  if (KEY_COUNT !== 39 || whites !== 23 || blacks !== 16) {
    throw new Error(`Keyboard layout broken: ${KEY_COUNT} keys, ${whites} white, ${blacks} black`);
  }
  if (keyToWestern(12) !== "C4") {
    throw new Error(`Key 12 must be C4, got ${keyToWestern(12)}`);
  }
}
