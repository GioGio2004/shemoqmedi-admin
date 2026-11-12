import type { NextRequest } from "next/server";
import { STOREFRONT_URL } from "@/lib/storefront";
import { FORMATS, FORMAT_IDS, TEMPLATES, TEMPLATE_IDS, isFormat, isTemplate } from "@/lib/graphics/spec";
import { renderTemplate, shotWidth } from "@/lib/graphics/templates";
import { asDataUri, fetchImage, picture, rasterDataUri, region } from "@/lib/graphics/imaging";
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

// GET /api/graphics?template=award&format=ig_portrait&palette=egypt&title=…
// Renders one social post graphic in the glass style (lib/graphics).
//
//   template  award | new_listing | call_submissions | call_jury |
//             announcement | jury_quote | screenshot   (lib/graphics/spec.ts)
//   format    ig_portrait 1080×1350 | square 1080×1080 | story 1080×1920 |
//             reel_cover 1080×1920 | link 1200×627
//   palette   lib/palettes.ts id, or "auto" (from the screenshot's colours)
//   glass     frost (default) | liquid | tint
//   output    jpeg (default; Instagram and LinkedIn want JPEG) | png
//   …fields   the template's text fields, by key (title, studio, headline, …)
//   …images   the template's image slots, by name (screenshot, badge): URLs
//             on our own hosts only (ImageKit, Convex, R2, the storefront)
//
// The screenshot is both the sharp picture in the browser window and the
// blurred backdrop; without one the backdrop is a soft palette gradient. The
// award badge comes from the storefront (/badge/<awardSlug>) unless a `badge`
// URL is given. Images that can't be fetched are left out, never an error.
//
// Access: a signed-in platform admin (the Design page), or the header
// x-render-key = GRAPHICS_RENDER_KEY (convex/graphics.ts). proxy.ts lets this
// route through without a session so the key path works.
//
// The carousel lives next door: /api/graphics/carousel.

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!(await authorized(request))) return bad("Unauthorized", 401);

  const q = request.nextUrl.searchParams;
  const template = q.get("template");
  const format = q.get("format") ?? "ig_portrait";
  const paletteId = q.get("palette") ?? "house";
  if (!isTemplate(template)) return bad(`Unknown template. Use one of: ${TEMPLATE_IDS.join(", ")}`);
  if (!isFormat(format)) return bad(`Unknown format. Use one of: ${FORMAT_IDS.join(", ")}`);
  if (!PALETTE_CHOICES.includes(paletteId)) return bad(`Unknown palette. Use one of: ${PALETTE_CHOICES.join(", ")}`);
  const glass = parseGlass(q.get("glass"));
  const output = parseOutput(q.get("output"));

  const spec = TEMPLATES[template];
  const fields: Record<string, string> = { ...spec.defaults };
  for (const key of [...spec.fields.map((f) => f.key), "kicker"]) {
    const value = q.get(key)?.trim();
    if (value) fields[key] = value.slice(0, 600);
  }

  const { width, height } = FORMATS[format];
  try {
    const awardSlug = fields.awardSlug ?? "";
    const badgeUrl =
      template === "award"
        ? q.get("badge") || (/^[a-z0-9-]{3,120}$/.test(awardSlug) ? `${STOREFRONT_URL}/badge/${awardSlug}?shape=seal&theme=light` : null)
        : null;
    const [shot, badgeBuf] = await Promise.all([fetchImage(q.get("screenshot")).then(picture), fetchImage(badgeUrl)]);

    const palette = await resolvePalette(paletteId, shot);
    const backdrop = await backdropFor(glass, palette, width, height, shot ? [{ pic: shot, from: 0, to: 1 }] : []);
    const full = { left: 0, top: 0, width, height };
    const [back, frost, shotSrc, badge] = await Promise.all([
      region(backdrop, "back", full),
      region(backdrop, "frost", full),
      spec.images.includes("screenshot" as never) && template !== "call_submissions" && template !== "call_jury" && template !== "announcement" && template !== "jury_quote"
        ? asDataUri(shot, shotWidth(format))
        : null,
      rasterDataUri(badgeBuf, 480),
    ]);
    const scene = { palette, light: backdrop.luminance > 0.55, frost, view: { x: 0, y: 0, w: width, h: height }, style: glass };
    const png = await renderPng(renderTemplate({ template, format, scene, fields, assets: { back, shot: shotSrc, badge } }), width, height);
    const ext = output === "jpeg" ? "jpg" : "png";
    return imageResponse(await finish(png, output), output, `shemoqmedi-${template}-${format}.${ext}`);
  } catch (error) {
    console.error("graphics render failed:", error instanceof Error ? error.stack : error);
    return bad("Failed to render the graphic", 500);
  }
}
