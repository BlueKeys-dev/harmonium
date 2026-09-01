import { useMemo } from "react";
import { buildKeyInfos } from "../pitch";
import type { Notation } from "../types";

interface KeyboardProps {
  saPitchClass: number;
  notation: Notation;
  activeKeys: Set<number>;
  onDown: (key: number) => void;
  onUp: (key: number) => void;
}

export function Keyboard({ saPitchClass, notation, activeKeys, onDown, onUp }: KeyboardProps) {
  const keys = useMemo(() => buildKeyInfos(saPitchClass), [saPitchClass]);

  const whiteCount = keys[0]?.whiteCount ?? 23;
  const blackWidthPct = (100 / whiteCount) * 0.62;

  const whites: typeof keys = [];
  const blacks: Array<(typeof keys)[number] & { prevWhite: number }> = [];
  let lastWhite = -1;
  for (const k of keys) {
    if (k.isBlack) {
      blacks.push({ ...k, prevWhite: lastWhite });
    } else {
      lastWhite = k.whiteIndex;
      whites.push(k);
    }
  }

  const handlers = (key: number) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      const el = e.currentTarget;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      onDown(key);
    },
    onPointerUp: () => onUp(key),
    onPointerCancel: () => onUp(key),
    onPointerLeave: () => {
      if (activeKeys.has(key)) onUp(key);
    },
  });

  return (
    <div className="keyboard" role="group" aria-label="Harmonium keyboard, 39 keys">
      <div className="white-row">
        {whites.map((k) => (
          <button
            key={k.key}
            type="button"
            className={`key white${activeKeys.has(k.key) ? " active" : ""}`}
            aria-label={`${k.western} ${k.sargam}`}
            data-key={k.key}
            {...handlers(k.key)}
          >
            <span className="key-label">
              {(notation === "western" || notation === "both") && (
                <span className="western">{k.western}</span>
              )}
              {(notation === "sargam" || notation === "both") && (
                <span className="sargam">{k.sargam}</span>
              )}
            </span>
          </button>
        ))}
      </div>
      {blacks.map((k) => {
        const left = (k.prevWhite + 1) * (100 / whiteCount) - blackWidthPct / 2;
        return (
          <button
            key={k.key}
            type="button"
            className={`key black${activeKeys.has(k.key) ? " active" : ""}`}
            aria-label={`${k.western} ${k.sargam}`}
            data-key={k.key}
            style={{ left: `${left}%`, width: `${blackWidthPct}%` }}
            {...handlers(k.key)}
          >
            <span className="key-label">
              {(notation === "western" || notation === "both") && (
                <span className="western">{k.western}</span>
              )}
              {(notation === "sargam" || notation === "both") && (
                <span className="sargam">{k.sargam}</span>
              )}
            </span>
          </button>
    );
  })}
</div>
  );
}
