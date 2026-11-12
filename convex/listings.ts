import { hasJuryEvaluations } from "./jury";
import { v } from "convex/values";
import { deleteMedia, mediaUrl, vMediaId } from "./lib/media";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireAdmin, requireUser } from "./authHelpers";
import { award, creatorTier, listingStatus, pillars, region } from "./schema";
import { LIMITS, isTechnology } from "./lib/taxonomy";
import { normalizePillars, readPillars } from "./lib/scoring";
import { batchVotingEnds, weekOf } from "./lib/time";
import { getConfig } from "./lib/config";
import { checkDomain, domainKey } from "./lib/domains";
import { closeVoting } from "./lib/awards";
import {
  EMPTY_SCORES,
  PUBLIC_STATUSES,
  assertMedia,
  checkGallery,
  categoryName,
  checkCategories,
  cleanText,
  deleteListing,
  fail,
  findOrCreateCreator,
  isDoFollow,
  isPublicStatus,
  listingCategories,
  mediaUrls,
  normalizeUrl,
  publicListing,
  scoreFields,
  slugify,
  toPublic,
  uniqueSlug,
} from "./lib/listingHelpers";
import { awardPaths, listingPaths, scheduleIndexNow } from "./seo";
import { pushAdmins } from "./push";
import { adminUrl } from "../lib/hosts";

const MAX_PUBLIC = 200;

// ─────────────────────────────────────────────────────────────────────────────
// Public (no sign-in): in_voting, awarded and archived listings
// ─────────────────────────────────────────────────────────────────────────────

/** Every public listing, newest first. The site filters this list itself. */
export const listPublic = query({
  args: {},
  returns: v.array(publicListing),
  handler: async (ctx) => {
    const rows: Doc<"listings">[] = [];
    for (const status of PUBLIC_STATUSES) {
      rows.push(
        ...(await ctx.db
          .query("listings")
          .withIndex("by_status_published", (q) => q.eq("status", status))
          .order("desc")
          .take(MAX_PUBLIC)),
      );
    }
    rows.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
    const out = await Promise.all(rows.slice(0, MAX_PUBLIC).map((row) => toPublic(ctx, row)));
    return out.filter((row) => row !== null);
  },
});

export const getPublicBySlug = query({
  args: { slug: v.string() },
  returns: v.union(publicListing, v.null()),
  handler: async (ctx, { slug }) => {
    const listing = await ctx.db
      .query("listings")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    return listing ? toPublic(ctx, listing) : null;
  },
});

/**
 * Old address → current slug, for a 308 from /sites/<old>. Only public
 * listings redirect; returns null when nothing (public) used to have this slug.
 */
export const resolveSlug = query({
  args: { slug: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { slug }) => {
    const current = await ctx.db
      .query("listings")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (current) return null; // the slug is in use; its own page answers
    // previousSlugs is an array, which Convex cannot index. The showcase is
    // small and hand-curated, so scanning the public listings is fine.
    for (const status of PUBLIC_STATUSES) {
      const rows = await ctx.db
        .query("listings")
        .withIndex("by_status_published", (q) => q.eq("status", status))
        .take(1000);
      const hit = rows.find((r) => r.previousSlugs?.includes(slug));
      if (hit) return hit.slug;
    }
    return null;
  },
});

/** Slugs + dates for the sitemap. */
export const publicSlugs = query({
  args: {},
  returns: v.array(v.object({ slug: v.string(), updatedAt: v.number() })),
  handler: async (ctx) => {
    const out: { slug: string; updatedAt: number }[] = [];
    for (const status of PUBLIC_STATUSES) {
      const rows = await ctx.db
        .query("listings")
        .withIndex("by_status_published", (q) => q.eq("status", status))
        .take(5000);
      out.push(...rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt })));
    }
    return out;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Signed-in users: submit and manage their own listings
// ─────────────────────────────────────────────────────────────────────────────


