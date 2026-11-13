// Timeline math for the REEL RECIPE (lib/reel/recipe.ts): where each clip
// sits on the reel, which clips show at a time t and how far through a
// transition they are, Ken Burns moves, fitting rectangles, transition
// looks, audio gains (fades, ducking) and caption timing. Pure functions:
// the preview player and the final render both draw from these, so the
// preview is the output. Contract: docs/reel-editor.md.

import {
  FPS,
  LIMITS,
  isVideoKind,
  type CaptionLine,
  type CaptionWord,
  type Fit,
  type Motion,
  type ReelClip,
  type ReelRecipe,
  type TransitionType,
  type VoiceTrack,
} from "./recipe";

// ─────────────────────────────────────────────────────────────────────────────
// Clips on the timeline
// ─────────────────────────────────────────────────────────────────────────────

/** Seconds a clip lasts on the reel (videos: trimmed length / speed; stills: their duration). */
export function clipLength(clip: Pick<ReelClip, "source" | "inSec" | "outSec" | "durationSec" | "speed">): number {
  if (isVideoKind(clip.source.kind)) return Math.max(0, (clip.outSec - clip.inSec) / (clip.speed > 0 ? clip.speed : 1));
  return Math.max(0, clip.durationSec);
}

/**
 * How long a transition really overlaps two clips: 0 for a cut, else the
 * asked length but at most half of the shorter clip (so a clip never
 * overlaps both neighbours at once) and at most LIMITS.transitionMaxSec.
 */
export function effectiveTransition(type: TransitionType, durationSec: number, prevSec: number, nextSec: number): number {
  if (type === "cut" || !(durationSec > 0)) return 0;
  return Math.max(0, Math.min(durationSec, LIMITS.transitionMaxSec, prevSec / 2, nextSec / 2));
}

export type TimelineItem = {
  index: number;
  id: string;
  clip: ReelClip;
  /** Reel seconds where the clip starts (its transition in starts here too). */
  start: number;
  /** Reel seconds where the clip ends (its transition out ends here). */
  end: number;
  length: number;
  /** Seconds this clip overlaps the one before (0 for the first clip and cuts). */
  transIn: number;
  /** Seconds this clip overlaps the one after. */
  transOut: number;
};

export type Timeline = { items: TimelineItem[]; durationSec: number };

/** Every clip's place on the reel. The reel lasts until the last clip ends. */
export function buildTimeline(recipe: Pick<ReelRecipe, "clips">): Timeline {
  const items: TimelineItem[] = [];
  let cursor = 0;
  recipe.clips.forEach((clip, index) => {
    const length = clipLength(clip);
    const prev = items[index - 1];
    const transIn = prev ? effectiveTransition(clip.transitionIn.type, clip.transitionIn.durationSec, prev.length, length) : 0;
    if (prev) prev.transOut = transIn;
    const start = Math.max(0, cursor - transIn);
    const end = start + length;
    items.push({ index, id: clip.id, clip, start, end, length, transIn, transOut: 0 });
    cursor = end;
  });
  return { items, durationSec: cursor };
}

/** Frames in a reel of this length (at least 1). */
export function frameCount(durationSec: number, fps: number = FPS) {
  return Math.max(1, Math.round(durationSec * fps));
}

/** Reel time of frame i. */
export function frameTime(i: number, fps: number = FPS) {
  return i / fps;
}

/** Seconds into the source file at `localSec` seconds into the clip (videos), kept inside the trim. */
export function sourceTimeAt(clip: Pick<ReelClip, "inSec" | "outSec" | "speed">, localSec: number) {
  const t = clip.inSec + Math.max(0, localSec) * (clip.speed > 0 ? clip.speed : 1);
  return Math.min(Math.max(t, clip.inSec), Math.max(clip.inSec, clip.outSec - 1 / 1000));
}

export type Layer = {
  item: TimelineItem;
  /** Seconds since the clip started. */
  localSec: number;
  /** 0..1 through the clip (motion progress). */
  progress: number;
  /** Seconds into the source file (videos; stills 0). */
  sourceSec: number;
};

