import type { NextRequest } from "next/server";
import { FORMAT_IDS, STYLES, TEMPLATE_IDS, isFormat, isStyle, isTemplate } from "@/lib/graphics/spec";
import { badgeUrlFor, fieldsFrom, renderSingle } from "@/lib/graphics/render";
import { PALETTE_CHOICES, authorized, bad, imageResponse, parseGlass, parseOutput } from "@/lib/graphics/server";

// GET /api/graphics?template=award&format=ig_portrait&palette=egypt&style=swiss&title=…
// Renders one social post graphic (lib/graphics).
//
//   template  award | new_listing | call_submissions | call_jury |
//             announcement | jury_quote | screenshot   (lib/graphics/spec.ts)
//   format    ig_portrait 1080×1350 | square 1080×1080 | story 1080×1920 |
//             reel_cover 1080×1920 | link 1200×627
//   style     glass (default) | swiss | kinetic | magazine | bento
//   palette   lib/palettes.ts id, or "auto" (from the screenshot's colours)
//   glass     frost (default) | liquid | tint   (the glass style's treatment)
//   output    jpeg (default; Instagram and LinkedIn want JPEG) | png
//   …fields   the template's text fields, by key (title, studio, headline, …)
//   …images   the template's image slots, by name (screenshot, badge): URLs
//             on our own hosts only (ImageKit, Convex, R2, the storefront)
//
// In glass the screenshot is both the sharp picture in the browser window and
// the blurred backdrop; without one the backdrop is a soft palette gradient.
// The award badge comes from the storefront (/badge/<awardSlug>) unless a
// `badge` URL is given. Images that can't be fetched are left out, never an
// error.
//
// Access: the header x-render-key = GRAPHICS_RENDER_KEY (convex/graphics.ts),
// or a signed-in platform admin (the Studio). proxy.ts lets this route through
// without a session so the key path works.
//
// Next door: /api/graphics/carousel (the storytelling carousel) and
// /api/graphics/assets (the Studio's instant preview).

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!(await authorized(request))) return bad("Unauthorized", 401);

  const q = request.nextUrl.searchParams;
  const template = q.get("template");
  const format = q.get("format") ?? "ig_portrait";
  const palette = q.get("palette") ?? "house";
  const style = q.get("style") ?? "glass";
  if (!isTemplate(template)) return bad(`Unknown template. Use one of: ${TEMPLATE_IDS.join(", ")}`);
  if (!isFormat(format)) return bad(`Unknown format. Use one of: ${FORMAT_IDS.join(", ")}`);
  if (!isStyle(style)) return bad(`Unknown style. Use one of: ${STYLES.join(", ")}`);
  if (!PALETTE_CHOICES.includes(palette)) return bad(`Unknown palette. Use one of: ${PALETTE_CHOICES.join(", ")}`);
  const output = parseOutput(q.get("output"));
  const fields = fieldsFrom(template, q);

  try {
    const bytes = await renderSingle({
      template,
      format,
      palette,
      style,
      glass: parseGlass(q.get("glass")),
      fields,
      screenshot: q.get("screenshot"),
      badgeUrl: template === "award" ? badgeUrlFor(fields.awardSlug, q.get("badge")) : null,
      output,
    });
    const ext = output === "jpeg" ? "jpg" : "png";
    return imageResponse(bytes, output, `shemoqmedi-${template}-${format}.${ext}`);
  } catch (error) {
    console.error("graphics render failed:", error instanceof Error ? error.stack : error);
    return bad("Failed to render the graphic", 500);
  }
}
