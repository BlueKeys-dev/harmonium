import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TEACH_TIMING_WINDOW_MS,
  advanceTeachSession,
  emptyTeachSession,
  getTeachProgress,
  loadTeachLesson,
  parseTeachLesson,
  resetTeachSession,
  scoreTeachNote,
  startTeachSession,
} from "./teachSession";

const lessonInput = {
  title: "Scale",
  sa: "C",
  bpm: 120,
  notes: [
    { key: 14, startBeat: 1, durationBeats: 0.5 },
    { key: 12, startBeat: 0, durationBeats: 1 },
  ],
};

test("parseTeachLesson strictly validates and sorts without mutating input", () => {
  const input = structuredClone(lessonInput);
  const lesson = parseTeachLesson(input, "D", "lesson-1");
  assert.deepEqual(input, lessonInput);
  assert.deepEqual(lesson.notes.map((note) => note.id), ["note-2", "note-1"]);
  assert.deepEqual(lesson.notes.map((note) => note.key), [12, 14]);
  assert.equal(lesson.sa, "C");
  assert.throws(
    () => parseTeachLesson({ ...lessonInput, bpm: 39.9 }, "C", "bad"),
    /bpm/,
  );
  assert.throws(
    () => parseTeachLesson({ ...lessonInput, notes: [{ key: 12, startBeat: 0, durationBeats: 0.1 }] }, "C", "bad"),
    /durationBeats/,
  );
  assert.throws(
    () => parseTeachLesson({ ...lessonInput, notes: [{ key: 12, startBeat: 511, durationBeats: 2 }] }, "C", "bad"),
    /ends after beat/,
  );
  assert.throws(
    () => parseTeachLesson({ ...lessonInput, notes: [lessonInput.notes[1], lessonInput.notes[1]] }, "C", "bad"),
    /duplicates/,
  );
});

test("parseTeachLesson accepts familiar Western notes and rejects conflicts", () => {
  const lesson = parseTeachLesson({
    bpm: 90,
    notes: [
      { western: "C4", startBeat: 0, durationBeats: 1 },
      { western: "F#5", startBeat: 1, durationBeats: 1 },
    ],
  }, "C", "western");
  assert.deepEqual(lesson.notes.map((note) => note.key), [12, 30]);
  assert.throws(
    () => parseTeachLesson({
      bpm: 90,
      notes: [{ key: 12, western: "D4", startBeat: 0, durationBeats: 1 }],
    }, "C", "conflict"),
    /different notes/,
  );
  assert.throws(
    () => parseTeachLesson({
      bpm: 90,
      notes: [{ western: "Db4", startBeat: 0, durationBeats: 1 }],
    }, "C", "flat"),
    /using sharps/,
  );
});

test("grading accepts inclusive timing boundaries and consumes a target once", () => {
  const lesson = parseTeachLesson(lessonInput, "C", "lesson-1");
  let early = startTeachSession(loadTeachLesson(lesson), 0);
  early = advanceTeachSession(early, 2_000);
  early = scoreTeachNote(early, 12, "computer", 2_000 - TEACH_TIMING_WINDOW_MS);
  assert.equal(early.notes[0].status, "correct");
  assert.equal(early.notes[0].offsetMs, -300);
  const repeated = scoreTeachNote(early, 12, "computer", 2_000);
  assert.equal(repeated.wrong, 1);

  let late = startTeachSession(loadTeachLesson(lesson), 0);
  late = advanceTeachSession(late, 2_000);
  late = scoreTeachNote(late, 12, "onscreen", 2_000 + TEACH_TIMING_WINDOW_MS);
  assert.equal(late.notes[0].status, "correct");
  assert.equal(late.notes[0].source, "onscreen");
});

test("early hit during count-in grades beat 0 once the window opens", () => {
  const lesson = parseTeachLesson(lessonInput, "C", "lesson-1");
  const state = startTeachSession(loadTeachLesson(lesson), 0);
  assert.equal(state.phase, "countIn");
  assert.equal(state.lessonStartsAtMs, 2_000);
  const before = scoreTeachNote(state, 12, "computer", 2_000 - TEACH_TIMING_WINDOW_MS - 1);
  assert.equal(before, state);
  const hit = scoreTeachNote(state, 12, "computer", 2_000 - TEACH_TIMING_WINDOW_MS);
  assert.equal(hit.phase, "running");
  assert.equal(hit.notes[0].status, "correct");
  assert.equal(hit.notes[0].offsetMs, -300);
  const wrongEarly = scoreTeachNote(state, 20, "computer", 2_000 - TEACH_TIMING_WINDOW_MS);
  assert.equal(wrongEarly.wrong, 1);
});

test("wrong notes do not consume targets and elapsed targets become missed", () => {
  const lesson = parseTeachLesson(lessonInput, "C", "lesson-1");
  let state = startTeachSession(loadTeachLesson(lesson), 0);
  state = advanceTeachSession(state, 2_000);
  state = scoreTeachNote(state, 20, "computer", 2_000);
  assert.equal(state.wrong, 1);
  assert.equal(state.notes[0].status, "pending");
  state = advanceTeachSession(state, 2_301);
  assert.equal(state.notes[0].status, "missed");
  assert.equal(state.phase, "running");
});

test("chords grade independently and progress completes accurately", () => {
  const lesson = parseTeachLesson({
    bpm: 120,
    notes: [
      { key: 12, startBeat: 0, durationBeats: 1 },
      { key: 16, startBeat: 0, durationBeats: 1 },
    ],
  }, "C", "chord");
  let state = startTeachSession(loadTeachLesson(lesson), 0);
  state = advanceTeachSession(state, 2_000);
  state = scoreTeachNote(state, 12, "computer", 2_000);
  state = scoreTeachNote(state, 16, "onscreen", 2_000);
  const progress = getTeachProgress(state, 2_000);
  assert.equal(progress.phase, "complete");
  assert.equal(progress.counts.correct, 2);
  assert.equal(progress.accuracy, 1);
});

test("reset retains the lesson and empty sessions remain empty", () => {
  const lesson = parseTeachLesson(lessonInput, "C", "lesson-1");
  const reset = resetTeachSession(startTeachSession(loadTeachLesson(lesson), 10));
  assert.equal(reset.phase, "ready");
  assert.equal(reset.lesson, lesson);
  assert.equal(reset.notes.every((note) => note.status === "pending"), true);
  assert.equal(resetTeachSession(emptyTeachSession()).phase, "empty");
});
