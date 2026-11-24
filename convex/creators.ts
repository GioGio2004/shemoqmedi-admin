// Creator profiles (/creators and /creators/<slug> on the site): the person or
// studio behind listings, their awards with badges, and how to get in touch.
// The owner (the account that claimed the profile, creators.claimedBy) fills
// in their own bio, location, website, links and public email from their
// account (mine / updateMine); admins can edit everything (admin.updateCreator).
// The photo is the owner's sign-in photo, like jurors': no upload to moderate.

import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { creatorTier, region } from "./schema";
import { cleanParagraphs, cleanText, fail, isPublicStatus, normalizeUrl, publicListing, toPublic } from "./lib/listingHelpers";
import { LIMITS } from "./lib/taxonomy";
import { isEmail, normalizeEmail } from "./lib/contacts";
import { requireUser } from "./authHelpers";
import { publicAward, toPublicAward } from "./awards";
import { creatorPath, scheduleIndexNow } from "./seo";

/** Most a bio may hold; paragraphs are kept. */
export const CREATOR_BIO_MAX = 800;

const publicCreator = v.object({
  slug: v.string(),
  name: v.string(),
  tier: creatorTier,
  region,
  location: v.union(v.string(), v.null()),
  website: v.union(v.string(), v.null()),
  links: v.array(v.string()), // profile links (Dribbble, LinkedIn, ...)
  bio: v.union(v.string(), v.null()),
  /** Shown only when set: the address visitors may write to. */
  email: v.union(v.string(), v.null()),
  /** The owner's sign-in photo; null shows initials. */
  photoUrl: v.union(v.string(), v.null()),
  isClaimed: v.boolean(),
  awards: v.object({ SOTY: v.number(), SOTM: v.number(), SOTD: v.number(), BSC: v.number(), HM: v.number(), F100: v.number() }),
  nominations: v.number(),
});

/** The claiming owner's sign-in photo, if it's a real one (not Clerk's generated default). */
async function photoOf(ctx: QueryCtx, creator: Doc<"creators">) {
  if (!creator.claimedBy) return null;
  const user = await ctx.db.get(creator.claimedBy);
  return user?.profilePicture && user.hasImage !== false ? user.profilePicture : null;
}

/** A creator profile with their public listings and every active award, newest first. */
export const getBySlug = query({
  args: { slug: v.string() },
  returns: v.union(
    v.object({ creator: publicCreator, listings: v.array(publicListing), awards: v.array(publicAward) }),
    v.null(),
  ),
  handler: async (ctx, { slug }) => {
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!creator) return null;
    const rows = await ctx.db
      .query("listings")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .take(200);
    const listings = (await Promise.all(rows.map((row) => toPublic(ctx, row)))).filter(
      (row) => row !== null,
    );
    listings.sort((a, b) => b.publishedAt - a.publishedAt);
    // A creator page is only public once they have something public.
    if (listings.length === 0) return null;
    const counts = { SOTY: 0, SOTM: 0, SOTD: 0, BSC: 0, HM: 0, F100: 0 };
    for (const l of listings) for (const a of l.awards) counts[a] += 1;

    const awardRows = [];
    for (const row of rows) {
      if (!isPublicStatus(row.status)) continue;
      const list = await ctx.db
        .query("awards")
        .withIndex("by_listing", (q) => q.eq("listingId", row._id))
        .collect();
      awardRows.push(...list);
    }
    const awards = (await Promise.all(awardRows.map((a) => toPublicAward(ctx, a))))
      .filter((a) => a !== null)
      .sort((a, b) => b.date.localeCompare(a.date));

    return {
      creator: {
        slug: creator.slug,
        name: creator.name,
        tier: creator.tier,
        region: creator.region,
        location: creator.location ?? null,
        website: creator.website ?? null,
        links: creator.links ?? [],
        bio: creator.bio ?? null,
        email: creator.publicEmail ?? null,
        photoUrl: await photoOf(ctx, creator),
        isClaimed: creator.isClaimed,
        awards: counts,
        nominations: listings.length,
      },
      listings,
      awards,
    };
  },
});

