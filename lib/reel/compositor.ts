// The reel compositor: ONE drawing function for the editor's live preview
// and the final render, so what Giorgi sees is what the MP4 gets. Canvas 2D
// (CanvasRenderingContext2D or OffscreenCanvasRenderingContext2D), drawn in
// reel pixels (ASPECTS) under a scale for smaller preview canvases.
//
//   black → clip a / clip b (fit, blurred background, Ken Burns, transition
//   look incl. zoom-blur morph and slides/pushes, the clip's text) → captions
//   (style, position, the word being said) → transition overlay → video fade.
//
// The geometry and text layout are pure functions (exported, unit-tested in
// tests/reelEngine.test.ts); the drawing helpers below them only paint.
// Contract: docs/reel-editor.md section 3.

import {
  aspectSize,
  type CaptionPosition,
  type CaptionStyle,
  type ClipText,
  type ReelAspect,
  type ReelRecipe,
  type TextPosition,
  type TextSize,
  type TextStyle,
} from "./recipe";
import {
  buildTimeline,
  captionAt,
  coverRect,
  fitRect,
  frameAt,
  motionAt,
  transitionLook,
  videoFadeAt,
  type Layer,
  type LayerLook,
  type Rect,
  type Timeline,
} from "./timeline";
import { reelFont } from "./fonts";
import type { FrameProvider } from "./frames";

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

// ─────────────────────────────────────────────────────────────────────────────
// Pure layout: safe zones, text specs, wrapping, placement
// ─────────────────────────────────────────────────────────────────────────────

/** Where Instagram's chrome covers a reel, as fractions of the height (contract: Safe zones). */
export function safeInsets(aspect: ReelAspect): { top: number; bottom: number } {
  return aspect === "9:16" ? { top: 0.12, bottom: 0.22 } : { top: 0.06, bottom: 0.06 };
}

/** Texts and captions wrap within this much of the frame's width. */
export const TEXT_WIDTH = 0.84;
/** The blurred background of the "blur" fit, as a fraction of the width. */
export const BG_BLUR = 0.04;
/** Gap between a clip text and the captions when they share a position, as a fraction of the height. */
export const BLOCK_GAP = 0.015;

export type BoxKind = "glass" | "dark" | "light";

/** How a block of text (a clip text or a caption) is set, in reel pixels. */
export type BlockSpec = {
  size: number;
  weight: number;
  /** Line height in px. */
  lineHeight: number;
  padX: number;
  padY: number;
  box: BoxKind | null;
  ink: string;
  /** Words not being said (the highlight caption style). */
  dim: string | null;
  shadow: boolean;
  maxLines: number;
};

const INK = "#ffffff";
const INK_ON_LIGHT = "#0b0b0c";

const TEXT_BASE: Record<TextSize, number> = { s: 42, m: 56, l: 74 };
const HEADLINE_BASE: Record<TextSize, number> = { s: 76, m: 100, l: 132 };

/** The unit every size scales by: 1 for every aspect we have (their short side is 1080). */
export function unitFor(width: number, height: number) {
  return Math.min(width, height) / 1080;
}

/** A clip text's look (styles in the Studio look: glass pill, black / white box, shadowed, headline). */
export function textSpec(style: TextStyle, size: TextSize, unit = 1): BlockSpec {
  if (style === "headline") {
    const s = HEADLINE_BASE[size] * unit;
    return { size: s, weight: 700, lineHeight: s * 1.06, padX: 0, padY: 0, box: null, ink: INK, dim: null, shadow: true, maxLines: 3 };
  }
  const s = TEXT_BASE[size] * unit;
  const boxed = { size: s, weight: 600, lineHeight: s * 1.22, padX: s * 0.62, padY: s * 0.36, dim: null, shadow: false, maxLines: 3 };
  switch (style) {
    case "glass":
      return { ...boxed, box: "glass", ink: INK };
    case "solid":
      return { ...boxed, box: "dark", ink: INK };
    case "light":
      return { ...boxed, box: "light", ink: INK_ON_LIGHT };
    case "shadow":
    default:
      return { size: s, weight: 700, lineHeight: s * 1.16, padX: 0, padY: 0, box: null, ink: INK, dim: null, shadow: true, maxLines: 3 };
  }
}

