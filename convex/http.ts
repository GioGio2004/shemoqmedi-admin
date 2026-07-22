// convex/http.ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { validateClerkWebhook } from "./lib/utils";
import { ConvexError } from "convex/values";
import { Id } from "./_generated/dataModel";
import {
  flittSignature,
  getFlittSecretKey,
  timingSafeEqualHex,
} from "./flitt";

const http = httpRouter();

http.route({
  path: "/clerk-users-webhook", // You can keep this path name, it handles all Clerk events
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const event = await validateClerkWebhook(request);

    if (!event) {
      console.error("❌ Invalid webhook signature");
      return new Response("Unauthorized", { status: 401 });
    }

    console.log(`📨 Received Clerk webhook: ${event.type}`);

    try {
      switch (event.type) {
        // --- USER EVENTS ---
        case "user.created":
        case "user.updated":
          await ctx.runMutation(internal.users.upsertFromClerk, {
            data: event.data,
          });

          // ── Race-condition fix ─────────────────────────────────────────
          // organizationMembership.created may fire BEFORE user.created
          // arrives and creates the Convex user record, causing the
          // membership to be silently skipped. By fetching and upserting the
          // user's memberships right here (after we know the user exists) we
          // guarantee they are always written, regardless of event order.
          if (event.type === "user.created") {
            try {
              const clerkUserId = event.data.id as string;
              const membershipsRes = await fetch(
                `https://api.clerk.com/v1/users/${clerkUserId}/organization_memberships?limit=100`,
                {
                  headers: {
                    Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
                    "Content-Type": "application/json",
                  },
                }
              );

              if (membershipsRes.ok) {
                const { data: memberships } = await membershipsRes.json();
                console.log(
                  `🔗 Syncing ${memberships.length} membership(s) for new user ${clerkUserId}`
                );
                for (const m of memberships) {
                  await ctx.runMutation(internal.memberships.upsertFromClerk, {
                    clerkUserId,
                    orgId: m.organization.id,
                    role: m.role,
                  });
                }
              } else {
                console.warn(
                  `⚠️ Could not fetch memberships for ${clerkUserId}: ${membershipsRes.status}`
                );
              }
            } catch (e) {
              // Non-fatal — the membership webhook may still arrive successfully
              console.warn("⚠️ Failed to backfill memberships on user.created:", e);
            }
          }
          break;
        case "user.deleted":
          await ctx.runMutation(internal.users.deleteFromClerk, {
            clerkUserId: event.data.id!,
          });
          break;

        // --- ORGANIZATION EVENTS ---
        case "organization.created":
        case "organization.updated":
          await ctx.runMutation(internal.organizations.upsertFromClerk, {
            data: event.data,
          });

          // Auto-create a draft venue for brand-new organizations.
          // Idempotent — the mutation skips if a venue already exists for the org.
          if (event.type === "organization.created") {
            try {
              await ctx.runMutation(internal.venues.createDraftForOrg, {
                orgId: event.data.id as string,
                slug: (event.data as { slug?: string }).slug ?? "",
                name: (event.data as { name?: string }).name ?? "New Venue",
              });
            } catch (e) {
              // Non-fatal — venue can be backfilled later
              console.warn("⚠️ Failed to auto-create draft venue:", e);
            }
          }
          break;
        case "organization.deleted":
          await ctx.runMutation(internal.organizations.deleteFromClerk, {
            clerkId: event.data.id!,
          });
          break;

        // --- MEMBERSHIP EVENTS ---
        case "organizationMembership.created":
        case "organizationMembership.updated":
          await ctx.runMutation(internal.memberships.upsertFromClerk, {
            clerkUserId: event.data.public_user_data.user_id,
            orgId: event.data.organization.id,
            role: event.data.role,
          });
          break;
        case "organizationMembership.deleted":
          await ctx.runMutation(internal.memberships.deleteFromClerk, {
            clerkUserId: event.data.public_user_data.user_id,
            orgId: event.data.organization.id,
          });
          break;
      }

      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("❌ Error processing Clerk webhook:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// ONE-TIME BACKFILL: GET /sync-memberships?secret=<SYNC_SECRET>
//
// Hit this endpoint once to pull ALL existing Clerk organization memberships
// into the Convex memberships table. Useful when the webhook was not set up
// before members joined, or for testing.
//
// Protect it with a query-string secret stored in your Convex environment:
//   npx convex env set SYNC_SECRET any-random-string-you-choose
// ─────────────────────────────────────────────────────────────────────────────
http.route({
  path: "/sync-memberships",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const secret = url.searchParams.get("secret");

    if (!secret || secret !== process.env.SYNC_SECRET) {
      return new Response("Forbidden", { status: 403 });
    }

    const clerkSecretKey = process.env.CLERK_SECRET_KEY;
    if (!clerkSecretKey) {
      return new Response("CLERK_SECRET_KEY not set", { status: 500 });
    }

    let synced = 0;
    let skipped = 0;
    let page = 1;
    const limit = 100;

    while (true) {
      const res = await fetch(
        `https://api.clerk.com/v1/organization_memberships?limit=${limit}&offset=${(page - 1) * limit}`,
        {
          headers: {
            Authorization: `Bearer ${clerkSecretKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!res.ok) {
        const text = await res.text();
        console.error("❌ Clerk API error:", res.status, text);
        return new Response(`Clerk API error: ${res.status}`, { status: 502 });
      }

      const json = await res.json();
      const memberships: any[] = json.data ?? [];

      if (memberships.length === 0) break;

      for (const m of memberships) {
        const clerkUserId: string = m.public_user_data?.user_id;
        const orgId: string = m.organization?.id;
        const role: string = m.role;

        if (!clerkUserId || !orgId || !role) {
          console.warn("⚠️ Skipping incomplete membership record:", m);
          skipped++;
          continue;
        }

        try {
          await ctx.runMutation(internal.memberships.upsertFromClerk, {
            clerkUserId,
            orgId,
            role,
          });
          synced++;
          console.log(`✅ Synced: ${clerkUserId} → ${orgId} (${role})`);
        } catch (e) {
          console.error(`❌ Failed to sync ${clerkUserId} → ${orgId}:`, e);
          skipped++;
        }
      }

      if (memberships.length < limit) break;
      page++;
    }

    return new Response(
      JSON.stringify({ synced, skipped }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// FLITT PAYMENT CALLBACK: POST /flitt-callback
//
// Flitt POSTs the payment result here (server_callback_url set by
// flitt.createCheckout). The payload is signed with the merchant secret key —
// signature verification is the trust boundary (never trust unsigned data).
// Flitt expects HTTP 200 within 30s; on non-200 it retries at
// 2s, 60s, 300s, 600s, 1h, 24h. Docs: https://docs.flitt.com/api/callbacks/
// ─────────────────────────────────────────────────────────────────────────────
http.route({
  path: "/flitt-callback",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // 1. Parse defensively by content-type (docs say JSON; Fondy-lineage
    //    gateways have historically also sent form-encoded bodies).
    let payload: Record<string, unknown>;
    try {
      const contentType = request.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        payload = await request.json();
      } else {
        const text = await request.text();
        payload = Object.fromEntries(new URLSearchParams(text));
      }
    } catch (e) {
      console.error("❌ Flitt callback: unparseable body", e);
      return new Response("Bad Request", { status: 400 });
    }
    // Some gateway configs wrap the callback in a "response" root object.
    if (
      payload &&
      typeof payload === "object" &&
      typeof (payload as Record<string, unknown>)["response"] === "object" &&
      (payload as Record<string, unknown>)["response"] !== null
    ) {
      payload = (payload as Record<string, unknown>)["response"] as Record<
        string,
        unknown
      >;
    }

    // 2. Verify signature: same algorithm as request signing — SHA1 over
    //    "secret|<non-empty values sorted by key>", excluding `signature`
    //    and `response_signature_string`. Reject on mismatch.
    const receivedSignature = String(payload["signature"] ?? "");
    if (!receivedSignature) {
      console.error("❌ Flitt callback: missing signature");
      return new Response("Missing signature", { status: 400 });
    }
    const expectedSignature = await flittSignature(getFlittSecretKey(), payload);
    if (!timingSafeEqualHex(expectedSignature, receivedSignature)) {
      console.error(
        "❌ Flitt callback: signature mismatch",
        JSON.stringify({
          order_id: payload["order_id"],
          // Flitt echoes the exact joined string (secret masked) for debugging:
          response_signature_string: payload["response_signature_string"],
        }),
      );
      return new Response("Invalid signature", { status: 400 });
    }

    // 3. Map Flitt's order_id back to our bagOrders id ("bag_" + Id).
    const flittOrderId = String(payload["order_id"] ?? "");
    if (!flittOrderId.startsWith("bag_")) {
      console.error(`⚠️ Flitt callback: unrecognized order_id "${flittOrderId}"`);
      return new Response("OK", { status: 200 }); // signed but not ours — stop retries
    }
    const orderId = flittOrderId.slice("bag_".length) as Id<"bagOrders">;
    const orderStatus = String(payload["order_status"] ?? "");
    const flittPaymentId =
      payload["payment_id"] !== undefined && payload["payment_id"] !== null
        ? String(payload["payment_id"])
        : undefined;

    console.log(
      `💳 Flitt callback: ${flittOrderId} → ${orderStatus}` +
        (flittPaymentId ? ` (payment_id ${flittPaymentId})` : ""),
    );

    // 4. Act on the order status. Handlers are idempotent — Flitt may send
    //    multiple callbacks (e.g. "processing" then "approved") and retries.
    try {
      if (orderStatus === "approved") {
        await ctx.runMutation(internal.bagOrders.confirmPayment, {
          orderId,
          flittOrderId,
          flittPaymentId,
        });
      } else if (orderStatus === "declined" || orderStatus === "expired") {
        await ctx.runMutation(internal.bagOrders.cancelHeldOrder, { orderId });
      } else {
        // created / processing / reversed / unknown — log only.
        console.log(
          `ℹ️ Flitt callback: no action for order_status "${orderStatus}" (${flittOrderId})`,
        );
      }
    } catch (e) {
      if (e instanceof ConvexError) {
        // Application-level conflict (e.g. payment approved after the hold
        // already expired and was cancelled). Retrying will not change the
        // outcome — log loudly for manual reconciliation and return 200.
        console.error(
          `🚨 Flitt callback: could not apply "${orderStatus}" to ${flittOrderId}: ${String(
            e.data ?? e.message,
          )}`,
        );
      } else {
        throw e; // transient/unexpected → 500 → Flitt retries
      }
    }

    return new Response("OK", { status: 200 });
  }),
});

export default http;
