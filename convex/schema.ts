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

/** A juror's past role, shown on their jury page. */
export const juryExperience = v.object({
  title: v.string(), // "Art director"
  organization: v.string(), // "Studio X"
  period: v.optional(v.string()), // "2019 – present"
});

/** A notable piece of a juror's work, shown on their jury page. */
export const juryWork = v.object({
  title: v.string(),
  url: v.optional(v.string()),
  year: v.optional(v.string()),
  description: v.optional(v.string()),
});

/** Jury panels (lib/taxonomy.ts JURY_CATEGORIES has the display names). */
export const juryCategory = v.union(
  v.literal("design"),
  v.literal("engineering"),
  v.literal("venture"),
  v.literal("academic"),
);

export default defineSchema({
  // Files uploaded to ImageKit (convex/media.ts). WebP screenshots and
  // MP4/WebM previews under /listings/<slug>/ with SEO-friendly names.
  media: defineTable({
    // ImageKit (screenshots, older videos): fileId = ImageKit file id.
    // R2 (videos, store "r2"): fileId = object key listings/<slug>/<name>.mp4.
    store: v.optional(v.literal("r2")),
    fileId: v.string(),
    url: v.string(), // public URL at upload time (R2 rows are re-read from R2_PUBLIC_URL)
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
    // Clerk's has_image: false while profilePicture is Clerk's generated
    // default avatar. Jurors without a real photo get a grey placeholder.
    hasImage: v.optional(v.boolean()),
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
    // Profile links (Dribbble, Behance, LinkedIn, X, ...), up to LIMITS.creatorLinks.
    links: v.optional(v.array(v.string())),
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
    votingEndsAt: v.optional(v.number()), // publishedAt + 7 days (+7 more if extended)
    // Set when the window was extended because fewer than LIMITS.juryMinEvaluations
    // jurors had evaluated the site: every site gets up to 14 days for its jury.
    votingExtendedAt: v.optional(v.number()),

    // Scores. Community totals are running sums so reads stay O(1).
    editorialScores: v.optional(pillars),
    communityTotals: pillars,
    communityVotesCount: v.number(),
    editorialAverage: v.optional(v.number()),
    communityAverage: v.optional(v.number()),
    finalScore: v.optional(v.number()),
    awards: v.array(award),
    awardedAt: v.optional(v.number()),

    // Unclaimed = admin-created and not yet owned (ownerId empty). Claiming
    // (claimLinks.claim, or an approved claim request) sets ownerId.
    isClaimed: v.boolean(),
    // Secret claim link token (64 hex chars) while unclaimed; moved to
    // claimTokenUsed when claimed so an old link redirects instead of failing.
    claimToken: v.optional(v.string()),
    claimTokenUsed: v.optional(v.string()),
    // Pre-created for an invited juror: claiming the juror's link claims this too.
    jurorId: v.optional(v.id("jurors")),
    isStartup: v.optional(v.boolean()), // shown in the Startups collection
    // Outbound links are rel="nofollow" until claimed. Absent: follows isClaimed;
    // an admin can set it explicitly either way.
    isDoFollow: v.optional(v.boolean()),
    // Position in the home page's featured header (1 = first), chosen by an
    // admin on /featured. Absent: not featured.
    featuredRank: v.optional(v.number()),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_url", ["url"])
    .index("by_owner", ["ownerId"])
    .index("by_creator", ["creatorId"])
    .index("by_status", ["status", "createdAt"])
    .index("by_status_published", ["status", "publishedAt"])
    .index("by_claimToken", ["claimToken"])
    .index("by_claimTokenUsed", ["claimTokenUsed"])
    .index("by_juror", ["jurorId"])
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

  // Jury members. An admin pre-creates the profile (status "unclaimed", no
  // userId) and shares its claim link; claiming binds it to the user's
  // account. Unclaimed profiles are never public. Rows without a status were
  // created by the older email-invite flow and are claimed. `active: false`
  // takes someone off the jury but keeps their evaluations. Photo: the
  // user's Clerk image if they have one, else the admin-uploaded avatar,
  // else a grey placeholder.
  jurors: defineTable({
    userId: v.optional(v.id("users")),
    status: v.optional(v.union(v.literal("unclaimed"), v.literal("claimed"))),
    slug: v.string(), // /jury/<slug>
    name: v.string(),
    title: v.string(), // "Creative director at Studio X"
    category: v.optional(juryCategory),
    location: v.optional(v.string()),
    website: v.optional(v.string()), // personal site; no link shown when empty
    linkedinUrl: v.optional(v.string()),
    bio: v.optional(v.string()),
    experience: v.optional(v.array(juryExperience)), // newest first, up to LIMITS.juryExperience
    work: v.optional(v.array(juryWork)), // up to LIMITS.juryWork
    avatarId: v.optional(mediaId), // admin-uploaded (ImageKit)
    email: v.optional(v.string()), // private: for emailing the claim link
    isFounding: v.optional(v.boolean()), // "Founding Jury" badge
    claimToken: v.optional(v.string()),
    claimTokenUsed: v.optional(v.string()),
    claimedAt: v.optional(v.number()),
    active: v.boolean(),
    joinedAt: v.number(), // created (unclaimed) or joined
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_slug", ["slug"])
    .index("by_active", ["active", "joinedAt"])
    .index("by_claimToken", ["claimToken"])
    .index("by_claimTokenUsed", ["claimTokenUsed"]),

  // Legacy: email invitations from before pre-created profiles and claim
  // links. Nothing writes here any more; kept so existing rows stay valid.
  juryInvites: defineTable({
    email: v.string(), // lowercased; the account that accepts must use it
    name: v.string(),
    note: v.optional(v.string()), // personal line from the admin, in the email
    tokenHash: v.string(),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("revoked")),
    invitedBy: v.id("users"),
    expiresAt: v.number(),
    sentAt: v.optional(v.number()),
    sendError: v.optional(v.string()),
    acceptedBy: v.optional(v.id("users")),
    acceptedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_email", ["email"])
    .index("by_created", ["createdAt"]),

  // One evaluation per juror per listing, editable while voting is open. The
  // listing's editorialScores is the per-pillar average of these.
  juryEvaluations: defineTable({
    listingId: v.id("listings"),
    jurorId: v.id("jurors"),
    scores: pillars,
    comment: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_listing", ["listingId"])
    .index("by_juror", ["jurorId"])
    .index("by_listing_juror", ["listingId", "jurorId"]),

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