export const submit = mutation({
  args: {
    title: v.string(),
    tagline: v.string(),
    url: v.string(),
    categories: v.optional(v.array(v.string())), // primary first
    category: v.optional(v.string()), // older clients: a single category
    technologies: v.array(v.string()),
    creatorTier,
    region,
    creditName: v.string(),
    creditUrl: v.optional(v.string()),
    submissionTier: v.union(v.literal("standard"), v.literal("express")),
    isStartup: v.optional(v.boolean()),
    coverId: vMediaId,
    galleryIds: v.optional(v.array(vMediaId)),
    videoId: v.optional(vMediaId),
    // Slug of the earlier listing when this is a significant redesign of a site already in the showcase.
    redesignOf: v.optional(v.string()),
  },
  returns: v.object({ slug: v.string() }),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    if (args.submissionTier === "express") {
      fail("Express Fast-Track is coming soon. Please use the standard queue for now.");
    }
    const title = cleanText(args.title, "Site title", LIMITS.title);
    const tagline = cleanText(args.tagline, "Short description", LIMITS.tagline);
    const creditName = cleanText(args.creditName, "Made by", LIMITS.creditName);
    const url = normalizeUrl(args.url);
    const creditUrl = args.creditUrl?.trim()
      ? normalizeUrl(args.creditUrl, "Creator website")
      : undefined;

    const categories = checkCategories(args.categories ?? (args.category ? [args.category] : []));
    const technologies = [...new Set(args.technologies)];
    if (technologies.length === 0) fail("Choose at least one technology.");
    if (technologies.length > LIMITS.technologies) {
      fail(`Choose up to ${LIMITS.technologies} technologies.`);
    }
    if (!technologies.every(isTechnology)) fail("Unknown technology selected.");

    await assertMedia(ctx, args.coverId, "Cover screenshot", "image");
    const galleryIds = await checkGallery(ctx, args.galleryIds);
    if (args.videoId) await assertMedia(ctx, args.videoId, "Preview video", "video");

    const mine = await ctx.db
      .query("listings")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .collect();
    if (mine.filter((l) => l.status === "pending").length >= LIMITS.pendingPerUser) {
      fail(
        `You already have ${LIMITS.pendingPerUser} sites waiting for review. Please wait for a decision first.`,
      );
    }

    // One active listing per website; a site already in the showcase only
    // comes back as a significant redesign (admin-reviewed like every
    // submission, and at least config.resubmitMonths after its last award).
    const previous = args.redesignOf
      ? await ctx.db
          .query("listings")
          .withIndex("by_slug", (q) => q.eq("slug", args.redesignOf!))
          .first()
      : null;
    if (args.redesignOf && !previous) fail("The earlier listing for this redesign was not found.");
    const config = await getConfig(ctx);
    const domain = await checkDomain(ctx, url, {
      redesignOf: previous?._id,
      resubmitMonths: config.resubmitMonths,
      now: Date.now(),
    });
    if (!domain.ok) fail(domain.reason);

    const creatorId = await findOrCreateCreator(ctx, {
      name: creditName,
      tier: args.creatorTier,
      region: args.region,
      website: creditUrl,
      claimedBy: user._id,
    });

    const now = Date.now();
    const slug = await uniqueSlug(ctx, "listings", slugify(title));
    const id = await ctx.db.insert("listings", {
      ownerId: user._id,
      isStartup: args.isStartup || undefined,
      domainKey: domainKey(url),
      redesignOf: domain.redesignOf,
      creatorId,
      source: "submission",
      submissionTier: "standard",
      slug,
      title,
      tagline,
      url,
      category: categories[0],
      categories,
      technologies,
      region: args.region,
      creatorTier: args.creatorTier,
      creditName,
      creditUrl,
      coverId: args.coverId,
      galleryIds,
      videoId: args.videoId,
      status: "pending",
      ...EMPTY_SCORES,
      isClaimed: true,
      createdAt: now,
      updatedAt: now,
    });
    await pushAdmins(ctx, {
      title: "New submission",
      body: `${title} by ${creditName}`,
      url: adminUrl(`/review/${id}`),
      tag: `submission-${id}`,
    });
    return { slug };
  },
});

