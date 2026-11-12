// Colour palettes for the social post graphics (app/api/graphics).
//
// Each palette is three colours used in 60/30/10 proportions:
//   base     60%  the background
//   surface  30%  the large secondary blocks: the panel behind a screenshot,
//                 the band that holds a call's body text
//   accent   10%  small marks only: the tier chip, the call-to-action, rules
//
// Social graphics are a deliberate exception to the site's black-and-white
// rule. Text colours are not part of a palette: they are picked per fill for
// contrast (see `inkOn`).

export type Palette = {
  id: string;
  name: string;
  base: string;
  surface: string;
  accent: string;
};

export const PALETTES = [
  { id: "house", name: "House", base: "#FFFFFF", surface: "#000000", accent: "#141414" },
  { id: "egypt", name: "Egypt", base: "#1034A6", surface: "#7F95AE", accent: "#C8102E" },
  { id: "night", name: "Night", base: "#0B0B0C", surface: "#1F1F22", accent: "#F2EFE8" },
  { id: "paper", name: "Paper", base: "#F3EFE6", surface: "#1E2A24", accent: "#D4572A" },
  { id: "saperavi", name: "Saperavi", base: "#F6F1EE", surface: "#5A1A2C", accent: "#D9A63A" },
  { id: "moss", name: "Moss", base: "#E4E6DC", surface: "#2E3A2B", accent: "#E2B53B" },
] as const satisfies readonly Palette[];

export type PaletteId = (typeof PALETTES)[number]["id"];

export const PALETTE_IDS = PALETTES.map((p) => p.id) as PaletteId[];

export function getPalette(id: string | null | undefined): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

function channels(hex: string) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string) {
  const [r, g, b] = channels(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function isDark(hex: string) {
  return luminance(hex) < 0.36;
}

/** Text colour for anything drawn on `fill`: near-black or white, whichever reads better. */
export function inkOn(fill: string) {
  const l = luminance(fill);
  const onWhite = 1.05 / (l + 0.05);
  const onBlack = (l + 0.05) / 0.05;
  return onWhite >= onBlack ? "#FFFFFF" : "#0B0B0C";
}

/** `hex` at `alpha` opacity, as rgba(). */
export function alpha(hex: string, a: number) {
  const [r, g, b] = channels(hex).map((c) => Math.round(c * 255));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
