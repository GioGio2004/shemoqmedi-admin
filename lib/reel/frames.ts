// Pictures for the compositor (lib/reel/compositor.ts drawFrame).
//
//   createRenderFrames: the final render. Every video clip is decoded with
//   mediabunny (CanvasSink.canvasesAtTimestamps) at exactly the source times
//   its frames need (trim and speed included), each packet decoded once;
//   stills are ImageBitmaps. Clips open when they start and close (decoder,
//   canvases, bitmaps, downloads) as soon as the reel has passed them.
//
//   createPreviewFrames: the editor's live preview. Muted <video> elements
//   (two per source at most, so a clip can crossfade into another cut of the
//   same video) that play along with the audio clock, or seek when paused.
//
// Contract: docs/reel-editor.md section 3.

import { ALL_FORMATS, BlobSource, CanvasSink, Input, type InputVideoTrack, type WrappedCanvas } from "mediabunny";
import { aspectSize, isVideoKind, type ClipSource, type ReelRecipe } from "./recipe";
import { buildTimeline, coverRect, frameAt, frameCount, frameTime, MOTION_ZOOM, type Frame, type Layer, type Timeline } from "./timeline";

export type FrameImage = { source: CanvasImageSource; width: number; height: number };

export interface FrameProvider {
  /** Get what frame f needs ready (decode / seek / load). The render awaits it every frame; the preview may skip. */
  prepare(frame: Frame, signal?: AbortSignal): Promise<void>;
  /** The picture of a layer now (stills: the image; videos: the frame at layer.sourceSec), or null when not ready. */
  image(layer: Layer): FrameImage | null;
  /** Close every VideoFrame / VideoSample / ImageBitmap it holds. */
  dispose(): void;
}

/** A clip's source can't be read (download, CORS, codec). The message is for people. */
export class ReelSourceError extends Error {
  override name = "ReelSourceError";
  constructor(
    message: string,
    readonly clipIndex: number | null = null,
  ) {
    super(message);
  }
}

