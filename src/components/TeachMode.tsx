import { westernToPitchClass } from "../pitch";
import { getTeachProgress, type TeachSessionState } from "../teachSession";
import type { AppMode, Notation } from "../types";
import { Keyboard } from "./Keyboard";
import { ModeSwitch } from "./ModeSwitch";
import { TeachVisualizer } from "./TeachVisualizer";

interface TeachModeProps {
  session: TeachSessionState;
  unlocked: boolean;
  activeKeys: Set<number>;
  notation: Notation;
  octave: number;
  webmcpStatus: string;
  onMode: (mode: AppMode) => void;
  onStart: () => void;
  onDown: (key: number, sourceId: string) => boolean;
  onUp: (sourceId: string) => void;
}

export function TeachMode({
  session,
  unlocked,
  activeKeys,
  notation,
  octave,
  webmcpStatus,
  onMode,
  onStart,
  onDown,
  onUp,
}: TeachModeProps) {
  const progress = getTeachProgress(session, performance.now());
  const lesson = session.lesson;
  const canStart = unlocked && lesson !== null;
  const buttonLabel = session.phase === "empty" || session.phase === "ready"
    ? "Start lesson"
    : "Restart lesson";
  const accuracy = Math.round(progress.accuracy * 100);

  return (
    <>
      <header className="teach-header">
        <div className="teach-title">
          <span className="eyebrow">Teach mode</span>
          <h1>{lesson?.title ?? "Waiting for a lesson"}</h1>
          <span className="status">
            {lesson ? `${lesson.bpm} BPM · ${lesson.notes.length} notes` : "Ask an agent to load a lesson"}
            {octave !== 0 ? ` · keys shifted ${octave > 0 ? "+" : ""}${octave * 12}` : ""}
            {` · ${webmcpStatus}`}
          </span>
        </div>
        <div className="teach-actions">
          <div className="teach-metrics" aria-label="Lesson progress">
            <span><strong>{progress.counts.correct}</strong> correct</span>
            <span><strong>{progress.counts.missed}</strong> missed</span>
            <span><strong>{progress.counts.wrong}</strong> wrong</span>
            <span><strong>{accuracy}%</strong> accuracy</span>
          </div>
          <button type="button" className="teach-start" disabled={!canStart} onClick={onStart}>
            {buttonLabel}
          </button>
          <ModeSwitch mode="teach" onMode={onMode} />
        </div>
      </header>

      <main className="stage teach-stage">
        <TeachVisualizer session={session} activeKeys={activeKeys} />
        {session.phase === "empty" && (
          <div className="teach-empty">
            <span>Lesson input ready</span>
            <p>An agent can now call <code>load_lesson</code>.</p>
          </div>
        )}
        {session.phase === "countIn" && session.countInBeat !== null && (
          <div key={session.countInBeat} className="count-in" aria-hidden>{session.countInBeat}</div>
        )}
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {session.announcement}
        </p>
      </main>

      <div className="teach-keyboard-shell">
        <Keyboard
          saPitchClass={Math.max(0, westernToPitchClass(lesson?.sa ?? "C"))}
          notation={notation}
          activeKeys={activeKeys}
          onDown={onDown}
          onUp={onUp}
        />
      </div>
    </>
  );
}
