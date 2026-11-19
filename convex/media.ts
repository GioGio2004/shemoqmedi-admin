import { ConvexError, v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireAdmin, requireUser } from "./authHelpers";
import { LIMITS } from "./lib/taxonomy";
import { assertMedia, fail, slugify } from "./lib/listingHelpers";
import { cleanDuration, deleteMedia, isAdminUser, mediaUrl, vMediaId, type MediaActor, type MediaId } from "./lib/media";
import { R2_LISTING_KEY, deleteObject, headObject, presignPut, r2Configured, r2PublicUrl } from "./lib/r2";
import { mediaDesign, mediaDetail } from "./lib/design";
import { UPLOAD_V2_URL, safeSegment, signUploadParams, uploadChecks } from "./lib/imagekitSign";
import { designViewOf, mediaDetails, mediaEntryOf, mediaEntryWithDesign, roleOf } from "./lib/mediaEntry";

// Media pipeline. Screenshots go to ImageKit, preview videos to Cloudflare R2.
//
// ImageKit re-encodes every new video it delivers (once per browser
// format), which burns the free plan's 500 video processing units in a few
// uploads. R2 serves the file exactly as uploaded, so videos are compressed
// in the browser first (lib/videoUpload.ts) and stored on R2 (lib/r2.ts):
// videoUploadUrl → browser PUT → registerVideo → verifyVideo.
//
// ImageKit (screenshots):
//
//   1. The browser converts screenshots to WebP and names files for SEO
//      (lib/imagekitUpload.ts in both apps).
//   2. uploadAuth signs a direct browser → ImageKit upload (the private key
//      never leaves Convex).
//   3. register records the uploaded file and returns an Id<"media"> that
//      listing mutations accept exactly like a Convex storage id.
//   4. verify re-checks the file with ImageKit's API; a file that is not
//      what the browser claimed is deleted and flagged invalid.
//
// Convex env (dev and prod): IMAGEKIT_PRIVATE_KEY, IMAGEKIT_PUBLIC_KEY,
// IMAGEKIT_URL_ENDPOINT (e.g. https://ik.imagekit.io/shemoqmedi).

export const IMAGE_TYPES = ["image/webp", "image/png", "image/jpeg"];
const VIDEO_TYPES = ["video/mp4", "video/webm"];

function env(name: "IMAGEKIT_PRIVATE_KEY" | "IMAGEKIT_PUBLIC_KEY" | "IMAGEKIT_URL_ENDPOINT") {
  const value = process.env[name];
  if (!value) throw new ConvexError("Image uploads are not configured yet. Please try again later.");
  return value.replace(/\/+$/, "");
}

function authHeader() {
  return `Basic ${btoa(`${env("IMAGEKIT_PRIVATE_KEY")}:`)}`;
}


/** The largest preview video a user may store: 1080p (40 MB) for admins, 720p (15 MB) for everyone else. */
function videoCapFor(user: Pick<Doc<"users">, "role">) {
  return user.role === "admin" || user.role === "super_admin" ? LIMITS.videoBytesAdmin : LIMITS.videoBytes;
}

function checkLimits(kind: "image" | "video", contentType: string, size: number, videoCap: number = LIMITS.videoBytes) {
  if (kind === "image") {
    if (!IMAGE_TYPES.includes(contentType) || size > LIMITS.imageBytes) {
      throw new ConvexError("Screenshots must be images of 5 MB or less.");
    }
  } else if (!VIDEO_TYPES.includes(contentType) || size > videoCap) {
    throw new ConvexError(`The preview video must be an MP4 or WebM of ${Math.round(videoCap / 1024 / 1024)} MB or less.`);
  }
}

export const vUploadAuth = v.object({
  token: v.string(),
  uploadUrl: v.string(),
  params: v.object({
    fileName: v.string(),
    folder: v.string(),
    useUniqueFileName: v.literal("true"),
    overwriteFile: v.literal("false"),
    tags: v.string(),
    checks: v.string(),
  }),
});

const EXTENSIONS: Record<string, string> = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" };

/**
 * A v2 signed upload (lib/imagekitSign.ts): the folder, file name, no
 * overwrite and the size/type checks are inside the signature, so the
 * browser can only send the bytes (audit C-02).
 */
