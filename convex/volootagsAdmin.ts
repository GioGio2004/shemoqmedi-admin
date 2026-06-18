import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

// ─────────────────────────────────────────────────────────────────────────────
// AUTH GUARDS
//
// ensureAuthenticated — used for READ queries on the super-admin panel.
//   The page-level server redirect (super-admin/page.tsx) already blocks
//   anyone without role === "super_admin" before React even mounts.
//   Convex just needs to confirm the user has a valid session.
//
// ensureSuperAdmin — used for WRITE mutations (provision, update, delete).
//   Checks the Convex users table role field. Seed it once with:
//   npx convex run backfill:setRole '{"clerkUserId":"user_XXX","role":"super_admin"}'
// ─────────────────────────────────────────────────────────────────────────────

async function ensureAuthenticated(ctx: MutationCtx | QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Authentication required");
  return identity;
}

const ADMIN_ROLES = new Set(["super_admin", "admin"]);

async function ensureSuperAdmin(ctx: MutationCtx | QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Authentication required");

  // Check DB role (seeded via: npx convex run backfill:setRole '{"clerkUserId":"user_XXX","role":"super_admin"}')
  const user = await ctx.db
    .query("users")
    .withIndex("byExternalId", (q) => q.eq("externalId", identity.subject))
    .unique();

  if (user?.role && ADMIN_ROLES.has(user.role)) return identity;

  // Fallback: scan JWT claim locations (works if Clerk JWT template includes metadata)
  const c = identity as Record<string, unknown>;
  const jwtRole =
    (c["metadata"] as Record<string, unknown> | undefined)?.["role"] ??
    (c["publicMetadata"] as Record<string, unknown> | undefined)?.["role"] ??
    c["role"];

  if (jwtRole && ADMIN_ROLES.has(jwtRole as string)) return identity;

  throw new ConvexError(
    "Super Admin role required. Seed your role with: " +
    "npx convex run backfill:setRole '{\"clerkUserId\":\"" + identity.subject + "\",\"role\":\"super_admin\"}'"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PHYSICAL TAG PROVISIONING
// Super-admin writes a new UUID to an NTAG216 chip and registers it here.
// The tag starts unowned (orgId = undefined) until a cafe admin claims it.
// ─────────────────────────────────────────────────────────────────────────────
export const provisionPhysicalTag = mutation({
  args: {
    volooTagsUUID: v.string(),
    tableName: v.optional(v.string()), // e.g. "Table 1" — can be set later
    seatNumber: v.optional(v.number()), // Exact integer seat number
    orgId: v.optional(v.string()),     // Clerk org ID — can be set later
  },
  handler: async (ctx, args) => {
    await ensureSuperAdmin(ctx);

    // Prevent duplicate UUIDs
    const existing = await ctx.db
      .query("physicalTags")
      .withIndex("by_uuid", (q) => q.eq("volooTagsUUID", args.volooTagsUUID))
      .unique();

    if (existing) {
      throw new ConvexError(`UUID "${args.volooTagsUUID}" is already registered.`);
    }

    const id = await ctx.db.insert("physicalTags", {
      volooTagsUUID: args.volooTagsUUID,
      tableName: args.tableName,
      seatNumber: args.seatNumber,
      orgId: args.orgId,
      isActive: true,
      tapCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { success: true, tagId: id, message: "Physical tag provisioned. Ready to deploy." };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE PHYSICAL TAG — assign to org, rename table, toggle active
// ─────────────────────────────────────────────────────────────────────────────
export const updatePhysicalTag = mutation({
  args: {
    tagId: v.id("physicalTags"),
    orgId: v.optional(v.string()),
    tableName: v.optional(v.string()),
    seatNumber: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await ensureSuperAdmin(ctx);

    const tag = await ctx.db.get(args.tagId);
    if (!tag) throw new ConvexError("Tag not found");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.orgId !== undefined) patch.orgId = args.orgId;
    if (args.tableName !== undefined) patch.tableName = args.tableName;
    if (args.seatNumber !== undefined) patch.seatNumber = args.seatNumber;
    if (args.isActive !== undefined) patch.isActive = args.isActive;

    await ctx.db.patch(args.tagId, patch);
    return { success: true };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE PHYSICAL TAG
// ─────────────────────────────────────────────────────────────────────────────
export const deletePhysicalTag = mutation({
  args: { tagId: v.id("physicalTags") },
  handler: async (ctx, args) => {
    await ensureSuperAdmin(ctx);
    const tag = await ctx.db.get(args.tagId);
    if (!tag) throw new ConvexError("Tag not found");
    await ctx.db.delete(args.tagId);
    return { success: true };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// GET ALL PHYSICAL TAGS — optionally filter by org
// Super-admin sees all; filtered view shows one org's fleet.
// ─────────────────────────────────────────────────────────────────────────────
export const getAllPhysicalTags = query({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await ensureAuthenticated(ctx);

    if (args.orgId) {
      return await ctx.db
        .query("physicalTags")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .order("desc")
        .collect();
    }

    // All tags across all orgs
    return await ctx.db
      .query("physicalTags")
      .order("desc")
      .collect();
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// GET PHYSICAL TAG BY UUID — public-facing lookup for the tap page
// Used by /t/[uuid] to detect if this is a cafe table tag.
// NO auth required — this is hit by anonymous NFC taps.
// ─────────────────────────────────────────────────────────────────────────────
export const getPhysicalTagByUUID = query({
  args: { uuid: v.string() },
  handler: async (ctx, args) => {
    const tag = await ctx.db
      .query("physicalTags")
      .withIndex("by_uuid", (q) => q.eq("volooTagsUUID", args.uuid))
      .unique();

    if (!tag) return null;

    // Resolve the org slug so the tap page can redirect to the correct cafe menu
    let orgSlug: string | null = null;
    if (tag.orgId) {
      const org = await ctx.db
        .query("organizations")
        .withIndex("by_clerk_id", (q) => q.eq("clerkId", tag.orgId!))
        .unique();
      orgSlug = org?.slug ?? null;
    }

    return {
      _id: tag._id,
      volooTagsUUID: tag.volooTagsUUID,
      isActive: tag.isActive,
      tableName: tag.tableName ?? null,
      seatNumber: tag.seatNumber ?? null,
      orgId: tag.orgId ?? null,
      orgSlug,
      tapCount: tag.tapCount,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// LOG TAP on a physical tag (increment tapCount)
// ─────────────────────────────────────────────────────────────────────────────
export const logPhysicalTagTap = mutation({
  args: { uuid: v.string() },
  handler: async (ctx, args) => {
    const tag = await ctx.db
      .query("physicalTags")
      .withIndex("by_uuid", (q) => q.eq("volooTagsUUID", args.uuid))
      .unique();

    if (!tag || !tag.isActive) return { success: false };

    await ctx.db.patch(tag._id, {
      tapCount: (tag.tapCount ?? 0) + 1,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE TAG UUID — reassign the hardware UUID (e.g. after re-programming)
// ─────────────────────────────────────────────────────────────────────────────
export const updateTagUUID = mutation({
  args: {
    tagId: v.id("physicalTags"),
    newUUID: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureSuperAdmin(ctx);

    const conflict = await ctx.db
      .query("physicalTags")
      .withIndex("by_uuid", (q) => q.eq("volooTagsUUID", args.newUUID))
      .unique();

    if (conflict && conflict._id !== args.tagId) {
      throw new ConvexError(`UUID "${args.newUUID}" is already assigned to another tag.`);
    }

    await ctx.db.patch(args.tagId, {
      volooTagsUUID: args.newUUID,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// ORG TAG SETTINGS — global NFC behavior per cafe
// ─────────────────────────────────────────────────────────────────────────────
export const getOrgTagSettings = query({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    await ensureAuthenticated(ctx);

    return await ctx.db
      .query("orgTagSettings")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .unique();
  },
});

// Public version — no auth required. Used by anonymous NFC taps to load
// the cafe's animation + hub theme for the customer-facing experience.
export const getOrgTagSettingsPublic = query({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("orgTagSettings")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .unique();
  },
});

export const upsertOrgTagSettings = mutation({
  args: {
    orgId: v.string(),
    activeMode: v.union(
      v.literal("digital_menu"),
      v.literal("call_waiter"),
      v.literal("payment_terminal"),
      v.literal("cafe_hub"),
    ),
    showAnimation: v.boolean(),
    selectedAnimation: v.string(),
    hubTheme: v.optional(v.string()),
    hubMenuUrl: v.optional(v.string()),
    wifiSsid: v.optional(v.string()),
    wifiPassword: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ensureSuperAdmin(ctx);

    const existing = await ctx.db
      .query("orgTagSettings")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .unique();

    const payload = {
      orgId: args.orgId,
      activeMode: args.activeMode,
      showAnimation: args.showAnimation,
      selectedAnimation: args.selectedAnimation,
      hubTheme: args.hubTheme,
      hubMenuUrl: args.hubMenuUrl,
      wifiSsid: args.wifiSsid,
      wifiPassword: args.wifiPassword,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
    } else {
      await ctx.db.insert("orgTagSettings", payload);
    }

    return { success: true };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL STATS — for the super-admin stats bar
// ─────────────────────────────────────────────────────────────────────────────
export const getPhysicalTagStats = query({
  args: {},
  handler: async (ctx) => {
    await ensureAuthenticated(ctx);

    const allTags = await ctx.db.query("physicalTags").collect();
    const activeTags = allTags.filter((t) => t.isActive);
    const totalTaps = allTags.reduce((sum, t) => sum + (t.tapCount ?? 0), 0);
    const unassignedTags = allTags.filter((t) => !t.orgId);

    return {
      totalTags: allTags.length,
      activeTags: activeTags.length,
      totalTaps,
      unassignedTags: unassignedTags.length,
    };
  },
});
