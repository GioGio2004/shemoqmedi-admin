import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const placeOrder = mutation({
  args: {
    cafeId: v.string(),
    seatNumber: v.number(),
    items: v.array(
      v.object({
        productId: v.number(),
        name: v.string(),
        price: v.number(),
        quantity: v.number(),
      })
    ),
    totalPrice: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("tableOrders", {
      cafeId: args.cafeId,
      seatNumber: args.seatNumber,
      items: args.items,
      totalPrice: args.totalPrice,
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
    await ctx.db.patch(args.orderId, { status: args.status });
  },
});
