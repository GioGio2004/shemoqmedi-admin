// convex/venueDirectory.ts — the ENLISTING engine (super-admin only).
//
// Seeds the public venue directory with real venues from public data
// (name / address / rating / link), marked claimStatus "unclaimed" so the
// consumer app can show a "claim this venue" CTA. Claiming links the venue
// to a Clerk org and flips it to "claimed". Owners who want out are removed
// same-day via removeVenue (the opt-out promise).

import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireSuperAdmin } from "./authHelpers";

const CATEGORY = v.union(
  v.literal("cafe"),
  v.literal("restaurant"),
  v.literal("bar"),
  v.literal("hotel"),
  v.literal("other"),
);

/**
 * Clean URL slug from a venue name: latin lowercase, non-alphanumerics → "-".
 * Georgian names transliterate poorly automatically — the super-admin form
 * asks for a latin name; this guards the result. NO timestamp suffixes:
 * collisions get "-2", "-3"… (the readable-URL contract).
 */
function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "venue"
  );
}

async function uniqueSlug(ctx: any, base: string, excludeId?: string) {
  let slug = base;
  for (let n = 2; n < 100; n++) {
    const existing = await ctx.db
      .query("venues")
      .withIndex("by_slug", (q: any) => q.eq("slug", slug))
      .unique();
    if (!existing || existing._id === excludeId) return slug;
    slug = `${base}-${n}`;
  }
  throw new ConvexError("Could not find a free slug.");
}

/** Seed one venue into the public directory (unclaimed, published). */
export const seedVenue = mutation({
  args: {
    name: v.string(),
    latinName: v.optional(v.string()), // used for the slug when name is Georgian
    category: CATEGORY,
    description: v.optional(v.string()),
    address: v.string(),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    phone: v.optional(v.string()),
    externalMenuUrl: v.optional(v.string()),
    gbpPlaceId: v.optional(v.string()),
    coverImage: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    publish: v.optional(v.boolean()), // default true — seeding IS publishing
  },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);
    if (!args.name.trim()) throw new ConvexError("Name is required.");
    const slug = await uniqueSlug(ctx, slugify(args.latinName ?? args.name));
    const now = Date.now();
    return await ctx.db.insert("venues", {
      slug,
      name: args.name.trim(),
      category: args.category,
      description: args.description ?? "",
      address: args.address,
      lat: args.lat,
      lng: args.lng,
      phone: args.phone,
      coverImage: args.coverImage,
      tags: args.tags,
      gbpPlaceId: args.gbpPlaceId,
      claimStatus: "unclaimed",
      menuMode: args.externalMenuUrl ? "external" : undefined,
      externalMenuUrl: args.externalMenuUrl,
      isPublished: args.publish ?? true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Edit any directory venue (seeded or org-born). */
export const updateVenue = mutation({
  args: {
    venueId: v.id("venues"),
    name: v.optional(v.string()),
    latinName: v.optional(v.string()), // when set, regenerates the slug
    category: v.optional(CATEGORY),
    description: v.optional(v.string()),
    address: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    phone: v.optional(v.string()),
    externalMenuUrl: v.optional(v.string()),
    menuMode: v.optional(v.union(v.literal("native"), v.literal("external"))),
    gbpPlaceId: v.optional(v.string()),
    coverImage: v.optional(v.string()),
    isPublished: v.optional(v.boolean()),
  },
  handler: async (ctx, { venueId, latinName, ...patch }) => {
    await requireSuperAdmin(ctx);
    const venue = await ctx.db.get(venueId);
    if (!venue) throw new ConvexError("Venue not found.");
    const fields: Record<string, unknown> = { ...patch, updatedAt: Date.now() };
    for (const k of Object.keys(fields)) {
      if (fields[k] === undefined) delete fields[k];
    }
    if (latinName) {
      fields.slug = await uniqueSlug(ctx, slugify(latinName), venueId);
    }
    await ctx.db.patch(venueId, fields);
    return venueId;
  },
});

/**
 * Claim: link an unclaimed venue to a Clerk org (after the owner is verified
 * out-of-band — call from the phone number on their Google profile, etc.).
 */
export const claimVenue = mutation({
  args: { venueId: v.id("venues"), orgId: v.string() },
  handler: async (ctx, { venueId, orgId }) => {
    await requireSuperAdmin(ctx);
    const venue = await ctx.db.get(venueId);
    if (!venue) throw new ConvexError("Venue not found.");
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", orgId))
      .unique();
    if (!org) throw new ConvexError(`No organization with clerkId "${orgId}".`);
    await ctx.db.patch(venueId, {
      orgId,
      claimStatus: "claimed",
      updatedAt: Date.now(),
    });
  },
});

/** Same-day opt-out: remove a venue from the directory entirely. */
export const removeVenue = mutation({
  args: { venueId: v.id("venues") },
  handler: async (ctx, { venueId }) => {
    await requireSuperAdmin(ctx);
    const venue = await ctx.db.get(venueId);
    if (!venue) return;
    if (venue.orgId && venue.claimStatus === "claimed") {
      throw new ConvexError(
        "This venue is claimed by an organization — unpublish it instead of deleting.",
      );
    }
    await ctx.db.delete(venueId);
  },
});

/** Full directory for the super-admin Enlisting tab. */
export const listDirectory = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdmin(ctx);
    const venues = await ctx.db.query("venues").order("desc").collect();
    return venues.map((v) => ({
      _id: v._id,
      slug: v.slug,
      name: v.name,
      category: v.category,
      address: v.address,
      phone: v.phone,
      orgId: v.orgId,
      claimStatus: v.claimStatus ?? (v.orgId ? "claimed" : "unclaimed"),
      menuMode: v.menuMode ?? (v.orgId ? "native" : undefined),
      externalMenuUrl: v.externalMenuUrl,
      googleRating: v.googleRating,
      googleReviewCount: v.googleReviewCount,
      isPublished: v.isPublished,
      createdAt: v.createdAt,
    }));
  },
});