/** A caption style's look. */
export function captionSpec(style: CaptionStyle, unit = 1): BlockSpec {
  switch (style) {
    case "glass": {
      const s = 52 * unit;
      return { size: s, weight: 600, lineHeight: s * 1.2, padX: s * 0.62, padY: s * 0.34, box: "glass", ink: INK, dim: null, shadow: false, maxLines: 2 };
    }
    case "highlight": {
      const s = 66 * unit;
      return { size: s, weight: 700, lineHeight: s * 1.14, padX: 0, padY: 0, box: null, ink: INK, dim: "rgba(255,255,255,0.48)", shadow: true, maxLines: 2 };
    }
    case "box": {
      const s = 54 * unit;
      return { size: s, weight: 600, lineHeight: s * 1.2, padX: s * 0.56, padY: s * 0.3, box: "dark", ink: INK, dim: null, shadow: false, maxLines: 2 };
    }
    case "light": {
      const s = 54 * unit;
      return { size: s, weight: 600, lineHeight: s * 1.2, padX: s * 0.56, padY: s * 0.3, box: "light", ink: INK_ON_LIGHT, dim: null, shadow: false, maxLines: 2 };
    }
    case "bold":
    default: {
      const s = 70 * unit;
      return { size: s, weight: 700, lineHeight: s * 1.12, padX: 0, padY: 0, box: null, ink: INK, dim: null, shadow: true, maxLines: 2 };
    }
  }
}

/** Measures `text` set at `sizePx` (the spec's weight). */
export type Measure = (text: string, sizePx: number) => number;

/** A word (or a piece of a word too long for a line) on a line; `index` is the word's place in the text. */
export type Piece = { text: string; index: number; width: number };
export type TextLine = { pieces: Piece[]; width: number };
export type BlockLayout = {
  size: number;
  lineHeight: number;
  space: number;
  lines: TextLine[];
  /** The block's box, padding included. */
  width: number;
  height: number;
  truncated: boolean;
};

const ELLIPSIS = "…";

function lineWidth(pieces: Piece[], space: number) {
  return pieces.reduce((sum, p, i) => sum + p.width + (i ? space : 0), 0);
}

/** Splits a word wider than the line into pieces that fit (characters, greedy). */
function breakWord(word: string, index: number, measure: (s: string) => number, maxWidth: number): Piece[] {
  const out: Piece[] = [];
  let cur = "";
  for (const ch of Array.from(word)) {
    if (cur && measure(cur + ch) > maxWidth) {
      out.push({ text: cur, index, width: measure(cur) });
      cur = ch;
    } else cur += ch;
  }
  if (cur) out.push({ text: cur, index, width: measure(cur) });
  return out;
}

/** Greedy word wrap. Words are the text split on spaces; a word longer than a line is broken. */
export function wrapWords(words: string[], measure: (s: string) => number, maxWidth: number): TextLine[] {
  const space = measure(" ");
  const lines: TextLine[] = [];
  let cur: Piece[] = [];
  const flush = () => {
    if (cur.length) lines.push({ pieces: cur, width: lineWidth(cur, space) });
    cur = [];
  };
  words.forEach((word, index) => {
    const w = measure(word);
    const pieces = w > maxWidth ? breakWord(word, index, measure, maxWidth) : [{ text: word, index, width: w }];
    for (const p of pieces) {
      if (cur.length && lineWidth([...cur, p], space) > maxWidth) flush();
      cur.push(p);
      if (pieces.length > 1 && p !== pieces[pieces.length - 1]) flush();
    }
  });
  flush();
  return lines;
}

/** The scales tried, largest first, before a text is cut short. */
const SHRINK = [1, 0.92, 0.85, 0.78, 0.72, 0.66, 0.6];

/**
 * Sets a text in at most `spec.maxLines` lines within `maxWidth` (the box's
 * padding is outside it): the spec's size when it fits, else smaller (down to
 * 60%), else cut with an ellipsis.
 */
