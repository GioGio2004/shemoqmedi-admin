import { v } from "convex/values";
import { action, internalAction, internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { uploadToImageKitFromServer } from "./lib/imagekitServer";
import { categoryName, listingCategories, slugify } from "./lib/listingHelpers";
import { mediaRow, mediaUrl } from "./lib/media";
import { readPillars } from "./lib/scoring";
import { signUpload, vUploadAuth } from "./media";
import { FORMATS, STYLES, TEMPLATES, graphicsQuery, isFormat, isStyle, isTemplate } from "../lib/graphics/spec";
import { PALETTE_IDS } from "../lib/palettes";

// Social post graphics. The pictures are drawn by the admin app's
// /api/graphics routes (satori + sharp; templates in lib/graphics); these
// actions ask for JPEGs and store them on ImageKit so Instagram and the
// rest can fetch them from a public URL.
//
// Convex env:
//   ADMIN_ORIGIN         the admin app, e.g. https://admin.shemoqmedi.space
//   GRAPHICS_RENDER_KEY  shared secret; the same value on the admin app
//   IMAGEKIT_PRIVATE_KEY (already set for the media pipeline)
//
// Called by the MCP tools render_graphic / render_carousel (mcp.ts) and by
// the Studio (renderForPost, and finalUploadAuth + media.registerSocial for a
// JPEG the browser uploads itself).

const FOLDER = "/social/graphics";
const GLASS = ["frost", "liquid", "tint"];
const PALETTES = [...PALETTE_IDS, "auto"];

/** What /api/graphics/carousel?slide=all answers (lib/graphics/render.ts packSlides). */
const SLIDES_CONTENT_TYPE = "application/vnd.shemoqmedi.slides";

function config() {
  const origin = process.env.ADMIN_ORIGIN?.replace(/\/+$/, "");
  const key = process.env.GRAPHICS_RENDER_KEY;
  if (!origin || !key) throw new Error("Graphics rendering needs ADMIN_ORIGIN and GRAPHICS_RENDER_KEY on this Convex deployment.");
  return { origin, key };
}

/** Slides uploaded to ImageKit at once. */
export const CAROUSEL_CONCURRENCY = 4;
/** The whole carousel's render (one request); the route itself stops at 60 s. */
const CAROUSEL_TIMEOUT_MS = 70_000;

/** Runs `fn` over `items` with at most `limit` running at a time; results in input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function fetchJpeg(url: string, key: string, timeoutMs = 90_000) {
  const res = await fetch(url, { headers: { "x-render-key": key }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok || res.headers.get("content-type") !== "image/jpeg") {
    throw new Error(`Rendering failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  return res.blob();
}

function checkOptions(palette: string, glass: string | undefined, style: string | undefined) {
  if (!PALETTES.includes(palette)) throw new Error(`Unknown palette "${palette}". Use one of: ${PALETTES.join(", ")}.`);
  if (glass !== undefined && !GLASS.includes(glass)) throw new Error(`Unknown glass "${glass}". Use one of: ${GLASS.join(", ")}.`);
  if (style !== undefined && !isStyle(style)) throw new Error(`Unknown style "${style}". Use one of: ${STYLES.join(", ")}.`);
}

/**
 * The files of a slide=all response: a 4-byte big-endian header length, the
 * JSON header ({ slides: [{ name, bytes }], width, height, type }), then the
 * files back to back.
 */
export function unpackSlides(body: ArrayBuffer) {
  if (body.byteLength < 4) throw new Error("Empty carousel response.");
  const headerLength = new DataView(body).getUint32(0);
  if (headerLength === 0 || 4 + headerLength > body.byteLength) throw new Error("Malformed carousel response.");
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(body, 4, headerLength))) as {
    slides: { name: string; bytes: number }[];
    width: number;
    height: number;
    type: string;
  };
  const sized = (x: unknown) => Number.isInteger(x) && (x as number) > 0;
  if (!Array.isArray(header.slides) || !header.slides.length || !sized(header.width) || !sized(header.height)) throw new Error("Malformed carousel response.");
  let at = 4 + headerLength;
  const slides = header.slides.map(({ name, bytes }) => {
    if (!Number.isInteger(bytes) || bytes <= 0 || at + bytes > body.byteLength) throw new Error("Malformed carousel response.");
    const blob = new Blob([new Uint8Array(body, at, bytes)], { type: header.type });
    at += bytes;
    return { name, blob };
  });
  return { slides, width: header.width, height: header.height };
}

