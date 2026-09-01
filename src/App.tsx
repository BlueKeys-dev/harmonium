import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { engine } from "./audioEngine";
import { parseScore, demoScoreText, type Score } from "./score";
import { scorePlayer } from "./scorePlayer";
import { ensureWebMCPTools, type WebMCPStatus } from "./webmcp";
import { westernToPitchClass } from "./pitch";
import { Keyboard } from "./components/Keyboard";
import { TopBar } from "./components/TopBar";
import { PlayButton } from "./components/PlayButton";
import { Visualizer } from "./components/Visualizer";
import { openJsonEditor } from "./components/jsonEditorTab";
import { useComputerKeys } from "./hooks/useComputerKeys";
import type { Notation } from "./types";

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
  const [gateError, setGateError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [octave, setOctave] = useState(0);

  const saRef = useRef(sa);
  saRef.current = sa;
  const scoreTextRef = useRef(scoreText);
  scoreTextRef.current = scoreText;
  const unlockedRef = useRef(unlocked);
  unlockedRef.current = unlocked;

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

  // Register WebMCP tools after the keyboard + audio module exist. The
  // registration is a page-lifetime singleton: StrictMode's simulated
  // unmount must not abort it (that used to leave zero tools registered).
  useEffect(() => {
    let cancelled = false;
    ensureWebMCPTools({
      getSa: () => saRef.current,
      applySa: (next) => setSa(next),
    }).then(({ status }) => {
      if (status.state === "error") {
        console.error("WebMCP registration failed:", status.message);
      }
      if (!cancelled) setWebmcp(status);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // JSON editor tab handshake: editor pulls current score, posts edits back.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
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
          setScoreText(d.text);
          if (score.sa) setSa(score.sa);
          setFlash("Score loaded from editor tab");
        } catch (e) {
          setFlash(`Score rejected: ${(e as Error).message}`);
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Transient status flashes.
  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 3500);
    return () => window.clearTimeout(t);
  }, [flash]);

  const playNote = useCallback((key: number) => engine.playNote(key), []);
  const stopNote = useCallback((key: number) => engine.stopNote(key), []);
  const oct = useComputerKeys(playNote, stopNote);
  useEffect(() => setOctave(oct), [oct]);

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
    if (!win) setFlash("Popups blocked — allow popups to edit JSON in a tab");
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
    if (scorePlaying) {
      scorePlayer.stop();
      engine.stopAllNotes();
      return;
    }
    try {
      const score = parseScore(scoreText);
      scorePlayer.play(score, (next) => setSa(next));
    } catch (e) {
      setFlash(`Score error: ${(e as Error).message}`);
    }
  };

  // Space toggles play/stop for the loaded score (outside text fields).
  const playToggleRef = useRef(handlePlayToggle);
  playToggleRef.current = handlePlayToggle;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
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

      <TopBar
        sa={sa}
        onSa={setSa}
        notation={notation}
        onNotation={setNotation}
        onEditJson={handleEditJson}
        onExportJson={handleExportJson}
        status={status}
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
        onDown={playNote}
        onUp={stopNote}
      />
    </div>
  );
}
