import { ConvexError, v } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { award, creatorTier, listingStatus, pillars, region } from "../schema";
import { deleteMedia, mediaInfo, mediaUrl, type MediaId } from "./media";
import { CATEGORIES, LIMITS, isCategory, type CategorySlug, type CreatorTier, type RegionSlug } from "./taxonomy";
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

/** How many old slugs a listing keeps redirecting from. */
export const MAX_PREVIOUS_SLUGS = 10;

/** How many listings the slug-history scans read (see retiredListingSlugs). */
const SLUG_SCAN_LIMIT = 1000;

/**
 * Old slugs of other listings, which still redirect to them. Convex cannot
 * index array elements, and the showcase is hand-curated (well under
 * SLUG_SCAN_LIMIT listings), so a bounded table scan is fine here.
 */
export async function retiredListingSlugs(ctx: QueryCtx, except?: Id<"listings">) {
  const rows = await ctx.db.query("listings").take(SLUG_SCAN_LIMIT);
  const out = new Set<string>();
  for (const row of rows) {
    if (row._id === except) continue;
    for (const slug of row.previousSlugs ?? []) out.add(slug);
  }
  return out;
}

/** True when another listing uses `slug` now, or used it before (it redirects). */
export async function listingSlugTaken(ctx: QueryCtx, slug: string, self?: Id<"listings">) {
  const current = await ctx.db
    .query("listings")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .first();
  if (current && current._id !== self) return true;
  return (await retiredListingSlugs(ctx, self)).has(slug);
}

/**
 * The slug history after renaming `listing` to `next`: the current slug is
 * appended (deduped, newest last, at most MAX_PREVIOUS_SLUGS), and `next` is
 * dropped from it when the listing takes an old slug back.
 */
export function previousSlugsAfterRename(listing: Doc<"listings">, next: string) {
  const history = (listing.previousSlugs ?? []).filter((s) => s !== listing.slug && s !== next);
  history.push(listing.slug);
  return history.slice(-MAX_PREVIOUS_SLUGS);
}

