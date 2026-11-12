import type { ReactElement } from "react";
import { STOREFRONT_URL } from "@/lib/storefront";
import type { Palette } from "@/lib/palettes";
import { FORMATS, TEMPLATES, TIERS, type FormatId, type Style, type TemplateId } from "./spec";
import type { GlassStyle, PanelShape, Scene } from "./glass";
import { renderTemplate, shotWidth as glassShotWidth } from "./templates";
import { DETAIL_TILES, DETAIL_ZOOM, PHONE, SLIDE_H, SLIDE_W, storyPlan, storySlide, type SlideKind, type StoryAssets, type StoryFacts } from "./story";
import { FLAT_STYLES, themeOf } from "./styles";
import {
  asDataUri,
  cropDetail,
  fetchImage,
  fetchPicture,
  glassLayer,
  joinHorizontally,
  rasterDataUri,
  region,
  type Backdrop,
  type OutputType,
  type Picture,
} from "./imaging";
import { backdropFor, finish, renderPng, resolvePalette } from "./server";
import { resolve } from "./tree";
import { timer, type Timer } from "./timing";

// The render pipeline behind the graphics routes (server only: sharp + satori).
//
// Glass draws in two layers. sharp prepares the backdrop window with the
// frost already laid in under every panel (one raster, imaging.glassLayer);
// satori draws everything else on a transparent canvas; finish() puts the
// two together with the grain in a single encode. The flat styles are one
// satori render and one encode.

/** The storefront's badge art for an award slug (a seal on a light ground). */
export function badgeUrlFor(awardSlug: string | undefined, explicit?: string | null) {
  if (explicit) return explicit;
  return awardSlug && /^[a-z0-9-]{3,120}$/.test(awardSlug) ? `${STOREFRONT_URL}/badge/${awardSlug}?shape=seal&theme=light` : null;
}

/** Templates whose glass layout shows the screenshot sharp (the rest use it only as the blurred backdrop). */
function glassShowsShot(template: TemplateId) {
  return template === "award" || template === "new_listing" || template === "screenshot";
}

/**
 * Satori → PNG, with the glass panels' outlines collected on the way: the
 * element is resolved first (tree.ts), which is when each Glass registers.
 */
async function drawGlass(element: ReactElement, panels: PanelShape[], backdrop: Backdrop, view: { x: number; y: number; w: number; h: number }, t: Timer) {
  const resolved = resolve(element) as ReactElement;
  const [png, under] = await Promise.all([
    renderPng(resolved, view.w, view.h),
    glassLayer(backdrop, { left: view.x, top: view.y, width: view.w, height: view.h }, panels),
  ]);
  t.mark("draw");
  return { png, under };
}

export type SingleOptions = {
  template: TemplateId;
  format: FormatId;
  /** A palette id or "auto". */
  palette: string;
  style: Style;
  glass: GlassStyle;
  fields: Record<string, string>;
  screenshot: string | null;
  badgeUrl: string | null;
  output: OutputType;
};

/** One finished graphic (JPEG or PNG bytes). */
export async function renderSingle(o: SingleOptions): Promise<Buffer> {
  const t = timer(`${o.template}/${o.format}/${o.style}`);
  const { width, height } = FORMATS[o.format];
  const wantsBadge = o.template === "award";
  const [shot, badgeBuf] = await Promise.all([fetchPicture(o.screenshot), wantsBadge ? fetchImage(o.badgeUrl) : null]);
  t.mark("fetch");
  const palette = await resolvePalette(o.palette, shot);
  const badge = await rasterDataUri(badgeBuf, 480);

  if (o.style === "glass") {
    const backdrop = await backdropFor(o.glass, palette, width, height, shot ? [{ pic: shot, from: 0, to: 1 }] : []);
    const shotSrc = glassShowsShot(o.template) ? await asDataUri(shot, glassShotWidth(o.format)) : null;
    t.mark("prepare");
    const panels: PanelShape[] = [];
    const view = { x: 0, y: 0, w: width, h: height };
    const scene: Scene = { palette, light: backdrop.luminance > 0.55, frost: null, view, style: o.glass, layer: "shared", panels };
    const element = renderTemplate({ template: o.template, format: o.format, scene, fields: o.fields, assets: { back: null, shot: shotSrc, badge } });
    const { png, under } = await drawGlass(element, panels, backdrop, view, t);
    const out = await finish(png, o.output, { under });
    t.mark("encode");
    t.done();
    return out;
  }

  const kit = FLAT_STYLES[o.style];
  const shotSrc = await asDataUri(shot, kit.shotWidth(o.format));
  t.mark("prepare");
  const png = await renderPng(kit.single({ template: o.template, format: o.format, fields: o.fields, theme: themeOf(palette), shot: shotSrc, badge }), width, height);
  t.mark("draw");
  const out = await finish(png, o.output, { grain: kit.grain });
  t.mark("encode");
  t.done();
  return out;
}

