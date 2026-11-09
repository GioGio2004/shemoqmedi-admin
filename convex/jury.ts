// The jury. An admin pre-creates each juror's profile (unclaimed, private) and
// shares its claim link (claimLinks.ts); claiming binds the profile to the
// person's account and makes it public. Jurors evaluate listings during their
// voting window. A listing's jury score (editorialScores) is the per-pillar
// average of its jurors' evaluations; each evaluation's comment is shown on
// the listing page.
//
//   admin  → createJuror (+ listings with jurorId for a bundle) → claim link
//   person → /claim/<token> on the site → claimLinks.claim
//   juror  → Evaluate button on /sites/<slug> → evaluate

import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin, requireUser } from "./authHelpers";
import { getUserByExternalId } from "./users";
import { juryCategory, juryExperience, juryWork, pillars } from "./schema";
import { LIMITS, isCategory } from "./lib/taxonomy";
import { averagePillars, finalScore, normalizePillars, readPillars, round2, weighted, type Pillars } from "./lib/scoring";
import { conflictReason } from "./lib/conflicts";
import { getConfig } from "./lib/config";
import { deleteMedia, mediaUrl, vMediaId } from "./lib/media";
import {
  assertMedia,
  cleanText,
  fail,
  isPublicStatus,
  normalizeUrl,
  scoreFields,
  slugify,
} from "./lib/listingHelpers";
import { listingPaths, scheduleIndexNow } from "./seo";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Claimed = bound to an account. Rows without a status predate pre-creation and are claimed. */
export function isClaimedJuror(juror: Pick<Doc<"jurors">, "status" | "userId">) {
  return juror.status !== "unclaimed" && juror.userId !== undefined;
}

/** Public = claimed and on the jury. Unclaimed profiles are only reachable through their claim link. */
export function isPublicJuror(juror: Doc<"jurors">) {
  return juror.active && isClaimedJuror(juror);
}

/** Optional comment: keeps line breaks (up to one blank line) but tidies spaces. "" when left empty. */
function cleanComment(raw: string) {
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length > LIMITS.juryComment) fail(`Keep the comment to ${LIMITS.juryComment} characters.`);
  return text;
}

/**
 * The juror's photo: the avatar prepared with the invitation while they keep
 * it, else their account (Clerk) photo, else null (grey placeholder). The
 * preset wins over the account photo on purpose: signing in with Google gives
 * every account a photo (often just a letter), which must not replace the
 * photo picked for the jury. Changing or removing the photo on /jury/profile
 * drops the preset (dropPresetPhoto).
 */
export async function jurorPhoto(ctx: QueryCtx, juror: Doc<"jurors">) {
  if (juror.avatarId) {
    const preset = await mediaUrl(ctx, juror.avatarId);
    if (preset) return preset;
  }
  const user = juror.userId ? await ctx.db.get(juror.userId) : null;
  return user?.hasImage && user.profilePicture ? user.profilePicture : null;
}

export async function jurorOf(ctx: QueryCtx, userId: Id<"users">) {
  return await ctx.db
    .query("jurors")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
}

/** The signed-in user and their active, claimed juror row, or null (no throw). */
export async function currentJuror(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const user = await getUserByExternalId(ctx, identity.subject);
  if (!user) return null;
  const juror = await jurorOf(ctx, user._id);
  return juror && isPublicJuror(juror) ? { user, juror } : null;
}

export async function requireJuror(ctx: QueryCtx) {
  const user = await requireUser(ctx);
  const juror = await jurorOf(ctx, user._id);
  if (!juror || !isPublicJuror(juror)) fail("Only jury members can do this.");
  return { user, juror };
}

async function uniqueJurorSlug(ctx: QueryCtx, name: string, except?: Id<"jurors">) {
  const base = slugify(name, "juror");
  for (let i = 1; ; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    const taken = await ctx.db
      .query("jurors")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!taken || taken._id === except) return slug;
  }
}

const optionalUrl = (raw: string | undefined, field: string) =>
  raw?.trim() ? normalizeUrl(raw, field) : undefined;

