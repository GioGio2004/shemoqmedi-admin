// Site of the Day schedule: one winner a day, never the same site twice.
// The rules live in lib/sotd.ts; this file publishes each day's winner and
// gives admins the schedule (admin → Site of the Day).

import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireAdmin } from "./authHelpers";
import { listingStatus } from "./schema";
import { mediaUrl } from "./lib/media";
import { fail, isPublicStatus } from "./lib/listingHelpers";
import { addDays, isDay, nextFreeDay, sotdPublished, utcDay, winnerOn } from "./lib/sotd";
import { SOTD_PATH, listingPaths, scheduleIndexNow } from "./seo";

/** How far back the publish cron looks for a day it missed (deploy gaps, outages). */
const CATCH_UP_DAYS = 7;
/** How many past winners the admin schedule shows. */
const PAST_SHOWN = 60;

/** Pings the pages a published (or withdrawn) Site of the Day changes. */
async function pingWinner(ctx: MutationCtx, listing: Doc<"listings">) {
  await scheduleIndexNow(ctx, [...(await listingPaths(ctx, listing)), SOTD_PATH, "/"]);
}

/** Puts "SOTD" on a winner whose day has come. */
async function publish(ctx: MutationCtx, listing: Doc<"listings">, now: number) {
  await ctx.db.patch(listing._id, {
    awards: [...listing.awards.filter((a) => a !== "SOTD"), "SOTD"],
    status: "awarded",
    awardedAt: listing.awardedAt ?? now,
    updatedAt: now,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduled
// ─────────────────────────────────────────────────────────────────────────────

/** Cron: publish every scheduled winner whose day has come (today's, and any missed). */
export const publishDue = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const today = utcDay(now);
    const due = await ctx.db
      .query("listings")
      .withIndex("by_sotdDay", (q) => q.gte("sotdDay", addDays(today, -CATCH_UP_DAYS)).lte("sotdDay", today))
      .take(50);
    let published = 0;
    for (const listing of due) {
      if (sotdPublished(listing) || !isPublicStatus(listing.status) || listing.status === "in_voting") continue;
      await publish(ctx, listing, now);
      await pingWinner(ctx, listing);
      published += 1;
    }
    return published;
  },
});

/**
 * One-off, after deploying the schedule: gives every Site of the Day won
 * before it a day of its own (the day it was awarded, or the nearest free
 * day before that), so the archive lists each one on a date.
 *   npx convex run sotd:backfillDays --prod
 */
export const backfillDays = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const winners = (await ctx.db.query("listings").withIndex("by_status", (q) => q.eq("status", "awarded")).take(1000))
      .filter((l) => sotdPublished(l) && !l.sotdDay)
      .sort((a, b) => (a.awardedAt ?? a.createdAt) - (b.awardedAt ?? b.createdAt));
    const today = utcDay(Date.now());
    for (const listing of winners) {
      let day = utcDay(listing.awardedAt ?? listing.createdAt);
      if (day > today) day = today;
      while (await winnerOn(ctx, day)) day = addDays(day, -1);
      await ctx.db.patch(listing._id, { sotdDay: day });
    }
    return winners.length;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────────────────────────────────────

const entry = v.object({
  id: v.id("listings"),
  slug: v.string(),
  title: v.string(),
  creditName: v.string(),
  status: listingStatus,
  finalScore: v.union(v.number(), v.null()),
  coverUrl: v.union(v.string(), v.null()),
});

async function toEntry(ctx: Parameters<typeof mediaUrl>[0], l: Doc<"listings">) {
  return {
    id: l._id,
    slug: l.slug,
    title: l.title,
    creditName: l.creditName,
    status: l.status,
    finalScore: l.finalScore ?? null,
    coverUrl: await mediaUrl(ctx, l.coverId),
  };
}

/**
 * Admin: the schedule. `days` runs from the newest past winners to the last
 * scheduled day, newest first; `published` is false for a day not shown yet.
 * `candidates`: sites whose voting has closed and that have never had a day,
 * best score first. They can be scheduled by hand.
 */