/** Creators with at least one public listing (index page, home strip, sitemap). */
export const listPublic = query({
  args: {},
  returns: v.array(
    v.object({
      slug: v.string(),
      name: v.string(),
      tier: creatorTier,
      region,
      location: v.union(v.string(), v.null()),
      photoUrl: v.union(v.string(), v.null()),
      isClaimed: v.boolean(),
      nominations: v.number(),
      awards: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const creators = await ctx.db.query("creators").take(1000);
    const out = [];
    for (const creator of creators) {
      const rows = await ctx.db
        .query("listings")
        .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
        .take(200);
      const live = rows.filter((r) => isPublicStatus(r.status));
      if (live.length === 0) continue;
      out.push({
        slug: creator.slug,
        name: creator.name,
        tier: creator.tier,
        region: creator.region,
        location: creator.location ?? null,
        photoUrl: await photoOf(ctx, creator),
        isClaimed: creator.isClaimed,
        nominations: live.length,
        awards: live.reduce((n, r) => n + r.awards.length, 0),
        updatedAt: Math.max(creator.updatedAt, ...live.map((r) => r.updatedAt)),
      });
    }
    out.sort((a, b) => b.awards - a.awards || b.nominations - a.nominations);
    return out;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// The owner's side: their own profiles, from their account
// ─────────────────────────────────────────────────────────────────────────────

const ownProfile = v.object({
  id: v.id("creators"),
  slug: v.string(),
  name: v.string(),
  location: v.string(),
  website: v.string(),
  links: v.array(v.string()),
  bio: v.string(),
  email: v.string(),
  photoUrl: v.union(v.string(), v.null()),
  /** false until one of its sites is public: the profile page shows nothing before. */
  isPublic: v.boolean(),
});

/** The creator profiles the signed-in user claimed, with their editable fields. */
export const mine = query({
  args: {},
  returns: v.array(ownProfile),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", identity.subject))
      .unique();
    if (!user) return [];
    const creators = await ctx.db
      .query("creators")
      .withIndex("by_claimedBy", (q) => q.eq("claimedBy", user._id))
      .take(20);
    const out = [];
    for (const c of creators) {
      const rows = await ctx.db
        .query("listings")
        .withIndex("by_creator", (q) => q.eq("creatorId", c._id))
        .take(200);
      out.push({
        id: c._id,
        slug: c.slug,
        name: c.name,
        location: c.location ?? "",
        website: c.website ?? "",
        links: c.links ?? [],
        bio: c.bio ?? "",
        email: c.publicEmail ?? "",
        photoUrl: await photoOf(ctx, c),
        isPublic: rows.some((r) => isPublicStatus(r.status)),
      });
    }
    return out;
  },
});

/**
 * The owner edits their own profile. Name, address and type stay with the
 * admins (they change every listing's credit). Empty strings clear a field.
 */
export const updateMine = mutation({
  args: {
    id: v.id("creators"),
    location: v.string(),
    website: v.string(),
    links: v.array(v.string()),
    bio: v.string(),
    email: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const creator = await ctx.db.get(args.id);
    if (!creator || creator.claimedBy !== user._id) fail("You can only edit your own profile.");

    const links = [
      ...new Set(args.links.map((l) => l.trim()).filter(Boolean).map((l) => normalizeUrl(l, "Profile link"))),
    ];
    if (links.length > LIMITS.creatorLinks) fail(`Add up to ${LIMITS.creatorLinks} profile links.`);
    const email = args.email.trim();
    if (email && !isEmail(email)) fail("That email address doesn't look right.");

    await ctx.db.patch(creator._id, {
      location: cleanText(args.location, "Location", 80, false) || undefined,
      website: args.website.trim() ? normalizeUrl(args.website, "Website") : undefined,
      links: links.length ? links : undefined,
      bio: cleanParagraphs(args.bio, "Bio", CREATOR_BIO_MAX, false) || undefined,
      publicEmail: email ? normalizeEmail(email) : undefined,
      updatedAt: Date.now(),
    });

    const rows = await ctx.db
      .query("listings")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .take(200);
    if (rows.some((r) => isPublicStatus(r.status))) await scheduleIndexNow(ctx, [creatorPath(creator.slug)]);
    return null;
  },
});
