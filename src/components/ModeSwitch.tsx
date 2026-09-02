import type { AppMode } from "../types";

interface ModeSwitchProps {
  mode: AppMode;
  onMode: (mode: AppMode) => void;
}

export function ModeSwitch({ mode, onMode }: ModeSwitchProps) {
  return (
    <div className="mode-switch" role="group" aria-label="App mode">
      {(["play", "teach"] as const).map((value) => (
        <button
          key={value}
          type="button"
          className={mode === value ? "active" : ""}
          aria-pressed={mode === value}
          onClick={() => onMode(value)}
        >
          {value === "play" ? "Play" : "Teach"}
        </button>
      ))}
    </div>
  );
}
