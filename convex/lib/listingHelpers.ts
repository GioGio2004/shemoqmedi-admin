import { ConvexError, v } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { award, creatorTier, listingStatus, pillars, region } from "../schema";
import { CATEGORIES, LIMITS, type CreatorTier, type RegionSlug } from "./taxonomy";
import { ZERO_PILLARS, decideAwards, summarize, type Pillars } from "./scoring";

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

export function fail(message: string): never {
  throw new ConvexError(message);
}

export function cleanText(value: string, field: string, max: number, required = true) {
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
  if (!host.includes(".") || host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":")) {
    fail(`${field} must be a public website address.`);
  }
  url.hash = "";
  url.hostname = host;
  const out = url.toString();
  return url.pathname === "/" && !url.search ? out.replace(/\/$/, "") : out;
}

export function slugify(value: string, fallback = "site") {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || fallback
  );
}

export async function uniqueSlug(
  ctx: QueryCtx,
  table: "listings" | "creators",
  base: string,
) {
  for (let i = 1; i <= 50; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    const taken = await ctx.db
      .query(table)
      .withIndex("by_slug", (q) => q.eq("slug", candidate))
      .first();
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Checks an uploaded file's type and size. (No cleanup on failure: throwing
 * rolls the whole mutation back, deletes included.)
 */
/** Validate extra screenshots: unique, at most LIMITS.gallery, all images. */
export async function checkGallery(ctx: MutationCtx, ids: Id<"_storage">[] | undefined) {
  const gallery = [...new Set(ids ?? [])];
  if (gallery.length > LIMITS.gallery) {
    fail(`Add up to ${LIMITS.gallery} more screenshots (${LIMITS.gallery + 1} in all).`);
  }
  for (const id of gallery) await assertMedia(ctx, id, "Screenshot", "image");
  return gallery.length ? gallery : undefined;
}

export async function assertMedia(
  ctx: MutationCtx,
  id: Id<"_storage">,
  field: string,
  kind: "image" | "video",
) {
  const meta = await ctx.db.system.get(id);
  if (!meta) fail(`${field} upload was not found. Please upload it again.`);
  const type = meta.contentType ?? "";
  if (kind === "image") {
    if (!type.startsWith("image/") || meta.size > LIMITS.imageBytes) {
      fail(`${field} must be an image of 5 MB or less.`);
    }
  } else if (!["video/mp4", "video/webm"].includes(type) || meta.size > LIMITS.videoBytes) {
    fail(`${field} must be an MP4 or WebM video of 10 MB or less.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Creators
// ─────────────────────────────────────────────────────────────────────────────

/** Finds a creator by name-derived slug, or creates one. */
export async function findOrCreateCreator(
  ctx: MutationCtx,
  input: {
    name: string;
    tier: CreatorTier;
    region: RegionSlug;
    website?: string;
    location?: string;
    claimedBy?: Id<"users">;
  },
): Promise<Id<"creators">> {
  const base = slugify(input.name, "creator");
  const existing = await ctx.db
    .query("creators")
    .withIndex("by_slug", (q) => q.eq("slug", base))
    .first();
  if (existing) return existing._id;
  const now = Date.now();
  return await ctx.db.insert("creators", {
    slug: base,
    name: input.name,
    tier: input.tier,
    region: input.region,
    location: input.location,
    website: input.website,
    isClaimed: Boolean(input.claimedBy),
    claimedBy: input.claimedBy,
    createdAt: now,
    updatedAt: now,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Scores and lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/** The score fields to patch after editorial scores or community totals change. */
export function scoreFields(
  editorial: Pillars | undefined,
  totals: Pillars,
  count: number,
) {
  const s = summarize(editorial ?? null, totals, count);
  return {
    editorialAverage: s.editorialAverage ?? undefined,
    communityAverage: s.communityAverage ?? undefined,
    finalScore: s.finalScore ?? undefined,
  };
}

/** Locks voting and assigns awards. Safe to call more than once. */
export async function finalizeListing(ctx: MutationCtx, listing: Doc<"listings">) {
  if (listing.status !== "in_voting") return;
  const fields = scoreFields(listing.editorialScores, listing.communityTotals, listing.communityVotesCount);
  const awards = decideAwards(listing.creatorTier, fields.finalScore ?? null);
  const now = Date.now();
  await ctx.db.patch(listing._id, {
    ...fields,
    awards,
    status: awards.length > 0 ? "awarded" : "archived",
    awardedAt: awards.length > 0 ? now : undefined,
    updatedAt: now,
  });
}

export const EMPTY_SCORES = {
  communityTotals: ZERO_PILLARS,
  communityVotesCount: 0,
  awards: [] as Doc<"listings">["awards"],
};

export async function deleteListing(ctx: MutationCtx, listing: Doc<"listings">) {
  await ctx.storage.delete(listing.coverId);
  for (const id of listing.galleryIds ?? []) await ctx.storage.delete(id);
  if (listing.videoId) await ctx.storage.delete(listing.videoId);
  const votes = await ctx.db
    .query("votes")
    .withIndex("by_listing", (q) => q.eq("listingId", listing._id))
    .collect();
  for (const vote of votes) await ctx.db.delete(vote._id);
  const claims = await ctx.db
    .query("claims")
    .withIndex("by_listing", (q) => q.eq("listingId", listing._id))
    .collect();
  for (const claim of claims) await ctx.db.delete(claim._id);
  await ctx.db.delete(listing._id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public shape
// ─────────────────────────────────────────────────────────────────────────────

export const PUBLIC_STATUSES = ["in_voting", "awarded", "archived"] as const;

export const publicListing = v.object({
  slug: v.string(),
  title: v.string(),
  tagline: v.string(),
  url: v.string(),
  category: v.string(),
  technologies: v.array(v.string()),
  region,
  creatorTier,
  creditName: v.string(),
  creditUrl: v.union(v.string(), v.null()),
  creator: v.union(v.object({ slug: v.string(), name: v.string() }), v.null()),
  status: v.union(v.literal("in_voting"), v.literal("awarded"), v.literal("archived")),
  awards: v.array(award),
  editorialScores: v.union(pillars, v.null()),
  communityScores: v.union(pillars, v.null()),
  communityVotesCount: v.number(),
  editorialAverage: v.union(v.number(), v.null()),
  communityAverage: v.union(v.number(), v.null()),
  finalScore: v.union(v.number(), v.null()),
  publishedAt: v.number(),
  votingEndsAt: v.number(),
  awardedAt: v.union(v.number(), v.null()),
  isClaimed: v.boolean(),
  coverUrl: v.union(v.string(), v.null()),
  galleryUrls: v.array(v.string()),
  videoUrl: v.union(v.string(), v.null()),
});

export async function mediaUrls(ctx: QueryCtx, listing: Doc<"listings">) {
  return {
    coverUrl: await ctx.storage.getUrl(listing.coverId),
    galleryUrls: (await Promise.all((listing.galleryIds ?? []).map((id) => ctx.storage.getUrl(id)))).filter(
      (url): url is string => url !== null,
    ),
    videoUrl: listing.videoId ? await ctx.storage.getUrl(listing.videoId) : null,
  };
}

const round2 = (n: number) => Number(n.toFixed(2));

/** The public shape: no owner ids, emails or review metadata. */
export async function toPublic(ctx: QueryCtx, listing: Doc<"listings">) {
  if (listing.status !== "in_voting" && listing.status !== "awarded" && listing.status !== "archived") {
    return null;
  }
  const creator = listing.creatorId ? await ctx.db.get(listing.creatorId) : null;
  const count = listing.communityVotesCount;
  const t = listing.communityTotals;
  const publishedAt = listing.publishedAt ?? listing.createdAt;
  return {
    slug: listing.slug,
    title: listing.title,
    tagline: listing.tagline,
    url: listing.url,
    category: listing.category,
    technologies: listing.technologies,
    region: listing.region,
    creatorTier: listing.creatorTier,
    creditName: listing.creditName,
    creditUrl: listing.creditUrl ?? null,
    creator: creator ? { slug: creator.slug, name: creator.name } : null,
    status: listing.status,
    awards: listing.awards,
    editorialScores: listing.editorialScores ?? null,
    communityScores:
      count > 0
        ? {
            design: round2(t.design / count),
            usability: round2(t.usability / count),
            creativity: round2(t.creativity / count),
            code: round2(t.code / count),
          }
        : null,
    communityVotesCount: count,
    editorialAverage: listing.editorialAverage ?? null,
    communityAverage: listing.communityAverage ?? null,
    finalScore: listing.finalScore ?? null,
    publishedAt,
    votingEndsAt: listing.votingEndsAt ?? publishedAt,
    awardedAt: listing.awardedAt ?? null,
    isClaimed: listing.isClaimed,
    ...(await mediaUrls(ctx, listing)),
  };
}

export function categoryName(slug: string) {
  return CATEGORIES.find((c) => c.slug === slug)?.name ?? slug;
}

export { listingStatus };
