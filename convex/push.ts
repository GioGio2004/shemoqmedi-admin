// Web push to the admins' phones and computers (the Studio and admin PWAs).
//
//   Devices: an admin turns notifications on in an app (components/pwa
//   PushToggle), which stores the browser's subscription here with the app's
//   origin. One device can hold one subscription per app.
//
//   Sending: notifyAdmins goes to every current admin's devices, or one
//   admin's (reminders, the test button). Hooks call it fire-and-forget
//   through pushAdmins(ctx, …) right after their own work. The encrypted
//   send runs in pushSend.ts (Node); subscriptions the push service no
//   longer knows (404/410) are deleted here afterwards.
//
//   Without the VAPID env vars push is off: notifyAdmins logs and returns.

import { v } from "convex/values";
import type { Scheduler } from "convex/server";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireAdmin, requireUser } from "./authHelpers";
import { cleanEndpoint, cleanKey, cleanOrigin, payloadFor, vapidConfig, type PushPayload } from "./lib/push";

// Old phones and browsers pile up; past this the oldest subscription goes.
const MAX_DEVICES_PER_USER = 20;
// A safety cap on one fan-out (a handful of admins, a few devices each).
const MAX_TARGETS = 500;

const pushMessage = {
  title: v.string(),
  body: v.string(),
  // Absolute (a Studio or admin link), or relative to the app the device subscribed from.
  url: v.string(),
  tag: v.optional(v.string()),
};

const sendResult = v.object({
  configured: v.boolean(), // false: the VAPID env vars are missing, nothing was sent
  sent: v.number(),
  removed: v.number(), // dead subscriptions deleted
  failed: v.number(),
});
type SendResult = typeof sendResult.type;

/**
 * Fire-and-forget push to the admins, for hooks in mutations and actions.
 * Scheduled, so a push service being slow or down never delays or fails the
 * caller's own work.
 */
export async function pushAdmins(ctx: { scheduler: Scheduler }, message: PushPayload) {
  await ctx.scheduler.runAfter(0, internal.push.notifyAdmins, message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Devices (Clerk-session admins)
// ─────────────────────────────────────────────────────────────────────────────

/** Store this browser's subscription for the signed-in admin (idempotent per endpoint). */
export const subscribe = mutation({
  args: {
    endpoint: v.string(),
    keys: v.object({ p256dh: v.string(), auth: v.string() }),
    origin: v.string(),
    userAgent: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx);
    const endpoint = cleanEndpoint(args.endpoint);
    const row = {
      userId: user._id,
      endpoint,
      keys: { p256dh: cleanKey(args.keys.p256dh, "p256dh"), auth: cleanKey(args.keys.auth, "auth") },
      origin: cleanOrigin(args.origin),
      userAgent: args.userAgent?.trim().slice(0, 300) || undefined,
    };

    // The same browser subscribing again (or after someone else signed in on
    // it) updates its row instead of adding a second one.
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .collect();
    const [keep, ...duplicates] = existing;
    for (const d of duplicates) await ctx.db.delete(d._id);
    if (keep) {
      await ctx.db.patch(keep._id, row);
      return null;
    }
    await ctx.db.insert("pushSubscriptions", { ...row, createdAt: Date.now() });

    const mine = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const extra = mine.sort((a, b) => a.createdAt - b.createdAt).slice(0, Math.max(0, mine.length - MAX_DEVICES_PER_USER));
    for (const old of extra) await ctx.db.delete(old._id);
    return null;
  },
});

/**
 * Forget this browser's subscription. Any signed-in user may remove their
 * own, so someone who lost the admin role can still switch it off.
 */
export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  returns: v.null(),
  handler: async (ctx, { endpoint }) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint.trim()))
      .collect();
    for (const row of rows) if (row.userId === user._id) await ctx.db.delete(row._id);
    return null;
  },
});