export async function signUpload(args: { fileName: string; folder: string; tags: string; types: readonly string[] }) {
  const { token, params } = await signUploadParams(
    { fileName: args.fileName, folder: args.folder, tags: args.tags, checks: uploadChecks(LIMITS.imageBytes, args.types) },
    { privateKey: env("IMAGEKIT_PRIVATE_KEY"), publicKey: env("IMAGEKIT_PUBLIC_KEY") },
  );
  return { token, params, uploadUrl: UPLOAD_V2_URL };
}

/** The file name and folder a listing screenshot gets: /listings/<site>/<site>-website-<label>.<ext>. */
export function listingUploadTarget(site: string, label: string, contentType: string) {
  const ext = EXTENSIONS[contentType];
  if (!ext) throw new ConvexError("Screenshots must be WebP, PNG or JPEG images.");
  const slug = safeSegment(site, "site");
  return { fileName: `${slug}-website-${safeSegment(label, "image", 40)}.${ext}`, folder: `/listings/${slug}`, tags: `listing,${slug},image` };
}

/** Signed parameters for one direct browser → ImageKit screenshot upload (valid 10 minutes). */
export const uploadAuth = action({
  args: { site: v.string(), label: v.string(), contentType: v.string() },
  returns: vUploadAuth,
  handler: async (ctx, { site, label, contentType }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Please log in to upload.");
    await ctx.runMutation(internal.rateLimits.hit, { name: "imageUpload" });
    return await signUpload({ ...listingUploadTarget(site, label, contentType), types: IMAGE_TYPES });
  },
});

/**
 * Registering a file that already has a row hands back that row only to the
 * user who uploaded it (or an admin). Anyone else gets an error, not the id:
 * the id is what listing mutations attach, and withdrawing a listing deletes
 * its files, so someone else's id would let a stranger delete them (audit
 * C-01). No second row is made either, since deleting it would delete the
 * same ImageKit / R2 file.
 */
function reuseOwn(existing: Doc<"media">, user: Doc<"users">) {
  if (existing.uploadedBy === user._id || isAdminUser(user)) return existing._id;
  throw new ConvexError("That upload did not come from this site. Please upload it again.");
}

/** Record a finished ImageKit upload (screenshots only); returns the id listing mutations take. */
export const register = mutation({
  args: {
    fileId: v.string(),
    url: v.string(),
    filePath: v.string(),
    kind: v.union(v.literal("image"), v.literal("video")),
    contentType: v.string(),
    size: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  returns: v.id("media"),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const endpoint = env("IMAGEKIT_URL_ENDPOINT");
    // Only files in our own account and folder (no hot-linking any URL).
    if (!args.url.startsWith(`${endpoint}/listings/`) || !args.filePath.startsWith("/listings/")) {
      throw new ConvexError("That upload did not come from this site. Please upload it again.");
    }
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(args.fileId)) throw new ConvexError("Invalid upload.");
    // Videos go to R2 (videoUploadUrl): an ImageKit video costs processing units.
    if (args.kind === "video") throw new ConvexError("Videos now upload a different way. Reload the page and try again.");
    checkLimits(args.kind, args.contentType, args.size);
    const existing = await ctx.db
      .query("media")
      .withIndex("by_fileId", (q) => q.eq("fileId", args.fileId))
      .first();
    if (existing) return reuseOwn(existing, user);
    const id = await ctx.db.insert("media", {
      ...args,
      uploadedBy: user._id,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.media.verify, { id, fileId: args.fileId, kind: args.kind });
    return id;
  },
});

/** Where the Studio's final renders live on ImageKit (graphics.finalUploadAuth signs uploads there). */
export const SOCIAL_FOLDER = "/social/graphics/";

/**
 * Admin: record a final social graphic the Studio uploaded straight to
 * ImageKit (graphics.finalUploadAuth → browser upload to /social/graphics):
 * a JPEG the browser rendered (with its `design` recipe) or an image the
 * admin picked from the device (no recipe). Only JPEG or PNG files of 5 MB
 * or less in that folder of our own account; verified against ImageKit
 * afterwards like any other upload. Registering the same file again returns
 * its id (and adds the recipe when the row had none).
 */
