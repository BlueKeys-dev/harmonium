import { useState } from "react";
import { demoScoreText } from "../scorePlayer";

interface JsonPanelProps {
  scoreText: string;
  onScoreTextChange: (text: string) => void;
  /** Validates + plays; returns an error string or null on success. */
  onPlay: () => string | null;
  onStop: () => void;
  playing: boolean;
  locked: boolean;
}

export function JsonPanel({ scoreText, onScoreTextChange, onPlay, onStop, playing, locked }: JsonPanelProps) {
  const [error, setError] = useState<string | null>(null);

  const handlePlay = () => {
    const err = onPlay();
    setError(err);
  };

  return (
    <section className="json-panel" aria-label="JSON score">
      <div className="panel-head">
        <span className="panel-label">JSON score</span>
        <button type="button" className="pill" onClick={() => onScoreTextChange(demoScoreText())}>
          demo
        </button>
        <button type="button" className="pill primary" onClick={handlePlay} disabled={playing}>
          {playing ? "playing…" : "Play"}
        </button>
        <button type="button" className="pill" onClick={onStop}>
          Stop
        </button>
      </div>
      <textarea
        value={scoreText}
        onChange={(e) => onScoreTextChange(e.target.value)}
        spellCheck={false}
        rows={8}
        aria-label="Score JSON"
      />
      {error && <p className="error" role="alert">{error}</p>}
      {locked && <p className="hint">Tap “Tap to start” first — Chrome blocks audio until you do.</p>}
    </section>
  );
}
