import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { uploadToImageKitFromServer } from "./lib/imagekitServer";
import { slugify } from "./lib/listingHelpers";
import { FORMATS, TEMPLATES, graphicsQuery, isFormat, isTemplate } from "../lib/graphics/spec";
import { PALETTE_IDS } from "../lib/palettes";

// Social post graphics. The pictures are drawn by the admin app's
// /api/graphics route (satori; templates in lib/graphics); this action asks
// it for a PNG and stores the result on ImageKit so Postiz, Instagram and
// the rest can fetch it from a public URL.
//
// Convex env:
//   ADMIN_ORIGIN         the admin app, e.g. https://admin.shemoqmedi.space
//   GRAPHICS_RENDER_KEY  shared secret; the same value on the admin app
//   IMAGEKIT_PRIVATE_KEY (already set for the media pipeline)
//
// Called by the MCP tool render_graphic (workstream 5).

const FOLDER = "/social/graphics";

/**
 * Render one graphic and upload it.
 *
 *   template   award | new_listing | call_submissions | call_jury |
 *              announcement | jury_quote | screenshot
 *   format     ig_portrait | square | story | link
 *   palette    a lib/palettes.ts id (house, egypt, night, paper, saperavi, moss)
 *   fields     the template's text fields by key (lib/graphics/spec.ts),
 *              e.g. { tier: "SOTD", title, studio, date, awardSlug, url }
 *   imageUrls  the template's image slots in order: award [screenshot, badge],
 *              new_listing / jury_quote / screenshot [screenshot]. Award badges
 *              come from fields.awardSlug, so a badge URL is rarely needed.
 */
export const render = internalAction({
  args: {
    template: v.string(),
    format: v.string(),
    palette: v.string(),
    fields: v.optional(v.record(v.string(), v.string())),
    imageUrls: v.optional(v.array(v.string())),
  },
  returns: v.object({ url: v.string(), mediaId: v.id("media") }),
  // Return type spelled out: it references `internal`, which would otherwise make the api types circular.
  handler: async (ctx, { template, format, palette, fields = {}, imageUrls = [] }): Promise<{ url: string; mediaId: Id<"media"> }> => {
    if (!isTemplate(template)) throw new Error(`Unknown template "${template}". Use one of: ${Object.keys(TEMPLATES).join(", ")}.`);
    if (!isFormat(format)) throw new Error(`Unknown format "${format}". Use one of: ${Object.keys(FORMATS).join(", ")}.`);
    if (!(PALETTE_IDS as string[]).includes(palette)) throw new Error(`Unknown palette "${palette}". Use one of: ${PALETTE_IDS.join(", ")}.`);

    const origin = process.env.ADMIN_ORIGIN?.replace(/\/+$/, "");
    const key = process.env.GRAPHICS_RENDER_KEY;
    if (!origin || !key) throw new Error("Graphics rendering needs ADMIN_ORIGIN and GRAPHICS_RENDER_KEY on this Convex deployment.");

    const slots: readonly string[] = TEMPLATES[template].images;
    const images = Object.fromEntries(slots.map((slot, i) => [slot, imageUrls[i]]));
    const query = graphicsQuery({ template, format, palette, fields, images });

    const res = await fetch(`${origin}/api/graphics?${query}`, {
      headers: { "x-render-key": key },
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok || res.headers.get("content-type") !== "image/png") {
      throw new Error(`Rendering failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const png = await res.blob();

    const label = fields.title || fields.headline || fields.site || template;
    const fileName = `shemoqmedi-${slugify(template)}-${slugify(label, "graphic")}-${format}.png`;
    const file = await uploadToImageKitFromServer(png, {
      fileName,
      folder: FOLDER,
      tags: ["social", template, format, palette],
    });

    const { width, height } = FORMATS[format];
    const mediaId = await ctx.runMutation(internal.media.registerInternal, {
      fileId: file.fileId,
      url: file.url,
      filePath: file.filePath,
      kind: "image",
      contentType: "image/png",
      size: file.size,
      width: file.width ?? width,
      height: file.height ?? height,
    });
    return { url: file.url, mediaId };
  },
});