export type Frame = {
  /** The clip on screen, or the outgoing one during a transition. */
  a: Layer | null;
  /** The incoming clip during a transition, else null. */
  b: Layer | null;
  /** The transition between a and b: its type and 0..1 progress. */
  transition: { type: TransitionType; progress: number } | null;
};

function layer(item: TimelineItem, t: number): Layer {
  const localSec = Math.min(Math.max(0, t - item.start), item.length);
  return {
    item,
    localSec,
    progress: item.length > 0 ? localSec / item.length : 0,
    sourceSec: isVideoKind(item.clip.source.kind) ? sourceTimeAt(item.clip, localSec) : 0,
  };
}

/** What shows at reel time t (clamped to the reel). */
export function frameAt(timeline: Timeline, t: number): Frame {
  const { items, durationSec } = timeline;
  if (!items.length) return { a: null, b: null, transition: null };
  const time = Math.min(Math.max(0, t), Math.max(0, durationSec - 1e-6));
  // The last clip that has started; at most two overlap.
  let k = 0;
  for (let i = 0; i < items.length; i++) if (items[i].start <= time + 1e-9) k = i;
  const cur = items[k];
  const prev = items[k - 1];
  if (prev && cur.transIn > 0 && time < cur.start + cur.transIn) {
    return {
      a: layer(prev, time),
      b: layer(cur, time),
      transition: { type: cur.clip.transitionIn.type, progress: (time - cur.start) / cur.transIn },
    };
  }
  return { a: layer(cur, time), b: null, transition: null };
}

