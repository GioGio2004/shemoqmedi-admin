"use client";

// The reel editor's live preview: a canvas in the reel's shape drawn by the
// same compositor as the final render (lib/reel/compositor.ts drawFrame), so
// what plays here is what the MP4 gets. The sound is the render's own mix
// (lib/reel/audio.ts mixAudio) played through an AudioContext; its clock
// drives the picture (video follows; a frame that isn't ready keeps the last
// one; slow devices drop frames, never sound). Paused, the playhead draws
// its frame once the clips there are ready. Never plays by itself.
// Contract: docs/reel-editor.md section 3 (PreviewPlayer).

import { useEffect, useRef, useState, type JSX } from "react";
import { aspectSize, type ReelRecipe } from "@/lib/reel/recipe";
import { buildTimeline, frameAt, type Timeline } from "@/lib/reel/timeline";
import { drawFrame, releaseCompositor } from "@/lib/reel/compositor";
import { PreviewFrames } from "@/lib/reel/frames";
import { audioKey, mixAudio, planAudio } from "@/lib/reel/audio";
import { ensureReelFonts } from "@/lib/reel/fonts";

export type PreviewPlayerProps = {
  recipe: ReelRecipe;
  /** Controlled playhead (s). */
  time: number;
  playing: boolean;
  /** While playing (every drawn frame), and at the end (durationSec). */
  onTime: (t: number) => void;
  /** false when the reel ends. */
  onPlayingChange: (playing: boolean) => void;
  className?: string;
};

type Callbacks = { onTime: (t: number) => void; onEnd: () => void; onReady: () => void };

const REMIX_MS = 350;
/** A playhead moved this far by the editor while playing is a jump, not the player's own report. */
const JUMP_SEC = 0.25;

function previewMaxWidth() {
  if (typeof window === "undefined") return 540;
  const phone = window.matchMedia?.("(pointer: coarse)").matches || window.innerWidth < 700;
  return phone ? 540 : 1080;
}

/** Everything outside React: frames, sound, clock, the draw loop. */
class PreviewEngine {
  private recipe: ReelRecipe;
  private timeline: Timeline;
  private readonly frames: PreviewFrames;
  private readonly ctx: CanvasRenderingContext2D;
  private boxWidth = 0;
  private playing = false;
  private disposed = false;
  private raf = 0;
  private drawToken = 0;
  private drawn = false;
  /** Last time reported to the editor while playing. */
  private reported = 0;

  private audio: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private node: AudioBufferSourceNode | null = null;
  private mixKey = "";
  private mixTimer: ReturnType<typeof setTimeout> | null = null;
  private mixToken = 0;