async function store(ctx: ActionCtx, body: Blob, fileName: string, folder: string, tags: string[], width: number, height: number) {
  const file = await uploadToImageKitFromServer(body, { fileName, folder, tags: ["social", ...tags] });
  const mediaId: Id<"media"> = await ctx.runMutation(internal.media.registerInternal, {
    fileId: file.fileId,
    url: file.url,
    filePath: file.filePath,
    kind: "image",
    contentType: "image/jpeg",
    size: file.size,
    width: file.width ?? width,
    height: file.height ?? height,
  });
  return { url: file.url, mediaId };
}

// ─────────────────────────────────────────────────────────────────────────────
// One graphic
// ─────────────────────────────────────────────────────────────────────────────

const renderArgs = {
  template: v.string(),
  format: v.string(),
  palette: v.string(),
  fields: v.optional(v.record(v.string(), v.string())),
  imageUrls: v.optional(v.array(v.string())),
  glass: v.optional(v.string()),
  style: v.optional(v.string()),
};

type RenderArgs = { template: string; format: string; palette: string; fields?: Record<string, string>; imageUrls?: string[]; glass?: string; style?: string };
type Rendered = { url: string; mediaId: Id<"media">; width: number; height: number };

async function renderOne(ctx: ActionCtx, { template, format, palette, fields = {}, imageUrls = [], glass, style }: RenderArgs): Promise<Rendered> {
  if (!isTemplate(template)) throw new Error(`Unknown template "${template}". Use one of: ${Object.keys(TEMPLATES).join(", ")}.`);
  if (!isFormat(format)) throw new Error(`Unknown format "${format}". Use one of: ${Object.keys(FORMATS).join(", ")}.`);
  checkOptions(palette, glass, style);
  const { origin, key } = config();

  const slots: readonly string[] = TEMPLATES[template].images;
  const images = Object.fromEntries(slots.map((slot, i) => [slot, imageUrls[i]]));
  const query = graphicsQuery({ template, format, palette, style, fields: { ...fields, glass, output: "jpeg" }, images });
  const jpeg = await fetchJpeg(`${origin}/api/graphics?${query}`, key);

  const label = fields.title || fields.headline || fields.site || template;
  const { width, height } = FORMATS[format];
  const name = `shemoqmedi-${slugify(template)}-${slugify(label, "graphic")}-${format}.jpg`;
  const saved = await store(ctx, jpeg, name, FOLDER, [template, format, palette, style ?? "glass"], width, height);
  return { ...saved, width, height };
}

/**
 * Render one graphic (JPEG) and upload it.
 *
 *   template   award | new_listing | call_submissions | call_jury |
 *              announcement | jury_quote | screenshot
 *   format     ig_portrait | square | story | reel_cover | link
 *   palette    a lib/palettes.ts id (house, egypt, night, paper, saperavi,
 *              moss) or "auto" (tinted from the screenshot's own colours)
 *   style      glass (default) | swiss | kinetic | magazine | bento
 *   fields     the template's text fields by key (lib/graphics/spec.ts),
 *              e.g. { tier: "SOTD", title, studio, date, awardSlug, url }
 *   imageUrls  the template's image slots in order: award [screenshot, badge],
 *              the rest [screenshot]. Award badges come from fields.awardSlug,
 *              so a badge URL is rarely needed. Glass calls use the
 *              screenshot only as a blurred backdrop.
 *   glass      frost (default) | liquid | tint   (glass style only)
 */
export const render = internalAction({
  args: renderArgs,
  returns: v.object({ url: v.string(), mediaId: v.id("media"), width: v.number(), height: v.number() }),
  // Return type spelled out: it references `internal`, which would otherwise make the api types circular.
  handler: async (ctx, args): Promise<Rendered> => renderOne(ctx, args),
});

// ─────────────────────────────────────────────────────────────────────────────
// The storytelling carousel
// ─────────────────────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-12" → "12 Nov 2026". */
function displayDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return y && m && d ? `${d} ${MONTHS[m - 1]} ${y}` : day;
}

const factsValidator = v.object({
  slug: v.string(),
  title: v.string(),
  studio: v.string(),
  url: v.string(),
  tagline: v.string(),
  categories: v.array(v.string()),
  tech: v.array(v.string()),
  shots: v.array(v.string()),
  mobile: v.union(v.string(), v.null()),
  award: v.union(v.object({ tier: v.string(), date: v.string(), slug: v.string() }), v.null()),
  score: v.union(v.number(), v.null()),
  pillars: v.union(v.object({ design: v.number(), usability: v.number(), creativity: v.number(), content: v.number() }), v.null()),
  quote: v.union(v.object({ text: v.string(), juror: v.string(), role: v.string() }), v.null()),
});

