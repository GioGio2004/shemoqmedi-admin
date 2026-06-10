import { v } from "convex/values";
import { query } from "./_generated/server";

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC MENU — get
//
// 100% unauthenticated. No verifyOrgAccess, no ctx.auth.
// This is the single round-trip read endpoint for every NFC tag tap and
// QR scan. It resolves an org by URL slug and returns the full nested menu.
//
// Called by: app/[locale]/test-menu/[slug]/page.tsx (Server Component)
// ─────────────────────────────────────────────────────────────────────────────
export const get = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    // ── 1. Resolve the org by slug ──────────────────────────────────────────
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();

    if (!org) {
      // Return null — the page will render a clean 404 state
      return null;
    }

    // ── 2. Fetch all categories for this org ────────────────────────────────
    const allCategories = await ctx.db
      .query("categories")
      .withIndex("by_org", (q) => q.eq("orgId", org.clerkId))
      .collect();

    // Filter to active only, then sort by sortOrder ascending
    const activeCategories = allCategories
      .filter((c) => c.isActive === true)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // ── 3. Fetch all menu items for this org ────────────────────────────────
    // Single query for all org items — cheaper than N per-category queries.
    const allItems = await ctx.db
      .query("menuItems")
      .withIndex("by_org", (q) => q.eq("orgId", org.clerkId))
      .collect();

    // Filter to available only, then sort by sortOrder ascending
    const availableItems = allItems
      .filter((i) => i.isAvailable === true)
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // ── 4. Nest items under their parent category ───────────────────────────
    const categories = activeCategories.map((category) => ({
      _id: category._id,
      name: category.name,         // Record<string, string> — multilingual
      sortOrder: category.sortOrder,
      items: availableItems
        .filter((item) => item.categoryId === category._id)
        .map((item) => ({
          _id: item._id,
          name: item.name,           // Record<string, string>
          description: item.description ?? null,
          price: item.price,         // Stored in tetri/cents (integer)
          imageUrl: item.imageUrl ?? null,
          tags: item.tags ?? [],
          accentColor: item.accentColor ?? null,
          sortOrder: item.sortOrder,
        })),
    }));

    // ── 5. Return the clean, self-contained payload ─────────────────────────
    return {
      organization: {
        name: org.name,
        logoUrl: org.logoUrl ?? null,
        themeSettings: org.themeSettings ?? null,
        currency: org.currency ?? "GEL",
        storefrontConfig: org.storefrontConfig ?? null,
        operatingHours: org.operatingHours ?? [],
        socialLinks: org.socialLinks ?? null,
        announcements: org.announcements ?? [],
        storefrontAlert: org.storefrontAlert ?? null,
      },
      categories,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC MENU — listOrganizations
//
// Unauthenticated list of all active organizations for the landing page.
// Returns basic info: id, name, slug, and a display image.
// ─────────────────────────────────────────────────────────────────────────────
export const listOrganizations = query({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("organizations").collect();
    
    return orgs
      .filter((org) => org.isActive)
      .map((org) => ({
        _id: org._id,
        name: org.name,
        slug: org.slug,
        imageUrl: (org.storefrontConfig?.coverImageUrl || org.storefrontConfig?.heroImageUrls?.[0] || org.logoUrl) ?? null,
      }));
  },
});
