// The faces the graphics are set in (assets/fonts), shared by the server
// renderer (server.ts loads them for satori) and the browser preview
// (previewFontFaces, served by /api/graphics/fonts/<file>). Client-safe.
//
// Inter (OFL, LICENSE-Inter.txt) for everything; Instrument Serif (OFL,
// LICENSE-InstrumentSerif.txt) for the magazine style's display type.

export type FontFile = { family: "Inter" | "Instrument Serif"; file: string; weight: 400 | 500 | 600 | 700; style: "normal" | "italic"; subset: "latin" | "latin-ext" };

const SUBSETS = ["latin", "latin-ext"] as const;

export const FONT_FILES: FontFile[] = [
  ...SUBSETS.flatMap((subset) =>
    ([400, 500, 600, 700] as const).map((weight) => ({ family: "Inter" as const, file: `inter-${subset}-${weight}-normal.woff`, weight, style: "normal" as const, subset })),
  ),
  ...SUBSETS.flatMap((subset) =>
    (["normal", "italic"] as const).map((style) => ({ family: "Instrument Serif" as const, file: `instrument-serif-${subset}-400-${style}.woff`, weight: 400 as const, style, subset })),
  ),
];

/** Google Fonts' subset ranges, so a browser only fetches the file a glyph needs. */
const RANGES = {
  latin: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
  "latin-ext":
    "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
};

export function isFontFile(name: string) {
  return FONT_FILES.some((f) => f.file === name);
}

/**
 * @font-face rules for the preview: the same files satori draws with, under
 * the same family names, so the browser and the final JPEG set type alike.
 */
export const previewFontFaces = FONT_FILES.map(
  (f) =>
    `@font-face{font-family:"${f.family}";font-style:${f.style};font-weight:${f.weight};font-display:swap;src:url(/api/graphics/fonts/${f.file}) format("woff");unicode-range:${RANGES[f.subset]};}`,
).join("\n");
