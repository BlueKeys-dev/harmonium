import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { engine } from "./audioEngine";
import { parseScore, demoScoreText, type Score } from "./score";
import { scorePlayer } from "./scorePlayer";
import { setWebMCPMode, type WebMCPStatus } from "./webmcp";
import { westernToPitchClass } from "./pitch";
import { InputRouter, type RoutedNoteDown } from "./inputRouter";
import {
  advanceTeachSession,
  emptyTeachSession,
  loadTeachLesson,
  resetTeachSession,
  scoreTeachNote,
  startTeachSession,
  type TeachLesson,
  type TeachSessionState,
} from "./teachSession";
import { Keyboard } from "./components/Keyboard";
import { TopBar } from "./components/TopBar";
import { PlayButton } from "./components/PlayButton";
import { TeachMode } from "./components/TeachMode";
import { Visualizer } from "./components/Visualizer";
import { openJsonEditor } from "./components/jsonEditorTab";
import { useComputerKeys } from "./hooks/useComputerKeys";
import type { AppMode, Notation } from "./types";

function waitForVisibleCommit(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let firstFrame = 0;
    let secondFrame = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      resolve();
    };
    const timeout = window.setTimeout(finish, 200);
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(finish);
    });
  });
}

export default function App() {
  const [sa, setSa] = useState("C");
  const [notation, setNotation] = useState<Notation>("both");
  const [activeKeys, setActiveKeys] = useState<Set<number>>(new Set());
  const [unlocked, setUnlocked] = useState(false);
  const [audioSource, setAudioSource] = useState<string | null>(null);
  const [preload, setPreload] = useState(0);
  const [scorePlaying, setScorePlaying] = useState(false);
  const [webmcp, setWebmcp] = useState<WebMCPStatus>({ state: "unavailable" });
  const [scoreText, setScoreText] = useState(() => demoScoreText());
  const [mode, setMode] = useState<AppMode>("play");
  const [teachSession, setTeachSession] = useState<TeachSessionState>(() => emptyTeachSession());
  const [gateError, setGateError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [octave, setOctave] = useState(0);

  const saRef = useRef(sa);
  saRef.current = sa;
  const scoreTextRef = useRef(scoreText);
  scoreTextRef.current = scoreText;
  const unlockedRef = useRef(unlocked);
  unlockedRef.current = unlocked;
  const modeRef = useRef<AppMode>(mode);
  modeRef.current = mode;
  const teachSessionRef = useRef(teachSession);
  teachSessionRef.current = teachSession;
  const editorWindowRef = useRef<Window | null>(null);
  const teachInputRef = useRef<(event: RoutedNoteDown) => void>(() => {});

  const applySa = useCallback((next: string) => {
    saRef.current = next;
    setSa(next);
  }, []);

  const applyScore = useCallback(async (
    score: Score,
    options?: { sourceText?: string; syncEditor?: boolean },
  ) => {
    const text = options?.sourceText ?? JSON.stringify(score, null, 2);
    flushSync(() => {
      scoreTextRef.current = text;
      setScoreText(text);
      if (score.sa) applySa(score.sa);
    });

    const editor = editorWindowRef.current;
    if (options?.syncEditor !== false && editor && !editor.closed) {
      try {
        editor.postMessage(
          { type: "harmonium-score-init", text },
          window.location.origin,
        );
      } catch {
        editorWindowRef.current = null;
      }
    }
    await waitForVisibleCommit();
  }, [applySa]);

  const commitTeachSession = useCallback((next: TeachSessionState) => {
    teachSessionRef.current = next;
    setTeachSession(next);
  }, []);

  const inputRouterRef = useRef<InputRouter | null>(null);
  if (!inputRouterRef.current) {
    inputRouterRef.current = new InputRouter({
      startNote: (key) => engine.playNote(key),
      stopNote: (key) => engine.stopNote(key),
      noteDown: (event) => teachInputRef.current(event),
    });
  }
  const inputRouter = inputRouterRef.current;

  teachInputRef.current = (event) => {
    if (modeRef.current !== "teach") return;
    const current = teachSessionRef.current;
    const next = scoreTeachNote(current, event.key, event.source, event.atMs);
    if (next !== current) commitTeachSession(next);
  };

  const applyTeachLesson = useCallback(async (lesson: TeachLesson) => {
    inputRouter.releaseAll();
    scorePlayer.stop();
    engine.stopAllNotes();
    flushSync(() => {
      applySa(lesson.sa);
      commitTeachSession(loadTeachLesson(lesson));
    });
    await waitForVisibleCommit();
  }, [applySa, commitTeachSession, inputRouter]);

  const clearTeachLesson = useCallback(async () => {
    inputRouter.releaseAll();
    engine.stopAllNotes();
    flushSync(() => commitTeachSession(emptyTeachSession()));
    await waitForVisibleCommit();
  }, [commitTeachSession, inputRouter]);

  const applySaForTool = useCallback(async (next: string) => {
    flushSync(() => applySa(next));
    await waitForVisibleCommit();
  }, [applySa]);

  // Engine drives visuals + lock state; keep React in sync.
  useEffect(() => {
    const sync = () => {
      setActiveKeys(new Set(engine.getActiveKeys()));
      setUnlocked(engine.lockState === "unlocked");
      setAudioSource(engine.source);
      setPreload(engine.preloadProgress);
    };
    sync();
    return engine.subscribe(sync);
  }, []);

  useEffect(() => scorePlayer.subscribe(setScorePlaying), []);

  // Preload reed samples while the gate is up.
  useEffect(() => {
    engine.preload();
  }, []);

  // Register only the catalog for the human-selected mode.
  useEffect(() => {
    let cancelled = false;
    let unregister = () => {};
    setWebMCPMode(mode, {
      getMode: () => modeRef.current,
      getSa: () => saRef.current,
      applySa: applySaForTool,
      applyScore,
      applyTeachLesson,
      getTeachSession: () => teachSessionRef.current,
      clearTeachLesson,
      waitForVisibleCommit,
    }).then(({ status, unregister: stopRegistration }) => {
      if (cancelled) {
        stopRegistration();
        return;
      }
      unregister = stopRegistration;
      if (status.state === "error") {
        console.error("WebMCP registration failed:", status.message);
      }
      setWebmcp(status);
    });
    return () => {
      cancelled = true;
      unregister();
    };
  }, [applySaForTool, applyScore, applyTeachLesson, clearTeachLesson, mode]);

  // JSON editor tab handshake: editor pulls current score, posts edits back.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.source !== editorWindowRef.current) return;
      const d = e.data as { type?: string; text?: unknown } | null;
      if (!d || typeof d !== "object") return;
      if (d.type === "harmonium-score-request-init") {
        (e.source as Window | null)?.postMessage(
          { type: "harmonium-score-init", text: scoreTextRef.current },
          window.location.origin,
        );
      } else if (d.type === "harmonium-score" && typeof d.text === "string") {
        try {
          const score = parseScore(d.text);
          void applyScore(score, { sourceText: d.text, syncEditor: false })
            .then(() => setFlash("Score loaded from editor tab"))
            .catch((e: unknown) => setFlash(`Score rejected: ${(e as Error).message}`));
        } catch (e) {
          setFlash(`Score rejected: ${(e as Error).message}`);
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [applyScore]);

  // Transient status flashes.
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 3500);
    return () => window.clearTimeout(t);
  }, [flash]);

  const computerNoteDown = useCallback(
    (key: number, sourceId: string) => {
      inputRouter.press(sourceId, key, "computer", performance.now());
    },
    [inputRouter],
  );
  const onscreenNoteDown = useCallback(
    (key: number, sourceId: string) => inputRouter.press(sourceId, key, "onscreen", performance.now()),
    [inputRouter],
  );
  const noteUp = useCallback((sourceId: string) => inputRouter.release(sourceId), [inputRouter]);
  const oct = useComputerKeys(computerNoteDown, noteUp);
  useEffect(() => setOctave(oct), [oct]);

  useEffect(() => () => inputRouter.releaseAll(), [inputRouter]);

  useEffect(() => {
    if (teachSession.phase !== "countIn" && teachSession.phase !== "running") return;
    let raf = 0;
    let disposed = false;
    const tick = () => {
      if (disposed) return;
      const current = teachSessionRef.current;
      const next = advanceTeachSession(current, performance.now());
      if (next !== current) commitTeachSession(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, [commitTeachSession, teachSession.phase]);

  const handleUnlock = async () => {
    try {
      await engine.unlock();
      setGateError(null);
    } catch (e) {
      setGateError(`Audio could not start: ${(e as Error).message}`);
    }
  };

  const handleEditJson = () => {
    const win = openJsonEditor();
    if (!win) {
      setFlash("Could not open the JSON editor — check popup permissions");
      return;
    }
    editorWindowRef.current = win;
  };

  const handleExportJson = () => {
    try {
      parseScore(scoreText); // refuse to export nonsense
    } catch (e) {
      setFlash(`Fix the score first: ${(e as Error).message}`);
      return;
    }
    const blob = new Blob([scoreText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "harmonium-score.json";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const handlePlayToggle = () => {
    if (modeRef.current !== "play") return;
    if (scorePlaying) {
      scorePlayer.stop();
      engine.stopAllNotes();
      return;
    }
    try {
      const score = parseScore(scoreText);
      scorePlayer.play(score);
      if (score.sa) applySa(score.sa);
    } catch (e) {
      setFlash(`Score error: ${(e as Error).message}`);
    }
  };

  const handleTeachStart = useCallback(() => {
    if (!unlockedRef.current || !teachSessionRef.current.lesson) return;
    inputRouter.releaseAll();
    engine.stopAllNotes();
    commitTeachSession(startTeachSession(teachSessionRef.current, performance.now()));
  }, [commitTeachSession, inputRouter]);

  const handleMode = useCallback((nextMode: AppMode) => {
    if (nextMode === modeRef.current) return;
    inputRouter.releaseAll();
    scorePlayer.stop();
    engine.stopAllNotes();
    if (modeRef.current === "teach") {
      commitTeachSession(resetTeachSession(teachSessionRef.current));
    }
    modeRef.current = nextMode;
    setMode(nextMode);
  }, [commitTeachSession, inputRouter]);

  // Space toggles play/stop for the loaded score (outside text fields).
  const playToggleRef = useRef(handlePlayToggle);
  playToggleRef.current = handlePlayToggle;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (modeRef.current !== "play") return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest("input, textarea, select")) return;
      if (!unlockedRef.current) return;
      e.preventDefault();
      playToggleRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const saPc = Math.max(0, westernToPitchClass(sa));
  const pct = Math.round(preload * 100);
  const parsedScore = useMemo<Score | null>(() => {
    try {
      return parseScore(scoreText);
    } catch {
      return null; // invalid JSON -> no bars, error surfaces on play/export
    }
  }, [scoreText]);
  // Browser surfaces registered WebMCP tools itself; the page only shows problems.
  const webmcpNote =
    webmcp.state === "registered"
      ? null
      : webmcp.state === "error"
        ? `WebMCP error: ${webmcp.message}`
        : "WebMCP unavailable";
  const status = [
    unlocked ? `audio: ${audioSource ?? "on"}` : "audio locked",
    webmcpNote,
    octave !== 0 ? `keys shifted ${octave > 0 ? "+" : ""}${octave * 12}` : "A S D F G H J · W E T Y U · Z/X octave · Space play/stop",
  ]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <div className="app">
      {!unlocked && (
        <div className="gate" onClick={handleUnlock}>
          <button type="button" className="gate-button" onClick={handleUnlock}>
            Tap to start
          </button>
          <div
            className="preload"
            role="progressbar"
            aria-label="Reed sample preload"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-valuetext={pct < 100 ? `Loading reed samples, ${pct} percent` : "Reed samples ready"}
          >
            <div className="preload-fill" style={{ width: `${pct}%` }} />
          </div>
          {gateError && <p className="error">{gateError}</p>}
        </div>
      )}

      {mode === "play" ? (
        <>
          <TopBar
            sa={sa}
            onSa={applySa}
            notation={notation}
            onNotation={setNotation}
            onEditJson={handleEditJson}
            onExportJson={handleExportJson}
            status={status}
            mode={mode}
            onMode={handleMode}
          />

          {flash && (
            <p className="flash" role="status">
              {flash}
            </p>
          )}

          <main className="stage">
            <Visualizer score={parsedScore} playing={scorePlaying} />
            <div className="play-row">
              <PlayButton playing={scorePlaying} unlocked={unlocked} onToggle={handlePlayToggle} />
            </div>
          </main>

          <Keyboard
            saPitchClass={saPc}
            notation={notation}
            activeKeys={activeKeys}
            onDown={onscreenNoteDown}
            onUp={noteUp}
          />
        </>
      ) : (
        <TeachMode
          session={teachSession}
          unlocked={unlocked}
          activeKeys={activeKeys}
          notation={notation}
          octave={octave}
          webmcpStatus={webmcpNote ?? "agent tools ready"}
          onMode={handleMode}
          onStart={handleTeachStart}
          onDown={onscreenNoteDown}
          onUp={noteUp}
        />
      )}
    </div>
  );
}
