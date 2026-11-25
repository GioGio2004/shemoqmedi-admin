import { ConvexError, v } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { award, creatorTier, listingStatus, pillars, region } from "../schema";
import { deleteMediaMany, isAdminUser, mediaInfo, mediaStillUsed, mediaUrl, type MediaActor, type MediaId } from "./media";
import { CATEGORIES, LIMITS, isCategory, isTechnology, type CategorySlug, type CreatorTier, type RegionSlug } from "./taxonomy";
import { ZERO_PILLARS, readPillars, round2, summarize, type Pillars, type StoredPillars } from "./scoring";
import { latinizeGeorgian } from "./georgian";

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

export function fail(message: string): never {
  throw new ConvexError(message);
}

export function cleanText(value: string, field: string, max: number, required = true) {
  const text = value.trim().replace(/\s+/g, " ");
  if (required && !text) fail(`${field} is required.`);
  if (text.length > max) fail(`${field} must be ${max} characters or fewer.`);
  return text;
}

/**
 * Multi-paragraph text (the listing write-up): paragraphs are kept (split on
 * blank lines, joined with one blank line), whitespace inside each is
 * collapsed. "" when empty and not required.
 */
export function cleanParagraphs(value: string, field: string, max: number, required = true) {
  const text = value
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join("\n\n");
  if (required && !text) fail(`${field} is required.`);
  if (text.length > max) fail(`${field} must be ${max} characters or fewer.`);
  return text;
}

/** Up to LIMITS.technologies known technology names, deduplicated. */
export function checkTechnologies(technologies: string[]) {
  const unique = [...new Set(technologies)];
  if (unique.length > LIMITS.technologies) fail(`Choose up to ${LIMITS.technologies} technologies.`);
  if (!unique.every(isTechnology)) fail("Unknown technology selected.");
  return unique;
}

/** Normalizes a public http(s) URL, or throws. */
export function normalizeUrl(input: string, field = "Website URL"): string {
  const raw = input.trim();
  if (!raw) fail(`${field} is required.`);
  if (raw.length > LIMITS.url) fail(`${field} is too long.`);
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    fail(`${field} is not a valid address.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    fail(`${field} must start with http:// or https://.`);
  }
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":")) {
    fail(`${field} must be a public website address.`);
  }
  url.hash = "";
  url.hostname = host;
  const out = url.toString();
  return url.pathname === "/" && !url.search ? out.replace(/\/$/, "") : out;
}

export function slugify(value: string, fallback = "site") {
  return (
    latinizeGeorgian(value)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || fallback
  );
}

/** How many old slugs a listing keeps redirecting from. */
export const MAX_PREVIOUS_SLUGS = 10;

/** A listing's slug base: its title, or its domain when the title has no usable letters. */
export function listingSlugBase(title: string, url: string) {
  let host = "";
  try {
    host = new URL(url).host.replace(/^www\./, "");
  } catch {
    // not a URL: the plain fallback
  }
  return slugify(title, slugify(host, "site"));
}

/** How many listings the slug-history scans read (see retiredListingSlugs). */
const SLUG_SCAN_LIMIT = 1000;

/**
 * Old slugs of other listings, which still redirect to them. Convex cannot
 * index array elements, and the showcase is hand-curated (well under
 * SLUG_SCAN_LIMIT listings), so a bounded table scan is fine here.
 */
export async function retiredListingSlugs(ctx: QueryCtx, except?: Id<"listings">) {
  const rows = await ctx.db.query("listings").take(SLUG_SCAN_LIMIT);
  const out = new Set<string>();
  for (const row of rows) {
    if (row._id === except) continue;
    for (const slug of row.previousSlugs ?? []) out.add(slug);
  }
  return out;
}

/** True when another listing uses `slug` now, or used it before (it redirects). */
export async function listingSlugTaken(ctx: QueryCtx, slug: string, self?: Id<"listings">) {
  const current = await ctx.db
    .query("listings")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .first();
  if (current && current._id !== self) return true;
  return (await retiredListingSlugs(ctx, self)).has(slug);
}

