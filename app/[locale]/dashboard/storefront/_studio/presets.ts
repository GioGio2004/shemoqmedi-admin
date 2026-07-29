import type { StudioConfig } from "@/convex/studioConfig";

// ─────────────────────────────────────────────────────────────────────────────
// Studio preset catalogs — pure data + tiny helpers shared by panels/preview.
// ─────────────────────────────────────────────────────────────────────────────

/** Font preset keys → CSS stacks. Variables are loaded by the root layout. */
export const STUDIO_FONTS: Record<string, { label: string; stack: string }> = {
  grotesk: {
    label: "Grotesk",
    stack: "var(--font-display), 'Space Grotesk', 'Helvetica Neue', sans-serif",
  },
  sans: {
    label: "Sans",
    stack: "var(--font-sans), 'Outfit', system-ui, sans-serif",
  },
  serif: {
    label: "Serif",
    stack: "Georgia, 'Times New Roman', serif",
  },
  mono: {
    label: "Mono",
    stack: "var(--font-geist-mono), ui-monospace, 'Cascadia Mono', monospace",
  },
};

export function fontStack(key: string): string {
  return (STUDIO_FONTS[key] ?? STUDIO_FONTS.sans).stack;
}

/** Curated theme palettes. Picking one stamps all five colors + mode. */
export const STUDIO_PALETTES: Array<{
  key: string;
  label: string;
  theme: Pick<
    StudioConfig["theme"],
    "mode" | "background" | "surface" | "ink" | "accent" | "accentInk"
  >;
}> = [
  {
    key: "noir",
    label: "Noir",
    theme: {
      mode: "dark",
      background: "#0B0B0A",
      surface: "#151513",
      ink: "#F4F3F0",
      accent: "#D8FF3A",
      accentInk: "#1A2000",
    },
  },
  {
    key: "espresso",
    label: "Espresso",
    theme: {
      mode: "dark",
      background: "#14100C",
      surface: "#1F1712",
      ink: "#F3EAE1",
      accent: "#C98A4B",
      accentInk: "#241304",
    },
  },
  {
    key: "forest",
    label: "Forest",
    theme: {
      mode: "dark",
      background: "#0D1210",
      surface: "#152019",
      ink: "#EAF2ED",
      accent: "#6FDCA0",
      accentInk: "#04220F",
    },
  },
  {
    key: "royal",
    label: "Royal",
    theme: {
      mode: "dark",
      background: "#0E0D16",
      surface: "#171527",
      ink: "#F0EFFA",
      accent: "#8F7BFF",
      accentInk: "#F5F2FF",
    },
  },
  {
    key: "porcelain",
    label: "Porcelain",
    theme: {
      mode: "light",
      background: "#F7F5F0",
      surface: "#FFFFFF",
      ink: "#191914",
      accent: "#1F513F",
      accentInk: "#F2FBF6",
    },
  },
  {
    key: "sunrise",
    label: "Sunrise",
    theme: {
      mode: "light",
      background: "#FBF6EE",
      surface: "#FFFFFF",
      ink: "#221A12",
      accent: "#E2572B",
      accentInk: "#FFF3EC",
    },
  },
];

export const CARD_VARIANTS: Array<{
  key: StudioConfig["cards"]["variant"];
  label: string;
  hint: string;
}> = [
  { key: "classic", label: "Classic", hint: "Image top, text below" },
  { key: "minimal", label: "Minimal", hint: "Ruled text rows" },
  { key: "glass", label: "Glass", hint: "Image with frosted plate" },
  { key: "editorial", label: "Editorial", hint: "Split row, mono price" },
  { key: "banner", label: "Banner", hint: "Wide card, title overlay" },
];

export const HERO_PRESETS: Array<{
  key: StudioConfig["hero"]["preset"];
  label: string;
  hint: string;
}> = [
  { key: "classic", label: "Classic", hint: "Cover + identity block" },
  { key: "editorial", label: "Editorial", hint: "Type-first, hairlines" },
  { key: "poster", label: "Poster", hint: "Full-bleed image" },
];

export const NAV_STYLES: Array<{
  key: StudioConfig["nav"]["style"];
  label: string;
}> = [
  { key: "pills", label: "Pills" },
  { key: "underline", label: "Underline" },
  { key: "chips", label: "Chips" },
];

export const ENTRANCE_PRESETS: Array<{
  key: StudioConfig["motion"]["entrance"];
  label: string;
}> = [
  { key: "fade-up", label: "Fade up" },
  { key: "stagger-rise", label: "Stagger rise" },
  { key: "slide-mask", label: "Slide mask" },
  { key: "scale-in", label: "Scale in" },
  { key: "none", label: "None" },
];

export const HOVER_PRESETS: Array<{
  key: StudioConfig["motion"]["hover"];
  label: string;
}> = [
  { key: "lift", label: "Lift" },
  { key: "tilt", label: "Tilt" },
  { key: "glow", label: "Glow" },
  { key: "none", label: "None" },
];

export const SECTION_META: Record<string, { label: string; hint: string }> = {
  hero: { label: "Hero", hint: "Venue identity block" },
  featured: { label: "Featured", hint: "Starred items strip" },
  menu: { label: "Menu", hint: "Categories & items" },
  info: { label: "Info", hint: "Hours & contact footer" },
};

/** Density → spacing multiplier used across the preview. */
export const DENSITY_SCALE: Record<StudioConfig["theme"]["density"], number> = {
  compact: 0.8,
  cozy: 1,
  spacious: 1.3,
};

// ── Color helpers ────────────────────────────────────────────────────────────

/** #RGB/#RRGGBB → [r,g,b]; returns null for anything else. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Relative luminance 0..1 (fast approximation, good enough for ink picking). */
export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => c / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Best text color to place ON a given background. */
export function bestInkFor(hex: string): string {
  return luminance(hex) > 0.55 ? "#12120E" : "#FAFAF6";
}

/** rgba() string from a hex + alpha — used to derive muted/hairline tones. */
export function withAlpha(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

// ── Text helpers ─────────────────────────────────────────────────────────────

/** Pull the best string out of a translatedText record. */
export function tr(
  record: Record<string, string> | string | null | undefined,
  locale: string,
): string {
  if (!record) return "";
  if (typeof record === "string") return record;
  return record[locale] ?? record["en"] ?? Object.values(record)[0] ?? "";
}

/** Tetri integer → GEL display string. 550 → "5.50 ₾" */
export function formatPrice(tetri: number): string {
  return (tetri / 100).toFixed(2) + " ₾";
}
