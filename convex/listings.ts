import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin, requireUser } from "./authHelpers";
import { listingStatus } from "./schema";
import { CATEGORIES, LIMITS, isCategory, isTechnology } from "./lib/taxonomy";

// ─────────────────────────────────────────────────────────────────────────────
// Return shapes
// ─────────────────────────────────────────────────────────────────────────────

const publicListing = v.object({
  slug: v.string(),
  title: v.string(),
  tagline: v.string(),
  url: v.string(),
  category: v.string(),
  technologies: v.array(v.string()),
  creditName: v.string(),
  creditUrl: v.union(v.string(), v.null()),
  publishedAt: v.number(),
  coverUrl: v.union(v.string(), v.null()),
  mobileUrl: v.union(v.string(), v.null()),
});

const ownListing = v.object({
  id: v.id("listings"),
  slug: v.string(),
  title: v.string(),
  url: v.string(),
  status: listingStatus,
  reviewNote: v.union(v.string(), v.null()),
  createdAt: v.number(),
  coverUrl: v.union(v.string(), v.null()),
});

const reviewListing = v.object({
  id: v.id("listings"),
  slug: v.string(),
  title: v.string(),
  tagline: v.string(),
  url: v.string(),
  category: v.string(),
  categoryName: v.string(),
  technologies: v.array(v.string()),
  creditName: v.string(),
  creditUrl: v.union(v.string(), v.null()),
  status: listingStatus,
  reviewNote: v.union(v.string(), v.null()),
  reviewedAt: v.union(v.number(), v.null()),
  publishedAt: v.union(v.number(), v.null()),
  createdAt: v.number(),
  coverUrl: v.union(v.string(), v.null()),
  mobileUrl: v.union(v.string(), v.null()),
  submitter: v.union(v.object({ name: v.string(), email: v.string() }), v.null()),
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fail(message: string): never {
  throw new ConvexError(message);
}

function cleanText(value: string, field: string, max: number, required = true) {
  const text = value.trim().replace(/\s+/g, " ");
  if (required && !text) fail(`${field} is required.`);
  if (text.length > max) fail(`${field} must be ${max} characters or fewer.`);
  return text;
}

/** Normalizes a public http(s) URL, or throws. */
export function normalizeUrl(input: string, field = "Website URL"): string {
  const raw = input.trim();
  if (!raw) fail(`${field} is required.`);
  if (raw.length > LIMITS.url) fail(`${field} is too long.`);
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    fail(`${field} is not a valid address.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    fail(`${field} must start with http:// or https://.`);
  }
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || /^[\d.]+$/.test(host)) {
    fail(`${field} must be a public website address.`);
  }
  url.hash = "";
  url.hostname = host;
  const out = url.toString();
  return url.pathname === "/" && !url.search ? out.replace(/\/$/, "") : out;
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "site"
  );
}

