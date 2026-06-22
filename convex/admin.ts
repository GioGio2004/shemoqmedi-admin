import { v } from "convex/values";
import { mutation } from "./_generated/server";

// ─── Shared validator (mirrors `translatedText` in schema.ts) ─────────────────
// v.record(v.string(), v.string()) accepts any language code: en, ka, ru, etc.
const translatedTextArg = v.record(v.string(), v.string());

// ─────────────────────────────────────────────────────────────────────────────
// BULK IMPORT MENU
//
// Super-Admin-only mutation. Inserts a complete menu payload (N categories,
// each with M items) into the target org's catalog in a single atomic call.
//
// Auth: Skips per-org membership check — the Super Admin page is already
//       guarded server-side via Clerk sessionClaims metadata role check.
//       A belt-and-suspenders check on the `role` field is added below.
//
// Price convention: `price` is stored as an integer in the smallest currency
//   unit (tetri for GEL, cents for USD). The caller is responsible for
//   converting before passing — e.g. ₾5.50 → 550.
// ─────────────────────────────────────────────────────────────────────────────
export const bulkImportMenu = mutation({
  args: {
    orgId: v.string(),
    payload: v.object({
      categories: v.array(
        v.object({
          name: translatedTextArg,
          sortOrder: v.number(),
          items: v.array(
            v.object({
              name: translatedTextArg,
              description: v.optional(translatedTextArg),
              price: v.number(),
              sortOrder: v.number(),
              tags: v.optional(v.array(v.string())),
              accentColor: v.optional(v.string()),
              imageUrl: v.optional(v.string()),
            })
          ),
        })
      ),
    }),
  },

  handler: async (ctx, { orgId, payload }) => {
    // ── Super Admin guard ────────────────────────────────────────────────────
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const convexUser = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", identity.subject))
      .unique();

    if (!convexUser || convexUser.role !== "super_admin") {
      throw new Error("Forbidden: super_admin role required");
    }

    // ── Verify target org exists ─────────────────────────────────────────────
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", orgId))
      .unique();

    if (!org) throw new Error(`Organization not found: ${orgId}`);

    // ── Find current max sortOrders to safely append ─────────────────────────
    const existingCategories = await ctx.db
      .query("categories")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    const categoryBaseSort =
      existingCategories.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1;

    // ── Insert ───────────────────────────────────────────────────────────────
    let totalItemsInserted = 0;
    let totalCategoriesInserted = 0;

    for (const categoryData of payload.categories) {
      const categoryId = await ctx.db.insert("categories", {
        orgId,
        name: categoryData.name,
        sortOrder: categoryBaseSort + categoryData.sortOrder,
        isActive: true,
      });

      totalCategoriesInserted++;

      for (const itemData of categoryData.items) {
        await ctx.db.insert("menuItems", {
          orgId,
          categoryId,
          name: itemData.name,
          description: itemData.description,
          price: itemData.price,
          sortOrder: itemData.sortOrder,
          isAvailable: true,
          tags: itemData.tags,
          accentColor: itemData.accentColor,
          imageUrl: itemData.imageUrl,
        });
        totalItemsInserted++;
      }
    }

    console.log(
      `✅ Bulk import: ${totalCategoriesInserted} categories, ${totalItemsInserted} items → org ${orgId}`
    );

    return {
      success: true,
      message: `Imported ${totalCategoriesInserted} categories and ${totalItemsInserted} items.`,
      categoriesInserted: totalCategoriesInserted,
      itemsInserted: totalItemsInserted,
    };
  },
});
