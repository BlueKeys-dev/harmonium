import { test } from "node:test";
import assert from "node:assert/strict";
import { KEY_COUNT, isBlackKey, keyToWestern, sargamForKey, keyForSargam, resolveKey } from "./pitch";

test("keyboard layout is 39 keys, 23 white, 16 black", () => {
  const whites = Array.from({ length: KEY_COUNT }, (_, k) => !isBlackKey(k)).filter(Boolean).length;
  assert.equal(whites, 23);
  assert.equal(KEY_COUNT - whites, 16);
});

test("keys span C3 to D6 with key 12 = C4", () => {
  assert.equal(keyToWestern(0), "C3");
  assert.equal(keyToWestern(12), "C4");
  assert.equal(keyToWestern(38), "D6");
});

test("sargam labels follow the movable Sa", () => {
  assert.equal(sargamForKey(12, 0), "Sa");
  assert.equal(sargamForKey(13, 0), "komal Re");
  assert.equal(sargamForKey(19, 7), "Sa");
});

test("keyForSargam resolves the octave nearest C4", () => {
  assert.equal(keyForSargam("Sa", 0), 12);
  assert.equal(keyForSargam("komal Re", 0), 13);
  assert.equal(keyForSargam("Sa", 7), 7);
});

test("keyForSargam returns null for unknown labels", () => {
  assert.equal(keyForSargam("not a note", 0), null);
  assert.equal(keyForSargam("", 0), null);
});

test("resolveKey prefers an explicit integer key over a note label", () => {
  assert.equal(resolveKey({ key: 5, note: "Sa" }, 0), 5);
  assert.equal(resolveKey({ note: "Sa" }, 0), 12);
  assert.equal(resolveKey({ note: "komal Re" }, 0), 13);
});

test("resolveKey rejects out-of-range, fractional, and absent keys", () => {
  assert.equal(resolveKey({ key: 39 }, 0), null);
  assert.equal(resolveKey({ key: 1.5 }, 0), null);
  assert.equal(resolveKey({}, 0), null);
  assert.equal(resolveKey({ note: "  " }, 0), null);
});