/** The signed-in admin's devices, newest first. */
export const mySubscriptions = query({
  args: {},
  returns: v.array(
    v.object({
      endpoint: v.string(),
      origin: v.string(),
      userAgent: v.union(v.string(), v.null()),
      createdAt: v.number(),
      lastOkAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const user = await requireAdmin(ctx);
    const rows = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return rows
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => ({
        endpoint: r.endpoint,
        origin: r.origin,
        userAgent: r.userAgent ?? null,
        createdAt: r.createdAt,
        lastOkAt: r.lastOkAt ?? null,
      }));
  },
});

/** A test notification to the signed-in admin's own devices. */
export const test = action({
  args: {},
  returns: sendResult,
  handler: async (ctx): Promise<SendResult> => {
    const userId = await ctx.runQuery(internal.push.adminId, {});
    return await send(ctx, { title: "Notifications are on", body: "This device will get Shemoqmedi alerts.", url: "/", tag: "test" }, userId);
  },
});

/** The calling admin's user id (for actions, which can't read the database). */
export const adminId = internalQuery({
  args: {},
  returns: v.id("users"),
  handler: async (ctx) => (await requireAdmin(ctx))._id,
});

// ─────────────────────────────────────────────────────────────────────────────
// Sending
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Push to every admin's devices, or only `userId`'s when given (reminders).
 * Demoted admins' devices are skipped: only current admins get alerts.
 */
export const notifyAdmins = internalAction({
  args: { ...pushMessage, userId: v.optional(v.id("users")) },
  returns: sendResult,
  handler: async (ctx, { userId, ...message }): Promise<SendResult> => await send(ctx, message, userId),
});

async function send(ctx: ActionCtx, message: PushPayload, userId?: Id<"users">): Promise<SendResult> {
  if (!vapidConfig()) {
    console.log(`Push skipped (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY or VAPID_SUBJECT not set): ${message.title}`);
    return { configured: false, sent: 0, removed: 0, failed: 0 };
  }
  const targets = await ctx.runQuery(internal.push.targets, { userId });
  if (targets.length === 0) return { configured: true, sent: 0, removed: 0, failed: 0 };

  const messages = targets.map((t) => ({ endpoint: t.endpoint, keys: t.keys, payload: payloadFor(message, t.origin) }));
  const result = await ctx.runAction(internal.pushSend.deliver, { messages });
  if (result.ok.length || result.gone.length) {
    await ctx.runMutation(internal.push.record, { ok: result.ok, gone: result.gone });
  }
  return { configured: true, sent: result.ok.length, removed: result.gone.length, failed: result.failed };
}

/** The devices a push goes to: current admins' (or one admin's) subscriptions. */
export const targets = internalQuery({
  args: { userId: v.optional(v.id("users")) },
  returns: v.array(
    v.object({ endpoint: v.string(), keys: v.object({ p256dh: v.string(), auth: v.string() }), origin: v.string() }),
  ),
  handler: async (ctx, { userId }) => {
    // Only admins can subscribe, so the table stays small: read it (or one
    // admin's rows) and check each owner is still an admin.
    const rows = userId
      ? await ctx.db
          .query("pushSubscriptions")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect()
      : await ctx.db.query("pushSubscriptions").take(MAX_TARGETS);
    const isAdmin = new Map<Id<"users">, boolean>();
    const out = [];
    for (const row of rows) {
      if (!isAdmin.has(row.userId)) {
        const user = await ctx.db.get(row.userId);
        isAdmin.set(row.userId, user?.role === "admin" || user?.role === "super_admin");
      }
      if (isAdmin.get(row.userId)) out.push({ endpoint: row.endpoint, keys: row.keys, origin: row.origin });
    }
    return out;
  },
});

/** After a send: note the devices that took it, delete the ones that are gone. */
export const record = internalMutation({
  args: { ok: v.array(v.string()), gone: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { ok, gone }) => {
    const now = Date.now();
    const rowsOf = (endpoint: string) =>
      ctx.db
        .query("pushSubscriptions")
        .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
        .collect();
    for (const endpoint of ok) {
      for (const row of await rowsOf(endpoint)) await ctx.db.patch(row._id, { lastOkAt: now });
    }
    for (const endpoint of gone) {
      for (const row of await rowsOf(endpoint)) await ctx.db.delete(row._id);
    }
    return null;
  },
});
