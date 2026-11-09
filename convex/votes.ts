import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUser } from "./authHelpers";
import { getUserByExternalId } from "./users";
import { pillars } from "./schema";
import { addPillars, normalizePillars, readPillars } from "./lib/scoring";
import { fail, isPublicStatus, scoreFields } from "./lib/listingHelpers";

/**
 * Community voting. One vote per signed-in user per listing, only while the
 * listing's voting window is open, never on your own site, and only for
 * creators who already hold a badge: at least one other site of theirs has
 * been listed (Official Nominee or an award). Tighten earnedBadge() to raise
 * the bar later (e.g. award winners only).
 */

const OWN_SITE = "You can't vote on your own site.";
export const NO_BADGE =
  "Community voting is open to creators with a site of their own listed here. Get one of your sites listed first.";

/** True when the user made, owns or was pre-assigned this listing. */
async function isOwnSite(ctx: QueryCtx, listing: Doc<"listings">, userId: Id<"users">) {
  if (listing.ownerId === userId) return true;
  if (listing.creatorId) {
    const creator = await ctx.db.get(listing.creatorId);
    if (creator?.claimedBy === userId) return true;
  }
  if (listing.jurorId) {
    const juror = await ctx.db.get(listing.jurorId);
    if (juror?.userId === userId) return true;
  }
  return false;
}

/**
 * Whether the user holds at least one badge from a listing other than
 * `except`: a public (nominated or awarded) site they own (submitted, or
 * claimed by link or approved request), or an unowned site credited to a
 * creator profile an admin confirmed is theirs (approved claim request).
 * Merely submitting under a creator name doesn't count: that would let anyone
 * borrow the badges of a studio they typed in.
 */
export async function earnedBadge(ctx: QueryCtx, userId: Id<"users">, except?: Id<"listings">) {
  const counts = (l: Doc<"listings">) => l._id !== except && isPublicStatus(l.status);
  const owned = await ctx.db
    .query("listings")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .take(100);
  if (owned.some(counts)) return true;
  const approved = (
    await ctx.db
      .query("claims")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(100)
  ).filter((c) => c.status === "approved" && c.creatorId);
  for (const claim of approved) {
    const creator = await ctx.db.get(claim.creatorId!);
    if (creator?.claimedBy !== userId) continue;
    const credited = await ctx.db
      .query("listings")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .take(100);
    if (credited.some((l) => counts(l) && (l.ownerId === undefined || l.ownerId === userId))) return true;
  }
  return false;
}

/** Why the user can't vote on this listing right now, or null if they can. */
async function voteBlock(ctx: QueryCtx, listing: Doc<"listings">, userId: Id<"users">) {
  if (listing.status !== "in_voting" || !listing.votingEndsAt || Date.now() >= listing.votingEndsAt) {
    return "Voting is closed for this site.";
  }
  if (await isOwnSite(ctx, listing, userId)) return OWN_SITE;
  if (!(await earnedBadge(ctx, userId, listing._id))) return NO_BADGE;
  return null;
}

async function listingBySlug(ctx: QueryCtx, slug: string) {
  return await ctx.db
    .query("listings")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .first();
}

export const cast = mutation({
  args: { slug: v.string(), scores: pillars },
  returns: v.null(),
  handler: async (ctx, { slug, scores }) => {
    const user = await requireUser(ctx);
    const listing = await listingBySlug(ctx, slug);
    if (!listing) fail("Site not found.");
    const blocked = await voteBlock(ctx, listing, user._id);
    if (blocked) fail(blocked);

    const existing = await ctx.db
      .query("votes")
      .withIndex("by_listing_user", (q) => q.eq("listingId", listing._id).eq("userId", user._id))
      .first();
    if (existing) fail("You've already voted on this site.");

    let vote;
    try {
      vote = normalizePillars(scores);
    } catch (err) {
      fail((err as Error).message);
    }

    await ctx.db.insert("votes", {
      listingId: listing._id,
      userId: user._id,
      scores: vote,
      createdAt: Date.now(),
    });
    const totals = addPillars(readPillars(listing.communityTotals), vote);
    const count = listing.communityVotesCount + 1;
    await ctx.db.patch(listing._id, {
      communityTotals: totals,
      communityVotesCount: count,
      ...scoreFields(listing.editorialScores, totals, count),
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * For the vote page: whether the signed-in user may vote on this site, and
 * why not. Null when signed out or the user record isn't synced yet.
 */
export const eligibility = query({
  args: { slug: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      canVote: v.boolean(),
      reason: v.union(v.string(), v.null()),
      /** "badge": the only obstacle is not having a badge yet. */
      kind: v.union(v.literal("ok"), v.literal("closed"), v.literal("own"), v.literal("badge"), v.literal("voted")),
    }),
  ),
  handler: async (ctx, { slug }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await getUserByExternalId(ctx, identity.subject);
    if (!user) return null;
    const listing = await listingBySlug(ctx, slug);
    if (!listing) return null;
    const voted = await ctx.db
      .query("votes")
      .withIndex("by_listing_user", (q) => q.eq("listingId", listing._id).eq("userId", user._id))
      .first();
    if (voted) return { canVote: false, reason: "You've already voted on this site.", kind: "voted" as const };
    const reason = await voteBlock(ctx, listing, user._id);
    const kind = !reason ? "ok" : reason === OWN_SITE ? "own" : reason === NO_BADGE ? "badge" : "closed";
    return { canVote: !reason, reason, kind: kind as "ok" | "closed" | "own" | "badge" };
  },
});

/** The signed-in user's vote on a site, or null. */
export const mine = query({
  args: { slug: v.string() },
  returns: v.union(v.object({ scores: pillars, createdAt: v.number() }), v.null()),
  handler: async (ctx, { slug }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await getUserByExternalId(ctx, identity.subject);
    if (!user) return null;
    const listing = await listingBySlug(ctx, slug);
    if (!listing) return null;
    const vote = await ctx.db
      .query("votes")
      .withIndex("by_listing_user", (q) => q.eq("listingId", listing._id).eq("userId", user._id))
      .first();
    return vote ? { scores: readPillars(vote.scores), createdAt: vote.createdAt } : null;
  },
});
