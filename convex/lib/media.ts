import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { r2PublicUrl } from "./r2";

// A listing's screenshot / video is either a file in Convex storage (older
// uploads, the importer) or a file registered in the `media` table: an
// ImageKit file (screenshots, older videos) or an R2 object (videos). Both are plain document ids, so the listing
// fields, ordering and comparisons work the same for either kind.

export const vMediaId = v.union(v.id("_storage"), v.id("media"));
export type MediaId = Id<"_storage"> | Id<"media">;

/** The `media` row behind an id, or null when the id is a Convex storage file. */
export async function mediaRow(ctx: QueryCtx, id: MediaId) {
  const mediaId = ctx.db.normalizeId("media", id);
  return mediaId ? await ctx.db.get(mediaId) : null;
}

/** Public URL of a screenshot or video, whichever store it lives in. */
export async function mediaUrl(ctx: QueryCtx, id: MediaId): Promise<string | null> {
  const mediaId = ctx.db.normalizeId("media", id);
  if (mediaId) {
    const row = await ctx.db.get(mediaId);
    return row && !row.invalid ? rowUrl(row) : null;
  }
  const storageId = ctx.db.system.normalizeId("_storage", id);
  return storageId ? await ctx.storage.getUrl(storageId) : null;
}

/** Public URL of a media row. R2 rows follow R2_PUBLIC_URL, so the bucket's domain can change. */
export function rowUrl(row: Doc<"media">) {
  return row.store === "r2" ? (r2PublicUrl(row.fileId) ?? row.url) : row.url;
}

/** Type and size of an uploaded file, or null if it does not exist (or failed checks). */
export async function mediaInfo(
  ctx: QueryCtx,
  id: MediaId,
): Promise<{ contentType: string; size: number } | null> {
  const mediaId = ctx.db.normalizeId("media", id);
  if (mediaId) {
    const row = await ctx.db.get(mediaId);
    return row && !row.invalid ? { contentType: row.contentType, size: row.size } : null;
  }
  const storageId = ctx.db.system.normalizeId("_storage", id);
  const meta = storageId ? await ctx.db.system.get(storageId) : null;
  return meta ? { contentType: meta.contentType ?? "", size: meta.size } : null;
}

/** Delete a screenshot or video: the Convex file, or the media row + the ImageKit / R2 file. */
export async function deleteMedia(ctx: MutationCtx, id: MediaId) {
  const mediaId = ctx.db.normalizeId("media", id);
  if (mediaId) {
    const row = await ctx.db.get(mediaId);
    if (!row) return;
    await ctx.db.delete(mediaId);
    if (row.store === "r2") await ctx.scheduler.runAfter(0, internal.media.deleteR2, { keys: [row.fileId] });
    else await ctx.scheduler.runAfter(0, internal.media.deleteRemote, { fileIds: [row.fileId] });
    return;
  }
  const storageId = ctx.db.system.normalizeId("_storage", id);
  if (storageId) await ctx.storage.delete(storageId);
}

/**
 * A video length the browser reported, in seconds (2 decimals), or undefined
 * when it isn't a usable number. Stored on media rows for the story check
 * (socialApi.storyProblem).
 */
export function cleanDuration(seconds: number | undefined) {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0 || seconds > 24 * 60 * 60) return undefined;
  return Math.round(seconds * 100) / 100;
}
