import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyTeachSession, loadTeachLesson, type TeachLesson, type TeachSessionState } from "./teachSession";
import {
  WebMCPRegistrar,
  type ModelContext,
  type WebMCPDeps,
} from "./webmcp";
import type { AppMode } from "./types";

interface CapturedTool {
  name: string;
  execute: (input: unknown, ctx?: { signal?: AbortSignal }) => Promise<Record<string, unknown>>;
}

function captureContext() {
  const registered: Array<{ tool: CapturedTool; signal: AbortSignal }> = [];
  const context: ModelContext = {
    registerTool: async (tool, options) => {
      registered.push({ tool: tool as unknown as CapturedTool, signal: options?.signal as AbortSignal });
    },
  };
  return { context, registered };
}

test("WebMCPRegistrar isolates Play and Teach catalogs and Teach calls tolerate missing ctx", async () => {
  let mode: AppMode = "play";
  let session: TeachSessionState = emptyTeachSession();
  const deps: WebMCPDeps = {
    getMode: () => mode,
    getSa: () => "C",
    applySa: () => {},
    applyScore: () => {},
    applyTeachLesson: (lesson: TeachLesson) => { session = loadTeachLesson(lesson); },
    getTeachSession: () => session,
    clearTeachLesson: () => { session = emptyTeachSession(); },
  };
  const registrar = new WebMCPRegistrar();
  const captured = captureContext();

  const play = await registrar.setMode("play", deps, captured.context);
  assert.equal(play.status.state, "registered");
  assert.deepEqual(
    captured.registered.map(({ tool }) => tool.name),
    ["play_note", "play_score", "set_sa", "stop", "get_state"],
  );

  mode = "teach";
  const teach = await registrar.setMode("teach", deps, captured.context);
  assert.equal(teach.status.state, "registered");
  assert.equal(captured.registered.slice(0, 5).every(({ signal }) => signal.aborted), true);
  const teachTools = captured.registered.slice(5).map(({ tool }) => tool);
  assert.deepEqual(teachTools.map(({ name }) => name), ["load_lesson", "get_lesson_progress", "clear_lesson"]);
  const stalePlayState = await captured.registered[4].tool.execute({});
  assert.equal(stalePlayState.ok, false);

  const load = teachTools.find(({ name }) => name === "load_lesson") as CapturedTool;
  const invalid = await load.execute({ bpm: 120, notes: [{ key: 12, startBeat: 0, durationBeats: 99 }] });
  assert.equal(invalid.ok, false);
  assert.equal(session.phase, "empty");

  const loaded = await load.execute({ bpm: 120, notes: [{ key: 12, startBeat: 0, durationBeats: 1 }] });
  assert.equal(loaded.ok, true);
  assert.equal(session.phase, "ready");

  const progressTool = teachTools.find(({ name }) => name === "get_lesson_progress") as CapturedTool;
  const progress = await progressTool.execute({});
  assert.equal(progress.ok, true);
  assert.equal(progress.phase, "ready");

  const aborted = new AbortController();
  aborted.abort();
  const abortedLoad = await load.execute(
    { bpm: 120, notes: [{ key: 14, startBeat: 0, durationBeats: 1 }] },
    { signal: aborted.signal },
  );
  assert.equal(abortedLoad.ok, false);
  assert.equal(session.lesson?.notes[0].key, 12);

  const clear = teachTools.find(({ name }) => name === "clear_lesson") as CapturedTool;
  assert.equal((await clear.execute({})).ok, true);
  assert.equal(session.phase, "empty");
  registrar.dispose();
});

test("WebMCPRegistrar rejects stale async registration", async () => {
  let mode: AppMode = "play";
  const deps: WebMCPDeps = {
    getMode: () => mode,
    getSa: () => "C",
    applySa: () => {},
    applyScore: () => {},
    applyTeachLesson: () => {},
    getTeachSession: () => emptyTeachSession(),
    clearTeachLesson: () => {},
  };
  const names: string[] = [];
  const context: ModelContext = {
    registerTool: async (tool, options) => {
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      if (options?.signal?.aborted) throw new Error("aborted");
      names.push((tool as unknown as CapturedTool).name);
    },
  };
  const registrar = new WebMCPRegistrar();
  const stale = registrar.setMode("play", deps, context);
  mode = "teach";
  const current = registrar.setMode("teach", deps, context);
  const [staleResult, currentResult] = await Promise.all([stale, current]);
  assert.equal(staleResult.status.state, "unavailable");
  assert.equal(currentResult.status.state, "registered");
  assert.deepEqual(names, ["load_lesson", "get_lesson_progress", "clear_lesson"]);
  registrar.dispose();
});

test("WebMCPRegistrar aborts a partially registered catalog", async () => {
  let call = 0;
  let firstSignal: AbortSignal | undefined;
  const context: ModelContext = {
    registerTool: async (_tool, options) => {
      call += 1;
      firstSignal ??= options?.signal;
      if (call === 2) throw new Error("registration failed");
    },
  };
  const deps: WebMCPDeps = {
    getMode: () => "teach",
    getSa: () => "C",
    applySa: () => {},
    applyScore: () => {},
    applyTeachLesson: () => {},
    getTeachSession: () => emptyTeachSession(),
    clearTeachLesson: () => {},
  };
  const registrar = new WebMCPRegistrar();
  const result = await registrar.setMode("teach", deps, context);
  assert.equal(result.status.state, "error");
  assert.equal(firstSignal?.aborted, true);
  registrar.dispose();
});
