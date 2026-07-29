import { v, Infer } from "convex/values";

// ─────────────────────────────────────────────────────────────────────────────
// SHEMOQMEDI STUDIO — the design-as-data contract.
//
// One document describes the entire visual identity of a venue's menu page:
// theme tokens, card component variant, hero preset, category nav, GSAP motion
// recipe, and section ordering. The Studio editor writes it (draft), publish
// copies it to `published`, and the consumer app renders the menu from it via
// studio.getPublishedDesign — no code deploy per design change.
//
// Evolution rule: extend by ADDING optional fields or new union literals.
// `version` gates any future breaking shape change.
// ─────────────────────────────────────────────────────────────────────────────

export const studioConfigV = v.object({
  version: v.number(),

  // Theme tokens — every color/space decision the renderer needs.
  theme: v.object({
    mode: v.union(v.literal("dark"), v.literal("light")),
    background: v.string(), // page ground, hex
    surface: v.string(), // raised cards/panels, hex
    ink: v.string(), // primary text, hex
    accent: v.string(), // brand accent, hex
    accentInk: v.string(), // text placed ON the accent, hex
    headingFont: v.string(), // preset key — see STUDIO_FONTS on the client
    bodyFont: v.string(), // preset key
    radius: v.number(), // px, 0–24
    density: v.union(
      v.literal("compact"),
      v.literal("cozy"),
      v.literal("spacious"),
    ),
  }),

  hero: v.object({
    preset: v.union(
      v.literal("classic"), // cover image + centered identity
      v.literal("editorial"), // RULED-style type-first, hairlines + index labels
      v.literal("poster"), // full-bleed image, name burned over it
    ),
    alignment: v.union(v.literal("left"), v.literal("center")),
    showLogo: v.boolean(),
    showTagline: v.boolean(),
  }),

  // The menu item card — each variant is a genuinely different component.
  cards: v.object({
    variant: v.union(
      v.literal("classic"), // image top, text below — the safe default
      v.literal("minimal"), // text-only ruled rows, price dotted right
      v.literal("glass"), // image bg + glassmorphic text plate
      v.literal("editorial"), // horizontal split, mono price, hairlines
      v.literal("banner"), // wide landscape card, title overlaid
    ),
    columns: v.number(), // 1 | 2
    imageRatio: v.union(
      v.literal("square"),
      v.literal("portrait"),
      v.literal("landscape"),
    ),
    showImages: v.boolean(),
    showDescriptions: v.boolean(),
    showTags: v.boolean(),
    priceStyle: v.union(
      v.literal("plain"), // 12.50 ₾
      v.literal("badge"), // accent chip
      v.literal("dotted"), // name ······ price
    ),
  }),

  nav: v.object({
    style: v.union(
      v.literal("pills"),
      v.literal("underline"),
      v.literal("chips"), // mono index chips, RULED grammar
    ),
    sticky: v.boolean(),
  }),

  // GSAP recipe. Durations follow the RULED motion contract (expo.out
  // dominant, 0.6s workhorse) scaled by `speed` (0.5 slow … 2 fast).
  motion: v.object({
    enabled: v.boolean(),
    entrance: v.union(
      v.literal("none"),
      v.literal("fade-up"),
      v.literal("stagger-rise"),
      v.literal("slide-mask"),
      v.literal("scale-in"),
    ),
    hover: v.union(
      v.literal("none"),
      v.literal("lift"),
      v.literal("tilt"),
      v.literal("glow"),
    ),
    speed: v.number(),
    scrollReveal: v.boolean(),
  }),

  // Ordered page composition. Renderer skips unknown ids, so new section
  // types can ship without a migration.
  sections: v.array(
    v.object({
      id: v.string(), // "hero" | "featured" | "menu" | "info" (open set)
      visible: v.boolean(),
    }),
  ),
});

export type StudioConfig = Infer<typeof studioConfigV>;

export const DEFAULT_STUDIO_CONFIG: StudioConfig = {
  version: 1,
  theme: {
    mode: "dark",
    background: "#0B0B0A",
    surface: "#151513",
    ink: "#F4F3F0",
    accent: "#D8FF3A",
    accentInk: "#1A2000",
    headingFont: "grotesk",
    bodyFont: "sans",
    radius: 4,
    density: "cozy",
  },
  hero: {
    preset: "classic",
    alignment: "center",
    showLogo: true,
    showTagline: true,
  },
  cards: {
    variant: "classic",
    columns: 2,
    imageRatio: "square",
    showImages: true,
    showDescriptions: true,
    showTags: false,
    priceStyle: "plain",
  },
  nav: {
    style: "pills",
    sticky: true,
  },
  motion: {
    enabled: true,
    entrance: "fade-up",
    hover: "lift",
    speed: 1,
    scrollReveal: true,
  },
  sections: [
    { id: "hero", visible: true },
    { id: "featured", visible: true },
    { id: "menu", visible: true },
    { id: "info", visible: true },
  ],
};
