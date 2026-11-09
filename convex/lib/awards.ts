// The award rules. Everything that gives, takes or decides an award goes
// through here, so the guarantees hold whoever calls it (scheduled job or
// admin):
//
//   * Eligible: at least config.minVotes jury votes, and not a Shemoqmedi
//     team site.
//   * One Site of the Day per day, one Site of the Month per month, one Site
//     of the Year per year (one active award per tier and period).
//   * A site wins SOTD, SOTM and SOTY at most once each, ever.
//   * Manual grants and every revoke need a reason. Every decision is
//     written to awardAudit with its inputs.
//
// Convex mutations are serializable transactions, so "check, then insert"
// below can't race: running a job twice never creates two winners.

import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { AWARDS } from "./taxonomy";
import type { AwardConfig } from "./config";
import { averagePillars, finalScore, readPillars, type Pillars } from "./scoring";
import { isPublicStatus, scoreFields } from "./listingHelpers";
import { tbilisiDay, weekOf } from "./time";
import { awardPaths, listingPaths, scheduleIndexNow } from "../seo";

export type Tier = Doc<"awards">["tier"];
type AuditKind = Doc<"awardAudit">["kind"];

/** Tiers a site can hold once, ever; also one winner per period. */
export const UNIQUE_TIERS: Tier[] = ["SOTD", "SOTM", "SOTY", "F100"];

/**
 * The First 100 giveaway: an honorary badge an admin gives to the first
 * hundred sites. Each gets the lowest free member number ("001" to "100"),
 * which is its award period, so the count can never pass the limit. A
 * revoked badge frees its number.
 */
export const FIRST_100 = 100;
export const FIRST_100_REASON = "First 100 honorary badge.";

const memberNumber = (n: number) => String(n).padStart(3, "0");

/** Active First 100 awards, by member number. */
export async function first100Members(ctx: QueryCtx) {
  const rows = await ctx.db
    .query("awards")
    .withIndex("by_tier_period", (q) => q.eq("tier", "F100"))
    .collect();
  return rows.filter((a) => a.status === "active").sort((a, b) => a.period.localeCompare(b.period));
}

/** The next free member number, or null when all hundred are given. */
export async function nextFirst100Number(ctx: QueryCtx): Promise<string | null> {
  const taken = new Set((await first100Members(ctx)).map((a) => a.period));
  for (let n = 1; n <= FIRST_100; n++) if (!taken.has(memberNumber(n))) return memberNumber(n);
  return null;
}

export const TIER_NAMES: Record<Tier, string> = Object.fromEntries(AWARDS.map((a) => [a.slug, a.name])) as Record<
  Tier,
  string
>;

export const TEAM_SITE = "Built by the Shemoqmedi team: never eligible for awards.";

export function awardSlug(listingSlug: string, tier: Tier, period: string) {
  return `${listingSlug}-${tier.toLowerCase()}-${period}`;
}

export async function audit(
  ctx: MutationCtx,
  entry: {
    kind: AuditKind;
    tier?: Tier;
    period?: string;
    listingId?: Id<"listings">;
    awardId?: Id<"awards">;
    roundId?: Id<"rounds">;
    actorId?: Id<"users">;
    reason?: string;
    details?: unknown;
  },
) {
  await ctx.db.insert("awardAudit", { ...entry, details: entry.details ?? null, createdAt: Date.now() });
}

/** The jury's votes on a listing, as current pillars. */
export async function juryVotesOf(ctx: QueryCtx, listingId: Id<"listings">): Promise<Pillars[]> {
  const rows = await ctx.db
    .query("juryEvaluations")
    .withIndex("by_listing", (q) => q.eq("listingId", listingId))
    .collect();
  return rows.map((r) => readPillars(r.scores));
}

/** Why a listing can't win anything right now, or null if it can. */
export function ineligibility(
  listing: Pick<Doc<"listings">, "byTeam" | "juryVotes" | "finalScore">,
  config: Pick<AwardConfig, "minVotes">,
): string | null {
  if (listing.byTeam) return TEAM_SITE;
  const votes = listing.juryVotes ?? 0;
  if (votes < config.minVotes) return `Needs ${config.minVotes} jury votes to be eligible; it has ${votes}.`;
  if (listing.finalScore === undefined) return "Not scored.";
  return null;
}

/** All of a listing's award rows (active and revoked), oldest first. */
export async function awardsOf(ctx: QueryCtx, listingId: Id<"listings">) {
  return await ctx.db
    .query("awards")
    .withIndex("by_listing", (q) => q.eq("listingId", listingId))
    .collect();
}

