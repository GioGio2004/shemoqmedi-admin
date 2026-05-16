// convex/http.ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { validateClerkWebhook } from "./lib/utils";

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

export default http;