function cleanLinkedin(raw: string | undefined) {
  const url = optionalUrl(raw, "LinkedIn URL");
  if (url && !/^https?:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\//i.test(url)) {
    fail("The LinkedIn URL must be a linkedin.com address.");
  }
  return url;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function cleanEmail(raw: string | undefined) {
  const email = raw?.trim().toLowerCase();
  if (!email) return undefined;
  if (!EMAIL.test(email) || email.length > 254) fail("Enter a valid email address.");
  return email;
}

type ExperienceRows = NonNullable<Doc<"jurors">["experience"]>;
type WorkRows = NonNullable<Doc<"jurors">["work"]>;

/** Tidies the Experience list: trims, drops empty rows, caps the count. [] clears it. */
function cleanExperience(rows: ExperienceRows): ExperienceRows | undefined {
  const out = rows
    .map((r) => ({
      title: cleanText(r.title, "Experience role", 80, false),
      organization: cleanText(r.organization, "Experience organisation", 80, false),
      period: cleanText(r.period ?? "", "Experience period", 40, false) || undefined,
    }))
    .filter((r) => r.title || r.organization);
  if (out.some((r) => !r.title || !r.organization)) fail("Each experience entry needs a role and an organisation.");
  if (out.length > LIMITS.juryExperience) fail(`Add up to ${LIMITS.juryExperience} experience entries.`);
  return out.length ? out : undefined;
}

/** Tidies the Work list: trims, normalises links, drops empty rows, caps the count. [] clears it. */
function cleanWork(rows: WorkRows): WorkRows | undefined {
  const out = rows
    .map((r) => ({
      title: cleanText(r.title, "Work title", 80, false),
      url: optionalUrl(r.url, "Work link"),
      year: cleanText(r.year ?? "", "Work year", 20, false) || undefined,
      description: cleanText(r.description ?? "", "Work description", 200, false) || undefined,
    }))
    .filter((r) => r.title || r.url);
  if (out.some((r) => !r.title)) fail("Each work entry needs a title.");
  if (out.length > LIMITS.juryWork) fail(`Add up to ${LIMITS.juryWork} work entries.`);
  return out.length ? out : undefined;
}

/** Fields a juror may edit on their own profile. */
const selfProfileArgs = {
  name: v.string(),
  title: v.string(),
  location: v.optional(v.string()),
  website: v.optional(v.string()), // "" clears
  linkedinUrl: v.optional(v.string()), // "" clears
  bio: v.optional(v.string()),
  experience: v.optional(v.array(juryExperience)), // [] clears; absent keeps
  work: v.optional(v.array(juryWork)), // [] clears; absent keeps
  interests: v.optional(v.array(v.string())), // CATEGORIES slugs for the digest; [] clears; absent keeps
};

function cleanSelfProfile(args: {
  name: string;
  title: string;
  location?: string;
  website?: string;
  linkedinUrl?: string;
  bio?: string;
  experience?: ExperienceRows;
  work?: WorkRows;
  interests?: string[];
}) {
  if (args.interests && !args.interests.every(isCategory)) fail("Unknown category.");
  return {
    ...(args.interests !== undefined ? { interests: [...new Set(args.interests)].slice(0, 40) } : {}),
    ...(args.experience !== undefined ? { experience: cleanExperience(args.experience) } : {}),
    ...(args.work !== undefined ? { work: cleanWork(args.work) } : {}),
    name: cleanText(args.name, "Name", LIMITS.creditName),
    title: cleanText(args.title, "Role", LIMITS.juryTitle),
    location: cleanText(args.location ?? "", "Location", 80, false) || undefined,
    website: optionalUrl(args.website, "Website"),
    linkedinUrl: cleanLinkedin(args.linkedinUrl),
    bio: cleanText(args.bio ?? "", "Bio", LIMITS.juryBio, false) || undefined,
  };
}

/**
 * Set a listing's jury score from its evaluations: per-pillar averages, and a
 * final score that is every juror's weighted score averaged (rounded to 2
 * decimals). Cleared when none are left.
 */
export async function recomputeJuryScore(ctx: MutationCtx, listingId: Id<"listings">) {
  const listing = await ctx.db.get(listingId);
  if (!listing) return;
  const votes = (
    await ctx.db
      .query("juryEvaluations")
      .withIndex("by_listing", (q) => q.eq("listingId", listingId))
      .collect()
  ).map((e) => readPillars(e.scores));
  const editorial = averagePillars(votes) ?? undefined;
  const final = finalScore(votes) ?? undefined;
  await ctx.db.patch(listingId, {
    editorialScores: editorial,
    ...scoreFields(editorial, listing.communityTotals, listing.communityVotesCount),
    editorialAverage: final,
    finalScore: final,
    juryVotes: votes.length,
    updatedAt: Date.now(),
  });
}

/**
 * Why this juror can't evaluate this listing right now, or null if they can.
 * Jurors never score their own work: a listing they own, one whose creator
 * profile they claimed, or one pre-created for them (jurorId).
 */
async function blockReason(ctx: QueryCtx, listing: Doc<"listings">, juror: Doc<"jurors">) {
  if (listing.status !== "in_voting" || !listing.votingEndsAt || Date.now() >= listing.votingEndsAt) {
    return "Voting is closed for this site.";
  }
  if (listing.byTeam) return "Sites by the Shemoqmedi team are not judged.";
  return await conflictReason(ctx, listing, juror);
}

async function listingBySlug(ctx: QueryCtx, slug: string) {
  return await ctx.db
    .query("listings")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .first();
}

export const jurorPublic = v.object({
  slug: v.string(),
  name: v.string(),
  title: v.string(),
  category: v.union(juryCategory, v.null()),
  location: v.union(v.string(), v.null()),
  website: v.union(v.string(), v.null()),
  linkedinUrl: v.union(v.string(), v.null()),
  bio: v.union(v.string(), v.null()),
  experience: v.array(juryExperience),
  work: v.array(juryWork),
  isFounding: v.boolean(),
  imageUrl: v.union(v.string(), v.null()), // null: show the grey placeholder
});

export async function toJurorPublic(ctx: QueryCtx, juror: Doc<"jurors">) {
  return {
    slug: juror.slug,
    name: juror.name,
    title: juror.title,
    category: juror.category ?? null,
    location: juror.location ?? null,
    website: juror.website ?? null,
    linkedinUrl: juror.linkedinUrl ?? null,
    bio: juror.bio ?? null,
    experience: juror.experience ?? [],
    work: juror.work ?? [],
    isFounding: juror.isFounding ?? false,
    imageUrl: await jurorPhoto(ctx, juror),
  };
}

async function evaluationCount(ctx: QueryCtx, jurorId: Id<"jurors">) {
  return (
    await ctx.db
      .query("juryEvaluations")
      .withIndex("by_juror", (q) => q.eq("jurorId", jurorId))
      .take(1000)
  ).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public (site)
// ─────────────────────────────────────────────────────────────────────────────

/** Claimed, active jurors for /jury, longest-serving first, with their evaluation counts. */
export const listPublic = query({
  args: {},
  returns: v.array(v.object({ ...jurorPublic.fields, evaluations: v.number() })),
  handler: async (ctx) => {
    const jurors = (
      await ctx.db
        .query("jurors")
        .withIndex("by_active", (q) => q.eq("active", true))
        .take(300)
    ).filter(isPublicJuror);
    return await Promise.all(
      jurors.map(async (j) => ({ ...(await toJurorPublic(ctx, j)), evaluations: await evaluationCount(ctx, j._id) })),
    );
  },
});

/** Slugs of public jurors (sitemap, static params). */
export const publicSlugs = query({
  args: {},
  returns: v.array(v.object({ slug: v.string(), updatedAt: v.number() })),
  handler: async (ctx) => {
    const jurors = await ctx.db
      .query("jurors")
      .withIndex("by_active", (q) => q.eq("active", true))
      .take(300);
    return jurors.filter(isPublicJuror).map((j) => ({ slug: j.slug, updatedAt: j.updatedAt }));
  },
});

/** A juror's public page (/jury/<slug>) with their evaluations. Null if unclaimed or off the jury. */
export const getBySlug = query({
  args: { slug: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      juror: v.object({ ...jurorPublic.fields, joinedAt: v.number() }),
      reviews: v.array(
        v.object({
          listing: v.object({ slug: v.string(), title: v.string(), coverUrl: v.union(v.string(), v.null()) }),
          average: v.number(),
          comment: v.string(),
          updatedAt: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, { slug }) => {
    const juror = await ctx.db
      .query("jurors")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!juror || !isPublicJuror(juror)) return null;
    const evaluations = await ctx.db
      .query("juryEvaluations")
      .withIndex("by_juror", (q) => q.eq("jurorId", juror._id))
      .take(200);
    evaluations.sort((a, b) => b.updatedAt - a.updatedAt);
    const reviews = [];
    for (const e of evaluations) {
      const listing = await ctx.db.get(e.listingId);
      if (!listing || !isPublicStatus(listing.status)) continue;
      const s = readPillars(e.scores);
      reviews.push({
        listing: { slug: listing.slug, title: listing.title, coverUrl: await mediaUrl(ctx, listing.coverId) },
        average: round2(weighted(s)),
        comment: e.comment,
        updatedAt: e.updatedAt,
      });
    }
    return {
      juror: { ...(await toJurorPublic(ctx, juror)), joinedAt: juror.claimedAt ?? juror.joinedAt },
      reviews,
    };
  },
});

/** Jury evaluations of a public listing, oldest first, for its page. */
export const reviewsForListing = query({
  args: { slug: v.string() },
  returns: v.array(
    v.object({
      juror: jurorPublic,
      scores: pillars,
      average: v.number(),
      comment: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, { slug }) => {
    const listing = await listingBySlug(ctx, slug);
    if (!listing || !isPublicStatus(listing.status)) return [];
    const evaluations = await ctx.db
      .query("juryEvaluations")
      .withIndex("by_listing", (q) => q.eq("listingId", listing._id))
      .collect();
    evaluations.sort((a, b) => a.createdAt - b.createdAt);
    const out = [];
    for (const e of evaluations) {
      const juror = await ctx.db.get(e.jurorId);
      if (!juror || !isClaimedJuror(juror)) continue;
      const s = readPillars(e.scores);
      out.push({
        juror: await toJurorPublic(ctx, juror),
        scores: s,
        average: round2(weighted(s)),
        comment: e.comment,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      });
    }
    return out;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Jurors
// ─────────────────────────────────────────────────────────────────────────────

/** The signed-in user's jury profile, or null if they are not on the jury. */
export const me = query({
  args: {},
  returns: v.union(
    v.object({ ...jurorPublic.fields, hasPresetPhoto: v.boolean(), interests: v.array(v.string()) }),
    v.null(),
  ),
  handler: async (ctx) => {
    const current = await currentJuror(ctx);
    if (!current) return null;
    return {
      ...(await toJurorPublic(ctx, current.juror)),
      hasPresetPhoto: !!current.juror.avatarId,
      interests: current.juror.interests ?? [],
    };
  },
});

/**
 * The juror replaces or removes their photo on /jury/profile: the photo
 * prepared with the invitation is dropped, so their account photo (or the grey
 * placeholder) shows from now on.
 */
export const dropPresetPhoto = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const { juror } = await requireJuror(ctx);
    if (!juror.avatarId) return null;
    await deleteMedia(ctx, juror.avatarId);
    await ctx.db.patch(juror._id, { avatarId: undefined, updatedAt: Date.now() });
    await scheduleIndexNow(ctx, ["/jury", `/jury/${juror.slug}`]);
    return null;
  },
});

/** For the Evaluate panel: whether the juror can evaluate, and their saved evaluation. */
export const myEvaluation = query({
  args: { slug: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      blocked: v.union(v.string(), v.null()),
      evaluation: v.union(
        v.object({ scores: pillars, comment: v.string(), updatedAt: v.number() }),
        v.null(),
      ),
      votingEndsAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, { slug }) => {
    const current = await currentJuror(ctx);
    if (!current) return null;
    const listing = await listingBySlug(ctx, slug);
    if (!listing || !isPublicStatus(listing.status)) return null;
    const saved = await ctx.db
      .query("juryEvaluations")
      .withIndex("by_listing_juror", (q) => q.eq("listingId", listing._id).eq("jurorId", current.juror._id))
      .unique();
    return {
      blocked: await blockReason(ctx, listing, current.juror),
      evaluation: saved ? { scores: readPillars(saved.scores), comment: saved.comment, updatedAt: saved.updatedAt } : null,
      votingEndsAt: listing.votingEndsAt ?? null,
    };
  },
});

/** Save (or update) the juror's evaluation of a listing in its voting window. */
export const evaluate = mutation({
  args: { slug: v.string(), scores: pillars, comment: v.string() },
  returns: v.null(),
  handler: async (ctx, { slug, scores, comment }) => {
    const { juror } = await requireJuror(ctx);
    const listing = await listingBySlug(ctx, slug);
    if (!listing) fail("Site not found.");
    const blocked = await blockReason(ctx, listing, juror);
    if (blocked) fail(blocked);
    let clean: Pillars;
    try {
      clean = normalizePillars(scores);
    } catch (err) {
      fail((err as Error).message);
    }
    const text = cleanComment(comment);
    const now = Date.now();
    const saved = await ctx.db
      .query("juryEvaluations")
      .withIndex("by_listing_juror", (q) => q.eq("listingId", listing._id).eq("jurorId", juror._id))
      .unique();
    if (saved) {
      await ctx.db.patch(saved._id, { scores: clean, comment: text, updatedAt: now });
    } else {
      await ctx.db.insert("juryEvaluations", {
        listingId: listing._id,
        jurorId: juror._id,
        scores: clean,
        comment: text,
        createdAt: now,
        updatedAt: now,
      });
    }
    await recomputeJuryScore(ctx, listing._id);
    if (!saved) await scheduleIndexNow(ctx, [...(await listingPaths(ctx, listing)), `/jury/${juror.slug}`]);
    return null;
  },
});

/** A juror edits their own public profile (the admin sets the panel and avatar). */
export const updateProfile = mutation({
  args: selfProfileArgs,
  returns: v.object({ slug: v.string() }),
  handler: async (ctx, args) => {
    const { juror } = await requireJuror(ctx);
    const profile = cleanSelfProfile(args);
    // The slug is a shared permalink (/jury/<slug>), so a name change keeps it.
    await ctx.db.patch(juror._id, { ...profile, updatedAt: Date.now() });
    await scheduleIndexNow(ctx, ["/jury", `/jury/${juror.slug}`]);
    return { slug: juror.slug };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────────────────────────────────────

const adminProfileArgs = {
  name: v.string(),
  title: v.string(),
  category: juryCategory,
  location: v.optional(v.string()),
  website: v.optional(v.string()), // "" or absent: none
  linkedinUrl: v.optional(v.string()),
  bio: v.optional(v.string()),
  email: v.optional(v.string()), // private; for emailing the claim link
  avatarId: v.optional(vMediaId),
  isFounding: v.optional(v.boolean()),
  experience: v.optional(v.array(juryExperience)),
  work: v.optional(v.array(juryWork)),
};

/** Admin: pre-create an unclaimed jury profile. Share its claim link next (claimLinks.link). */
export const createJuror = mutation({
  args: adminProfileArgs,
  returns: v.object({ id: v.id("jurors"), slug: v.string() }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const name = cleanText(args.name, "Name", LIMITS.creditName);
    if (args.avatarId) await assertMedia(ctx, args.avatarId, "Photo", "image");
    const now = Date.now();
    const slug = await uniqueJurorSlug(ctx, name);
    const id = await ctx.db.insert("jurors", {
      status: "unclaimed",
      slug,
      name,
      title: cleanText(args.title, "Role", LIMITS.juryTitle),
      category: args.category,
      location: cleanText(args.location ?? "", "Location", 80, false) || undefined,
      website: optionalUrl(args.website, "Website"),
      linkedinUrl: cleanLinkedin(args.linkedinUrl),
      bio: cleanText(args.bio ?? "", "Bio", LIMITS.juryBio, false) || undefined,
      email: cleanEmail(args.email),
      avatarId: args.avatarId,
      isFounding: args.isFounding ?? true,
      experience: args.experience ? cleanExperience(args.experience) : undefined,
      work: args.work ? cleanWork(args.work) : undefined,
      active: true,
      joinedAt: now,
      updatedAt: now,
    });
    return { id, slug };
  },
});

/** Admin: edit any juror's profile. "" clears an optional text field; avatarId null removes the photo. */
export const updateJuror = mutation({
  args: {
    jurorId: v.id("jurors"),
    name: v.optional(v.string()),
    title: v.optional(v.string()),
    category: v.optional(juryCategory),
    location: v.optional(v.string()),
    website: v.optional(v.string()),
    linkedinUrl: v.optional(v.string()),
    bio: v.optional(v.string()),
    email: v.optional(v.string()),
    avatarId: v.optional(v.union(vMediaId, v.null())),
    isFounding: v.optional(v.boolean()),
    experience: v.optional(v.array(juryExperience)), // [] clears
    work: v.optional(v.array(juryWork)), // [] clears
  },
  returns: v.object({ slug: v.string() }),
  handler: async (ctx, { jurorId, ...args }) => {
    await requireAdmin(ctx);
    const juror = await ctx.db.get(jurorId);
    if (!juror) fail("Juror not found.");
    const patch: Partial<Doc<"jurors">> = {};
    if (args.name !== undefined) {
      patch.name = cleanText(args.name, "Name", LIMITS.creditName);
      // Only private (unclaimed) profiles get a new slug; a public one is a shared permalink.
      if (patch.name !== juror.name && !isClaimedJuror(juror)) {
        patch.slug = await uniqueJurorSlug(ctx, patch.name, jurorId);
      }
    }
    if (args.title !== undefined) patch.title = cleanText(args.title, "Role", LIMITS.juryTitle);
    if (args.category !== undefined) patch.category = args.category;
    if (args.location !== undefined) patch.location = cleanText(args.location, "Location", 80, false) || undefined;
    if (args.website !== undefined) patch.website = optionalUrl(args.website, "Website");
    if (args.linkedinUrl !== undefined) patch.linkedinUrl = cleanLinkedin(args.linkedinUrl);
    if (args.bio !== undefined) patch.bio = cleanText(args.bio, "Bio", LIMITS.juryBio, false) || undefined;
    if (args.email !== undefined) patch.email = cleanEmail(args.email);
    if (args.isFounding !== undefined) patch.isFounding = args.isFounding;
    if (args.experience !== undefined) patch.experience = cleanExperience(args.experience);
    if (args.work !== undefined) patch.work = cleanWork(args.work);
    if (args.avatarId !== undefined) {
      if (args.avatarId) await assertMedia(ctx, args.avatarId, "Photo", "image");
      if (juror.avatarId && juror.avatarId !== args.avatarId) await deleteMedia(ctx, juror.avatarId);
      patch.avatarId = args.avatarId ?? undefined;
    }
    await ctx.db.patch(jurorId, { ...patch, updatedAt: Date.now() });
    const slug = patch.slug ?? juror.slug;
    if (isPublicJuror(juror)) await scheduleIndexNow(ctx, ["/jury", `/jury/${slug}`]);
    return { slug };
  },
});

/** Admin: delete a juror profile nobody has claimed. Linked listings stay, unlinked. */
export const deleteJuror = mutation({
  args: { jurorId: v.id("jurors") },
  returns: v.null(),
  handler: async (ctx, { jurorId }) => {
    await requireAdmin(ctx);
    const juror = await ctx.db.get(jurorId);
    if (!juror) fail("Juror not found.");
    if (isClaimedJuror(juror)) fail("This profile has been claimed. Remove the juror from the jury instead.");
    const linked = await ctx.db
      .query("listings")
      .withIndex("by_juror", (q) => q.eq("jurorId", jurorId))
      .collect();
    for (const l of linked) await ctx.db.patch(l._id, { jurorId: undefined, updatedAt: Date.now() });
    if (juror.avatarId) await deleteMedia(ctx, juror.avatarId);
    await ctx.db.delete(jurorId);
    return null;
  },
});

/** Admin: every juror, claimed or not, with linked listings and claim tokens. */
export const adminOverview = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("jurors"),
      ...jurorPublic.fields,
      status: v.union(v.literal("unclaimed"), v.literal("claimed")),
      email: v.union(v.string(), v.null()), // contact email, or the account's once claimed
      accountEmail: v.union(v.string(), v.null()),
      avatarId: v.union(vMediaId, v.null()),
      claimToken: v.union(v.string(), v.null()),
      active: v.boolean(),
      joinedAt: v.number(),
      claimedAt: v.union(v.number(), v.null()),
      evaluations: v.number(),
      listings: v.array(
        v.object({ id: v.id("listings"), slug: v.string(), title: v.string(), isClaimed: v.boolean(), status: v.string() }),
      ),
    }),
  ),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const jurors = await ctx.db.query("jurors").take(500);
    jurors.sort(
      (a, b) =>
        Number(isClaimedJuror(a)) - Number(isClaimedJuror(b)) ||
        Number(b.active) - Number(a.active) ||
        b.joinedAt - a.joinedAt,
    );
    return await Promise.all(
      jurors.map(async (j) => {
        const account = j.userId ? await ctx.db.get(j.userId) : null;
        const listings = await ctx.db
          .query("listings")
          .withIndex("by_juror", (q) => q.eq("jurorId", j._id))
          .take(50);
        return {
          id: j._id,
          ...(await toJurorPublic(ctx, j)),
          status: isClaimedJuror(j) ? ("claimed" as const) : ("unclaimed" as const),
          email: j.email ?? account?.email ?? null,
          accountEmail: account?.email ?? null,
          avatarId: j.avatarId ?? null,
          claimToken: isClaimedJuror(j) ? null : (j.claimToken ?? null),
          active: j.active,
          joinedAt: j.joinedAt,
          claimedAt: j.claimedAt ?? null,
          evaluations: await evaluationCount(ctx, j._id),
          listings: listings.map((l) => ({
            id: l._id,
            slug: l.slug,
            title: l.title,
            isClaimed: l.isClaimed,
            status: l.status,
          })),
        };
      }),
    );
  },
});

/** Admin: jurors to pick from when linking a listing (bundle). */
export const options = query({
  args: {},
  returns: v.array(v.object({ id: v.id("jurors"), name: v.string(), claimed: v.boolean() })),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const jurors = await ctx.db.query("jurors").take(500);
    return jurors
      .map((j) => ({ id: j._id, name: j.name, claimed: isClaimedJuror(j) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Admin: take someone off the jury (or bring them back). Evaluations stay. */
export const setJurorActive = mutation({
  args: { jurorId: v.id("jurors"), active: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { jurorId, active }) => {
    await requireAdmin(ctx);
    const juror = await ctx.db.get(jurorId);
    if (!juror) fail("Juror not found.");
    await ctx.db.patch(jurorId, { active, updatedAt: Date.now() });
    if (isClaimedJuror(juror)) await scheduleIndexNow(ctx, ["/jury", `/jury/${juror.slug}`]);
    return null;
  },
});

/**
 * Admin: every site in its voting window, soonest to close first, with each
 * juror's evaluation. `juryTarget` is how many evaluations a site should get
 * before it closes (fewer after 7 days extends voting once by a week).
 */
export const nomineesOverview = query({
  args: {},
  returns: v.object({
    juryTarget: v.number(),
    activeJurors: v.number(),
    nominees: v.array(
      v.object({
        id: v.id("listings"),
        slug: v.string(),
        title: v.string(),
        url: v.string(),
        creditName: v.string(),
        coverUrl: v.union(v.string(), v.null()),
        publishedAt: v.union(v.number(), v.null()),
        votingEndsAt: v.union(v.number(), v.null()),
        votingExtended: v.boolean(),
        isStartup: v.boolean(),
        editorialScores: v.union(pillars, v.null()),
        editorialAverage: v.union(v.number(), v.null()),
        communityAverage: v.union(v.number(), v.null()),
        communityVotesCount: v.number(),
        finalScore: v.union(v.number(), v.null()),
        evaluations: v.array(
          v.object({
            id: v.id("juryEvaluations"),
            juror: v.object({
              name: v.string(),
              slug: v.string(),
              title: v.string(),
              imageUrl: v.union(v.string(), v.null()),
            }),
            scores: pillars,
            average: v.number(),
            comment: v.string(),
            updatedAt: v.number(),
          }),
        ),
      }),
    ),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const listings = await ctx.db
      .query("listings")
      .withIndex("by_status_votingEndsAt", (q) => q.eq("status", "in_voting"))
      .take(200);
    const activeJurors = (
      await ctx.db
        .query("jurors")
        .withIndex("by_active", (q) => q.eq("active", true))
        .take(500)
    ).filter(isPublicJuror).length;
    const nominees = await Promise.all(
      listings.map(async (l) => {
        const rows = await ctx.db
          .query("juryEvaluations")
          .withIndex("by_listing", (q) => q.eq("listingId", l._id))
          .collect();
        rows.sort((a, b) => a.createdAt - b.createdAt);
        const evaluations = [];
        for (const e of rows) {
          const juror = await ctx.db.get(e.jurorId);
          const s = readPillars(e.scores);
          evaluations.push({
            id: e._id,
            juror: {
              name: juror?.name ?? "Former juror",
              slug: juror?.slug ?? "",
              title: juror?.title ?? "",
              imageUrl: juror ? await jurorPhoto(ctx, juror) : null,
            },
            scores: s,
            average: round2(weighted(s)),
            comment: e.comment,
            updatedAt: e.updatedAt,
          });
        }
        return {
          id: l._id,
          slug: l.slug,
          title: l.title,
          url: l.url,
          creditName: l.creditName,
          coverUrl: await mediaUrl(ctx, l.coverId),
          publishedAt: l.publishedAt ?? null,
          votingEndsAt: l.votingEndsAt ?? null,
          votingExtended: l.votingExtendedAt !== undefined,
          isStartup: l.isStartup ?? false,
          editorialScores: l.editorialScores ? readPillars(l.editorialScores) : null,
          editorialAverage: l.editorialAverage ?? null,
          communityAverage: l.communityAverage ?? null,
          communityVotesCount: l.communityVotesCount,
          finalScore: l.finalScore ?? null,
          evaluations,
        };
      }),
    );
    // Jury votes a site needs to be eligible for awards (award settings).
    return { juryTarget: (await getConfig(ctx)).minVotes, activeJurors, nominees };
  },
});

/** Admin: the jury evaluations of one listing (review screen). */
export const evaluationsForListing = query({
  args: { listingId: v.id("listings") },
  returns: v.array(
    v.object({
      id: v.id("juryEvaluations"),
      jurorName: v.string(),
      scores: pillars,
      comment: v.string(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, { listingId }) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("juryEvaluations")
      .withIndex("by_listing", (q) => q.eq("listingId", listingId))
      .collect();
    return await Promise.all(
      rows.map(async (e) => ({
        id: e._id,
        jurorName: (await ctx.db.get(e.jurorId))?.name ?? "Former juror",
        scores: readPillars(e.scores),
        comment: e.comment,
        updatedAt: e.updatedAt,
      })),
    );
  },
});

/** Admin: remove one evaluation (moderation); the jury score is recomputed. */
export const deleteEvaluation = mutation({
  args: { evaluationId: v.id("juryEvaluations") },
  returns: v.null(),
  handler: async (ctx, { evaluationId }) => {
    await requireAdmin(ctx);
    const e = await ctx.db.get(evaluationId);
    if (!e) fail("Evaluation not found.");
    await ctx.db.delete(evaluationId);
    await recomputeJuryScore(ctx, e.listingId);
    return null;
  },
});

/** True when a listing's jury score comes from evaluations (admins can't set it by hand). */
export async function hasJuryEvaluations(ctx: QueryCtx, listingId: Id<"listings">) {
  return (
    (await ctx.db
      .query("juryEvaluations")
      .withIndex("by_listing", (q) => q.eq("listingId", listingId))
      .first()) !== null
  );
}
