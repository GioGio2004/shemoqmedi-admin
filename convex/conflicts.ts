// Conflict-of-interest flags on juror–site pairs (rules in lib/conflicts.ts).
// A juror declares one from the Evaluate panel; an admin can set or clear
// one on the site's review page. Setting a flag removes that juror's score
// for the site, so it never counts.

import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireAdmin } from "./authHelpers";
import { cleanText, fail } from "./lib/listingHelpers";
import { recomputeJuryScore, requireJuror } from "./jury";

const REASON_MAX = 300;

async function addConflict(
  ctx: MutationCtx,
  jurorId: Id<"jurors">,
  listingId: Id<"listings">,
  reason: string,
  declaredBy: "juror" | "admin",
) {
  const existing = await ctx.db
    .query("conflicts")
    .withIndex("by_juror_listing", (q) => q.eq("jurorId", jurorId).eq("listingId", listingId))
    .first();
  if (!existing) {
    await ctx.db.insert("conflicts", { jurorId, listingId, reason, declaredBy, createdAt: Date.now() });
  }
  // Their scores for this site no longer count.
  const evaluation = await ctx.db
    .query("juryEvaluations")
    .withIndex("by_listing_juror", (q) => q.eq("listingId", listingId).eq("jurorId", jurorId))
    .unique();
  if (evaluation) {
    await ctx.db.delete(evaluation._id);
    await recomputeJuryScore(ctx, listingId);
  }
  const roundVotes = await ctx.db
    .query("roundVotes")
    .withIndex("by_listing_juror", (q) => q.eq("listingId", listingId).eq("jurorId", jurorId))
    .take(50);
  for (const vote of roundVotes) await ctx.db.delete(vote._id);
}

/** A juror declares they built this site or it belongs to their company. */
export const declare = mutation({
  args: { slug: v.string(), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, { slug, reason }) => {
    const { juror } = await requireJuror(ctx);
    const listing = await ctx.db
      .query("listings")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!listing) fail("Site not found.");
    const why = cleanText(reason || "I built this site or it belongs to my company.", "Reason", REASON_MAX);
    await addConflict(ctx, juror._id, listing._id, why, "juror");
    return null;
  },
});

/** Admin: flag a conflict between a juror and a site. */
export const set = mutation({
  args: { listingId: v.id("listings"), jurorId: v.id("jurors"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, { listingId, jurorId, reason }) => {
    await requireAdmin(ctx);
    if (!(await ctx.db.get(listingId))) fail("Listing not found.");
    if (!(await ctx.db.get(jurorId))) fail("Juror not found.");
    await addConflict(ctx, jurorId, listingId, cleanText(reason, "Reason", REASON_MAX), "admin");
    return null;
  },
});

/** Admin: clear a conflict flag. */
export const remove = mutation({
  args: { id: v.id("conflicts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    await ctx.db.delete(id);
    return null;
  },
});

/** Admin: the conflicts on a site, and the jurors that could be flagged. */
export const forListing = query({
  args: { listingId: v.id("listings") },
  returns: v.object({
    conflicts: v.array(
      v.object({
        id: v.id("conflicts"),
        jurorName: v.string(),
        reason: v.string(),
        declaredBy: v.union(v.literal("juror"), v.literal("admin")),
        createdAt: v.number(),
      }),
    ),
    jurors: v.array(v.object({ id: v.id("jurors"), name: v.string() })),
  }),
  handler: async (ctx, { listingId }) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("conflicts")
      .withIndex("by_listing", (q) => q.eq("listingId", listingId))
      .collect();
    const conflicts = await Promise.all(
      rows.map(async (c) => ({
        id: c._id,
        jurorName: (await ctx.db.get(c.jurorId))?.name ?? "Former juror",
        reason: c.reason,
        declaredBy: c.declaredBy,
        createdAt: c.createdAt,
      })),
    );
    const jurors = (
      await ctx.db
        .query("jurors")
        .withIndex("by_active", (q) => q.eq("active", true))
        .take(500)
    )
      .filter((j) => !rows.some((c) => c.jurorId === j._id))
      .map((j) => ({ id: j._id, name: j.name }));
    return { conflicts, jurors };
  },
});
