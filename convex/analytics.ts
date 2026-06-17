import { v } from "convex/values";
import { query } from "./_generated/server";

export const getOverviewStats = query({
  args: { orgId: v.string() },
  handler: async (ctx, args) => {
    // Identity verification (Dashboard uses Clerk, so we just verify identity exists)
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthenticated call to analytics");
    }

    // 1. Resolve Organization
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.orgId))
      .unique();

    if (!org) {
      return null;
    }

    const slug = org.slug;

    // 2. Menu Items
    const menuItems = await ctx.db
      .query("menuItems")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const activeMenuItemsCount = menuItems.filter((i) => i.isAvailable).length;

    // 3. Open Orders (Combining tableOrders and orders)
    const pendingOrders = await ctx.db
      .query("orders")
      .withIndex("by_org_and_status", (q) => q.eq("orgId", args.orgId).eq("status", "pending"))
      .collect();
    const preparingOrders = await ctx.db
      .query("orders")
      .withIndex("by_org_and_status", (q) => q.eq("orgId", args.orgId).eq("status", "preparing"))
      .collect();
    
    const pendingTableOrders = await ctx.db
      .query("tableOrders")
      .withIndex("by_cafe", (q) => q.eq("cafeId", slug))
      .collect();
    
    // Filter tableOrders that are still active
    const activeTableOrders = pendingTableOrders.filter(o => o.status === "pending").length;

    const openOrdersCount = pendingOrders.length + preparingOrders.length + activeTableOrders;

    // 4. Online Tags
    const physicalTags = await ctx.db
      .query("physicalTags")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const activeTagsCount = physicalTags.filter((t) => t.isActive).length;

    // 5. AI Analytics
    // Sessions
    const chatSessions = await ctx.db
      .query("chatSessions")
      .withIndex("byCafeId", (q) => q.eq("cafeId", slug))
      .collect();
    
    // Messages
    // Doing a full filter here as there's no index purely on cafeId for messages
    const chatMessages = await ctx.db
      .query("chatMessages")
      .filter((q) => q.eq(q.field("cafeId"), slug))
      .collect();

    // Ratings
    const chatRatings = await ctx.db
      .query("chatRatings")
      .withIndex("byCafeId", (q) => q.eq("cafeId", slug))
      .collect();

    const totalRatings = chatRatings.reduce((sum, r) => sum + r.rating, 0);
    const averageRating = chatRatings.length > 0 ? (totalRatings / chatRatings.length).toFixed(1) : "—";

    return {
      orgName: org.name,
      activeMenuItemsCount,
      openOrdersCount,
      activeTagsCount,
      aiAnalytics: {
        totalSessions: chatSessions.length,
        totalMessages: chatMessages.length,
        averageRating: averageRating,
      }
    };
  },
});
