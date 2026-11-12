import sharp from "sharp";
import { STOREFRONT_URL } from "@/lib/storefront";
import { alpha, type Palette } from "@/lib/palettes";

// Raster work for the social graphics, done with sharp before and after
// satori (which can't blur, crop or read WebP):
//
//   fetchImage     a screenshot from one of our own hosts, cached briefly
//   buildBackdrop  the blurred, palette-tinted backdrop behind a graphic (or a
//                  whole carousel panorama) and its "frost": the same picture
//                  blurred further and lightened, which glass panels show
//   region         one canvas-sized window of a backdrop, as a data: URI
//   cropDetail     a zoomed-in crop of a screenshot (the carousel's details)
//   autoPalette    base / surface / accent picked from a screenshot's colours
//   finish         film grain over the rendered PNG, then JPEG or PNG out

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

/** An image's bytes, or null when it is missing, too big or not on our hosts. Cached for ten minutes. */
export function fetchImage(raw: string | null | undefined): Promise<Buffer | null> {
  if (!raw) return Promise.resolve(null);
  let url: URL;
  try {
    url = new URL(raw);
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

export type Picture = { buf: Buffer; width: number; height: number };

/** Decoded size of an image (null when sharp can't read it). */
export async function picture(buf: Buffer | null): Promise<Picture | null> {
  if (!buf) return null;
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) return null;
    // Some formats report the first frame only; that's what we draw anyway.
    return { buf, width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

function dataUri(buf: Buffer, type: "jpeg" | "png") {
  return `data:image/${type};base64,${buf.toString("base64")}`;
}

/** A picture resized to `width` (keeping its shape) as a JPEG data: URI satori can draw. */
export async function asDataUri(pic: Picture | null, width: number, maxHeight?: number) {
  if (!pic) return null;
  let p = sharp(pic.buf).resize({ width: Math.round(width), withoutEnlargement: false });
  if (maxHeight) {
    const h = Math.round((pic.height * width) / pic.width);
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
  const { data } = await sharp(pic.buf).resize(48, 30, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
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

export async function buildBackdrop(o: BackdropOptions): Promise<Backdrop> {
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
        await sharp(pic.buf).resize(width, h, { fit: "cover", position: "attention" }).modulate({ saturation: 1.25 }).ensureAlpha().png().toBuffer(),
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

/** One window of a backdrop layer at full size, as a JPEG data: URI. */
export async function region(
  bd: Backdrop,
  which: "back" | "frost",
  rect: { left: number; top: number; width: number; height: number },
) {
  const src = which === "back" ? bd.back : bd.frost;
  const lw = Math.round(bd.width / SCALE);
  const lh = Math.round(bd.height / SCALE);
  const left = Math.max(0, Math.min(lw - 1, Math.round(rect.left / SCALE)));
  const top = Math.max(0, Math.min(lh - 1, Math.round(rect.top / SCALE)));
  const width = Math.max(1, Math.min(lw - left, Math.round(rect.width / SCALE)));
  const height = Math.max(1, Math.min(lh - top, Math.round(rect.height / SCALE)));
  const out = await sharp(src)
    .extract({ left, top, width, height })
    .resize(Math.round(rect.width), Math.round(rect.height), { kernel: "cubic", fit: "fill" })
    .jpeg({ quality: 86 })
    .toBuffer();
  return dataUri(out, "jpeg");
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

/** Grain over the rendered PNG, then the final file. */
export async function finish(png: Buffer, type: OutputType, withGrain = true) {
  let p = sharp(png);
  if (withGrain) p = sharp(await p.composite([{ input: await grain(), tile: true, blend: "soft-light" }]).png().toBuffer());
  return type === "jpeg"
    ? p.flatten({ background: "#ffffff" }).jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer()
    : p.png({ compressionLevel: 8 }).toBuffer();
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
