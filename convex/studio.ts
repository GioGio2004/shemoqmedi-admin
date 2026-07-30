import { v, ConvexError } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireUser, verifyOrgAccess } from "./authHelpers";
import { studioConfigV } from "./studioConfig";

// ─────────────────────────────────────────────────────────────────────────────
// SHEMOQMEDI STUDIO — org roster, editor data, draft/publish lifecycle.
//
// Access model mirrors the rest of the platform: super_admin/admin see every
// organization; regular users see the orgs they hold a membership in. All
// per-org reads/writes go through verifyOrgAccess.
// ─────────────────────────────────────────────────────────────────────────────

async function getDesignRow(ctx: QueryCtx | MutationCtx, orgId: string) {
  return await ctx.db
    .query("studioDesigns")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .unique();
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST_ORGANIZATIONS — feeds the workspace venue switcher.
// Deliberately slim (identity only): this query re-runs on every reactive
// update, so it must not fan out into menuItems/design reads per org.
// ─────────────────────────────────────────────────────────────────────────────
export const listOrganizations = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);

    let orgs;
    // Only super_admin matches verifyOrgAccess's bypass — listing orgs a role
    // can see but not open just produces per-org "Unauthorized" errors.
    if (user.role === "super_admin") {
      orgs = await ctx.db.query("organizations").collect();
    } else {
      const memberships = await ctx.db
        .query("memberships")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      const rows = await Promise.all(
        memberships.map((m) =>
          ctx.db
            .query("organizations")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", m.orgId))
            .unique(),
        ),
      );
      orgs = rows.filter((o): o is NonNullable<typeof o> => o !== null);
    }

    return orgs.map((org) => ({
      clerkId: org.clerkId,
      name: org.name,
      slug: org.slug,
      logoUrl: org.logoUrl ?? null,
    }));
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// GET_STUDIO_DATA — everything the editor needs for one org in one query:
// org identity, draft + published configs, and the live menu for the preview.
// ─────────────────────────────────────────────────────────────────────────────
export const getStudioData = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await verifyOrgAccess(ctx, orgId);

    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", orgId))
      .unique();
    if (!org) return null;

    const design = await getDesignRow(ctx, orgId);

    // Venue row carries the precise map location (decoupled from the org).
    const venue = await ctx.db
      .query("venues")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .unique();

    const categories = await ctx.db
      .query("categories")
      .withIndex("by_org_and_sort", (q) => q.eq("orgId", orgId))
      .collect();

    // One by_org read + in-memory grouping — this query re-runs reactively on
    // every autosave, so a per-category fan-out multiplies real read cost.
    const allItems = await ctx.db
      .query("menuItems")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    const menu = categories
      .filter((c) => c.isActive)
      .map((cat) => ({
        id: cat._id,
        name: cat.name,
        imageUrl: cat.imageUrl ?? null,
        items: allItems
          .filter((i) => i.categoryId === cat._id && i.isAvailable)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((i) => ({
            id: i._id,
            name: i.name,
            description: i.description ?? null,
            price: i.price,
            imageUrl: i.imageUrl ?? null,
            tags: i.tags ?? [],
            allergens: i.allergens ?? [],
            isFeatured: i.isFeatured ?? false,
          })),
      }));

    return {
      org: {
        clerkId: org.clerkId,
        name: org.name,
        slug: org.slug,
        logoUrl: org.logoUrl ?? null,
        currency: org.currency ?? "GEL",
        coverImageUrl: org.storefrontConfig?.coverImageUrl ?? null,
        tagline: org.storefrontConfig?.heroSubheadline ?? null,
        accentColor:
          org.ruledMenuConfig?.accentColor ??
          org.themeSettings?.primaryColor ??
          null,
        operatingHours: org.operatingHours ?? null,
        socialLinks: org.socialLinks ?? null,
        // Full content payload for the merged Storefront workspace forms.
        storefrontConfig: org.storefrontConfig ?? null,
        themeSettings: org.themeSettings ?? null,
        ruledMenuConfig: org.ruledMenuConfig ?? null,
        announcements: org.announcements ?? [],
        venueLat: venue?.lat ?? null,
        venueLng: venue?.lng ?? null,
      },
      draft: design?.draft ?? null,
      published: design?.published ?? null,
      draftUpdatedAt: design?.draftUpdatedAt ?? null,
      publishedAt: design?.publishedAt ?? null,
      menu,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// SAVE_DRAFT — upsert the working copy. Never touches `published`.
// ─────────────────────────────────────────────────────────────────────────────
export const saveDraft = mutation({
  args: { orgId: v.string(), config: studioConfigV },
  handler: async (ctx, { orgId, config }) => {
    await verifyOrgAccess(ctx, orgId);

    const now = Date.now();
    const existing = await getDesignRow(ctx, orgId);

    if (existing) {
      await ctx.db.patch(existing._id, {
        draft: config,
        draftUpdatedAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("studioDesigns", {
        orgId,
        draft: config,
        draftUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
    return { savedAt: now };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// PUBLISH — copy draft → published. Accepts an optional config so the editor
// can "save & publish" the latest client state in one call.
// ─────────────────────────────────────────────────────────────────────────────
export const publish = mutation({
  args: { orgId: v.string(), config: v.optional(studioConfigV) },
  handler: async (ctx, { orgId, config }) => {
    await verifyOrgAccess(ctx, orgId);

    const now = Date.now();
    const existing = await getDesignRow(ctx, orgId);

    if (!existing && !config) {
      throw new ConvexError("Nothing to publish — save a draft first.");
    }

    const live = config ?? existing!.draft;

    if (existing) {
      await ctx.db.patch(existing._id, {
        draft: live,
        published: live,
        draftUpdatedAt: config ? now : existing.draftUpdatedAt,
        publishedAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("studioDesigns", {
        orgId,
        draft: live,
        published: live,
        draftUpdatedAt: now,
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    // ── Point the live menu at this design ────────────────────────────────
    // Without this the config is stored but nothing renders it: the consumer
    // menu routes on themeSettings.menuType, so publishing must switch the
    // venue to "studio". (Choosing a fixed template on the Templates page
    // sets menuType back to basic/ruled/dragable — they are mutually
    // exclusive by design.) Legacy fields are kept in sync so the older
    // templates still look right if the venue switches back.
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", orgId))
      .unique();

    if (org) {
      // Spread the STORED object first (db.patch replaces nested objects —
      // hand-enumerating keys silently drops any field added to the schema
      // later). Derived defaults only fill gaps for a brand-new org.
      await ctx.db.patch(org._id, {
        themeSettings: {
          primaryColor: live.theme.accent,
          backgroundColor: live.theme.background,
          textColor: live.theme.ink,
          fontFamily: "Inter",
          buttonRadius: `${live.theme.radius}px`,
          ...(org.themeSettings ?? {}),
          menuType: "studio",
        },
        updatedAt: now,
      });
    }

    return { publishedAt: now };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// GET_PUBLISHED_DESIGN — PUBLIC consumer contract.
//
// The shemoqmedi PWA calls this by venue slug to render the menu with the
// published Studio design. No auth (menu pages are public); returns null when
// the venue has no published design so the renderer falls back to its
// built-in templates. Additive — the existing publicMenu.get payload is
// deliberately untouched.
// ─────────────────────────────────────────────────────────────────────────────
export const getPublishedDesign = query({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!org) return null;

    const design = await getDesignRow(ctx, org.clerkId);
    return design?.published ?? null;
  },
});
