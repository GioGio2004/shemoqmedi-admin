import type { Style } from "../spec";
import type { FlatStyle } from "./common";
import { bento } from "./bento";
import { kinetic } from "./kinetic";
import { magazine } from "./magazine";
import { swiss } from "./swiss";

// The flat styles by id. Glass is not here: it has its own backdrop pipeline
// (templates.tsx, story.tsx and the shared frost layer in render.ts).

export const FLAT_STYLES: Record<Exclude<Style, "glass">, FlatStyle> = {
  swiss,
  kinetic,
  magazine,
  bento,
};

export { themeOf, type FlatStyle, type Theme } from "./common";
