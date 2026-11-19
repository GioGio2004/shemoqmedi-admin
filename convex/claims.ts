import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { requireAdmin, requireUser } from "./authHelpers";
import { LIMITS } from "./lib/taxonomy";
import {
  claimIntent,
  claimedListingPatch,
  cleanText,
  fail,
  isPublicStatus,
  normalizeUrl,
  type ClaimIntent,
} from "./lib/listingHelpers";
import { claimIntentValue } from "./schema";
import { awardPaths, listingPaths, scheduleIndexNow } from "./seo";
import { pushAdmins } from "./push";
import { revokeClaimLinks } from "./lib/claimLinkRows";
import { adminUrl } from "../lib/hosts";
import { rateLimit } from "./lib/rateLimit";

const claimStatus = v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"));

/**
 * "This is mine": request ownership of an unclaimed site or creator profile
 * (intent "claim"), or ask for a listing to be taken down (intent "remove").
 * `intent` is optional only so a storefront deployed before it existed keeps
 * working: it sent removals as a message starting with "Removal request: ".
 */
export const submit = mutation({
  args: {
    targetType: v.union(v.literal("listing"), v.literal("creator")),
    slug: v.string(),
    message: v.string(),
    proofUrl: v.optional(v.string()),
    intent: v.optional(claimIntentValue),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    await rateLimit(ctx, "submitClaim", user);
    const message = cleanText(args.message, "Message", LIMITS.claimMessage);
    const intent: ClaimIntent = claimIntent({ intent: args.intent, message });
    if (intent === "remove" && args.targetType !== "listing") fail("Only a site can be taken down.");
    const proofUrl = args.proofUrl?.trim() ? normalizeUrl(args.proofUrl, "Proof link") : undefined;

    let listingId: Doc<"listings">["_id"] | undefined;
    let creatorId: Doc<"creators">["_id"] | undefined;
    let targetName: string;
    if (args.targetType === "listing") {
      const listing = await ctx.db
        .query("listings")
        .withIndex("by_slug", (q) => q.eq("slug", args.slug))
        .first();
      if (!listing || listing.status === "pending" || listing.status === "rejected") {
        fail("Site not found.");
      }
      // Anyone may ask for a site to come down, owned or not; only ownership
      // claims need it to be unclaimed.
      if (intent === "claim" && listing.isClaimed) fail("This site has already been claimed.");
      listingId = listing._id;
      targetName = listing.title;
    } else {
      const creator = await ctx.db
        .query("creators")
        .withIndex("by_slug", (q) => q.eq("slug", args.slug))
        .first();
      if (!creator) fail("Creator not found.");
      if (creator.isClaimed) fail("This profile has already been claimed.");
      creatorId = creator._id;
      targetName = creator.name;
    }

    const mine = await ctx.db
      .query("claims")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    if (
      mine.some(
        (c) =>
          c.status === "pending" &&
          claimIntent(c) === intent &&
          ((listingId && c.listingId === listingId) || (creatorId && c.creatorId === creatorId)),
      )
    ) {
      fail(
        intent === "remove"
          ? "You already have a removal request waiting for review here."
          : "You already have a claim waiting for review here.",
      );
    }
    if (mine.filter((c) => c.status === "pending").length >= 10) {
      fail("You have too many claims waiting for review.");
    }

    const claimId = await ctx.db.insert("claims", {
      targetType: args.targetType,
      listingId,
      creatorId,
      userId: user._id,
      message,
      proofUrl,
      status: "pending",
      intent,
      createdAt: Date.now(),
    });
    // Clerk can sync a user without a name.
    const who = user.name.trim() || "Someone";
    await pushAdmins(ctx, {
      title: intent === "remove" ? "New removal request" : "New claim",
      body: intent === "remove" ? `${who} asks to take down ${targetName}` : `${who} claims ${targetName}`,
      url: adminUrl("/claims"),
      tag: `claim-${claimId}`,
    });
    return null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────────────────────────────────────

const reviewClaim = v.object({
  id: v.id("claims"),
  targetType: v.union(v.literal("listing"), v.literal("creator")),
  intent: claimIntentValue,
  target: v.union(
    v.object({ slug: v.string(), name: v.string(), isClaimed: v.boolean(), isPublic: v.boolean() }),
    v.null(),
  ),
  claimant: v.union(v.object({ name: v.string(), email: v.string() }), v.null()),
  message: v.string(),
  proofUrl: v.union(v.string(), v.null()),
  status: claimStatus,
  reviewNote: v.union(v.string(), v.null()),
  createdAt: v.number(),
});

export const queue = query({
  args: { status: claimStatus },
  returns: v.array(reviewClaim),
  handler: async (ctx, { status }) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("claims")
      .withIndex("by_status", (q) => q.eq("status", status))
      .order(status === "pending" ? "asc" : "desc")
      .take(200);
    return Promise.all(
      rows.map(async (claim) => {
        const claimant = await ctx.db.get(claim.userId);
        let target: { slug: string; name: string; isClaimed: boolean; isPublic: boolean } | null = null;
        if (claim.listingId) {
          const l = await ctx.db.get(claim.listingId);
          if (l) target = { slug: l.slug, name: l.title, isClaimed: l.isClaimed, isPublic: isPublicStatus(l.status) };
        } else if (claim.creatorId) {
          const c = await ctx.db.get(claim.creatorId);
          if (c) target = { slug: c.slug, name: c.name, isClaimed: c.isClaimed, isPublic: true };
        }
        return {
          id: claim._id,
          targetType: claim.targetType,
          intent: claimIntent(claim),
          target,
          claimant: claimant ? { name: claimant.name, email: claimant.email } : null,
          message: claim.message,
          proofUrl: claim.proofUrl ?? null,
          status: claim.status,
          reviewNote: claim.reviewNote ?? null,
          createdAt: claim.createdAt,
        };
      }),
    );
  },
});

export const pendingCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return (
      await ctx.db
        .query("claims")
        .withIndex("by_status", (q) => q.eq("status", "pending"))
        .take(1000)
    ).length;
  },
});

