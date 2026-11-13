// The final render, in the browser: the recipe → an Instagram-safe MP4.
//
//   frames (lib/reel/frames.ts, exact source times) ─▶ drawFrame on one
//   OffscreenCanvas ─▶ H.264 (30 fps, keyframe every 2 s) ─┐
//   mixAudio (48 kHz stereo) ─▶ AAC 128 kb/s ──────────────┴▶ MP4 (fast start)
//
// The same compositor and mix as the preview, so the preview is the output.
// Progress and cancel; every VideoFrame / sample is closed as soon as it is
// encoded (CanvasSource does it for the frames, the audio chunks are closed
// here) and the frame provider is disposed in finally. Over 100 MB stops early
// with "too-big". Contract: docs/reel-editor.md section 3.

import {
  AudioSample,
  AudioSampleSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  canEncodeAudio,
  canEncodeVideo,
} from "mediabunny";
import { UploadError } from "@/lib/imagekitUpload";
import { aspectSize, validateRecipe, type ReelRecipe } from "./recipe";
import { buildTimeline, frameAt, frameCount, frameTime } from "./timeline";
import { drawFrame, releaseCompositor, type Ctx2D } from "./compositor";
import { createRenderFrames, ReelAbortError, ReelSourceError } from "./frames";
import { mixAudio, SAMPLE_RATE } from "./audio";
import { ensureReelFonts } from "./fonts";

/** Keep in sync with the render limit in convex/lib/reel.ts (100 MB). */
export const MAX_RENDER_BYTES = 100 * 1024 * 1024;
export const AUDIO_BITRATE = 128_000;
const KEYFRAME_SEC = 2;

export type RenderSupport = { ok: boolean; reason: string | null };

export const NO_VIDEO_ENCODER = "This browser can't make videos. Open the Studio in Chrome or Edge on a computer.";
export const NO_AAC = "This browser can't encode the sound (AAC). Render on a computer in Chrome or Edge.";

let support: Promise<RenderSupport> | null = null;

/** Whether this browser can render reels (H.264 + AAC), with a reason for people when it can't. */
export function renderSupport(): Promise<RenderSupport> {
  support ??= (async (): Promise<RenderSupport> => {
    if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return { ok: false, reason: NO_VIDEO_ENCODER };
    if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") return { ok: false, reason: NO_AAC };
    if (typeof OffscreenCanvas === "undefined" && typeof document === "undefined") return { ok: false, reason: NO_VIDEO_ENCODER };
    try {
      const video = await canEncodeVideo("avc", { width: 1080, height: 1920, frameRate: 30, quality: new Quality({ bitrate: 8_000_000 }) });
      if (!video) return { ok: false, reason: NO_VIDEO_ENCODER };
      const audio = await canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: SAMPLE_RATE, quality: new Quality({ bitrate: AUDIO_BITRATE }) });
      if (!audio) return { ok: false, reason: NO_AAC };
    } catch {
      return { ok: false, reason: NO_VIDEO_ENCODER };
    }
    return { ok: true, reason: null };
  })();
  return support;
}

export type RenderStage = "Preparing" | "Mixing sound" | "Rendering" | "Finishing";
export type RenderProgress = { stage: RenderStage; fraction: number };
export type RenderErrorCode = "unsupported" | "too-big" | "cancelled" | "source" | "encode";

