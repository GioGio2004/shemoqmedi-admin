import { hasJuryEvaluations } from "./jury";
import { ConvexError, v } from "convex/values";
import { deleteMedia, mediaUrl, vMediaId } from "./lib/media";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin, requireUser } from "./authHelpers";
import { award, creatorTier, listingStatus, pillars, region, withdrawableStatus } from "./schema";
import { claimLinkStatus, linkStatus } from "./lib/claimLinkRows";
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
  claimedListingPatch,
  cleanText,
  creatorByName,
  creatorForSubmission,
  deleteListing,
  fail,
  findOrCreateCreator,
  isDoFollow,
  isPublicStatus,
  judgingClosed,
  listingCategories,
  mediaUrls,
  normalizeUrl,
  ownerCanDelete,
  publicListing,
  restorePatch,
  scoreFields,
  toPublic,
  uniqueSlug,
  listingSlugBase,
} from "./lib/listingHelpers";
import { awardPaths, listingPaths, scheduleIndexNow } from "./seo";
import { pushAdmins } from "./push";
import { adminUrl } from "../lib/hosts";
import { rateLimit } from "./lib/rateLimit";

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

/**
 * The user's listings: the ones they own, and submissions they sent in that
 * nobody owns yet (a submitter only becomes the owner when an admin approves
 * it with ownership, or through a claim). Newest first.
 */
async function listingsOf(ctx: QueryCtx, userId: Id<"users">) {
  const owned = await ctx.db
    .query("listings")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .collect();
  const submitted = (
    await ctx.db
      .query("listings")
      .withIndex("by_submittedBy", (q) => q.eq("submittedBy", userId))
      .collect()
  ).filter((l) => l.ownerId === undefined);
  return [...owned, ...submitted].sort((a, b) => b._creationTime - a._creationTime);
}

/**
 * The checks `submit` makes that don't need the files, run before the form
 * uploads anything (audit A-08): someone whose site is already listed hears
 * it straight away instead of after the screenshots and video uploaded.
 * `submit` still runs every check itself.
 */
export const precheckSubmission = query({
  args: { url: v.string(), redesignOf: v.optional(v.string()) },
  returns: v.union(v.object({ ok: v.literal(true) }), v.object({ ok: v.literal(false), reason: v.string() })),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    let url: string;
    try {
      url = normalizeUrl(args.url);
    } catch (err) {
      return { ok: false as const, reason: err instanceof ConvexError ? String(err.data) : "Enter the site's address." };
    }
    const mine = await listingsOf(ctx, user._id);
    if (mine.filter((l) => l.status === "pending").length >= LIMITS.pendingPerUser) {
      return {
        ok: false as const,
        reason: `You already have ${LIMITS.pendingPerUser} sites waiting for review. Please wait for a decision first.`,
      };
    }
    const previous = args.redesignOf
      ? await ctx.db
          .query("listings")
          .withIndex("by_slug", (q) => q.eq("slug", args.redesignOf!))
          .first()
      : null;
    if (args.redesignOf && !previous) return { ok: false as const, reason: "The earlier listing for this redesign was not found." };
    const config = await getConfig(ctx);
    const domain = await checkDomain(ctx, url, { redesignOf: previous?._id, resubmitMonths: config.resubmitMonths, now: Date.now() });
    return domain.ok ? { ok: true as const } : { ok: false as const, reason: domain.reason };
  },
});

