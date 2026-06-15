import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { verifyOrgAccess } from "./authHelpers";

function hashId(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export const placeOrder = mutation({
  args: {
    cafeId: v.string(),
    seatNumber: v.number(),
    items: v.array(
      v.object({
        productId: v.union(v.number(), v.string()),
        name: v.optional(v.string()),
        price: v.optional(v.number()),
        quantity: v.number(),
      })
    ),
    totalPrice: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Lookup the organization to get the internal clerkId (orgId)
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", args.cafeId))
      .unique();

    if (!org) {
      throw new Error(`Organization for cafeId "${args.cafeId}" not found.`);
    }

    // Fetch all menu items for this organization to securely verify prices
    const menuItems = await ctx.db
      .query("menuItems")
      .withIndex("by_org", (q) => q.eq("orgId", org.clerkId))
      .collect();

    // Build a map of both original Convex string IDs and their djb2 numeric hashes
    const priceMap = new Map<number | string, number>();
    for (const item of menuItems) {
      priceMap.set(item._id, item.price);
      priceMap.set(hashId(item._id), item.price);
    }

    let calculatedTotalPrice = 0;
    const verifiedItems = [];

    for (const item of args.items) {
      const actualPrice = priceMap.get(item.productId);

      if (actualPrice === undefined) {
        throw new Error(`Product ID ${item.productId} not found in this cafe's menu.`);
      }

      verifiedItems.push({
        productId: item.productId,
        name: item.name || "Unknown Item",
        price: actualPrice,
        quantity: item.quantity,
      });

      calculatedTotalPrice += actualPrice * item.quantity;
    }

    return await ctx.db.insert("tableOrders", {
      cafeId: args.cafeId,
      seatNumber: args.seatNumber,
      items: verifiedItems,
      totalPrice: calculatedTotalPrice,
      status: "pending",
      createdAt: Date.now(),
    });
  },
});

export const getOrders = query({
  args: {
    cafeId: v.string(),
  },
  handler: async (ctx, args) => {
    // 🔒 Tenant Isolation: Resolve slug to Clerk orgId
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", args.cafeId))
      .unique();

    if (!org) {
      throw new Error(`Organization for cafeId "${args.cafeId}" not found.`);
    }

    // Ensure the caller is an authenticated staff member of this org
    await verifyOrgAccess(ctx, org.clerkId);

    return await ctx.db
      .query("tableOrders")
      .withIndex("by_cafe", (q) => q.eq("cafeId", args.cafeId))
      .order("desc")
      .collect();
  },
});

export const updateOrderStatus = mutation({
  args: {
    orderId: v.id("tableOrders"),
    status: v.union(v.literal("pending"), v.literal("completed"), v.literal("cancelled")),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new Error("Order not found");

    // 🔒 Tenant Isolation: Resolve slug to Clerk orgId
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", order.cafeId))
      .unique();
      
    if (!org) throw new Error("Organization not found");

    await verifyOrgAccess(ctx, org.clerkId);

    await ctx.db.patch(args.orderId, { status: args.status });
  },
});
