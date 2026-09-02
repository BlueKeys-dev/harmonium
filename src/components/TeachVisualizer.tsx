import { useEffect, useRef } from "react";
import {
  TEACH_WRONG_PULSE_MS,
  teachTimelineBeat,
  type TeachNoteStatus,
  type TeachSessionState,
} from "../teachSession";

const LOOKAHEAD_BEATS = 8;
const RESOLVED_TRAIL_MS = 1_250;

interface TeachVisualizerProps {
  session: TeachSessionState;
  activeKeys: Set<number>;
}

interface KeyRect {
  key: number;
  x: number;
  w: number;
}

const COLORS: Record<TeachNoteStatus, { head: string; tail: string; glow: string }> = {
  pending: { head: "#ffd166", tail: "rgba(255, 159, 67, 0.4)", glow: "rgba(255, 173, 70, 0.7)" },
  correct: { head: "#76e6a3", tail: "rgba(32, 184, 103, 0.42)", glow: "rgba(57, 224, 132, 0.8)" },
  missed: { head: "#ff6b6b", tail: "rgba(202, 47, 68, 0.45)", glow: "rgba(255, 70, 88, 0.78)" },
};

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function drawResultMark(
  ctx: CanvasRenderingContext2D,
  status: TeachNoteStatus,
  x: number,
  y: number,
  width: number,
): void {
  if (status === "pending") return;
  const size = Math.min(12, width * 0.4);
  ctx.save();
  ctx.strokeStyle = "rgba(5, 10, 12, 0.82)";
  ctx.lineWidth = Math.max(2, size * 0.18);
  ctx.lineCap = "round";
  ctx.beginPath();
  if (status === "correct") {
    ctx.moveTo(x - size * 0.48, y);
    ctx.lineTo(x - size * 0.12, y + size * 0.36);
    ctx.lineTo(x + size * 0.55, y - size * 0.42);
  } else {
    ctx.moveTo(x - size * 0.42, y - size * 0.42);
    ctx.lineTo(x + size * 0.42, y + size * 0.42);
    ctx.moveTo(x + size * 0.42, y - size * 0.42);
    ctx.lineTo(x - size * 0.42, y + size * 0.42);
  }
  ctx.stroke();
  ctx.restore();
}

export function TeachVisualizer({ session, activeKeys }: TeachVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef(session);
  const activeRef = useRef(activeKeys);
  const keyRectsRef = useRef<KeyRect[]>([]);
  sessionRef.current = session;
  activeRef.current = activeKeys;

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !parent || !ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let raf = 0;
    let disposed = false;
    const measure = () => {
      const canvasRect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(canvasRect.width * dpr));
      canvas.height = Math.max(1, Math.round(canvasRect.height * dpr));
      keyRectsRef.current = [...document.querySelectorAll<HTMLElement>(".key[data-key]")]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            key: Number(element.dataset.key),
            x: rect.left - canvasRect.left,
            w: rect.width,
          };
        })
        .filter((rect) => Number.isInteger(rect.key))
        .sort((a, b) => a.x - b.x);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);

    const draw = () => {
      if (disposed) return;
      raf = requestAnimationFrame(draw);
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;
      if (width < 2 || height < 2) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const nowMs = performance.now();
      const current = sessionRef.current;
      const timelineBeat = teachTimelineBeat(current, nowMs);
      const beatMs = current.lesson ? 60_000 / current.lesson.bpm : 500;
      const pixelsPerBeat = height / LOOKAHEAD_BEATS;
      const strikeY = height - 10;

      ctx.strokeStyle = "rgba(255, 255, 255, 0.045)";
      ctx.lineWidth = 1;
      for (const rect of keyRectsRef.current) {
        const center = rect.x + rect.w / 2;
        ctx.beginPath();
        ctx.moveTo(center, 0);
        ctx.lineTo(center, height);
        ctx.stroke();
      }

      const strikeGradient = ctx.createLinearGradient(0, strikeY - 8, 0, height);
      strikeGradient.addColorStop(0, "rgba(255, 209, 102, 0)");
      strikeGradient.addColorStop(1, "rgba(255, 209, 102, 0.76)");
      ctx.fillStyle = strikeGradient;
      ctx.fillRect(0, strikeY - 8, width, 18);

      for (const note of current.notes) {
        const deltaBeat = note.startBeat - timelineBeat;
        const ageMs = -deltaBeat * beatMs;
        if (deltaBeat > LOOKAHEAD_BEATS || ageMs > RESOLVED_TRAIL_MS) continue;
        const keyRect = keyRectsRef.current.find((rect) => rect.key === note.key);
        if (!keyRect) continue;
        const headY = strikeY - deltaBeat * pixelsPerBeat;
        const barHeight = Math.max(12, note.durationBeats * pixelsPerBeat);
        const top = headY - barHeight;
        if (top > height || headY < -barHeight) continue;

        const pad = keyRect.w * 0.18;
        const barWidth = Math.max(6, keyRect.w - pad * 2);
        const x = keyRect.x + pad;
        const palette = COLORS[note.status];
        const gradient = ctx.createLinearGradient(0, top, 0, headY);
        gradient.addColorStop(0, palette.tail);
        gradient.addColorStop(1, palette.head);
        ctx.save();
        ctx.fillStyle = gradient;
        ctx.shadowColor = palette.glow;
        ctx.shadowBlur = note.status === "pending" ? 12 : 20;
        roundedRect(ctx, x, top, barWidth, barHeight, Math.min(8, barWidth * 0.28));
        ctx.fill();
        ctx.restore();
        drawResultMark(ctx, note.status, x + barWidth / 2, Math.min(headY - 8, top + 12), barWidth);
      }

      const pulse = current.wrongPulse;
      if (pulse && nowMs - pulse.atMs <= TEACH_WRONG_PULSE_MS) {
        const keyRect = keyRectsRef.current.find((rect) => rect.key === pulse.key);
        if (keyRect) {
          const alpha = 1 - (nowMs - pulse.atMs) / TEACH_WRONG_PULSE_MS;
          ctx.fillStyle = `rgba(255, 55, 78, ${0.55 * alpha})`;
          ctx.fillRect(keyRect.x, strikeY - 42, keyRect.w, 48);
        }
      }

      for (const key of activeRef.current) {
        const keyRect = keyRectsRef.current.find((rect) => rect.key === key);
        if (!keyRect) continue;
        const glow = ctx.createRadialGradient(
          keyRect.x + keyRect.w / 2,
          strikeY,
          0,
          keyRect.x + keyRect.w / 2,
          strikeY,
          keyRect.w * 1.8,
        );
        glow.addColorStop(0, "rgba(255, 255, 255, 0.9)");
        glow.addColorStop(0.35, "rgba(255, 209, 102, 0.52)");
        glow.addColorStop(1, "rgba(255, 209, 102, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(keyRect.x + keyRect.w / 2, strikeY, keyRect.w * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    raf = requestAnimationFrame(draw);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="viz-canvas teach-viz-canvas"
      role="img"
      aria-label="Teach piano roll with upcoming, correct, and missed notes"
    />
  );
}
