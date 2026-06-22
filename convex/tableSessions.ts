import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { verifyOrgAccess } from "./authHelpers";

export const joinSession = mutation({
  args: {
    orgId: v.string(),
    tagId: v.id("physicalTags"),
    guestId: v.string(),
  },
  handler: async (ctx, args) => {
    const physicalTag = await ctx.db.get(args.tagId);
    if (!physicalTag) {
      throw new Error("Physical tag not found");
    }

    if (physicalTag.currentSessionId) {
      const session = await ctx.db.get(physicalTag.currentSessionId);
      if (session && session.status === "active") {
        if (!session.activeGuestIds.includes(args.guestId)) {
          await ctx.db.patch(session._id, {
            activeGuestIds: [...session.activeGuestIds, args.guestId],
            updatedAt: Date.now(),
          });
        }
        return session._id;
      }
    }

    const newSessionId = await ctx.db.insert("tableSessions", {
      orgId: args.orgId,
      tagId: args.tagId,
      status: "active",
      activeGuestIds: [args.guestId],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    await ctx.db.patch(args.tagId, {
      currentSessionId: newSessionId,
      updatedAt: Date.now(),
    });

    return newSessionId;
  },
});

export const freeTable = mutation({
  args: {
    sessionId: v.id("tableSessions"),
    tagId: v.id("physicalTags"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) {
      throw new Error("Session not found");
    }

    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", session.orgId))
      .unique();

    if (!org) {
      throw new Error("Organization not found");
    }

    await verifyOrgAccess(ctx, org.clerkId);

    await ctx.db.patch(args.sessionId, {
      status: "closed",
      updatedAt: Date.now(),
    });

    const physicalTag = await ctx.db.get(args.tagId);
    if (physicalTag && physicalTag.currentSessionId === args.sessionId) {
      await ctx.db.patch(args.tagId, {
        currentSessionId: undefined,
        updatedAt: Date.now(),
      });
    }
  },
});

export const getSession = query({
  args: { sessionId: v.optional(v.id("tableSessions")) },
  handler: async (ctx, args) => {
    if (!args.sessionId) return null;
    return await ctx.db.get(args.sessionId);
  },
});

export const getSessionOrders = query({
  args: { sessionId: v.optional(v.id("tableSessions")) },
  handler: async (ctx, args) => {
    if (!args.sessionId) return [];
    return await ctx.db
      .query("tableOrders")
      .filter((q) => q.eq(q.field("sessionId"), args.sessionId))
      .collect();
  },
});

export const broadcastSuggestion = mutation({
  args: {
    sessionId: v.id("tableSessions"),
    itemName: v.string(),
    suggestedBy: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      latestSuggestion: {
        itemName: args.itemName,
        suggestedBy: args.suggestedBy,
        timestamp: Date.now(),
      },
      updatedAt: Date.now(),
    });
  },
});

export const syncCart = mutation({
  args: {
    sessionId: v.id("tableSessions"),
    guestId: v.string(),
    items: v.array(v.object({
      id: v.string(),
      name: v.string(),
      price: v.number(),
      quantity: v.number(),
      image: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return;

    // Filter out old items from this guest, add their new items
    const existingCart = session.cartItems || [];
    const otherGuestsCart = existingCart.filter((item: any) => item.guestId !== args.guestId);
    
    const newGuestItems = args.items.map(item => ({ ...item, guestId: args.guestId }));

    await ctx.db.patch(args.sessionId, {
      cartItems: [...otherGuestsCart, ...newGuestItems],
      updatedAt: Date.now(),
    });
  },
});