/** The clip index at reel time t (the incoming one during a transition): for the editor's playhead. */
export function clipIndexAt(timeline: Timeline, t: number) {
  const f = frameAt(timeline, t);
  return (f.b ?? f.a)?.item.index ?? -1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pictures: fitting and motion
// ─────────────────────────────────────────────────────────────────────────────

export type Rect = { x: number; y: number; w: number; h: number };

/** The picture scaled to cover the frame, centred (parts are cropped). */
export function coverRect(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  const s = Math.max(dstW / srcW, dstH / srcH);
  const w = srcW * s;
  const h = srcH * s;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}

/** The whole picture inside the frame, centred. */
export function containRect(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  const s = Math.min(dstW / srcW, dstH / srcH);
  const w = srcW * s;
  const h = srcH * s;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}

/** Where the main picture goes for a fit (blur also draws coverRect, blurred, behind it). */
export function fitRect(fit: Fit, srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  return fit === "fill" ? coverRect(srcW, srcH, dstW, dstH) : containRect(srcW, srcH, dstW, dstH);
}

/** Ken Burns zoom: pictures grow to this much bigger than their fit. */
export const MOTION_ZOOM = 1.12;

/**
 * The move at progress p (0..1): scale around the frame's centre, then shift
 * by dx/dy fractions of the frame's width/height. Pans keep the picture
 * zoomed just enough that no edge shows. Linear, like a camera move.
 */
export function motionAt(motion: Motion, p: number): { scale: number; dx: number; dy: number } {
  const q = Math.min(Math.max(p, 0), 1);
  const z = MOTION_ZOOM;
  const room = (z - 1) / 2; // how far a picture zoomed by z can move before an edge shows
  switch (motion) {
    case "zoomIn":
      return { scale: 1 + (z - 1) * q, dx: 0, dy: 0 };
    case "zoomOut":
      return { scale: z - (z - 1) * q, dx: 0, dy: 0 };
    case "panLeft":
      return { scale: z, dx: room - 2 * room * q, dy: 0 };
    case "panRight":
      return { scale: z, dx: -room + 2 * room * q, dy: 0 };
    case "panUp":
      return { scale: z, dx: 0, dy: room - 2 * room * q };
    case "panDown":
      return { scale: z, dx: 0, dy: -room + 2 * room * q };
    default:
      return { scale: 1, dx: 0, dy: 0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Transitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How to draw one clip in a transition: opacity, offset (fractions of the
 * frame: dx 1 = one frame width to the right), scale around the centre and
 * blur (fraction of the frame width).
 */
export type LayerLook = { alpha: number; dx: number; dy: number; scale: number; blur: number };
/** Draw a, then b, then the overlay colour on top. */
export type TransitionLook = { a: LayerLook; b: LayerLook; overlay: { color: "black" | "white"; alpha: number } | null };

const still: LayerLook = { alpha: 1, dx: 0, dy: 0, scale: 1, blur: 0 };
const hidden: LayerLook = { ...still, alpha: 0 };

export const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const smooth = (p: number) => p * p * (3 - 2 * p);

/** The look of both clips at progress p (0..1) of a transition. */
export function transitionLook(type: TransitionType, p: number): TransitionLook {
  const q = Math.min(Math.max(p, 0), 1);
  const e = easeInOut(q);
  switch (type) {
    case "cut":
      return { a: hidden, b: still, overlay: null };
    case "crossfade":
      return { a: still, b: { ...still, alpha: q }, overlay: null };
    case "dipBlack":
    case "dipWhite": {
      const color = type === "dipBlack" ? "black" : "white";
      return q < 0.5
        ? { a: still, b: hidden, overlay: { color, alpha: q * 2 } }
        : { a: hidden, b: still, overlay: { color, alpha: (1 - q) * 2 } };
    }
    case "morph":
      return {
        a: { alpha: 1 - smooth(q), dx: 0, dy: 0, scale: 1 + 0.25 * e, blur: 0.03 * q },
        b: { alpha: smooth(q), dx: 0, dy: 0, scale: 1.25 - 0.25 * e, blur: 0.03 * (1 - q) },
        overlay: null,
      };
    case "slideLeft":
      return { a: still, b: { ...still, dx: 1 - e }, overlay: null };
    case "slideRight":
      return { a: still, b: { ...still, dx: -(1 - e) }, overlay: null };
    case "slideUp":
      return { a: still, b: { ...still, dy: 1 - e }, overlay: null };
    case "pushLeft":
      return { a: { ...still, dx: -e }, b: { ...still, dx: 1 - e }, overlay: null };
    case "pushRight":
      return { a: { ...still, dx: e }, b: { ...still, dx: -(1 - e) }, overlay: null };
    case "pushUp":
      return { a: { ...still, dy: -e }, b: { ...still, dy: 1 - e }, overlay: null };
  }
}

/** Opacity of the black over the whole reel from the video fades (0 = none). */
export function videoFadeAt(t: number, durationSec: number, fadeInSec: number, fadeOutSec: number) {
  let black = 0;
  if (fadeInSec > 0 && t < fadeInSec) black = Math.max(black, 1 - t / fadeInSec);
  if (fadeOutSec > 0 && t > durationSec - fadeOutSec) black = Math.max(black, 1 - (durationSec - t) / fadeOutSec);
  return Math.min(1, Math.max(0, black));
}

// ─────────────────────────────────────────────────────────────────────────────
// Audio
// ─────────────────────────────────────────────────────────────────────────────

/** Gain 0..1 of the whole mix at t from the audio fades. */
export function audioFadeAt(t: number, durationSec: number, fadeInSec: number, fadeOutSec: number) {
  let g = 1;
  if (fadeInSec > 0 && t < fadeInSec) g = Math.min(g, Math.max(0, t / fadeInSec));
  if (fadeOutSec > 0 && t > durationSec - fadeOutSec) g = Math.min(g, Math.max(0, (durationSec - t) / fadeOutSec));
  return g;
}

/** Pauses longer than this between words let the music come back up. */
export const DUCK_GAP_SEC = 0.8;
/** How long the music takes to go down / come back up. */
export const DUCK_RAMP_SEC = 0.25;

/**
 * When the voice speaks, in reel seconds: from the captions' timed words when
 * there are any (pauses longer than DUCK_GAP_SEC open up), else the whole
 * narration.
 */
export function speechWindows(voice: Pick<VoiceTrack, "startSec" | "durationSec" | "captions"> | null): [number, number][] {
  if (!voice) return [];
  const words = voice.captions.lines.flatMap((l) => l.words ?? [{ text: l.text, startSec: l.startSec, endSec: l.endSec }]);
  if (!words.length) return voice.durationSec ? [[voice.startSec, voice.startSec + voice.durationSec]] : [];
  const sorted = [...words].sort((x, y) => x.startSec - y.startSec);
  const out: [number, number][] = [];
  for (const w of sorted) {
    const s = voice.startSec + w.startSec;
    const e = voice.startSec + w.endSec;
    const last = out[out.length - 1];
    if (last && s - last[1] <= DUCK_GAP_SEC) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/** The music's gain multiplier at t: 1 - amount while the voice speaks, ramping over DUCK_RAMP_SEC. */
export function duckAt(t: number, windows: [number, number][], amount: number, rampSec = DUCK_RAMP_SEC) {
  let depth = 0; // 0 = full music, 1 = fully ducked
  for (const [s, e] of windows) {
    let d = 0;
    if (t >= s && t <= e) d = 1;
    else if (t < s && t > s - rampSec) d = 1 - (s - t) / rampSec;
    else if (t > e && t < e + rampSec) d = 1 - (t - e) / rampSec;
    depth = Math.max(depth, d);
  }
  return 1 - Math.min(1, Math.max(0, amount)) * depth;
}

// ─────────────────────────────────────────────────────────────────────────────
// Captions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Words → caption lines: a new line after maxChars, after maxSec, at a pause
 * of gapSec, or after a word ending a sentence. Times stay those of the words.
 */
export function wordsToLines(
  words: CaptionWord[],
  { maxChars = 28, maxSec = 2.6, gapSec = 0.6 }: { maxChars?: number; maxSec?: number; gapSec?: number } = {},
): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let cur: CaptionWord[] = [];
  const flush = () => {
    if (!cur.length) return;
    lines.push({
      text: cur.map((w) => w.text).join(" "),
      startSec: cur[0].startSec,
      endSec: cur[cur.length - 1].endSec,
      words: cur,
    });
    cur = [];
  };
  for (const w of words) {
    if (cur.length) {
      const text = cur.map((x) => x.text).join(" ");
      const last = cur[cur.length - 1];
      if (
        text.length + 1 + w.text.length > maxChars ||
        w.endSec - cur[0].startSec > maxSec ||
        w.startSec - last.endSec > gapSec ||
        /[.!?…]$/.test(last.text)
      ) {
        flush();
      }
    }
    cur.push(w);
  }
  flush();
  return lines;
}

/**
 * Evenly timed words for a narration without spoken timings (older ones):
 * each word gets time in proportion to its length. Close enough for captions.
 */
export function estimateWords(script: string, durationSec: number): CaptionWord[] {
  const parts = script.split(/\s+/).filter(Boolean);
  if (!parts.length || !(durationSec > 0)) return [];
  const weight = parts.map((p) => p.length + 1);
  const total = weight.reduce((a, b) => a + b, 0);
  const out: CaptionWord[] = [];
  let t = 0;
  parts.forEach((text, i) => {
    const d = (weight[i] / total) * durationSec;
    out.push({ text, startSec: round3(t), endSec: round3(t + d) });
    t += d;
  });
  return out;
}

/** The caption at narration time t (seconds from the narration's start) and the word being said (-1: none). */
export function captionAt(lines: CaptionLine[], t: number): { index: number; line: CaptionLine; word: number } | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (t >= line.startSec && t < line.endSec) {
      const word = line.words ? line.words.findIndex((w) => t >= w.startSec && t < w.endSec) : -1;
      // Between two words: keep the last one said highlighted.
      const said = word >= 0 || !line.words ? word : line.words.findLastIndex((w) => w.startSec <= t);
      return { index: i, line, word: said };
    }
  }
  return null;
}

/**
 * A caption line after its text was edited: same number of words keeps the
 * spoken timings (new texts), any other change drops them (the line shows
 * whole for its time).
 */
export function editCaptionText(line: CaptionLine, text: string): CaptionLine {
  const clean = text.replace(/\s+/g, " ").trim().slice(0, LIMITS.captionLineChars);
  const parts = clean.split(" ").filter(Boolean);
  if (line.words && parts.length === line.words.length) {
    return { ...line, text: clean, words: line.words.map((w, i) => ({ ...w, text: parts[i] })) };
  }
  const next: CaptionLine = { text: clean, startSec: line.startSec, endSec: line.endSec };
  return next;
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
