import { useEffect, useRef, useState } from "react";

const WHITE_OFFSETS: Record<string, number> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyL: 14,
};

const OCT_DOWN = new Set(["KeyZ", "BracketLeft"]);
const OCT_UP = new Set(["KeyX", "BracketRight"]);
const MIN_OCT = -1;
const MAX_OCT = 2;

/**
 * Computer-keyboard playing around C4 (key 12). A S D F G H J (plus K L) are
 * white keys, W E T Y U are black keys, Z X (or [ ]) shift octave. Keyup
 * always releases the exact key that keydown started, even across octave
 * shifts. Ignores auto-repeat and typing inside form fields.
 */
export function useComputerKeys(
  onDown: (key: number, sourceId: string) => void,
  onUp: (sourceId: string) => void,
): number {
  const [octave, setOctave] = useState(0);
  const heldRef = useRef(new Map<string, number>());

  useEffect(() => {
    const base = () => 12 + octave * 12;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest("input, textarea, select")) return;

      if (OCT_DOWN.has(e.code)) {
        setOctave((o) => Math.max(MIN_OCT, o - 1));
        return;
      }
      if (OCT_UP.has(e.code)) {
        setOctave((o) => Math.min(MAX_OCT, o + 1));
        return;
      }
      const offset = WHITE_OFFSETS[e.code];
      if (offset === undefined || heldRef.current.has(e.code)) return;
      const key = base() + offset;
      if (key < 0 || key > 38) return;
      heldRef.current.set(e.code, key);
      onDown(key, `keyboard:${e.code}`);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const key = heldRef.current.get(e.code);
      if (key === undefined) return;
      heldRef.current.delete(e.code);
      onUp(`keyboard:${e.code}`);
    };

    const onBlur = () => {
      for (const code of heldRef.current.keys()) onUp(`keyboard:${code}`);
      heldRef.current.clear();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      onBlur();
    };
  }, [octave, onDown, onUp]);

  return octave;
}