/** A free slug for a new row. For listings, other listings' old slugs count as taken. */
export async function uniqueSlug(
  ctx: QueryCtx,
  table: "listings" | "creators",
  base: string,
) {
  const retired = table === "listings" ? await retiredListingSlugs(ctx) : new Set<string>();
  for (let i = 1; i <= 50; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    if (retired.has(candidate)) continue;
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
export async function checkGallery(ctx: MutationCtx, ids: MediaId[] | undefined) {
  const gallery = [...new Set(ids ?? [])];
  if (gallery.length > LIMITS.gallery) {
    fail(`Add up to ${LIMITS.gallery} more screenshots (${LIMITS.gallery + 1} in all).`);
  }
  for (const id of gallery) await assertMedia(ctx, id, "Screenshot", "image");
  return gallery.length ? gallery : undefined;
}

export async function assertMedia(
  ctx: MutationCtx,
  id: MediaId,
  field: string,
  kind: "image" | "video",
) {
  const meta = await mediaInfo(ctx, id);
  if (!meta) fail(`${field} upload was not found. Please upload it again.`);
  const type = meta.contentType ?? "";
  if (kind === "image") {
    if (!type.startsWith("image/") || meta.size > LIMITS.imageBytes) {
      fail(`${field} must be an image of 5 MB or less.`);
    }
  } else if (!["video/mp4", "video/webm"].includes(type) || meta.size > LIMITS.videoBytes) {
    fail(`${field} must be an MP4 or WebM video of 15 MB or less.`);
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

/**
 * Locks voting and assigns awards. Safe to call more than once. Returns the
 * awards given (possibly none), or null when the listing was not in voting.
 */
export async function finalizeListing(
  ctx: MutationCtx,
  listing: Doc<"listings">,
): Promise<Doc<"listings">["awards"] | null> {
  if (listing.status !== "in_voting") return null;
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
  return awards;
}

export const EMPTY_SCORES = {
  communityTotals: ZERO_PILLARS,
  communityVotesCount: 0,
  awards: [] as Doc<"listings">["awards"],
};

export async function deleteListing(ctx: MutationCtx, listing: Doc<"listings">) {
  await deleteMedia(ctx, listing.coverId);
  for (const id of listing.galleryIds ?? []) await deleteMedia(ctx, id);
  if (listing.videoId) await deleteMedia(ctx, listing.videoId);
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
  const evaluations = await ctx.db
    .query("juryEvaluations")
    .withIndex("by_listing", (q) => q.eq("listingId", listing._id))
    .collect();
  for (const e of evaluations) await ctx.db.delete(e._id);
  await ctx.db.delete(listing._id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public shape
// ─────────────────────────────────────────────────────────────────────────────

export const PUBLIC_STATUSES = ["in_voting", "awarded", "archived"] as const;

/** in_voting, awarded and archived listings have a public page. */
export function isPublicStatus(status: Doc<"listings">["status"]) {
  return (PUBLIC_STATUSES as readonly string[]).includes(status);
}

export const publicListing = v.object({
  slug: v.string(),
  title: v.string(),
  tagline: v.string(),
  juryNote: v.union(v.string(), v.null()),
  url: v.string(),
  category: v.string(), // primary
  categories: v.array(v.string()), // all, primary first
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
  /** Voting was extended a week to give the jury time (fewer than 5 jury evaluations after 7 days). */
  votingExtended: v.boolean(),
  awardedAt: v.union(v.number(), v.null()),
  isClaimed: v.boolean(),
  isStartup: v.boolean(),
  isDoFollow: v.boolean(), // false: outbound links get rel="nofollow"
  featuredRank: v.union(v.number(), v.null()), // home header position (1 = first); null: not featured
  coverUrl: v.union(v.string(), v.null()),
  galleryUrls: v.array(v.string()),
  videoUrl: v.union(v.string(), v.null()),
});

export async function mediaUrls(ctx: QueryCtx, listing: Doc<"listings">) {
  return {
    coverUrl: await mediaUrl(ctx, listing.coverId),
    galleryUrls: (await Promise.all((listing.galleryIds ?? []).map((id) => mediaUrl(ctx, id)))).filter(
      (url): url is string => url !== null,
    ),
    videoUrl: listing.videoId ? await mediaUrl(ctx, listing.videoId) : null,
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
    juryNote: listing.juryNote ?? null,
    url: listing.url,
    category: listing.category,
    categories: listingCategories(listing),
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
    votingExtended: listing.votingExtendedAt !== undefined,
    awardedAt: listing.awardedAt ?? null,
    isClaimed: listing.isClaimed,
    isStartup: listing.isStartup ?? false,
    isDoFollow: isDoFollow(listing),
    featuredRank: listing.featuredRank ?? null,
    ...(await mediaUrls(ctx, listing)),
  };
}

export function categoryName(slug: string) {
  return CATEGORIES.find((c) => c.slug === slug)?.name ?? slug;
}

/** Whether a listing's outbound links are followed: explicit flag, else once claimed. */
export function isDoFollow(listing: Pick<Doc<"listings">, "isDoFollow" | "isClaimed">) {
  return listing.isDoFollow ?? listing.isClaimed;
}

/**
 * The fields that hand a listing to its owner: claimed, followed links, and
 * the claim link burned (kept as claimTokenUsed so the old URL redirects).
 */
export function claimedListingPatch(listing: Doc<"listings">, ownerId: Id<"users">, now: number) {
  return {
    ownerId,
    isClaimed: true,
    // Back to automatic (followed while claimed): un-claiming later returns
    // the links to nofollow, and no stale admin override survives the claim.
    isDoFollow: undefined,
    claimToken: undefined,
    ...(listing.claimToken ? { claimTokenUsed: listing.claimToken } : {}),
    updatedAt: now,
  };
}

/** A listing's categories, primary first (older rows only have `category`). */
export function listingCategories(listing: Pick<Doc<"listings">, "category" | "categories">) {
  return listing.categories?.length ? listing.categories : [listing.category];
}

/** Validate a category pick: 1 to LIMITS.categories known slugs, deduped, order kept. */
export function checkCategories(values: string[]): CategorySlug[] {
  const categories = [...new Set(values)];
  if (categories.length === 0) fail("Choose a category.");
  if (categories.length > LIMITS.categories) fail(`Choose up to ${LIMITS.categories} categories.`);
  if (!categories.every(isCategory)) fail("Unknown category selected.");
  return categories as CategorySlug[];
}

export { listingStatus };
