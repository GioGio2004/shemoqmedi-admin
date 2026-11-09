// Award jobs and the award API.
//
// Scheduled (crons.ts runs `tick` every 15 minutes; every step is idempotent):
//   1. closeEndedVoting   — weekly batches whose judging week has ended:
//                           HM / BSC, and the Site of the Day queue.
//   2. announceSiteOfTheDay — at config.announceTime (Tbilisi) each day, the
//                           best queued site becomes Site of the Day. Empty
//                           queue: no winner, and the admins get an email.
//   3. openRounds         — 1st of the month: Site of the Month round over
//                           last month's SOTD winners. 1 January: Site of the
//                           Year round over last year's SOTM winners.
//   4. announceRounds     — when a round's announce time comes, its best
//                           eligible candidate wins.
//
// Rules live in lib/awards.ts; config in lib/config.ts; time in lib/time.ts.

import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireAdmin } from "./authHelpers";
import { award as vTier } from "./schema";
import { mediaUrl } from "./lib/media";
import { listingPaths, scheduleIndexNow } from "./seo";
import { isPublicStatus } from "./lib/listingHelpers";
import { readPillars, compareRanked, finalScore } from "./lib/scoring";
import { DEFAULT_CONFIG, checkConfig, getConfig, type AwardConfig } from "./lib/config";
import {
  TIER_NAMES,
  audit,
  closeVoting,
  grantAward,
  ineligibility,
  juryVotesOf,
  rankOf,
  revokeAward,
  syncListingAwards,
  type Tier,
} from "./lib/awards";
import {
  addDays,
  atTime,
  isDay,
  previousMonth,
  tbilisiDay,
  tbilisiMonth,
} from "./lib/time";

const fail = (message: string): never => {
  throw new ConvexError(message);
};