async function uniqueSlug(ctx: QueryCtx, title: string) {
  const base = slugify(title);
  for (let i = 1; i <= 50; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    const taken = await ctx.db
      .query("listings")
      .withIndex("by_slug", (q) => q.eq("slug", candidate))
      .first();
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Checks an uploaded file is an image within the size limit.
 * (No cleanup here: throwing rolls the whole mutation back, deletes included.
 * The form validates type and size before uploading, so rejects are rare.)
 */
async function assertImage(ctx: MutationCtx, id: Id<"_storage">, field: string) {
  const meta = await ctx.db.system.get(id);
  if (!meta) fail(`${field} upload was not found. Please upload it again.`);
  const okType = meta.contentType?.startsWith("image/") ?? false;
  if (!okType || meta.size > LIMITS.imageBytes) {
    fail(`${field} must be an image of 5 MB or less.`);
  }
}

async function deleteListing(ctx: MutationCtx, listing: Doc<"listings">) {
  await ctx.storage.delete(listing.coverId);
  if (listing.mobileId) await ctx.storage.delete(listing.mobileId);
  await ctx.db.delete(listing._id);
}

async function imageUrls(ctx: QueryCtx, listing: Doc<"listings">) {
  return {
    coverUrl: await ctx.storage.getUrl(listing.coverId),
    mobileUrl: listing.mobileId ? await ctx.storage.getUrl(listing.mobileId) : null,
  };
}

/** The public shape: no owner ids, emails or review metadata. */
async function toPublic(ctx: QueryCtx, listing: Doc<"listings">) {
  return {
    slug: listing.slug,
    title: listing.title,
    tagline: listing.tagline,
    url: listing.url,
    category: listing.category,
    technologies: listing.technologies,
    creditName: listing.creditName,
    creditUrl: listing.creditUrl ?? null,
    publishedAt: listing.publishedAt ?? listing.createdAt,
    ...(await imageUrls(ctx, listing)),
  };
}

const MAX_PUBLIC = 60;

// ─────────────────────────────────────────────────────────────────────────────
// Public (no sign-in): only approved listings
// ─────────────────────────────────────────────────────────────────────────────

export const listPublished = query({
  args: { category: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.array(publicListing),
  handler: async (ctx, { category, limit }) => {
    const take = Math.min(Math.max(limit ?? MAX_PUBLIC, 1), MAX_PUBLIC);
    const rows = category
      ? await ctx.db
          .query("listings")
          .withIndex("by_status_category_published", (q) =>
            q.eq("status", "approved").eq("category", category),
          )
          .order("desc")
          .take(take)
      : await ctx.db
          .query("listings")
          .withIndex("by_status_published", (q) => q.eq("status", "approved"))
          .order("desc")
          .take(take);
    return Promise.all(rows.map((row) => toPublic(ctx, row)));
  },
});

export const getPublishedBySlug = query({
  args: { slug: v.string() },
  returns: v.union(publicListing, v.null()),
  handler: async (ctx, { slug }) => {
    const listing = await ctx.db
      .query("listings")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!listing || listing.status !== "approved") return null;
    return toPublic(ctx, listing);
  },
});

/** Approved-listing count per category, for the filter pills. */
export const categoryCounts = query({
  args: {},
  returns: v.object({ total: v.number(), byCategory: v.record(v.string(), v.number()) }),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("listings")
      .withIndex("by_status_published", (q) => q.eq("status", "approved"))
      .take(2000);
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.category] = (counts[row.category] ?? 0) + 1;
    return { total: rows.length, byCategory: counts };
  },
});

