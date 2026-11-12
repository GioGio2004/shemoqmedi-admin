/* eslint-disable jsx-a11y/alt-text -- satori markup, not a page */
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { alpha, inkOn, isDark, luminance, type Palette } from "@/lib/palettes";
import { FORMATS, TIERS, type FormatId, type TemplateId, type Tier } from "../spec";
import type { SlideKind, StoryAssets, StoryFacts } from "../story";

// What the flat styles (swiss, kinetic, magazine, bento) share: the frame of
// a format, the content of a template in one normalised shape, text fitting
// with per-typeface widths, and small layout helpers. Client-safe: the
// Studio's live preview draws these same components in the browser.

export type Shape = "wide" | "portrait" | "square" | "tall";

export type Frame = {
  W: number;
  H: number;
  shape: Shape;
  /**
   * The part every format shows in full. Stories lose about 240 px top and
   * bottom to Instagram's own buttons, and a reel cover is cropped to 3:4 in
   * the profile grid; both keep their words inside y = 240…1680.
   */
  safe: { top: number; bottom: number };
};

export function frameOf(format: FormatId): Frame {
  const { width: W, height: H } = FORMATS[format];
  const shape: Shape = W / H > 1.3 ? "wide" : H / W > 1.6 ? "tall" : H > W ? "portrait" : "square";
  const cut = shape === "tall" ? 240 : 0;
  return { W, H, shape, safe: { top: cut, bottom: H - cut } };
}

/** The palette's colours and the ink that reads on each. */
export type Theme = {
  palette: Palette;
  /** Text on the base (60%). */
  ink: string;
  /** Text on the surface (30%). */
  onSurface: string;
  /** Text on the accent (10%). */
  onAccent: string;
  /** The base is light. */
  light: boolean;
};

export function themeOf(palette: Palette): Theme {
  return { palette, ink: inkOn(palette.base), onSurface: inkOn(palette.surface), onAccent: inkOn(palette.accent), light: !isDark(palette.base) };
}

export function fade(colour: string, a: number) {
  return colour.startsWith("#") ? alpha(colour, a) : colour;
}

/**
 * `colour` where it stands out against `ground` (WCAG contrast ≥ 2), else
 * `fallback`: an accent mark on a fill of nearly the same colour (House's
 * near-black accent on its black surface) falls back to the ink.
 */
export function visible(colour: string, ground: string, fallback: string) {
  const [a, b] = [luminance(colour), luminance(ground)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05) >= 2 ? colour : fallback;
}

/** The brand's one colour of its own: the storefront's blue score squares. */
export const SCORE_BLUE = "#0040FF";

// ─────────────────────────────────────────────────────────────────────────────
// Content: every template in one of four shapes
// ─────────────────────────────────────────────────────────────────────────────

export type SiteContent = {
  kind: "site";
  award: boolean;
  tier: Tier;
  /** "Site of the Day", "New on Shemoqmedi"… */
  kicker: string;
  title: string;
  studio: string;
  tagline: string;
  date: string;
  url: string;
};

export type CallContent = { kind: "call"; kicker: string; headline: string; body: string; cta: string };

export type QuoteContent = { kind: "quote"; quote: string; juror: string; role: string; site: string; score: number | null };

export type ShotContent = { kind: "shot"; title: string; studio: string; url: string; index: string };

export type Content = SiteContent | CallContent | QuoteContent | ShotContent;

