// Full admin control: create listings by hand (own screenshots), edit every
// field, override the lifecycle (status, voting window, awards), remove media,
// and manage creators and user roles. Every function requires an admin.

import { v } from "convex/values";
import { deleteMedia, mediaUrl, vMediaId } from "./lib/media";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireAdmin } from "./authHelpers";
import { award, creatorTier, listingStatus, pillars, region } from "./schema";
import { DAY_MS, LIMITS, VOTING_DAYS, isTechnology } from "./lib/taxonomy";
import { normalizePillars, type Pillars } from "./lib/scoring";
import { batchVotingEnds, tbilisiDay, tbilisiMonth, tbilisiYear, weekOf } from "./lib/time";
import { checkDomain, domainKey, listingsOnDomain } from "./lib/domains";
import { getConfig } from "./lib/config";
import { grantAward } from "./lib/awards";
import {
  EMPTY_SCORES,
  assertMedia,
  checkCategories,
  checkGallery,
  cleanText,
  deleteListing,
  fail,
  findOrCreateCreator,
  isPublicStatus,
  listingSlugTaken,
  normalizeUrl,
  previousSlugsAfterRename,
  scoreFields,
  slugify,
  uniqueSlug,
} from "./lib/listingHelpers";
import { hasJuryEvaluations } from "./jury";
import { awardPaths, creatorPath, listingPaths, scheduleIndexNow, sitePath } from "./seo";

// ─────────────────────────────────────────────────────────────────────────────
// Shared validation
// ─────────────────────────────────────────────────────────────────────────────

function checkTechnologies(technologies: string[]) {
  const unique = [...new Set(technologies)];
  if (unique.length > LIMITS.technologies) fail(`Choose up to ${LIMITS.technologies} technologies.`);
  if (!unique.every(isTechnology)) fail("Unknown technology selected.");
  return unique;
}

function checkPillars(scores: Pillars | undefined) {
  if (!scores) return undefined;
  try {
    return normalizePillars(scores);
  } catch (err) {
    fail((err as Error).message);
  }
}

/**
 * A listing's new URL may not point at a website another listing has,
 * unless the two are the same site's redesign chain.
 */
