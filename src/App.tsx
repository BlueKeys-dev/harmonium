import { useCallback, useEffect, useRef, useState } from "react";
import { engine } from "./audioEngine";
import { parseScore, scorePlayer, demoScoreText } from "./scorePlayer";
import { registerWebMCPTools, type WebMCPStatus } from "./webmcp";
import { westernToPitchClass } from "./pitch";
import { Keyboard } from "./components/Keyboard";
import { SaSelector } from "./components/SaSelector";
import { JsonPanel } from "./components/JsonPanel";
import { useComputerKeys } from "./hooks/useComputerKeys";

type Notation = "western" | "sargam" | "both";

export default function App() {
  const [sa, setSa] = useState("C");
  const [notation, setNotation] = useState<Notation>("both");
  const [activeKeys, setActiveKeys] = useState<Set<number>>(new Set());
  const [unlocked, setUnlocked] = useState(false);
  const [audioSource, setAudioSource] = useState<string | null>(null);
  const [scorePlaying, setScorePlaying] = useState(false);
  const [webmcp, setWebmcp] = useState<WebMCPStatus>({ state: "unavailable" });
  const [scoreText, setScoreText] = useState(() => demoScoreText());
  const [gateError, setGateError] = useState<string | null>(null);
  const [octave, setOctave] = useState(0);

  const saRef = useRef(sa);
  saRef.current = sa;

  // Engine drives visuals + lock state; keep React in sync.
  useEffect(() => {
    const sync = () => {
      setActiveKeys(new Set(engine.getActiveKeys()));
      setUnlocked(engine.lockState === "unlocked");
      setAudioSource(engine.source);
    };
    sync();
    return engine.subscribe(sync);
  }, []);

  useEffect(() => scorePlayer.subscribe(setScorePlaying), []);

  // Preload reed samples while the gate is up.
  useEffect(() => {
    engine.preload();
  }, []);

  // Register WebMCP tools after the keyboard + audio module exist.
  useEffect(() => {
    let cancelled = false;
    let unregister = () => {};
    registerWebMCPTools({
      getSa: () => saRef.current,
      applySa: (next) => setSa(next),
    }).then(({ status, unregister: u }) => {
      unregister = u;
      if (cancelled) {
        u();
        return;
      }
      setWebmcp(status);
    });
    return () => {
      cancelled = true;
      unregister();
    };
  }, []);

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

  const handlePlayScore = (): string | null => {
    try {
      const score = parseScore(scoreText);
      scorePlayer.play(score, (next) => setSa(next));
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };

  const saPc = Math.max(0, westernToPitchClass(sa));

  return (
    <div className="app">
      {!unlocked && (
        <div className="gate" onClick={handleUnlock}>
          <button type="button" className="gate-button" onClick={handleUnlock}>
            Tap to start
          </button>
          <p className="gate-sub">
            Chrome blocks audio until a user tap. Tap enables the reeds.
          </p>
          {gateError && <p className="error">{gateError}</p>}
        </div>
      )}

      <header className="topbar">
        <h1>web-harmonium</h1>
        <div className="status">
          <span className={`dot ${unlocked ? "on" : "off"}`} />
          {unlocked ? `audio: ${audioSource ?? "on"}` : "audio locked"}
          <span className="sep">·</span>
          <span>
            {webmcp.state === "registered"
              ? `WebMCP tools registered (${webmcp.tools.length})`
              : webmcp.state === "error"
                ? `WebMCP error: ${webmcp.message}`
                : "WebMCP unavailable"}
          </span>
        </div>
      </header>

      <main className="controls">
        <div className="row">
          <SaSelector sa={sa} onChange={setSa} />
        </div>
        <div className="row">
          <span className="panel-label">Notation</span>
          {(["western", "sargam", "both"] as Notation[]).map((n) => (
            <button
              key={n}
              type="button"
              className={`pill${notation === n ? " selected" : ""}`}
              onClick={() => setNotation(n)}
            >
              {n}
            </button>
          ))}
          <span className="kb-hint">
            computer keys: A S D F G H J K L (white) · W E T Y U (black) · Z / X octave
            {octave !== 0 ? ` (shifted ${octave > 0 ? "+" : ""}${octave * 12})` : ""}
          </span>
        </div>
        <JsonPanel
          scoreText={scoreText}
          onScoreTextChange={setScoreText}
          onPlay={handlePlayScore}
          onStop={() => {
            scorePlayer.stop();
            engine.stopAllNotes();
          }}
          playing={scorePlaying}
          locked={!unlocked}
        />
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
