// Design recipes: what a rendered social graphic was made from, stored on its
// `media` row (media.design) when the render is registered (graphics.ts), so
// a post's graphic can be opened again and edited: the Studio's Create page
// loads the recipe (/create?post=<id>&item=<index>), the MCP connector
// re-renders it with changes (render_graphic / render_carousel) and swaps the
// new URL into the post (update_post). Plain validators and types: safe to
// import from Convex and from the Next app. Contract: docs/post-editing.md.

import { v, type Infer } from "convex/values";

const texts = v.record(v.string(), v.string());

/** One graphic (graphics.render / renderForPost without carousel). */
export const graphicDesign = v.object({
  kind: v.literal("graphic"),
  template: v.string(),
  format: v.string(),
  /** Always set: "glass" when the render named none. */
  style: v.string(),
  palette: v.string(),
  /** The glass finish asked for (glass style only; absent = frost). */
  glass: v.optional(v.string()),
  /** The text fields as given (the server fills the rest with the template's defaults). */
  fields: texts,
  /** The template's image slots in order (award: [screenshot, badge], others: [screenshot]). */
  imageUrls: v.array(v.string()),
});

/** The storytelling carousel's options (graphics.renderCarousel's `story`). */
export const carouselStory = v.object({
  chips: v.optional(v.array(v.string())),
  notes: v.optional(v.array(v.string())),
  cta: v.optional(v.string()),
  glass: v.optional(v.string()),
  shots: v.optional(v.array(v.string())),
  mobile: v.optional(v.string()),
});

/** One slide of a storytelling carousel; every slide of a set carries the same inputs. */
export const carouselDesign = v.object({
  kind: v.literal("carousel"),
  /** The listing whose facts and screenshots it was told from (absent: facts only). */
  listingId: v.optional(v.id("listings")),
  palette: v.string(),
  /** Always set: "glass" when the render named none. */
  style: v.string(),
  /** Texts that override or supply the listing's (title, studio, quote, cta, ...). */
  facts: texts,
  story: carouselStory,
  /** 0-based position of this slide in its set. */
  slideIndex: v.number(),
  /** The slide's name from the renderer ("hook", "site", "cta", ...). */
  slideName: v.string(),
  /** How many slides the set has. */
  total: v.number(),
  /** Shared by every slide rendered together (their ImageKit folder): finds the rest of the set. */
  setId: v.string(),
});

export const mediaDesign = v.union(graphicDesign, carouselDesign);

export type GraphicDesign = Infer<typeof graphicDesign>;
export type CarouselDesign = Infer<typeof carouselDesign>;
export type CarouselStory = Infer<typeof carouselStory>;
export type MediaDesign = Infer<typeof mediaDesign>;

/** A recipe as the APIs return it: a carousel's listing also by slug (for the MCP tools), null when it is gone. */
export const designView = v.union(
  graphicDesign,
  v.object({ ...carouselDesign.fields, listingSlug: v.union(v.string(), v.null()) }),
);
export type DesignView = Infer<typeof designView>;

/** What the APIs say about one URL: its media row's id, size and recipe (all null for a file we don't hold). */
export const mediaDetail = v.object({
  url: v.string(),
  mediaId: v.union(v.id("media"), v.null()),
  kind: v.union(v.literal("image"), v.literal("video"), v.null()),
  width: v.union(v.number(), v.null()),
  height: v.union(v.number(), v.null()),
  durationSec: v.union(v.number(), v.null()),
  design: v.union(designView, v.null()),
});
export type MediaDetail = Infer<typeof mediaDetail>;
