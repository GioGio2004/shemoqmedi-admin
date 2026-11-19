// One-off data migration for the awards hierarchy. Additive and safe to run
// more than once (each step only fills what is missing):
//
//   npx convex run migrations:backfillAwardsData            (dev)
//   npx convex run migrations:backfillAwardsData --prod     (production)
//
//   * Pillar scores: copies the old `code` pillar into `content` on listings,
//     community votes and jury evaluations. `code` is left in place; once
//     every deployment has run this, a later change can drop it and make
//     `content` required.
//   * Listings: domainKey, jury vote count, batch week for sites in voting,
//     and the score recomputed with the new weights (jury only).
//   * Awards: an award record (and a public award page) for every award a
//     listing already had, logged as granted before the records existed.

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { domainKey, listingsOnDomain } from "./lib/domains";
import { averagePillars, finalScore, readPillars, type StoredPillars } from "./lib/scoring";
import { scoreFields } from "./lib/listingHelpers";
import { audit, awardSlug, awardsOf, revokeAward, syncListingAwards } from "./lib/awards";
import { tbilisiDay, tbilisiMonth, tbilisiYear, weekOf } from "./lib/time";
import { CLAIM_LINK_TTL, hashClaimToken } from "./claimLinks";

const withContent = (p: StoredPillars | undefined) =>
  p && p.content === undefined && p.code !== undefined ? { ...p, content: p.code } : null;

export const backfillAwardsData = internalMutation({
  args: {},
  returns: v.object({ listings: v.number(), votes: v.number(), evaluations: v.number(), awards: v.number() }),
  handler: async (ctx) => {
    let votes = 0;
    for (const row of await ctx.db.query("votes").take(8000)) {
      const scores = withContent(row.scores);
      if (scores) {
        await ctx.db.patch(row._id, { scores });
        votes += 1;
      }
    }
    let evaluations = 0;
    for (const row of await ctx.db.query("juryEvaluations").take(8000)) {
      const scores = withContent(row.scores);
      if (scores) {
        await ctx.db.patch(row._id, { scores });
        evaluations += 1;
      }
    }

    let listings = 0;
    let awards = 0;
    for (const listing of await ctx.db.query("listings").take(2000)) {
      const patch: Partial<Doc<"listings">> = {};
      const editorial = withContent(listing.editorialScores);
      if (editorial) patch.editorialScores = editorial;
      const totals = withContent(listing.communityTotals);
      if (totals) patch.communityTotals = totals;
      if (listing.domainKey === undefined) patch.domainKey = domainKey(listing.url);
      if (listing.status === "in_voting" && listing.batchWeek === undefined) {
        patch.batchWeek = weekOf(listing.publishedAt ?? listing.createdAt);
      }

      // New weights, jury only.
      const jury = (
        await ctx.db
          .query("juryEvaluations")
          .withIndex("by_listing", (q) => q.eq("listingId", listing._id))
          .collect()
      ).map((e) => readPillars(e.scores));
      const ed = jury.length ? averagePillars(jury)! : listing.editorialScores ? readPillars(listing.editorialScores) : undefined;
      const fields = scoreFields(ed, totals ?? listing.communityTotals, listing.communityVotesCount);
      const final = jury.length ? finalScore(jury)! : fields.finalScore;
      Object.assign(patch, fields, { finalScore: final, editorialAverage: final, juryVotes: jury.length });

      // Award records for awards given before the table existed.
      const existing = await ctx.db
        .query("awards")
        .withIndex("by_listing", (q) => q.eq("listingId", listing._id))
        .collect();
      const at = listing.awardedAt ?? listing.updatedAt;
      for (const tier of listing.awards) {
        if (existing.some((a) => a.tier === tier)) continue;
        const period =
          tier === "SOTM" ? tbilisiMonth(at) : tier === "SOTY" ? tbilisiYear(at) : tier === "SOTD" ? tbilisiDay(at) : weekOf(at);
        const id = await ctx.db.insert("awards", {
          listingId: listing._id,
          tier,
          period,
          date: tbilisiDay(at),
          score: listing.finalScore ?? null,
          slug: awardSlug(listing.slug, tier, period),
          status: "active",
          source: "manual",
          reason: "Awarded before award records existed (migration).",
          createdAt: at,
        });
        await audit(ctx, {
          kind: "granted",
          tier,
          period,
          listingId: listing._id,
          awardId: id,
          reason: "Awarded before award records existed (migration).",
          details: { migrated: true },
        });
        awards += 1;
      }

      await ctx.db.patch(listing._id, patch);
      listings += 1;
    }
    return { listings, votes, evaluations, awards };
  },
});

/**
 * Marks sites as built by the Shemoqmedi team (by URL), revoking their awards
 * with a logged reason, like the switch on the admin review page:
 *   npx convex run migrations:markTeamSites '{"urls":["https://kenchogroup.ge"]}' --prod
 */