/** A template's fields from a query string, with its defaults for the empty ones. */
export function fieldsFrom(template: TemplateId, q: URLSearchParams) {
  const spec = TEMPLATES[template];
  const fields: Record<string, string> = { ...spec.defaults };
  for (const key of [...spec.fields.map((f) => f.key), "kicker"]) {
    const value = q.get(key)?.trim();
    if (value) fields[key] = value.slice(0, 600);
  }
  return fields;
}

// ─────────────────────────────────────────────────────────────────────────────
// The storytelling carousel
// ─────────────────────────────────────────────────────────────────────────────

function list(v: string | null) {
  return (v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function num(v: string | null) {
  const n = v === null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? Math.round(Math.max(0, Math.min(10, n)) * 10) / 10 : null;
}

/** The carousel's facts from a query string (see app/api/graphics/carousel). */
export function factsFrom(q: URLSearchParams): StoryFacts {
  const t = (k: string, max = 400) => (q.get(k) ?? "").trim().slice(0, max);
  const tier = t("tier", 8);
  const pillars = ["design", "usability", "creativity", "content"].map((k) => num(q.get(k)));
  const slug = t("slug", 120);
  return {
    title: t("title", 120) || "Untitled",
    studio: t("studio", 80) || "Studio",
    url: t("url", 200),
    tagline: t("tagline", 260),
    kicker: t("kicker", 60) || (tier in TIERS ? TIERS[tier as keyof typeof TIERS] : "New on Shemoqmedi"),
    date: t("date", 40),
    tier,
    score: num(q.get("score")),
    pillars: pillars.every((p) => p !== null)
      ? { design: pillars[0]!, usability: pillars[1]!, creativity: pillars[2]!, content: pillars[3]! }
      : null,
    quote: t("quote", 320),
    juror: t("juror", 80),
    role: t("role", 80),
    tech: list(q.get("tech")).slice(0, 8),
    categories: list(q.get("categories")).slice(0, 3),
    link: t("link", 120) || (slug ? `shemoqmedi.space/sites/${slug}` : "shemoqmedi.space"),
    chips: q.getAll("chip").map((c) => c.trim().slice(0, 32)),
    notes: q.getAll("note").map((c) => c.trim().slice(0, 140)),
    ctaHeadline: t("cta", 90) || "See the whole site on Shemoqmedi.",
  };
}

export type StoryOptions = {
  facts: StoryFacts;
  shots: string[];
  mobile: string | null;
  badgeUrl: string | null;
  palette: string;
  style: Style;
  glass: GlassStyle;
};

export type Story = Awaited<ReturnType<typeof loadStory>>;

/** Pictures, plan and palette of a carousel: fetched once, shared by every slide. */
export async function loadStory(o: StoryOptions) {
  const [pics, mobile, badgeBuf] = await Promise.all([
    Promise.all(o.shots.slice(0, 4).map((u) => fetchPicture(u))).then((p) => p.filter((x): x is Picture => !!x)),
    fetchPicture(o.mobile),
    fetchImage(o.badgeUrl),
  ]);
  const plan = storyPlan(o.facts, { details: Math.max(1, pics.length), mobile: !!mobile && mobile.height > mobile.width });
  const palette = await resolvePalette(o.palette, pics[0] ?? null);
  return { ...o, pics, mobile, badgeBuf, plan, palette };
}

/** Which picture shows through the glass backdrop behind each slide. */
function backdropLayers(plan: SlideKind[], pics: Picture[]) {
  if (!pics.length) return [];
  const n = plan.length;
  let detail = 0;
  const perSlide = plan.map((kind) => {
    if (kind === "detail") return pics[Math.min(pics.length - 1, 1 + detail++)];
    if (kind === "jury" || kind === "mobile") return pics[Math.min(pics.length - 1, 2)];
    return pics[0];
  });
  const layers: { pic: Picture; from: number; to: number }[] = [];
  perSlide.forEach((pic, k) => {
    const last = layers[layers.length - 1];
    if (last && last.pic === pic) last.to = (k + 1) / n;
    else layers.push({ pic, from: k / n, to: (k + 1) / n });
  });
  return layers;
}

function once<T>(make: () => Promise<T>) {
  let p: Promise<T> | null = null;
  return () => (p ??= make());
}

/** The story's pictures, each prepared on first use and shared by every slide that shows it. */
function storyPictures(story: Story) {
  const { pics, mobile, badgeBuf, style } = story;
  const sizes = style === "glass" ? null : FLAT_STYLES[style].slidePictures;
  const details = new Map<number, () => Promise<string | null>>();
  return {
    hero: once(() => asDataUri(pics[0] ?? null, sizes?.hero ?? 1400)),
    mobile: once(() => asDataUri(mobile, sizes?.mobile ?? PHONE.w * 1.6)),
    badge: once(() => rasterDataUri(badgeBuf, 520)),
    detail(d: number) {
      if (!details.has(d)) {
        details.set(
          d,
          once(() => {
            const pic = pics[Math.min(pics.length - 1, 1 + d)] ?? null;
            // A second detail of the same picture looks somewhere else.
            const samePic = d > 0 && pic === (pics[Math.min(pics.length - 1, 1)] ?? null);
            const focus = samePic ? { x: 0.7, y: 0.62 } : undefined;
            if (sizes) {
              const { w, h, zoom } = sizes.detail(d);
              return cropDetail(pic, w * 1.25, h * 1.25, zoom, focus);
            }
            const tile = DETAIL_TILES[d % DETAIL_TILES.length];
            return cropDetail(pic, (tile.w - 26) * 1.4, (tile.h - 26) * 1.4, DETAIL_ZOOM[d % DETAIL_ZOOM.length], focus);
          }),
        );
      }
      return details.get(d)!();
    },
  };
}

/** Assets for slide `index`: only the pictures this slide (or a neighbour bleeding into it) shows. */
async function slideAssets(story: Story, pictures: ReturnType<typeof storyPictures>, index: number, glass: boolean): Promise<StoryAssets> {
  const { plan } = story;
  // Glass slides also draw the slide before them when it bleeds across the seam (story.tsx).
  const shown = (k: number) => k === index || (glass && k === index - 1);
  const has = (kind: SlideKind) => plan.some((p, k) => p === kind && shown(k));
  const detailSlots = plan.flatMap((p, k) => (p === "detail" ? [k] : []));
  const [hero, details, mobile, badge] = await Promise.all([
    has("site") ? pictures.hero() : null,
    Promise.all(detailSlots.map((k, d) => (shown(k) ? pictures.detail(d) : null))),
    has("mobile") ? pictures.mobile() : null,
    has("hook") ? pictures.badge() : null,
  ]);
  return { back: null, frost: null, hero, details, mobile, badge };
}

/** Slides rendered at once in one request: satori is single-threaded, sharp works alongside it. */
const SLIDE_CONCURRENCY = 3;

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * The finished slides `indices` (all of them by default), in order. The
 * glass panorama backdrop is built once (and cached across requests), each
 * picture is prepared once, and only the visible slide is laid out.
 */
export async function renderSlides(story: Story, output: OutputType, indices = story.plan.map((_, i) => i), grainOverride?: boolean): Promise<Buffer[]> {
  const t = timer(`carousel/${story.style}/${indices.length === story.plan.length ? "all" : indices.join(",")}`);
  const pictures = storyPictures(story);
  const n = story.plan.length;

  if (story.style === "glass") {
    const backdrop = await backdropFor(story.glass, story.palette, n * SLIDE_W, SLIDE_H, backdropLayers(story.plan, story.pics));
    const light = backdrop.luminance > 0.55;
    t.mark("backdrop");
    const slides = await mapLimit(indices, SLIDE_CONCURRENCY, async (index) => {
      const assets = await slideAssets(story, pictures, index, true);
      const panels: PanelShape[] = [];
      const view = { x: index * SLIDE_W, y: 0, w: SLIDE_W, h: SLIDE_H };
      const scene: Scene = { palette: story.palette, light, frost: null, view, style: story.glass, layer: "shared", panels };
      const element = storySlide({ plan: story.plan, index, scene, facts: story.facts, assets });
      const resolved = resolve(element) as ReactElement;
      const [png, under] = await Promise.all([
        renderPng(resolved, SLIDE_W, SLIDE_H),
        glassLayer(backdrop, { left: view.x, top: 0, width: SLIDE_W, height: SLIDE_H }, panels),
      ]);
      return finish(png, output, { under, grain: grainOverride ?? true });
    });
    t.mark("slides");
    t.done();
    return slides;
  }

  const kit = FLAT_STYLES[story.style];
  const theme = themeOf(story.palette);
  const slides = await mapLimit(indices, SLIDE_CONCURRENCY, async (index) => {
    const assets = await slideAssets(story, pictures, index, false);
    const png = await renderPng(kit.slide({ plan: story.plan, index, facts: story.facts, theme, assets }), SLIDE_W, SLIDE_H);
    return finish(png, output, { grain: grainOverride ?? kit.grain });
  });
  t.mark("slides");
  t.done();
  return slides;
}

/** Every slide side by side at `scale`, for previews and contact sheets. */
export async function renderStrip(story: Story, scale: number, output: OutputType) {
  const slides = await renderSlides(story, "png", undefined, false);
  const strip = await joinHorizontally(slides, SLIDE_W, SLIDE_H);
  const sharp = (await import("sharp")).default;
  const scaled = await sharp(strip).resize(Math.round(slides.length * SLIDE_W * scale)).toBuffer();
  return finish(scaled, output, { grain: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// Slides on the wire: one response, every JPEG
// ─────────────────────────────────────────────────────────────────────────────

export const SLIDES_CONTENT_TYPE = "application/vnd.shemoqmedi.slides";

/**
 * Several files in one body: a 4-byte big-endian length, a JSON header
 * ({ slides: [{ name, bytes }], width, height, type }), then the files back
 * to back. Smaller than base64 JSON (Vercel caps a response at 4.5 MB) and
 * trivial to read in a Convex action (convex/graphics.ts unpackSlides).
 */
export function packSlides(files: Buffer[], names: string[], meta: { width: number; height: number; type: string }) {
  const header = Buffer.from(JSON.stringify({ ...meta, slides: files.map((f, i) => ({ name: names[i], bytes: f.length })) }));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  return Buffer.concat([length, header, ...files]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Preview assets (the Studio's instant preview)
// ─────────────────────────────────────────────────────────────────────────────

export type PreviewAssets = {
  palette: Pick<Palette, "base" | "surface" | "accent">;
  /** Glass: the backdrop is light (dark text, milkier panels). */
  light: boolean;
  /** Glass backdrop and frost for the format, small (the browser stretches them; they are blurred anyway). */
  back: string;
  frost: string;
  /** The screenshot, ready to draw. Empty when none was given or it could not be fetched. */
  shot: string;
};

const previews = new Map<string, Promise<PreviewAssets>>();

/** What the browser needs to draw a graphic the way the server will: palette, glass layers, screenshot. */
export function previewAssets(o: { shot: string | null; palette: string; glass: GlassStyle; format: FormatId }): Promise<PreviewAssets> {
  const key = [o.shot ?? "", o.palette, o.glass, o.format].join("|");
  const hit = previews.get(key);
  if (hit) return hit;
  const made = (async () => {
    const t = timer(`assets/${o.format}`);
    const shot = await fetchPicture(o.shot);
    const palette = await resolvePalette(o.palette, shot);
    const { width, height } = FORMATS[o.format];
    const backdrop = await backdropFor(o.glass, palette, width, height, shot ? [{ pic: shot, from: 0, to: 1 }] : []);
    const full = { left: 0, top: 0, width, height };
    const [back, frost, shotSrc] = await Promise.all([region(backdrop, "back", full, 0.25), region(backdrop, "frost", full, 0.25), asDataUri(shot, 1300)]);
    t.mark("build");
    t.done();
    return { palette: { base: palette.base, surface: palette.surface, accent: palette.accent }, light: backdrop.luminance > 0.55, back, frost, shot: shotSrc ?? "" };
  })();
  previews.set(key, made);
  made.catch(() => previews.delete(key));
  if (previews.size > 32) previews.delete(previews.keys().next().value!);
  return made;
}