/** Turns rule errors from lib/awards.ts into readable client errors. */
async function rule<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ConvexError) throw err;
    throw new ConvexError((err as Error).message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduled steps (exported for tests)
// ─────────────────────────────────────────────────────────────────────────────

/** Closes every listing whose voting (its batch's judging week) has ended. */
export async function closeEndedVoting(ctx: MutationCtx, now: number, config: AwardConfig) {
  const ended = await ctx.db
    .query("listings")
    .withIndex("by_status_votingEndsAt", (q) => q.eq("status", "in_voting").lte("votingEndsAt", now))
    .take(100);
  const paths: string[] = [];
  for (const listing of ended) {
    await closeVoting(ctx, listing, config, now);
    paths.push(...(await listingPaths(ctx, listing)));
  }
  await scheduleIndexNow(ctx, paths); // one ping for the whole batch
  return ended.length;
}

/** The Site of the Day queue, best first (ties: votes, Design, earlier submission). */
export async function sotdQueue(ctx: QueryCtx, config: AwardConfig) {
  const queued = await ctx.db
    .query("listings")
    .withIndex("by_sotdQueue", (q) => q.gt("sotdQueuedAt", 0))
    .take(500);
  const entries = [];
  for (const listing of queued) {
    const votes = await juryVotesOf(ctx, listing._id);
    const score = finalScore(votes) ?? listing.finalScore ?? 0;
    entries.push({
      listing,
      score,
      votes: votes.length,
      rank: rankOf(listing, votes, score),
      blocked:
        !isPublicStatus(listing.status) || listing.status === "in_voting"
          ? "Not public with voting closed."
          : ineligibility({ ...listing, juryVotes: votes.length }, config),
    });
  }
  return entries.sort((a, b) => compareRanked(a.rank, b.rank));
}

async function emptyDayLogged(ctx: QueryCtx, day: string) {
  return (
    (await ctx.db
      .query("awardAudit")
      .withIndex("by_kind_period", (q) => q.eq("kind", "empty_day").eq("period", day))
      .first()) !== null
  );
}

/**
 * Today's Site of the Day, once the announce time has passed. A day that
 * already had one (even if an admin revoked it since) is left alone; so is
 * a day already logged as empty. Returns what happened.
 */
export async function announceSiteOfTheDay(ctx: MutationCtx, now: number, config: AwardConfig) {
  const day = tbilisiDay(now);
  if (now < atTime(day, config.announceTime)) return "not_yet" as const;
  const decided = await ctx.db
    .query("awards")
    .withIndex("by_tier_period", (q) => q.eq("tier", "SOTD").eq("period", day))
    .first();
  if (decided) return "done" as const;
  if (await emptyDayLogged(ctx, day)) return "empty" as const;

  const queue = await sotdQueue(ctx, config);
  for (const entry of queue.filter((e) => e.blocked)) {
    // No longer eligible (unpublished, team site, votes removed): out of the queue.
    await ctx.db.patch(entry.listing._id, { sotdQueuedAt: undefined });
    await audit(ctx, {
      kind: "queue_removed",
      tier: "SOTD",
      period: day,
      listingId: entry.listing._id,
      reason: entry.blocked ?? undefined,
    });
  }
  const winner = queue.find((e) => !e.blocked);
  const candidates = queue.map((e) => ({ listingId: e.listing._id, title: e.listing.title, ...e.rank, blocked: e.blocked }));
  if (!winner) {
    await audit(ctx, { kind: "empty_day", tier: "SOTD", period: day, details: { candidates } });
    await ctx.scheduler.runAfter(0, internal.notify.emptyDay, { day });
    return "empty" as const;
  }
  await grantAward(ctx, {
    listingId: winner.listing._id,
    tier: "SOTD",
    period: day,
    score: winner.score,
    now,
    source: "auto",
    details: { candidates },
  });
  return "announced" as const;
}

/** Opens this month's Site of the Month round and (in January) the Site of the Year round. */
export async function openRounds(ctx: MutationCtx, now: number, config: AwardConfig) {
  const today = tbilisiDay(now);
  const opened: string[] = [];

  // Site of the Month: on the 1st (or the first tick after), for last month.
  const first = `${tbilisiMonth(now)}-01`;
  const month = previousMonth(first);
  const monthOpens = atTime(first, config.announceTime);
  if (now >= monthOpens) {
    const closes = atTime(addDays(first, config.monthlyRoundDays), config.announceTime);
    const done = await openRound(ctx, {
      kind: "SOTM",
      period: month,
      sourceTier: "SOTD",
      prefix: `${month}-`,
      opensAt: monthOpens,
      closesAt: closes,
      announceAt: closes, // the 6th with the default 5 days
      now,
    });
    if (done) opened.push(`SOTM ${month}`);
  }

  // Site of the Year: in January, for last year.
  if (today.slice(5, 7) === "01") {
    const year = String(Number(today.slice(0, 4)) - 1);
    const jan1 = `${today.slice(0, 4)}-01-01`;
    const yearOpens = atTime(jan1, config.announceTime);
    if (now >= yearOpens) {
      const closes = atTime(addDays(jan1, config.yearlyRoundDays), config.announceTime);
      const announce = atTime(`${today.slice(0, 4)}-${config.yearlyAnnounceDate}`, config.announceTime);
      const done = await openRound(ctx, {
        kind: "SOTY",
        period: year,
        sourceTier: "SOTM",
        prefix: `${year}-`,
        opensAt: yearOpens,
        closesAt: closes,
        announceAt: Math.max(closes, announce),
        now,
      });
      if (done) opened.push(`SOTY ${year}`);
    }
  }
  return opened;
}

async function openRound(
  ctx: MutationCtx,
  r: {
    kind: "SOTM" | "SOTY";
    period: string;
    sourceTier: Tier;
    prefix: string;
    opensAt: number;
    closesAt: number;
    announceAt: number;
    now: number;
  },
) {
  const existing = await ctx.db
    .query("rounds")
    .withIndex("by_kind_period", (q) => q.eq("kind", r.kind).eq("period", r.period))
    .first();
  if (existing) return false;
  const winners = (
    await ctx.db
      .query("awards")
      .withIndex("by_tier_period", (q) =>
        q.eq("tier", r.sourceTier).gte("period", r.prefix).lt("period", `${r.prefix}￿`),
      )
      .collect()
  ).filter((a) => a.status === "active");
  const candidates = [...new Set(winners.map((a) => a.listingId))];
  const roundId = await ctx.db.insert("rounds", {
    kind: r.kind,
    period: r.period,
    candidates,
    opensAt: r.opensAt,
    closesAt: r.closesAt,
    announceAt: r.announceAt,
    status: candidates.length ? "open" : "announced",
    createdAt: r.now,
  });
  await audit(ctx, {
    kind: "round_opened",
    tier: r.kind,
    period: r.period,
    roundId,
    details: { candidates, closesAt: r.closesAt, announceAt: r.announceAt },
  });
  if (candidates.length === 0) {
    await audit(ctx, { kind: "round_decided", tier: r.kind, period: r.period, roundId, reason: "No candidates." });
  }
  return true;
}

/** Scores of every candidate in a round, best first. */
export async function roundResults(ctx: QueryCtx, round: Doc<"rounds">, config: AwardConfig) {
  const out = [];
  for (const listingId of round.candidates) {
    const listing = await ctx.db.get(listingId);
    if (!listing) continue;
    const votes = (
      await ctx.db
        .query("roundVotes")
        .withIndex("by_round_listing", (q) => q.eq("roundId", round._id).eq("listingId", listingId))
        .collect()
    ).map((v) => readPillars(v.scores));
    const score = finalScore(votes);
    const alreadyWon = (
      await ctx.db
        .query("awards")
        .withIndex("by_listing", (q) => q.eq("listingId", listingId))
        .collect()
    ).some((a) => a.tier === round.kind && a.status === "active");
    let blocked: string | null = null;
    if (listing.byTeam) blocked = "Shemoqmedi team site.";
    else if (!isPublicStatus(listing.status)) blocked = "No longer public.";
    else if (alreadyWon) blocked = `Already won ${TIER_NAMES[round.kind]}.`;
    else if (votes.length < config.minVotes) blocked = `Needs ${config.minVotes} jury votes; has ${votes.length}.`;
    out.push({ listing, votes: votes.length, score, blocked, rank: rankOf(listing, votes, score ?? 0) });
  }
  return out.sort((a, b) => compareRanked(a.rank, b.rank));
}

/** Announces every open round whose announce time has come. */
export async function announceRounds(ctx: MutationCtx, now: number, config: AwardConfig) {
  const due = await ctx.db
    .query("rounds")
    .withIndex("by_status", (q) => q.eq("status", "open").lte("announceAt", now))
    .take(10);
  for (const round of due) {
    const results = await roundResults(ctx, round, config);
    const winner = results.find((r) => !r.blocked && r.score !== null);
    const details = {
      results: results.map((r) => ({ listingId: r.listing._id, title: r.listing.title, ...r.rank, score: r.score, blocked: r.blocked })),
    };
    if (winner) {
      await grantAward(ctx, {
        listingId: winner.listing._id,
        tier: round.kind,
        period: round.period,
        score: winner.score,
        now,
        source: "auto",
        roundId: round._id,
        details,
      });
    } else {
      await ctx.scheduler.runAfter(0, internal.notify.noRoundWinner, { roundId: round._id });
    }
    await ctx.db.patch(round._id, { status: "announced", winnerId: winner?.listing._id });
    await audit(ctx, {
      kind: "round_decided",
      tier: round.kind,
      period: round.period,
      roundId: round._id,
      listingId: winner?.listing._id,
      reason: winner ? undefined : "No eligible candidate.",
      details,
    });
  }
  return due.length;
}

/** The scheduled job (crons.ts). Each step is safe to run again. */
export const tick = internalMutation({
  args: {},
  returns: v.object({ closed: v.number(), sotd: v.string(), opened: v.array(v.string()), announced: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const config = await getConfig(ctx);
    const closed = await closeEndedVoting(ctx, now, config);
    const sotd = await announceSiteOfTheDay(ctx, now, config);
    const opened = await openRounds(ctx, now, config);
    const announced = await announceRounds(ctx, now, config);
    return { closed, sotd, opened, announced };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Public
// ─────────────────────────────────────────────────────────────────────────────

const publicAward = v.object({
  slug: v.string(),
  tier: vTier,
  name: v.string(),
  period: v.string(),
  date: v.string(),
  score: v.union(v.number(), v.null()),
  listing: v.object({
    slug: v.string(),
    title: v.string(),
    url: v.string(),
    creditName: v.string(),
    creatorSlug: v.union(v.string(), v.null()),
    coverUrl: v.union(v.string(), v.null()),
  }),
});

async function toPublicAward(ctx: QueryCtx, award: Doc<"awards">) {
  const listing = await ctx.db.get(award.listingId);
  if (!listing || !isPublicStatus(listing.status) || award.status !== "active") return null;
  const creator = listing.creatorId ? await ctx.db.get(listing.creatorId) : null;
  return {
    slug: award.slug,
    tier: award.tier,
    name: TIER_NAMES[award.tier],
    period: award.period,
    date: award.date,
    score: award.score,
    listing: {
      slug: listing.slug,
      title: listing.title,
      url: listing.url,
      creditName: listing.creditName,
      creatorSlug: creator?.slug ?? null,
      coverUrl: await mediaUrl(ctx, listing.coverId),
    },
  };
}

/** An active award by its slug (/awards/<slug> and the badge image). */
export const getBySlug = query({
  args: { slug: v.string() },
  returns: v.union(publicAward, v.null()),
  handler: async (ctx, { slug }) => {
    const award = await ctx.db
      .query("awards")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    return award ? await toPublicAward(ctx, award) : null;
  },
});

/** A site's award history, newest first (active awards only). */
export const forListing = query({
  args: { slug: v.string() },
  returns: v.array(publicAward),
  handler: async (ctx, { slug }) => {
    const listing = await ctx.db
      .query("listings")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!listing) return [];
    const rows = await ctx.db
      .query("awards")
      .withIndex("by_listing", (q) => q.eq("listingId", listing._id))
      .order("desc")
      .collect();
    const out = await Promise.all(rows.map((a) => toPublicAward(ctx, a)));
    return out.filter((a) => a !== null);
  },
});

/** Every active award of one tier, newest first (the dated archives). */
export const listPublic = query({
  args: { tier: vTier, limit: v.optional(v.number()) },
  returns: v.array(publicAward),
  handler: async (ctx, { tier, limit }) => {
    const rows = await ctx.db
      .query("awards")
      .withIndex("by_tier_date", (q) => q.eq("tier", tier))
      .order("desc")
      .take(Math.min(limit ?? 400, 1000));
    const out = await Promise.all(rows.map((a) => toPublicAward(ctx, a)));
    return out.filter((a) => a !== null);
  },
});

/** Every active award slug, for the sitemap and static params. */
export const publicSlugs = query({
  args: {},
  returns: v.array(v.object({ slug: v.string(), createdAt: v.number() })),
  handler: async (ctx) => {
    const rows = (await ctx.db.query("awards").withIndex("by_created").order("desc").take(2000)).filter(
      (a) => a.status === "active",
    );
    const out = [];
    for (const a of rows) {
      const listing = await ctx.db.get(a.listingId);
      if (listing && isPublicStatus(listing.status)) out.push({ slug: a.slug, createdAt: a.createdAt });
    }
    return out;
  },
});

/**
 * The signed-in owner's awards, for their badge page. Only the verified
 * owner of a winning site (or an admin, via the admin app) gets the embed
 * code; nobody can make a badge for an award a site didn't win.
 */
export const mine = query({
  args: {},
  returns: v.array(publicAward),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", identity.subject))
      .unique();
    if (!user) return [];
    const owned = await ctx.db
      .query("listings")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .take(100);
    const out = [];
    for (const listing of owned) {
      const rows = await ctx.db
        .query("awards")
        .withIndex("by_listing", (q) => q.eq("listingId", listing._id))
        .order("desc")
        .collect();
      for (const a of rows) {
        const award = await toPublicAward(ctx, a);
        if (award) out.push(award);
      }
    }
    return out;
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
  coverUrl: v.union(v.string(), v.null()),
});

async function toEntry(ctx: QueryCtx, l: Doc<"listings">) {
  return { id: l._id, slug: l.slug, title: l.title, creditName: l.creditName, coverUrl: await mediaUrl(ctx, l.coverId) };
}

/** Admin: the Awards page — queue (with projected dates), recent awards, rounds, settings. */
export const overview = query({
  args: {},
  returns: v.object({
    today: v.string(),
    config: v.any(),
    defaults: v.any(),
    queue: v.array(
      v.object({
        listing: entry,
        score: v.number(),
        votes: v.number(),
        design: v.number(),
        blocked: v.union(v.string(), v.null()),
        projectedDay: v.union(v.string(), v.null()),
      }),
    ),
    recent: v.array(
      v.object({
        id: v.id("awards"),
        tier: vTier,
        period: v.string(),
        date: v.string(),
        slug: v.string(),
        score: v.union(v.number(), v.null()),
        status: v.union(v.literal("active"), v.literal("revoked")),
        source: v.union(v.literal("auto"), v.literal("manual")),
        reason: v.union(v.string(), v.null()),
        revokeReason: v.union(v.string(), v.null()),
        listing: v.union(entry, v.null()),
      }),
    ),
    rounds: v.array(
      v.object({
        id: v.id("rounds"),
        kind: v.union(v.literal("SOTM"), v.literal("SOTY")),
        period: v.string(),
        status: v.union(v.literal("open"), v.literal("announced")),
        closesAt: v.number(),
        announceAt: v.number(),
        winner: v.union(entry, v.null()),
        results: v.array(
          v.object({
            listing: entry,
            votes: v.number(),
            score: v.union(v.number(), v.null()),
            blocked: v.union(v.string(), v.null()),
          }),
        ),
      }),
    ),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const now = Date.now();
    const config = await getConfig(ctx);
    const today = tbilisiDay(now);

    // Projected days: the next undecided day on, one per eligible site.
    const queue = await sotdQueue(ctx, config);
    const todayDecided =
      (await ctx.db
        .query("awards")
        .withIndex("by_tier_period", (q) => q.eq("tier", "SOTD").eq("period", today))
        .first()) !== null || now >= atTime(today, config.announceTime);
    let next = todayDecided ? addDays(today, 1) : today;
    const queueOut = [];
    for (const e of queue) {
      queueOut.push({
        listing: await toEntry(ctx, e.listing),
        score: e.score,
        votes: e.votes,
        design: e.rank.design,
        blocked: e.blocked,
        projectedDay: e.blocked ? null : next,
      });
      if (!e.blocked) next = addDays(next, 1);
    }

    const recentRows = await ctx.db.query("awards").withIndex("by_created").order("desc").take(60);
    const recent = await Promise.all(
      recentRows.map(async (a) => {
        const l = await ctx.db.get(a.listingId);
        return {
          id: a._id,
          tier: a.tier,
          period: a.period,
          date: a.date,
          slug: a.slug,
          score: a.score,
          status: a.status,
          source: a.source,
          reason: a.reason ?? null,
          revokeReason: a.revokeReason ?? null,
          listing: l ? await toEntry(ctx, l) : null,
        };
      }),
    );

    const roundRows = await ctx.db.query("rounds").order("desc").take(14);
    const rounds = [];
    for (const r of roundRows) {
      const results = await roundResults(ctx, r, config);
      const winner = r.winnerId ? await ctx.db.get(r.winnerId) : null;
      rounds.push({
        id: r._id,
        kind: r.kind,
        period: r.period,
        status: r.status,
        closesAt: r.closesAt,
        announceAt: r.announceAt,
        winner: winner ? await toEntry(ctx, winner) : null,
        results: await Promise.all(
          results.map(async (x) => ({ listing: await toEntry(ctx, x.listing), votes: x.votes, score: x.score, blocked: x.blocked })),
        ),
      });
    }
    return { today, config, defaults: DEFAULT_CONFIG, queue: queueOut, recent, rounds };
  },
});

/** Admin: the audit log, newest first. */
export const auditLog = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      id: v.id("awardAudit"),
      kind: v.string(),
      tier: v.union(v.string(), v.null()),
      period: v.union(v.string(), v.null()),
      listing: v.union(v.object({ slug: v.string(), title: v.string() }), v.null()),
      actor: v.union(v.string(), v.null()),
      reason: v.union(v.string(), v.null()),
      details: v.any(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, { limit }) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("awardAudit").withIndex("by_created").order("desc").take(Math.min(limit ?? 100, 500));
    return Promise.all(
      rows.map(async (r) => {
        const l = r.listingId ? await ctx.db.get(r.listingId) : null;
        const actor = r.actorId ? await ctx.db.get(r.actorId) : null;
        return {
          id: r._id,
          kind: r.kind,
          tier: r.tier ?? null,
          period: r.period ?? null,
          listing: l ? { slug: l.slug, title: l.title } : null,
          actor: actor?.name ?? null,
          reason: r.reason ?? null,
          details: r.details ?? null,
          createdAt: r.createdAt,
        };
      }),
    );
  },
});

/** Admin override: give an award by hand (reason required, logged). */
export const grant = mutation({
  args: { listingId: v.id("listings"), tier: vTier, period: v.optional(v.string()), reason: v.string() },
  returns: v.id("awards"),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const now = Date.now();
    const listing = await ctx.db.get(args.listingId);
    if (!listing) fail("Listing not found.");
    const period = args.period?.trim() || defaultPeriod(args.tier, now);
    checkPeriod(args.tier, period);
    return await rule(() =>
      grantAward(ctx, {
        listingId: args.listingId,
        tier: args.tier,
        period,
        score: listing!.finalScore ?? null,
        now,
        source: "manual",
        actorId: admin._id,
        reason: args.reason,
      }),
    );
  },
});

function defaultPeriod(tier: Tier, now: number) {
  if (tier === "SOTM") return tbilisiMonth(now);
  if (tier === "SOTY") return tbilisiDay(now).slice(0, 4);
  return tbilisiDay(now);
}

function checkPeriod(tier: Tier, period: string) {
  const ok =
    tier === "SOTM" ? /^\d{4}-(0[1-9]|1[0-2])$/.test(period) : tier === "SOTY" ? /^\d{4}$/.test(period) : isDay(period);
  if (!ok) {
    fail(
      tier === "SOTM"
        ? 'Site of the Month needs a month like "2026-11".'
        : tier === "SOTY"
          ? 'Site of the Year needs a year like "2026".'
          : 'Pick a date like "2026-11-12".',
    );
  }
}

/** Admin override: revoke an award (reason required, logged). */
export const revoke = mutation({
  args: { awardId: v.id("awards"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, { awardId, reason }) => {
    const admin = await requireAdmin(ctx);
    await rule(() => revokeAward(ctx, awardId, { actorId: admin._id, reason, now: Date.now() }));
    return null;
  },
});

/** Admin: take a site out of the Site of the Day queue (reason logged). */
export const removeFromQueue = mutation({
  args: { listingId: v.id("listings"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, { listingId, reason }) => {
    const admin = await requireAdmin(ctx);
    const why = reason.trim();
    if (!why) fail("Give a reason.");
    const listing = await ctx.db.get(listingId);
    if (!listing || listing.sotdQueuedAt === undefined) fail("This site is not in the queue.");
    await ctx.db.patch(listingId, { sotdQueuedAt: undefined });
    await audit(ctx, { kind: "queue_removed", tier: "SOTD", listingId, actorId: admin._id, reason: why });
    return null;
  },
});

/**
 * Admin: mark (or unmark) a site as built by the Shemoqmedi team. Marking it
 * revokes its active awards and takes it out of the queue, all logged.
 */
export const setTeamSite = mutation({
  args: { listingId: v.id("listings"), byTeam: v.boolean() },
  returns: v.object({ revoked: v.number() }),
  handler: async (ctx, { listingId, byTeam }) => {
    const admin = await requireAdmin(ctx);
    const listing = await ctx.db.get(listingId);
    if (!listing) fail("Listing not found.");
    const now = Date.now();
    await ctx.db.patch(listingId, {
      byTeam: byTeam || undefined,
      ...(byTeam ? { sotdQueuedAt: undefined } : {}),
      updatedAt: now,
    });
    let revoked = 0;
    if (byTeam) {
      const active = (
        await ctx.db
          .query("awards")
          .withIndex("by_listing", (q) => q.eq("listingId", listingId))
          .collect()
      ).filter((a) => a.status === "active");
      for (const a of active) {
        await revokeAward(ctx, a._id, { actorId: admin._id, reason: "Shemoqmedi team site: not eligible for awards.", now });
        revoked += 1;
      }
    }
    await audit(ctx, { kind: "team_site", listingId, actorId: admin._id, details: { byTeam, revoked } });
    await syncListingAwards(ctx, listingId);
    return { revoked };
  },
});

/** Admin: change award settings (logged). Omitted fields keep their value; null resets to the default. */
export const updateSettings = mutation({
  args: {
    minVotes: v.optional(v.number()),
    honorableMentionMin: v.optional(v.number()),
    sotdMin: v.optional(v.number()),
    bscMin: v.optional(v.number()),
    announceTime: v.optional(v.string()),
    monthlyRoundDays: v.optional(v.number()),
    yearlyRoundDays: v.optional(v.number()),
    yearlyAnnounceDate: v.optional(v.string()),
    resubmitMonths: v.optional(v.number()),
    digestTime: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const before = await getConfig(ctx);
    const next: AwardConfig = { ...before, ...args };
    try {
      checkConfig(next);
    } catch (err) {
      fail((err as Error).message);
    }
    const row = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "awards"))
      .unique();
    const stored = Object.fromEntries(
      Object.entries(next).filter(([k, val]) => val !== DEFAULT_CONFIG[k as keyof AwardConfig]),
    );
    if (row) await ctx.db.patch(row._id, { awards: stored, updatedAt: Date.now() });
    else await ctx.db.insert("settings", { key: "awards", awards: stored, updatedAt: Date.now() });
    await audit(ctx, { kind: "settings", actorId: admin._id, details: { before, after: next } });
    return null;
  },
});