const ownListing = v.object({
  id: v.id("listings"),
  slug: v.string(),
  title: v.string(),
  url: v.string(),
  status: listingStatus,
  reviewNote: v.union(v.string(), v.null()),
  awards: v.array(award),
  finalScore: v.union(v.number(), v.null()),
  votingEndsAt: v.union(v.number(), v.null()),
  createdAt: v.number(),
  coverUrl: v.union(v.string(), v.null()),
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
        awards: row.awards,
        finalScore: row.finalScore ?? null,
        votingEndsAt: row.votingEndsAt ?? null,
        createdAt: row.createdAt,
        coverUrl: await mediaUrl(ctx, row.coverId),
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
    // Ping the removed page so engines recrawl it and see the 404.
    const paths = isPublicStatus(listing.status) ? await listingPaths(ctx, listing) : [];
    await deleteListing(ctx, listing);
    await scheduleIndexNow(ctx, paths);
    return null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin review
// ─────────────────────────────────────────────────────────────────────────────

const reviewListing = v.object({
  id: v.id("listings"),
  slug: v.string(),
  title: v.string(),
  tagline: v.string(),
  juryNote: v.union(v.string(), v.null()),
  url: v.string(),
  categories: v.array(v.string()), // primary first
  categoryNames: v.array(v.string()),
  technologies: v.array(v.string()),
  region,
  creatorTier,
  creditName: v.string(),
  creditUrl: v.union(v.string(), v.null()),
  creator: v.union(
    v.object({ slug: v.string(), name: v.string(), isClaimed: v.boolean() }),
    v.null(),
  ),
  source: v.union(v.literal("submission"), v.literal("import"), v.literal("seed")),
  status: listingStatus,
  reviewNote: v.union(v.string(), v.null()),
  reviewedAt: v.union(v.number(), v.null()),
  publishedAt: v.union(v.number(), v.null()),
  votingEndsAt: v.union(v.number(), v.null()),
  awardedAt: v.union(v.number(), v.null()),
  /** In the Site of the Day queue (voting closed with an eligible score of the SOTD minimum or more). */
  sotdQueued: v.boolean(),
  juryVotes: v.number(),
  byTeam: v.boolean(),
  batchWeek: v.union(v.string(), v.null()),
  redesignOf: v.union(v.object({ slug: v.string(), title: v.string() }), v.null()),
  editorialScores: v.union(pillars, v.null()),
  communityVotesCount: v.number(),
  editorialAverage: v.union(v.number(), v.null()),
  communityAverage: v.union(v.number(), v.null()),
  finalScore: v.union(v.number(), v.null()),
  awards: v.array(award),
  isClaimed: v.boolean(),
  isStartup: v.boolean(),
  /** Effective follow state of the outbound links, and the admin's explicit setting (null: automatic). */
  isDoFollow: v.boolean(),
  doFollowSetting: v.union(v.boolean(), v.null()),
  /** Pre-created for this juror (bundled claim link). */
  juror: v.union(v.object({ id: v.id("jurors"), name: v.string(), claimed: v.boolean() }), v.null()),
  /** Secret claim link token while unclaimed (admin only). */
  claimToken: v.union(v.string(), v.null()),
  createdAt: v.number(),
  coverUrl: v.union(v.string(), v.null()),
  galleryUrls: v.array(v.string()),
  /** Extra screenshots with their ids, in order (for the admin media panel). */
  gallery: v.array(v.object({ id: vMediaId, url: v.union(v.string(), v.null()) })),
  videoUrl: v.union(v.string(), v.null()),
  submitter: v.union(v.object({ name: v.string(), email: v.string() }), v.null()),
});

async function jurorRef(ctx: Parameters<typeof mediaUrls>[0], id: Doc<"listings">["jurorId"]) {
  const juror = id ? await ctx.db.get(id) : null;
  return juror ? { id: juror._id, name: juror.name, claimed: juror.status !== "unclaimed" } : null;
}

async function toReview(ctx: Parameters<typeof mediaUrls>[0], listing: Doc<"listings">) {
  const owner = listing.ownerId ? await ctx.db.get(listing.ownerId) : null;
  const creator = listing.creatorId ? await ctx.db.get(listing.creatorId) : null;
  return {
    id: listing._id,
    slug: listing.slug,
    title: listing.title,
    tagline: listing.tagline,
    juryNote: listing.juryNote ?? null,
    url: listing.url,
    categories: listingCategories(listing),
    categoryNames: listingCategories(listing).map(categoryName),
    technologies: listing.technologies,
    region: listing.region,
    creatorTier: listing.creatorTier,
    creditName: listing.creditName,
    creditUrl: listing.creditUrl ?? null,
    creator: creator ? { slug: creator.slug, name: creator.name, isClaimed: creator.isClaimed } : null,
    source: listing.source,
    status: listing.status,
    reviewNote: listing.reviewNote ?? null,
    reviewedAt: listing.reviewedAt ?? null,
    publishedAt: listing.publishedAt ?? null,
    votingEndsAt: listing.votingEndsAt ?? null,
    awardedAt: listing.awardedAt ?? null,
    sotdQueued: listing.sotdQueuedAt !== undefined,
    juryVotes: listing.juryVotes ?? 0,
    byTeam: listing.byTeam ?? false,
    batchWeek: listing.batchWeek ?? null,
    redesignOf: await (async () => {
      const prev = listing.redesignOf ? await ctx.db.get(listing.redesignOf) : null;
      return prev ? { slug: prev.slug, title: prev.title } : null;
    })(),
    editorialScores: listing.editorialScores ? readPillars(listing.editorialScores) : null,
    communityVotesCount: listing.communityVotesCount,
    editorialAverage: listing.editorialAverage ?? null,
    communityAverage: listing.communityAverage ?? null,
    finalScore: listing.finalScore ?? null,
    awards: listing.awards,
    isClaimed: listing.isClaimed,
    isStartup: listing.isStartup ?? false,
    isDoFollow: isDoFollow(listing),
    doFollowSetting: listing.isDoFollow ?? null,
    juror: await jurorRef(ctx, listing.jurorId),
    claimToken: listing.isClaimed ? null : (listing.claimToken ?? null),
    createdAt: listing.createdAt,
    ...(await mediaUrls(ctx, listing)),
    gallery: await Promise.all(
      (listing.galleryIds ?? []).map(async (id) => ({ id, url: await mediaUrl(ctx, id) })),
    ),
    submitter: owner ? { name: owner.name, email: owner.email } : null,
  };
}

export const reviewCounts = query({
  args: {},
  returns: v.object({
    pending: v.number(),
    in_voting: v.number(),
    awarded: v.number(),
    archived: v.number(),
    rejected: v.number(),
  }),
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
      in_voting: await count("in_voting"),
      awarded: await count("awarded"),
      archived: await count("archived"),
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
    return Promise.all(rows.map((row) => toReview(ctx, row)));
  },
});

export const reviewDetail = query({
  args: { id: v.id("listings") },
  returns: v.union(reviewListing, v.null()),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    return listing ? toReview(ctx, listing) : null;
  },
});

