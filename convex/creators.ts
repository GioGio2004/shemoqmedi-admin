import { v } from "convex/values";
import { query } from "./_generated/server";
import { creatorTier, region } from "./schema";
import { publicListing, toPublic } from "./lib/listingHelpers";

const publicCreator = v.object({
  slug: v.string(),
  name: v.string(),
  tier: creatorTier,
  region,
  location: v.union(v.string(), v.null()),
  website: v.union(v.string(), v.null()),
  links: v.array(v.string()), // profile links (Dribbble, LinkedIn, ...)
  bio: v.union(v.string(), v.null()),
  isClaimed: v.boolean(),
  awards: v.object({ SOTY: v.number(), SOTM: v.number(), SOTD: v.number(), BSC: v.number(), HM: v.number() }),
  nominations: v.number(),
});

/** A creator profile with their public listings. */
export const getBySlug = query({
  args: { slug: v.string() },
  returns: v.union(
    v.object({ creator: publicCreator, listings: v.array(publicListing) }),
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
    const awards = { SOTY: 0, SOTM: 0, SOTD: 0, BSC: 0, HM: 0 };
    for (const l of listings) for (const a of l.awards) awards[a] += 1;
    // A creator page is only public once they have something public.
    if (listings.length === 0) return null;
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
        isClaimed: creator.isClaimed,
        awards,
        nominations: listings.length,
      },
      listings,
    };
  },
});

/** Creators with at least one public listing (index page + sitemap). */
export const listPublic = query({
  args: {},
  returns: v.array(
    v.object({
      slug: v.string(),
      name: v.string(),
      tier: creatorTier,
      region,
      location: v.union(v.string(), v.null()),
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
      const live = rows.filter((r) =>
        r.status === "in_voting" || r.status === "awarded" || r.status === "archived",
      );
      if (live.length === 0) continue;
      out.push({
        slug: creator.slug,
        name: creator.name,
        tier: creator.tier,
        region: creator.region,
        location: creator.location ?? null,
        nominations: live.length,
        awards: live.reduce((n, r) => n + r.awards.length, 0),
        updatedAt: Math.max(creator.updatedAt, ...live.map((r) => r.updatedAt)),
      });
    }
    out.sort((a, b) => b.awards - a.awards || b.nominations - a.nominations);
    return out;
  },
});
