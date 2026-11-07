import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { validateClerkWebhook } from "./lib/utils";

const http = httpRouter();

// Clerk → Convex user sync. Point the Clerk webhook endpoint at
//   https://<deployment>.convex.site/clerk-users-webhook
// and set CLERK_WEBHOOK_SECRET on the Convex deployment.
http.route({
  path: "/clerk-users-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const event = await validateClerkWebhook(request);
    if (!event) return new Response("Unauthorized", { status: 401 });

    try {
      switch (event.type) {
        case "user.created":
        case "user.updated":
          await ctx.runMutation(internal.users.upsertFromClerk, {
            data: event.data,
          });
          break;
        case "user.deleted":
          if (event.data.id) {
            await ctx.runMutation(internal.users.deleteFromClerk, {
              clerkUserId: event.data.id,
            });
          }
          break;
        default:
          // Other events (organizations, sessions, …) are acknowledged so
          // Clerk does not keep retrying them.
          break;
      }
      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("Error processing Clerk webhook:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  }),
});

export default http;