async function assertDomainFree(ctx: Parameters<typeof deleteListing>[0], url: string, self: Doc<"listings">) {
  const others = (await listingsOnDomain(ctx, domainKey(url))).filter(
    (r) => r._id !== self._id && r.status !== "rejected" && r._id !== self.redesignOf && r.redesignOf !== self._id,
  );
  if (others.length) fail(`Another listing (“${others[0].title}”) already uses this website.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Listings
// ─────────────────────────────────────────────────────────────────────────────

/** Create a listing by hand with your own screenshots, in any lifecycle state. */
export const createListing = mutation({
  args: {
    title: v.string(),
    tagline: v.string(),
    juryNote: v.optional(v.string()),
    url: v.string(),
    categories: v.array(v.string()), // primary first
    technologies: v.array(v.string()),
    region,
    creatorTier,
    creditName: v.string(),
    creditUrl: v.optional(v.string()),
    coverId: vMediaId,
    galleryIds: v.optional(v.array(vMediaId)),
    videoId: v.optional(vMediaId),
    status: v.union(
      v.literal("pending"),
      v.literal("in_voting"),
      v.literal("awarded"),
      v.literal("archived"),
    ),
    votingEndsAt: v.optional(v.number()), // in_voting: when voting closes (default: end of next week, its batch's judging week)
    editorialScores: v.optional(pillars),
    // awarded: at least one. Logged as a manual award, so it needs awardReason.
    awards: v.optional(v.array(award)),
    awardReason: v.optional(v.string()),
    // A significant redesign of this earlier listing (same website).
    redesignOf: v.optional(v.id("listings")),
    isClaimed: v.boolean(),
    isStartup: v.optional(v.boolean()),
    // Pre-created for this juror: their claim link claims this listing too.
    jurorId: v.optional(v.id("jurors")),
  },
  returns: v.object({ id: v.id("listings"), slug: v.string() }),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const title = cleanText(args.title, "Site title", LIMITS.title);
    const tagline = cleanText(args.tagline, "Short description", LIMITS.tagline, false);
    const juryNote = cleanText(args.juryNote ?? "", "Jury note", LIMITS.juryNote, false) || undefined;
    const creditName = cleanText(args.creditName, "Made by", LIMITS.creditName);
    const url = normalizeUrl(args.url);
    const creditUrl = args.creditUrl?.trim() ? normalizeUrl(args.creditUrl, "Creator website") : undefined;
    const categories = checkCategories(args.categories);
    const technologies = checkTechnologies(args.technologies);
    const editorialScores = checkPillars(args.editorialScores);
    const awards = [...new Set(args.awards ?? [])];
    if (args.status === "awarded" && awards.length === 0) fail("Pick at least one award for an awarded site.");
    if (args.status === "awarded" && !args.awardReason?.trim()) {
      fail("Give a reason for the awards (it goes in the award log).");
    }

    await assertMedia(ctx, args.coverId, "Cover screenshot", "image");
    const galleryIds = await checkGallery(ctx, args.galleryIds);
    if (args.videoId) await assertMedia(ctx, args.videoId, "Preview video", "video");
    const config = await getConfig(ctx);
    const domain = await checkDomain(ctx, url, {
      redesignOf: args.redesignOf,
      resubmitMonths: config.resubmitMonths,
      now: Date.now(),
    });
    if (!domain.ok) fail(domain.reason);
    if (args.jurorId && !(await ctx.db.get(args.jurorId))) fail("That juror no longer exists.");

    const creatorId = await findOrCreateCreator(ctx, {
      name: creditName,
      tier: args.creatorTier,
      region: args.region,
      website: creditUrl,
    });

    const now = Date.now();
    let publishedAt: number | undefined;
    let votingEndsAt: number | undefined;
    if (args.status === "in_voting") {
      votingEndsAt = args.votingEndsAt ?? batchVotingEnds(weekOf(now));
      if (votingEndsAt <= now) fail("The voting end date must be in the future.");
      publishedAt = now;
    } else if (args.status === "awarded" || args.status === "archived") {
      votingEndsAt = Math.min(args.votingEndsAt ?? now, now);
      publishedAt = votingEndsAt - VOTING_DAYS * DAY_MS;
    }

    const slug = await uniqueSlug(ctx, "listings", slugify(title));
    const id = await ctx.db.insert("listings", {
      creatorId,
      source: "import",
      submissionTier: "standard",
      slug,
      title,
      tagline,
      juryNote,
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
      // Awarded: created closed, then each award is given through the award rules.
      status: args.status === "awarded" ? "archived" : args.status,
      batchWeek: args.status === "in_voting" ? weekOf(now) : undefined,
      domainKey: domainKey(url),
      redesignOf: domain.redesignOf,
      reviewedBy: args.status === "pending" ? undefined : admin._id,
      reviewedAt: args.status === "pending" ? undefined : now,
      publishedAt,
      votingEndsAt,
      ...EMPTY_SCORES,
      editorialScores,
      ...scoreFields(editorialScores, EMPTY_SCORES.communityTotals, 0),
      awards: [],
      isClaimed: args.isClaimed,
      isStartup: args.isStartup || undefined,
      jurorId: args.jurorId,
      createdAt: now,
      updatedAt: now,
    });
    if (args.status !== "pending") {
      await scheduleIndexNow(ctx, [
        ...(await listingPaths(ctx, { slug, creatorId })),
        "/",
      ]);
    }
    if (args.status === "awarded") {
      const created = (await ctx.db.get(id))!;
      for (const tier of awards) {
        try {
          await grantAward(ctx, {
            listingId: id,
            tier,
            period: tier === "SOTM" ? tbilisiMonth(now) : tier === "SOTY" ? tbilisiYear(now) : tbilisiDay(now),
            score: created.finalScore ?? null,
            now,
            source: "manual",
            actorId: admin._id,
            reason: args.awardReason,
          });
        } catch (err) {
          fail((err as Error).message);
        }
      }
    }
    return { id, slug };
  },
});

/** Edit any descriptive field. Changing "Made by" relinks the creator profile. */
export const updateListing = mutation({
  args: {
    id: v.id("listings"),
    title: v.optional(v.string()),
    slug: v.optional(v.string()),
    tagline: v.optional(v.string()),
    juryNote: v.optional(v.string()), // "" clears it
    url: v.optional(v.string()),
    categories: v.optional(v.array(v.string())), // primary first
    technologies: v.optional(v.array(v.string())),
    region: v.optional(region),
    creatorTier: v.optional(creatorTier),
    creditName: v.optional(v.string()),
    creditUrl: v.optional(v.string()), // "" clears it
    isClaimed: v.optional(v.boolean()),
    isStartup: v.optional(v.boolean()),
    jurorId: v.optional(v.union(v.id("jurors"), v.null())), // null unlinks
    // Outbound link follow state: true/false sets it, null returns to automatic (followed once claimed).
    isDoFollow: v.optional(v.union(v.boolean(), v.null())),
  },
  returns: v.object({ slug: v.string() }),
  handler: async (ctx, { id, ...args }) => {
    await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    if (!listing) fail("Listing not found.");
    const patch: Partial<Doc<"listings">> = {};

    if (args.title !== undefined) patch.title = cleanText(args.title, "Site title", LIMITS.title);
    if (args.tagline !== undefined) patch.tagline = cleanText(args.tagline, "Short description", LIMITS.tagline, false);
    if (args.juryNote !== undefined) {
      patch.juryNote = cleanText(args.juryNote, "Jury note", LIMITS.juryNote, false) || undefined;
    }
    if (args.url !== undefined) {
      patch.url = normalizeUrl(args.url);
      if (patch.url !== listing.url) await assertDomainFree(ctx, patch.url, listing);
      patch.domainKey = domainKey(patch.url);
    }
    if (args.slug !== undefined) {
      const wanted = slugify(args.slug, "");
      if (!wanted) fail("The page address can only use letters, numbers and dashes.");
      if (wanted !== listing.slug) {
        // Another listing's old address counts as taken: it redirects there.
        if (await listingSlugTaken(ctx, wanted, id)) fail(`/sites/${wanted} is already taken.`);
        patch.slug = wanted;
        // The old address keeps working: the site 308s it to the new slug.
        patch.previousSlugs = previousSlugsAfterRename(listing, wanted);
      }
    }
    if (args.categories !== undefined) {
      patch.categories = checkCategories(args.categories);
      patch.category = patch.categories[0];
    }
    if (args.technologies !== undefined) patch.technologies = checkTechnologies(args.technologies);
    if (args.region !== undefined) patch.region = args.region;
    if (args.creatorTier !== undefined) patch.creatorTier = args.creatorTier;
    if (args.creditUrl !== undefined) {
      patch.creditUrl = args.creditUrl.trim() ? normalizeUrl(args.creditUrl, "Creator website") : undefined;
    }
    if (args.isClaimed !== undefined) {
      patch.isClaimed = args.isClaimed;
      // A claimed listing has no open claim link.
      if (args.isClaimed && listing.claimToken) {
        patch.claimToken = undefined;
        patch.claimTokenUsed = listing.claimToken;
      }
    }
    if (args.isStartup !== undefined) patch.isStartup = args.isStartup || undefined;
    if (args.jurorId !== undefined) {
      if (args.jurorId && !(await ctx.db.get(args.jurorId))) fail("That juror no longer exists.");
      patch.jurorId = args.jurorId ?? undefined;
    }
    if (args.isDoFollow !== undefined) patch.isDoFollow = args.isDoFollow ?? undefined;
    if (args.creditName !== undefined) {
      const creditName = cleanText(args.creditName, "Made by", LIMITS.creditName);
      if (creditName !== listing.creditName) {
        patch.creditName = creditName;
        patch.creatorId = await findOrCreateCreator(ctx, {
          name: creditName,
          tier: patch.creatorTier ?? listing.creatorTier,
          region: patch.region ?? listing.region,
          website: "creditUrl" in patch ? patch.creditUrl : listing.creditUrl,
        });
      }
    }

    await ctx.db.patch(id, { ...patch, updatedAt: Date.now() });
    if (isPublicStatus(listing.status) && Object.keys(patch).length > 0) {
      // New page + creator page, and the old ones (old slug now redirects,
      // the old creator may have lost a listing). Duplicates are dropped.
      await scheduleIndexNow(ctx, [
        ...(await listingPaths(ctx, { ...listing, ...patch })),
        ...(await listingPaths(ctx, listing)),
      ]);
    }
    return { slug: patch.slug ?? listing.slug };
  },
});

/**
 * Lifecycle override: move a listing to another status and set its voting
 * window by hand. Scores are kept. Awards are not set here: they are given
 * and revoked on the Awards page (awards.grant / awards.revoke), where each
 * change needs a reason and is logged. A site with active awards can only be
 * unpublished (rejected) until they are revoked.
 */
export const setLifecycle = mutation({
  args: {
    id: v.id("listings"),
    status: listingStatus,
    votingEndsAt: v.optional(v.number()),
    note: v.optional(v.string()), // reason shown to the owner when rejected
  },
  returns: v.null(),
  handler: async (ctx, { id, status, votingEndsAt, note }) => {
    const admin = await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    if (!listing) fail("Listing not found.");
    const now = Date.now();
    if (status === "awarded") fail("Give awards on the Awards page: each one needs a reason and is logged.");
    if (listing.awards.length > 0 && status !== "rejected") {
      fail(`Revoke this site's awards (${listing.awards.join(", ")}) on the Awards page first.`);
    }
    const scores = scoreFields(listing.editorialScores, listing.communityTotals, listing.communityVotesCount);
    const base = { status, reviewedBy: admin._id, reviewedAt: now, updatedAt: now, ...scores };

    switch (status) {
      case "in_voting": {
        const keepWindow = listing.status === "in_voting" && listing.publishedAt !== undefined;
        const ends = votingEndsAt ?? (keepWindow ? listing.votingEndsAt! : batchVotingEnds(weekOf(now)));
        if (ends <= now) fail("The voting end date must be in the future.");
        await ctx.db.patch(id, {
          ...base,
          votingEndsAt: ends,
          publishedAt: keepWindow ? listing.publishedAt : now,
          batchWeek: keepWindow ? listing.batchWeek : weekOf(now),
          votingExtendedAt: undefined,
          sotdQueuedAt: undefined,
          reviewNote: undefined,
        });
        break;
      }
      case "archived": {
        const ends = Math.min(listing.votingEndsAt ?? now, now);
        await ctx.db.patch(id, {
          ...base,
          votingEndsAt: ends,
          publishedAt: listing.publishedAt ?? ends - VOTING_DAYS * DAY_MS,
          reviewNote: undefined,
        });
        break;
      }
      case "rejected": {
        const reviewNote = cleanText(note ?? "", "Reason", LIMITS.reviewNote);
        // Awards stay on record (and come back if it is re-published); the queue place does not.
        await ctx.db.patch(id, { ...base, reviewNote, sotdQueuedAt: undefined });
        break;
      }
      case "pending": {
        await ctx.db.patch(id, { ...base, reviewNote: undefined, sotdQueuedAt: undefined });
        break;
      }
    }

    const wasPublic = isPublicStatus(listing.status);
    if (wasPublic || isPublicStatus(status)) {
      await scheduleIndexNow(ctx, [
        ...(await listingPaths(ctx, listing)),
        wasPublic ? null : "/", // newly published
        ...awardPaths(listing.awards),
      ]);
    }
    return null;
  },
});