export function layoutBlock(text: string, spec: BlockSpec, maxWidth: number, measure: Measure): BlockLayout {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  let size = spec.size;
  let lines: TextLine[] = [];
  let truncated = false;
  for (const k of SHRINK) {
    size = spec.size * k;
    const at = (s: string) => measure(s, size);
    lines = wrapWords(words, at, maxWidth);
    if (lines.length <= spec.maxLines) break;
  }
  const at = (s: string) => measure(s, size);
  const space = at(" ");
  if (lines.length > spec.maxLines) {
    truncated = true;
    lines = lines.slice(0, spec.maxLines);
    const last = lines[lines.length - 1];
    const pieces = [...last.pieces];
    const withDots = (ps: Piece[]) => {
      const copy = ps.map((p) => ({ ...p }));
      const end = copy[copy.length - 1];
      end.text += ELLIPSIS;
      end.width = at(end.text);
      return copy;
    };
    let next = withDots(pieces);
    while (pieces.length > 1 && lineWidth(next, space) > maxWidth) {
      pieces.pop();
      next = withDots(pieces);
    }
    lines[lines.length - 1] = { pieces: next, width: lineWidth(next, space) };
  }
  const ratio = size / spec.size;
  const lineHeight = spec.lineHeight * ratio;
  const padX = spec.padX * ratio;
  const padY = spec.padY * ratio;
  const textW = lines.reduce((m, l) => Math.max(m, l.width), 0);
  return {
    size,
    lineHeight,
    space,
    lines,
    width: textW + padX * 2,
    height: lines.length * lineHeight + padY * 2,
    truncated,
  };
}

/** Height kept for the captions (two lines of their style) so a clip text at the same position sits clear of them. */
export function captionReserve(style: CaptionStyle, unit = 1) {
  const s = captionSpec(style, unit);
  return s.lineHeight * s.maxLines + s.padY * 2;
}

/**
 * Top of a block of height `blockH` at a position, inside the safe zones.
 * `avoid`: a block already at a position (the captions) to keep clear of.
 */
export function blockTop(
  position: TextPosition | CaptionPosition,
  blockH: number,
  H: number,
  insets: { top: number; bottom: number },
  avoid?: { position: TextPosition | CaptionPosition; height: number } | null,
) {
  const gap = BLOCK_GAP * H;
  const clash = avoid && avoid.position === position ? avoid.height + gap : 0;
  let y: number;
  if (position === "top") y = insets.top * H + clash;
  else if (position === "bottom") y = H - insets.bottom * H - blockH - clash;
  else y = clash ? H / 2 - avoid!.height / 2 - gap - blockH : (H - blockH) / 2;
  return Math.min(Math.max(0, y), Math.max(0, H - blockH));
}

/** Corner radius of a block's box: a pill for one line, a rounded card for more. */
export function boxRadius(layout: Pick<BlockLayout, "height" | "size" | "lines">) {
  return layout.lines.length <= 1 ? layout.height / 2 : Math.min(layout.height / 2, layout.size * 0.62);
}

/** Where a layer is drawn for a look: offsets in frame sizes, scale around the centre. Pure, for tests. */
export function lookMatrix(look: Pick<LayerLook, "dx" | "dy" | "scale">, W: number, H: number) {
  // translate(dx·W, dy·H) · translate(W/2, H/2) · scale(s) · translate(-W/2, -H/2)
  const s = look.scale;
  return { a: s, d: s, e: look.dx * W + (W / 2) * (1 - s), f: look.dy * H + (H / 2) * (1 - s) };
}

const IDENTITY: LayerLook = { alpha: 1, dx: 0, dy: 0, scale: 1, blur: 0 };