/** What a listing's carousel says: facts, screenshots, its latest award, the jury. */
export const carouselFacts = internalQuery({
  args: { listingId: v.id("listings") },
  returns: v.union(factsValidator, v.null()),
  handler: async (ctx, { listingId }) => {
    const l = await ctx.db.get(listingId);
    if (!l) return null;
    const ids = [l.coverId, ...(l.galleryIds ?? [])];
    const shots: string[] = [];
    let mobile: string | null = null;
    for (const id of ids) {
      const url = await mediaUrl(ctx, id);
      if (!url) continue;
      const row = await mediaRow(ctx, id);
      // A tall screenshot is the phone view, not a slide of its own.
      if (!mobile && row?.width && row.height && row.height > row.width * 1.3) mobile = url;
      else shots.push(url);
    }
    const awards = await ctx.db
      .query("awards")
      .withIndex("by_listing", (q) => q.eq("listingId", listingId))
      .order("desc")
      .take(10);
    const award = awards.find((a) => a.status === "active") ?? null;
    const evals = await ctx.db
      .query("juryEvaluations")
      .withIndex("by_listing", (q) => q.eq("listingId", listingId))
      .take(50);
    // The quote: the fullest comment that still fits a slide.
    const best = evals
      .filter((e) => e.comment.trim().length >= 20 && e.comment.trim().length <= 300)
      .sort((a, b) => b.comment.length - a.comment.length)[0];
    const juror = best ? await ctx.db.get(best.jurorId) : null;
    return {
      slug: l.slug,
      title: l.title,
      studio: l.creditName,
      url: l.url,
      tagline: l.tagline,
      categories: listingCategories(l).map(categoryName),
      tech: l.technologies,
      shots: shots.slice(0, 4),
      mobile,
      award: award ? { tier: award.tier, date: displayDay(award.date), slug: award.slug } : null,
      score: l.finalScore ?? null,
      pillars: l.editorialScores ? readPillars(l.editorialScores) : null,
      quote: best && juror ? { text: best.comment.trim(), juror: juror.name, role: juror.title } : null,
    };
  },
});

const storyOptions = v.object({
  chips: v.optional(v.array(v.string())),
  notes: v.optional(v.array(v.string())),
  cta: v.optional(v.string()),
  glass: v.optional(v.string()),
  shots: v.optional(v.array(v.string())),
  mobile: v.optional(v.string()),
});

type CarouselArgs = {
  listingId?: Id<"listings">;
  facts?: Record<string, string>;
  palette: string;
  style?: string;
  story?: { chips?: string[]; notes?: string[]; cta?: string; glass?: string; shots?: string[]; mobile?: string };
};
type Carousel = { urls: string[]; mediaIds: Id<"media">[]; slides: string[] };