/**
 * The slug history after renaming `listing` to `next`: the current slug is
 * appended (deduped, newest last, at most MAX_PREVIOUS_SLUGS), and `next` is
 * dropped from it when the listing takes an old slug back.
 */
export function previousSlugsAfterRename(listing: Doc<"listings">, next: string) {
  const history = (listing.previousSlugs ?? []).filter((s) => s !== listing.slug && s !== next);
  history.push(listing.slug);
  return history.slice(-MAX_PREVIOUS_SLUGS);
}

/** A free slug for a new row. For listings, other listings' old slugs count as taken. */
export async function uniqueSlug(
  ctx: QueryCtx,
  table: "listings" | "creators",
  base: string,
) {
  const retired = table === "listings" ? await retiredListingSlugs(ctx) : new Set<string>();
  for (let i = 1; i <= 50; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    if (retired.has(candidate)) continue;
    const taken = await ctx.db
      .query(table)
      .withIndex("by_slug", (q) => q.eq("slug", candidate))
      .first();
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * Checks an uploaded file's type and size. (No cleanup on failure: throwing
 * rolls the whole mutation back, deletes included.)
 */
/** Validate extra screenshots: unique, at most LIMITS.gallery, all images. */
export async function checkGallery(ctx: MutationCtx, ids: MediaId[] | undefined, by: MediaActor) {
  const gallery = [...new Set(ids ?? [])];
  if (gallery.length > LIMITS.gallery) {
    fail(`Add up to ${LIMITS.gallery} more screenshots (${LIMITS.gallery + 1} in all).`);
  }
  for (const id of gallery) await assertMedia(ctx, id, "Screenshot", "image", by);
  return gallery.length ? gallery : undefined;
}

export async function assertMedia(
  ctx: MutationCtx,
  id: MediaId,
  field: string,
  kind: "image" | "video",
  by: MediaActor,
) {
  const meta = await mediaInfo(ctx, id);
  if (!meta) fail(`${field} upload was not found. Please upload it again.`);
  // A non-admin may only attach their own uploads (audit C-01): otherwise
  // anyone could attach another listing's file and delete it by withdrawing.
  // Convex storage files carry no uploader (users can't upload there any
  // more), so a non-admin may only use one nothing else points at.
  if (by !== "server" && !isAdminUser(by)) {
    const mediaId = ctx.db.normalizeId("media", id);
    const row = mediaId ? await ctx.db.get(mediaId) : null;
    const owned = row ? row.uploadedBy === by._id : !(await mediaStillUsed(ctx, [id])).size;
    if (!owned) fail(`${field} upload was not found. Please upload it again.`);
  }
  const type = meta.contentType ?? "";
  if (kind === "image") {
    if (!type.startsWith("image/") || meta.size > LIMITS.imageBytes) {
      fail(`${field} must be an image of 5 MB or less.`);
    }
  } else if (!["video/mp4", "video/webm"].includes(type) || meta.size > LIMITS.videoBytesAdmin) {
    // Who may store what size is checked at upload (media.registerVideo: 15 MB, 40 MB for admins).
    fail(`${field} must be an MP4 or WebM video of ${LIMITS.videoBytesAdmin / 1024 / 1024} MB or less.`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Creators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Finds a creator by name-derived slug, or creates one. New creators start
 * unclaimed: a profile only gets an owner through a claim (link or approved
 * request) or an admin's explicit choice (listings.approve with ownership).
 */
export async function findOrCreateCreator(
  ctx: MutationCtx,
  input: {
    name: string;
    tier: CreatorTier;
    region: RegionSlug;
    website?: string;
    location?: string;
  },
): Promise<Id<"creators">> {
  const existing = await creatorByName(ctx, input.name);
  if (existing) return existing._id;
  const now = Date.now();
  return await ctx.db.insert("creators", {
    slug: slugify(input.name, "creator"),
    name: input.name,
    tier: input.tier,
    region: input.region,
    location: input.location,
    website: input.website,
    isClaimed: false,
    createdAt: now,
    updatedAt: now,
  });
}

/** The creator whose slug the credit name maps to, if any. */
export async function creatorByName(ctx: QueryCtx, name: string) {
  const slug = slugify(name, "creator");
  return await ctx.db
    .query("creators")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .first();
}

/**
 * The creator profile a new submission is credited to, or undefined. Typing a
 * studio's name must not attach a site to a profile another account has
 * claimed (it would show on their page under their name), so such a match
 * leaves the submission unlinked: the admin sees the match on review and can
 * link it when approving (listings.approve linkCreator). The submitter's own
 * claimed profile and unclaimed profiles are fine to use, since nothing is
 * public until the admin approves the site.
 */
export async function creatorForSubmission(
  ctx: MutationCtx,
  input: { name: string; tier: CreatorTier; region: RegionSlug; website?: string },
  submitter: Id<"users">,
): Promise<Id<"creators"> | undefined> {
  const existing = await creatorByName(ctx, input.name);
  if (existing && existing.isClaimed && existing.claimedBy !== submitter) return undefined;
  return await findOrCreateCreator(ctx, input);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scores and lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The score fields to patch after editorial scores or community totals
 * change. The final score is the jury's weighted score only; the community
 * score is kept for display. (Voting close recomputes it from the votes
 * themselves: lib/awards.ts closeVoting.)
 */
export function scoreFields(
  editorial: StoredPillars | Pillars | undefined,
  totals: StoredPillars | Pillars,
  count: number,
) {
  const s = summarize(editorial ? readPillars(editorial) : null, readPillars(totals), count);
  return {
    editorialAverage: s.editorialAverage ?? undefined,
    communityAverage: s.communityAverage ?? undefined,
    finalScore: s.finalScore ?? undefined,
  };
}

export const EMPTY_SCORES = {
  communityTotals: ZERO_PILLARS,
  communityVotesCount: 0,
  awards: [] as Doc<"listings">["awards"],
};

/**
 * Whether a listing was ever on the public site: it has a publish date, a
 * public status (older rows may lack the date), or it was withdrawn from one.
 */
export function wasEverPublic(listing: Doc<"listings">) {
  return listing.publishedAt !== undefined || isPublicStatus(listing.status) || listing.status === "withdrawn";
}

/**
 * The patch that brings a withdrawn listing back to the status it had. Its
 * awards, votes and posts were never touched, so nothing else changes.
 */
export function restorePatch(listing: Doc<"listings">, now: number) {
  return {
    status: listing.withdrawnFrom ?? ("archived" as const),
    withdrawnFrom: undefined,
    withdrawnAt: undefined,
    updatedAt: now,
  };
}

/** A listing's award rows, revoked ones included. */
export async function awardRowsOf(ctx: QueryCtx, listingId: Id<"listings">) {
  return await ctx.db
    .query("awards")
    .withIndex("by_listing", (q) => q.eq("listingId", listingId))
    .collect();
}

/**
 * Whether the owner may delete the listing for good rather than archive it:
 * only a submission that never went public and never won anything. Anything
 * else has a history (an indexed page, badges on other sites, votes, posts,
 * emails) that has to survive, so it is withdrawn instead (listings.withdraw).
 */
export async function ownerCanDelete(ctx: QueryCtx, listing: Doc<"listings">) {
  if (wasEverPublic(listing)) return false;
  return (await awardRowsOf(ctx, listing._id)).length === 0;
}

/**
 * Deletes a listing with everything that points at it. Refuses while it
 * holds an active award: revoke it on the Awards page first, so the badge and
 * award page are retired on the record. Rows that only make sense with the
 * listing go with it (votes, evaluations, round votes, conflicts, claims,
 * briefs, revisions, revoked awards, unsent posts). History that must stay is
 * kept with its link cleared: the award audit (plus one "listing_deleted"
 * entry saying what was deleted), sent posts and the email log. Listings that
 * were a redesign of it lose the pointer, and rounds drop it as a candidate.
 * `by` is who asked: an owner only deletes files they uploaded, and no file
 * another listing or juror still uses is deleted (deleteMediaMany, audit C-01).
 */
export async function deleteListing(
  ctx: MutationCtx,
  listing: Doc<"listings">,
  by: MediaActor,
  // wipeShowcase (CLI, deletes everything) is the only caller that skips the award check.
  options: { evenWithActiveAwards?: boolean } = {},
) {
  const actorId = by === "server" ? undefined : by._id;
  const id = listing._id;
  const awards = await awardRowsOf(ctx, id);
  const active = awards.filter((a) => a.status === "active");
  if (active.length > 0 && !options.evenWithActiveAwards) {
    fail(
      `This site holds ${active.map((a) => a.tier).join(", ")}. Revoke ${active.length === 1 ? "it" : "them"} on the Awards page before deleting the listing.`,
    );
  }
  const awardIds = new Set<string>(awards.map((a) => a._id));
  const keepAward = (awardId: Id<"awards"> | undefined) => (awardId && awardIds.has(awardId) ? undefined : awardId);

  const files = [listing.coverId, ...(listing.galleryIds ?? []), ...(listing.videoId ? [listing.videoId] : [])];

  const votes = await ctx.db.query("votes").withIndex("by_listing", (q) => q.eq("listingId", id)).collect();
  for (const row of votes) await ctx.db.delete(row._id);
  const claims = await ctx.db.query("claims").withIndex("by_listing", (q) => q.eq("listingId", id)).collect();
  for (const row of claims) await ctx.db.delete(row._id);
  const evaluations = await ctx.db
    .query("juryEvaluations")
    .withIndex("by_listing", (q) => q.eq("listingId", id))
    .collect();
  for (const row of evaluations) await ctx.db.delete(row._id);
  const conflicts = await ctx.db.query("conflicts").withIndex("by_listing", (q) => q.eq("listingId", id)).collect();
  for (const row of conflicts) await ctx.db.delete(row._id);
  const roundVotes = await ctx.db
    .query("roundVotes")
    .withIndex("by_listing_juror", (q) => q.eq("listingId", id))
    .collect();
  for (const row of roundVotes) await ctx.db.delete(row._id);
  const briefs = await ctx.db.query("listingBriefs").withIndex("by_listing", (q) => q.eq("listingId", id)).collect();
  for (const row of briefs) await ctx.db.delete(row._id);
  const revisions = await ctx.db
    .query("listingRevisions")
    .withIndex("by_listing", (q) => q.eq("listingId", id))
    .collect();
  for (const row of revisions) await ctx.db.delete(row._id);

  // Posts: what went out stays as history (unlinked); the rest goes, with its publish job.
  const posts = await ctx.db.query("socialPosts").withIndex("by_listing_kind", (q) => q.eq("listingId", id)).collect();
  for (const a of awards) {
    const forAward = await ctx.db.query("socialPosts").withIndex("by_award", (q) => q.eq("awardId", a._id)).collect();
    for (const post of forAward) if (!posts.some((p) => p._id === post._id)) posts.push(post);
  }
  for (const post of posts) {
    if (post.status === "sent") {
      await ctx.db.patch(post._id, { listingId: undefined, awardId: keepAward(post.awardId) });
      continue;
    }
    if (post.publishJobId) {
      const job = await ctx.db.system.get(post.publishJobId);
      if (job && (job.state.kind === "pending" || job.state.kind === "inProgress")) {
        await ctx.scheduler.cancel(post.publishJobId);
      }
    }
    await ctx.db.delete(post._id);
  }

  const emails = await ctx.db.query("emailLog").withIndex("by_listing_kind", (q) => q.eq("listingId", id)).collect();
  for (const row of emails) await ctx.db.patch(row._id, { listingId: undefined });

  const audit = await ctx.db.query("awardAudit").withIndex("by_listing", (q) => q.eq("listingId", id)).collect();
  for (const row of audit) await ctx.db.patch(row._id, { listingId: undefined, awardId: keepAward(row.awardId) });
  for (const a of awards) await ctx.db.delete(a._id);

  const redesigns = await ctx.db.query("listings").withIndex("by_redesignOf", (q) => q.eq("redesignOf", id)).collect();
  for (const row of redesigns) await ctx.db.patch(row._id, { redesignOf: undefined });

  // Rounds are few (one a month, one a year), so a bounded scan is fine.
  for (const round of await ctx.db.query("rounds").take(500)) {
    if (!round.candidates.includes(id) && round.winnerId !== id) continue;
    await ctx.db.patch(round._id, {
      candidates: round.candidates.filter((c) => c !== id),
      ...(round.winnerId === id ? { winnerId: undefined } : {}),
    });
  }

  await ctx.db.insert("awardAudit", {
    kind: "listing_deleted",
    actorId,
    details: {
      listingId: id,
      slug: listing.slug,
      title: listing.title,
      url: listing.url,
      status: listing.status,
      revokedAwards: awards.map((a) => ({ tier: a.tier, period: a.period, slug: a.slug })),
    },
    createdAt: Date.now(),
  });
  await ctx.db.delete(id);
  // After the listing is gone, so its own files don't count as "still used".
  await deleteMediaMany(ctx, files, by);
}

// ─────────────────────────────────────────────────────────────────────────────
// Public shape
// ─────────────────────────────────────────────────────────────────────────────

export const PUBLIC_STATUSES = ["in_voting", "awarded", "archived"] as const;

/** in_voting, awarded and archived listings have a public page. */
export function isPublicStatus(status: Doc<"listings">["status"]) {
  return (PUBLIC_STATUSES as readonly string[]).includes(status);
}

/**
 * Whether a listing's judging has closed, so its scores, juror reviews and
 * vote counts may be shown publicly. Judging closes in closeVoting
 * (lib/awards.ts), which moves the listing out of in_voting to archived or
 * awarded; until then every number is a running tally, and showing it would
 * let jurors herd and owners lobby. The cron can run a little after
 * votingEndsAt, so status (not the clock) is the single source of truth.
 */
export function judgingClosed(listing: Pick<Doc<"listings">, "status">) {
  return listing.status === "awarded" || listing.status === "archived";
}

export const publicListing = v.object({
  slug: v.string(),
  title: v.string(),
  tagline: v.string(),
  juryNote: v.union(v.string(), v.null()),
  writeup: v.union(v.string(), v.null()), // "About this site"
  url: v.string(),
  category: v.string(), // primary
  categories: v.array(v.string()), // all, primary first
  technologies: v.array(v.string()),
  region,
  creatorTier,
  creditName: v.string(),
  creditUrl: v.union(v.string(), v.null()),
  creator: v.union(v.object({ slug: v.string(), name: v.string() }), v.null()),
  status: v.union(v.literal("in_voting"), v.literal("awarded"), v.literal("archived")),
  awards: v.array(award),
  editorialScores: v.union(pillars, v.null()),
  communityScores: v.union(pillars, v.null()),
  /** Scores and vote counts are null while judging is open (see judgingClosed). */
  scoresRevealed: v.boolean(),
  communityVotesCount: v.union(v.number(), v.null()),
  editorialAverage: v.union(v.number(), v.null()),
  communityAverage: v.union(v.number(), v.null()),
  finalScore: v.union(v.number(), v.null()),
  publishedAt: v.number(),
  votingEndsAt: v.number(),
  /** Legacy: voting was extended a week for the jury (before weekly batches). */
  votingExtended: v.boolean(),
  awardedAt: v.union(v.number(), v.null()),
  /** The Tbilisi day it won Site of the Day ("2026-11-12"), or null. */
  sotdDay: v.union(v.string(), v.null()),
  /** Jury votes counted in the score (eligibility needs the configured minimum). */
  juryVotes: v.union(v.number(), v.null()),
  /** Built by the Shemoqmedi team: shown as such, never eligible for awards. */
  byTeam: v.boolean(),
  /** A redesign of this earlier listing (its slug). */
  redesignOf: v.union(v.string(), v.null()),
  isClaimed: v.boolean(),
  isStartup: v.boolean(),
  isDoFollow: v.boolean(), // false: outbound links get rel="nofollow"
  featuredRank: v.union(v.number(), v.null()), // home header position (1 = first); null: not featured
  coverUrl: v.union(v.string(), v.null()),
  galleryUrls: v.array(v.string()),
  videoUrl: v.union(v.string(), v.null()),
});

export async function mediaUrls(ctx: QueryCtx, listing: Doc<"listings">) {
  return {
    coverUrl: await mediaUrl(ctx, listing.coverId),
    galleryUrls: (await Promise.all((listing.galleryIds ?? []).map((id) => mediaUrl(ctx, id)))).filter(
      (url): url is string => url !== null,
    ),
    videoUrl: listing.videoId ? await mediaUrl(ctx, listing.videoId) : null,
  };
}

/** The public shape: no owner ids, emails or review metadata. */
export async function toPublic(ctx: QueryCtx, listing: Doc<"listings">) {
  if (listing.status !== "in_voting" && listing.status !== "awarded" && listing.status !== "archived") {
    return null;
  }
  const creator = listing.creatorId ? await ctx.db.get(listing.creatorId) : null;
  const count = listing.communityVotesCount;
  const t = readPillars(listing.communityTotals);
  const publishedAt = listing.publishedAt ?? listing.createdAt;
  const sotd = listing.awards.includes("SOTD")
    ? (
        await ctx.db
          .query("awards")
          .withIndex("by_listing", (q) => q.eq("listingId", listing._id))
          .collect()
      ).find((a) => a.tier === "SOTD" && a.status === "active")
    : undefined;
  const previous = listing.redesignOf ? await ctx.db.get(listing.redesignOf) : null;
  // While judging is open every score and count below is a live tally: hide them.
  const revealed = judgingClosed(listing);
  return {
    slug: listing.slug,
    title: listing.title,
    tagline: listing.tagline,
    juryNote: listing.juryNote ?? null,
    writeup: listing.writeup ?? null,
    url: listing.url,
    category: listing.category,
    categories: listingCategories(listing),
    technologies: listing.technologies,
    region: listing.region,
    creatorTier: listing.creatorTier,
    creditName: listing.creditName,
    creditUrl: listing.creditUrl ?? null,
    creator: creator ? { slug: creator.slug, name: creator.name } : null,
    status: listing.status,
    awards: listing.awards,
    editorialScores: revealed && listing.editorialScores ? readPillars(listing.editorialScores) : null,
    communityScores:
      revealed && count > 0
        ? {
            design: round2(t.design / count),
            usability: round2(t.usability / count),
            creativity: round2(t.creativity / count),
            content: round2(t.content / count),
          }
        : null,
    scoresRevealed: revealed,
    communityVotesCount: revealed ? count : null,
    editorialAverage: revealed ? (listing.editorialAverage ?? null) : null,
    communityAverage: revealed ? (listing.communityAverage ?? null) : null,
    finalScore: revealed ? (listing.finalScore ?? null) : null,
    publishedAt,
    votingEndsAt: listing.votingEndsAt ?? publishedAt,
    votingExtended: listing.votingExtendedAt !== undefined,
    awardedAt: listing.awardedAt ?? null,
    sotdDay: sotd?.period ?? null,
    juryVotes: revealed ? (listing.juryVotes ?? 0) : null,
    byTeam: listing.byTeam ?? false,
    redesignOf: previous && isPublicStatus(previous.status) ? previous.slug : null,
    isClaimed: listing.isClaimed,
    isStartup: listing.isStartup ?? false,
    isDoFollow: isDoFollow(listing),
    featuredRank: listing.featuredRank ?? null,
    ...(await mediaUrls(ctx, listing)),
  };
}

export function categoryName(slug: string) {
  return CATEGORIES.find((c) => c.slug === slug)?.name ?? slug;
}

/** Whether a listing's outbound links are followed: explicit flag, else once claimed. */
export function isDoFollow(listing: Pick<Doc<"listings">, "isDoFollow" | "isClaimed">) {
  return listing.isDoFollow ?? listing.isClaimed;
}

/**
 * The fields that hand a listing to its owner: claimed, followed links, and
 * any legacy plaintext claim token cleared (hashed links are burned in the
 * claimLinks table by the caller).
 */
export function claimedListingPatch(listing: Doc<"listings">, ownerId: Id<"users">, now: number) {
  return {
    ownerId,
    isClaimed: true,
    // Back to automatic (followed while claimed): un-claiming later returns
    // the links to nofollow, and no stale admin override survives the claim.
    isDoFollow: undefined,
    claimToken: undefined,
    updatedAt: now,
  };
}

/**
 * An admin gave a listing to `userId`: its creator profile (the "Made by"
 * credit, /creators/<slug>) goes to them too, so the profile shows their name,
 * photo and "Edit" instead of "Claim this profile". A profile another account
 * already holds is left alone; one the listing's previous owner held moves
 * with the listing. Returns whether the profile is now the owner's.
 */
export async function giveCreatorProfile(
  ctx: MutationCtx,
  listing: Pick<Doc<"listings">, "creatorId">,
  userId: Id<"users">,
  previousOwner: Id<"users"> | undefined,
  now: number,
) {
  const creator = listing.creatorId ? await ctx.db.get(listing.creatorId) : null;
  if (!creator) return false;
  if (creator.claimedBy === userId) {
    if (!creator.isClaimed) await ctx.db.patch(creator._id, { isClaimed: true, updatedAt: now });
    return true;
  }
  if (creator.claimedBy && creator.claimedBy !== previousOwner) return false;
  await ctx.db.patch(creator._id, { claimedBy: userId, isClaimed: true, updatedAt: now });
  return true;
}

/**
 * An admin took a listing from `previousOwner`: their creator profile is
 * released too, unless they still own another site credited to it.
 */
export async function releaseCreatorProfile(
  ctx: MutationCtx,
  listing: Pick<Doc<"listings">, "_id" | "creatorId">,
  previousOwner: Id<"users"> | undefined,
  now: number,
) {
  const creator = listing.creatorId ? await ctx.db.get(listing.creatorId) : null;
  if (!creator || !previousOwner || creator.claimedBy !== previousOwner) return;
  const credited = await ctx.db
    .query("listings")
    .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
    .take(200);
  if (credited.some((l) => l._id !== listing._id && l.ownerId === previousOwner)) return;
  await ctx.db.patch(creator._id, { claimedBy: undefined, isClaimed: false, updatedAt: now });
}

/**
 * Removal requests used to be ordinary claims whose message started with
 * this. Those rows have no `intent`, so the prefix is how we still tell them
 * apart: approving one must never hand over ownership.
 */
export const LEGACY_REMOVAL_PREFIX = "Removal request: ";

export type ClaimIntent = "claim" | "remove";

/** What a claim row asks for. Rows from before `intent` existed default to "claim". */
export function claimIntent(claim: Pick<Doc<"claims">, "intent" | "message">): ClaimIntent {
  if (claim.intent) return claim.intent;
  return claim.message.startsWith(LEGACY_REMOVAL_PREFIX) ? "remove" : "claim";
}

/** A listing's categories, primary first (older rows only have `category`). */
export function listingCategories(listing: Pick<Doc<"listings">, "category" | "categories">) {
  return listing.categories?.length ? listing.categories : [listing.category];
}

/** Validate a category pick: 1 to LIMITS.categories known slugs, deduped, order kept. */
export function checkCategories(values: string[]): CategorySlug[] {
  const categories = [...new Set(values)];
  if (categories.length === 0) fail("Choose a category.");
  if (categories.length > LIMITS.categories) fail(`Choose up to ${LIMITS.categories} categories.`);
  if (!categories.every(isCategory)) fail("Unknown category selected.");
  return categories as CategorySlug[];
}

export { listingStatus };