function isIdentity(look: LayerLook) {
  return look.alpha >= 0.999 && look.blur <= 0 && look.dx === 0 && look.dy === 0 && look.scale === 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scratch canvases (one set per output canvas) and blur
// ─────────────────────────────────────────────────────────────────────────────

type Surface = { canvas: AnyCanvas; ctx: Ctx2D; w: number; h: number };
type Pool = { layer?: Surface; zoom?: Surface; small?: Surface; measure?: Surface };

const pools = new WeakMap<object, Pool>();

function createCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function surface(pool: Pool, name: keyof Pool, w: number, h: number, grow = false): Surface {
  let s = pool[name];
  const fits = s && (grow ? s.w >= w && s.h >= h : s.w === w && s.h === h);
  if (!s || !fits) {
    const nw = grow && s ? Math.max(s.w, w) : w;
    const nh = grow && s ? Math.max(s.h, h) : h;
    if (s) {
      s.canvas.width = nw;
      s.canvas.height = nh;
      s.w = nw;
      s.h = nh;
    } else {
      const canvas = createCanvas(nw, nh);
      const ctx = canvas.getContext("2d") as Ctx2D | null;
      if (!ctx) throw new Error("This browser can't draw the reel (no 2D canvas).");
      s = { canvas, ctx, w: nw, h: nh };
      pool[name] = s;
    }
  }
  return s;
}

/** Frees the scratch canvases kept for an output canvas (the render calls it when done). */
export function releaseCompositor(canvas: object) {
  const pool = pools.get(canvas);
  if (!pool) return;
  for (const s of Object.values(pool) as (Surface | undefined)[]) {
    if (s) {
      s.canvas.width = 1;
      s.canvas.height = 1;
    }
  }
  pools.delete(canvas);
}

let filterSupport: boolean | null = null;

/** True when the canvas can blur with ctx.filter (Chrome, Edge, Firefox; Safari only lately). */
function canFilter(ctx: Ctx2D) {
  if (filterSupport !== null) return filterSupport;
  try {
    const c = ctx as Ctx2D & { filter?: unknown };
    if (typeof c.filter !== "string") return (filterSupport = false);
    const before = c.filter;
    c.filter = "blur(1px)";
    filterSupport = c.filter === "blur(1px)";
    c.filter = before;
  } catch {
    filterSupport = false;
  }
  return filterSupport;
}

type Env = {
  W: number;
  H: number;
  scale: number;
  devW: number;
  devH: number;
  unit: number;
  pool: Pool;
  filter: boolean;
  recipe: ReelRecipe;
  /** Height kept for captions, and where (null: no captions). */
  captions: { position: CaptionPosition; height: number } | null;
};

function resetCtx(c: Ctx2D) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = "source-over";
  c.shadowColor = "transparent";
  c.shadowBlur = 0;
  c.shadowOffsetX = 0;
  c.shadowOffsetY = 0;
  if (filterSupport) (c as Ctx2D & { filter: string }).filter = "none";
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = "high";
}

/**
 * Draws (part of) `src` blurred into `dst` (in `c`'s current coordinates):
 * shrunk onto a small canvas (blurred there with ctx.filter when the browser
 * has it), then scaled back up. Cheap at any radius and smooth.
 */
function blurDraw(
  c: Ctx2D,
  env: Env,
  src: CanvasImageSource,
  from: { x: number; y: number; w: number; h: number },
  dst: Rect,
  radiusReel: number,
) {
  const rDev = radiusReel * env.scale;
  if (rDev < 0.6) {
    c.drawImage(src, from.x, from.y, from.w, from.h, dst.x, dst.y, dst.w, dst.h);
    return;
  }
  const d = Math.min(32, Math.max(1, rDev / (env.filter ? 3 : 1.25)));
  const sw = Math.max(4, Math.ceil((dst.w * env.scale) / d));
  const sh = Math.max(4, Math.ceil((dst.h * env.scale) / d));
  const s = surface(env.pool, "small", sw, sh, true);
  const sc = s.ctx;
  resetCtx(sc);
  sc.fillStyle = "#000";
  sc.fillRect(0, 0, sw, sh);
  if (env.filter) {
    const rs = rDev / d;
    const p = rs * 2;
    (sc as Ctx2D & { filter: string }).filter = `blur(${rs.toFixed(2)}px)`;
    sc.drawImage(src, from.x, from.y, from.w, from.h, -p, -p, sw + p * 2, sh + p * 2);
    (sc as Ctx2D & { filter: string }).filter = "none";
  } else {
    sc.drawImage(src, from.x, from.y, from.w, from.h, 0, 0, sw, sh);
  }
  c.drawImage(s.canvas, 0, 0, sw, sh, dst.x, dst.y, dst.w, dst.h);
}