export class ReelAbortError extends Error {
  override name = "AbortError";
  constructor() {
    super("Cancelled.");
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new ReelAbortError();
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers: downloads, image sizing and loading
// ─────────────────────────────────────────────────────────────────────────────

const IK = /^https:\/\/ik\.imagekit\.io\//;

/** An ImageKit URL resized to `width` (never past the original); other URLs as they are. */
export function sizedImageUrl(url: string, width: number) {
  if (!IK.test(url) || /[?&]tr=/.test(url) || /\/tr:/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}tr=w-${Math.round(width)}`;
}

/**
 * How wide a picture must be decoded so it stays sharp at its biggest on the
 * reel (cover fit, Ken Burns zoom), never wider than it is. `scale` = output
 * canvas width / reel width. Unknown sizes: twice the frame's width.
 */
export function neededWidth(
  source: Pick<ClipSource, "width" | "height">,
  reelW: number,
  reelH: number,
  scale = 1,
  cap = 2160,
) {
  const outW = reelW * scale;
  const outH = reelH * scale;
  if (!source.width || !source.height) return Math.min(cap, Math.ceil(outW * 2));
  const cover = coverRect(source.width, source.height, outW, outH);
  return Math.max(16, Math.min(source.width, cap, Math.ceil(cover.w * MOTION_ZOOM * 1.05)));
}

/** Rounds a width up to a step so preview and render share cached files. */
function stepWidth(w: number) {
  return Math.ceil(w / 120) * 120;
}

export async function download(url: string, what: string, signal?: AbortSignal): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(url, { signal, mode: "cors" });
  } catch (err) {
    if (signal?.aborted) throw new ReelAbortError();
    void err;
    throw new ReelSourceError(
      `Could not download the ${what}. The storage may not allow this site (CORS) or the network dropped. Try again.`,
    );
  }
  if (!res.ok) throw new ReelSourceError(`Could not download the ${what} (HTTP ${res.status}).`);
  return res.blob();
}

function imageFromElement(url: string, signal?: AbortSignal): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    const done = () => signal?.removeEventListener("abort", abort);
    const abort = () => {
      img.src = "";
      done();
      reject(new ReelAbortError());
    };
    signal?.addEventListener("abort", abort, { once: true });
    img.onload = () => {
      done();
      createImageBitmap(img).then(resolve, () => reject(new ReelSourceError("Could not read a picture.")));
    };
    img.onerror = () => {
      done();
      reject(new ReelSourceError("Could not load a picture. The storage may not allow this site (CORS)."));
    };
    img.src = url;
  });
}

/** A picture as an ImageBitmap, ImageKit-sized to `width` (EXIF orientation applied). */
export async function loadBitmap(url: string, width: number, signal?: AbortSignal): Promise<ImageBitmap> {
  const sized = sizedImageUrl(url, stepWidth(width));
  throwIfAborted(signal);
  try {
    const blob = await download(sized, "picture", signal);
    try {
      return await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      // SVG and a few formats only decode through an <img>.
      return await imageFromElement(URL.createObjectURL(blob), signal);
    }
  } catch (err) {
    if (err instanceof ReelAbortError) throw err;
    return imageFromElement(sized, signal);
  }
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

// ─────────────────────────────────────────────────────────────────────────────
// Render frames (mediabunny, frame-exact)
// ─────────────────────────────────────────────────────────────────────────────

type VideoState = {
  input: Input | null;
  track: InputVideoTrack | null;
  sink: CanvasSink | null;
  width: number;
  height: number;
  times: number[];
  idx: number;
  iterator: AsyncGenerator<WrappedCanvas | null, void, unknown> | null;
  current: WrappedCanvas | null;
};

type StillState = { bitmap: ImageBitmap };

/**
 * The source time (seconds, presentation time: 0 = the file's time 0) the
 * render decodes for every output frame of each video clip, by clip id. The
 * same layer.sourceSec the preview seeks its <video> to and the clip's sound
 * starts from, so the preview is the output.
 */
export function renderSourceTimes(recipe: ReelRecipe, timeline: Timeline = buildTimeline(recipe)): Map<string, number[]> {
  const times = new Map<string, number[]>();
  const n = frameCount(timeline.durationSec, recipe.reel.fps);
  for (let i = 0; i < n; i++) {
    const f = frameAt(timeline, frameTime(i, recipe.reel.fps));
    for (const l of [f.a, f.b]) {
      if (!l || !isVideoKind(l.item.clip.source.kind)) continue;
      const list = times.get(l.item.id) ?? [];
      list.push(l.sourceSec);
      times.set(l.item.id, list);
    }
  }
  return times;
}

/** Lets go of everything a video clip holds (decoder, canvas pool, the file). */
function releaseVideo(v: VideoState) {
  const it = v.iterator;
  v.iterator = null;
  v.current = null;
  if (it) void it.return(undefined).catch(() => {});
  v.input?.dispose();
  v.input = null;
  v.track = null;
  v.sink = null;
  v.times = [];
}

/**
 * The render's frames: one Input per video clip (from a downloaded Blob,
 * shared by clips of the same file), decoded in order at the exact source
 * time of every output frame. prepare() must be called for frames in order.
 * Source time 0 is presentation time 0, as for <video> and the clip's sound.
 */
class RenderFrames implements FrameProvider {
  private readonly timeline: Timeline;
  private readonly W: number;
  private readonly H: number;
  /** Source times each video clip needs, in order (by clip id). */
  private readonly times: Map<string, number[]>;
  /** The last clip index that uses each URL (downloads are let go after it). */
  private readonly lastUse = new Map<string, number>();
  private readonly blobs = new Map<string, Promise<Blob>>();
  private readonly videos = new Map<string, Promise<VideoState>>();
  private readonly settled = new Map<string, VideoState>();
  private readonly stills = new Map<string, Promise<StillState>>();
  private readonly stillsReady = new Map<string, StillState>();
  /** Clips the reel has passed: closed for good, never reopened. */
  private readonly closed = new Set<string>();
  private readonly abort = new AbortController();
  private readonly linked = new Set<AbortSignal>();
  private disposed = false;

  constructor(
    private readonly recipe: ReelRecipe,
    signal?: AbortSignal,
  ) {
    const { width, height } = aspectSize(recipe.reel.aspect);
    this.W = width;
    this.H = height;
    this.timeline = buildTimeline(recipe);
    this.times = renderSourceTimes(recipe, this.timeline);
    for (const item of this.timeline.items) this.lastUse.set(item.clip.source.url, item.index);
    this.link(signal);
  }

  /** Cancelling the render cancels every download and wait in here at once. */
  private link(signal?: AbortSignal) {
    if (!signal || this.linked.has(signal)) return;
    this.linked.add(signal);
    if (signal.aborted) this.abort.abort();
    else signal.addEventListener("abort", () => this.abort.abort(), { once: true });
  }

  /** `p`, or a ReelAbortError as soon as the render is cancelled (a stalled download can't hold Cancel). */
  private guard<T>(p: Promise<T>): Promise<T> {
    const s = this.abort.signal;
    if (s.aborted) {
      p.catch(() => {});
      return Promise.reject(new ReelAbortError());
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(new ReelAbortError());
      s.addEventListener("abort", onAbort, { once: true });
      p.then(
        (v) => {
          s.removeEventListener("abort", onAbort);
          resolve(v);
        },
        (e) => {
          s.removeEventListener("abort", onAbort);
          reject(e);
        },
      );
    });
  }

  private blob(url: string, index: number) {
    let p = this.blobs.get(url);
    if (!p) {
      p = download(url, `video of clip ${index + 1}`, this.abort.signal);
      p.catch(() => {});
      this.blobs.set(url, p);
    }
    return p;
  }

  private openVideo(layer: Layer): Promise<VideoState> {
    const { item } = layer;
    if (this.closed.has(item.id)) return Promise.reject(new ReelAbortError());
    let p = this.videos.get(item.id);
    if (p) return p;
    p = (async () => {
      const n = item.index + 1;
      const blob = await this.blob(item.clip.source.url, item.index);
      const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
      let state: VideoState;
      try {
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new ReelSourceError(`Clip ${n}: the file has no video in it.`, item.index);
        if (!(await track.canDecode())) {
          throw new ReelSourceError(`Clip ${n}: this browser can't decode its video. Try Chrome or Edge on a computer.`, item.index);
        }
        const dw = await track.getDisplayWidth();
        const dh = await track.getDisplayHeight();
        const need = neededWidth({ width: dw, height: dh }, this.W, this.H);
        const s = Math.min(1, need / dw);
        const width = even(dw * s);
        const height = even(dh * s);
        const sink = new CanvasSink(track, { width, height, fit: "fill", poolSize: 3 });
        const times = this.times.get(item.id) ?? [layer.sourceSec];
        state = { input, track, sink, width, height, times, idx: 0, iterator: sink.canvasesAtTimestamps(times), current: null };
      } catch (err) {
        input.dispose();
        if (err instanceof ReelSourceError || err instanceof ReelAbortError) throw err;
        throw new ReelSourceError(`Clip ${n}: its video could not be read (${err instanceof Error ? err.message : String(err)}).`, item.index);
      }
      if (this.disposed || this.closed.has(item.id)) {
        releaseVideo(state);
        throw new ReelAbortError();
      }
      this.settled.set(item.id, state);
      return state;
    })();
    p.catch(() => {});
    this.videos.set(item.id, p);
    return p;
  }

  private async advance(state: VideoState, layer: Layer) {
    const want = layer.sourceSec + 1e-6;
    while (state.iterator && state.idx < state.times.length && state.times[state.idx] <= want) {
      const r = await this.guard(state.iterator.next());
      state.idx++;
      if (r.done) {
        state.idx = state.times.length;
        break;
      }
      if (r.value) state.current = r.value;
    }
    if (!state.current) {
      if (!state.track) throw new ReelAbortError();
      // Before the first frame (or past a gap): the nearest frame there is.
      const one = new CanvasSink(state.track, { width: state.width, height: state.height, fit: "fill" });
      const first = await this.guard(state.track.getFirstTimestamp().catch(() => 0));
      state.current = (await this.guard(one.getCanvas(Math.max(first, layer.sourceSec)))) ?? null;
      if (!state.current) {
        throw new ReelSourceError(`Clip ${layer.item.index + 1}: no picture at ${layer.sourceSec.toFixed(2)} s of its video.`, layer.item.index);
      }
    }
  }

  private openStill(layer: Layer): Promise<StillState> {
    const { item } = layer;
    if (this.closed.has(item.id)) return Promise.reject(new ReelAbortError());
    let p = this.stills.get(item.id);
    if (!p) {
      p = (async () => {
        try {
          const bitmap = await loadBitmap(item.clip.source.url, neededWidth(item.clip.source, this.W, this.H), this.abort.signal);
          const state = { bitmap };
          if (this.disposed || this.closed.has(item.id)) bitmap.close();
          else this.stillsReady.set(item.id, state);
          return state;
        } catch (err) {
          if (err instanceof ReelAbortError) throw err;
          throw new ReelSourceError(`Clip ${item.index + 1}: its picture could not be loaded. ${err instanceof Error ? err.message : ""}`.trim(), item.index);
        }
      })();
      p.catch(() => {});
      this.stills.set(item.id, p);
    }
    return p;
  }

  async prepare(frame: Frame, signal?: AbortSignal) {
    this.link(signal);
    throwIfAborted(signal);
    if (this.disposed || this.abort.signal.aborted) throw new ReelAbortError();
    const layers = [frame.a, frame.b].filter((l): l is Layer => !!l);
    if (!layers.length) return;
    const t = layers[0].item.start + layers[0].localSec;
    for (const layer of layers) {
      if (isVideoKind(layer.item.clip.source.kind)) {
        const state = await this.guard(this.openVideo(layer));
        await this.advance(state, layer);
      } else {
        await this.guard(this.openStill(layer));
      }
      throwIfAborted(signal);
    }
    // Get the next clip's file going while this one renders.
    const next = this.timeline.items[Math.max(...layers.map((l) => l.item.index)) + 1];
    if (next && next.start - t < 3) {
      if (isVideoKind(next.clip.source.kind)) void this.blob(next.clip.source.url, next.index).catch(() => {});
      else void this.openStill({ item: next, localSec: 0, progress: 0, sourceSec: 0 }).catch(() => {});
    }
    // Let go of clips the reel has passed.
    const active = new Set(layers.map((l) => l.item.id));
    for (const item of this.timeline.items) {
      if (item.end > t || active.has(item.id) || this.closed.has(item.id)) continue;
      this.closeClip(item.id);
      // Its file is not needed again: let the download go.
      if ((this.lastUse.get(item.clip.source.url) ?? -1) <= item.index) this.blobs.delete(item.clip.source.url);
    }
  }

  private closeClip(id: string) {
    this.closed.add(id);
    const v = this.settled.get(id);
    if (v) {
      this.settled.delete(id);
      releaseVideo(v);
    }
    this.videos.delete(id);
    const s = this.stillsReady.get(id);
    if (s) {
      this.stillsReady.delete(id);
      s.bitmap.close();
    }
    this.stills.delete(id);
  }

  image(layer: Layer): FrameImage | null {
    if (isVideoKind(layer.item.clip.source.kind)) {
      const c = this.settled.get(layer.item.id)?.current;
      return c ? { source: c.canvas as CanvasImageSource, width: c.canvas.width, height: c.canvas.height } : null;
    }
    const s = this.stillsReady.get(layer.item.id);
    return s ? { source: s.bitmap, width: s.bitmap.width, height: s.bitmap.height } : null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    // Close what is open; clips still loading close themselves when they arrive (disposed).
    for (const id of [...this.settled.keys(), ...this.stillsReady.keys()]) this.closeClip(id);
    this.blobs.clear();
    this.videos.clear();
    this.stills.clear();
  }
}

