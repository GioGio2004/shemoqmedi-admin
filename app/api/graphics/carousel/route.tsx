import type { NextRequest } from "next/server";
import { STOREFRONT_URL } from "@/lib/storefront";
import { asDataUri, cropDetail, fetchImage, joinHorizontally, picture, rasterDataUri, region, type Picture } from "@/lib/graphics/imaging";
import {
  DETAIL_TILES,
  DETAIL_ZOOM,
  PHONE,
  SLIDE_H,
  SLIDE_W,
  storyPlan,
  storySlide,
  type StoryAssets,
  type StoryFacts,
} from "@/lib/graphics/story";
import { TIERS } from "@/lib/graphics/spec";
import {
  PALETTE_CHOICES,
  authorized,
  backdropFor,
  bad,
  finish,
  imageResponse,
  parseGlass,
  parseOutput,
  renderPng,
  resolvePalette,
} from "@/lib/graphics/server";

// GET /api/graphics/carousel?slide=0&title=…&shot=<url>&shot=<url>…
// One slide of the storytelling Instagram carousel (1080×1350), or the whole
// strip side by side with slide=strip (for previews and contact sheets).
//
//   slide     0-based index, "strip", or "plan" (JSON: the slide kinds)
//   palette   lib/palettes.ts id or "auto" (from the first screenshot)
//   glass     frost (default) | liquid | tint
//   output    jpeg (default) | png
//   scale     strip only: 0.1–1 (default 0.5)
//   facts     title, studio, url, tagline, kicker, date, tier, awardSlug,
//             score, design, usability, creativity, content, quote, juror,
//             role, tech (comma list), categories (comma list), link, cta,
//             chip (repeat, one per detail), note (repeat)
//   images    shot (repeat; the first is the hero), mobile (a tall
//             screenshot), badge (else the storefront badge for awardSlug)
//
// Same access as /api/graphics: an admin session or x-render-key.

export const runtime = "nodejs";
export const maxDuration = 60;

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

function factsFrom(q: URLSearchParams): StoryFacts {
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

async function loadStory(q: URLSearchParams) {
  const facts = factsFrom(q);
  const shotUrls = q.getAll("shot").slice(0, 4);
  const awardSlug = (q.get("awardSlug") ?? "").trim();
  const badgeUrl =
    q.get("badge") || (/^[a-z0-9-]{3,120}$/.test(awardSlug) ? `${STOREFRONT_URL}/badge/${awardSlug}?shape=seal&theme=light` : null);
  const [pics, mobile, badgeBuf] = await Promise.all([
    Promise.all(shotUrls.map(async (u) => picture(await fetchImage(u)))).then((p) => p.filter((x): x is Picture => !!x)),
    fetchImage(q.get("mobile")).then(picture),
    fetchImage(badgeUrl),
  ]);
  const plan = storyPlan(facts, { details: Math.max(1, pics.length), mobile: !!mobile && mobile.height > mobile.width });
  return { facts, pics, mobile, badgeBuf, plan };
}

/** Which picture shows through the backdrop behind each slide. */
function backdropLayers(plan: ReturnType<typeof storyPlan>, pics: Picture[]) {
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

async function renderSlide(
  index: number,
  ctx: Awaited<ReturnType<typeof loadStory>> & { palette: Awaited<ReturnType<typeof resolvePalette>>; backdrop: Awaited<ReturnType<typeof backdropFor>>; glass: ReturnType<typeof parseGlass> },
) {
  const { plan, pics, mobile, badgeBuf, facts, palette, backdrop, glass } = ctx;
  const view = { x: index * SLIDE_W, y: 0, w: SLIDE_W, h: SLIDE_H };
  const near = (kind: string) => plan.some((p, k) => p === kind && Math.abs(k - index) <= 1);
  const detailsNear = plan
    .map((p, k) => ({ p, k }))
    .filter((x) => x.p === "detail")
    .map((x, d) => ({ d, near: Math.abs(x.k - index) <= 1 }));

  const [back, frost, hero, details, mobileSrc, badge] = await Promise.all([
    region(backdrop, "back", { left: view.x, top: 0, width: SLIDE_W, height: SLIDE_H }),
    region(backdrop, "frost", { left: view.x, top: 0, width: SLIDE_W, height: SLIDE_H }),
    near("site") ? asDataUri(pics[0] ?? null, 1400) : null,
    Promise.all(
      detailsNear.map(({ d, near }) => {
        if (!near) return null;
        const tile = DETAIL_TILES[d % DETAIL_TILES.length];
        const pic = pics[Math.min(pics.length - 1, 1 + d)] ?? null;
        const samePicAsFirst = d > 0 && pic === (pics[Math.min(pics.length - 1, 1)] ?? null);
        return cropDetail(pic, (tile.w - 26) * 1.4, (tile.h - 26) * 1.4, DETAIL_ZOOM[d % DETAIL_ZOOM.length], samePicAsFirst ? { x: 0.7, y: 0.62 } : undefined);
      }),
    ),
    near("mobile") ? asDataUri(mobile, PHONE.w * 1.6) : null,
    near("hook") ? rasterDataUri(badgeBuf, 520) : null,
  ]);
  const assets: StoryAssets = { back, frost, hero, details, mobile: mobileSrc, badge };
  const scene = { palette, light: backdrop.luminance > 0.55, frost, view, style: glass };
  return renderPng(storySlide({ plan, index, scene, facts, assets }), SLIDE_W, SLIDE_H);
}

export async function GET(request: NextRequest) {
  if (!(await authorized(request))) return bad("Unauthorized", 401);
  const q = request.nextUrl.searchParams;
  const paletteId = q.get("palette") ?? "auto";
  if (!PALETTE_CHOICES.includes(paletteId)) return bad(`Unknown palette. Use one of: ${PALETTE_CHOICES.join(", ")}`);
  const glass = parseGlass(q.get("glass"));
  const output = parseOutput(q.get("output"));

  const story = await loadStory(q);
  const slideParam = q.get("slide") ?? "0";
  if (slideParam === "plan") return Response.json({ slides: story.plan });

  const palette = await resolvePalette(paletteId, story.pics[0] ?? null);
  const n = story.plan.length;
  const backdrop = await backdropFor(glass, palette, n * SLIDE_W, SLIDE_H, backdropLayers(story.plan, story.pics));
  const ctx = { ...story, palette, backdrop, glass };

  try {
    if (slideParam === "strip") {
      const scale = Math.max(0.1, Math.min(1, Number(q.get("scale") ?? "0.5") || 0.5));
      const slides = await Promise.all(story.plan.map((_, i) => renderSlide(i, ctx).then((png) => finish(png, "png"))));
      const strip = await joinHorizontally(slides, SLIDE_W, SLIDE_H);
      const sharp = (await import("sharp")).default;
      const scaled = await sharp(strip).resize(Math.round(n * SLIDE_W * scale)).toBuffer();
      return imageResponse(await finish(scaled, output, false), output);
    }
    const index = Number(slideParam);
    if (!Number.isInteger(index) || index < 0 || index >= n) return bad(`slide must be 0–${n - 1}, "strip" or "plan"`);
    const png = await renderSlide(index, ctx);
    return imageResponse(await finish(png, output), output, `slide-${index + 1}.${output === "jpeg" ? "jpg" : "png"}`);
  } catch (error) {
    console.error("carousel render failed:", error instanceof Error ? error.stack : error);
    return bad("Failed to render the carousel", 500);
  }
}