/**
 * Re-derives listing.awards (active tiers, highest first) and, once voting
 * has closed, the awarded/archived status from the award rows.
 */
export async function syncListingAwards(ctx: MutationCtx, listingId: Id<"listings">) {
  const listing = await ctx.db.get(listingId);
  if (!listing) return;
  const active = (await awardsOf(ctx, listingId)).filter((a) => a.status === "active");
  const tiers = AWARDS.map((a) => a.slug).filter((t) => active.some((a) => a.tier === t));
  const closed = listing.status === "awarded" || listing.status === "archived";
  await ctx.db.patch(listingId, {
    awards: tiers,
    awardedAt: active.length ? Math.max(...active.map((a) => a.createdAt)) : undefined,
    ...(closed ? { status: tiers.length > 0 ? ("awarded" as const) : ("archived" as const) } : {}),
    updatedAt: Date.now(),
  });
}

export type GrantInput = {
  listingId: Id<"listings">;
  tier: Tier;
  period: string;
  score: number | null;
  now: number;
  /** "manual": an admin's override; needs actorId and a reason. */
  source: "auto" | "manual";
  actorId?: Id<"users">;
  reason?: string;
  roundId?: Id<"rounds">;
  details?: unknown;
};

/** Gives an award, or throws a readable error when a rule forbids it. */
export async function grantAward(ctx: MutationCtx, input: GrantInput): Promise<Id<"awards">> {
  const listing = await ctx.db.get(input.listingId);
  if (!listing) throw new Error("Listing not found.");
  if (listing.byTeam) throw new Error(TEAM_SITE);
  const honorary = input.tier === "F100";
  if (honorary) {
    // Honorary, not scored: any site with a public page, also while in voting.
    if (!isPublicStatus(listing.status)) throw new Error("Only a public site can get the First 100 badge.");
    const number = await nextFirst100Number(ctx);
    if (!number) throw new Error(`All ${FIRST_100} First 100 badges have been given.`);
    input = { ...input, period: number, score: null };
  } else if (listing.status !== "awarded" && listing.status !== "archived") {
    throw new Error("Only a public site whose voting has closed can get an award.");
  }
  const reason = input.reason?.trim() || (honorary ? FIRST_100_REASON : undefined);
  if (input.source === "manual" && !reason) throw new Error("Give a reason for a manual award.");

  const name = TIER_NAMES[input.tier];
  if (UNIQUE_TIERS.includes(input.tier)) {
    const holder = (
      await ctx.db
        .query("awards")
        .withIndex("by_tier_period", (q) => q.eq("tier", input.tier).eq("period", input.period))
        .collect()
    ).find((a) => a.status === "active");
    if (holder) throw new Error(`${input.period} already has a ${name}. Revoke it first.`);
  }
  const mine = await awardsOf(ctx, listing._id);
  const already = mine.find(
    (a) =>
      a.status === "active" &&
      a.tier === input.tier &&
      (UNIQUE_TIERS.includes(input.tier) || a.period === input.period),
  );
  if (already) {
    throw new Error(
      honorary
        ? `“${listing.title}” already has the First 100 badge (No. ${already.period}).`
        : `“${listing.title}” already won ${name} (${already.date}). A site wins it once.`,
    );
  }

  const date = tbilisiDay(input.now);
  const id = await ctx.db.insert("awards", {
    listingId: listing._id,
    tier: input.tier,
    period: input.period,
    date,
    score: input.score,
    slug: awardSlug(listing.slug, input.tier, input.period),
    status: "active",
    source: input.source,
    grantedBy: input.actorId,
    reason,
    createdAt: input.now,
  });
  if (input.tier === "SOTD" && listing.sotdQueuedAt !== undefined) {
    await ctx.db.patch(listing._id, { sotdQueuedAt: undefined });
  }
  await syncListingAwards(ctx, listing._id);
  await audit(ctx, {
    kind: "granted",
    tier: input.tier,
    period: input.period,
    listingId: listing._id,
    awardId: id,
    roundId: input.roundId,
    actorId: input.actorId,
    reason,
    details: { score: input.score, source: input.source, ...((input.details as object) ?? {}) },
  });
  // Winner email, social post, search engine pings.
  await ctx.scheduler.runAfter(0, internal.notify.awardAnnounced, { awardId: id });
  await scheduleIndexNow(ctx, [
    ...(await listingPaths(ctx, listing)),
    ...awardPaths([input.tier]),
    `/awards/${awardSlug(listing.slug, input.tier, input.period)}`,
  ]);
  return id;
}