/** "https://www.shemoqmedi.space/submit/" → "shemoqmedi.space/submit". */
export function shortUrl(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

export function hostOf(url: string) {
  return shortUrl(url).split("/")[0];
}

export function contentOf(template: TemplateId, f: Record<string, string>): Content {
  switch (template) {
    case "award":
    case "new_listing": {
      const award = template === "award";
      const tier = (f.tier in TIERS ? f.tier : "SOTD") as Tier;
      return {
        kind: "site",
        award,
        tier,
        kicker: award ? TIERS[tier] : f.kicker || "New on Shemoqmedi",
        title: f.title || "Untitled",
        studio: f.studio || "",
        tagline: award ? "" : f.tagline || "",
        date: f.date || "",
        url: f.url || "",
      };
    }
    case "call_submissions":
    case "call_jury":
    case "announcement":
      return { kind: "call", kicker: f.kicker || "Announcement", headline: f.headline || "", body: f.body || "", cta: f.cta ? shortUrl(f.cta) : "" };
    case "jury_quote": {
      const n = Number(f.score);
      return {
        kind: "quote",
        quote: (f.quote || "").replace(/^["“]|["”]$/g, ""),
        juror: f.juror || "",
        role: f.role || "",
        site: f.site || "",
        score: f.score !== undefined && f.score !== "" && Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : null,
      };
    }
    case "screenshot":
      return { kind: "shot", title: f.title || hostOf(f.url || "shemoqmedi.space"), studio: f.studio || "", url: f.url || "", index: f.index || "" };
  }
}

/** The site of a story as single-graphic content (the hook and site slides reuse the site layouts). */
export function siteOfStory(f: StoryFacts): SiteContent {
  const tier = (f.tier in TIERS ? f.tier : "SOTD") as Tier;
  return { kind: "site", award: f.tier in TIERS, tier, kicker: f.kicker, title: f.title, studio: f.studio, tagline: f.tagline, date: f.date, url: f.url };
}

/** Short tier code for marks and stickers ("SOTD"; "F100" reads as "First 100"). */
export function tierMark(tier: Tier) {
  return tier === "F100" ? "100" : tier;
}

// ─────────────────────────────────────────────────────────────────────────────
// Type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Average advance per character, in em, for the faces the styles use (Inter
 * at display tracking, Inter in capitals, Instrument Serif). Good enough to
 * pick a size that fits; the layouts leave a little air for the error.
 */
export const CHAR = { sans: 0.54, sansBold: 0.56, caps: 0.7, serif: 0.37, serifItalic: 0.35, text: 0.5 } as const;

/** Lines `text` wraps to at `size` px in `width` px (greedy word wrap). */
export function linesOf(text: string, width: number, size: number, charW: number) {
  const per = width / (size * charW);
  let lines = 1;
  let used = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (word.length > per) return Infinity;
    if (used === 0) used = word.length;
    else if (used + 1 + word.length <= per) used += 1 + word.length;
    else {
      lines++;
      used = word.length;
    }
  }
  return lines;
}

/** The largest size ≤ max at which `text` fits `lines` lines of `width`, and `height` when given. */
export function fitSize(text: string, o: { width: number; lines: number; max: number; min?: number; height?: number; lineHeight?: number; charW?: number }) {
  const min = o.min ?? 24;
  const charW = o.charW ?? CHAR.sans;
  for (let size = Math.round(o.max); size > min; size -= 2) {
    const n = linesOf(text, o.width, size, charW);
    if (n <= o.lines && (!o.height || n * size * (o.lineHeight ?? 1) <= o.height)) return size;
  }
  return min;
}

/** The size at which one line of `text` fills `width` exactly. */
export function fillSize(text: string, width: number, charW: number, max = 1000) {
  return Math.min(max, Math.floor(width / (Math.max(1, text.length) * charW)));
}

/** Words grouped into at most `max` lines, balanced by length (for stacked display type). */
export function stackWords(text: string, max: number) {
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (words.length <= max) return words;
  const total = words.join(" ").length;
  const target = total / max;
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > target * 1.15 && lines.length < max - 1) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout
// ─────────────────────────────────────────────────────────────────────────────

export const row: CSSProperties = { display: "flex", flexDirection: "row" };
export const col: CSSProperties = { display: "flex", flexDirection: "column" };