export function createRenderFrames(recipe: ReelRecipe, signal?: AbortSignal): FrameProvider {
  return new RenderFrames(recipe, signal);
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview frames (<video> / ImageBitmap, near real time)
// ─────────────────────────────────────────────────────────────────────────────

type VideoEl = { el: HTMLVideoElement; url: string; used: number; failed: boolean };
type ImgEntry = { bitmap: ImageBitmap | null; width: number; promise: Promise<void>; failed: boolean; used: number };

const MAX_VIDEOS = 6;
const MAX_IMAGES = 24;
/** Playing: re-seek a video that drifted this far from the audio clock. */
const DRIFT_SEC = 0.3;

export type PreviewFramesOptions = {
  /** Where the hidden <video> elements live (inside the player, so iOS keeps decoding them). */
  host?: HTMLElement | null;
  /** The preview canvas's width in pixels (pictures are loaded about that sharp). */
  canvasWidth?: number;
};

/** The preview's frames; the player also calls setRecipe / setPlaying / ready. */
export class PreviewFrames implements FrameProvider {
  private recipe: ReelRecipe;
  private timeline: Timeline;
  private readonly videos = new Map<string, VideoEl>();
  private readonly images = new Map<string, ImgEntry>();
  private playing = false;
  private disposed = false;
  private host: HTMLElement | null;
  private canvasWidth: number;
  private clock = 0;

  constructor(recipe: ReelRecipe, opts: PreviewFramesOptions = {}) {
    this.recipe = recipe;
    this.timeline = buildTimeline(recipe);
    this.host = opts.host ?? null;
    this.canvasWidth = opts.canvasWidth ?? 540;
  }

  setRecipe(recipe: ReelRecipe, timeline: Timeline = buildTimeline(recipe)) {
    this.recipe = recipe;
    this.timeline = timeline;
  }

  setCanvasWidth(width: number) {
    this.canvasWidth = width;
  }

  setPlaying(playing: boolean) {
    this.playing = playing;
    if (!playing) for (const v of this.videos.values()) if (!v.el.paused) v.el.pause();
  }

  private key(layer: Layer) {
    return `${layer.item.clip.source.url}#${layer.item.index % 2}`;
  }

  private video(layer: Layer): VideoEl {
    const key = this.key(layer);
    let v = this.videos.get(key);
    if (!v) {
      const el = document.createElement("video");
      el.crossOrigin = "anonymous";
      el.muted = true;
      el.defaultMuted = true;
      el.playsInline = true;
      el.setAttribute("playsinline", "");
      el.setAttribute("aria-hidden", "true");
      el.preload = "auto";
      el.disablePictureInPicture = true;
      el.style.cssText = "position:absolute;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;";
      const entry: VideoEl = { el, url: layer.item.clip.source.url, used: ++this.clock, failed: false };
      el.addEventListener("error", () => {
        entry.failed = true;
      });
      el.src = layer.item.clip.source.url;
      this.host?.appendChild(el);
      v = entry;
      this.videos.set(key, v);
      this.trimVideos();
    }
    v.used = ++this.clock;
    return v;
  }

  private trimVideos() {
    if (this.videos.size <= MAX_VIDEOS) return;
    const old = [...this.videos.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [key, v] of old.slice(0, this.videos.size - MAX_VIDEOS)) {
      this.dropVideo(v);
      this.videos.delete(key);
    }
  }

  private dropVideo(v: VideoEl) {
    v.el.pause();
    v.el.removeAttribute("src");
    v.el.load();
    v.el.remove();
  }

  private still(layer: Layer): ImgEntry {
    const url = layer.item.clip.source.url;
    const { width: W, height: H } = aspectSize(this.recipe.reel.aspect);
    const want = neededWidth(layer.item.clip.source, W, H, this.canvasWidth / W, 1600);
    let e = this.images.get(url);
    if (e && !e.failed && e.width < want * 0.8 && e.bitmap) {
      // Needs a sharper copy now (bigger canvas): load it, keep showing the old one meanwhile.
      const old = e;
      const next: ImgEntry = { bitmap: old.bitmap, width: want, failed: false, used: ++this.clock, promise: Promise.resolve() };
      next.promise = loadBitmap(url, want).then(
        (b) => {
          if (this.disposed) return b.close();
          old.bitmap?.close();
          next.bitmap = b;
        },
        () => {},
      );
      this.images.set(url, next);
      e = next;
    }
    if (!e) {
      const entry: ImgEntry = { bitmap: null, width: want, failed: false, used: ++this.clock, promise: Promise.resolve() };
      entry.promise = loadBitmap(url, want).then(
        (b) => {
          if (this.disposed) return b.close();
          entry.bitmap = b;
        },
        () => {
          entry.failed = true;
        },
      );
      this.images.set(url, entry);
      e = entry;
      this.trimImages();
    }
    e.used = ++this.clock;
    return e;
  }

  private trimImages() {
    if (this.images.size <= MAX_IMAGES) return;
    const old = [...this.images.entries()].sort((a, b) => a[1].used - b[1].used);
    for (const [url, e] of old.slice(0, this.images.size - MAX_IMAGES)) {
      e.bitmap?.close();
      e.bitmap = null;
      this.images.delete(url);
    }
  }

  /** Paused: seek each video to its frame and wait for it; load pictures. Playing: keep the videos in step (no wait). */
  async prepare(frame: Frame, signal?: AbortSignal) {
    if (this.disposed) return;
    const layers = [frame.a, frame.b].filter((l): l is Layer => !!l);
    if (this.playing) {
      this.sync(layers);
      for (const l of layers) if (!isVideoKind(l.item.clip.source.kind)) this.still(l);
      return;
    }
    for (const v of this.videos.values()) if (!v.el.paused) v.el.pause();
    await Promise.all(
      layers.map(async (l) => {
        if (isVideoKind(l.item.clip.source.kind)) {
          const v = this.video(l);
          await seekTo(v, l.sourceSec, signal);
        } else {
          await this.still(l).promise;
        }
      }),
    );
  }

  private sync(layers: Layer[]) {
    const active = new Set<string>();
    for (const l of layers) {
      if (!isVideoKind(l.item.clip.source.kind)) continue;
      const v = this.video(l);
      const key = this.key(l);
      active.add(key);
      const el = v.el;
      if (v.failed) continue;
      const rate = l.item.clip.speed;
      if (el.playbackRate !== rate) el.playbackRate = rate;
      const drift = Math.abs(el.currentTime - l.sourceSec);
      if (el.paused) {
        if (drift > 0.05 && el.readyState >= 1) el.currentTime = l.sourceSec;
        void el.play().catch(() => {});
      } else if (drift > DRIFT_SEC && !el.seeking) {
        el.currentTime = l.sourceSec;
      }
    }
    // The next clip: get its first frame ready.
    const last = Math.max(-1, ...layers.map((l) => l.item.index));
    const next = this.timeline.items[last + 1];
    const now = layers.length ? layers[0].item.start + layers[0].localSec : 0;
    if (next && next.start - now < 1.5) {
      const nl: Layer = { item: next, localSec: 0, progress: 0, sourceSec: next.clip.inSec };
      if (isVideoKind(next.clip.source.kind)) {
        const key = this.key(nl);
        if (!active.has(key)) {
          const v = this.video(nl);
          active.add(key);
          if (!v.el.paused) v.el.pause();
          if (Math.abs(v.el.currentTime - next.clip.inSec) > 0.05 && v.el.readyState >= 1 && !v.el.seeking) v.el.currentTime = next.clip.inSec;
        }
      } else this.still(nl);
    }
    for (const [key, v] of this.videos) if (!active.has(key) && !v.el.paused) v.el.pause();
  }

  /** True when every layer of the frame has its picture (failed sources count as ready: they show black). */
  ready(frame: Frame): boolean {
    for (const l of [frame.a, frame.b]) {
      if (!l) continue;
      if (isVideoKind(l.item.clip.source.kind)) {
        const v = this.videos.get(this.key(l));
        if (!v) return false;
        if (v.failed) continue;
        if (v.el.readyState < 2 || (!this.playing && v.el.seeking)) return false;
      } else {
        const e = this.images.get(l.item.clip.source.url);
        if (!e) return false;
        if (!e.bitmap && !e.failed) return false;
      }
    }
    return true;
  }

  image(layer: Layer): FrameImage | null {
    if (isVideoKind(layer.item.clip.source.kind)) {
      const v = this.videos.get(this.key(layer));
      if (!v || v.failed || v.el.readyState < 2 || !v.el.videoWidth) return null;
      return { source: v.el, width: v.el.videoWidth, height: v.el.videoHeight };
    }
    const e = this.images.get(layer.item.clip.source.url);
    return e?.bitmap ? { source: e.bitmap, width: e.bitmap.width, height: e.bitmap.height } : null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const v of this.videos.values()) this.dropVideo(v);
    this.videos.clear();
    for (const e of this.images.values()) {
      e.bitmap?.close();
      e.bitmap = null;
    }
    this.images.clear();
  }
}