/** Revokes an award (admin). The badge stops showing; the reason is logged. */
export async function revokeAward(
  ctx: MutationCtx,
  awardId: Id<"awards">,
  { actorId, reason, now }: { actorId?: Id<"users">; reason: string; now: number },
) {
  const award = await ctx.db.get(awardId);
  if (!award) throw new Error("Award not found.");
  if (award.status === "revoked") throw new Error("This award is already revoked.");
  const why = reason.trim();
  if (!why) throw new Error("Give a reason for revoking the award.");
  await ctx.db.patch(awardId, { status: "revoked", revokedAt: now, revokedBy: actorId, revokeReason: why });
  await syncListingAwards(ctx, award.listingId);
  await audit(ctx, {
    kind: "revoked",
    tier: award.tier,
    period: award.period,
    listingId: award.listingId,
    awardId,
    actorId,
    reason: why,
    details: { date: award.date, score: award.score },
  });
  const listing = await ctx.db.get(award.listingId);
  if (listing) {
    await scheduleIndexNow(ctx, [...(await listingPaths(ctx, listing)), ...awardPaths([award.tier]), `/awards/${award.slug}`]);
  }
}

/** Whether a listing ever won (active) this tier. */
async function hasWon(ctx: QueryCtx, listingId: Id<"listings">, tier: Tier) {
  return (await awardsOf(ctx, listingId)).some((a) => a.tier === tier && a.status === "active");
}

/**
 * Closes a listing's voting: final score from the jury votes, then, if it is
 * eligible, Honorable Mention (≥ honorableMentionMin), Best Solo Creation
 * (solo, ≥ bscMin) and a place in the Site of the Day queue (≥ sotdMin).
 * Returns the tiers given now. Safe to call twice: a closed listing is skipped.
 */
export async function closeVoting(ctx: MutationCtx, listing: Doc<"listings">, config: AwardConfig, now: number) {
  if (listing.status !== "in_voting") return null;
  const votes = await juryVotesOf(ctx, listing._id);
  const editorial = averagePillars(votes) ?? (listing.editorialScores ? readPillars(listing.editorialScores) : null);
  const scores = scoreFields(editorial ?? undefined, readPillars(listing.communityTotals), listing.communityVotesCount);
  // A vote-based score when there are votes; else whatever an admin entered (not eligible).
  const final = votes.length ? finalScore(votes) : (scores.finalScore ?? null);
  await ctx.db.patch(listing._id, {
    ...scores,
    finalScore: final ?? undefined,
    editorialScores: editorial ?? undefined,
    juryVotes: votes.length,
    status: "archived",
    updatedAt: now,
  });
  const closed = (await ctx.db.get(listing._id))!;
  const blocked = ineligibility(closed, config);
  const period = closed.batchWeek ?? weekOf(closed.publishedAt ?? closed.createdAt);

  const given: Tier[] = [];
  const queued = !blocked && final !== null && final >= config.sotdMin && !(await hasWon(ctx, closed._id, "SOTD"));
  if (queued) await ctx.db.patch(closed._id, { sotdQueuedAt: now });
  if (!blocked && final !== null && final >= config.honorableMentionMin) {
    await grantAward(ctx, { listingId: closed._id, tier: "HM", period, score: final, now, source: "auto" });
    given.push("HM");
  }
  if (!blocked && final !== null && closed.creatorTier === "solo" && final >= config.bscMin) {
    await grantAward(ctx, { listingId: closed._id, tier: "BSC", period, score: final, now, source: "auto" });
    given.push("BSC");
  }
  // Awards it already holds (the honorary First 100) keep it "awarded".
  await syncListingAwards(ctx, closed._id);
  await audit(ctx, {
    kind: "batch_closed",
    period,
    listingId: closed._id,
    details: {
      finalScore: final,
      juryVotes: votes.length,
      eligible: !blocked,
      ineligibleBecause: blocked,
      thresholds: { hm: config.honorableMentionMin, sotd: config.sotdMin, bsc: config.bscMin, minVotes: config.minVotes },
      awards: given,
      sotdQueued: queued,
    },
  });
  return given;
}

/** Tie-break inputs for a listing with these votes. */
export function rankOf(listing: Doc<"listings">, votes: Pillars[], score: number) {
  const avg = averagePillars(votes);
  return { finalScore: score, votes: votes.length, design: avg?.design ?? 0, submittedAt: listing.createdAt };
}

export { isPublicStatus };