export const schedule = query({
  args: {},
  returns: v.object({
    today: v.string(),
    nextFree: v.string(),
    days: v.array(v.object({ day: v.string(), published: v.boolean(), listing: entry })),
    candidates: v.array(entry),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const today = utcDay(Date.now());
    const upcoming = await ctx.db
      .query("listings")
      .withIndex("by_sotdDay", (q) => q.gt("sotdDay", today))
      .take(500);
    const past = await ctx.db
      .query("listings")
      .withIndex("by_sotdDay", (q) => q.gt("sotdDay", "").lte("sotdDay", today))
      .order("desc")
      .take(PAST_SHOWN);
    const days = await Promise.all(
      [...upcoming.reverse(), ...past].map(async (l) => ({
        day: l.sotdDay!,
        published: sotdPublished(l),
        listing: await toEntry(ctx, l),
      })),
    );

    const closed = [
      ...(await ctx.db.query("listings").withIndex("by_status", (q) => q.eq("status", "awarded")).take(500)),
      ...(await ctx.db.query("listings").withIndex("by_status", (q) => q.eq("status", "archived")).take(500)),
    ].filter((l) => !l.sotdDay && !sotdPublished(l));
    closed.sort((a, b) => (b.finalScore ?? -1) - (a.finalScore ?? -1) || (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
    const candidates = await Promise.all(closed.slice(0, 200).map((l) => toEntry(ctx, l)));

    return { today, nextFree: await nextFreeDay(ctx, today), days, candidates };
  },
});

/**
 * Admin: give a site its Site of the Day on `day` (default: the first free
 * day), or move a scheduled one to another day. A day that is taken by a
 * scheduled site swaps the two. A site that has had its day cannot move.
 */
export const setDay = mutation({
  args: { id: v.id("listings"), day: v.optional(v.string()) },
  returns: v.object({ day: v.string() }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const now = Date.now();
    const today = utcDay(now);
    const listing = await ctx.db.get(args.id);
    if (!listing) fail("Listing not found.");
    if (listing.status !== "awarded" && listing.status !== "archived") {
      fail("Only sites whose voting has closed can be Site of the Day.");
    }
    if (sotdPublished(listing) || (listing.sotdDay && listing.sotdDay < today)) {
      fail(`“${listing.title}” was already Site of the Day${listing.sotdDay ? ` on ${listing.sotdDay}` : ""}. A site wins it once.`);
    }
    const day = args.day ?? (await nextFreeDay(ctx, today));
    if (!isDay(day)) fail("Pick a date.");
    if (day < today) fail("Pick today or a later date.");
    if (day === listing.sotdDay) return { day };

    const holder = await winnerOn(ctx, day);
    if (holder && holder._id !== listing._id) {
      if (sotdPublished(holder) || !listing.sotdDay) {
        fail(`${day} already has a Site of the Day (“${holder.title}”). Pick a free day.`);
      }
      // Swap: the other site takes this one's day.
      await ctx.db.patch(holder._id, { sotdDay: listing.sotdDay, updatedAt: now });
      if (listing.sotdDay === today) {
        const moved = await ctx.db.get(holder._id);
        if (moved) {
          await publish(ctx, moved, now);
          await pingWinner(ctx, moved);
        }
      }
    }

    await ctx.db.patch(listing._id, {
      sotdDay: day,
      status: "awarded",
      awardedAt: listing.awardedAt ?? now,
      updatedAt: now,
    });
    if (day === today) {
      const updated = await ctx.db.get(listing._id);
      if (updated) await publish(ctx, updated, now);
      await pingWinner(ctx, listing);
    } else {
      await scheduleIndexNow(ctx, await listingPaths(ctx, listing)); // "Site of the Day on …"
    }
    return { day };
  },
});

/** Admin: take a scheduled site off the schedule (it does not win Site of the Day). */
export const unschedule = mutation({
  args: { id: v.id("listings") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const listing = await ctx.db.get(id);
    if (!listing?.sotdDay) fail("This site is not scheduled.");
    if (sotdPublished(listing)) {
      fail("This Site of the Day is already public. Remove the award on the site's review page instead.");
    }
    await ctx.db.patch(id, {
      sotdDay: undefined,
      // Still awarded only with another award (Best Solo Creation).
      ...(listing.status === "awarded" && listing.awards.length === 0
        ? { status: "archived" as const, awardedAt: undefined }
        : {}),
      updatedAt: Date.now(),
    });
    await scheduleIndexNow(ctx, await listingPaths(ctx, listing));
    return null;
  },
});
