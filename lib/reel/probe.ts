// What the editor needs to know about a source before it cuts it: size,
// length, whether it has sound (probeSource), a filmstrip for the trim
// scrubber (sourceThumbnails) and the exact frame at a time (frameAtSource).
// Videos are read with mediabunny over HTTP range requests (falling back to
// one plain download when the storage doesn't answer those); a few recently
// used files stay open so scrubbing doesn't reopen them. Pictures go through
// the same loader as the compositor (ImageKit-sized).

import {
  ALL_FORMATS,
  BlobSource,
  CanvasSink,
  Input,
  UrlSource,
  type InputAudioTrack,
  type InputVideoTrack,
  type Source,
} from "mediabunny";
import { download, loadBitmap, ReelAbortError, ReelSourceError } from "./frames";

export type ProbeResult = { width: number; height: number; durationSec: number | null; hasAudio: boolean };

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|svg|bmp)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv)(\?|#|$)/i;

/** True when a URL is surely a picture (by its extension). */
export function looksLikeImage(url: string) {
  return IMAGE_EXT.test(url) && !VIDEO_EXT.test(url);
}

type Opened = {
  input: Input;
  video: InputVideoTrack | null;
  audio: InputAudioTrack | null;
  /** The first frame's timestamp. Source times are presentation times (0 = time 0, as for <video>, the clip's sound and the render). */
  first: number;
  durationSec: number | null;
  sinks: Map<number, CanvasSink>;
  used: number;
  chain: Promise<unknown>;
};

const MAX_OPEN = 3;
const IDLE_MS = 90_000;
const open = new Map<string, Promise<Opened>>();
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function closeIdle() {
  idleTimer = null;
  for (const [url, p] of open) {
    void p.then((o) => {
      if (Date.now() - o.used > IDLE_MS) {
        open.delete(url);
        o.input.dispose();
      }
    }, () => open.delete(url));
  }
  if (open.size) idleTimer = setTimeout(closeIdle, IDLE_MS);
}

async function readInput(source: Source): Promise<Omit<Opened, "used" | "chain" | "sinks">> {
  const input = new Input({ source, formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    if (!video && !audio) throw new ReelSourceError("The file has no video or sound in it.");
    const tracks = [video, audio].filter((t): t is InputVideoTrack | InputAudioTrack => !!t);
    const first = video ? await video.getFirstTimestamp().catch(() => 0) : 0;
    let end: number | null = null;
    try {
      end = await input.computeDuration(tracks);
    } catch {
      end = await input.getDurationFromMetadata(tracks).catch(() => null);
    }
    return { input, video, audio, first: Math.max(0, first), durationSec: end && end > 0 ? Math.max(0.01, end) : null };
  } catch (err) {
    input.dispose();
    throw err;
  }
}

/** Opens a media file (cached, a few at a time). */
function openMedia(url: string): Promise<Opened> {
  let p = open.get(url);
  if (!p) {
    p = (async () => {
      let base: Omit<Opened, "used" | "chain" | "sinks">;
      try {
        base = await readInput(new UrlSource(url, { getRetryDelay: (n) => (n < 2 ? 0.5 : null), maxCacheSize: 32 * 1024 * 1024 }));
      } catch (err) {
        if (err instanceof ReelSourceError) throw err;
        // Some storage answers range requests badly (or CORS hides them): read it whole once.
        const blob = await download(url, "video");
        try {
          base = await readInput(new BlobSource(blob));
        } catch (e) {
          if (e instanceof ReelSourceError) throw e;
          throw new ReelSourceError("This file can't be read as a video or a sound.");
        }
      }
      return { ...base, sinks: new Map(), used: Date.now(), chain: Promise.resolve() };
    })();
    p.catch(() => open.delete(url));
    open.set(url, p);
    // Keep only the most recently used few.
    if (open.size > MAX_OPEN) {
      const oldest = open.keys().next().value as string;
      const old = open.get(oldest);
      open.delete(oldest);
      void old?.then((o) => o.input.dispose(), () => {});
    }
    if (!idleTimer) idleTimer = setTimeout(closeIdle, IDLE_MS);
  } else {
    // Move to the end (most recent).
    open.delete(url);
    open.set(url, p);
  }
  return p.then((o) => {
    o.used = Date.now();
    return o;
  });
}

const probes = new Map<string, Promise<ProbeResult>>();

/**
 * Size, length and sound of a source. Videos and audio: from the file
 * (durationSec of the content); pictures: their size, durationSec null.
 * Throws a ReelSourceError with a message for people.
 */
export function probeSource(url: string): Promise<ProbeResult> {
  let p = probes.get(url);
  if (!p) {
    p = (async (): Promise<ProbeResult> => {
      if (!looksLikeImage(url)) {
        try {
          const o = await openMedia(url);
          return {
            width: o.video ? await o.video.getDisplayWidth() : 0,
            height: o.video ? await o.video.getDisplayHeight() : 0,
            durationSec: o.durationSec,
            hasAudio: !!o.audio,
          };
        } catch (err) {
          if (VIDEO_EXT.test(url)) throw err instanceof ReelSourceError ? err : new ReelSourceError("This video can't be read.");
          // Not media: try it as a picture.
        }
      }
      try {
        const bitmap = await loadBitmap(url, 4096);
        const out = { width: bitmap.width, height: bitmap.height, durationSec: null, hasAudio: false };
        bitmap.close();
        return out;
      } catch (err) {
        throw err instanceof ReelSourceError ? err : new ReelSourceError("This picture can't be loaded.");
      }
    })();
    p.catch(() => probes.delete(url));
    probes.set(url, p);
  }
  return p;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

async function sinkFor(o: Opened, maxWidth: number) {
  const track = o.video!;
  const key = Math.round(maxWidth);
  let sink = o.sinks.get(key);
  if (!sink) {
    const dw = await track.getDisplayWidth();
    const dh = await track.getDisplayHeight();
    const s = Math.min(1, maxWidth / dw);
    sink = new CanvasSink(track, { width: even(dw * s), height: even(dh * s), fit: "fill" });
    o.sinks.set(key, sink);
  }
  return sink;
}

/** Runs jobs on one file one after another (decoders don't like being asked twice at once). */
function queued<T>(o: Opened, job: () => Promise<T>): Promise<T> {
  const run = o.chain.then(job, job);
  o.chain = run.catch(() => {});
  return run;
}

function abortError() {
  return typeof DOMException !== "undefined" ? new DOMException("Cancelled.", "AbortError") : new ReelAbortError();
}

/**
 * Pictures of a source at the given source times (seconds), at most
 * `maxWidth` wide, in the order asked: the trim scrubber's filmstrip. Pictures
 * (stills) give the same picture for every time.
 */
export async function sourceThumbnails(url: string, times: number[], maxWidth: number, signal?: AbortSignal): Promise<ImageBitmap[]> {
  if (signal?.aborted) throw abortError();
  if (!times.length) return [];
  if (looksLikeImage(url)) return stillThumbs(url, times.length, maxWidth, signal);
  let o: Opened;
  try {
    o = await openMedia(url);
  } catch (err) {
    if (!VIDEO_EXT.test(url)) return stillThumbs(url, times.length, maxWidth, signal);
    throw err;
  }
  if (!o.video) throw new ReelSourceError("This file has no picture.");
  return queued(o, async () => {
    const sink = await sinkFor(o, maxWidth);
    const order = times.map((t, i) => ({ t: Math.max(0, t), i })).sort((a, b) => a.t - b.t);
    const out: ImageBitmap[] = new Array(times.length);
    const it = sink.canvasesAtTimestamps(order.map((x) => x.t));
    let k = 0;
    let last: ImageBitmap | null = null;
    try {
      for await (const wrapped of it) {
        if (signal?.aborted) throw abortError();
        const slot = order[k++];
        if (!slot) break;
        if (wrapped) last = await createImageBitmap(wrapped.canvas);
        else if (!last) {
          const firstFrame = await sink.getCanvas(o.first);
          if (firstFrame) last = await createImageBitmap(firstFrame.canvas);
        }
        out[slot.i] = last ? await createImageBitmap(last) : await blankBitmap();
      }
    } catch (err) {
      out.forEach((b) => b?.close());
      throw err;
    } finally {
      last?.close();
      await it.return(undefined).catch(() => {});
    }
    for (let i = 0; i < out.length; i++) out[i] ??= await blankBitmap();
    return out;
  });
}

async function stillThumbs(url: string, count: number, maxWidth: number, signal?: AbortSignal) {
  const bitmap = await loadBitmap(url, maxWidth, signal);
  try {
    const s = Math.min(1, maxWidth / bitmap.width);
    const opts = { resizeWidth: Math.max(1, Math.round(bitmap.width * s)), resizeHeight: Math.max(1, Math.round(bitmap.height * s)), resizeQuality: "medium" as const };
    return await Promise.all(Array.from({ length: count }, () => createImageBitmap(bitmap, opts)));
  } finally {
    bitmap.close();
  }
}

async function blankBitmap() {
  const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(2, 2) : Object.assign(document.createElement("canvas"), { width: 2, height: 2 });
  return createImageBitmap(c);
}

/** The exact frame shown at `sec` seconds of a source, at most `maxWidth` wide: the frame-accurate scrubber. */
export async function frameAtSource(url: string, sec: number, maxWidth: number): Promise<ImageBitmap> {
  if (looksLikeImage(url)) return (await stillThumbs(url, 1, maxWidth))[0];
  const o = await openMedia(url);
  if (!o.video) throw new ReelSourceError("This file has no picture.");
  return queued(o, async () => {
    const sink = await sinkFor(o, maxWidth);
    const wrapped = (await sink.getCanvas(Math.max(0, sec))) ?? (await sink.getCanvas(o.first));
    if (!wrapped) throw new ReelSourceError("No picture at that time.");
    return createImageBitmap(wrapped.canvas);
  });
}

/** Closes every file kept open for the scrubber (the editor calls it when it closes). */
export function releaseProbes() {
  for (const p of open.values()) void p.then((o) => o.input.dispose(), () => {});
  open.clear();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}
