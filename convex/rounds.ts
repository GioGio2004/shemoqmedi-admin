// Site of the Month and Site of the Year jury rounds (opened and announced
// by awards.tick). Jurors score each candidate on the same pillars and
// weights as the weekly batches.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { pillars } from "./schema";
import { mediaUrl } from "./lib/media";
import { normalizePillars, readPillars } from "./lib/scoring";
import { conflictReason } from "./lib/conflicts";
import { fail } from "./lib/listingHelpers";
import { currentJuror, requireJuror } from "./jury";

const roundCard = v.object({
  id: v.id("rounds"),
  kind: v.union(v.literal("SOTM"), v.literal("SOTY")),
  period: v.string(),
  closesAt: v.number(),
  candidates: v.array(
    v.object({
      slug: v.string(),
      title: v.string(),
      url: v.string(),
      creditName: v.string(),
      coverUrl: v.union(v.string(), v.null()),
      blocked: v.union(v.string(), v.null()), // conflict of interest
      myScores: v.union(pillars, v.null()),
    }),
  ),
});

/** Open rounds the signed-in juror can score, with their saved scores. Null for non-jurors. */
export const open = query({
  args: {},
  returns: v.union(v.array(roundCard), v.null()),
  handler: async (ctx) => {
    const current = await currentJuror(ctx);
    if (!current) return null;
    const now = Date.now();
    const rounds = (
      await ctx.db
        .query("rounds")
        .withIndex("by_status", (q) => q.eq("status", "open"))
        .collect()
    ).filter((r) => r.opensAt <= now && now < r.closesAt);
    return Promise.all(
      rounds.map(async (round) => ({
        id: round._id,
        kind: round.kind,
        period: round.period,
        closesAt: round.closesAt,
        candidates: (
          await Promise.all(
            round.candidates.map(async (id) => {
              const listing = await ctx.db.get(id);
              if (!listing) return null;
              const mine = await ctx.db
                .query("roundVotes")
                .withIndex("by_round_juror_listing", (q) =>
                  q.eq("roundId", round._id).eq("jurorId", current.juror._id).eq("listingId", id),
                )
                .first();
              return {
                slug: listing.slug,
                title: listing.title,
                url: listing.url,
                creditName: listing.creditName,
                coverUrl: await mediaUrl(ctx, listing.coverId),
                blocked: await conflictReason(ctx, listing, current.juror),
                myScores: mine ? readPillars(mine.scores) : null,
              };
            }),
          )
        ).filter((c) => c !== null),
      })),
    );
  },
});

/** A juror scores (or re-scores) one candidate while the round is open. */
export const vote = mutation({
  args: { roundId: v.id("rounds"), slug: v.string(), scores: pillars },
  returns: v.null(),
  handler: async (ctx, { roundId, slug, scores }) => {
    const { juror } = await requireJuror(ctx);
    const round = await ctx.db.get(roundId);
    const now = Date.now();
    if (!round || round.status !== "open" || now < round.opensAt || now >= round.closesAt) {
      fail("This round is closed.");
    }
    const listing = await ctx.db
      .query("listings")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!listing || !round.candidates.includes(listing._id)) fail("This site is not a candidate in this round.");
    const blocked = await conflictReason(ctx, listing as Doc<"listings">, juror);
    if (blocked) fail(blocked);
    let clean;
    try {
      clean = normalizePillars(scores);
    } catch (err) {
      fail((err as Error).message);
    }
    const saved = await ctx.db
      .query("roundVotes")
      .withIndex("by_round_juror_listing", (q) =>
        q.eq("roundId", roundId).eq("jurorId", juror._id).eq("listingId", listing._id),
      )
      .first();
    if (saved) await ctx.db.patch(saved._id, { scores: clean, updatedAt: now });
    else {
      await ctx.db.insert("roundVotes", {
        roundId,
        listingId: listing._id,
        jurorId: juror._id,
        scores: clean,
        createdAt: now,
        updatedAt: now,
      });
    }
    return null;
  },
});
