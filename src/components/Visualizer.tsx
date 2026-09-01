import { useEffect, useRef } from "react";
import * as Tone from "tone";
import { engine } from "../audioEngine";
import type { Score } from "../scorePlayer";

const LOOKAHEAD_S = 6; // seconds of future visible above the keyboard
const PAST_S = 1.2; // keep finished bars fading below for a beat

interface VisualizerProps {
  score: Score | null;
  playing: boolean;
}

interface KeyRect {
  key: number;
  x: number;
  w: number;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawBar(ctx: CanvasRenderingContext2D, kr: KeyRect, top: number, h: number, alpha: number): void {
  const pad = kr.w * 0.2;
  const bw = Math.max(6, kr.w - pad * 2);
  const bx = kr.x + pad;
  const r = Math.min(9, bw * 0.3, h * 0.4);

  const g = ctx.createLinearGradient(0, top, 0, top + h);
  g.addColorStop(0, `rgba(255,132,72,${0.3 * alpha})`);
  g.addColorStop(0.55, `rgba(255,96,36,${0.8 * alpha})`);
  g.addColorStop(1, `rgba(255,90,31,${alpha})`);

  ctx.save();
  ctx.shadowColor = `rgba(255,90,31,${0.75 * alpha})`;
  ctx.shadowBlur = 18;
  ctx.fillStyle = g;
  roundRectPath(ctx, bx, top, bw, h, r);
  ctx.fill();

  // hot head right above the impact point
  ctx.shadowBlur = 26;
  ctx.fillStyle = `rgba(255,196,140,${0.55 * alpha})`;
  roundRectPath(ctx, bx + bw * 0.2, top + h - r * 1.5, bw * 0.6, r * 1.1, r / 2);
  ctx.fill();
  ctx.restore();
}

function drawBloom(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, "rgba(255,196,140,0.95)");
  g.addColorStop(0.3, "rgba(255,90,31,0.6)");
  g.addColorStop(1, "rgba(255,90,31,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Synthesia-style falling reed bars, driven by the score and the audio clock.
 * While idle it previews the loaded score as a static constellation; while
 * playing, bars fall in sync with Tone.Transport and bloom on impact.
 */
export function Visualizer({ score, playing }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scoreRef = useRef(score);
  scoreRef.current = score;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const activeRef = useRef<Set<number>>(new Set());
  const keyRectsRef = useRef<KeyRect[]>([]);

  useEffect(
    () =>
      engine.subscribe(() => {
        activeRef.current = new Set(engine.getActiveKeys());
      }),
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const parent = canvas.parentElement;
    if (!ctx || !parent) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let raf = 0;
    let disposed = false;

    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const base = rect;
      const rects: KeyRect[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(".key[data-key]")) {
        const k = Number(el.dataset.key);
        if (!isFinite(k)) continue;
        const r = el.getBoundingClientRect();
        rects.push({ key: k, x: r.left - base.left, w: r.width });
      }
      rects.sort((a, b) => a.x - b.x);
      keyRectsRef.current = rects;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(parent);

    const draw = () => {
      if (disposed) return;
      raf = requestAnimationFrame(draw);
      const W = canvas.width / dpr;
      const H = canvas.height / dpr;
      if (W < 2 || H < 2) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const pxPerSec = H / LOOKAHEAD_S;
      const isPlaying = playingRef.current;
      const now = isPlaying ? Tone.getTransport().seconds : 0;

      // faint key guide lines (Icarus-style vertical grid)
      ctx.strokeStyle = "rgba(255,255,255,0.035)";
      ctx.lineWidth = 1;
      for (const kr of keyRectsRef.current) {
        const cx = kr.x + kr.w / 2;
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, H);
        ctx.stroke();
      }

      // ember line hugging the keyboard
      const ember = ctx.createLinearGradient(0, H - 7, 0, H);
      ember.addColorStop(0, "rgba(255,90,31,0)");
      ember.addColorStop(1, `rgba(255,90,31,${isPlaying ? 0.75 : 0.4})`);
      ctx.fillStyle = ember;
      ctx.fillRect(0, H - 7, W, 7);

      const events = scoreRef.current?.events ?? [];
      for (const ev of events) {
        const dt = ev.t - now; // seconds until this reed hits
        if (dt > LOOKAHEAD_S || dt < -PAST_S) continue;
        const kr = keyRectsRef.current.find((r) => r.key === ev.key);
        if (!kr) continue;
        const headY = H - dt * pxPerSec;
        const h = Math.max(10, ev.dur * pxPerSec);
        const top = headY - h;
        if (top > H || headY < -h * 0.5) continue;
        const prox = dt <= 0 ? 1 : Math.max(0.3, 1 - (dt / LOOKAHEAD_S) * 0.7);
        const alpha = (isPlaying ? 0.95 : 0.55) * prox;
        drawBar(ctx, kr, top, h, alpha);
      }

      // blooms on currently sounding keys
      for (const k of activeRef.current) {
        const kr = keyRectsRef.current.find((r) => r.key === k);
        if (!kr) continue;
        drawBloom(ctx, kr.x + kr.w / 2, H - 4, kr.w * 1.8);
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className="viz-canvas" aria-hidden />;
}
