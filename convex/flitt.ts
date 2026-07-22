// convex/flitt.ts — Flitt payment gateway integration (hosted checkout).
//
// Flow:
//   1. Consumer app calls bagOrders.reserveBag → order in status "held".
//   2. Consumer app calls flitt.createCheckout({ orderId }) → { checkoutUrl }.
//   3. Browser redirects to Flitt's hosted checkout page.
//   4. Flitt POSTs the result to /flitt-callback (convex/http.ts), which
//      verifies the signature and confirms/cancels the order.
//
// API reference: https://docs.flitt.com/api/create-order/
// Signature:     https://docs.flitt.com/api/building-signature/
//   (plain SHA1 over "secret|v1|v2|..." with values of the non-empty params
//    sorted alphabetically by key — NOT HMAC. Verified against the official
//    Flitt node-js-sdk `genSignature` implementation.)

import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";

export const FLITT_API_BASE = "https://pay.flitt.com";

// Public Flitt TEST merchant credentials (documented at
// https://docs.flitt.com/api/testing/ — every Flitt docs example uses them).
// They only work in test mode; real credentials are supplied via:
//   npx convex env set FLITT_MERCHANT_ID <id>
//   npx convex env set FLITT_SECRET_KEY <key>
const TEST_MERCHANT_ID = "1549901";
const TEST_SECRET_KEY = "test";

export function getFlittMerchantId(): number {
  return Number.parseInt(process.env.FLITT_MERCHANT_ID ?? TEST_MERCHANT_ID, 10);
}

export function getFlittSecretKey(): string {
  return process.env.FLITT_SECRET_KEY ?? TEST_SECRET_KEY;
}

/**
 * Flitt request/callback signature.
 *
 * Algorithm (per docs + official SDK):
 *   1. Drop `signature` and `response_signature_string` keys.
 *   2. Drop params with empty/null/undefined values (no empty "|" slots).
 *   3. Sort remaining params alphabetically by key.
 *   4. Join the stringified VALUES with "|", prepending the secret key.
 *   5. SHA1 the UTF-8 bytes → lowercase hex (40 chars).
 */
export async function flittSignature(
  secretKey: string,
  params: Record<string, unknown>,
): Promise<string> {
  const parts: string[] = [secretKey];
  for (const key of Object.keys(params).sort()) {
    if (key === "signature" || key === "response_signature_string") continue;
    const value = params[key];
    if (value === undefined || value === null || value === "") continue;
    parts.push(String(value));
  }
  const bytes = new TextEncoder().encode(parts.join("|"));
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time hex-string comparison (avoids timing side-channels). */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: load + authorize the order for checkout (actions have no ctx.db)
// ─────────────────────────────────────────────────────────────────────────────

export const getOrderForCheckout = internalQuery({
  args: {
    orderId: v.id("bagOrders"),
    callerSubject: v.string(), // Clerk user id of the caller (identity.subject)
  },
  handler: async (
    ctx,
    { orderId, callerSubject },
  ): Promise<{ totalAmount: number; quantity: number; bagTitle: string }> => {
    const order = await ctx.db.get(orderId);
    if (!order) throw new ConvexError("Order not found.");

    // Ownership: the calling user must be the buyer.
    if (!order.buyerUserId) throw new ConvexError("Order has no buyer account.");
    const buyer = await ctx.db.get(order.buyerUserId);
    if (!buyer || buyer.externalId !== callerSubject) {
      throw new ConvexError("You do not own this order.");
    }

    if (order.status !== "held") {
      throw new ConvexError(
        `Order is "${order.status}" — payment can only start on a held order.`,
      );
    }
    if ((order.holdExpiresAt ?? 0) < Date.now()) {
      throw new ConvexError("Your reservation expired — please reserve again.");
    }

    const bag = await ctx.db.get(order.bagId);
    const title = bag
      ? (bag.title["en"] ?? bag.title["ka"] ?? Object.values(bag.title)[0])
      : undefined;

    return {
      totalAmount: order.totalAmount, // tetri (GEL minor units)
      quantity: order.quantity,
      bagTitle: title ?? "Surprise Bag",
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Public action: create a hosted-checkout URL for a held order
// ─────────────────────────────────────────────────────────────────────────────

export const createCheckout = action({
  args: { orderId: v.id("bagOrders") },
  handler: async (ctx, { orderId }): Promise<{ checkoutUrl: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Unauthenticated: sign in to pay.");

    const order = await ctx.runQuery(internal.flitt.getOrderForCheckout, {
      orderId,
      callerSubject: identity.subject,
    });

    // CONVEX_SITE_URL is provided by Convex — it is the deployment's HTTP
    // actions origin (https://<deployment>.convex.site).
    const siteUrl = process.env.CONVEX_SITE_URL;
    if (!siteUrl) throw new ConvexError("CONVEX_SITE_URL is not configured.");
    const consumerUrl = process.env.CONSUMER_URL ?? "http://localhost:3000";

    const params: Record<string, string | number> = {
      version: "1.0.1",
      order_id: `bag_${orderId}`, // namespaced; mapped back in the callback
      currency: "GEL",
      merchant_id: getFlittMerchantId(),
      order_desc: `${order.bagTitle} x${order.quantity}`,
      amount: order.totalAmount, // tetri — Flitt expects minor units
      response_url: `${consumerUrl}/en/orders`,
      server_callback_url: `${siteUrl}/flitt-callback`,
    };
    const signature = await flittSignature(getFlittSecretKey(), params);

    let res: Response;
    try {
      res = await fetch(`${FLITT_API_BASE}/api/checkout/url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: { ...params, signature } }),
      });
    } catch (e) {
      throw new ConvexError("Could not reach the payment gateway. Try again.");
    }
    if (!res.ok) {
      throw new ConvexError(`Payment gateway error (HTTP ${res.status}).`);
    }

    const json: {
      response?: {
        response_status?: string;
        checkout_url?: string;
        error_code?: number | string;
        error_message?: string;
      };
    } = await res.json();
    const resp = json.response;
    if (!resp || resp.response_status !== "success" || !resp.checkout_url) {
      throw new ConvexError(
        `Flitt rejected the checkout (${resp?.error_code ?? "?"}): ${
          resp?.error_message ?? "unknown error"
        }`,
      );
    }

    return { checkoutUrl: resp.checkout_url };
  },
});
