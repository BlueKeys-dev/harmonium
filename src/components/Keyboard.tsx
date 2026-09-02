import { useMemo } from "react";
import { buildKeyInfos, sargamDisplay } from "../pitch";
import type { Notation } from "../types";

interface KeyboardProps {
  saPitchClass: number;
  notation: Notation;
  activeKeys: Set<number>;
  onDown: (key: number, sourceId: string) => boolean;
  onUp: (sourceId: string) => void;
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
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
      if (e.detail !== 0) return;
      const sourceId = `onscreen:${key}`;
      if (!onDown(key, sourceId)) return;
      window.setTimeout(() => onUp(sourceId), 350);
    },
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      onDown(key, `pointer:${e.pointerId}`);
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => onUp(`pointer:${e.pointerId}`),
    onPointerCancel: (e: React.PointerEvent<HTMLButtonElement>) => onUp(`pointer:${e.pointerId}`),
    onLostPointerCapture: (e: React.PointerEvent<HTMLButtonElement>) => onUp(`pointer:${e.pointerId}`),
  });

  return (
    <div className="keyboard" role="group" aria-label="Harmonium keyboard, 39 keys">
      <div className="white-row">
        {whites.map((k) => (
          <button
            key={k.key}
            type="button"
            className={`key white${activeKeys.has(k.key) ? " active" : ""}`}
            aria-label={`${k.western} ${sargamDisplay(k.sargam)}`}
            data-key={k.key}
            {...handlers(k.key)}
          >
            <span className="key-label">
              {(notation === "western" || notation === "both") && (
                <span className="western">{k.western}</span>
              )}
              {(notation === "sargam" || notation === "both") && (
                <span className="sargam">{sargamDisplay(k.sargam)}</span>
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
            aria-label={`${k.western} ${sargamDisplay(k.sargam)}`}
            data-key={k.key}
            style={{ left: `${left}%`, width: `${blackWidthPct}%` }}
            {...handlers(k.key)}
          >
            <span className="key-label">
              {(notation === "western" || notation === "both") && (
                <span className="western">{k.western}</span>
              )}
              {(notation === "sargam" || notation === "both") && (
                <span className="sargam">{sargamDisplay(k.sargam)}</span>
              )}
            </span>
          </button>
    );
  })}
</div>
  );
}
