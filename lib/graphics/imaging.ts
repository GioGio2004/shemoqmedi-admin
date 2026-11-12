import { createHash } from "node:crypto";
import sharp from "sharp";
import { STOREFRONT_URL } from "@/lib/storefront";
import { alpha, type Palette } from "@/lib/palettes";
import type { Gradient, PanelShape } from "./glass";

// Raster work for the social graphics, done with sharp before and after
// satori (which can't blur, crop or read WebP):
//
//   fetchImage     a screenshot from one of our own hosts, cached briefly
//                  (ImageKit files come as a 1600 px JPEG, not the full WebP)
//   picture        a fetched image, decoded once; its small raster is shared
//                  by the backdrop and the auto palette
//   buildBackdrop  the blurred, palette-tinted backdrop behind a graphic (or a
//                  whole carousel panorama) and its "frost": the same picture
//                  blurred further and lightened, which glass panels show.
//                  Cached, so a carousel or a preview being typed into builds
//                  it once.
//   region         one canvas-sized window of a backdrop, as a data: URI
//   glassLayer     a window of the backdrop with the frost laid in under
//                  every glass panel: one raster under the whole graphic
//   cropDetail     a zoomed-in crop of a screenshot (the carousel's details)
//   autoPalette    base / surface / accent picked from a screenshot's colours
//   finish         the satori PNG over its background, film grain, and one
//                  encode to JPEG or PNG

// ─────────────────────────────────────────────────────────────────────────────
// Fetching
// ─────────────────────────────────────────────────────────────────────────────

function hostOf(url: string | undefined) {
  try {
    return url ? new URL(url).hostname : null;
  } catch {
    return null;
  }
}

/** Hosts images may come from: our own stores only, so the route can't be used to fetch anything else. */
export function allowedImageHost(host: string) {
  if (host === "localhost" && process.env.NODE_ENV !== "production") return true;
  const exact = new Set(
    [
      "ik.imagekit.io",
      "shemoqmedi.space",
      "www.shemoqmedi.space",
      hostOf(process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT),
      hostOf(process.env.R2_PUBLIC_URL),
      hostOf(STOREFRONT_URL),
    ].filter(Boolean),
  );
  return exact.has(host) || host.endsWith(".convex.cloud") || host.endsWith(".convex.site");
}

const MAX_BYTES = 12 * 1024 * 1024;
const cache = new Map<string, { at: number; data: Promise<Buffer | null> }>();

async function download(url: URL): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000), redirect: "error" });
    if (!res.ok) {
      console.warn("graphics image", res.status, url.toString());
      return null;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length > MAX_BYTES ? null : bytes;
  } catch (error) {
    console.warn("graphics image failed", url.toString(), error instanceof Error ? error.message : error);
    return null;
  }
}

function isImageKit(url: URL) {
  return url.hostname === "ik.imagekit.io" || url.hostname === hostOf(process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT);
}

/** Widest a screenshot is ever drawn (the carousel's browser window, at 1.2x). */
export const FETCH_WIDTH = 1600;

/**
 * ImageKit screenshots are stored as big WebPs. Asking for a 1600 px JPEG
 * instead is a smaller download, a faster decode, and a format satori draws
 * as it is. Only for screenshots: a badge or logo may be a transparent PNG,
 * which a JPEG would flatten onto a box. Images that already carry a
 * transform are left alone.
 */
export function deliveryUrl(raw: string, screenshot = true) {
  const url = new URL(raw);
  if (screenshot && isImageKit(url) && !url.searchParams.has("tr") && !url.pathname.includes("/tr:")) {
    url.searchParams.set("tr", `w-${FETCH_WIDTH},f-jpg`);
  }
  return url;
}

/**
 * An image's bytes, or null when it is missing, too big or not on our hosts.
 * Cached for ten minutes. `screenshot`: an opaque picture, fetched from
 * ImageKit as a 1600 px JPEG (deliveryUrl); anything else (a badge) comes as
 * stored.
 */
export function fetchImage(raw: string | null | undefined, { screenshot = false } = {}): Promise<Buffer | null> {
  if (!raw) return Promise.resolve(null);
  let url: URL;
  try {
    url = deliveryUrl(raw, screenshot);
  } catch {
    return Promise.resolve(null);
  }
  if (url.protocol !== "https:" && url.hostname !== "localhost") return Promise.resolve(null);
  if (!allowedImageHost(url.hostname)) return Promise.resolve(null);
  const key = url.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.data;
  // Only successes are kept: a failed fetch is retried by the next render.
  const data = download(url).then((buf) => {
    if (!buf) cache.delete(key);
    return buf;
  });
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 48) cache.delete(cache.keys().next().value!);
  return data;
}

