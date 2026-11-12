"use node";

// The web-push transport, in the Node runtime because the web-push package
// needs Node's crypto. Only sends: choosing who gets a push and cleaning up
// dead subscriptions happen in convex/push.ts (default runtime), so this
// file never touches the database.

import webpush from "web-push";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { isGone, vapidConfig } from "./lib/push";

// A notification nobody saw within a day is stale (a reminder, a failed post).
const TTL_SECONDS = 24 * 60 * 60;

type Outcome = { endpoint: string; ok: boolean; gone: boolean };

/** The HTTP status a failed send carries (web-push's WebPushError), if any. */
function statusOf(error: unknown): number | undefined {
  const code = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof code === "number" ? code : undefined;
}

/** The endpoint's host only, for logs: the full endpoint is a device secret. */
function hostOf(endpoint: string) {
  try {
    return new URL(endpoint).host;
  } catch {
    return "unknown";
  }
}

export const deliver = internalAction({
  args: {
    messages: v.array(
      v.object({
        endpoint: v.string(),
        keys: v.object({ p256dh: v.string(), auth: v.string() }),
        payload: v.string(),
      }),
    ),
  },
  returns: v.object({ ok: v.array(v.string()), gone: v.array(v.string()), failed: v.number() }),
  handler: async (_ctx, { messages }) => {
    const vapid = vapidConfig();
    if (!vapid) return { ok: [], gone: [], failed: 0 };
    const vapidDetails = { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey };

    // One device failing must not stop the others.
    const outcomes = await Promise.all(
      messages.map(async ({ endpoint, keys, payload }): Promise<Outcome> => {
        try {
          await webpush.sendNotification({ endpoint, keys }, payload, { vapidDetails, TTL: TTL_SECONDS });
          return { endpoint, ok: true, gone: false };
        } catch (error) {
          const status = statusOf(error);
          if (!isGone(status)) {
            console.warn(`Push to ${hostOf(endpoint)} failed: ${status ?? (error as Error).message}`);
          }
          return { endpoint, ok: false, gone: isGone(status) };
        }
      }),
    );
    return {
      ok: outcomes.filter((o) => o.ok).map((o) => o.endpoint),
      gone: outcomes.filter((o) => o.gone).map((o) => o.endpoint),
      failed: outcomes.filter((o) => !o.ok && !o.gone).length,
    };
  },
});