function roundRectPath(c: Ctx2D, r: Rect, radius: number) {
  const rad = Math.max(0, Math.min(radius, r.w / 2, r.h / 2));
  c.beginPath();
  c.moveTo(r.x + rad, r.y);
  c.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + r.h, rad);
  c.arcTo(r.x + r.w, r.y + r.h, r.x, r.y + r.h, rad);
  c.arcTo(r.x, r.y + r.h, r.x, r.y, rad);
  c.arcTo(r.x, r.y, r.x + r.w, r.y, rad);
  c.closePath();
}

// ─────────────────────────────────────────────────────────────────────────────
// Text blocks
// ─────────────────────────────────────────────────────────────────────────────

function measurer(c: Ctx2D, weight: number): Measure {
  let font = "";
  return (text, size) => {
    const f = reelFont(weight, size);
    if (f !== font) {
      c.font = f;
      font = f;
    }
    return c.measureText(text).width;
  };
}

/** The box behind a block: frosted glass (blurred backdrop + tint + sheen + hairline), black or white. */
function drawBox(c: Ctx2D, env: Env, kind: BoxKind, box: Rect, radius: number) {
  if (kind === "glass") {
    // Backdrop: what is under the box, blurred, from the canvas itself (device pixels).
    const s = env.scale;
    const blur = 22 * env.unit;
    const pad = blur * 2;
    const x0 = Math.max(0, (box.x - pad) * s);
    const y0 = Math.max(0, (box.y - pad) * s);
    const x1 = Math.min(env.devW, (box.x + box.w + pad) * s);
    const y1 = Math.min(env.devH, (box.y + box.h + pad) * s);
    c.save();
    roundRectPath(c, box, radius);
    c.clip();
    if (x1 - x0 >= 2 && y1 - y0 >= 2) {
      blurDraw(c, env, c.canvas as CanvasImageSource, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, { x: x0 / s, y: y0 / s, w: (x1 - x0) / s, h: (y1 - y0) / s }, blur);
    }
    c.fillStyle = "rgba(24,24,26,0.40)";
    c.fillRect(box.x, box.y, box.w, box.h);
    const sheen = c.createLinearGradient(0, box.y, 0, box.y + box.h);
    sheen.addColorStop(0, "rgba(255,255,255,0.20)");
    sheen.addColorStop(0.5, "rgba(255,255,255,0.04)");
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = sheen;
    c.fillRect(box.x, box.y, box.w, box.h);
    c.restore();
    c.save();
    roundRectPath(c, box, radius);
    c.lineWidth = 1.5 * env.unit;
    c.strokeStyle = "rgba(255,255,255,0.28)";
    c.stroke();
    c.restore();
    return;
  }
  c.save();
  c.shadowColor = "rgba(0,0,0,0.22)";
  c.shadowBlur = 28 * env.unit * env.scale;
  c.shadowOffsetY = 8 * env.unit * env.scale;
  roundRectPath(c, box, radius);
  c.fillStyle = kind === "dark" ? "rgba(10,10,11,0.88)" : "rgba(255,255,255,0.95)";
  c.fill();
  c.restore();
}

/** Draws a laid-out block with its top at y, centred. `highlight`: the word index being said (-1: none). */
function drawBlock(c: Ctx2D, env: Env, spec: BlockSpec, layout: BlockLayout, y: number, highlight = -1) {
  const x = (env.W - layout.width) / 2;
  if (spec.box) drawBox(c, env, spec.box, { x, y, w: layout.width, h: layout.height }, boxRadius(layout));
  const ratio = layout.size / spec.size;
  const padY = spec.padY * ratio;
  c.save();
  c.font = reelFont(spec.weight, layout.size);
  c.textAlign = "left";
  c.textBaseline = "middle";
  if (spec.shadow) {
    c.shadowColor = "rgba(0,0,0,0.55)";
    c.shadowBlur = layout.size * 0.32 * env.scale;
    c.shadowOffsetY = layout.size * 0.04 * env.scale;
  }
  layout.lines.forEach((line, i) => {
    let lx = (env.W - line.width) / 2;
    // A touch above the geometric middle looks centred for mixed-case text.
    const ly = y + padY + (i + 0.5) * layout.lineHeight + layout.size * 0.02;
    for (const p of line.pieces) {
      c.fillStyle = highlight >= 0 && spec.dim && p.index !== highlight ? spec.dim : spec.ink;
      c.fillText(p.text, lx, ly);
      lx += p.width + layout.space;
    }
  });
  c.restore();
}

