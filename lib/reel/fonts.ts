// The type the reel compositor sets texts and captions in: Inter, the same
// files the graphics use (assets/fonts, served by /api/graphics/fonts/<file>),
// registered under their own family name so a canvas finds them whatever
// next/font called its copy. Loaded once per page; drawing never waits for
// it (the render and the preview await ensureReelFonts() first).

import { FONT_FILES } from "@/lib/graphics/fonts";

/** The canvas font stack (Inter first, then the system's). */
export const REEL_FONT_FAMILY = "ReelInter";
export const REEL_FONT_STACK = `"${REEL_FONT_FAMILY}", Inter, -apple-system, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

/** A canvas font string: `reelFont(700, 64)` → `700 64px "ReelInter", …`. */
export function reelFont(weight: number, sizePx: number) {
  return `${weight} ${Math.max(1, Math.round(sizePx * 100) / 100)}px ${REEL_FONT_STACK}`;
}

let loading: Promise<void> | null = null;

type FontSetLike = { add(font: FontFace): unknown };

function fontSet(): FontSetLike | null {
  if (typeof document !== "undefined" && document.fonts) return document.fonts as unknown as FontSetLike;
  const scope = globalThis as unknown as { fonts?: FontSetLike };
  return scope.fonts ?? null;
}

/**
 * Loads Inter 400-700 (latin + latin-ext) for canvas text. Resolves when the
 * faces are in, or after `timeoutMs` (the system font is used meanwhile), and
 * never rejects: a missing font must not stop a render.
 */
export function ensureReelFonts(timeoutMs = 4000): Promise<void> {
  if (typeof FontFace === "undefined") return Promise.resolve();
  const set = fontSet();
  if (!set) return Promise.resolve();
  loading ??= Promise.all(
    FONT_FILES.filter((f) => f.family === "Inter").map(async (f) => {
      try {
        const face = new FontFace(REEL_FONT_FAMILY, `url(/api/graphics/fonts/${f.file}) format("woff")`, {
          weight: String(f.weight),
          style: f.style,
          unicodeRange: f.subset === "latin" ? "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2212" : "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+1E00-1E9F, U+20A0-20AB, U+20AD-20C0, U+A720-A7FF",
        });
        set.add(await face.load());
      } catch {
        // The fallback stack draws instead.
      }
    }),
  ).then(() => undefined);
  return Promise.race([loading, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}
