import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const createProfile = mutation({
  args: {
    guestId: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if the guest already exists to prevent duplicates
    const existing = await ctx.db
      .query("anonymous_guests")
      .withIndex("by_guestId", (q) => q.eq("guestId", args.guestId))
      .unique();

    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("anonymous_guests", {
      guestId: args.guestId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const updateNootype = mutation({
  args: {
    guestId: v.string(),
    savedNootype: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("anonymous_guests")
      .withIndex("by_guestId", (q) => q.eq("guestId", args.guestId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        savedNootype: args.savedNootype,
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    return null;
  },
});

export const getProfile = query({
  args: { guestId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("anonymous_guests")
      .withIndex("by_guestId", (q) => q.eq("guestId", args.guestId))
      .unique();
  },
});
