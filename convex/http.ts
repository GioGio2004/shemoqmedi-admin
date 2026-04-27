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

export default http;
