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

/** Platform admins (and super admins) may attach and delete any file. */
export function isAdminUser(user: Doc<"users">) {
  return user.role === "admin" || user.role === "super_admin";
}

/**
 * Who is asking for a file to be attached or deleted: a signed-in user, or
 * "server" for internal functions and CLI scripts (trusted like an admin).
 */
export type MediaActor = Doc<"users"> | "server";

function trusted(by: MediaActor) {
  return by === "server" || isAdminUser(by);
}

/**
 * The ids among `ids` that a listing (cover, screenshots, video) or a juror
 * (photo) still points at. Callers detach the file from their own document
 * first, so anything left here belongs to someone else.
 */
export async function mediaStillUsed(ctx: QueryCtx, ids: MediaId[]): Promise<Set<string>> {
  const wanted = new Set<string>(ids);
  const used = new Set<string>();
  if (!wanted.size) return used;
  const mark = (id: string | undefined) => {
    if (id && wanted.has(id)) used.add(id);
  };
  for await (const l of ctx.db.query("listings")) {
    mark(l.coverId);
    for (const g of l.galleryIds ?? []) mark(g);
    mark(l.videoId);
    if (used.size === wanted.size) return used;
  }
  for await (const j of ctx.db.query("jurors")) mark(j.avatarId);
  return used;
}

/**
 * Delete screenshots or videos: the Convex file, or the media row + the
 * ImageKit / R2 file. A file another listing or juror still points at is
 * kept, and when a non-admin triggers the delete (an owner withdrawing their
 * listing) a media row is only deleted if that user uploaded it: media ids
 * used to be attachable by anyone (audit C-01), so a listing can point at a
 * file it doesn't own.
 */
export async function deleteMediaMany(ctx: MutationCtx, ids: MediaId[], by: MediaActor) {
  const unique = [...new Set(ids)];
  const used = await mediaStillUsed(ctx, unique);
  for (const id of unique) {
    if (used.has(id)) continue;
    const mediaId = ctx.db.normalizeId("media", id);
    if (mediaId) {
      const row = await ctx.db.get(mediaId);
      if (!row) continue;
      if (!trusted(by) && row.uploadedBy !== (by as Doc<"users">)._id) continue;
      await ctx.db.delete(mediaId);
      if (row.store === "r2") await ctx.scheduler.runAfter(0, internal.media.deleteR2, { keys: [row.fileId] });
      else await ctx.scheduler.runAfter(0, internal.media.deleteRemote, { fileIds: [row.fileId] });
      continue;
    }
    const storageId = ctx.db.system.normalizeId("_storage", id);
    if (storageId) await ctx.storage.delete(storageId);
  }
}

/** Delete one screenshot or video (see deleteMediaMany for what is kept). */
export async function deleteMedia(ctx: MutationCtx, id: MediaId, by: MediaActor) {
  await deleteMediaMany(ctx, [id], by);
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
