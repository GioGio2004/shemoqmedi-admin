import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Listing lifecycle:
 *   pending ──approve──▶ in_voting (7 days) ──close──▶ awarded | archived
 *      └──reject──▶ rejected        (admins can also unpublish → rejected)
 * Public pages show in_voting, awarded and archived.
 */
export const listingStatus = v.union(
  v.literal("pending"),
  v.literal("in_voting"),
  v.literal("awarded"),
  v.literal("archived"),
  v.literal("rejected"),
);

export const creatorTier = v.union(v.literal("solo"), v.literal("agency"));
export const region = v.union(v.literal("georgia"), v.literal("global"));
export const award = v.union(v.literal("SOTD"), v.literal("BSC"), v.literal("HM"));

export const pillars = v.object({
  design: v.number(),
  usability: v.number(),
  creativity: v.number(),
  code: v.number(),
});

/** A screenshot or video: Convex storage file or ImageKit `media` row (see lib/media.ts). */
const mediaId = v.union(v.id("_storage"), v.id("media"));

export default defineSchema({
  // Files uploaded to ImageKit (convex/media.ts). WebP screenshots and
  // MP4/WebM previews under /listings/<slug>/ with SEO-friendly names.
  media: defineTable({
    fileId: v.string(), // ImageKit file id
    url: v.string(), // https://ik.imagekit.io/<id>/listings/<slug>/<name>
    filePath: v.string(),
    kind: v.union(v.literal("image"), v.literal("video")),
    contentType: v.string(),
    size: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    uploadedBy: v.optional(v.id("users")), // empty for server-side uploads (importer, migration)
    invalid: v.optional(v.boolean()), // failed the server-side check; not shown
    createdAt: v.number(),
  }).index("by_fileId", ["fileId"]),

  // Created and kept in sync by the Clerk webhook (http.ts → users.upsertFromClerk).
  users: defineTable({
    externalId: v.string(), // Clerk user id (identity.subject)
    name: v.string(),
    email: v.string(),
    profilePicture: v.optional(v.string()),
    // Platform role, managed in Convex (never overwritten by Clerk data).
    role: v.optional(v.union(v.literal("admin"), v.literal("super_admin"))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("byExternalId", ["externalId"])
    .index("byEmail", ["email"]),

  // A person or studio credited on listings. /creators/<slug>
  creators: defineTable({
    slug: v.string(),
    name: v.string(),
    tier: creatorTier,
    region,
    location: v.optional(v.string()), // e.g. "Tbilisi, GE"
    website: v.optional(v.string()),
    bio: v.optional(v.string()),
    isClaimed: v.boolean(),
    claimedBy: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_claimedBy", ["claimedBy"]),

  // A website in the showcase. /sites/<slug>
  listings: defineTable({
    // Submitter / verified owner. Absent for admin imports until claimed.
    ownerId: v.optional(v.id("users")),
    creatorId: v.optional(v.id("creators")),
    source: v.union(v.literal("submission"), v.literal("import"), v.literal("seed")),
    submissionTier: v.union(v.literal("standard"), v.literal("express")),

    slug: v.string(),
    // Slugs this listing used before (newest last, at most 10). The site
    // 308-redirects /sites/<old> to the current slug (listings.resolveSlug),
    // so no other listing may take one of them.
    previousSlugs: v.optional(v.array(v.string())),
    title: v.string(),
    tagline: v.string(),
    juryNote: v.optional(v.string()), // short public review by the jury (LIMITS.juryNote)
    url: v.string(), // normalized live URL
    category: v.string(), // primary CATEGORIES slug (= categories[0])
    // Every CATEGORIES slug, primary first. Absent on older rows: read it with
    // listingCategories(), which falls back to [category].
    categories: v.optional(v.array(v.string())),
    technologies: v.array(v.string()), // TECHNOLOGIES names
    region,
    creatorTier,
    creditName: v.string(),
    creditUrl: v.optional(v.string()),

    // Each is a Convex storage file (older uploads) or a `media` row (ImageKit).
    coverId: mediaId, // first screenshot (16:9, or a full page that scrolls)
    galleryIds: v.optional(v.array(mediaId)), // up to LIMITS.gallery more screenshots
    videoId: v.optional(mediaId), // short muted preview

    status: listingStatus,
    reviewNote: v.optional(v.string()),
    reviewedBy: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    publishedAt: v.optional(v.number()), // voting window start
    votingEndsAt: v.optional(v.number()), // publishedAt + 7 days

    // Scores. Community totals are running sums so reads stay O(1).
    editorialScores: v.optional(pillars),
    communityTotals: pillars,
    communityVotesCount: v.number(),
    editorialAverage: v.optional(v.number()),
    communityAverage: v.optional(v.number()),
    finalScore: v.optional(v.number()),
    awards: v.array(award),
    awardedAt: v.optional(v.number()),

    isClaimed: v.boolean(),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_url", ["url"])
    .index("by_owner", ["ownerId"])
    .index("by_creator", ["creatorId"])
    .index("by_status", ["status", "createdAt"])
    .index("by_status_published", ["status", "publishedAt"])
    .index("by_status_votingEndsAt", ["status", "votingEndsAt"]),

  // One community vote per user per listing, during the voting window.
  votes: defineTable({
    listingId: v.id("listings"),
    userId: v.id("users"),
    scores: pillars,
    createdAt: v.number(),
  })
    .index("by_listing_user", ["listingId", "userId"])
    .index("by_listing", ["listingId"])
    .index("by_user", ["userId"]),

  // "This is mine" requests for unclaimed listings and creator profiles.
  claims: defineTable({
    targetType: v.union(v.literal("listing"), v.literal("creator")),
    listingId: v.optional(v.id("listings")),
    creatorId: v.optional(v.id("creators")),
    userId: v.id("users"),
    message: v.string(),
    proofUrl: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    reviewNote: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_status", ["status", "createdAt"])
    .index("by_user", ["userId"])
    .index("by_listing", ["listingId"])
    .index("by_creator", ["creatorId"]),
});
