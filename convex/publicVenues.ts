import { v } from "convex/values";
import { query } from "./_generated/server";

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC VENUES — unauthenticated read-only queries
//
// These endpoints are called by:
//   - /venues directory page (listPublished)
//   - /venues/[slug] discovery page (getBySlug)
//   - app/sitemap.ts (listPublished — publish-gated, no drafts in index)
//
// No auth, no ctx.auth. Strictly public.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * listPublished — returns all venues where isPublished = true.
 *
 * Used by:
 *   - /venues directory grid
 *   - sitemap.ts (Condition 2: only published venues are indexed)
 *
 * Returns a lightweight projection for card display and sitemap generation.
 */
export const listPublished = query({
  args: {},
  handler: async (ctx) => {
    const venues = await ctx.db
      .query("venues")
      .withIndex("by_published", (q) => q.eq("isPublished", true))
      .collect();

    return venues.map((venue) => ({
      _id:               venue._id,
      slug:              venue.slug,
      name:              venue.name,
      category:          venue.category,
      description:       venue.description,
      address:           venue.address,
      coverImage:        venue.coverImage ?? null,
      tags:              venue.tags ?? [],
      googleRating:      venue.googleRating ?? null,
      googleReviewCount: venue.googleReviewCount ?? null,
      updatedAt:         venue.updatedAt,
    }));
  },
});

/**
 * getBySlug — returns a single published venue's full detail record.
 *
 * Used by:
 *   - /venues/[slug] server-rendered discovery page
 *   - generateMetadata for per-venue OG/Twitter cards and JSON-LD
 *
 * Returns null if the venue doesn't exist or isn't published (→ 404).
 */
export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const venue = await ctx.db
      .query("venues")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();

    // Don't expose draft venues to the public
    if (!venue || !venue.isPublished) return null;

    return {
      _id:                     venue._id,
      orgId:                   venue.orgId,
      slug:                    venue.slug,
      name:                    venue.name,
      category:                venue.category,
      description:             venue.description,
      address:                 venue.address,
      lat:                     venue.lat ?? null,
      lng:                     venue.lng ?? null,
      phone:                   venue.phone ?? null,
      hours:                   venue.hours ?? [],
      coverImage:              venue.coverImage ?? null,
      galleryImages:           venue.galleryImages ?? [],
      tags:                    venue.tags ?? [],
      gbpPlaceId:              venue.gbpPlaceId ?? null,
      googleRating:            venue.googleRating ?? null,
      googleReviewCount:       venue.googleReviewCount ?? null,
      googleDataLastFetchedAt: venue.googleDataLastFetchedAt ?? null,
    };
  },
});