export const registerSocial = mutation({
  args: {
    url: v.string(),
    fileId: v.string(),
    filePath: v.string(),
    size: v.number(),
    width: v.number(),
    height: v.number(),
    contentType: v.string(),
    design: v.optional(mediaDesign),
  },
  returns: v.id("media"),
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx);
    const endpoint = env("IMAGEKIT_URL_ENDPOINT");
    if (!args.url.startsWith(`${endpoint}${SOCIAL_FOLDER}`) || !args.filePath.startsWith(SOCIAL_FOLDER)) {
      throw new ConvexError("That file is not in the social graphics folder. Render it again.");
    }
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(args.fileId)) throw new ConvexError("Invalid upload.");
    if (args.contentType !== "image/jpeg" && args.contentType !== "image/png") throw new ConvexError("Social graphics are JPEG or PNG files.");
    if (!(args.width > 0 && args.height > 0 && args.width <= 4096 && args.height <= 4096)) throw new ConvexError("Invalid image size.");
    checkLimits("image", args.contentType, args.size);
    const existing = await ctx.db
      .query("media")
      .withIndex("by_fileId", (q) => q.eq("fileId", args.fileId))
      .first();
    if (existing) {
      if (args.design && !existing.design) await ctx.db.patch(existing._id, { design: args.design });
      return existing._id;
    }
    const id = await ctx.db.insert("media", { ...args, kind: "image", uploadedBy: user._id, createdAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.media.verify, { id, fileId: args.fileId, kind: "image", folder: SOCIAL_FOLDER });
    return id;
  },
});

/** Double-check a registered file against ImageKit (real size, type, path; listings unless `folder` says otherwise). */
export const verify = internalAction({
  args: {
    id: v.id("media"),
    fileId: v.string(),
    kind: v.union(v.literal("image"), v.literal("video")),
    folder: v.optional(v.union(v.literal("/listings/"), v.literal(SOCIAL_FOLDER))),
  },
  returns: v.null(),
  handler: async (ctx, { id, fileId, kind, folder = "/listings/" }) => {
    const res = await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}/details`, {
      headers: { Authorization: authHeader() },
    });
    if (res.status >= 500) throw new Error(`ImageKit details HTTP ${res.status}`);
    let ok = res.ok;
    if (ok) {
      const file = (await res.json()) as { size?: number; mime?: string; filePath?: string };
      try {
        checkLimits(kind, file.mime ?? "", file.size ?? Infinity);
        ok = (file.filePath ?? "").startsWith(folder);
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      await ctx.runMutation(internal.media.markInvalid, { id });
      if (res.ok) {
        await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}`, {
          method: "DELETE",
          headers: { Authorization: authHeader() },
        });
      }
    }
    return null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Preview videos on R2
// ─────────────────────────────────────────────────────────────────────────────

/** A presigned URL for one direct browser → R2 video upload (valid 15 minutes). */
export const videoUploadUrl = action({
  args: { site: v.string(), label: v.string(), contentType: v.string(), size: v.number() },
  returns: v.object({ uploadUrl: v.string(), key: v.string() }),
  handler: async (ctx, { site, label, contentType, size }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Please log in to upload.");
    if (!r2Configured()) throw new ConvexError("Video uploads are not configured yet. Please try again later.");
    await ctx.runMutation(internal.rateLimits.hit, { name: "videoUpload" });
    checkLimits("video", contentType, size, await ctx.runQuery(internal.media.myVideoCap, {}));
    const slug = slugify(site);
    const ext = contentType === "video/webm" ? "webm" : "mp4";
    // Random suffix: a replaced video never reuses a cached URL, and keys cannot be guessed.
    const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    const key = `listings/${slug}/${slug}-website-${slugify(label, "preview")}-${suffix}.${ext}`;
    return { uploadUrl: await presignPut(key, 15 * 60, { contentType, size }), key };
  },
});

/** The signed-in user's preview-video size limit (videoCapFor). */
export const myVideoCap = internalQuery({
  args: {},
  returns: v.number(),
  handler: async (ctx) => videoCapFor(await requireUser(ctx)),
});

