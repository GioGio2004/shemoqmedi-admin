import type { NextRequest } from "next/server";
import { SLIDE_H, SLIDE_W } from "@/lib/graphics/story";
import { STYLES, isStyle } from "@/lib/graphics/spec";
import { SLIDES_CONTENT_TYPE, badgeUrlFor, factsFrom, loadStory, packSlides, renderSlides, renderStrip } from "@/lib/graphics/render";
import { PALETTE_CHOICES, authorized, bad, imageResponse, parseGlass, parseOutput } from "@/lib/graphics/server";

// GET /api/graphics/carousel?slide=all&title=…&shot=<url>&shot=<url>…
// The storytelling Instagram carousel (1080×1350 slides).
//
//   slide     "all" (every slide in one response, see below), a 0-based
//             index, "strip" (side by side, for previews), or "plan" (JSON:
//             the slide kinds)
//   style     glass (default) | swiss | kinetic | magazine | bento
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
// slide=all answers application/vnd.shemoqmedi.slides: a 4-byte length, a
// JSON header ({ slides: [{ name, bytes }], width, height, type }), then the
// files back to back (render.ts packSlides). Convex makes this one call
// instead of one per slide, and the backdrop and pictures are prepared once.
//
// Same access as /api/graphics: x-render-key or an admin session.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!(await authorized(request))) return bad("Unauthorized", 401);
  const q = request.nextUrl.searchParams;
  const palette = q.get("palette") ?? "auto";
  const style = q.get("style") ?? "glass";
  if (!PALETTE_CHOICES.includes(palette)) return bad(`Unknown palette. Use one of: ${PALETTE_CHOICES.join(", ")}`);
  if (!isStyle(style)) return bad(`Unknown style. Use one of: ${STYLES.join(", ")}`);
  const output = parseOutput(q.get("output"));

  try {
    const story = await loadStory({
      facts: factsFrom(q),
      shots: q.getAll("shot"),
      mobile: q.get("mobile"),
      badgeUrl: badgeUrlFor((q.get("awardSlug") ?? "").trim(), q.get("badge")),
      palette,
      style,
      glass: parseGlass(q.get("glass")),
    });
    const slideParam = q.get("slide") ?? "0";
    if (slideParam === "plan") return Response.json({ slides: story.plan });

    const n = story.plan.length;
    if (slideParam === "strip") {
      const scale = Math.max(0.1, Math.min(1, Number(q.get("scale") ?? "0.5") || 0.5));
      return imageResponse(await renderStrip(story, scale, output), output);
    }
    if (slideParam === "all") {
      const files = await renderSlides(story, output);
      const type = output === "jpeg" ? "image/jpeg" : "image/png";
      const body = packSlides(files, story.plan, { width: SLIDE_W, height: SLIDE_H, type });
      return new Response(new Uint8Array(body), { headers: { "Content-Type": SLIDES_CONTENT_TYPE, "Cache-Control": "no-store" } });
    }
    const index = Number(slideParam);
    if (!Number.isInteger(index) || index < 0 || index >= n) return bad(`slide must be 0–${n - 1}, "all", "strip" or "plan"`);
    const [file] = await renderSlides(story, output, [index]);
    return imageResponse(file, output, `slide-${index + 1}.${output === "jpeg" ? "jpg" : "png"}`);
  } catch (error) {
    console.error("carousel render failed:", error instanceof Error ? error.stack : error);
    return bad("Failed to render the carousel", 500);
  }
}
