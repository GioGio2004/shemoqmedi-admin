import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/**
 * Syncs a Clerk organizationMembership.created / organizationMembership.updated
 * event into the Convex `memberships` table.
 *
 * We resolve the Convex user ID from the Clerk user ID so the memberships table
 * always stores typed `v.id("users")` references — never raw Clerk strings.
 */
export const upsertFromClerk = internalMutation({
  args: {
    clerkUserId: v.string(), // e.g. "user_2abc..."
    orgId: v.string(),       // Clerk org ID, e.g. "org_2xyz..."
    role: v.string(),        // e.g. "org:admin", "org:member"
  },
  handler: async (ctx, { clerkUserId, orgId, role }) => {
    // 1. Resolve the Convex user document from the Clerk external ID
    const user = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", clerkUserId))
      .unique();

    if (!user) {
      // The user.created webhook fires before organizationMembership.created,
      // but race conditions can happen. Log and bail gracefully.
      console.warn(
        `⚠️ upsertMembership: No Convex user found for Clerk ID ${clerkUserId}. Skipping.`
      );
      return null;
    }

    // 2. Check for an existing membership record for this user+org pair
    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_user_and_org", (q) =>
        q.eq("userId", user._id).eq("orgId", orgId)
      )
      .unique();

    if (existing === null) {
      console.log(`✅ Creating membership: ${user.email} → ${orgId} (${role})`);
      await ctx.db.insert("memberships", {
        userId: user._id,
        orgId,
        role,
      });
    } else {
      // Role may have changed (e.g. promoted from member → admin)
      console.log(`📝 Updating membership role: ${user.email} → ${role}`);
      await ctx.db.patch(existing._id, { role });
    }

    return null;
  },
});

/**
 * Removes a membership record when Clerk fires organizationMembership.deleted.
 */
export const deleteFromClerk = internalMutation({
  args: {
    clerkUserId: v.string(),
    orgId: v.string(),
  },
  handler: async (ctx, { clerkUserId, orgId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", clerkUserId))
      .unique();

    if (!user) {
      console.warn(
        `⚠️ deleteMembership: No Convex user found for Clerk ID ${clerkUserId}. Nothing to delete.`
      );
      return null;
    }

    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_user_and_org", (q) =>
        q.eq("userId", user._id).eq("orgId", orgId)
      )
      .unique();

    if (membership !== null) {
      console.log(`🗑️ Deleting membership: ${user.email} ← ${orgId}`);
      await ctx.db.delete(membership._id);
    } else {
      console.warn(
        `⚠️ deleteMembership: Membership not found for ${user.email} in org ${orgId}.`
      );
    }

    return null;
  },
});
