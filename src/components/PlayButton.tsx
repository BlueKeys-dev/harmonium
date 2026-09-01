import { IconPause, IconPlay } from "./Icons";

interface PlayButtonProps {
  playing: boolean;
  unlocked: boolean;
  onToggle: () => void;
}

/** Round play/pause control. Play starts the loaded score; second press stops. */
export function PlayButton({ playing, unlocked, onToggle }: PlayButtonProps) {
  return (
    <button
      type="button"
      className="play-btn"
      onClick={onToggle}
      aria-label={playing ? "Stop score playback" : "Play loaded score"}
      title={playing ? "Stop" : unlocked ? "Play" : "Tap to start audio first"}
    >
      {playing ? <IconPause /> : <IconPlay />}
    </button>
  );
}
