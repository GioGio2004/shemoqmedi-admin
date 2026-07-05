import { internalMutation } from "./_generated/server";

// ─────────────────────────────────────────────────────────────────────────────
// BACKFILL VENUES — one-time seed migration
//
// Reads all active organizations and creates a corresponding `venues` row
// for each one that doesn't already have one.
//
// Defaults applied:
//   - category: "cafe"  ← intentionally flagged in console; review before publishing
//   - isPublished: false ← SAFE DEFAULT. Admin must explicitly publish each venue.
//
// The mutation is idempotent — re-running it will skip venues that already exist.
// ─────────────────────────────────────────────────────────────────────────────

export const backfillVenuesFromOrgs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("organizations").collect();
    const activeOrgs = orgs.filter((o) => o.isActive);

    let created = 0;
    let skipped = 0;

    for (const org of activeOrgs) {
      // Check if a venues row already exists for this org
      const existing = await ctx.db
        .query("venues")
        .withIndex("by_org", (q) => q.eq("orgId", org.clerkId))
        .first();

      if (existing) {
        skipped++;
        console.log(`[Backfill] ⏭️  Skipped (already exists): ${org.name} → ${org.slug}`);
        continue;
      }

      // Derive what we can from the organization record
      const coverImage =
        org.storefrontConfig?.coverImageUrl ??
        org.storefrontConfig?.heroImageUrls?.[0] ??
        org.logoUrl ??
        undefined;

      const address =
        typeof org.storefrontConfig?.address === "string"
          ? org.storefrontConfig.address
          : typeof org.storefrontConfig?.address === "object" && org.storefrontConfig.address !== null
          ? (org.storefrontConfig.address as Record<string, string>)["en"] ?? ""
          : "";

      const description = `${org.name} — a premium hospitality venue powered by Voloo AI menus. Tap to explore the digital menu.`;

      const now = Date.now();

      await ctx.db.insert("venues", {
        orgId:       org.clerkId,
        slug:        org.slug,
        name:        org.name,
        // ⚠️  DEFAULT CATEGORY: "cafe" — review before publishing each venue
        category:    "cafe",
        description: description.slice(0, 160),
        address,
        coverImage,
        hours:       org.operatingHours ?? undefined,
        galleryImages: org.storefrontConfig?.heroImageUrls ?? undefined,
        isPublished: false, // SAFE DEFAULT — must explicitly publish
        createdAt:   now,
        updatedAt:   now,
      });

      created++;
      console.log(
        `[Backfill] ✅ Created venue: ${org.name} → slug="${org.slug}" ` +
        `⚠️  category defaults to "cafe" — review before publishing`,
      );
    }

    console.log(
      `[Backfill] Complete — created=${created} skipped=${skipped} ` +
      `(${activeOrgs.length} total active orgs)`,
    );

    return { created, skipped, total: activeOrgs.length };
  },
});
