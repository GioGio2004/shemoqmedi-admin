import { Webhook } from "svix";
import type { WebhookEvent } from "@clerk/backend";

/** Verifies a Clerk (Svix-signed) webhook request. Returns null if invalid. */
export async function validateClerkWebhook(
  request: Request,
): Promise<WebhookEvent | null> {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("CLERK_WEBHOOK_SECRET is not set on this Convex deployment");
    return null;
  }

  try {
    const payload = await request.text();
    const headers = {
      "svix-id": request.headers.get("svix-id") ?? "",
      "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
      "svix-signature": request.headers.get("svix-signature") ?? "",
    };
    return new Webhook(webhookSecret).verify(payload, headers) as WebhookEvent;
  } catch (error) {
    console.error("Clerk webhook verification failed:", error);
    return null;
  }
}
