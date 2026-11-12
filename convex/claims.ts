import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireAdmin, requireUser } from "./authHelpers";
import { LIMITS } from "./lib/taxonomy";
import { claimedListingPatch, cleanText, fail, normalizeUrl } from "./lib/listingHelpers";
import { pushAdmins } from "./push";
import { adminUrl } from "../lib/hosts";

const claimStatus = v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"));

/** "This is mine": request ownership of an unclaimed site or creator profile. */
export const submit = mutation({
  args: {
    targetType: v.union(v.literal("listing"), v.literal("creator")),
    slug: v.string(),
    message: v.string(),
    proofUrl: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const message = cleanText(args.message, "Message", LIMITS.claimMessage);
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
      if (listing.isClaimed) fail("This site has already been claimed.");
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
          ((listingId && c.listingId === listingId) || (creatorId && c.creatorId === creatorId)),
      )
    ) {
      fail("You already have a claim waiting for review here.");
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
      createdAt: Date.now(),
    });
    await pushAdmins(ctx, {
      title: "New claim",
      // Clerk can sync a user without a name.
      body: `${user.name.trim() || "Someone"} claims ${targetName}`,
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
  target: v.union(v.object({ slug: v.string(), name: v.string(), isClaimed: v.boolean() }), v.null()),
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
        let target: { slug: string; name: string; isClaimed: boolean } | null = null;
        if (claim.listingId) {
          const l = await ctx.db.get(claim.listingId);
          if (l) target = { slug: l.slug, name: l.title, isClaimed: l.isClaimed };
        } else if (claim.creatorId) {
          const c = await ctx.db.get(claim.creatorId);
          if (c) target = { slug: c.slug, name: c.name, isClaimed: c.isClaimed };
        }
        return {
          id: claim._id,
          targetType: claim.targetType,
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

/** Approving hands ownership to the claimant and rejects competing claims. */
export const approve = mutation({
  args: { id: v.id("claims") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const claim = await ctx.db.get(id);
    if (!claim || claim.status !== "pending") fail("Claim not found or already decided.");
    const now = Date.now();

    if (claim.listingId) {
      const listing = await ctx.db.get(claim.listingId);
      if (!listing) fail("The site no longer exists.");
      if (listing.isClaimed) fail("This site was already claimed. Reject this claim instead.");
      await ctx.db.patch(listing._id, claimedListingPatch(listing, claim.userId, now));
    } else if (claim.creatorId) {
      const creator = await ctx.db.get(claim.creatorId);
      if (!creator) fail("The creator profile no longer exists.");
      if (creator.isClaimed) fail("This profile was already claimed. Reject this claim instead.");
      await ctx.db.patch(creator._id, { claimedBy: claim.userId, isClaimed: true, updatedAt: now });
    }
    await ctx.db.patch(id, { status: "approved", reviewedAt: now });

    const competing = claim.listingId
      ? await ctx.db
          .query("claims")
          .withIndex("by_listing", (q) => q.eq("listingId", claim.listingId))
          .collect()
      : await ctx.db
          .query("claims")
          .withIndex("by_creator", (q) => q.eq("creatorId", claim.creatorId))
          .collect();
    for (const other of competing) {
      if (other._id !== id && other.status === "pending") {
        await ctx.db.patch(other._id, {
          status: "rejected",
          reviewNote: "Another claim was approved.",
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
    await requireAdmin(ctx);
    const claim = await ctx.db.get(id);
    if (!claim || claim.status !== "pending") fail("Claim not found or already decided.");
    const reviewNote = cleanText(note, "Reason", LIMITS.reviewNote);
    await ctx.db.patch(id, { status: "rejected", reviewNote, reviewedAt: Date.now() });
    return null;
  },
});