export class RenderError extends Error {
  override name = "RenderError";
  constructor(
    readonly code: RenderErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The video bitrate: about 8 Mb/s for a full 1080×1920 reel (less for smaller
 * frames), lowered for long reels so the file stays under 100 MB.
 */
export function videoBitrate(width: number, height: number, durationSec: number) {
  const base = Math.min(8_000_000, Math.max(5_000_000, (8_000_000 * width * height) / (1080 * 1920)));
  if (!(durationSec > 0)) return base;
  const budget = ((MAX_RENDER_BYTES * 0.9 * 8) / durationSec - AUDIO_BITRATE) * 0.85;
  return Math.round(Math.max(1_500_000, Math.min(base, budget)));
}

/** Where each stage sits in the overall 0..1 progress. */
const SPAN: Record<RenderStage, [number, number]> = {
  Preparing: [0, 0.03],
  "Mixing sound": [0.03, 0.1],
  Rendering: [0.1, 0.97],
  Finishing: [0.97, 1],
};

/** Overall progress for a stage that is `p` (0..1) done. */
export function overallProgress(stage: RenderStage, p: number) {
  const [a, b] = SPAN[stage];
  return a + (b - a) * Math.min(1, Math.max(0, p));
}

function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function toRenderError(err: unknown, signal?: AbortSignal): RenderError {
  if (err instanceof RenderError) return err;
  if (signal?.aborted || err instanceof ReelAbortError || (err instanceof Error && err.name === "AbortError")) {
    return new RenderError("cancelled", "Render cancelled.");
  }
  if (err instanceof ReelSourceError) return new RenderError("source", err.message);
  const msg = err instanceof Error ? err.message : String(err);
  return new RenderError("encode", `The render failed: ${msg}`);
}

/**
 * Renders the reel. `onProgress` gets the stage and the overall fraction.
 * Throws a RenderError (code + a message for people).
 */
export async function render(
  recipe: ReelRecipe,
  onProgress: (p: RenderProgress) => void,
  signal?: AbortSignal,
): Promise<{ blob: Blob; width: number; height: number; durationSec: number }> {
  const report = (stage: RenderStage, p: number) => onProgress({ stage, fraction: overallProgress(stage, p) });
  const problems = validateRecipe(recipe, { forRender: true });
  if (problems.length) throw new RenderError("source", problems[0]);
  const ok = await renderSupport();
  if (!ok.ok) throw new RenderError("unsupported", ok.reason ?? NO_VIDEO_ENCODER);
  if (signal?.aborted) throw new RenderError("cancelled", "Render cancelled.");

  report("Preparing", 0);
  const { width: W, height: H } = aspectSize(recipe.reel.aspect);
  const fps = recipe.reel.fps;
  const timeline = buildTimeline(recipe);
  if (!(timeline.durationSec > 0)) throw new RenderError("source", "Add at least one clip.");
  const n = frameCount(timeline.durationSec, fps);
  const durationSec = n / fps;
  const bitrate = videoBitrate(W, H, durationSec);
  const videoQuality = new Quality({ bitrate, bitrateMode: "variable" });
  const audioQuality = new Quality({ bitrate: AUDIO_BITRATE });
  if (!(await canEncodeVideo("avc", { width: W, height: H, frameRate: fps, quality: videoQuality }))) {
    throw new RenderError("unsupported", `This browser can't encode ${W}×${H} H.264 video. Open the Studio in Chrome or Edge on a computer.`);
  }
  await ensureReelFonts();
  report("Preparing", 1);

  report("Mixing sound", 0);
  let audio: AudioBuffer;
  try {
    audio = await mixAudio(recipe, durationSec, signal);
  } catch (err) {
    throw toRenderError(err, signal);
  }
  report("Mixing sound", 1);
  if (signal?.aborted) throw new RenderError("cancelled", "Render cancelled.");

  const canvas = makeCanvas(W, H);
  const ctx = canvas.getContext("2d", { alpha: false }) as Ctx2D | null;
  if (!ctx) throw new RenderError("unsupported", NO_VIDEO_ENCODER);

  let bytes = 0;
  const count = (packet: { byteLength: number }) => {
    bytes += packet.byteLength;
  };
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const videoSource = new CanvasSource(canvas, { codec: "avc", quality: videoQuality, keyFrameInterval: KEYFRAME_SEC, onEncodedPacket: count });
  const audioSource = new AudioSampleSource({ codec: "aac", quality: audioQuality, onEncodedPacket: count });
  output.addVideoTrack(videoSource, { frameRate: fps });
  output.addAudioTrack(audioSource);

  const frames = createRenderFrames(recipe, signal);
  const tooBig = () => new RenderError("too-big", "The reel came out over 100 MB. Make it shorter or use fewer moving clips.");
  try {
    await output.start();

    // The sound, in one-second chunks (each closed once it is encoded).
    const feedAudio = async () => {
      const L = audio.getChannelData(0);
      const R = audio.getChannelData(audio.numberOfChannels > 1 ? 1 : 0);
      const total = Math.min(audio.length, Math.round(durationSec * SAMPLE_RATE));
      for (let at = 0; at < total; at += SAMPLE_RATE) {
        if (signal?.aborted) throw new ReelAbortError();
        const k = Math.min(SAMPLE_RATE, total - at);
        const data = new Float32Array(k * 2);
        data.set(L.subarray(at, at + k), 0);
        data.set(R.subarray(at, at + k), k);
        const sample = new AudioSample({ data, format: "f32-planar", numberOfChannels: 2, sampleRate: SAMPLE_RATE, timestamp: at / SAMPLE_RATE });
        try {
          await audioSource.add(sample);
        } finally {
          sample.close();
        }
      }
      audioSource.close();
    };
    const audioDone = feedAudio();
    audioDone.catch(() => {});

    report("Rendering", 0);
    let lastReport = 0;
    for (let i = 0; i < n; i++) {
      if (signal?.aborted) throw new ReelAbortError();
      if (bytes > MAX_RENDER_BYTES) throw tooBig();
      const t = frameTime(i, fps);
      await frames.prepare(frameAt(timeline, t), signal);
      drawFrame(ctx, recipe, t, frames, { timeline, scale: 1 });
      await videoSource.add(t, 1 / fps);
      const now = Date.now();
      if (now - lastReport > 120 || i === n - 1) {
        lastReport = now;
        report("Rendering", (i + 1) / n);
      }
    }
    videoSource.close();
    await audioDone;

    report("Finishing", 0);
    await output.finalize();
  } catch (err) {
    await output.cancel().catch(() => {});
    throw toRenderError(err, signal);
  } finally {
    frames.dispose();
    releaseCompositor(canvas);
  }

  const buffer = output.target.buffer;
  if (!buffer) throw new RenderError("encode", "The render produced no file. Try again.");
  if (buffer.byteLength > MAX_RENDER_BYTES) throw tooBig();
  const blob = new Blob([buffer], { type: "video/mp4" });
  report("Finishing", 1);
  return { blob, width: W, height: H, durationSec: Math.round(durationSec * 1000) / 1000 };
}

/**
 * PUTs a rendered reel to a presigned R2 URL (reels.renderUploadUrl), with
 * upload progress. Throws an UploadError with a message for people.
 */
export function uploadRender(
  blob: Blob,
  uploadUrl: string,
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new UploadError("Upload cancelled."));
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", "video/mp4");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) opts.onProgress?.(e.loaded / e.total);
    };
    const onAbort = () => xhr.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const done = () => opts.signal?.removeEventListener("abort", onAbort);
    xhr.onload = () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) {
        opts.onProgress?.(1);
        resolve();
      } else reject(new UploadError(`Reel upload failed (HTTP ${xhr.status}). Please try again.`));
    };
    xhr.onerror = () => {
      done();
      // No answer to read: the browser blocked the PUT (R2's CORS policy).
      reject(
        new UploadError(
          `The reel was rendered but the upload was blocked. Allow PUT from ${location.origin} in the R2 bucket's CORS policy, then try again.`,
        ),
      );
    };
    xhr.onabort = () => {
      done();
      reject(new UploadError("Upload cancelled."));
    };
    xhr.send(blob);
  });
}