function drawClipText(c: Ctx2D, env: Env, text: ClipText) {
  const spec = textSpec(text.style, text.size, env.unit);
  const maxWidth = env.W * TEXT_WIDTH - spec.padX * 2;
  const layout = layoutBlock(text.text, spec, maxWidth, measurer(c, spec.weight));
  if (!layout.lines.length) return;
  const y = blockTop(text.position, layout.height, env.H, safeInsets(env.recipe.reel.aspect), env.captions);
  drawBlock(c, env, spec, layout, y);
}

function drawCaptions(c: Ctx2D, env: Env, t: number) {
  const voice = env.recipe.audio.voice;
  if (!voice || !voice.captions.on || !voice.captions.lines.length) return;
  const at = captionAt(voice.captions.lines, t - voice.startSec);
  if (!at) return;
  const spec = captionSpec(voice.captions.style, env.unit);
  const maxWidth = env.W * TEXT_WIDTH - spec.padX * 2;
  const layout = layoutBlock(at.line.text, spec, maxWidth, measurer(c, spec.weight));
  if (!layout.lines.length) return;
  const words = at.line.text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const timed = !!at.line.words && at.line.words.length === words.length;
  const highlight = spec.dim && timed ? at.word : -1;
  const y = blockTop(voice.captions.position, layout.height, env.H, safeInsets(env.recipe.reel.aspect));
  drawBlock(c, env, spec, layout, y, highlight);
}

// ─────────────────────────────────────────────────────────────────────────────
// Layers
// ─────────────────────────────────────────────────────────────────────────────

/** One clip's picture and text in frame coordinates (c's transform: the scale only). */
function drawContent(c: Ctx2D, env: Env, layer: Layer, frames: FrameProvider) {
  const { W, H } = env;
  const clip = layer.item.clip;
  c.fillStyle = "#000";
  c.fillRect(0, 0, W, H);
  const img = frames.image(layer);
  if (img && img.width > 0 && img.height > 0) {
    const full = { x: 0, y: 0, w: img.width, h: img.height };
    if (clip.fit === "blur") {
      blurDraw(c, env, img.source, full, coverRect(img.width, img.height, W, H), BG_BLUR * W);
      c.fillStyle = "rgba(0,0,0,0.22)";
      c.fillRect(0, 0, W, H);
    }
    const r = fitRect(clip.fit, img.width, img.height, W, H);
    const m = motionAt(clip.motion, layer.progress);
    c.save();
    c.translate(W / 2 + m.dx * W, H / 2 + m.dy * H);
    c.scale(m.scale, m.scale);
    c.translate(-W / 2, -H / 2);
    c.drawImage(img.source, r.x, r.y, r.w, r.h);
    c.restore();
  }
  if (clip.text.on && clip.text.text.trim()) drawClipText(c, env, clip.text);
}

function applyLook(c: Ctx2D, env: Env, look: LayerLook) {
  const m = lookMatrix(look, env.W, env.H);
  c.transform(m.a, 0, 0, m.d, m.e, m.f);
}

