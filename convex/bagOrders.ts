import { mutation, query, internalMutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { requireUser, verifyOrgAccess } from "./authHelpers";

const HOLD_MS = 2 * 60 * 1000; // 2-minute inventory hold during checkout
const COMMISSION_RATE = 0; // free for venues at launch — field baked in from day one

/** Unambiguous pickup code alphabet (no 0/O, 1/I). */
function makePickupCode(seed: number): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  let n = seed;
  for (let i = 0; i < 4; i++) {
    code += chars[n % chars.length];
    n = Math.floor(n / chars.length) + 7 * i;
  }
  return code;
}

/**
 * Release expired holds for a bag and return the truly available quantity.
 * Called inline (Convex mutations are transactional) rather than by cron so
 * availability is always correct at read-modify time.
 */
async function releaseExpiredHolds(ctx: any, bagId: string) {
  const now = Date.now();
  const held = await ctx.db
    .query("bagOrders")
    .withIndex("by_bag", (q: any) => q.eq("bagId", bagId))
    .collect();
  for (const order of held) {
    if (order.status === "held" && (order.holdExpiresAt ?? 0) < now) {
      await ctx.db.patch(order._id, { status: "cancelled", updatedAt: now });
      const bag = await ctx.db.get(order.bagId);
      if (bag) {
        await ctx.db.patch(order.bagId, {
          quantityLeft: (bag.quantityLeft ?? 0) + order.quantity,
          status: bag.status === "sold_out" ? "active" : bag.status,
          updatedAt: now,
        });
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Consumer side
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reserve a bag: places a 2-minute inventory hold while the buyer pays.
 * Signed-in users only (payment requires an account).
 */
export const reserveBag = mutation({
  args: {
    bagId: v.id("surpriseBags"),
    quantity: v.number(),
    fulfillmentType: v.union(v.literal("pickup"), v.literal("delivery")),
    deliveryAddress: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    if (args.quantity < 1 || args.quantity > 5) {
      throw new ConvexError("Quantity must be between 1 and 5.");
    }
    await releaseExpiredHolds(ctx, args.bagId);

    const bag = await ctx.db.get(args.bagId);
    const now = Date.now();
    if (!bag || bag.isTemplate || bag.status !== "active" || (bag.pickupEnd ?? 0) < now) {
      throw new ConvexError("This bag is no longer available.");
    }
    const left = bag.quantityLeft ?? 0;
    if (left < args.quantity) {
      throw new ConvexError(`Only ${left} left.`);
    }
    if (args.fulfillmentType === "delivery" && !args.deliveryAddress) {
      throw new ConvexError("Delivery address required.");
    }

    const totalAmount = bag.price * args.quantity;
    const commissionAmount = Math.round(totalAmount * COMMISSION_RATE);

    const newLeft = left - args.quantity;
    await ctx.db.patch(args.bagId, {
      quantityLeft: newLeft,
      status: newLeft === 0 ? "sold_out" : "active",
      updatedAt: now,
    });

    return await ctx.db.insert("bagOrders", {
      orgId: bag.orgId,
      bagId: args.bagId,
      buyerUserId: user._id,
      quantity: args.quantity,
      unitPrice: bag.price,
      totalAmount,
      commissionRate: COMMISSION_RATE,
      commissionAmount,
      status: "held",
      holdExpiresAt: now + HOLD_MS,
      fulfillmentType: args.fulfillmentType,
      deliveryAddress: args.deliveryAddress,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Confirm payment. Called by the Flitt server callback handler (internal)
 * once Flitt reports the charge succeeded. Generates the pickup code.
 */
export const confirmPayment = internalMutation({
  args: {
    orderId: v.id("bagOrders"),
    flittOrderId: v.string(),
    flittPaymentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    if (!order) throw new ConvexError("Order not found.");

    // Already-processed / terminal → idempotent. Flitt retries callbacks and
    // may send "processing" then "approved"; never re-issue a code or re-charge.
    if (
      order.status === "paid" ||
      order.status === "ready" ||
      order.status === "collected" ||
      order.status === "delivered" ||
      order.status === "refunded"
    ) {
      return order.pickupCode;
    }

    const now = Date.now();
    const pickupCode = order.pickupCode ?? makePickupCode(now % 1048576);

    // MONEY-SAFETY: an "approved" callback can arrive AFTER the 2-minute hold
    // expired and releaseExpiredHolds already flipped this order to "cancelled"
    // and restocked the bag. The customer WAS charged by Flitt — we must never
    // keep the money without issuing a pickup code. Honor the order: re-claim
    // one unit of the stock we handed back (clamped at 0 — if the bag truly
    // sold out to someone else in the gap, the venue honors one extra bag; the
    // http callback logs this loudly for reconciliation).
    if (order.status === "cancelled") {
      const bag = await ctx.db.get(order.bagId);
      if (bag) {
        const newLeft = Math.max(0, (bag.quantityLeft ?? 0) - order.quantity);
        await ctx.db.patch(order.bagId, {
          quantityLeft: newLeft,
          status:
            bag.status === "active" && newLeft === 0 ? "sold_out" : bag.status,
          updatedAt: now,
        });
      }
    }

    await ctx.db.patch(args.orderId, {
      status: "paid",
      pickupCode,
      flittOrderId: args.flittOrderId,
      flittPaymentId: args.flittPaymentId,
      paidAt: now,
      holdExpiresAt: undefined,
      updatedAt: now,
    });
    return pickupCode;
  },
});

/**
 * Cancel a held order and restock the bag. Called by the Flitt callback
 * handler when payment is declined or the checkout expires. Idempotent —
 * no-op unless the order is still "held" (already cancelled/paid orders are
 * left untouched). Mirrors the releaseExpiredHolds restock logic.
 */
export const cancelHeldOrder = internalMutation({
  args: { orderId: v.id("bagOrders") },
  handler: async (ctx, { orderId }) => {
    const order = await ctx.db.get(orderId);
    if (!order || order.status !== "held") return; // idempotent no-op
    const now = Date.now();
    await ctx.db.patch(orderId, { status: "cancelled", updatedAt: now });
    const bag = await ctx.db.get(order.bagId);
    if (bag) {
      await ctx.db.patch(order.bagId, {
        quantityLeft: (bag.quantityLeft ?? 0) + order.quantity,
        status: bag.status === "sold_out" ? "active" : bag.status,
        updatedAt: now,
      });
    }
  },
});

/**
 * Single order for the buyer — powers the post-payment orders screen polling.
 * Returns null unless the calling user owns the order.
 */
export const getOrder = query({
  args: { orderId: v.id("bagOrders") },
  handler: async (ctx, { orderId }) => {
    const user = await requireUser(ctx);
    const order = await ctx.db.get(orderId);
    if (!order || order.buyerUserId !== user._id) return null;
    return order;
  },
});

/** Buyer's order history + active pickup codes. */
export const listMyOrders = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const orders = await ctx.db
      .query("bagOrders")
      .withIndex("by_buyer", (q) => q.eq("buyerUserId", user._id))
      .order("desc")
      .take(50);
    const results = [];
    for (const order of orders) {
      const bag = await ctx.db.get(order.bagId);
      const venue = bag
        ? await ctx.db
            .query("venues")
            .withIndex("by_org", (q) => q.eq("orgId", bag.orgId))
            .first()
        : null;
      results.push({
        ...order,
        bag: bag
          ? { title: bag.title, imageUrl: bag.imageUrl, pickupStart: bag.pickupStart, pickupEnd: bag.pickupEnd }
          : null,
        venue: venue ? { name: venue.name, slug: venue.slug, address: venue.address } : null,
      });
    }
    return results;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Venue side
// ─────────────────────────────────────────────────────────────────────────────

/** Realtime incoming orders for the venue dashboard. */
export const listOrgOrders = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await verifyOrgAccess(ctx, orgId);
    const orders = await ctx.db
      .query("bagOrders")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(100);
    const visible = orders.filter((o) => o.status !== "held" && o.status !== "cancelled");
    const results = [];
    for (const order of visible) {
      const bag = await ctx.db.get(order.bagId);
      const buyer = order.buyerUserId ? await ctx.db.get(order.buyerUserId) : null;
      results.push({
        ...order,
        bagTitle: bag?.title,
        buyerName: buyer ? `${buyer.name} ${buyer.lastname ?? ""}`.trim() : "Guest",
      });
    }
    return results;
  },
});

/** Redeem a pickup code at the counter → mark collected. */
export const redeemPickupCode = mutation({
  args: { orgId: v.string(), code: v.string() },
  handler: async (ctx, { orgId, code }) => {
    await verifyOrgAccess(ctx, orgId);
    const order = await ctx.db
      .query("bagOrders")
      .withIndex("by_pickup_code", (q) =>
        q.eq("orgId", orgId).eq("pickupCode", code.trim().toUpperCase()),
      )
      .unique();
    if (!order) throw new ConvexError("Code not found.");
    if (order.status === "collected") throw new ConvexError("Already collected.");
    if (order.status !== "paid" && order.status !== "ready") {
      throw new ConvexError(`Order is "${order.status}" — cannot redeem.`);
    }
    await ctx.db.patch(order._id, { status: "collected", updatedAt: Date.now() });
    return order._id;
  },
});

/** Manager updates order status (ready / no_show). */
export const updateOrderStatus = mutation({
  args: {
    orgId: v.string(),
    orderId: v.id("bagOrders"),
    status: v.union(v.literal("ready"), v.literal("collected"), v.literal("no_show")),
  },
  handler: async (ctx, { orgId, orderId, status }) => {
    await verifyOrgAccess(ctx, orgId);
    const order = await ctx.db.get(orderId);
    if (!order || order.orgId !== orgId) throw new ConvexError("Order not found.");
    if (order.status !== "paid" && order.status !== "ready") {
      throw new ConvexError(`Cannot move order from "${order.status}".`);
    }
    await ctx.db.patch(orderId, { status, updatedAt: Date.now() });
  },
});
