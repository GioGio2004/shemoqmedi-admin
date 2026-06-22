import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { verifyOrgAccess } from "./authHelpers";

// ─── Shared validators ────────────────────────────────────────────────────────
const translatedTextArg = v.record(v.string(), v.string());

// ─────────────────────────────────────────────────────────────────────────────
// LIST_BY_CATEGORY — all items in a category, sorted by sortOrder
// ─────────────────────────────────────────────────────────────────────────────
export const listByCategory = query({
  args: {
    orgId: v.string(),
    categoryId: v.id("categories"),
  },
  handler: async (ctx, { orgId, categoryId }) => {
    await verifyOrgAccess(ctx, orgId);

    // Also verify the category belongs to this org (prevents cross-tenant reads)
    const category = await ctx.db.get(categoryId);
    if (!category || category.orgId !== orgId) {
      throw new Error(
        `Security violation: category "${categoryId}" does not belong to org "${orgId}".`
      );
    }

    const items = await ctx.db
      .query("menuItems")
      .withIndex("by_category", (q) => q.eq("categoryId", categoryId))
      .collect();

    // Return sorted by sortOrder; client can filter isAvailable as needed
    return items.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// LIST_BY_ORG — all items for an org (useful for search, bulk ops)
// ─────────────────────────────────────────────────────────────────────────────
export const listByOrg = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await verifyOrgAccess(ctx, orgId);

    const items = await ctx.db
      .query("menuItems")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    return items.sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// CREATE — insert a new menu item
//
// Price MUST be provided in tetri (smallest unit). The client is responsible
// for the conversion (e.g. 5.50 GEL → 550 tetri) before calling this mutation.
// ─────────────────────────────────────────────────────────────────────────────
export const create = mutation({
  args: {
    orgId: v.string(),
    categoryId: v.id("categories"),
    name: translatedTextArg,
    description: v.optional(translatedTextArg),
    price: v.number(),          // tetri/cents — e.g. 550 = 5.50 GEL
    imageUrl: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { orgId, categoryId } = args;
    await verifyOrgAccess(ctx, orgId);

    // Validate the target category belongs to this org
    const category = await ctx.db.get(categoryId);
    if (!category || category.orgId !== orgId) {
      throw new Error(
        `Security violation: category "${categoryId}" does not belong to org "${orgId}".`
      );
    }

    // Price sanity check — must be a non-negative integer (tetri)
    if (!Number.isInteger(args.price) || args.price < 0) {
      throw new Error(
        `Invalid price: ${args.price}. Price must be a non-negative integer in tetri (smallest currency unit).`
      );
    }

    // Auto-assign sortOrder: find the current maximum within this category
    const existingItems = await ctx.db
      .query("menuItems")
      .withIndex("by_category", (q) => q.eq("categoryId", categoryId))
      .collect();

    const maxSort = existingItems.reduce(
      (max, item) => Math.max(max, item.sortOrder),
      -1
    );

    const newId = await ctx.db.insert("menuItems", {
      orgId,
      categoryId,
      name: args.name,
      description: args.description,
      price: args.price,
      imageUrl: args.imageUrl,
      tags: args.tags,
      isAvailable: true,
      sortOrder: maxSort + 1,
    });

    console.log(`✅ Menu item created: ${JSON.stringify(args.name)} → ${newId}`);
    return newId;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE — patch mutable fields on an existing menu item
//
// Only fields that are explicitly passed will be updated (partial patch).
// The orgId in the payload is always cross-checked against the item's stored
// orgId to prevent cross-tenant writes.
// ─────────────────────────────────────────────────────────────────────────────
export const update = mutation({
  args: {
    orgId: v.string(),
    menuItemId: v.id("menuItems"),
    // All editable fields are optional — callers send only what changed
    name: v.optional(translatedTextArg),
    description: v.optional(translatedTextArg),
    price: v.optional(v.number()),
    imageUrl: v.optional(v.string()),
    categoryId: v.optional(v.id("categories")),
    tags: v.optional(v.array(v.string())),
    isAvailable: v.optional(v.boolean()),
  },
  handler: async (ctx, { orgId, menuItemId, ...fields }) => {
    await verifyOrgAccess(ctx, orgId);

    const item = await ctx.db.get(menuItemId);
    if (!item || item.orgId !== orgId) {
      throw new Error(
        `Security violation: menu item "${menuItemId}" does not belong to org "${orgId}".`
      );
    }

    // If moving to a new category, verify that category also belongs to this org
    if (fields.categoryId) {
      const targetCategory = await ctx.db.get(fields.categoryId);
      if (!targetCategory || targetCategory.orgId !== orgId) {
        throw new Error(
          `Security violation: target category "${fields.categoryId}" does not belong to org "${orgId}".`
        );
      }
    }

    // Price sanity check if being updated
    if (fields.price !== undefined) {
      if (!Number.isInteger(fields.price) || fields.price < 0) {
        throw new Error(
          `Invalid price: ${fields.price}. Price must be a non-negative integer in tetri.`
        );
      }
    }

    // Strip undefined values so we only patch what was actually sent
    const patch = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined)
    );

    await ctx.db.patch(menuItemId, patch);
    console.log(`📝 Menu item updated: ${menuItemId}`);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// ARCHIVE — soft-delete: sets isAvailable to false
//
// Items are never hard-deleted because the orders table stores snapshot
// references to `menuItemId`. Archiving keeps the receipt history intact.
// ─────────────────────────────────────────────────────────────────────────────
export const archive = mutation({
  args: {
    orgId: v.string(),
    menuItemId: v.id("menuItems"),
  },
  handler: async (ctx, { orgId, menuItemId }) => {
    await verifyOrgAccess(ctx, orgId);

    const item = await ctx.db.get(menuItemId);
    if (!item || item.orgId !== orgId) {
      throw new Error(
        `Security violation: menu item "${menuItemId}" does not belong to org "${orgId}".`
      );
    }

    await ctx.db.patch(menuItemId, { isAvailable: false });
    console.log(`🗄️ Menu item archived: ${menuItemId}`);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE_SORT — bulk-update sortOrder within a category (drag-and-drop)
// ─────────────────────────────────────────────────────────────────────────────
export const updateSort = mutation({
  args: {
    orgId: v.string(),
    orderedIds: v.array(v.id("menuItems")),
  },
  handler: async (ctx, { orgId, orderedIds }) => {
    await verifyOrgAccess(ctx, orgId);

    await Promise.all(
      orderedIds.map(async (menuItemId, index) => {
        const item = await ctx.db.get(menuItemId);
        if (!item || item.orgId !== orgId) {
          throw new Error(
            `Security violation: menu item "${menuItemId}" does not belong to org "${orgId}".`
          );
        }
        await ctx.db.patch(menuItemId, { sortOrder: index });
      })
    );

    console.log(`🔀 Reordered ${orderedIds.length} items for org ${orgId}`);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// SET_ALL_AVAILABILITY — bulk set isAvailable for every item in the org
//
// Used by the "Hide All from Storefront" / "Show All on Storefront" buttons.
// ─────────────────────────────────────────────────────────────────────────────
export const setAllAvailability = mutation({
  args: {
    orgId: v.string(),
    isAvailable: v.boolean(),
  },
  handler: async (ctx, { orgId, isAvailable }) => {
    await verifyOrgAccess(ctx, orgId);

    const items = await ctx.db
      .query("menuItems")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    await Promise.all(
      items.map((item) => ctx.db.patch(item._id, { isAvailable }))
    );

    console.log(
      `🌐 Bulk availability update: ${items.length} items → isAvailable=${isAvailable} for org ${orgId}`
    );
    return items.length;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// REMOVE — hard-delete an item
// ─────────────────────────────────────────────────────────────────────────────
export const remove = mutation({
  args: {
    orgId: v.string(),
    menuItemId: v.id("menuItems"),
  },
  handler: async (ctx, { orgId, menuItemId }) => {
    await verifyOrgAccess(ctx, orgId);

    const item = await ctx.db.get(menuItemId);
    if (!item || item.orgId !== orgId) {
      throw new Error(
        `Security violation: menu item "${menuItemId}" does not belong to org "${orgId}".`
      );
    }

    await ctx.db.delete(menuItemId);
    console.log(`🗑️ Menu item deleted: ${menuItemId}`);
  },
});