/** Absolutely placed box (satori positions against the parent, like the browser preview's shims). */
export function At({ x, y, w, h, style, children }: { x: number; y: number; w?: number; h?: number; style?: CSSProperties; children?: ReactNode }) {
  return <div style={{ ...col, position: "absolute", left: x, top: y, ...(w !== undefined ? { width: w } : {}), ...(h !== undefined ? { height: h } : {}), ...style }}>{children}</div>;
}

/** Plain text in a flex box (satori wants one per run of text with its own style). */
export function T({ size, weight = 400, color, style, children }: { size: number; weight?: number; color: string; style?: CSSProperties; children: ReactNode }) {
  return <div style={{ display: "flex", fontSize: size, fontWeight: weight, color, ...style }}>{children}</div>;
}

/** Text clamped to `lines` lines (satori: lineClamp; the preview shims it to -webkit-line-clamp). */
export function Clamp({ size, lines, color, lineHeight = 1.32, weight = 400, style, children }: { size: number; lines: number; color: string; lineHeight?: number; weight?: number; style?: CSSProperties; children: ReactNode }) {
  return <div style={{ display: "block", fontSize: size, lineHeight, fontWeight: weight, color, lineClamp: lines, ...style }}>{children}</div>;
}

/** A picture filling w × h, cropped from the top left like a page (screenshots). */
export function Shot({ src, w, h, position = "left top", radius = 0, fallback }: { src: string | null; w: number; h: number; position?: string; radius?: number; fallback: string }) {
  return (
    <div style={{ display: "flex", width: w, height: h, overflow: "hidden", borderRadius: radius, background: fallback }}>
      {src ? <img src={src} width={w} height={h} style={{ width: w, height: h, objectFit: "cover", objectPosition: position }} /> : null}
    </div>
  );
}

export function Arrow({ size, color, weight = 1.8 }: { size: number; color: string; weight?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M4 12h15M13 6l6 6-6 6" stroke={color} strokeWidth={weight} fill="none" />
    </svg>
  );
}

/** The root of every flat graphic. */
export function Page({ W, H, background, font = "Inter", children }: { W: number; H: number; background: string; font?: string; children: ReactNode }) {
  return <div style={{ display: "flex", position: "relative", width: W, height: H, overflow: "hidden", fontFamily: font, background }}>{children}</div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// The style contract
// ─────────────────────────────────────────────────────────────────────────────

export type SingleInput = {
  template: TemplateId;
  format: FormatId;
  fields: Record<string, string>;
  theme: Theme;
  shot: string | null;
  badge: string | null;
};

export type SlideInput = {
  plan: SlideKind[];
  index: number;
  facts: StoryFacts;
  theme: Theme;
  assets: StoryAssets;
};

/** Pixel sizes the server prepares a style's carousel pictures at. */
export type SlidePictures = {
  hero: number;
  /** The detail crops: size of the tile and how far to zoom in. */
  detail: (d: number) => { w: number; h: number; zoom: number };
  mobile: number;
};

export type FlatStyle = {
  single: (input: SingleInput) => ReactElement;
  slide: (input: SlideInput) => ReactElement;
  /** How wide to prepare the screenshot for a format. */
  shotWidth: (format: FormatId) => number;
  slidePictures: SlidePictures;
  /** Film grain over the finished picture (print-like styles). */
  grain: boolean;
};

export const SECTION: Record<SlideKind, string> = {
  hook: "",
  site: "The site",
  detail: "Up close",
  mobile: "On the phone",
  jury: "The jury",
  credits: "Credits",
  cta: "See it",
};

/** Index of this detail among the story's detail slides. */
export function detailIndex(plan: SlideKind[], index: number) {
  return plan.slice(0, index).filter((p) => p === "detail").length;
}

export function chipOf(f: StoryFacts, d: number) {
  return f.chips[d] ?? (d === 0 ? "The details" : "The craft");
}

export function pad2(n: number) {
  return String(n).padStart(2, "0");
}
