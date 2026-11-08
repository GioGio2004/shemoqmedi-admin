import { ConvexError, v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireAdmin, requireUser } from "./authHelpers";
import { LIMITS } from "./lib/taxonomy";
import { assertMedia, fail } from "./lib/listingHelpers";
import { deleteMedia, mediaUrl, vMediaId, type MediaId } from "./lib/media";

// ImageKit media pipeline.
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

const IMAGE_TYPES = ["image/webp", "image/png", "image/jpeg"];
const VIDEO_TYPES = ["video/mp4", "video/webm"];

function env(name: "IMAGEKIT_PRIVATE_KEY" | "IMAGEKIT_PUBLIC_KEY" | "IMAGEKIT_URL_ENDPOINT") {
  const value = process.env[name];
  if (!value) throw new ConvexError("Image uploads are not configured yet. Please try again later.");
  return value.replace(/\/+$/, "");
}

function authHeader() {
  return `Basic ${btoa(`${env("IMAGEKIT_PRIVATE_KEY")}:`)}`;
}

async function hmacSha1Hex(key: string, message: string) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function checkLimits(kind: "image" | "video", contentType: string, size: number) {
  if (kind === "image") {
    if (!IMAGE_TYPES.includes(contentType) || size > LIMITS.imageBytes) {
      throw new ConvexError("Screenshots must be images of 5 MB or less.");
    }
  } else if (!VIDEO_TYPES.includes(contentType) || size > LIMITS.videoBytes) {
    throw new ConvexError("The preview video must be an MP4 or WebM of 15 MB or less.");
  }
}

/** Signed parameters for one direct browser → ImageKit upload (valid 30 minutes). */
export const uploadAuth = action({
  args: {},
  returns: v.object({
    token: v.string(),
    expire: v.number(),
    signature: v.string(),
    publicKey: v.string(),
    urlEndpoint: v.string(),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Please log in to upload.");
    const token = crypto.randomUUID();
    const expire = Math.floor(Date.now() / 1000) + 30 * 60;
    const signature = await hmacSha1Hex(env("IMAGEKIT_PRIVATE_KEY"), `${token}${expire}`);
    return {
      token,
      expire,
      signature,
      publicKey: env("IMAGEKIT_PUBLIC_KEY"),
      urlEndpoint: env("IMAGEKIT_URL_ENDPOINT"),
    };
  },
});

/** Record a finished ImageKit upload; returns the id listing mutations take. */
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
    checkLimits(args.kind, args.contentType, args.size);
    const existing = await ctx.db
      .query("media")
      .withIndex("by_fileId", (q) => q.eq("fileId", args.fileId))
      .first();
    if (existing) return existing._id;
    const id = await ctx.db.insert("media", {
      ...args,
      uploadedBy: user._id,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.media.verify, { id, fileId: args.fileId, kind: args.kind });
    return id;
  },
});

/** Double-check a registered file against ImageKit (real size, type, path). */
export const verify = internalAction({
  args: { id: v.id("media"), fileId: v.string(), kind: v.union(v.literal("image"), v.literal("video")) },
  returns: v.null(),
  handler: async (ctx, { id, fileId, kind }) => {
    const res = await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}/details`, {
      headers: { Authorization: authHeader() },
    });
    if (res.status >= 500) throw new Error(`ImageKit details HTTP ${res.status}`);
    let ok = res.ok;
    if (ok) {
      const file = (await res.json()) as { size?: number; mime?: string; filePath?: string };
      try {
        checkLimits(kind, file.mime ?? "", file.size ?? Infinity);
        ok = (file.filePath ?? "").startsWith("/listings/");
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
async function swapOnListing(ctx: MutationCtx, listing: Doc<"listings">, from: MediaId, to: MediaId) {
  if (listing.coverId === from) {
    await assertMedia(ctx, to, "Cover screenshot", "image");
    await ctx.db.patch(listing._id, { coverId: to, updatedAt: Date.now() });
  } else if (listing.galleryIds?.includes(from)) {
    await assertMedia(ctx, to, "Screenshot", "image");
    await ctx.db.patch(listing._id, {
      galleryIds: listing.galleryIds.map((g) => (g === from ? to : g)),
      updatedAt: Date.now(),
    });
  } else if (listing.videoId === from) {
    await assertMedia(ctx, to, "Preview video", "video");
    await ctx.db.patch(listing._id, { videoId: to, updatedAt: Date.now() });
  } else {
    fail("That file is no longer on this listing. Reload and try again.");
  }
}

const serverFile = v.object({
  fileId: v.string(),
  url: v.string(),
  filePath: v.string(),
  kind: v.union(v.literal("image"), v.literal("video")),
  contentType: v.string(),
  size: v.number(),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
});

/** Record an ImageKit file uploaded server-side (importer, CLI); no user session. */
export const registerInternal = internalMutation({
  args: serverFile.fields,
  returns: v.id("media"),
  handler: async (ctx, args) => {
    checkLimits(args.kind, args.contentType, args.size);
    const existing = await ctx.db
      .query("media")
      .withIndex("by_fileId", (q) => q.eq("fileId", args.fileId))
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("media", { ...args, createdAt: Date.now() });
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
    await swapOnListing(ctx, listing, from, to);
    await deleteMedia(ctx, from);
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

/** CLI: ImageKit preview videos bigger than minBytes (to re-compress). */
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
      if (mediaId && row && !row.invalid && row.size > minBytes) {
        out.push({ listingId: l._id, slug: l.slug, mediaId, url: row.url, size: row.size });
      }
    }
    return out;
  },
});

/** Admin: put an uploaded ImageKit file where an old Convex file was, then delete the old one. */
export const adoptLegacy = mutation({
  args: { listingId: v.id("listings"), from: v.id("_storage"), to: v.id("media") },
  returns: v.null(),
  handler: async (ctx, { listingId, from, to }) => {
    await requireAdmin(ctx);
    const listing = await ctx.db.get(listingId);
    if (!listing) fail("Listing not found.");
    await swapOnListing(ctx, listing, from, to);
    await deleteMedia(ctx, from);
    return null;
  },
});
