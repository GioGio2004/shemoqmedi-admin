import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { GenericQueryCtx } from "convex/server";
import { verifyOrgAccess } from "./authHelpers";

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

export const getAllOrganizationsWithMembers = query({
  args: {},
  handler: async (ctx) => {
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

    await ctx.db.patch(org._id, { themeSettings, updatedAt: Date.now() });
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

    storefrontConfig: v.optional(
      v.object({
        heroHeadline: v.string(),
        heroSubheadline: v.string(),
        primaryButtonText: v.optional(v.string()),
        secondaryButtonText: v.optional(v.string()),
        coverImageUrl: v.optional(v.string()), // Landing page / primary background
        heroImageUrls: v.array(v.string()), // Up to 3 floating hero images
        address: v.string(),
        cityStateZip: v.string(),
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
      }),
    ),

    storefrontAlert: v.optional(v.string()),
  },

  handler: async (ctx, { orgId, ...fields }) => {
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

    await ctx.db.patch(org._id, { ...patch, updatedAt: Date.now() });

    console.log(
      `🏪 storefrontConfig updated for org ${orgId}. Keys:`,
      Object.keys(patch).join(", "),
    );
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
      storefrontAlert: org.storefrontAlert ?? null,
    };
  },
});
