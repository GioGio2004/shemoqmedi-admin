/**
 * One-time admin utilities.
 * Used to seed roles and inspect data. Safe to keep — all mutations
 * are unguarded on purpose (run from trusted CLI only, never from the browser).
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ── 1. Sync a specific membership ────────────────────────────────────────────
export const syncMembership = mutation({
  args: {
    clerkUserId: v.string(),
    orgId: v.string(),
    role: v.string(),
  },
  handler: async (ctx, { clerkUserId, orgId, role }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", clerkUserId))
      .unique();

    if (!user) {
      throw new Error(`No Convex user found for Clerk ID: ${clerkUserId}.`);
    }

    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_user_and_org", (q) =>
        q.eq("userId", user._id).eq("orgId", orgId)
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { role });
      return { action: "updated", email: user.email, orgId, role };
    } else {
      await ctx.db.insert("memberships", { userId: user._id, orgId, role });
      return { action: "created", email: user.email, orgId, role };
    }
  },
});

// ── 2. Set platform role (e.g. super_admin) on a user ────────────────────────
export const setRole = mutation({
  args: {
    clerkUserId: v.string(),
    role: v.string(), // "super_admin" | "admin" | etc.
  },
  handler: async (ctx, { clerkUserId, role }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", clerkUserId))
      .unique();

    if (!user) {
      throw new Error(`No Convex user found for Clerk ID: ${clerkUserId}.`);
    }

    await ctx.db.patch(user._id, { role });
    return { action: "role_set", email: user.email, role };
  },
});

// ── 3. List all users (to find your Clerk user ID) ───────────────────────────
export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return users.map((u) => ({
      externalId: u.externalId,
      email: u.email,
      name: u.name,
      role: u.role ?? null,
    }));
  },
});
