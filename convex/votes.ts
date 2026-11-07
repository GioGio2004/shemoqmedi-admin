import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./authHelpers";
import { pillars } from "./schema";
import { addPillars, normalizePillars } from "./lib/scoring";
import { fail, scoreFields } from "./lib/listingHelpers";

/**
 * Community vote: one per signed-in user per listing, only while the
 * listing's 7-day voting window is open. Owners can't vote on their own site.
 */
export const cast = mutation({
  args: { slug: v.string(), scores: pillars },
  returns: v.null(),
  handler: async (ctx, { slug, scores }) => {
    const user = await requireUser(ctx);
    const listing = await ctx.db
      .query("listings")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!listing) fail("Site not found.");
    if (listing.status !== "in_voting" || !listing.votingEndsAt || Date.now() >= listing.votingEndsAt) {
      fail("Voting is closed for this site.");
    }
    if (listing.ownerId === user._id) fail("You can't vote on your own site.");
    if (listing.creatorId) {
      const creator = await ctx.db.get(listing.creatorId);
      if (creator?.claimedBy === user._id) fail("You can't vote on your own site.");
    }

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
    const totals = addPillars(listing.communityTotals, vote);
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

/** The signed-in user's vote on a site, or null. */
export const mine = query({
  args: { slug: v.string() },
  returns: v.union(v.object({ scores: pillars, createdAt: v.number() }), v.null()),
  handler: async (ctx, { slug }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", identity.subject))
      .unique();
    if (!user) return null;
    const listing = await ctx.db
      .query("listings")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!listing) return null;
    const vote = await ctx.db
      .query("votes")
      .withIndex("by_listing_user", (q) => q.eq("listingId", listing._id).eq("userId", user._id))
      .first();
    return vote ? { scores: vote.scores, createdAt: vote.createdAt } : null;
  },
});
