import { KEY_COUNT, SA_OPTIONS, keyToWestern, westernToKey } from "./pitch";

export const TEACH_COUNT_IN_BEATS = 4;
export const TEACH_TIMING_WINDOW_MS = 300;
export const TEACH_WRONG_PULSE_MS = 180;
export const MAX_TEACH_NOTES = 256;
export const MAX_TEACH_BEAT = 512;

export type TeachPhase = "empty" | "ready" | "countIn" | "running" | "complete";
export type TeachNoteStatus = "pending" | "correct" | "missed";
export type TeachInputSource = "computer" | "onscreen";

export interface TeachLessonNote {
  id: string;
  key: number;
  startBeat: number;
  durationBeats: number;
}

export interface TeachLesson {
  id: string;
  title: string;
  sa: string;
  bpm: number;
  notes: TeachLessonNote[];
  durationBeats: number;
}

export interface TeachNoteState extends TeachLessonNote {
  status: TeachNoteStatus;
  offsetMs?: number;
  source?: TeachInputSource;
}

export interface TeachWrongPulse {
  key: number;
  atMs: number;
}

export interface TeachSessionState {
  lesson: TeachLesson | null;
  phase: TeachPhase;
  lessonStartsAtMs: number | null;
  countInBeat: number | null;
  notes: TeachNoteState[];
  wrong: number;
  wrongPulse: TeachWrongPulse | null;
  announcement: string;
}

export interface TeachProgress {
  phase: TeachPhase;
  lessonId: string | null;
  bpm: number | null;
  elapsedBeat: number;
  counts: {
    total: number;
    correct: number;
    missed: number;
    pending: number;
    wrong: number;
  };
  accuracy: number;
  notes: Array<{ id: string; status: TeachNoteStatus; offsetMs?: number }>;
}

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

/** Strictly validate agent lesson input. Invalid notes are never repaired or dropped. */
export function parseTeachLesson(input: unknown, currentSa: string, lessonId: string): TeachLesson {
  const data = objectValue(input, "Lesson");
  if (!lessonId) throw new Error("lessonId is required");

  let title = "Teach lesson";
  if (data.title !== undefined) {
    if (typeof data.title !== "string") throw new Error("title must be a string");
    title = data.title.trim();
    if (title.length < 1 || title.length > 80) {
      throw new Error("title must contain 1-80 characters");
    }
  }

  const sa = data.sa === undefined ? currentSa : data.sa;
  if (typeof sa !== "string" || !(SA_OPTIONS as readonly string[]).includes(sa)) {
    throw new Error(`sa must be one of ${SA_OPTIONS.join(", ")}`);
  }

  const bpm = finiteNumber(data.bpm, "bpm");
  if (!Number.isInteger(bpm) || bpm < 40 || bpm > 240) {
    throw new Error("bpm must be an integer from 40 to 240");
  }

  if (!Array.isArray(data.notes) || data.notes.length < 1 || data.notes.length > MAX_TEACH_NOTES) {
    throw new Error(`notes must contain 1-${MAX_TEACH_NOTES} items`);
  }

  const duplicates = new Set<string>();
  const notes = data.notes.map((raw, index): TeachLessonNote => {
    const note = objectValue(raw, `notes[${index}]`);
    let key: number | null = null;
    if (note.key !== undefined) {
      const numericKey = finiteNumber(note.key, `notes[${index}].key`);
      if (!Number.isInteger(numericKey) || numericKey < 0 || numericKey >= KEY_COUNT) {
        throw new Error(`notes[${index}].key must be an integer from 0 to ${KEY_COUNT - 1}`);
      }
      key = numericKey;
    }
    if (note.western !== undefined) {
      if (typeof note.western !== "string") {
        throw new Error(`notes[${index}].western must be a note such as C4 or F#5`);
      }
      const westernKey = westernToKey(note.western);
      if (westernKey === null) {
        throw new Error(`notes[${index}].western must be a note from C3 through D6, using sharps`);
      }
      if (key !== null && key !== westernKey) {
        throw new Error(`notes[${index}].key and western identify different notes`);
      }
      key = westernKey;
    }
    if (key === null) {
      throw new Error(`notes[${index}] needs key 0-${KEY_COUNT - 1} or a Western note such as C4`);
    }

    const startBeat = finiteNumber(note.startBeat, `notes[${index}].startBeat`);
    if (startBeat < 0 || startBeat > MAX_TEACH_BEAT) {
      throw new Error(`notes[${index}].startBeat must be from 0 to ${MAX_TEACH_BEAT}`);
    }

    const durationBeats = finiteNumber(note.durationBeats, `notes[${index}].durationBeats`);
    if (durationBeats < 0.125 || durationBeats > 16) {
      throw new Error(`notes[${index}].durationBeats must be from 0.125 to 16`);
    }
    if (startBeat + durationBeats > MAX_TEACH_BEAT) {
      throw new Error(`notes[${index}] ends after beat ${MAX_TEACH_BEAT}`);
    }

    const duplicateKey = `${key}:${startBeat}`;
    if (duplicates.has(duplicateKey)) {
      throw new Error(`notes[${index}] duplicates key ${key} at beat ${startBeat}`);
    }
    duplicates.add(duplicateKey);
    return { id: `note-${index + 1}`, key, startBeat, durationBeats };
  });

  notes.sort((a, b) => a.startBeat - b.startBeat || Number(a.id.slice(5)) - Number(b.id.slice(5)));
  const durationBeats = Math.max(...notes.map((note) => note.startBeat + note.durationBeats));
  return { id: lessonId, title, sa, bpm, notes, durationBeats };
}