  // The clock: reel time = anchorTime + elapsed (audio clock when the sound runs, else performance.now()).
  private anchorTime = 0;
  private anchorAudio = 0;
  private anchorPerf = 0;
  private audioClock = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    host: HTMLElement,
    recipe: ReelRecipe,
    private readonly cb: Callbacks,
  ) {
    this.recipe = recipe;
    this.timeline = buildTimeline(recipe);
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("No 2D canvas.");
    this.ctx = ctx;
    this.frames = new PreviewFrames(recipe, { host, canvasWidth: canvas.width });
    void ensureReelFonts().then(() => {
      if (!this.playing && !this.disposed) this.seek(this.reported, true);
    });
  }

  get durationSec() {
    return this.timeline.durationSec;
  }

  setRecipe(recipe: ReelRecipe) {
    const aspectChanged = recipe.reel.aspect !== this.recipe.reel.aspect;
    this.recipe = recipe;
    this.timeline = buildTimeline(recipe);
    this.frames.setRecipe(recipe, this.timeline);
    if (aspectChanged) this.resize(this.boxWidth);
    this.scheduleMix();
    if (!this.playing) this.seek(this.reported, true);
  }

  resize(boxWidth: number) {
    if (this.disposed) return;
    this.boxWidth = boxWidth;
    const { width: W, height: H } = aspectSize(this.recipe.reel.aspect);
    const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    const want = Math.max(2, Math.min(previewMaxWidth(), W, Math.round((boxWidth || 360) * dpr)));
    const w = Math.max(2, Math.round(want / 2) * 2);
    const h = Math.max(2, Math.round((w * H) / W / 2) * 2);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.frames.setCanvasWidth(w);
      this.drawn = false;
      if (!this.playing) this.seek(this.reported, true);
    }
  }

  // ── Sound ──────────────────────────────────────────────────────────────

  /** Creates / resumes the AudioContext (call from a user gesture: iOS needs one). */
  unlockAudio() {
    if (this.disposed) return;
    if (!this.audio) {
      try {
        this.audio = new AudioContext({ latencyHint: "interactive", sampleRate: 48_000 });
      } catch {
        try {
          this.audio = new AudioContext();
        } catch {
          return;
        }
      }
    }
    if (this.audio.state === "suspended") void this.audio.resume().catch(() => {});
  }

  private scheduleMix() {
    const key = audioKey(this.recipe);
    if (key === this.mixKey) return;
    this.mixKey = key;
    if (this.mixTimer) clearTimeout(this.mixTimer);
    const token = ++this.mixToken;
    this.mixTimer = setTimeout(() => {
      this.mixTimer = null;
      const recipe = this.recipe;
      const dur = this.timeline.durationSec;
      if (!(dur > 0) || !planAudio(recipe, dur, this.timeline).tracks.length) {
        this.setBuffer(null);
        return;
      }
      mixAudio(recipe, dur).then(
        (buffer) => {
          if (token === this.mixToken && !this.disposed) this.setBuffer(buffer);
        },
        () => {
          // A sound file can't be read: the preview plays silent (the render reports the problem).
          if (token === this.mixToken && !this.disposed) this.setBuffer(null);
        },
      );
    }, this.buffer ? REMIX_MS : 0);
  }

  private setBuffer(buffer: AudioBuffer | null) {
    this.buffer = buffer;
    if (this.playing) {
      const t = this.now();
      this.stopSound();
      this.anchor(t);
    }
  }

  private stopSound() {
    if (!this.node) return;
    try {
      this.node.onended = null;
      this.node.stop();
    } catch {
      // Already stopped.
    }
    this.node.disconnect();
    this.node = null;
  }

  /** Re-anchors the clock at reel time t and (re)starts the sound there. */
  private anchor(t: number) {
    this.anchorTime = t;
    this.anchorPerf = performance.now();
    this.audioClock = false;
    if (this.playing && this.buffer && this.audio && this.audio.state === "running" && t < this.buffer.duration) {
      const node = this.audio.createBufferSource();
      node.buffer = this.buffer;
      node.connect(this.audio.destination);
      node.start(0, Math.max(0, t));
      this.node = node;
      this.anchorAudio = this.audio.currentTime;
      this.audioClock = true;
    }
  }

  private now() {
    if (this.audioClock && this.audio && this.audio.state === "running") return this.anchorTime + (this.audio.currentTime - this.anchorAudio);
    return this.anchorTime + (performance.now() - this.anchorPerf) / 1000;
  }

  // ── Transport ──────────────────────────────────────────────────────────

  /** Follows the editor's playing / time props. */
  control(playing: boolean, time: number) {
    if (this.disposed) return;
    const dur = this.timeline.durationSec;
    if (playing && !this.playing) {
      if (!(dur > 0)) {
        this.cb.onEnd();
        return;
      }
      const start = time >= dur - 1 / 30 ? 0 : Math.max(0, time);
      if (start !== time) this.cb.onTime(start);
      this.play(start);
    } else if (playing) {
      if (Math.abs(time - this.reported) > JUMP_SEC) {
        this.stopSound();
        this.anchor(Math.max(0, Math.min(time, dur)));
      }
    } else {
      if (this.playing) this.pause();
      this.seek(time);
    }
  }

  private play(t: number) {
    this.unlockAudio();
    this.playing = true;
    this.reported = t;
    this.frames.setPlaying(true);
    this.anchor(t);
    // The AudioContext may still be resuming: re-anchor on the audio clock once it runs.
    if (this.audio && this.audio.state !== "running") {
      const audio = this.audio;
      void audio.resume().then(
        () => {
          if (this.playing && !this.audioClock && audio.state === "running") {
            const now = this.now();
            this.stopSound();
            this.anchor(now);
          }
        },
        () => {},
      );
    }
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.stopSound();
    this.audioClock = false;
    this.frames.setPlaying(false);
  }

  private tick = () => {
    if (!this.playing || this.disposed) return;
    const dur = this.timeline.durationSec;
    const t = this.now();
    if (t >= dur) {
      this.pause();
      this.reported = dur;
      this.seek(dur, true);
      this.cb.onTime(dur);
      this.cb.onEnd();
      return;
    }
    const frame = frameAt(this.timeline, t);
    void this.frames.prepare(frame);
    if (this.frames.ready(frame)) this.draw(t);
    this.reported = t;
    this.cb.onTime(t);
    this.raf = requestAnimationFrame(this.tick);
  };

  /** Paused: draws time t once its clips are ready (newest request wins). */
  seek(t: number, force = false) {
    if (this.disposed) return;
    if (!force && this.drawn && Math.abs(t - this.reported) < 1e-4) return;
    this.reported = t;
    const token = ++this.drawToken;
    const frame = frameAt(this.timeline, t);
    void this.frames.prepare(frame).then(() => {
      if (token !== this.drawToken || this.playing || this.disposed) return;
      this.draw(t);
    });
  }

  private draw(t: number) {
    const { width: W } = aspectSize(this.recipe.reel.aspect);
    drawFrame(this.ctx, this.recipe, t, this.frames, { timeline: this.timeline, scale: this.canvas.width / W });
    if (!this.drawn) {
      this.drawn = true;
      this.cb.onReady();
    }
  }

  dispose() {
    this.disposed = true;
    this.pause();
    if (this.mixTimer) clearTimeout(this.mixTimer);
    this.frames.dispose();
    releaseCompositor(this.canvas);
    void this.audio?.close().catch(() => {});
    this.audio = null;
    this.buffer = null;
  }
}

