"use client";

import { useEffect, useRef, useState } from "react";
import { frameAtSource, sourceThumbnails } from "@/lib/reel/probe";
import { FPS, LIMITS, type ReelClip } from "@/lib/reel/recipe";

// Trim a video clip: a filmstrip of the source with the kept part between two
// handles (drag them: touch or mouse; arrow keys move a frame, Shift a
// second), the exact frame at the handle last moved, and ±1 frame buttons.
// A drag starts on a handle, or after a sideways move elsewhere on the strip;
// a tap only shows that frame, and an up-down swipe scrolls the sheet.

const STRIP_FRAMES = 8;
const FRAME = 1 / FPS;
const snap = (s: number) => Math.round(s * FPS) / FPS;
/** How near a handle (px) a press grabs it at once. */
const GRAB_PX = 22;
/** How far (px) a press elsewhere moves sideways before it drags the nearer handle. */
const SLOP_PX = 6;

type Edge = "in" | "out";

export function TrimScrubber({ clip, onTrim }: { clip: ReelClip; onTrim: (patch: { inSec?: number; outSec?: number }) => void }) {
  const total = clip.source.durationSec ?? Math.max(clip.outSec, 1);
  const minLen = LIMITS.minClipSec * clip.speed;
  const track = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const exact = useRef<HTMLCanvasElement>(null);
  const [edge, setEdge] = useState<Edge>("in");
  const [frameState, setFrameState] = useState<"loading" | "ready" | "failed">("loading");
  const dragging = useRef<{ edge: Edge; pointer: number; offset: number } | null>(null);
  const pending = useRef<{ pointer: number; x: number; y: number } | null>(null);
  /** A frame tapped on the strip: shown, the trim unchanged. */
  const [peek, setPeek] = useState<number | null>(null);
  const url = clip.source.url;
  const at = peek ?? (edge === "in" ? clip.inSec : clip.outSec);
  const atEnd = peek === null && edge === "out";

  // The filmstrip: a few frames across the whole source.
  useEffect(() => {
    if (!(total > 0)) return;
    const ac = new AbortController();
    const times = Array.from({ length: STRIP_FRAMES }, (_, i) => ((i + 0.5) / STRIP_FRAMES) * total);
    let bitmaps: ImageBitmap[] = [];
    sourceThumbnails(url, times, 120, ac.signal).then(
      (out) => {
        bitmaps = out;
        if (ac.signal.aborted) return;
        const canvases = strip.current?.querySelectorAll("canvas") ?? [];
        out.forEach((b, i) => {
          const c = canvases[i];
          if (!c) return;
          c.width = b.width;
          c.height = b.height;
          c.getContext("2d")?.drawImage(b, 0, 0);
          c.dataset.ready = "true";
        });
        out.forEach((b) => b.close());
        bitmaps = [];
      },
      () => {},
    );
    return () => {
      ac.abort();
      bitmaps.forEach((b) => b.close());
    };
  }, [url, total]);

  // The exact frame at the handle last moved (only the newest request draws).
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => {
      setFrameState((s) => (s === "ready" ? s : "loading"));
      const sec = atEnd ? Math.max(0, at - FRAME / 2) : at;
      frameAtSource(url, sec, 480).then(
        (bitmap) => {
          const c = exact.current;
          if (live && c) {
            c.width = bitmap.width;
            c.height = bitmap.height;
            c.getContext("2d")?.drawImage(bitmap, 0, 0);
            setFrameState("ready");
          }
          bitmap.close();
        },
        () => live && setFrameState("failed"),
      );
    }, 60);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [url, at, atEnd]);

  function set(which: Edge, sec: number) {
    setEdge(which);
    setPeek(null);
    if (which === "in") onTrim({ inSec: Math.min(Math.max(0, snap(sec)), clip.outSec - minLen) });
    else onTrim({ outSec: Math.max(Math.min(total, snap(sec)), clip.inSec + minLen) });
  }

  function secAt(clientX: number) {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    return (Math.min(Math.max(clientX - r.left, 0), r.width) / r.width) * total;
  }

  /** The handle nearer to x (client px) and how far it is, in px. */
  function nearest(clientX: number): { which: Edge; px: number } {
    const r = track.current?.getBoundingClientRect();
    const w = r && r.width > 0 ? r.width : 1;
    const x = clientX - (r?.left ?? 0);
    const dIn = Math.abs(x - (clip.inSec / total) * w);
    const dOut = Math.abs(x - (clip.outSec / total) * w);
    return dIn <= dOut ? { which: "in", px: dIn } : { which: "out", px: dOut };
  }

  /** Starts dragging a handle; it moves with the pointer from where it is (no jump). */
  function begin(el: HTMLDivElement, pointer: number, which: Edge, fromX: number) {
    const handle = which === "in" ? clip.inSec : clip.outSec;
    dragging.current = { edge: which, pointer, offset: secAt(fromX) - handle };
    pending.current = null;
    setEdge(which);
    setPeek(null);
    try {
      el.setPointerCapture(pointer);
    } catch {
      // Capture is a nicety.
    }
  }

  function down(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const near = nearest(e.clientX);
    if (near.px <= GRAB_PX) begin(e.currentTarget, e.pointerId, near.which, e.clientX);
    else pending.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY };
  }
  function move(e: React.PointerEvent<HTMLDivElement>) {
    const p = pending.current;
    if (p && p.pointer === e.pointerId) {
      const dx = Math.abs(e.clientX - p.x);
      const dy = Math.abs(e.clientY - p.y);
      if (dy > SLOP_PX && dy >= dx) pending.current = null;
      else if (dx > SLOP_PX) begin(e.currentTarget, e.pointerId, nearest(p.x).which, p.x);
      else return;
    }
    const d = dragging.current;
    if (!d || d.pointer !== e.pointerId) return;
    set(d.edge, secAt(e.clientX) - d.offset);
  }
  function up(e: React.PointerEvent<HTMLDivElement>) {
    if (dragging.current?.pointer === e.pointerId) dragging.current = null;
    if (pending.current?.pointer === e.pointerId) {
      pending.current = null;
      // A tap: show that frame, keep the trim.
      setPeek(Math.min(Math.max(0, snap(secAt(e.clientX))), total));
    }
  }
  function cancel(e: React.PointerEvent<HTMLDivElement>) {
    if (dragging.current?.pointer === e.pointerId) dragging.current = null;
    if (pending.current?.pointer === e.pointerId) pending.current = null;
  }
  function key(which: Edge, e: React.KeyboardEvent) {
    const step = e.shiftKey ? 1 : FRAME;
    const cur = which === "in" ? clip.inSec : clip.outSec;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") set(which, cur - step);
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") set(which, cur + step);
    else if (e.key === "Home") set(which, which === "in" ? 0 : clip.inSec + minLen);
    else if (e.key === "End") set(which, which === "in" ? clip.outSec - minLen : total);
    else return;
    e.preventDefault();
  }

  const left = (clip.inSec / total) * 100;
  const right = (clip.outSec / total) * 100;
  const kept = clip.outSec - clip.inSec;

  return (
    <div className="st-re-trim">
      <div className="st-re-trim-frame">
        <canvas ref={exact} data-ready={frameState === "ready"} role="img" aria-label={`Frame at ${at.toFixed(2)} s`} />
        <span className="st-mchip st-tnum">
          {peek !== null ? "Frame" : edge === "in" ? "Start" : "End"} {at.toFixed(2)} s
        </span>
        {frameState === "failed" && <span className="st-re-trim-msg">Can&apos;t show this frame.</span>}
      </div>

      <div ref={track} className="st-re-trim-track" data-no-sheet-drag="" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}>
        <div ref={strip} className="st-re-trim-strip" aria-hidden="true">
          {Array.from({ length: STRIP_FRAMES }, (_, i) => (
            <canvas key={i} />
          ))}
        </div>
        <span className="st-re-trim-dim" style={{ left: 0, width: `${left}%` }} aria-hidden="true" />
        <span className="st-re-trim-dim" style={{ left: `${right}%`, right: 0 }} aria-hidden="true" />
        <span className="st-re-trim-keep" style={{ left: `${left}%`, width: `${right - left}%` }} aria-hidden="true" />
        <span
          className="st-re-trim-handle"
          data-edge="in"
          style={{ left: `${left}%` }}
          role="slider"
          tabIndex={0}
          aria-label="Start of the clip"
          aria-valuemin={0}
          aria-valuemax={Math.round(total * 100) / 100}
          aria-valuenow={clip.inSec}
          aria-valuetext={`${clip.inSec.toFixed(2)} seconds`}
          onKeyDown={(e) => key("in", e)}
          onFocus={() => {
            setEdge("in");
            setPeek(null);
          }}
        />
        <span
          className="st-re-trim-handle"
          data-edge="out"
          style={{ left: `${right}%` }}
          role="slider"
          tabIndex={0}
          aria-label="End of the clip"
          aria-valuemin={0}
          aria-valuemax={Math.round(total * 100) / 100}
          aria-valuenow={clip.outSec}
          aria-valuetext={`${clip.outSec.toFixed(2)} seconds`}
          onKeyDown={(e) => key("out", e)}
          onFocus={() => {
            setEdge("out");
            setPeek(null);
          }}
        />
      </div>

      <div className="st-re-trim-steps">
        <div className="st-re-trim-step">
          <span className="st-note">Start</span>
          <button type="button" className="st-icon-btn" aria-label="Start one frame earlier" onClick={() => set("in", clip.inSec - FRAME)} disabled={clip.inSec <= 0}>
            <span aria-hidden="true">−1</span>
          </button>
          <span className="st-tnum st-re-val">{clip.inSec.toFixed(2)}</span>
          <button type="button" className="st-icon-btn" aria-label="Start one frame later" onClick={() => set("in", clip.inSec + FRAME)} disabled={kept <= minLen}>
            <span aria-hidden="true">+1</span>
          </button>
        </div>
        <div className="st-re-trim-step">
          <span className="st-note">End</span>
          <button type="button" className="st-icon-btn" aria-label="End one frame earlier" onClick={() => set("out", clip.outSec - FRAME)} disabled={kept <= minLen}>
            <span aria-hidden="true">−1</span>
          </button>
          <span className="st-tnum st-re-val">{clip.outSec.toFixed(2)}</span>
          <button type="button" className="st-icon-btn" aria-label="End one frame later" onClick={() => set("out", clip.outSec + FRAME)} disabled={clip.outSec >= total}>
            <span aria-hidden="true">+1</span>
          </button>
        </div>
      </div>
      <p className="st-note st-tnum">
        Keeps {kept.toFixed(2)} s of {total.toFixed(1)} s. Buttons and arrow keys move one frame (1/{FPS} s). Tap the strip to see a frame.
      </p>
      {clip.inSec > 0 || clip.outSec < total ? (
        <button type="button" className="st-btn st-btn-quiet st-btn-sm st-re-trim-all" onClick={() => onTrim({ inSec: 0, outSec: Math.round(total * 100) / 100 })}>
          Use the whole video
        </button>
      ) : null}
    </div>
  );
}