function drawLayer(ctx: Ctx2D, env: Env, layer: Layer, look: LayerLook, frames: FrameProvider, morph: boolean) {
  if (look.alpha <= 0.001) return;
  if (isIdentity(look)) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, env.W, env.H);
    ctx.clip();
    drawContent(ctx, env, layer, frames);
    ctx.restore();
    return;
  }
  // Moving, fading or blurring: draw the clip on its own canvas first so it
  // moves, fades and blurs as one picture (its text and background with it).
  const L = surface(env.pool, "layer", env.devW, env.devH);
  resetCtx(L.ctx);
  L.ctx.clearRect(0, 0, env.devW, env.devH);
  L.ctx.setTransform(env.scale, 0, 0, env.scale, 0, 0);
  drawContent(L.ctx, env, layer, frames);
  resetCtx(L.ctx);

  let src: AnyCanvas = L.canvas;
  if (morph && look.blur > 0) {
    // Zoom blur: copies of the clip, each a little bigger, averaged (streaks out from the centre).
    const Z = surface(env.pool, "zoom", env.devW, env.devH);
    resetCtx(Z.ctx);
    Z.ctx.clearRect(0, 0, env.devW, env.devH);
    Z.ctx.drawImage(L.canvas, 0, 0);
    const steps = 4;
    for (let k = 1; k < steps; k++) {
      const s = 1 + k * look.blur * 1.6;
      Z.ctx.globalAlpha = 1 / (k + 1);
      Z.ctx.setTransform(s, 0, 0, s, (env.devW / 2) * (1 - s), (env.devH / 2) * (1 - s));
      Z.ctx.drawImage(L.canvas, 0, 0);
    }
    resetCtx(Z.ctx);
    src = Z.canvas;
  }

  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, look.alpha));
  applyLook(ctx, env, look);
  ctx.beginPath();
  ctx.rect(0, 0, env.W, env.H);
  ctx.clip();
  const from = { x: 0, y: 0, w: env.devW, h: env.devH };
  const to = { x: 0, y: 0, w: env.W, h: env.H };
  if (look.blur > 0) blurDraw(ctx, env, src, from, to, look.blur * env.W);
  else ctx.drawImage(src, 0, 0, env.devW, env.devH, 0, 0, env.W, env.H);
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// drawFrame
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Draws the reel at time t onto ctx (whose canvas is the reel's size × scale).
 * A layer whose picture isn't ready stays black (the render's prepare() has
 * always waited; the preview checks readiness before drawing).
 */
export function drawFrame(
  ctx: Ctx2D,
  recipe: ReelRecipe,
  t: number,
  frames: FrameProvider,
  opts: { timeline?: Timeline; scale?: number } = {},
): void {
  const { width: W, height: H } = aspectSize(recipe.reel.aspect);
  const timeline = opts.timeline ?? buildTimeline(recipe);
  const devW = ctx.canvas.width;
  const devH = ctx.canvas.height;
  const scale = opts.scale ?? devW / W;
  let pool = pools.get(ctx.canvas);
  if (!pool) {
    pool = {};
    pools.set(ctx.canvas, pool);
  }
  const unit = unitFor(W, H);
  const voice = recipe.audio.voice;
  const env: Env = {
    W,
    H,
    scale,
    devW,
    devH,
    unit,
    pool,
    filter: canFilter(ctx),
    recipe,
    captions:
      voice && voice.captions.on && voice.captions.lines.length
        ? { position: voice.captions.position, height: captionReserve(voice.captions.style, unit) }
        : null,
  };

  ctx.save();
  resetCtx(ctx);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, devW, devH);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  const frame = frameAt(timeline, t);
  let overlay: { color: "black" | "white"; alpha: number } | null = null;
  if (frame.a && frame.b && frame.transition) {
    const look = transitionLook(frame.transition.type, frame.transition.progress);
    const morph = frame.transition.type === "morph";
    drawLayer(ctx, env, frame.a, look.a, frames, morph);
    drawLayer(ctx, env, frame.b, look.b, frames, morph);
    overlay = look.overlay;
  } else if (frame.a) {
    drawLayer(ctx, env, frame.a, IDENTITY, frames, false);
  }

  drawCaptions(ctx, env, t);

  if (overlay && overlay.alpha > 0) {
    ctx.globalAlpha = Math.min(1, overlay.alpha);
    ctx.fillStyle = overlay.color === "white" ? "#fff" : "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  const fade = videoFadeAt(t, timeline.durationSec, recipe.fades.videoInSec, recipe.fades.videoOutSec);
  if (fade > 0) {
    ctx.globalAlpha = fade;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