export function emptyTeachSession(): TeachSessionState {
  return {
    lesson: null,
    phase: "empty",
    lessonStartsAtMs: null,
    countInBeat: null,
    notes: [],
    wrong: 0,
    wrongPulse: null,
    announcement: "No lesson loaded",
  };
}

function pendingNotes(lesson: TeachLesson): TeachNoteState[] {
  return lesson.notes.map((note) => ({ ...note, status: "pending" }));
}

export function loadTeachLesson(lesson: TeachLesson): TeachSessionState {
  return {
    lesson,
    phase: "ready",
    lessonStartsAtMs: null,
    countInBeat: null,
    notes: pendingNotes(lesson),
    wrong: 0,
    wrongPulse: null,
    announcement: `${lesson.title} ready`,
  };
}

export function startTeachSession(state: TeachSessionState, nowMs: number): TeachSessionState {
  if (!state.lesson) return state;
  const beatMs = 60_000 / state.lesson.bpm;
  return {
    ...state,
    phase: "countIn",
    lessonStartsAtMs: nowMs + TEACH_COUNT_IN_BEATS * beatMs,
    countInBeat: TEACH_COUNT_IN_BEATS,
    notes: pendingNotes(state.lesson),
    wrong: 0,
    wrongPulse: null,
    announcement: `Count in ${TEACH_COUNT_IN_BEATS}`,
  };
}

export function resetTeachSession(state: TeachSessionState): TeachSessionState {
  return state.lesson ? loadTeachLesson(state.lesson) : emptyTeachSession();
}

export function teachTimelineBeat(state: TeachSessionState, nowMs: number): number {
  if (!state.lesson || state.lessonStartsAtMs === null) return 0;
  return (nowMs - state.lessonStartsAtMs) / (60_000 / state.lesson.bpm);
}

export function advanceTeachSession(state: TeachSessionState, nowMs: number): TeachSessionState {
  if (!state.lesson || state.lessonStartsAtMs === null) return state;
  if (state.phase === "countIn" && nowMs < state.lessonStartsAtMs) {
    const beatMs = 60_000 / state.lesson.bpm;
    const countInBeat = Math.max(1, Math.ceil((state.lessonStartsAtMs - nowMs) / beatMs));
    if (countInBeat === state.countInBeat) return state;
    return { ...state, countInBeat, announcement: `Count in ${countInBeat}` };
  }
  if (state.phase !== "countIn" && state.phase !== "running") return state;

  let changed = state.phase === "countIn";
  let missed = 0;
  const beatMs = 60_000 / state.lesson.bpm;
  const notes = state.notes.map((note) => {
    const expectedAtMs = state.lessonStartsAtMs as number + note.startBeat * beatMs;
    if (note.status === "pending" && nowMs - expectedAtMs > TEACH_TIMING_WINDOW_MS) {
      changed = true;
      missed += 1;
      return { ...note, status: "missed" as const };
    }
    return note;
  });
  if (!changed) return state;

  const complete = notes.every((note) => note.status !== "pending");
  return {
    ...state,
    phase: complete ? "complete" : "running",
    countInBeat: null,
    notes,
    announcement: complete
      ? "Lesson complete"
      : missed > 0
        ? `${missed} ${missed === 1 ? "note" : "notes"} missed`
        : "Lesson started",
  };
}

export function scoreTeachNote(
  state: TeachSessionState,
  key: number,
  source: TeachInputSource,
  nowMs: number,
): TeachSessionState {
  if (!state.lesson || state.lessonStartsAtMs === null) return state;
  const grading =
    state.phase === "running" ||
    (state.phase === "countIn" && nowMs >= state.lessonStartsAtMs - TEACH_TIMING_WINDOW_MS);
  if (!grading) return state;
  const beatMs = 60_000 / state.lesson.bpm;
  let candidateIndex = -1;
  let candidateOffset = Number.POSITIVE_INFINITY;
  for (let i = 0; i < state.notes.length; i++) {
    const note = state.notes[i];
    if (note.status !== "pending" || note.key !== key) continue;
    const offset = nowMs - (state.lessonStartsAtMs + note.startBeat * beatMs);
    if (Math.abs(offset) <= TEACH_TIMING_WINDOW_MS && Math.abs(offset) < Math.abs(candidateOffset)) {
      candidateIndex = i;
      candidateOffset = offset;
    }
  }

  if (candidateIndex < 0) {
    return {
      ...state,
      wrong: state.wrong + 1,
      wrongPulse: { key, atMs: nowMs },
      announcement: `Wrong note ${keyToWestern(key)}`,
    };
  }

  const notes = state.notes.map((note, index) =>
    index === candidateIndex
      ? { ...note, status: "correct" as const, offsetMs: Math.round(candidateOffset), source }
      : note,
  );
  const complete = notes.every((note) => note.status !== "pending");
  return {
    ...state,
    phase: complete ? "complete" : "running",
    notes,
    announcement: complete ? "Lesson complete" : `Correct ${keyToWestern(key)}`,
  };
}

export function getTeachProgress(state: TeachSessionState, nowMs: number): TeachProgress {
  const current = advanceTeachSession(state, nowMs);
  const correct = current.notes.filter((note) => note.status === "correct").length;
  const missed = current.notes.filter((note) => note.status === "missed").length;
  const pending = current.notes.length - correct - missed;
  const total = current.notes.length;
  return {
    phase: current.phase,
    lessonId: current.lesson?.id ?? null,
    bpm: current.lesson?.bpm ?? null,
    elapsedBeat: Math.max(0, teachTimelineBeat(current, nowMs)),
    counts: { total, correct, missed, pending, wrong: current.wrong },
    accuracy: total === 0 ? 0 : correct / total,
    notes: current.notes.map(({ id, status, offsetMs }) => ({
      id,
      status,
      ...(offsetMs === undefined ? {} : { offsetMs }),
    })),
  };
}
