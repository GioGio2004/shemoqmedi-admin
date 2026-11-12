import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { validateClerkWebhook } from "./lib/utils";
import { escapeHtml } from "./lib/email";
import { verifyUnsubscribeToken } from "./lib/tokens";

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

// Unsubscribe links from studio, outreach and broadcast emails (emails.ts):
//   GET  /unsubscribe?e=<email>&t=<token>  a page with one button (link
//        scanners that open the URL don't unsubscribe anyone)
//   POST /unsubscribe?e=&t=                the button, and mail apps'
//        one-click List-Unsubscribe-Post
// The token is an HMAC of the address (lib/tokens.ts), so nobody can
// unsubscribe somebody else.

function page(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
      `<body style="margin:0;font-family:Inter,Arial,sans-serif;background:#fff;color:#000"><main style="max-width:480px;margin:18vh auto;padding:0 24px">` +
      `<p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#777">Shemoqmedi</p><h1 style="font-size:28px;font-weight:600;margin:8px 0 16px">${title}</h1>${body}</main></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

async function checkUnsubscribe(request: Request) {
  const url = new URL(request.url);
  const email = (url.searchParams.get("e") ?? "").trim().toLowerCase();
  const token = url.searchParams.get("t") ?? "";
  const ok = email !== "" && (await verifyUnsubscribeToken(email, token));
  return { email, ok, url };
}

http.route({
  path: "/unsubscribe",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const { email, ok, url } = await checkUnsubscribe(request);
    if (!ok) return page("Link not valid", "<p>This unsubscribe link is broken or incomplete. Reply to any of our emails and we'll take you off the list.</p>", 400);
    return page(
      "Unsubscribe",
      `<p>Stop all emails from Shemoqmedi to <strong>${escapeHtml(email)}</strong>?</p>` +
        `<form method="post" action="${escapeHtml(url.pathname + url.search)}"><button style="background:#000;color:#fff;border:0;border-radius:999px;padding:12px 22px;font-weight:600;cursor:pointer">Unsubscribe</button></form>`,
    );
  }),
});

http.route({
  path: "/unsubscribe",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const { email, ok } = await checkUnsubscribe(request);
    if (!ok) return page("Link not valid", "<p>This unsubscribe link is broken or incomplete.</p>", 400);
    await ctx.runMutation(internal.emails.optOut, { email });
    return page("You're unsubscribed", `<p>We won't email <strong>${escapeHtml(email)}</strong> again.</p>`);
  }),
});

export default http;
