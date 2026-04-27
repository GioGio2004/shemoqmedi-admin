import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { verifyOrgAccess } from "./authHelpers";

// ─── Shared validator for the multilingual name object ────────────────────────
// Mirrors the `translatedText` helper in schema.ts: Record<string, string>
const translatedTextArg = v.record(v.string(), v.string());

// ─────────────────────────────────────────────────────────────────────────────
// LIST — all active categories for an org, sorted by sortOrder
// ─────────────────────────────────────────────────────────────────────────────
export const list = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    // Verify the caller is a member of this org
    await verifyOrgAccess(ctx, orgId);

    const categories = await ctx.db
      .query("categories")
      .withIndex("by_org_and_sort", (q) => q.eq("orgId", orgId))
      .collect();

    // Return only active categories, pre-sorted by sortOrder ascending
    return categories
      .filter((c) => c.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// CREATE — insert a new category, auto-assigning the next sortOrder
// ─────────────────────────────────────────────────────────────────────────────
export const create = mutation({
  args: {
    orgId: v.string(),
    name: translatedTextArg,
  },
  handler: async (ctx, { orgId, name }) => {
    await verifyOrgAccess(ctx, orgId);

    // Find the current highest sortOrder so the new category lands at the bottom
    const existing = await ctx.db
      .query("categories")
      .withIndex("by_org_and_sort", (q) => q.eq("orgId", orgId))
      .collect();

    const maxSort = existing.reduce(
      (max, c) => Math.max(max, c.sortOrder),
      -1
    );

    const newId = await ctx.db.insert("categories", {
      orgId,
      name,
      sortOrder: maxSort + 1,
      isActive: true,
    });

    console.log(`✅ Category created: ${JSON.stringify(name)} → ${newId}`);
    return newId;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE_SORT — bulk-update sortOrder for drag-and-drop reordering
//
// Accepts an ordered array of category IDs. Their new sortOrder is their
// position in the array (0-indexed). This is an all-or-nothing operation —
// if any ID is invalid or belongs to a different org, the whole mutation rolls back.
// ─────────────────────────────────────────────────────────────────────────────
export const updateSort = mutation({
  args: {
    orgId: v.string(),
    // Ordered array: first element gets sortOrder 0, second gets 1, etc.
    orderedIds: v.array(v.id("categories")),
  },
  handler: async (ctx, { orgId, orderedIds }) => {
    await verifyOrgAccess(ctx, orgId);

    await Promise.all(
      orderedIds.map(async (categoryId, index) => {
        const category = await ctx.db.get(categoryId);

        // Security: verify each category actually belongs to this org
        if (!category || category.orgId !== orgId) {
          throw new Error(
            `Security violation: category "${categoryId}" does not belong to org "${orgId}".`
          );
        }

        await ctx.db.patch(categoryId, { sortOrder: index });
      })
    );

    console.log(`🔀 Reordered ${orderedIds.length} categories for org ${orgId}`);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE — edit name of an existing category
// ─────────────────────────────────────────────────────────────────────────────
export const update = mutation({
  args: {
    orgId: v.string(),
    categoryId: v.id("categories"),
    name: translatedTextArg,
  },
  handler: async (ctx, { orgId, categoryId, name }) => {
    await verifyOrgAccess(ctx, orgId);

    const category = await ctx.db.get(categoryId);
    if (!category || category.orgId !== orgId) {
      throw new Error(
        `Security violation: category "${categoryId}" does not belong to org "${orgId}".`
      );
    }

    await ctx.db.patch(categoryId, { name });
    console.log(`📝 Category updated: ${categoryId}`);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// ARCHIVE — soft-delete: sets isActive to false
//
// We never hard-delete categories. Archived categories are hidden from the
// digital menu PWA but their menu items and historical order snapshots remain
// intact and queryable for analytics.
// ─────────────────────────────────────────────────────────────────────────────
export const archive = mutation({
  args: {
    orgId: v.string(),
    categoryId: v.id("categories"),
  },
  handler: async (ctx, { orgId, categoryId }) => {
    await verifyOrgAccess(ctx, orgId);

    const category = await ctx.db.get(categoryId);
    if (!category || category.orgId !== orgId) {
      throw new Error(
        `Security violation: category "${categoryId}" does not belong to org "${orgId}".`
      );
    }

    await ctx.db.patch(categoryId, { isActive: false });
    console.log(`🗄️ Category archived: ${categoryId}`);
  },
});