/**
 * Jury (editorial) scores, 1.0–10.0 per pillar. Admins may edit them at any
 * stage; after voting has closed the final score is recomputed but awards are
 * left alone (change those with admin.setLifecycle).
 */
export const setEditorialScores = mutation({
  args: { id: v.id("listings"), scores: pillars },
  returns: v.null(),
  handler: async (ctx, { id, scores }) => {
    await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    if (!listing) fail("Listing not found.");
    if (await hasJuryEvaluations(ctx, id)) {
      fail("This site's jury score is the average of its jury evaluations. Remove an evaluation to change it.");
    }
    let editorial;
    try {
      editorial = normalizePillars(scores);
    } catch (err) {
      fail((err as Error).message);
    }
    await ctx.db.patch(id, {
      editorialScores: editorial,
      ...scoreFields(editorial, listing.communityTotals, listing.communityVotesCount),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Approve: the site goes public and joins this week's batch (Monday to
 * Sunday, Tbilisi). The jury scores the batch until the end of next week.
 */
export const approve = mutation({
  args: { id: v.id("listings") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const admin = await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    if (!listing) fail("Listing not found.");
    if (listing.status !== "pending" && listing.status !== "rejected") {
      fail("Only pending or rejected sites can be approved.");
    }
    const now = Date.now();
    await ctx.db.patch(id, {
      status: "in_voting",
      reviewNote: undefined,
      reviewedBy: admin._id,
      reviewedAt: now,
      publishedAt: now,
      batchWeek: weekOf(now),
      votingEndsAt: batchVotingEnds(weekOf(now)),
      votingExtendedAt: undefined,
      sotdQueuedAt: undefined,
      updatedAt: now,
    });
    await scheduleIndexNow(ctx, [...(await listingPaths(ctx, listing)), "/"]);
    return null;
  },
});

/** Reject (or unpublish) with a reason the owner sees. */
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
      sotdQueuedAt: undefined, // an unpublished site leaves the Site of the Day queue
      reviewNote,
      reviewedBy: admin._id,
      reviewedAt: now,
      updatedAt: now,
    });
    // Unpublished: engines recrawl and see the 404 (plus award pages it left).
    if (isPublicStatus(listing.status)) {
      await scheduleIndexNow(ctx, [...(await listingPaths(ctx, listing)), ...awardPaths(listing.awards)]);
    }
    return null;
  },
});

/**
 * Close a site's voting early (also used for testing): final score, then
 * Honorable Mention / Best Solo Creation and the Site of the Day queue, by
 * the same rules as the weekly close.
 */