/** Slugs + dates for the sitemap. */
export const publishedSlugs = query({
  args: {},
  returns: v.array(v.object({ slug: v.string(), updatedAt: v.number() })),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("listings")
      .withIndex("by_status_published", (q) => q.eq("status", "approved"))
      .take(5000);
    return rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt }));
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Signed-in users: submit and manage their own listings
// ─────────────────────────────────────────────────────────────────────────────

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const submit = mutation({
  args: {
    title: v.string(),
    tagline: v.string(),
    url: v.string(),
    category: v.string(),
    technologies: v.array(v.string()),
    creditName: v.string(),
    creditUrl: v.optional(v.string()),
    coverId: v.id("_storage"),
    mobileId: v.optional(v.id("_storage")),
  },
  returns: v.object({ slug: v.string() }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const title = cleanText(args.title, "Site title", LIMITS.title);
    const tagline = cleanText(args.tagline, "Short description", LIMITS.tagline);
    const creditName = cleanText(args.creditName, "Made by", LIMITS.creditName);
    const url = normalizeUrl(args.url);
    const creditUrl = args.creditUrl?.trim()
      ? normalizeUrl(args.creditUrl, "Creator website")
      : undefined;

    if (!isCategory(args.category)) fail("Choose a category.");
    const technologies = [...new Set(args.technologies)];
    if (technologies.length === 0) fail("Choose at least one technology.");
    if (technologies.length > LIMITS.technologies) {
      fail(`Choose up to ${LIMITS.technologies} technologies.`);
    }
    if (!technologies.every(isTechnology)) fail("Unknown technology selected.");

    await assertImage(ctx, args.coverId, "Desktop screenshot");
    if (args.mobileId) await assertImage(ctx, args.mobileId, "Mobile screenshot");

    const mine = await ctx.db
      .query("listings")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();
    if (mine.filter((l) => l.status === "pending").length >= LIMITS.pendingPerUser) {
      fail(
        `You already have ${LIMITS.pendingPerUser} sites waiting for review. Please wait for a decision first.`,
      );
    }

    const duplicate = await ctx.db
      .query("listings")
      .withIndex("by_url", (q) => q.eq("url", url))
      .collect();
    if (duplicate.some((l) => l.status !== "rejected")) {
      fail("This website has already been submitted.");
    }

    const now = Date.now();
    const slug = await uniqueSlug(ctx, title);
    await ctx.db.insert("listings", {
      ownerId: user._id,
      slug,
      title,
      tagline,
      url,
      category: args.category,
      technologies,
      creditName,
      creditUrl,
      coverId: args.coverId,
      mobileId: args.mobileId,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    return { slug };
  },
});

export const myListings = query({
  args: {},
  returns: v.array(ownListing),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", identity.subject))
      .unique();
    if (!user) return [];
    const rows = await ctx.db
      .query("listings")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .collect();
    return Promise.all(
      rows.map(async (row) => ({
        id: row._id,
        slug: row.slug,
        title: row.title,
        url: row.url,
        status: row.status,
        reviewNote: row.reviewNote ?? null,
        createdAt: row.createdAt,
        coverUrl: await ctx.storage.getUrl(row.coverId),
      })),
    );
  },
});

/** Owners can withdraw (delete) their own listing at any stage. */
export const withdraw = mutation({
  args: { id: v.id("listings") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const listing = await ctx.db.get(id);
    if (!listing || listing.ownerId !== user._id) fail("Listing not found.");
    await deleteListing(ctx, listing);
    return null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin review
// ─────────────────────────────────────────────────────────────────────────────

async function withSubmitter(ctx: QueryCtx, listing: Doc<"listings">) {
  const owner = await ctx.db.get(listing.ownerId);
  return {
    id: listing._id,
    slug: listing.slug,
    title: listing.title,
    tagline: listing.tagline,
    url: listing.url,
    category: listing.category,
    categoryName: CATEGORIES.find((c) => c.slug === listing.category)?.name ?? listing.category,
    technologies: listing.technologies,
    creditName: listing.creditName,
    creditUrl: listing.creditUrl ?? null,
    status: listing.status,
    reviewNote: listing.reviewNote ?? null,
    reviewedAt: listing.reviewedAt ?? null,
    publishedAt: listing.publishedAt ?? null,
    createdAt: listing.createdAt,
    ...(await imageUrls(ctx, listing)),
    submitter: owner ? { name: owner.name, email: owner.email } : null,
  };
}

export const reviewCounts = query({
  args: {},
  returns: v.object({ pending: v.number(), approved: v.number(), rejected: v.number() }),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const count = async (status: Doc<"listings">["status"]) =>
      (
        await ctx.db
          .query("listings")
          .withIndex("by_status", (q) => q.eq("status", status))
          .take(1000)
      ).length;
    return {
      pending: await count("pending"),
      approved: await count("approved"),
      rejected: await count("rejected"),
    };
  },
});

export const reviewQueue = query({
  args: { status: listingStatus },
  returns: v.array(reviewListing),
  handler: async (ctx, { status }) => {
    await requireAdmin(ctx);
    // Oldest first for the pending queue, newest first otherwise.
    const rows = await ctx.db
      .query("listings")
      .withIndex("by_status", (q) => q.eq("status", status))
      .order(status === "pending" ? "asc" : "desc")
      .take(200);
    return Promise.all(rows.map((row) => withSubmitter(ctx, row)));
  },
});

export const reviewDetail = query({
  args: { id: v.id("listings") },
  returns: v.union(reviewListing, v.null()),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    return listing ? withSubmitter(ctx, listing) : null;
  },
});

export const approve = mutation({
  args: { id: v.id("listings") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const admin = await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    if (!listing) fail("Listing not found.");
    const now = Date.now();
    await ctx.db.patch(id, {
      status: "approved",
      reviewNote: undefined,
      reviewedBy: admin._id,
      reviewedAt: now,
      publishedAt: listing.publishedAt ?? now,
      updatedAt: now,
    });
    return null;
  },
});

export const reject = mutation({
  args: { id: v.id("listings"), note: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, note }) => {
    const admin = await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    if (!listing) fail("Listing not found.");
    const reviewNote = cleanText(note, "Reason", LIMITS.reviewNote);
    const now = Date.now();
    await ctx.db.patch(id, {
      status: "rejected",
      reviewNote,
      reviewedBy: admin._id,
      reviewedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const remove = mutation({
  args: { id: v.id("listings") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    if (!listing) fail("Listing not found.");
    await deleteListing(ctx, listing);
    return null;
  },
});
