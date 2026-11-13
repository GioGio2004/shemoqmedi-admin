// How the APIs describe media rows: their role (from where they were stored),
// folder, size and design recipe. Shared by the MCP tools (mcp.ts list_media,
// find_reel, get_post) and the Studio's queries (media.ts, social.ts get).

import { v } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { MEDIA_ROLES, type MediaRole } from "../../lib/mediaRoles";
import { rowUrl } from "./media";
import { designView, type DesignView, type MediaDetail } from "./design";

export const mediaRole = v.union(...MEDIA_ROLES.map((r) => v.literal(r)));

/**
 * What a media row is, from where it was stored:
 *   /social/graphics/…               graphic   (render_graphic, Studio renders and uploads)
 *   /social/carousels/<label>-<id>/  carousel  (render_carousel slides)
 *   /social/<slug>/<slug>-reel-….mp4 reel      (built on the Voiceover page, R2)
 *   /listings/<slug>/…               screenshot (image) or preview (video)
 */
export function roleOf(row: Pick<Doc<"media">, "filePath" | "kind">): MediaRole {
  const path = row.filePath;
  if (path.startsWith("/social/graphics/")) return "graphic";
  if (path.startsWith("/social/carousels/")) return "carousel";
  if (/^\/social\/[a-z0-9-]+\/[a-z0-9_-]*-reel-[a-z0-9_-]+\.mp4$/.test(path) && row.kind === "video") return "reel";
  if (path.startsWith("/listings/")) return row.kind === "video" ? "preview" : "screenshot";
  return "other";
}

/** The folder of a file path ("/social/graphics/a.jpg" → "/social/graphics"). */
export function folderOf(filePath: string) {
  const cut = filePath.lastIndexOf("/");
  return cut > 0 ? filePath.slice(0, cut) : "/";
}

export const mediaEntry = v.object({
  id: v.id("media"),
  kind: v.union(v.literal("image"), v.literal("video")),
  role: mediaRole,
  url: v.string(),
  folder: v.string(),
  contentType: v.string(),
  size: v.number(),
  width: v.union(v.number(), v.null()),
  height: v.union(v.number(), v.null()),
  createdAt: v.number(),
});

export function mediaEntryOf(row: Doc<"media">) {
  return {
    id: row._id,
    kind: row.kind,
    role: roleOf(row),
    url: rowUrl(row),
    folder: folderOf(row.filePath),
    contentType: row.contentType,
    size: row.size,
    width: row.width ?? null,
    height: row.height ?? null,
    createdAt: row.createdAt,
  };
}

/** A media entry with its recipe (null when it has none: a screenshot, an upload, a render from before recipes). */
export const mediaEntryWithDesign = v.object({ ...mediaEntry.fields, design: v.union(designView, v.null()) });

/** A row's recipe as the APIs return it (a carousel's listing also by slug). */
export async function designViewOf(ctx: QueryCtx, row: Doc<"media">): Promise<DesignView | null> {
  const d = row.design;
  if (!d) return null;
  if (d.kind === "graphic" || d.kind === "reel") return d;
  const listing = d.listingId ? await ctx.db.get(d.listingId) : null;
  return { ...d, listingSlug: listing?.slug ?? null };
}

/** The media row behind a URL: a valid one first, one with a recipe first among those. */
export async function rowByUrl(ctx: QueryCtx, url: string) {
  const rows = (await ctx.db
    .query("media")
    .withIndex("by_url", (q) => q.eq("url", url))
    .take(10)).filter((r) => !r.invalid);
  return rows.find((r) => r.design) ?? rows[0] ?? null;
}

/** Id, size and recipe of each URL, in order (nulls for a URL we don't hold: an outside link, an older Convex file). */
export async function mediaDetails(ctx: QueryCtx, urls: readonly string[]): Promise<MediaDetail[]> {
  return await Promise.all(
    urls.map(async (url) => {
      const row = await rowByUrl(ctx, url);
      return {
        url,
        mediaId: row?._id ?? null,
        kind: row?.kind ?? null,
        width: row?.width ?? null,
        height: row?.height ?? null,
        durationSec: row?.durationSec ?? null,
        design: row ? await designViewOf(ctx, row) : null,
      };
    }),
  );
}