export type Picture = {
  buf: Buffer;
  width: number;
  height: number;
  format: string;
  /** Where the bytes came from (part of the backdrop cache key), when known. */
  source?: string;
  /** The picture decoded once at SMALL_WIDTH, shared by the backdrop and the auto palette. */
  small: () => Promise<Buffer>;
};

/** Width of the shared small raster: more than any backdrop span needs (backdrops work at 1/6 size). */
const SMALL_WIDTH = 480;

/** Size and format of an image, and its lazily decoded small raster (null when sharp can't read it). */
export async function picture(buf: Buffer | null, source?: string): Promise<Picture | null> {
  if (!buf) return null;
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) return null;
    const width = meta.width;
    let small: Promise<Buffer> | null = null;
    // Some formats report the first frame only; that's what we draw anyway.
    return {
      buf,
      width,
      height: meta.height,
      format: meta.format ?? "",
      source,
      small: () => (small ??= sharp(buf).resize({ width: Math.min(SMALL_WIDTH, width) }).removeAlpha().png({ compressionLevel: 0 }).toBuffer()),
    };
  } catch {
    return null;
  }
}

/** A screenshot: fetchImage, then picture, remembering the URL for the backdrop cache. */
export async function fetchPicture(url: string | null | undefined) {
  return picture(await fetchImage(url, { screenshot: true }), url ?? undefined);
}

export function dataUri(buf: Buffer, type: "jpeg" | "png") {
  return `data:image/${type};base64,${buf.toString("base64")}`;
}

/**
 * A picture for satori at about `width` px wide. A JPEG that is already
 * about that size (what ImageKit delivers) goes in as it is: no decode, no
 * re-encode. Anything else is resized to a JPEG.
 */
export async function asDataUri(pic: Picture | null, width: number, maxHeight?: number) {
  if (!pic) return null;
  const h = Math.round((pic.height * width) / pic.width);
  if (pic.format === "jpeg" && pic.width >= width * 0.7 && pic.width <= width * 1.25 && (!maxHeight || h <= maxHeight)) {
    return dataUri(pic.buf, "jpeg");
  }
  let p = sharp(pic.buf).resize({ width: Math.round(width), withoutEnlargement: false });
  if (maxHeight) {
    if (h > maxHeight) p = p.extract({ left: 0, top: 0, width: Math.round(width), height: Math.round(maxHeight) });
  }
  return dataUri(await p.jpeg({ quality: 88, mozjpeg: true }).toBuffer(), "jpeg");
}

