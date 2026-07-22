import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { verifyOrgAccess } from "./authHelpers";

const translatedText = v.record(v.string(), v.string());

const bagItemValidator = v.object({
  menuItemId: v.optional(v.id("menuItems")),
  name: translatedText,
  quantity: v.number(),
  menuPrice: v.number(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Venue side (auth-gated)
// ─────────────────────────────────────────────────────────────────────────────

/** Create or update a reusable bag template. */
export const upsertTemplate = mutation({
  args: {
    orgId: v.string(),
    templateId: v.optional(v.id("surpriseBags")),
    title: translatedText,
    description: v.optional(translatedText),
    imageUrl: v.optional(v.string()),
    items: v.optional(v.array(bagItemValidator)),
    originalValue: v.number(),
    price: v.number(),
  },
  handler: async (ctx, args) => {
    await verifyOrgAccess(ctx, args.orgId);
    if (args.price <= 0 || args.price >= args.originalValue) {
      throw new ConvexError("Price must be positive and below original value.");
    }
    const now = Date.now();
    const fields = {
      orgId: args.orgId,
      isTemplate: true,
      title: args.title,
      description: args.description,
      imageUrl: args.imageUrl,
      items: args.items,
      originalValue: args.originalValue,
      price: args.price,
      status: "draft" as const,
      updatedAt: now,
    };
    if (args.templateId) {
      const existing = await ctx.db.get(args.templateId);
      if (!existing || existing.orgId !== args.orgId || !existing.isTemplate) {
        throw new ConvexError("Template not found.");
      }
      await ctx.db.patch(args.templateId, fields);
      return args.templateId;
    }
    return await ctx.db.insert("surpriseBags", { ...fields, createdAt: now });
  },
});

/** List an org's templates for the one-tap posting UI. */
export const listTemplates = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await verifyOrgAccess(ctx, orgId);
    const rows = await ctx.db
      .query("surpriseBags")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    return rows.filter((b) => b.isTemplate);
  },
});

/**
 * Post today's bag — from a template or free-form.
 * Goes live instantly (status "active").
 */
export const postBag = mutation({
  args: {
    orgId: v.string(),
    templateId: v.optional(v.id("surpriseBags")),
    // Free-form overrides (required when no template)
    title: v.optional(translatedText),
    description: v.optional(translatedText),
    imageUrl: v.optional(v.string()),
    items: v.optional(v.array(bagItemValidator)),
    originalValue: v.optional(v.number()),
    price: v.optional(v.number()),
    // Today's specifics
    quantity: v.number(),
    pickupStart: v.number(),
    pickupEnd: v.number(),
  },
  handler: async (ctx, args) => {
    await verifyOrgAccess(ctx, args.orgId);
    if (args.quantity < 1) throw new ConvexError("Quantity must be at least 1.");
    if (args.pickupEnd <= args.pickupStart || args.pickupEnd <= Date.now()) {
      throw new ConvexError("Pickup window must end in the future.");
    }

    let base = {
      title: args.title,
      description: args.description,
      imageUrl: args.imageUrl,
      items: args.items,
      originalValue: args.originalValue,
      price: args.price,
    };
    if (args.templateId) {
      const tpl = await ctx.db.get(args.templateId);
      if (!tpl || tpl.orgId !== args.orgId || !tpl.isTemplate) {
        throw new ConvexError("Template not found.");
      }
      base = {
        title: args.title ?? tpl.title,
        description: args.description ?? tpl.description,
        imageUrl: args.imageUrl ?? tpl.imageUrl,
        items: args.items ?? tpl.items,
        originalValue: args.originalValue ?? tpl.originalValue,
        price: args.price ?? tpl.price,
      };
    }
    if (!base.title || base.originalValue === undefined || base.price === undefined) {
      throw new ConvexError("Title, original value and price are required.");
    }
    if (base.price <= 0 || base.price >= base.originalValue) {
      throw new ConvexError("Price must be positive and below original value.");
    }

    const now = Date.now();
    return await ctx.db.insert("surpriseBags", {
      orgId: args.orgId,
      isTemplate: false,
      templateId: args.templateId,
      title: base.title,
      description: base.description,
      imageUrl: base.imageUrl,
      items: base.items,
      originalValue: base.originalValue,
      price: base.price,
      quantityTotal: args.quantity,
      quantityLeft: args.quantity,
      pickupStart: args.pickupStart,
      pickupEnd: args.pickupEnd,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Venue cancels a live bag (unsold quantity is withdrawn; paid orders keep their pickup). */
export const cancelBag = mutation({
  args: { orgId: v.string(), bagId: v.id("surpriseBags") },
  handler: async (ctx, { orgId, bagId }) => {
    await verifyOrgAccess(ctx, orgId);
    const bag = await ctx.db.get(bagId);
    if (!bag || bag.orgId !== orgId) throw new ConvexError("Bag not found.");
    await ctx.db.patch(bagId, { status: "cancelled", updatedAt: Date.now() });
  },
});

/** Today's live + recent bags for the venue dashboard. */
export const listOrgBags = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await verifyOrgAccess(ctx, orgId);
    const rows = await ctx.db
      .query("surpriseBags")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(50);
    return rows.filter((b) => !b.isTemplate);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Public (consumer app — no auth)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * All currently claimable bags, joined with public venue info.
 * Powers the Offers feed. Realtime: quantityLeft ticks down live.
 */
export const listActiveBags = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const bags = await ctx.db
      .query("surpriseBags")
      .withIndex("by_status_and_end", (q) =>
        q.eq("status", "active").gt("pickupEnd", now),
      )
      .collect();

    const results = [];
    for (const bag of bags) {
      if ((bag.quantityLeft ?? 0) <= 0) continue;
      const venue = await ctx.db
        .query("venues")
        .withIndex("by_org", (q) => q.eq("orgId", bag.orgId))
        .first();
      const org = await ctx.db
        .query("organizations")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", bag.orgId))
        .unique();
      results.push({
        _id: bag._id,
        title: bag.title,
        description: bag.description,
        imageUrl: bag.imageUrl,
        originalValue: bag.originalValue,
        price: bag.price,
        // Total number of items inside the bag (null for mystery bags with no list)
        itemCount:
          bag.items && bag.items.length > 0
            ? bag.items.reduce((sum, item) => sum + item.quantity, 0)
            : null,
        quantityLeft: bag.quantityLeft,
        pickupStart: bag.pickupStart,
        pickupEnd: bag.pickupEnd,
        venue: venue
          ? {
              slug: venue.slug,
              name: venue.name,
              category: venue.category,
              address: venue.address,
              lat: venue.lat,
              lng: venue.lng,
              coverImage: venue.coverImage,
              googleRating: venue.googleRating,
              googleReviewCount: venue.googleReviewCount,
            }
          : { slug: org?.slug ?? "", name: org?.name ?? "Venue" },
      });
    }
    // Soonest-ending first — urgency sort
    results.sort((a, b) => (a.pickupEnd ?? 0) - (b.pickupEnd ?? 0));
    return results;
  },
});

/** Single bag detail for the reserve screen. */
export const getBag = query({
  args: { bagId: v.id("surpriseBags") },
  handler: async (ctx, { bagId }) => {
    const bag = await ctx.db.get(bagId);
    if (!bag || bag.isTemplate) return null;
    const venue = await ctx.db
      .query("venues")
      .withIndex("by_org", (q) => q.eq("orgId", bag.orgId))
      .first();
    return { ...bag, venue };
  },
});
