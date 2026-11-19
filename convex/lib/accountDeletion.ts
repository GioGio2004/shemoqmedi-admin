import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { addPillars, readPillars, type Pillars } from "./scoring";
import { deleteListing, isPublicStatus, ownerCanDelete, scoreFields } from "./listingHelpers";
import { listingPaths, scheduleIndexNow } from "../seo";
import { RATE_LIMITS } from "./rateLimit";
import { deleteMediaMany, isAdminUser } from "./media";

// Deleting an account (audit J-02, D-04). Used by "Delete my account"
// (users.deleteMe) and by the Clerk webhook (users.deleteFromClerk), so a
// user removed either way leaves no rows pointing at nobody:
//
//   - their sites that were never public are deleted; public ones stay on
//     the showcase but become unclaimed (nofollow, editable by no one but admins)
//   - studio profiles they claimed become unclaimed
//   - a jury profile they claimed goes back to unclaimed, which is private
//   - their community votes are removed from the scores
//   - their claim requests, push devices and reminders are deleted
//   - files they uploaded stay where a listing uses them (without an
//     uploader); unused ones are deleted
//
// History written by admins (awards, audits, reviews) keeps the old id: those
// rows record who did what, and only admins write them.

const negate = (p: Pillars): Pillars => ({
  design: -p.design,
  usability: -p.usability,
  creativity: -p.creativity,
  content: -p.content,
});

export async function deleteAccountData(ctx: MutationCtx, user: Doc<"users">) {
  const now = Date.now();
  const counts = { listingsDeleted: 0, listingsReleased: 0, creators: 0, votes: 0, claims: 0 };
  const reindex: string[] = [];

  const owned = await ctx.db.query("listings").withIndex("by_owner", (q) => q.eq("ownerId", user._id)).collect();
  const submitted = await ctx.db
    .query("listings")
    .withIndex("by_submittedBy", (q) => q.eq("submittedBy", user._id))
    .collect();
  const seen = new Set<string>();
  for (const listing of [...owned, ...submitted]) {
    if (seen.has(listing._id)) continue;
    seen.add(listing._id);
    if (await ownerCanDelete(ctx, listing)) {
      await deleteListing(ctx, listing, "server");
      counts.listingsDeleted += 1;
      continue;
    }
    await ctx.db.patch(listing._id, {
      ...(listing.ownerId === user._id ? { ownerId: undefined, isClaimed: false, isDoFollow: undefined } : {}),
      ...(listing.submittedBy === user._id ? { submittedBy: undefined } : {}),
      updatedAt: now,
    });
    counts.listingsReleased += 1;
    if (listing.ownerId === user._id && isPublicStatus(listing.status)) reindex.push(...(await listingPaths(ctx, listing)));
  }

  for (const creator of await ctx.db
    .query("creators")
    .withIndex("by_claimedBy", (q) => q.eq("claimedBy", user._id))
    .collect()) {
    await ctx.db.patch(creator._id, { claimedBy: undefined, isClaimed: false, updatedAt: now });
    counts.creators += 1;
  }

  const juror = await ctx.db
    .query("jurors")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .unique();
  if (juror) {
    await ctx.db.patch(juror._id, {
      userId: undefined,
      status: "unclaimed",
      claimedAt: undefined,
      claimPending: undefined,
      active: false,
      updatedAt: now,
    });
    reindex.push("/jury", `/jury/${juror.slug}`);
  }

  for (const vote of await ctx.db.query("votes").withIndex("by_user", (q) => q.eq("userId", user._id)).collect()) {
    const listing = await ctx.db.get(vote.listingId);
    await ctx.db.delete(vote._id);
    counts.votes += 1;
    if (!listing) continue;
    const totals = addPillars(readPillars(listing.communityTotals), negate(readPillars(vote.scores)));
    const count = Math.max(0, listing.communityVotesCount - 1);
    await ctx.db.patch(listing._id, {
      communityTotals: totals,
      communityVotesCount: count,
      ...scoreFields(listing.editorialScores, totals, count),
      updatedAt: now,
    });
  }

  for (const claim of await ctx.db.query("claims").withIndex("by_user", (q) => q.eq("userId", user._id)).collect()) {
    await ctx.db.delete(claim._id);
    counts.claims += 1;
  }
  for (const sub of await ctx.db
    .query("pushSubscriptions")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .collect()) {
    await ctx.db.delete(sub._id);
  }
  for (const done of [false, true]) {
    for (const r of await ctx.db
      .query("reminders")
      .withIndex("by_user_done_at", (q) => q.eq("userId", user._id).eq("done", done))
      .collect()) {
      if (r.jobId) await ctx.scheduler.cancel(r.jobId);
      await ctx.db.delete(r._id);
    }
  }
  // Their uploads: files nothing uses any more are deleted (deleteMediaMany
  // keeps any a listing or juror still uses); the rest lose their uploader.
  const uploads = await ctx.db.query("media").withIndex("by_uploadedBy", (q) => q.eq("uploadedBy", user._id)).collect();
  for (const m of uploads) await ctx.db.patch(m._id, { uploadedBy: undefined });
  // Members only: an admin's uploads include social graphics that posts and
  // reels point at by URL, which the "still used" check doesn't look at.
  if (!isAdminUser(user)) await deleteMediaMany(ctx, uploads.map((m) => m._id), "server");
  for (const name of Object.keys(RATE_LIMITS)) {
    const key = `${name}:${user._id}`;
    const row = await ctx.db.query("rateLimits").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (row) await ctx.db.delete(row._id);
  }

  await ctx.db.delete(user._id);
  if (reindex.length) await scheduleIndexNow(ctx, [...new Set(reindex)]);
  return counts;
}