/** An already-small image (a badge, an SVG) as a PNG data: URI. */
export async function rasterDataUri(buf: Buffer | null, size: number) {
  if (!buf) return null;
  try {
    return dataUri(await sharp(buf, { density: 300 }).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer(), "png");
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Colour
// ─────────────────────────────────────────────────────────────────────────────

type RGB = [number, number, number];

function hex([r, g, b]: RGB) {
  return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function luminanceHex(h: string) {
  const [r, g, b] = parseHex(h).map((c) => c / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function parseHex(h: string): RGB {
  const s = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as RGB;
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * A palette from the site's own colours: a deep tone of its main hue for the
 * base, a quieter mid tone for the surface, and its most vivid colour as the
 * accent. Mostly-grey sites get a near-black base and a neutral surface.
 */
export async function autoPalette(pic: Picture | null, fallback: Palette): Promise<Palette> {
  if (!pic) return { ...fallback, id: "auto", name: "Auto" };
  const { data } = await sharp(await pic.small()).resize(48, 30, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bins = new Array(12).fill(0).map(() => ({ weight: 0, r: 0, g: 0, b: 0, vivid: 0, vividRgb: [0, 0, 0] as RGB }));
  let colourful = 0;
  for (let i = 0; i < data.length; i += 3) {
    const rgb: RGB = [data[i], data[i + 1], data[i + 2]];
    const [h, s, l] = rgbToHsl(rgb);
    const w = s * (1 - Math.abs(l - 0.5) * 1.6);
    if (w <= 0.08) continue;
    colourful++;
    const bin = bins[Math.floor(h / 30) % 12];
    bin.weight += w;
    bin.r += rgb[0] * w;
    bin.g += rgb[1] * w;
    bin.b += rgb[2] * w;
    if (w > bin.vivid) {
      bin.vivid = w;
      bin.vividRgb = rgb;
    }
  }
  const total = data.length / 3;
  const ranked = [...bins].sort((a, b) => b.weight - a.weight);
  const main = ranked[0];
  if (colourful / total < 0.06 || main.weight === 0) {
    return { id: "auto", name: "Auto", base: "#101012", surface: "#2A2A2E", accent: fallback.accent };
  }
  const [h] = rgbToHsl([main.r / main.weight, main.g / main.weight, main.b / main.weight]);
  // Accent: the most vivid colour from the strongest bin that isn't the base's hue, else the main one.
  const second = ranked.find((b) => b !== main && b.weight > main.weight * 0.25) ?? main;
  const [ah, as] = rgbToHsl(second.vividRgb);
  return {
    id: "auto",
    name: "Auto",
    base: hex(hslToRgb(h, 0.42, 0.15)),
    surface: hex(hslToRgb(h, 0.3, 0.34)),
    accent: hex(hslToRgb(ah, Math.max(0.62, as), 0.56)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Backdrops
// ─────────────────────────────────────────────────────────────────────────────

/** Work at 1/SCALE of the final size: everything here is heavily blurred anyway. */
const SCALE = 6;

export type Backdrop = {
  width: number;
  height: number;
  /** Behind everything. */
  back: Buffer;
  /** What glass shows: the same picture, blurred further and lighter. */
  frost: Buffer;
  /** Average luminance of the backdrop, 0–1 (decides dark or light text). */
  luminance: number;
};

export type BackdropOptions = {
  width: number;
  height: number;
  palette: Palette;
  /**
   * Pictures laid side by side across the canvas, each over its own span
   * (fractions of the width). Blurring afterwards melts the seams together.
   */
  layers: { pic: Picture; from: number; to: number }[];
  /** How much the base colour veils the pictures (0–1). */
  veil: number;
  /** Blur of the backdrop and of the frost, in final-size pixels. */
  blur: number;
  frostBlur: number;
  /** White mixed into the frost (0–1). */
  frostLight: number;
};

/** Soft colour light: big blurred blobs of the palette, spread along the canvas. */
function blobs(w: number, h: number, p: Palette, count: number) {
  const colours = [p.accent, p.surface, p.accent, p.surface];
  const circles = Array.from({ length: count }, (_, i) => {
    const x = ((i + 0.5) / count) * w + (i % 2 ? 0.12 : -0.1) * (w / count);
    const y = (i % 2 ? 0.78 : 0.22) * h;
    const r = Math.max(w / count, h) * 0.42;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="${colours[i % colours.length]}" fill-opacity="${i % 2 ? 0.5 : 0.42}"/>`;
  }).join("");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${(h * 0.22).toFixed(1)}"/></filter></defs><g filter="url(#b)">${circles}</g></svg>`,
  );
}

function solid(w: number, h: number, colour: string, opacity: number) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${colour}" fill-opacity="${opacity}"/></svg>`,
  );
}

const backdrops = new Map<string, Promise<Backdrop>>();

function backdropKey(o: BackdropOptions) {
  const layers = o.layers.map(({ pic, from, to }) => {
    // A URL names the picture; bytes without one are hashed (cheap next to the blur).
    const id = pic.source ?? createHash("sha1").update(pic.buf).digest("base64");
    return `${id}@${from.toFixed(4)}-${to.toFixed(4)}`;
  });
  const p = o.palette;
  return [o.width, o.height, p.base, p.surface, p.accent, o.veil, o.blur, o.frostBlur, o.frostLight, ...layers].join("|");
}

/**
 * The backdrop for these options, built once and kept (the last 24): a
 * carousel's slides, a preview being typed into, and a final render after a
 * preview all share it.
 */
export function buildBackdrop(o: BackdropOptions): Promise<Backdrop> {
  const key = backdropKey(o);
  const hit = backdrops.get(key);
  if (hit) {
    // Most recently used goes last, so the oldest is evicted first.
    backdrops.delete(key);
    backdrops.set(key, hit);
    return hit;
  }
  const built = drawBackdrop(o);
  backdrops.set(key, built);
  built.catch(() => backdrops.delete(key));
  if (backdrops.size > 24) backdrops.delete(backdrops.keys().next().value!);
  return built;
}

async function drawBackdrop(o: BackdropOptions): Promise<Backdrop> {
  const w = Math.max(8, Math.round(o.width / SCALE));
  const h = Math.max(8, Math.round(o.height / SCALE));
  const [br, bg, bb] = parseHex(o.palette.base);

  // 1. Pictures, each cover-cropped into its span and feathered into its
  //    neighbours, so one picture fades into the next across a seam.
  const feather = Math.round(Math.min(w, Math.max(4, (o.width / SCALE) * 0.06, h * 0.3)));
  const tiles = await Promise.all(
    o.layers.map(async ({ pic, from, to }) => {
      const fadeIn = from > 0 ? feather : 0;
      const fadeOut = to < 1 ? feather : 0;
      const left = Math.round(from * w) - fadeIn;
      const width = Math.max(1, Math.round(to * w) - Math.round(from * w) + fadeIn + fadeOut);
      const mask = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="0">` +
          `<stop offset="0" stop-opacity="${fadeIn ? 0 : 1}"/><stop offset="${(fadeIn * 2) / width}" stop-opacity="1"/>` +
          `<stop offset="${1 - (fadeOut * 2) / width}" stop-opacity="1"/><stop offset="1" stop-opacity="${fadeOut ? 0 : 1}"/>` +
          `</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`,
      );
      const input = await sharp(
        await sharp(await pic.small()).resize(width, h, { fit: "cover", position: "attention" }).modulate({ saturation: 1.25 }).ensureAlpha().png().toBuffer(),
      )
        .composite([{ input: mask, blend: "dest-in" }])
        .png()
        .toBuffer();
      return { input, left: Math.max(0, left), top: 0 };
    }),
  );
  const composed = await sharp({ create: { width: w, height: h, channels: 3, background: { r: br, g: bg, b: bb } } })
    .composite([...tiles, { input: blobs(w, h, o.palette, Math.max(2, Math.round(o.width / 900))), blend: "over" }])
    .png()
    .toBuffer();

  // 2. Blur, then veil with the base colour so the palette sets the mood. Dark
  //    bases multiply (white pages turn into the base colour, photos keep their
  //    shapes); light bases are laid over, which lifts everything towards paper.
  const sigma = (px: number) => Math.max(0.3, px / SCALE);
  const dark = luminanceHex(o.palette.base) < 0.5;
  const veil = (strength: number): sharp.OverlayOptions[] =>
    dark
      ? [
          { input: solid(w, h, o.palette.base, Math.min(1, strength * 1.7)), blend: "multiply" },
          { input: solid(w, h, o.palette.base, strength * 0.35) },
        ]
      : [{ input: solid(w, h, o.palette.base, strength) }];
  const back = await sharp(await sharp(composed).blur(sigma(o.blur)).png().toBuffer())
    .composite(veil(o.veil))
    .png()
    .toBuffer();
  const frost = await sharp(await sharp(composed).blur(sigma(o.frostBlur)).png().toBuffer())
    .composite([...veil(o.veil * 0.9), { input: solid(w, h, "#FFFFFF", o.frostLight) }])
    .png()
    .toBuffer();
  const stats = await sharp(back).stats();
  const [r, g, b] = stats.channels.map((c) => c.mean / 255);
  return { width: o.width, height: o.height, back, frost, luminance: 0.2126 * r + 0.7152 * g + 0.0722 * b };
}

type Window = { left: number; top: number; width: number; height: number };

/** `rect` (final-size pixels) in the backdrop's small raster. */
function smallWindow(bd: Backdrop, rect: Window) {
  const lw = Math.round(bd.width / SCALE);
  const lh = Math.round(bd.height / SCALE);
  const left = Math.max(0, Math.min(lw - 1, Math.round(rect.left / SCALE)));
  const top = Math.max(0, Math.min(lh - 1, Math.round(rect.top / SCALE)));
  const width = Math.max(1, Math.min(lw - left, Math.round(rect.width / SCALE)));
  const height = Math.max(1, Math.min(lh - top, Math.round(rect.height / SCALE)));
  return { left, top, width, height };
}

/** One window of a backdrop layer at `scale` of full size (1: final pixels), as a JPEG data: URI. */
export async function region(bd: Backdrop, which: "back" | "frost", rect: Window, scale = 1) {
  const out = await sharp(which === "back" ? bd.back : bd.frost)
    .extract(smallWindow(bd, rect))
    .resize(Math.max(1, Math.round(rect.width * scale)), Math.max(1, Math.round(rect.height * scale)), { kernel: "cubic", fit: "fill" })
    .jpeg({ quality: scale < 1 ? 80 : 86 })
    .toBuffer();
  return dataUri(out, "jpeg");
}

/** Decoded pixels, ready to be composited without another encode. */
export type Raster = { data: Buffer; width: number; height: number; channels: 3 | 4 };

/** One window of a backdrop layer, decoded at full size. */
async function windowRaster(bd: Backdrop, which: "back" | "frost", rect: Window) {
  return sharp(which === "back" ? bd.back : bd.frost)
    .extract(smallWindow(bd, rect))
    .resize(Math.round(rect.width), Math.round(rect.height), { kernel: "cubic", fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer();
}

/** "rgba(0, 0, 0, 0.3)" / "#RRGGBB" → an SVG fill and its opacity (librsvg wants them apart). */
function svgColour(c: string) {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return { fill: c, opacity: 1 };
  const [r, g, b, a = "1"] = m[1].split(",").map((x) => x.trim());
  return { fill: `rgb(${r},${g},${b})`, opacity: Number(a) };
}

const SHADOW_SCALE = 4;

/** Every panel's drop shadows, blurred at 1/4 size (they are soft anyway), as one full-size raster. */
async function shadowLayer(panels: PanelShape[], rect: Window, width: number, height: number) {
  const byBlur = new Map<number, string[]>();
  for (const p of panels) {
    for (const sh of p.shadows) {
      const { fill, opacity } = svgColour(sh.colour);
      const k = SHADOW_SCALE;
      const shape = `<rect x="${((p.x - rect.left) / k).toFixed(2)}" y="${((p.y + sh.y - rect.top) / k).toFixed(2)}" width="${(p.w / k).toFixed(2)}" height="${(p.h / k).toFixed(2)}" rx="${(Math.min(p.radius, p.w / 2, p.h / 2) / k).toFixed(2)}" fill="${fill}" fill-opacity="${opacity}"/>`;
      byBlur.set(sh.blur, [...(byBlur.get(sh.blur) ?? []), shape]);
    }
  }
  if (!byBlur.size) return null;
  const w = Math.ceil(width / SHADOW_SCALE);
  const h = Math.ceil(height / SHADOW_SCALE);
  const layers = await Promise.all(
    [...byBlur].map(async ([blur, shapes]) => ({
      input: await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${shapes.join("")}</svg>`))
        // CSS: a box-shadow's blur radius is twice the Gaussian's σ.
        .blur(Math.max(0.3, blur / 2 / SHADOW_SCALE))
        .png()
        .toBuffer(),
    })),
  );
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers)
    .png()
    .toBuffer()
    .then((small) => sharp(small).resize(width, height, { fit: "fill" }).png({ compressionLevel: 0 }).toBuffer());
}

/** An SVG linear gradient matching CSS `linear-gradient(<angle>deg, …)` over a box. */
function svgGradient(id: string, g: Gradient, box: { x: number; y: number; w: number; h: number }) {
  const rad = (g.angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const half = (Math.abs(box.w * dx) + Math.abs(box.h * dy)) / 2;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const stops = g.stops
    .map(([c, at]) => {
      const { fill, opacity } = svgColour(c);
      return `<stop offset="${at}" stop-color="${fill}" stop-opacity="${opacity}"/>`;
    })
    .join("");
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${(cx - dx * half).toFixed(1)}" y1="${(cy - dy * half).toFixed(1)}" x2="${(cx + dx * half).toFixed(1)}" y2="${(cy + dy * half).toFixed(1)}">${stops}</linearGradient>`;
}

/**
 * What lies under a glass graphic, as one raster: the backdrop window, every
 * panel's drop shadow, the frost cut to the panels' shapes, and their rims.
 * However many panels there are, satori only draws the translucent fills and
 * the content on top.
 */
export async function glassLayer(bd: Backdrop, rect: Window, panels: PanelShape[]): Promise<Raster> {
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  const raw = { width, height, channels: 3 as const };
  if (!panels.length) return { data: await windowRaster(bd, "back", rect), ...raw };
  const local = panels.map((p) => ({ ...p, x: p.x - rect.left, y: p.y - rect.top }));
  const svg = (body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`);
  const rx = (p: PanelShape) => Math.min(p.radius, p.w / 2, p.h / 2);
  const mask = svg(`<g fill="#fff">${local.map((p) => `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${rx(p)}"/>`).join("")}</g>`);
  const rims = svg(
    `<defs>${local.map((p, i) => svgGradient(`r${i}`, p.rim, p)).join("")}</defs>` +
      local
        .map((p, i) => {
          const e = p.edge;
          return `<rect x="${p.x + e / 2}" y="${p.y + e / 2}" width="${p.w - e}" height="${p.h - e}" rx="${Math.max(0, rx(p) - e / 2)}" fill="none" stroke="url(#r${i})" stroke-width="${e}"/>`;
        })
        .join(""),
  );
  const [back, frost, shadows] = await Promise.all([
    windowRaster(bd, "back", rect),
    windowRaster(bd, "frost", rect),
    shadowLayer(panels, rect, width, height),
  ]);
  const frostInPanels = await sharp(frost, { raw }).ensureAlpha().composite([{ input: mask, blend: "dest-in" }]).png({ compressionLevel: 0 }).toBuffer();
  const layers: sharp.OverlayOptions[] = [...(shadows ? [{ input: shadows }] : []), { input: frostInPanels }, { input: rims }];
  const data = await sharp(back, { raw }).composite(layers).removeAlpha().raw().toBuffer();
  return { data, ...raw };
}

/**
 * A zoomed-in detail of a screenshot: a `zoom`× crop around the most
 * interesting area (sharp's attention strategy), filling width × height.
 */
export async function cropDetail(pic: Picture | null, w: number, h: number, zoom: number, focus?: { x: number; y: number }) {
  if (!pic) return null;
  const width = Math.round(w);
  const height = Math.round(h);
  const bigW = Math.round(width * zoom);
  const bigH = Math.round((pic.height * bigW) / pic.width);
  const enlarged = await sharp(pic.buf).resize(bigW, Math.max(bigH, height)).toBuffer();
  let out: Buffer;
  if (focus) {
    const left = Math.round(Math.max(0, Math.min(bigW - width, focus.x * bigW - width / 2)));
    const top = Math.round(Math.max(0, Math.min(Math.max(bigH, height) - height, focus.y * bigH - height / 2)));
    out = await sharp(enlarged).extract({ left, top, width: Math.min(width, bigW), height }).jpeg({ quality: 90 }).toBuffer();
  } else {
    out = await sharp(enlarged).resize(width, height, { fit: "cover", position: "attention" }).jpeg({ quality: 90 }).toBuffer();
  }
  return dataUri(out, "jpeg");
}

// ─────────────────────────────────────────────────────────────────────────────
// Finishing
// ─────────────────────────────────────────────────────────────────────────────

let grainTile: Promise<Buffer> | null = null;

/** A 256 px tile of soft monochrome noise, centred on mid-grey (no change under soft-light). */
function grain() {
  grainTile ??= (async () => {
    const size = 256;
    const px = Buffer.alloc(size * size * 3);
    for (let i = 0; i < size * size; i++) {
      const v = 128 + Math.round((Math.random() + Math.random() + Math.random() - 1.5) * 22);
      px[i * 3] = px[i * 3 + 1] = px[i * 3 + 2] = Math.max(0, Math.min(255, v));
    }
    return sharp(px, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
  })();
  return grainTile;
}

export type OutputType = "jpeg" | "png";

/**
 * The final file in one encode: the rendered PNG laid over `under` (the
 * glass backdrop, when the render is transparent), film grain on top, then
 * JPEG or PNG. Grain is applied in the same pipeline, not as its own pass.
 */
export async function finish(png: Buffer, type: OutputType, { grain: withGrain = true, under }: { grain?: boolean; under?: Raster } = {}) {
  const layers: sharp.OverlayOptions[] = [];
  if (under) layers.push({ input: png });
  if (withGrain) layers.push({ input: await grain(), tile: true, blend: "soft-light" });
  const base = under ? sharp(under.data, { raw: { width: under.width, height: under.height, channels: under.channels } }) : sharp(png);
  const p = layers.length ? base.composite(layers) : base;
  return type === "jpeg"
    ? p.flatten({ background: "#ffffff" }).jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer()
    : p.png({ compressionLevel: 6 }).toBuffer();
}

/** Side by side (a carousel strip), optionally with a gap of `gap` px in `background`. */
export async function joinHorizontally(images: Buffer[], width: number, height: number, gap = 0, background = "#ffffff") {
  const total = images.length * width + (images.length - 1) * gap;
  return sharp({ create: { width: total, height, channels: 3, background } })
    .composite(images.map((input, i) => ({ input, left: i * (width + gap), top: 0 })))
    .png()
    .toBuffer();
}

export { alpha };