export const closeVotingNow = mutation({
  args: { id: v.id("listings") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    if (!listing) fail("Listing not found.");
    if (listing.status !== "in_voting") fail("This site is not in voting.");
    try {
      await closeVoting(ctx, listing, await getConfig(ctx), Date.now());
    } catch (err) {
      fail((err as Error).message);
    }
    await scheduleIndexNow(ctx, await listingPaths(ctx, listing));
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
    // Ping the removed page so engines recrawl it and see the 404.
    const paths = isPublicStatus(listing.status)
      ? [...(await listingPaths(ctx, listing)), ...awardPaths(listing.awards)]
      : [];
    await deleteListing(ctx, listing);
    await scheduleIndexNow(ctx, paths);
    return null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Media replacement (bad automatic screenshots, better images from the owner)
// ─────────────────────────────────────────────────────────────────────────────

const mediaKind = v.union(v.literal("cover"), v.literal("video"));

async function swapMedia(
  ctx: Parameters<typeof deleteListing>[0],
  listing: Doc<"listings">,
  kind: "cover" | "video",
  storageId: Doc<"listings">["coverId"],
) {
  const label = kind === "cover" ? "Cover screenshot" : "Preview video";
  await assertMedia(ctx, storageId, label, kind === "video" ? "video" : "image");
  const field = kind === "cover" ? "coverId" : "videoId";
  const previous = listing[field];
  await ctx.db.patch(listing._id, { [field]: storageId, updatedAt: Date.now() });
  if (previous && previous !== storageId) await deleteMedia(ctx, previous);
}

/** Admin: replace a listing's cover screenshot or video. */
export const replaceMedia = mutation({
  args: { id: v.id("listings"), kind: mediaKind, storageId: vMediaId },
  returns: v.null(),
  handler: async (ctx, { id, kind, storageId }) => {
    await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    if (!listing) fail("Listing not found.");
    await swapMedia(ctx, listing, kind, storageId);
    return null;
  },
});

/** Admin: add one more screenshot (after the cover, up to LIMITS.gallery). */
export const addGalleryImage = mutation({
  args: { id: v.id("listings"), storageId: vMediaId },
  returns: v.null(),
  handler: async (ctx, { id, storageId }) => {
    await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    if (!listing) fail("Listing not found.");
    const galleryIds = await checkGallery(ctx, [...(listing.galleryIds ?? []), storageId]);
    await ctx.db.patch(id, { galleryIds, updatedAt: Date.now() });
    return null;
  },
});

/** Admin: remove one extra screenshot and its file. */
export const removeGalleryImage = mutation({
  args: { id: v.id("listings"), storageId: vMediaId },
  returns: v.null(),
  handler: async (ctx, { id, storageId }) => {
    await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    if (!listing) fail("Listing not found.");
    const gallery = listing.galleryIds ?? [];
    if (!gallery.includes(storageId)) fail("That screenshot is not on this listing.");
    const rest = gallery.filter((g) => g !== storageId);
    await ctx.db.patch(id, { galleryIds: rest.length ? rest : undefined, updatedAt: Date.now() });
    await deleteMedia(ctx, storageId);
    return null;
  },
});

/** Admin: reorder the extra screenshots (same ids, new order). */
export const setGalleryOrder = mutation({
  args: { id: v.id("listings"), galleryIds: v.array(vMediaId) },
  returns: v.null(),
  handler: async (ctx, { id, galleryIds }) => {
    await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    if (!listing) fail("Listing not found.");
    const current = listing.galleryIds ?? [];
    const same =
      galleryIds.length === current.length &&
      new Set(galleryIds).size === galleryIds.length &&
      galleryIds.every((g) => current.includes(g));
    if (!same) fail("The screenshots changed. Reload and try again.");
    await ctx.db.patch(id, { galleryIds, updatedAt: Date.now() });
    return null;
  },
});

/** Admin: make an extra screenshot the cover; the old cover takes its place. */
export const makeGalleryCover = mutation({
  args: { id: v.id("listings"), storageId: vMediaId },
  returns: v.null(),
  handler: async (ctx, { id, storageId }) => {
    await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    if (!listing) fail("Listing not found.");
    const gallery = listing.galleryIds ?? [];
    if (!gallery.includes(storageId)) fail("That screenshot is not on this listing.");
    await ctx.db.patch(id, {
      coverId: storageId,
      galleryIds: gallery.map((g) => (g === storageId ? listing.coverId : g)),
      updatedAt: Date.now(),
    });
    return null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Scheduled
// ─────────────────────────────────────────────────────────────────────────────

// Voting closes in awards.tick (convex/awards.ts), which also announces the
// Site of the Day and runs the monthly and yearly rounds.