/**
 * Submit a site for review. It is created pending with the user recorded as
 * its submitter only: no ownership, no claim, no followed link and no claimed
 * creator profile until an admin approves it and chooses to hand ownership to
 * the submitter (approve with grantOwnership). The submitter can still see and
 * withdraw it (myListings / withdraw read submittedBy).
 */
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
    await rateLimit(ctx, "submitListing", user);

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

    await assertMedia(ctx, args.coverId, "Cover screenshot", "image", user);
    const galleryIds = await checkGallery(ctx, args.galleryIds, user);
    if (args.videoId) await assertMedia(ctx, args.videoId, "Preview video", "video", user);

    const mine = await listingsOf(ctx, user._id);
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

    // Unclaimed (new) or the submitter's own profile; unlinked when the name
    // belongs to someone else's claimed profile (lib/listingHelpers.ts).
    const creatorId = await creatorForSubmission(
      ctx,
      { name: creditName, tier: args.creatorTier, region: args.region, website: creditUrl },
      user._id,
    );

    const now = Date.now();
    const slug = await uniqueSlug(ctx, "listings", listingSlugBase(title, url));
    const id = await ctx.db.insert("listings", {
      submittedBy: user._id,
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
      // Not claimed (and so nofollow) until an admin gives the submitter ownership.
      isClaimed: false,
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
  /**
   * What the user's "remove" does: "delete" (never public, no awards: gone for
   * good), "archive" (hidden from the site, everything kept, restorable) or
   * null (nothing: a submission they sent but don't own once it is public,
   * or one already withdrawn, which offers restore instead).
   */
  removal: v.union(v.literal("delete"), v.literal("archive"), v.null()),
  /** Withdrawn by the owner: restore brings it back as it was. */
  canRestore: v.boolean(),
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
    const rows = await listingsOf(ctx, user._id);
    return Promise.all(
      rows.map(async (row) => ({
        id: row._id,
        slug: row.slug,
        title: row.title,
        url: row.url,
        status: row.status,
        reviewNote: row.reviewNote ?? null,
        awards: row.awards,
        // Even the owner waits for judging to close: a live score invites lobbying.
        finalScore: judgingClosed(row) ? (row.finalScore ?? null) : null,
        votingEndsAt: row.votingEndsAt ?? null,
        createdAt: row.createdAt,
        coverUrl: await mediaUrl(ctx, row.coverId),
        removal: await removalFor(ctx, row, user._id),
        canRestore: row.status === "withdrawn" && row.ownerId === user._id,
      })),
    );
  },
});

/** What withdrawing does for this user (see ownListing.removal). */
async function removalFor(ctx: QueryCtx, listing: Doc<"listings">, userId: Id<"users">) {
  if (listing.status === "withdrawn") return null;
  const owner = listing.ownerId === userId;
  const submitter = listing.ownerId === undefined && listing.submittedBy === userId;
  if (!owner && !submitter) return null;
  if (await ownerCanDelete(ctx, listing)) return "delete" as const;
  // Only a verified owner can take a site that has been public off the site.
  return owner ? ("archive" as const) : null;
}

/**
 * Withdraw your listing. A submission that never went public and never won
 * anything is deleted for good. Anything else (it has been public, or holds
 * an award, even a revoked one) is archived instead: status "withdrawn",
 * hidden from the site, with every award, vote, post and email kept so its
 * history stays whole and `restore` can bring it back as it was. Only the
 * owner can archive; the submitter of an unowned submission can only delete
 * it while it is still unpublished.
 */
export const withdraw = mutation({
  args: { id: v.id("listings") },
  returns: v.object({ result: v.union(v.literal("deleted"), v.literal("archived")) }),
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const listing = await ctx.db.get(id);
    const owner = listing?.ownerId === user._id;
    const submitter = listing?.ownerId === undefined && listing?.submittedBy === user._id;
    if (!listing || (!owner && !submitter)) fail("Listing not found.");
    if (listing.status === "withdrawn") fail("This site is already withdrawn.");
    const removal = await removalFor(ctx, listing, user._id);
    if (removal === "delete") {
      await deleteListing(ctx, listing, user);
      return { result: "deleted" as const };
    }
    if (removal !== "archive") fail("Only the site's owner can take it off the site. Ask us to transfer ownership.");
    const now = Date.now();
    await ctx.db.patch(id, {
      status: "withdrawn",
      withdrawnFrom: listing.status,
      withdrawnAt: now,
      // Out of the Site of the Day queue, as when an admin unpublishes it.
      sotdQueuedAt: undefined,
      updatedAt: now,
    });
    // Ping the hidden pages so engines recrawl them and see the 404.
    if (isPublicStatus(listing.status)) {
      await scheduleIndexNow(ctx, [...(await listingPaths(ctx, listing)), ...awardPaths(listing.awards)]);
    }
    return { result: "archived" as const };
  },
});

