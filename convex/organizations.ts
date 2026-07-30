import { v, ConvexError } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { GenericQueryCtx } from "convex/server";
import { verifyOrgAccess, requireSuperAdmin } from "./authHelpers";

// Helper to find an org quickly
async function getOrgByClerkId(ctx: GenericQueryCtx<any>, clerkId: string) {
  return await ctx.db
    .query("organizations")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
    .unique();
}

export const upsertFromClerk = internalMutation({
  args: { data: v.any() },
  handler: async (ctx, { data }) => {
    if (!data.id) {
      throw new Error(
        `Missing org ID from Clerk. Data: ${JSON.stringify(data)}`,
      );
    }

    const orgAttributes = {
      clerkId: data.id,
      name: data.name,
      slug: data.slug || "",
      logoUrl: data.image_url || "",
      updatedAt: Date.now(),
    };

    const existingOrg = await getOrgByClerkId(ctx, data.id);

    if (existingOrg === null) {
      console.log("✅ Creating new organization:", orgAttributes.name);
      await ctx.db.insert("organizations", {
        ...orgAttributes,
        isActive: true,
        createdAt: Date.now(),
      });
    } else {
      // CONVEX OWNS THE SLUG. Clerk's slug is only an initial value — renames
      // happen via migrateOrgSlug (super admin), and a Clerk-side update event
      // must never clobber a custom slug back to the auto-generated one.
      if (existingOrg.slug) {
        orgAttributes.slug = existingOrg.slug;
      }
      console.log("📝 Updating existing organization:", orgAttributes.name);
      await ctx.db.patch(existingOrg._id, orgAttributes);
    }
  },
});

export const deleteFromClerk = internalMutation({
  args: { clerkId: v.string() },
  handler: async (ctx, { clerkId }) => {
    const org = await getOrgByClerkId(ctx, clerkId);
    if (org !== null) {
      console.log("🗑️ Deleting organization:", org.name);
      await ctx.db.delete(org._id);
    } else {
      console.log("⚠️ Organization not found for deletion:", clerkId);
    }
  },
});

