import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScore, demoScoreText } from "./score";

test("parseScore keeps valid events, sorts by time, trims sa", () => {
  const score = parseScore(
    JSON.stringify({
      sa: " G ",
      events: [
        { t: 1, key: 14, dur: 0.3 },
        { t: 0, key: 12, note: "Sa" },
      ],
    }),
  );
  assert.equal(score.sa, "G");
  assert.deepEqual(score.events.map((e) => e.key), [12, 14]);
  assert.equal(score.events[0].note, "Sa");
  assert.equal(score.events[1].dur, 0.3);
});

test("parseScore defaults dur to 0.5", () => {
  const score = parseScore(JSON.stringify({ events: [{ t: 0, key: 12 }] }));
  assert.equal(score.events[0].dur, 0.5);
});

test("parseScore drops events without a trustworthy key", () => {
  const score = parseScore(
    JSON.stringify({ events: [{ t: 0, key: 99 }, { t: 0 }, { t: 0, key: 12 }] }),
  );
  assert.deepEqual(score.events.map((e) => e.key), [12]);
});

test("parseScore rejects an invalid sa", () => {
  assert.throws(
    () => parseScore(JSON.stringify({ sa: "H", events: [{ t: 0, key: 12 }] })),
    /Invalid sa/,
  );
});

test("parseScore rejects bad JSON", () => {
  assert.throws(() => parseScore("{"), /Invalid JSON/);
});

test("parseScore rejects missing, empty, and all-invalid events", () => {
  assert.throws(() => parseScore("{}"), /events/);
  assert.throws(() => parseScore(JSON.stringify({ events: [] })), /non-empty/);
  assert.throws(
    () => parseScore(JSON.stringify({ events: [{ t: 0, key: 99 }] })),
    /No valid events/,
  );
});

test("demoScoreText is a valid score", () => {
  const score = parseScore(demoScoreText());
  assert.equal(score.sa, "C");
  assert.ok(score.events.length >= 14);
});