/** The carousel, plus the slide size the renderer reported (for renderForPost). */
async function renderStory(ctx: ActionCtx, { listingId, facts = {}, palette, style, story = {} }: CarouselArgs): Promise<Carousel & { width: number; height: number }> {
  checkOptions(palette, story.glass, style);
  if (!listingId && !facts.title) throw new Error("Give a listingId, or facts with at least a title.");
  const { origin, key } = config();

  const base = listingId ? await ctx.runQuery(internal.graphics.carouselFacts, { listingId }) : null;
  if (listingId && !base) throw new Error("Listing not found.");

  const q = new URLSearchParams({ palette, output: "jpeg" });
  if (story.glass) q.set("glass", story.glass);
  if (style && style !== "glass") q.set("style", style);
  const put = (k: string, value: string | number | null | undefined) => {
    if (value !== null && value !== undefined && String(value).trim()) q.set(k, String(value));
  };
  if (base) {
    put("title", base.title);
    put("studio", base.studio);
    put("url", base.url);
    put("tagline", base.tagline);
    put("slug", base.slug);
    put("tech", base.tech.join(","));
    put("categories", base.categories.join(","));
    if (base.award) {
      put("tier", base.award.tier);
      put("date", base.award.date);
      put("awardSlug", base.award.slug);
    }
    put("score", base.score);
    if (base.pillars) for (const [k, value] of Object.entries(base.pillars)) put(k, value);
    if (base.quote) {
      put("quote", base.quote.text);
      put("juror", base.quote.juror);
      put("role", base.quote.role);
    }
  }
  for (const [k, value] of Object.entries(facts)) put(k, value);
  for (const shot of story.shots ?? base?.shots ?? []) q.append("shot", shot);
  put("mobile", story.mobile ?? base?.mobile ?? null);
  for (const chip of story.chips ?? []) q.append("chip", chip);
  for (const note of story.notes ?? []) q.append("note", note);
  put("cta", story.cta);

  // One request renders every slide (the admin app builds the backdrop and
  // prepares each picture once) and answers with all of them in one body.
  q.set("slide", "all");
  const res = await fetch(`${origin}/api/graphics/carousel?${q}`, { headers: { "x-render-key": key }, signal: AbortSignal.timeout(CAROUSEL_TIMEOUT_MS) });
  if (!res.ok || res.headers.get("content-type") !== SLIDES_CONTENT_TYPE) {
    throw new Error(`Rendering the carousel failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const { slides, width, height } = unpackSlides(await res.arrayBuffer());

  const label = slugify(q.get("title") ?? "carousel", "carousel");
  const folder = `/social/carousels/${label}-${Date.now().toString(36)}`;
  const saved = await mapLimit(slides, CAROUSEL_CONCURRENCY, ({ name, blob }, i) =>
    store(ctx, blob, `shemoqmedi-${label}-${String(i + 1).padStart(2, "0")}-${name}.jpg`, folder, ["carousel", name, palette, style ?? "glass"], width, height),
  );
  return { urls: saved.map((s) => s.url), mediaIds: saved.map((s) => s.mediaId), slides: slides.map((s) => s.name), width, height };
}

/**
 * Render the storytelling Instagram carousel (5–8 JPEG slides, 1080×1350)
 * and upload every slide. Give a `listingId` to take the facts from the
 * database, `facts` to override or supply them (keys: title, studio, url,
 * tagline, kicker, date, tier, awardSlug, score, design, usability,
 * creativity, content, quote, juror, role, tech, categories, link, cta), or
 * both.
 *
 *   style         glass (default) | swiss | kinetic | magazine | bento
 *   story.chips   one-line chips for the detail slides ("The type", "The grid")
 *   story.notes   a sentence under each detail
 *   story.cta     the last slide's headline
 *   story.glass   frost (default) | liquid | tint
 *   story.shots   screenshot URLs to use instead of the listing's
 *   story.mobile  a tall (phone) screenshot URL
 */
export const renderCarousel = internalAction({
  args: {
    listingId: v.optional(v.id("listings")),
    facts: v.optional(v.record(v.string(), v.string())),
    palette: v.string(),
    style: v.optional(v.string()),
    story: v.optional(storyOptions),
  },
  returns: v.object({ urls: v.array(v.string()), mediaIds: v.array(v.id("media")), slides: v.array(v.string()) }),
  handler: async (ctx, args): Promise<Carousel> => {
    const { urls, mediaIds, slides } = await renderStory(ctx, args);
    return { urls, mediaIds, slides };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// The Studio (admin session)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Admin: the final graphic for a post (the Studio's "Render final"). The
 * same arguments as render; with `carousel: true` the storytelling carousel
 * instead, of `listingId` and/or `fields` (as facts), with `imageUrls` as its
 * screenshots when given. Always a list: one URL per image.
 */
export const renderForPost = action({
  args: { ...renderArgs, carousel: v.optional(v.boolean()), listingId: v.optional(v.id("listings")) },
  returns: v.object({ urls: v.array(v.string()), mediaIds: v.array(v.id("media")), width: v.number(), height: v.number() }),
  handler: async (ctx, { carousel, listingId, ...args }): Promise<{ urls: string[]; mediaIds: Id<"media">[]; width: number; height: number }> => {
    await ctx.runQuery(internal.users.assertAdmin, {});
    if (carousel) {
      const story = await renderStory(ctx, {
        listingId,
        facts: args.fields,
        palette: args.palette,
        style: args.style,
        story: { glass: args.glass, ...(args.imageUrls?.length ? { shots: args.imageUrls } : {}) },
      });
      return { urls: story.urls, mediaIds: story.mediaIds, width: story.width, height: story.height };
    }
    const one = await renderOne(ctx, args);
    return { urls: [one.url], mediaIds: [one.mediaId], width: one.width, height: one.height };
  },
});

/**
 * Admin: signed parameters for the browser to upload a final JPEG straight
 * to ImageKit (into `folder`, /social/graphics); media.registerSocial then
 * records it. The private key never leaves Convex.
 */
export const finalUploadAuth = action({
  args: {},
  returns: v.object({ ...vUploadAuth.fields, folder: v.string() }),
  handler: async (ctx) => {
    await ctx.runQuery(internal.users.assertAdmin, {});
    return { ...(await signUpload()), folder: FOLDER };
  },
});