// Platform-wide roster: every org joined to every member's user record.
// requireSuperAdmin is mandatory — unguarded, this returned the entire
// tenant + member PII graph (emails, phones, payment method) to any caller.
export const getAllOrganizationsWithMembers = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdmin(ctx);

    const orgs = await ctx.db.query("organizations").collect();

    return await Promise.all(
      orgs.map(async (org) => {
        // Fetch memberships for this org
        const memberships = await ctx.db
          .query("memberships")
          .withIndex("by_org", (q) => q.eq("orgId", org.clerkId))
          .collect();

        // Fetch user details for each membership
        const members = await Promise.all(
          memberships.map(async (membership) => {
            const user = await ctx.db.get(membership.userId);
            return {
              ...user,
              membershipRole: membership.role,
              customRole: membership.customRole,
            };
          }),
        );

        return {
          ...org,
          members: members.filter(Boolean), // Filter out nulls in case a user was deleted
        };
      }),
    );
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE_THEME_SETTINGS — patch the Liquid UI config for an org
//
// Protected by verifyOrgAccess — super_admin or any org member may call this.
// In practice, restrict the UI to owners/admins only.
// ─────────────────────────────────────────────────────────────────────────────
export const updateThemeSettings = mutation({
  args: {
    orgId: v.string(), // Clerk org ID
    themeSettings: v.object({
      primaryColor: v.string(), // e.g. "#3B82F6" or "oklch(0.6 0.15 230)"
      fontFamily: v.string(), // e.g. "Outfit", "Inter"
      buttonRadius: v.string(), // e.g. "0.5rem", "9999px" (pill)
    }),
  },
  handler: async (ctx, { orgId, themeSettings }) => {
    await verifyOrgAccess(ctx, orgId);

    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", orgId))
      .unique();

    if (!org) {
      throw new Error(`Organization "${orgId}" not found in Convex.`);
    }

    // Merge over the stored object rather than replacing it. db.patch swaps the
    // whole nested value, so patching these three keys alone would delete
    // menuType (which the public menu routes on) and categoryLayout.
    await ctx.db.patch(org._id, {
      themeSettings: { ...org.themeSettings, ...themeSettings },
      updatedAt: Date.now(),
    });
    console.log(`🎨 themeSettings updated for org ${orgId}:`, themeSettings);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE_FEATURES — toggle the modular feature flags for an org
//
// Each flag independently controls which platform capabilities are active.
// This drives both the billing calculation and the UI feature gates.
// ─────────────────────────────────────────────────────────────────────────────
export const updateFeatures = mutation({
  args: {
    orgId: v.string(), // Clerk org ID
    features: v.object({
      hasNfcHardware: v.boolean(),
      hasDigitalMenu: v.boolean(),
      hasCustomDomain: v.boolean(),
      hasAiManager: v.boolean(),
      hasLiveOrdering: v.boolean(),
    }),
  },
  handler: async (ctx, { orgId, features }) => {
    await verifyOrgAccess(ctx, orgId);

    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", orgId))
      .unique();

    if (!org) {
      throw new Error(`Organization "${orgId}" not found in Convex.`);
    }

    await ctx.db.patch(org._id, { features, updatedAt: Date.now() });
    console.log(`⚙️ features updated for org ${orgId}:`, features);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// GET_ORG_SETTINGS — returns themeSettings + features for the settings page
//
// Used to populate form defaults. verifyOrgAccess ensures this cannot leak
// one org's settings to a member of a different org.
// ─────────────────────────────────────────────────────────────────────────────
export const getOrgSettings = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await verifyOrgAccess(ctx, orgId);

    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", orgId))
      .unique();

    if (!org) return null;

    return {
      themeSettings: org.themeSettings ?? null,
      features: org.features ?? null,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE_STOREFRONT_CONFIG — patch hero copy, location, hours, socials & theme
//
// Accepts any combination of the four nested config objects; only fields that
// are explicitly passed will be written (partial patch pattern).
// Protected by verifyOrgAccess — super_admin or any org member may call this.
// ─────────────────────────────────────────────────────────────────────────────
export const updateStorefrontConfig = mutation({
  args: {
    orgId: v.string(), // Clerk org ID

    // Text fields accept a plain string (legacy) or a translated record —
    // mirroring the schema's union. The old admin sent records here too, which
    // v.string() silently rejected at the validator.
    storefrontConfig: v.optional(
      v.object({
        heroHeadline: v.union(v.string(), v.record(v.string(), v.string())),
        heroSubheadline: v.union(v.string(), v.record(v.string(), v.string())),
        primaryButtonText: v.optional(
          v.union(v.string(), v.record(v.string(), v.string())),
        ),
        secondaryButtonText: v.optional(
          v.union(v.string(), v.record(v.string(), v.string())),
        ),
        coverImageUrl: v.optional(v.string()), // Landing page / primary background
        heroImageUrls: v.array(v.string()), // Up to 3 floating hero images
        address: v.union(v.string(), v.record(v.string(), v.string())),
        cityStateZip: v.union(v.string(), v.record(v.string(), v.string())),
        lat: v.optional(v.number()),
        lng: v.optional(v.number()),
      }),
    ),

    operatingHours: v.optional(
      v.array(
        v.object({
          day: v.string(), // e.g. "Mon – Fri"
          hours: v.string(), // e.g. "07:00 – 19:00"
        }),
      ),
    ),

    socialLinks: v.optional(
      v.object({
        whatsapp: v.optional(v.string()),
        instagram: v.optional(v.string()),
        email: v.optional(v.string()),
      }),
    ),

    themeSettings: v.optional(
      v.object({
        primaryColor: v.string(), // e.g. "#3B82F6"
        backgroundColor: v.optional(v.string()), // e.g. "#FAFAFA"
        textColor: v.optional(v.string()), // e.g. "#111827"
        fontFamily: v.string(), // e.g. "Inter"
        buttonRadius: v.string(), // e.g. "0.5rem" | "9999px"
        menuType: v.optional(
          v.union(
            v.literal("basic"),
            v.literal("dragable"),
            v.literal("ruled"),
            v.literal("studio"),
          ),
        ),
        categoryLayout: v.optional(v.union(v.literal("pills"), v.literal("cards"))),
      }),
    ),

    // "Signature" (RULED) menu template settings — multilingual content is a
    // Record<locale, string> exactly like the schema's translatedText.
    ruledMenuConfig: v.optional(
      v.object({
        tickerText: v.optional(v.record(v.string(), v.string())),
        storyText: v.optional(v.record(v.string(), v.string())),
        storyImageUrl: v.optional(v.string()),
        galleryImageUrls: v.optional(v.array(v.string())),
        accentColor: v.optional(v.string()),
        menuStyle: v.optional(v.union(v.literal("rows"), v.literal("gallery"))),
        showTicker: v.optional(v.boolean()),
        showTunnel: v.optional(v.boolean()),
        showFeatured: v.optional(v.boolean()),
        showStory: v.optional(v.boolean()),
        showGallery: v.optional(v.boolean()),
      }),
    ),

    announcements: v.optional(
      v.array(
        v.object({
          id: v.string(),
          message: v.string(),
          isActive: v.boolean(),
        })
      )
    ),
  },

  handler: async (ctx, { orgId, themeSettings, ...fields }) => {
    await verifyOrgAccess(ctx, orgId);

    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", orgId))
      .unique();

    if (!org) {
      throw new Error(`Organization "${orgId}" not found in Convex.`);
    }

    // Strip undefined keys so patch only contains what was actually sent
    const patch = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined),
    );

    // themeSettings is a nested object, so db.patch REPLACES it. Editors send a
    // snapshot captured when their form mounted, which means a stale (or
    // absent) menuType here silently retemplates the venue and can strand a
    // published Studio design. menuType is owned exclusively by
    // setMenuTemplate / studio.publish — never let a content save move it.
    const themePatch = themeSettings
      ? { themeSettings: { ...themeSettings, menuType: org.themeSettings?.menuType } }
      : {};

    await ctx.db.patch(org._id, { ...patch, ...themePatch, updatedAt: Date.now() });

    console.log(
      `🏪 storefrontConfig updated for org ${orgId}. Keys:`,
      [...Object.keys(patch), ...Object.keys(themePatch)].join(", "),
    );
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATE_ORG_SLUG — super-admin only. CONVEX IS THE SOURCE OF TRUTH for the
// org slug: Clerk's slug is only the initial value at creation, and the
// webhook (upsertFromClerk) preserves the Convex slug on updates. Clerk's own
// slug is never read at runtime, so it may drift — that's fine.
//
// The org slug is load-bearing beyond the organizations row:
//   • /menu/{slug} resolves via publicMenu.get → organizations.by_slug
//   • the org-born venues row shares the same slug (directory + sitemap + SEO)
//   • chatSessions / chatMessages / chatRatings / tableOrders / ai_training_logs
//     store it literally as `cafeId` (tenant-isolation key)
// This mutation cascades all of that so history is never orphaned.
// ─────────────────────────────────────────────────────────────────────────────
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const migrateOrgSlug = mutation({
  args: {
    orgClerkId: v.string(),
    newSlug: v.string(),
  },
  handler: async (ctx, { orgClerkId, newSlug }) => {
    await requireSuperAdmin(ctx);

    if (!SLUG_RE.test(newSlug) || newSlug.length > 60) {
      throw new ConvexError(
        "Slug must be lowercase letters/numbers separated by hyphens (max 60 chars).",
      );
    }

    const org = await getOrgByClerkId(ctx, orgClerkId);
    if (!org) throw new ConvexError(`Organization "${orgClerkId}" not found in Convex.`);

    const oldSlug = org.slug;
    if (oldSlug === newSlug) return { migrated: 0 };

    // Guard against Convex-side drift: another org row already holding newSlug.
    const clash = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", newSlug))
      .unique();
    if (clash && clash.clerkId !== orgClerkId) {
      throw new ConvexError(`Slug "${newSlug}" is already used by "${clash.name}".`);
    }

    const now = Date.now();
    await ctx.db.patch(org._id, { slug: newSlug, updatedAt: now });

    // Org-born venue rows that were URL-coupled to the old slug follow it,
    // so /menu/{newSlug} metadata + the sitemap entry stay in lockstep.
    const venues = await ctx.db
      .query("venues")
      .withIndex("by_org", (q) => q.eq("orgId", orgClerkId))
      .collect();
    for (const venue of venues) {
      if (venue.slug !== oldSlug) continue;
      const taken = await ctx.db
        .query("venues")
        .withIndex("by_slug", (q) => q.eq("slug", newSlug))
        .unique();
      if (taken && taken._id !== venue._id) {
        throw new ConvexError(
          `Venue slug "${newSlug}" is already used by "${taken.name}" in the directory.`,
        );
      }
      await ctx.db.patch(venue._id, { slug: newSlug, updatedAt: now });
    }

    // cafeId-keyed history. Volumes are small enough for one mutation today;
    // if a table ever nears the per-mutation write limit, batch by table.
    let migrated = 0;

    const sessions = await ctx.db
      .query("chatSessions")
      .withIndex("byCafeId", (q) => q.eq("cafeId", oldSlug))
      .collect();
    for (const session of sessions) {
      const messages = await ctx.db
        .query("chatMessages")
        .withIndex("bySession", (q) =>
          q.eq("sessionId", session.sessionId).eq("cafeId", oldSlug),
        )
        .collect();
      for (const message of messages) {
        await ctx.db.patch(message._id, { cafeId: newSlug });
        migrated++;
      }
      await ctx.db.patch(session._id, { cafeId: newSlug });
      migrated++;
    }

    const ratings = await ctx.db
      .query("chatRatings")
      .withIndex("byCafeId", (q) => q.eq("cafeId", oldSlug))
      .collect();
    for (const rating of ratings) {
      await ctx.db.patch(rating._id, { cafeId: newSlug });
      migrated++;
    }

    const orders = await ctx.db
      .query("tableOrders")
      .withIndex("by_cafe", (q) => q.eq("cafeId", oldSlug))
      .collect();
    for (const order of orders) {
      await ctx.db.patch(order._id, { cafeId: newSlug });
      migrated++;
    }

    const trainingLogs = await ctx.db
      .query("ai_training_logs")
      .withIndex("byCafe", (q) => q.eq("cafeId", oldSlug))
      .collect();
    for (const log of trainingLogs) {
      await ctx.db.patch(log._id, { cafeId: newSlug });
      migrated++;
    }

    console.log(
      `🔀 Org slug migrated: "${oldSlug}" → "${newSlug}" (${migrated} cafeId rows).`,
    );
    return { migrated };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// GET_STOREFRONT_CONFIG — returns all storefront-related fields for the editor
// ─────────────────────────────────────────────────────────────────────────────
export const getStorefrontConfig = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await verifyOrgAccess(ctx, orgId);

    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", orgId))
      .unique();

    if (!org) return null;

    return {
      storefrontConfig: org.storefrontConfig ?? null,
      operatingHours: org.operatingHours ?? null,
      socialLinks: org.socialLinks ?? null,
      themeSettings: org.themeSettings ?? null,
      announcements: org.announcements ?? [],
      ruledMenuConfig: org.ruledMenuConfig ?? null,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// SET_MENU_TEMPLATE — switch which template renders the public menu.
//
// Why this exists instead of routing through updateStorefrontConfig:
// that mutation takes the WHOLE themeSettings object, so two editing surfaces
// that each hold their own copy will clobber each other's fields on save. That
// is exactly how a venue ended up with a published Studio design while
// themeSettings.menuType still said "ruled" — the consumer routes on menuType,
// so the published design silently never rendered.
//
// This patches menuType and nothing else, and it is the ONLY writer of that
// field outside studio.publish.
// ─────────────────────────────────────────────────────────────────────────────
export const setMenuTemplate = mutation({
  args: {
    orgId: v.string(),
    menuType: v.union(
      v.literal("basic"),
      v.literal("dragable"),
      v.literal("ruled"),
      v.literal("studio"),
    ),
  },
  handler: async (ctx, { orgId, menuType }) => {
    await verifyOrgAccess(ctx, orgId);

    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", orgId))
      .unique();

    if (!org) throw new ConvexError(`Organization "${orgId}" not found.`);

    // "studio" only renders when a design has actually been published —
    // otherwise the consumer falls through to the basic template and the venue
    // sees a blank-looking menu it never chose.
    if (menuType === "studio") {
      const design = await ctx.db
        .query("studioDesigns")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .unique();
      if (!design?.published) {
        throw new ConvexError(
          "Publish your custom design first — there is nothing live to switch to yet.",
        );
      }
    }

    // Spread the STORED object first (db.patch replaces nested objects — a
    // hand-enumerated key list silently drops fields added to the schema
    // later). Only the route changes; defaults fill gaps for a new org.
    await ctx.db.patch(org._id, {
      themeSettings: {
        primaryColor: "#ffffff",
        fontFamily: "Inter",
        buttonRadius: "0.5rem",
        ...(org.themeSettings ?? {}),
        menuType,
      },
      updatedAt: Date.now(),
    });

    return { menuType };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// GET_MENU_TEMPLATE_STATE — everything the template picker needs in one read.
//
// The picker has to tell the venue the truth about what is LIVE right now,
// including the case that bit us: a published custom design that is not the
// active route. Returning both facts together removes the guesswork.
// ─────────────────────────────────────────────────────────────────────────────
export const getMenuTemplateState = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await verifyOrgAccess(ctx, orgId);

    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", orgId))
      .unique();

    if (!org) return null;

    const design = await ctx.db
      .query("studioDesigns")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .unique();

    const menuType = org.themeSettings?.menuType ?? "basic";
    const hasPublishedDesign = !!design?.published;

    return {
      menuType,
      hasPublishedDesign,
      publishedAt: design?.publishedAt ?? null,
      hasDraft: !!design?.draft,
      // True when a published design exists but a fixed template is routing
      // instead — the venue's custom work is live-but-unreachable.
      customDesignShadowed: hasPublishedDesign && menuType !== "studio",
    };
  },
});