export function PreviewPlayer({ recipe, time, playing, onTime, onPlayingChange, className }: PreviewPlayerProps): JSX.Element {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<PreviewEngine | null>(null);
  const handlers = useRef({ onTime, onPlayingChange });
  const [ready, setReady] = useState(false);
  const { width: W, height: H } = aspectSize(recipe.reel.aspect);
  const empty = recipe.clips.length === 0;

  useEffect(() => {
    handlers.current = { onTime, onPlayingChange };
  });

  // The engine: made once, then told about every recipe.
  useEffect(() => {
    let engine = engineRef.current;
    if (!engine) {
      const canvas = canvasRef.current;
      const host = hostRef.current;
      if (!canvas || !host) return;
      engine = new PreviewEngine(canvas, host, recipe, {
        onTime: (t) => handlers.current.onTime(t),
        onEnd: () => handlers.current.onPlayingChange(false),
        onReady: () => setReady(true),
      });
      engineRef.current = engine;
      engine.resize(wrapRef.current?.clientWidth ?? 0);
    }
    engine.setRecipe(recipe);
  }, [recipe]);

  useEffect(
    () => () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    },
    [],
  );

  // Play / pause / seek from the editor.
  useEffect(() => {
    engineRef.current?.control(playing, time);
  }, [playing, time]);

  // Canvas resolution follows the box (≤ 1080 px, ≤ 540 on phones).
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? wrap.clientWidth;
      engineRef.current?.resize(w);
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // iOS only lets sound start inside a tap: unlock the AudioContext on the first one.
  useEffect(() => {
    const unlock = () => engineRef.current?.unlockAudio();
    document.addEventListener("pointerdown", unlock, { capture: true });
    document.addEventListener("keydown", unlock, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", unlock, { capture: true });
      document.removeEventListener("keydown", unlock, { capture: true });
    };
  }, []);

  return (
    <div
      ref={wrapRef}
      className={className}
      role="img"
      aria-label="Reel preview"
      style={{ position: "relative", aspectRatio: `${W} / ${H}`, background: "#000", overflow: "hidden", isolation: "isolate" }}
    >
      {/* The hidden <video> elements live here (iOS keeps decoding videos that are in the page). */}
      <div
        ref={hostRef}
        aria-hidden="true"
        style={{ position: "absolute", left: 0, top: 0, width: 2, height: 2, overflow: "hidden", opacity: 0.01, pointerEvents: "none", zIndex: -1 }}
      />
      <canvas ref={canvasRef} width={2} height={2} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
      {!ready && !empty ? (
        <div
          aria-live="polite"
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: "rgba(255,255,255,0.72)",
            font: "500 13px/1.3 var(--st-font, system-ui, sans-serif)",
            letterSpacing: "0.01em",
            pointerEvents: "none",
          }}
        >
          Loading clips
        </div>
      ) : null}
    </div>
  );
}