/** Record a finished R2 video upload; returns the id listing mutations take. */
export const registerVideo = mutation({
  args: {
    key: v.string(),
    contentType: v.string(),
    size: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationSec: v.optional(v.number()),
  },
  returns: v.id("media"),
  handler: async (ctx, { key, contentType, size, width, height, durationSec }) => {
    const user = await requireUser(ctx);
    if (!R2_LISTING_KEY.test(key)) throw new ConvexError("That upload did not come from this site. Please upload it again.");
    const cap = videoCapFor(user);
    checkLimits("video", contentType, size, cap);
    const existing = await ctx.db
      .query("media")
      .withIndex("by_fileId", (q) => q.eq("fileId", key))
      .first();
    if (existing) return reuseOwn(existing, user);
    const url = r2PublicUrl(key);
    if (!url) throw new ConvexError("Video uploads are not configured yet. Please try again later.");
    const id = await ctx.db.insert("media", {
      store: "r2",
      fileId: key,
      url,
      filePath: `/${key}`,
      kind: "video",
      contentType,
      size,
      width,
      height,
      durationSec: cleanDuration(durationSec),
      uploadedBy: user._id,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.media.verifyVideo, { id, key, maxBytes: cap });
    return id;
  },
});

/** Double-check a registered video against R2 (it exists, real size and type). */
export const verifyVideo = internalAction({
  args: { id: v.id("media"), key: v.string(), maxBytes: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { id, key, maxBytes }) => {
    const file = await headObject(key); // throws (and retries) on R2 errors
    let ok = !!file;
    if (file) {
      try {
        checkLimits("video", file.contentType.split(";")[0].trim(), file.size, maxBytes ?? LIMITS.videoBytes);
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      await ctx.runMutation(internal.media.markInvalid, { id });
      if (file) await deleteObject(key);
    }
    return null;
  },
});

/** Delete videos from R2 (after a listing or its video is removed). */
export const deleteR2 = internalAction({
  args: { keys: v.array(v.string()) },
  returns: v.null(),
  handler: async (_ctx, { keys }) => {
    for (const key of keys) {
      try {
        await deleteObject(key);
      } catch (err) {
        console.error(String(err));
      }
    }
    return null;
  },
});

export const markInvalid = internalMutation({
  args: { id: v.id("media") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) await ctx.db.patch(id, { invalid: true });
    return null;
  },
});

/** Delete files from ImageKit (after a listing or a screenshot is removed). */
export const deleteRemote = internalAction({
  args: { fileIds: v.array(v.string()) },
  returns: v.null(),
  handler: async (_ctx, { fileIds }) => {
    for (const fileId of fileIds) {
      const res = await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}`, {
        method: "DELETE",
        headers: { Authorization: authHeader() },
      });
      if (!res.ok && res.status !== 404) console.error(`ImageKit delete ${fileId}: HTTP ${res.status}`);
    }
    return null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Moving older Convex-storage files to ImageKit (admin overview button).
// The browser downloads each old file, runs it through the same pipeline
// (WebP + SEO name + ImageKit), registers it, then calls adoptLegacy.
// ─────────────────────────────────────────────────────────────────────────────

const legacyItem = v.object({
  id: v.id("_storage"),
  role: v.union(v.literal("cover"), v.literal("screenshot"), v.literal("video")),
  /** 1 = cover, 2+ = extra screenshots (for the SEO file name). */
  position: v.number(),
  url: v.string(),
});

const legacyListing = v.object({
  listingId: v.id("listings"),
  slug: v.string(),
  title: v.string(),
  items: v.array(legacyItem),
});

/** Admin: every listing that still has files in Convex storage. */
export const legacyFiles = query({
  args: {},
  returns: v.array(legacyListing),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await collectLegacy(ctx);
  },
});

/** CLI (scripts/media-to-imagekit.mjs): same list, no user session. */
export const legacyFilesInternal = internalQuery({
  args: {},
  returns: v.array(legacyListing),
  handler: async (ctx) => collectLegacy(ctx),
});

async function collectLegacy(ctx: QueryCtx) {
    const listings = await ctx.db.query("listings").take(1000);
    const out = [];
    for (const l of listings) {
      const slots: { id: typeof l.coverId; role: "cover" | "screenshot" | "video"; position: number }[] = [
        { id: l.coverId, role: "cover", position: 1 },
        ...(l.galleryIds ?? []).map((id, i) => ({ id, role: "screenshot" as const, position: i + 2 })),
        ...(l.videoId ? [{ id: l.videoId, role: "video" as const, position: 0 }] : []),
      ];
      const items = [];
      for (const slot of slots) {
        const storageId = ctx.db.system.normalizeId("_storage", slot.id);
        if (!storageId) continue;
        const url = await mediaUrl(ctx, storageId);
        if (url) items.push({ id: storageId, role: slot.role, position: slot.position, url });
      }
      if (items.length) out.push({ listingId: l._id, slug: l.slug, title: l.title, items });
    }
    return out;
}

/** Put `to` wherever `from` sits on a listing (cover, gallery or video), checking its type. */
async function swapOnListing(ctx: MutationCtx, listing: Doc<"listings">, from: MediaId, to: MediaId, by: MediaActor) {
  if (listing.coverId === from) {
    await assertMedia(ctx, to, "Cover screenshot", "image", by);
    await ctx.db.patch(listing._id, { coverId: to, updatedAt: Date.now() });
  } else if (listing.galleryIds?.includes(from)) {
    await assertMedia(ctx, to, "Screenshot", "image", by);
    await ctx.db.patch(listing._id, {
      galleryIds: listing.galleryIds.map((g) => (g === from ? to : g)),
      updatedAt: Date.now(),
    });
  } else if (listing.videoId === from) {
    await assertMedia(ctx, to, "Preview video", "video", by);
    await ctx.db.patch(listing._id, { videoId: to, updatedAt: Date.now() });
  } else {
    fail("That file is no longer on this listing. Reload and try again.");
  }
}

const serverFile = v.object({
  store: v.optional(v.literal("r2")),
  fileId: v.string(),
  url: v.string(),
  filePath: v.string(),
  kind: v.union(v.literal("image"), v.literal("video")),
  contentType: v.string(),
  size: v.number(),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
});

/**
 * Record an ImageKit file uploaded server-side (importer, CLI, graphics.ts
 * renders with their `design` recipe); no user session.
 */
export const registerInternal = internalMutation({
  args: { ...serverFile.fields, design: v.optional(mediaDesign) },
  returns: v.id("media"),
  handler: async (ctx, args) => {
    checkLimits(args.kind, args.contentType, args.size);
    const existing = await ctx.db
      .query("media")
      .withIndex("by_fileId", (q) => q.eq("fileId", args.fileId))
      .first();
    if (existing) {
      if (args.design && !existing.design) await ctx.db.patch(existing._id, { design: args.design });
      return existing._id;
    }
    return await ctx.db.insert("media", { ...args, createdAt: Date.now() });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Design recipes and recent renders (the Studio's post editor)
// ─────────────────────────────────────────────────────────────────────────────

/** At most this many URLs per designs call (a post has at most 10 media). */
export const DESIGNS_MAX = 50;

/**
 * Admin: id, size and design recipe of each URL, in the order given (one
 * entry per URL; mediaId, sizes and design null for a file we don't hold).
 * The recipe says how the graphic was rendered (convex/lib/design.ts).
 */
export const designs = query({
  args: { urls: v.array(v.string()) },
  returns: v.array(mediaDetail),
  handler: async (ctx, { urls }) => {
    await requireAdmin(ctx);
    if (urls.length > DESIGNS_MAX) fail(`At most ${DESIGNS_MAX} URLs at once.`);
    return await mediaDetails(ctx, urls);
  },
});

/** How far back recentRenders looks (newest rows first); the media table has no role index. */
const RENDER_SCAN = 2000;

/**
 * Admin: rendered and uploaded social images, newest first (role graphic:
 * /social/graphics, which holds renders and Studio uploads; role carousel:
 * carousel slides), each with its recipe or null. Never invalid files or
 * videos. `role` narrows to one of the two; limit 1-100 (default 30).
 */
export const recentRenders = query({
  args: { role: v.optional(v.union(v.literal("graphic"), v.literal("carousel"))), limit: v.optional(v.number()) },
  returns: v.array(mediaEntryWithDesign),
  handler: async (ctx, { role, limit }) => {
    await requireAdmin(ctx);
    const n = Math.min(Math.max(Math.floor(limit ?? 30), 1), 100);
    const rows = await ctx.db.query("media").order("desc").take(RENDER_SCAN);
    const picked = rows
      .filter((row) => {
        if (row.invalid || row.kind !== "image") return false;
        const r = roleOf(row);
        return role ? r === role : r === "graphic" || r === "carousel";
      })
      .slice(0, n);
    return await Promise.all(picked.map(async (row) => ({ ...mediaEntryOf(row), design: await designViewOf(ctx, row) })));
  },
});

/**
 * CLI: register an uploaded ImageKit file and swap it in for `from` on a
 * listing (a Convex storage file being moved, or a bigger ImageKit file
 * being replaced by a compressed one), then delete `from`.
 */
export const adoptFile = internalMutation({
  args: { listingId: v.id("listings"), from: vMediaId, file: serverFile },
  returns: v.id("media"),
  handler: async (ctx, { listingId, from, file }) => {
    const listing = await ctx.db.get(listingId);
    if (!listing) fail("Listing not found.");
    checkLimits(file.kind, file.contentType, file.size);
    const to = await ctx.db.insert("media", { ...file, createdAt: Date.now() });
    await swapOnListing(ctx, listing, from, to, "server");
    await deleteMedia(ctx, from, "server");
    return to;
  },
});

/** CLI: delete every Convex storage file no listing points at. */
export const deleteOrphanStorage = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number(), stillUsed: v.number() }),
  handler: async (ctx) => {
    const used = new Set<string>();
    for (const l of await ctx.db.query("listings").take(1000)) {
      for (const id of [l.coverId, ...(l.galleryIds ?? []), ...(l.videoId ? [l.videoId] : [])]) used.add(id);
    }
    let deleted = 0;
    let stillUsed = 0;
    for (const file of await ctx.db.system.query("_storage").take(2000)) {
      if (used.has(file._id)) stillUsed++;
      else {
        await ctx.storage.delete(file._id);
        deleted++;
      }
    }
    return { deleted, stillUsed };
  },
});

/** CLI: preview videos still on ImageKit bigger than minBytes (scripts/videos-to-r2.mjs moves them to R2). */
export const largeVideos = internalQuery({
  args: { minBytes: v.number() },
  returns: v.array(
    v.object({
      listingId: v.id("listings"),
      slug: v.string(),
      mediaId: v.id("media"),
      url: v.string(),
      size: v.number(),
    }),
  ),
  handler: async (ctx, { minBytes }) => {
    const out: { listingId: Id<"listings">; slug: string; mediaId: Id<"media">; url: string; size: number }[] = [];
    for (const l of await ctx.db.query("listings").take(1000)) {
      if (!l.videoId) continue;
      const mediaId = ctx.db.normalizeId("media", l.videoId);
      const row = mediaId ? await ctx.db.get(mediaId) : null;
      if (mediaId && row && !row.invalid && row.store !== "r2" && row.size > minBytes) {
        out.push({ listingId: l._id, slug: l.slug, mediaId, url: row.url, size: row.size });
      }
    }
    return out;
  },
});

/**
 * Admin: every preview video still on ImageKit, with a URL for the original
 * upload (tr=orig-true: delivered as stored, no processing units). The
 * overview's media panel re-encodes each one and moves it to R2.
 */
export const imagekitVideos = query({
  args: {},
  returns: v.array(
    v.object({ listingId: v.id("listings"), slug: v.string(), title: v.string(), id: v.id("media"), url: v.string() }),
  ),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const out = [];
    for (const l of await ctx.db.query("listings").take(1000)) {
      const mediaId = l.videoId ? ctx.db.normalizeId("media", l.videoId) : null;
      const row = mediaId ? await ctx.db.get(mediaId) : null;
      if (!mediaId || !row || row.invalid || row.store === "r2") continue;
      const url = new URL(row.url);
      url.searchParams.set("tr", "orig-true");
      out.push({ listingId: l._id, slug: l.slug, title: l.title, id: mediaId, url: url.toString() });
    }
    return out;
  },
});

/**
 * Admin: put a newly uploaded file where an older one was (a Convex storage
 * file, or a video still on ImageKit), then delete the old one.
 */
export const adoptLegacy = mutation({
  args: { listingId: v.id("listings"), from: vMediaId, to: v.id("media") },
  returns: v.null(),
  handler: async (ctx, { listingId, from, to }) => {
    const admin = await requireAdmin(ctx);
    const listing = await ctx.db.get(listingId);
    if (!listing) fail("Listing not found.");
    await swapOnListing(ctx, listing, from, to, admin);
    await deleteMedia(ctx, from, admin);
    return null;
  },
});