/** The owner brings a withdrawn listing back, in the status it had. */
export const restore = mutation({
  args: { id: v.id("listings") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const listing = await ctx.db.get(id);
    if (!listing || listing.ownerId !== user._id) fail("Listing not found.");
    if (listing.status !== "withdrawn") fail("This site is not withdrawn.");
    const patch = restorePatch(listing, Date.now());
    await ctx.db.patch(id, patch);
    if (isPublicStatus(patch.status)) {
      await scheduleIndexNow(ctx, [...(await listingPaths(ctx, listing)), ...awardPaths(listing.awards)]);
    }
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
  writeup: v.union(v.string(), v.null()), // "About this site"
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
  /**
   * Not linked to a creator, but "Made by" matches this existing profile (a
   * submission typed the name of a profile someone else has claimed). The
   * admin can link it when approving (approve linkCreator).
   */
  creditMatch: v.union(
    v.object({ slug: v.string(), name: v.string(), isClaimed: v.boolean() }),
    v.null(),
  ),
  source: v.union(v.literal("submission"), v.literal("import"), v.literal("seed")),
  status: listingStatus,
  /** Status "withdrawn": the status it had (restoring returns it there). */
  withdrawnFrom: v.union(withdrawableStatus, v.null()),
  withdrawnAt: v.union(v.number(), v.null()),
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
  /** Whether an unclaimed listing has an open claim link (admin only); never the link itself. */
  claimLink: claimLinkStatus,
  createdAt: v.number(),
  coverUrl: v.union(v.string(), v.null()),
  galleryUrls: v.array(v.string()),
  /** Extra screenshots with their ids, in order (for the admin media panel). */
  gallery: v.array(v.object({ id: vMediaId, url: v.union(v.string(), v.null()) })),
  videoUrl: v.union(v.string(), v.null()),
  /** Who sent the submission in (older submissions: their owner). */
  submitter: v.union(v.object({ name: v.string(), email: v.string() }), v.null()),
  /** The verified owner, if any. */
  owner: v.union(v.object({ name: v.string(), email: v.string() }), v.null()),
  /** Approve can hand ownership to the submitter: a submission nobody owns yet. */
  canGrantOwnership: v.boolean(),
});

async function jurorRef(ctx: Parameters<typeof mediaUrls>[0], id: Doc<"listings">["jurorId"]) {
  const juror = id ? await ctx.db.get(id) : null;
  return juror ? { id: juror._id, name: juror.name, claimed: juror.status !== "unclaimed" } : null;
}

async function toReview(ctx: Parameters<typeof mediaUrls>[0], listing: Doc<"listings">) {
  const owner = listing.ownerId ? await ctx.db.get(listing.ownerId) : null;
  const submitter = listing.submittedBy ? await ctx.db.get(listing.submittedBy) : owner;
  const creator = listing.creatorId ? await ctx.db.get(listing.creatorId) : null;
  const match = creator ? null : await creatorByName(ctx, listing.creditName);
  return {
    id: listing._id,
    slug: listing.slug,
    title: listing.title,
    tagline: listing.tagline,
    juryNote: listing.juryNote ?? null,
    writeup: listing.writeup ?? null,
    url: listing.url,
    categories: listingCategories(listing),
    categoryNames: listingCategories(listing).map(categoryName),
    technologies: listing.technologies,
    region: listing.region,
    creatorTier: listing.creatorTier,
    creditName: listing.creditName,
    creditUrl: listing.creditUrl ?? null,
    creator: creator ? { slug: creator.slug, name: creator.name, isClaimed: creator.isClaimed } : null,
    creditMatch: match ? { slug: match.slug, name: match.name, isClaimed: match.isClaimed } : null,
    source: listing.source,
    status: listing.status,
    withdrawnFrom: listing.withdrawnFrom ?? null,
    withdrawnAt: listing.withdrawnAt ?? null,
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
    claimLink: listing.isClaimed ? null : await linkStatus(ctx, { kind: "listing", id: listing._id }, listing),
    createdAt: listing.createdAt,
    ...(await mediaUrls(ctx, listing)),
    gallery: await Promise.all(
      (listing.galleryIds ?? []).map(async (id) => ({ id, url: await mediaUrl(ctx, id) })),
    ),
    submitter: submitter ? { name: submitter.name, email: submitter.email } : null,
    owner: owner ? { name: owner.name, email: owner.email } : null,
    canGrantOwnership: listing.submittedBy !== undefined && listing.ownerId === undefined,
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
    withdrawn: v.number(),
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
      withdrawn: await count("withdrawn"),
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
 *
 * Ownership is the admin's explicit choice, never implied by submitting:
 * grantOwnership hands the listing to its submitter (claimed, followed links,
 * shown in their account as theirs) and, when its creator profile is
 * unclaimed and credits nothing else, that profile too. Without it the site
 * goes public unowned (nofollow; a claim link or request can hand it over
 * later). linkCreator links an unlinked submission to the existing profile
 * its "Made by" matches (see reviewListing.creditMatch); without it an
 * unlinked submission gets a new unclaimed profile only if the name is free.
 */
export const approve = mutation({
  args: {
    id: v.id("listings"),
    grantOwnership: v.optional(v.boolean()),
    linkCreator: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { id, grantOwnership, linkCreator }) => {
    const admin = await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    if (!listing) fail("Listing not found.");
    if (listing.status !== "pending" && listing.status !== "rejected") {
      fail("Only pending or rejected sites can be approved.");
    }
    const now = Date.now();
    const extra: Partial<Doc<"listings">> = {};
    let creatorId = listing.creatorId;
    if (!creatorId) {
      const match = await creatorByName(ctx, listing.creditName);
      if (match && linkCreator) creatorId = match._id;
      else if (!match) {
        creatorId = await findOrCreateCreator(ctx, {
          name: listing.creditName,
          tier: listing.creatorTier,
          region: listing.region,
          website: listing.creditUrl,
        });
      }
      if (creatorId) extra.creatorId = creatorId;
    }
    if (grantOwnership) {
      const submitter = listing.ownerId === undefined ? listing.submittedBy : undefined;
      if (!submitter) fail("This site has no submitter to give ownership to.");
      Object.assign(extra, claimedListingPatch(listing, submitter, now));
      const creator = creatorId ? await ctx.db.get(creatorId) : null;
      if (creator && !creator.isClaimed) {
        const credits = await ctx.db
          .query("listings")
          .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
          .take(2);
        // A profile that credits other sites may be a real studio: that goes through a claim request.
        if (credits.every((l) => l._id === id)) {
          await ctx.db.patch(creator._id, { isClaimed: true, claimedBy: submitter, updatedAt: now });
        }
      }
    }
    await ctx.db.patch(id, {
      ...extra,
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

/**
 * Admin: delete a listing for good, with what points at it (lib/listingHelpers.ts
 * deleteListing). Refused while it holds an active award: revoke it first.
 */
export const remove = mutation({
  args: { id: v.id("listings") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const admin = await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    if (!listing) fail("Listing not found.");
    // Ping the removed page so engines recrawl it and see the 404.
    const paths = isPublicStatus(listing.status)
      ? [...(await listingPaths(ctx, listing)), ...awardPaths(listing.awards)]
      : [];
    await deleteListing(ctx, listing, admin);
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
  by: Doc<"users">,
) {
  const label = kind === "cover" ? "Cover screenshot" : "Preview video";
  await assertMedia(ctx, storageId, label, kind === "video" ? "video" : "image", by);
  const field = kind === "cover" ? "coverId" : "videoId";
  const previous = listing[field];
  await ctx.db.patch(listing._id, { [field]: storageId, updatedAt: Date.now() });
  if (previous && previous !== storageId) await deleteMedia(ctx, previous, by);
}

/** Admin: replace a listing's cover screenshot or video. */
export const replaceMedia = mutation({
  args: { id: v.id("listings"), kind: mediaKind, storageId: vMediaId },
  returns: v.null(),
  handler: async (ctx, { id, kind, storageId }) => {
    const admin = await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    if (!listing) fail("Listing not found.");
    await swapMedia(ctx, listing, kind, storageId, admin);
    return null;
  },
});

/** Admin: add one more screenshot (after the cover, up to LIMITS.gallery). */
export const addGalleryImage = mutation({
  args: { id: v.id("listings"), storageId: vMediaId },
  returns: v.null(),
  handler: async (ctx, { id, storageId }) => {
    const admin = await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    if (!listing) fail("Listing not found.");
    const galleryIds = await checkGallery(ctx, [...(listing.galleryIds ?? []), storageId], admin);
    await ctx.db.patch(id, { galleryIds, updatedAt: Date.now() });
    return null;
  },
});

/** Admin: remove one extra screenshot and its file. */
export const removeGalleryImage = mutation({
  args: { id: v.id("listings"), storageId: vMediaId },
  returns: v.null(),
  handler: async (ctx, { id, storageId }) => {
    const admin = await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    if (!listing) fail("Listing not found.");
    const gallery = listing.galleryIds ?? [];
    if (!gallery.includes(storageId)) fail("That screenshot is not on this listing.");
    const rest = gallery.filter((g) => g !== storageId);
    await ctx.db.patch(id, { galleryIds: rest.length ? rest : undefined, updatedAt: Date.now() });
    await deleteMedia(ctx, storageId, admin);
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