export const markTeamSites = internalMutation({
  args: { urls: v.array(v.string()) },
  returns: v.array(v.object({ url: v.string(), title: v.union(v.string(), v.null()), revoked: v.number() })),
  handler: async (ctx, { urls }) => {
    const now = Date.now();
    const out = [];
    for (const url of urls) {
      const matches = await listingsOnDomain(ctx, domainKey(url));
      let revoked = 0;
      for (const listing of matches) {
        await ctx.db.patch(listing._id, { byTeam: true, sotdQueuedAt: undefined, updatedAt: now });
        const active = (await awardsOf(ctx, listing._id)).filter((a) => a.status === "active");
        for (const a of active) {
          await revokeAward(ctx, a._id, { reason: "Shemoqmedi team site: not eligible for awards.", now });
          revoked += 1;
        }
        await audit(ctx, { kind: "team_site", listingId: listing._id, details: { byTeam: true, revoked, via: "migration" } });
        await syncListingAwards(ctx, listing._id);
      }
      out.push({ url, title: matches[0]?.title ?? null, revoked });
    }
    return out;
  },
});

/**
 * Claim links used to be stored in plaintext on the juror or listing
 * (claimToken, and claimTokenUsed once claimed). This moves each one into the
 * claimLinks table as a SHA-256 hash and clears the plaintext field. Open
 * links get 14 days from now (they had no expiry before); used ones keep
 * redirecting their claimer. Safe to run more than once:
 *
 *   npx convex run migrations:hashClaimTokens            (dev)
 *   npx convex run migrations:hashClaimTokens --prod     (production)
 *
 * Until it has run, claimLinks.ts still accepts the plaintext fields.
 */
export const hashClaimTokens = internalMutation({
  args: {},
  returns: v.object({ open: v.number(), used: v.number(), dropped: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    let open = 0;
    let used = 0;
    let dropped = 0;
    const known = async (tokenHash: string) =>
      (await ctx.db
        .query("claimLinks")
        .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
        .first()) !== null;

    type Row = { claimToken?: string; claimTokenUsed?: string };
    const move = async (
      row: Row,
      target: { jurorId: Doc<"jurors">["_id"] } | { listingId: Doc<"listings">["_id"] },
      owner: Doc<"users">["_id"] | undefined,
      claimedAt: number,
    ) => {
      if (row.claimToken) {
        const tokenHash = await hashClaimToken(row.claimToken);
        if (!(await known(tokenHash))) {
          await ctx.db.insert("claimLinks", { tokenHash, ...target, createdAt: now, expiresAt: now + CLAIM_LINK_TTL });
          open += 1;
        }
      }
      if (row.claimTokenUsed) {
        const tokenHash = await hashClaimToken(row.claimTokenUsed);
        if (!owner) dropped += 1; // claimed with nobody to redirect: nothing to keep
        else if (!(await known(tokenHash))) {
          await ctx.db.insert("claimLinks", {
            tokenHash,
            ...target,
            createdAt: claimedAt,
            expiresAt: claimedAt + CLAIM_LINK_TTL,
            usedBy: owner,
            usedAt: claimedAt,
          });
          used += 1;
        }
      }
    };

    for (const j of await ctx.db.query("jurors").take(2000)) {
      if (!j.claimToken && !j.claimTokenUsed) continue;
      await move(j, { jurorId: j._id }, j.userId, j.claimedAt ?? j.updatedAt);
      await ctx.db.patch(j._id, { claimToken: undefined, claimTokenUsed: undefined });
    }
    for (const l of await ctx.db.query("listings").take(8000)) {
      if (!l.claimToken && !l.claimTokenUsed) continue;
      await move(l, { listingId: l._id }, l.ownerId, l.updatedAt);
      await ctx.db.patch(l._id, { claimToken: undefined, claimTokenUsed: undefined });
    }
    return { open, used, dropped };
  },
});

/**
 * Submissions still waiting for review that were made before submitting
 * stopped granting ownership (audit A-05): the submitter moves from ownerId to
 * submittedBy and the listing goes back to unclaimed, so ownership is decided
 * on approval like every new submission. A creator profile the submission
 * created for them (claimed by the submitter and crediting only this site) is
 * unclaimed too. Published listings are left alone. Safe to run more than once:
 *   npx convex run migrations:unclaimPendingSubmissions --prod
 */
export const unclaimPendingSubmissions = internalMutation({
  args: {},
  returns: v.object({ listings: v.number(), creators: v.number() }),
  handler: async (ctx) => {
    let listings = 0;
    let creators = 0;
    const now = Date.now();
    const pending = await ctx.db
      .query("listings")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(1000);
    for (const l of pending) {
      if (l.source !== "submission" || !l.ownerId || l.publishedAt !== undefined || l.submittedBy) continue;
      const submitter = l.ownerId;
      await ctx.db.patch(l._id, { submittedBy: submitter, ownerId: undefined, isClaimed: false, updatedAt: now });
      listings += 1;
      const creator = l.creatorId ? await ctx.db.get(l.creatorId) : null;
      if (!creator || creator.claimedBy !== submitter) continue;
      const credits = await ctx.db
        .query("listings")
        .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
        .take(2);
      if (credits.every((c) => c._id === l._id)) {
        await ctx.db.patch(creator._id, { isClaimed: false, claimedBy: undefined, updatedAt: now });
        creators += 1;
      }
    }
    return { listings, creators };
  },
});
