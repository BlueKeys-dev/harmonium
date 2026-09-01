import {
  KEY_COUNT,
  MIDI_START,
  MIDI_END,
  isBlackKey,
  keyToWestern,
  keyForSargam,
  sargamForKey,
  buildKeyInfos,
} from "../src/pitch";

const keys = Array.from({ length: KEY_COUNT }, (_, k) => k);
const whites = keys.filter((k) => !isBlackKey(k));
const blacks = keys.filter((k) => isBlackKey(k));

const checks: Array<[string, boolean]> = [
  ["39 keys", KEY_COUNT === 39],
  ["MIDI range 48..86", MIDI_START === 48 && MIDI_END === 86],
  ["23 white keys", whites.length === 23],
  ["16 black keys", blacks.length === 16],
  ["key 0 = C3", keyToWestern(0) === "C3"],
  ["key 12 = C4", keyToWestern(12) === "C4"],
  ["key 38 = D6", keyToWestern(38) === "D6"],
  ["Sa=C: key 12 is Sa", sargamForKey(12, 0) === "Sa"],
  ["Sa=C: key 13 is komal Re", sargamForKey(13, 0) === "komal Re"],
  ["Sa=G: key 19 (G4) is Sa", sargamForKey(19, 7) === "Sa"],
  ["keyForSargam('Sa', Sa=C) = 12", keyForSargam("Sa", 0) === 12],
  ["keyForSargam('komal Re', Sa=C) = 13", keyForSargam("komal Re", 0) === 13],
  ["keyForSargam('Sa', Sa=G) = 7 (G3 is the G nearest C4)", keyForSargam("Sa", 7) === 7],
  ["layout buildable", buildKeyInfos(0).length === 39],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failed++;
}

// Black keys must come in 2+3 groups per octave.
const pattern = keys.map((k) => (isBlackKey(k) ? "b" : "w")).join("");
console.log(`pattern: ${pattern}`);
if (failed > 0) {
  throw new Error(`${failed} check(s) failed`);
}
console.log("All pitch checks passed.");