/** The note a taken-down listing carries (shown to its owner, if it has one). */
const TAKEDOWN_NOTE = "Taken down at the request of someone connected to the site.";

/**
 * Take a listing off the public site without deleting anything: it moves to
 * "rejected" (not public, and an admin can re-publish it from the listing's
 * lifecycle controls). Awards stay on record, like any unpublished site.
 */
async function takeDownListing(ctx: MutationCtx, listing: Doc<"listings">, adminId: Id<"users">, now: number) {
  if (!isPublicStatus(listing.status)) return; // already off the site
  await ctx.db.patch(listing._id, {
    status: "rejected",
    reviewNote: TAKEDOWN_NOTE,
    reviewedBy: adminId,
    reviewedAt: now,
    sotdQueuedAt: undefined,
    updatedAt: now,
  });
  await scheduleIndexNow(ctx, [...(await listingPaths(ctx, listing)), ...awardPaths(listing.awards)]);
}

/**
 * Approving a claim hands ownership to the claimant. Approving a removal
 * request takes the listing down and never touches ownership. Either way,
 * only other pending requests of the same intent are closed: a removal
 * request still needs its own answer after someone claims the site, and an
 * ownership claim still needs one after the site is taken down.
 */
export const approve = mutation({
  args: { id: v.id("claims") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const admin = await requireAdmin(ctx);
    const claim = await ctx.db.get(id);
    if (!claim || claim.status !== "pending") fail("Claim not found or already decided.");
    const intent = claimIntent(claim);
    const now = Date.now();

    if (intent === "remove") {
      if (!claim.listingId) fail("Only a site can be taken down.");
      const listing = await ctx.db.get(claim.listingId);
      if (!listing) fail("The site no longer exists.");
      await takeDownListing(ctx, listing, admin._id, now);
    } else if (claim.listingId) {
      const listing = await ctx.db.get(claim.listingId);
      if (!listing) fail("The site no longer exists.");
      if (listing.isClaimed) fail("This site was already claimed. Reject this claim instead.");
      await ctx.db.patch(listing._id, claimedListingPatch(listing, claim.userId, now));
      // Open claim links for the site die with the approval.
      await revokeClaimLinks(ctx, { kind: "listing", id: listing._id }, now);
    } else if (claim.creatorId) {
      const creator = await ctx.db.get(claim.creatorId);
      if (!creator) fail("The creator profile no longer exists.");
      if (creator.isClaimed) fail("This profile was already claimed. Reject this claim instead.");
      await ctx.db.patch(creator._id, { claimedBy: claim.userId, isClaimed: true, updatedAt: now });
    }
    await ctx.db.patch(id, { status: "approved", intent, reviewedBy: admin._id, reviewedAt: now });

    const others = claim.listingId
      ? await ctx.db
          .query("claims")
          .withIndex("by_listing", (q) => q.eq("listingId", claim.listingId))
          .collect()
      : await ctx.db
          .query("claims")
          .withIndex("by_creator", (q) => q.eq("creatorId", claim.creatorId))
          .collect();
    for (const other of others) {
      if (other._id !== id && other.status === "pending" && claimIntent(other) === intent) {
        await ctx.db.patch(other._id, {
          status: "rejected",
          reviewNote:
            intent === "remove"
              ? "The site was already taken down after another request."
              : "Another claim was approved.",
          reviewedBy: admin._id,
          reviewedAt: now,
        });
      }
    }
    return null;
  },
});

export const reject = mutation({
  args: { id: v.id("claims"), note: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, note }) => {
    const admin = await requireAdmin(ctx);
    const claim = await ctx.db.get(id);
    if (!claim || claim.status !== "pending") fail("Claim not found or already decided.");
    const reviewNote = cleanText(note, "Reason", LIMITS.reviewNote);
    await ctx.db.patch(id, { status: "rejected", reviewNote, reviewedBy: admin._id, reviewedAt: Date.now() });
    return null;
  },
});