/** Seeks a paused <video> and resolves when that frame can be drawn (or after a timeout / error). */
function seekTo(v: VideoEl, sec: number, signal?: AbortSignal, timeoutMs = 6000): Promise<void> {
  const el = v.el;
  if (v.failed) return Promise.resolve();
  const close = Math.abs(el.currentTime - sec) <= 0.5 / 30;
  if (close && el.readyState >= 2 && !el.seeking) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let timer = 0;
    const finish = () => {
      clearTimeout(timer);
      el.removeEventListener("seeked", onSeeked);
      el.removeEventListener("loadeddata", onData);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("error", finish);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const onSeeked = () => {
      if (el.readyState >= 2) finish();
    };
    const onData = () => {
      if (!el.seeking && Math.abs(el.currentTime - sec) <= 0.5 / 30) finish();
    };
    const onMeta = () => {
      el.currentTime = sec;
    };
    el.addEventListener("seeked", onSeeked);
    el.addEventListener("loadeddata", onData);
    el.addEventListener("error", finish);
    signal?.addEventListener("abort", finish, { once: true });
    timer = window.setTimeout(finish, timeoutMs);
    if (el.readyState >= 1) el.currentTime = sec;
    else el.addEventListener("loadedmetadata", onMeta, { once: true });
  });
}

export function createPreviewFrames(recipe: ReelRecipe, opts?: PreviewFramesOptions): PreviewFrames {
  return new PreviewFrames(recipe, opts);
}
