// Conflict of interest: a juror never scores a site they built or that
// belongs to their company. That covers their own listings (owned, credited
// to a creator profile they claimed, or pre-created for them) and any
// conflict declared by the juror or set by an admin (`conflicts` table).

import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

export const OWN_SITE = "You can't evaluate your own site.";

/** Why this juror may not score this listing, or null if they may. */
export async function conflictReason(ctx: QueryCtx, listing: Doc<"listings">, juror: Doc<"jurors">) {
  if (listing.jurorId === juror._id) return OWN_SITE;
  if (juror.userId && listing.ownerId === juror.userId) return OWN_SITE;
  if (juror.userId && listing.creatorId) {
    const creator = await ctx.db.get(listing.creatorId);
    if (creator?.claimedBy === juror.userId) return OWN_SITE;
  }
  const declared = await ctx.db
    .query("conflicts")
    .withIndex("by_juror_listing", (q) => q.eq("jurorId", juror._id).eq("listingId", listing._id))
    .first();
  if (declared) return "You have a conflict of interest with this site, so you can't score it.";
  return null;
}