/** Remove the jury score entirely (back to "not scored"). */
export const clearEditorialScores = mutation({
  args: { id: v.id("listings") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    if (!listing) fail("Listing not found.");
    if (await hasJuryEvaluations(ctx, id)) {
      fail("This site's jury score is the average of its jury evaluations. Remove an evaluation to change it.");
    }
    await ctx.db.patch(id, {
      editorialScores: undefined,
      ...scoreFields(undefined, listing.communityTotals, listing.communityVotesCount),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Remove the preview video (the cover screenshot is required). */
export const removeMedia = mutation({
  args: { id: v.id("listings"), kind: v.literal("video") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    if (!listing) fail("Listing not found.");
    const current = listing.videoId;
    if (!current) return null;
    await ctx.db.patch(id, { videoId: undefined, updatedAt: Date.now() });
    await deleteMedia(ctx, current);
    return null;
  },
});


/** Wipe the community votes on a listing (e.g. after detecting abuse). */
export const resetVotes = mutation({
  args: { id: v.id("listings") },
  returns: v.number(),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    if (!listing) fail("Listing not found.");
    const votes = await ctx.db
      .query("votes")
      .withIndex("by_listing", (q) => q.eq("listingId", id))
      .collect();
    for (const vote of votes) await ctx.db.delete(vote._id);
    await ctx.db.patch(id, {
      communityTotals: EMPTY_SCORES.communityTotals,
      communityVotesCount: 0,
      ...scoreFields(listing.editorialScores, EMPTY_SCORES.communityTotals, 0),
      updatedAt: Date.now(),
    });
    return votes.length;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Creators
// ─────────────────────────────────────────────────────────────────────────────

const adminCreator = v.object({
  id: v.id("creators"),
  slug: v.string(),
  name: v.string(),
  tier: creatorTier,
  region,
  location: v.union(v.string(), v.null()),
  website: v.union(v.string(), v.null()),
  links: v.array(v.string()),
  bio: v.union(v.string(), v.null()),
  isClaimed: v.boolean(),
  claimedBy: v.union(v.object({ name: v.string(), email: v.string() }), v.null()),
  listings: v.number(),
  createdAt: v.number(),
});

export const listCreators = query({
  args: {},
  returns: v.array(adminCreator),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const creators = await ctx.db.query("creators").order("desc").take(1000);
    return Promise.all(
      creators.map(async (c) => {
        const listings = await ctx.db
          .query("listings")
          .withIndex("by_creator", (q) => q.eq("creatorId", c._id))
          .take(1000);
        const owner = c.claimedBy ? await ctx.db.get(c.claimedBy) : null;
        return {
          id: c._id,
          slug: c.slug,
          name: c.name,
          tier: c.tier,
          region: c.region,
          location: c.location ?? null,
          website: c.website ?? null,
          links: c.links ?? [],
          bio: c.bio ?? null,
          isClaimed: c.isClaimed,
          claimedBy: owner ? { name: owner.name, email: owner.email } : null,
          listings: listings.length,
          createdAt: c.createdAt,
        };
      }),
    );
  },
});

/** Edit a creator profile. Renaming also updates "Made by" on their listings. */
export const updateCreator = mutation({
  args: {
    id: v.id("creators"),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
    tier: v.optional(creatorTier),
    region: v.optional(region),
    location: v.optional(v.string()), // "" clears
    website: v.optional(v.string()), // "" clears
    links: v.optional(v.array(v.string())), // [] clears
    bio: v.optional(v.string()), // "" clears
    isClaimed: v.optional(v.boolean()),
  },
  returns: v.object({ slug: v.string() }),
  handler: async (ctx, { id, ...args }) => {
    await requireAdmin(ctx);
    const creator = await ctx.db.get(id);
    if (!creator) fail("Creator not found.");
    const patch: Partial<Doc<"creators">> = {};
    if (args.name !== undefined) patch.name = cleanText(args.name, "Name", LIMITS.creditName);
    if (args.slug !== undefined) {
      const wanted = slugify(args.slug, "");
      if (!wanted) fail("The profile address can only use letters, numbers and dashes.");
      if (wanted !== creator.slug) {
        const taken = await ctx.db
          .query("creators")
          .withIndex("by_slug", (q) => q.eq("slug", wanted))
          .first();
        if (taken) fail(`/creators/${wanted} is already taken.`);
        patch.slug = wanted;
      }
    }
    if (args.tier !== undefined) patch.tier = args.tier;
    if (args.region !== undefined) patch.region = args.region;
    if (args.location !== undefined) patch.location = cleanText(args.location, "Location", 80, false) || undefined;
    if (args.website !== undefined) patch.website = args.website.trim() ? normalizeUrl(args.website, "Website") : undefined;
    if (args.bio !== undefined) patch.bio = cleanText(args.bio, "Bio", 600, false) || undefined;
    if (args.links !== undefined) {
      const links = [
        ...new Set(args.links.map((l) => l.trim()).filter(Boolean).map((l) => normalizeUrl(l, "Profile link"))),
      ];
      if (links.length > LIMITS.creatorLinks) fail(`Add up to ${LIMITS.creatorLinks} profile links.`);
      patch.links = links.length ? links : undefined;
    }
    if (args.isClaimed !== undefined) {
      patch.isClaimed = args.isClaimed;
      if (!args.isClaimed) patch.claimedBy = undefined;
    }
    const now = Date.now();
    await ctx.db.patch(id, { ...patch, updatedAt: now });

    const renamed = Boolean(patch.name && patch.name !== creator.name);
    const listings = await ctx.db
      .query("listings")
      .withIndex("by_creator", (q) => q.eq("creatorId", id))
      .take(1000);
    if (renamed) {
      for (const l of listings) await ctx.db.patch(l._id, { creditName: patch.name, updatedAt: now });
    }

    // The profile is public only while it has a public listing.
    const live = listings.filter((l) => isPublicStatus(l.status));
    if (live.length > 0 && Object.keys(patch).length > 0) {
      await scheduleIndexNow(ctx, [
        creatorPath(patch.slug ?? creator.slug),
        patch.slug ? creatorPath(creator.slug) : null, // old address
        // "Made by" changed on each listing page too.
        ...(renamed ? live.map((l) => sitePath(l.slug)) : []),
      ]);
    }
    return { slug: patch.slug ?? creator.slug };
  },
});

/** Delete a creator profile that no listing uses any more. */
export const deleteCreator = mutation({
  args: { id: v.id("creators") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const used = await ctx.db
      .query("listings")
      .withIndex("by_creator", (q) => q.eq("creatorId", id))
      .first();
    if (used) fail("This creator still has listings. Move or delete them first.");
    const claims = await ctx.db
      .query("claims")
      .withIndex("by_creator", (q) => q.eq("creatorId", id))
      .collect();
    for (const c of claims) await ctx.db.delete(c._id);
    await ctx.db.delete(id);
    return null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Users and roles
// ─────────────────────────────────────────────────────────────────────────────

const roleValue = v.union(v.literal("admin"), v.literal("super_admin"), v.null());

export const listUsers = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("users"),
      name: v.string(),
      email: v.string(),
      role: roleValue,
      listings: v.number(),
      votes: v.number(),
      createdAt: v.number(),
      isYou: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const me = await requireAdmin(ctx);
    const users = await ctx.db.query("users").order("desc").take(1000);
    return Promise.all(
      users.map(async (u) => ({
        id: u._id,
        name: u.name,
        email: u.email,
        role: u.role ?? null,
        listings: (
          await ctx.db
            .query("listings")
            .withIndex("by_owner", (q) => q.eq("ownerId", u._id))
            .take(1000)
        ).length,
        votes: (
          await ctx.db
            .query("votes")
            .withIndex("by_user", (q) => q.eq("userId", u._id))
            .take(1000)
        ).length,
        createdAt: u.createdAt,
        isYou: u._id === me._id,
      })),
    );
  },
});

/**
 * Grant or remove admin. Only a super admin can create or remove another
 * super admin, and nobody can change their own role (so the panel never locks out).
 */
export const setUserRole = mutation({
  args: { userId: v.id("users"), role: roleValue },
  returns: v.null(),
  handler: async (ctx, { userId, role }) => {
    const me = await requireAdmin(ctx);
    const target = await ctx.db.get(userId);
    if (!target) fail("User not found.");
    if (target._id === me._id) fail("You can't change your own role.");
    if ((role === "super_admin" || target.role === "super_admin") && me.role !== "super_admin") {
      fail("Only a super admin can grant or remove super admin.");
    }
    await ctx.db.patch(userId, { role: role ?? undefined, updatedAt: Date.now() });
    return null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// CLI only
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delete every listing (with its screenshots, votes and claims) and every
 * creator profile. CLI only:  npx convex run admin:wipeShowcase '{"confirm":"DELETE"}'
 * Works in batches; repeat until it returns done: true.
 */
export const wipeShowcase = internalMutation({
  args: { confirm: v.literal("DELETE") },
  returns: v.object({ listings: v.number(), creators: v.number(), done: v.boolean() }),
  handler: async (ctx) => {
    const listings = await ctx.db.query("listings").take(50);
    for (const l of listings) await deleteListing(ctx, l);
    let creators = 0;
    if (listings.length < 50) {
      const rows = await ctx.db.query("creators").take(200);
      for (const c of rows) {
        const claims = await ctx.db
          .query("claims")
          .withIndex("by_creator", (q) => q.eq("creatorId", c._id))
          .collect();
        for (const claim of claims) await ctx.db.delete(claim._id);
        await ctx.db.delete(c._id);
        creators++;
      }
    }
    const remaining = (await ctx.db.query("listings").first()) ?? (await ctx.db.query("creators").first());
    return { listings: listings.length, creators, done: remaining === null };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Featured header (home page slider)
// ─────────────────────────────────────────────────────────────────────────────

const featuredOption = v.object({
  id: v.id("listings"),
  slug: v.string(),
  title: v.string(),
  creditName: v.string(),
  status: listingStatus,
  awards: v.array(award),
  coverUrl: v.union(v.string(), v.null()),
  featuredRank: v.union(v.number(), v.null()),
  publishedAt: v.number(),
});

/**
 * Admin: every live listing (it has a /sites page), featured ones first in
 * header order, then the rest newest first. Only these can be featured.
 */
export const featuredOptions = query({
  args: {},
  returns: v.array(featuredOption),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = (await ctx.db.query("listings").take(1000)).filter((l) => isPublicStatus(l.status));
    const out = await Promise.all(
      rows.map(async (l) => ({
        id: l._id,
        slug: l.slug,
        title: l.title,
        creditName: l.creditName,
        status: l.status,
        awards: l.awards,
        coverUrl: await mediaUrl(ctx, l.coverId),
        featuredRank: l.featuredRank ?? null,
        publishedAt: l.publishedAt ?? l.createdAt,
      })),
    );
    return out.sort(
      (a, b) =>
        (a.featuredRank ?? Infinity) - (b.featuredRank ?? Infinity) || b.publishedAt - a.publishedAt,
    );
  },
});

/**
 * Admin: set the featured header, in order (first = first slide). Replaces
 * the whole list; an empty list hands the header back to the automatic
 * order (award winners, top scores, newest).
 */
export const setFeatured = mutation({
  args: { ids: v.array(v.id("listings")) },
  returns: v.null(),
  handler: async (ctx, { ids }) => {
    await requireAdmin(ctx);
    if (new Set(ids).size !== ids.length) fail("A site is in the featured list twice.");
    if (ids.length > LIMITS.featured) fail(`Feature up to ${LIMITS.featured} sites.`);
    for (const id of ids) {
      const listing = await ctx.db.get(id);
      if (!listing) fail("One of these sites no longer exists. Reload and try again.");
      if (!isPublicStatus(listing.status)) fail(`“${listing.title}” is not live yet, so it can't be featured.`);
      if (!(await mediaUrl(ctx, listing.coverId))) fail(`“${listing.title}” has no cover screenshot.`);
    }
    // Not a content change: updatedAt (sitemap lastmod) stays as it is.
    for (const listing of await ctx.db.query("listings").take(1000)) {
      const rank = ids.indexOf(listing._id);
      const next = rank === -1 ? undefined : rank + 1;
      if (listing.featuredRank !== next) await ctx.db.patch(listing._id, { featuredRank: next });
    }
    return null;
  },
});
