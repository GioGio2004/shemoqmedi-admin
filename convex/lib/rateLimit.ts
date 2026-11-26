import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { isAdminUser } from "./media";

// Per-account limits on what any free account can repeat (audit C-09):
// submissions, claims, votes and uploads each push work or notifications to
// the admins, and accounts cost nothing to make. Fixed windows, one row per
// account and action (rateLimits table); admins are never limited.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const RATE_LIMITS = {
  submitListing: { max: 10, windowMs: DAY, message: "You've submitted 10 sites today. Please try again tomorrow." },
  submitClaim: { max: 10, windowMs: DAY, message: "You've sent 10 requests today. Please try again tomorrow." },
  vote: { max: 120, windowMs: HOUR, message: "That's a lot of votes in an hour. Please take a break and try again later." },
  claimLink: { max: 20, windowMs: HOUR, message: "Too many claim attempts. Please try again in an hour." },
  imageUpload: { max: 80, windowMs: HOUR, message: "Too many uploads in an hour. Please try again later." },
  videoUpload: { max: 20, windowMs: HOUR, message: "Too many video uploads in an hour. Please try again later." },
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

/** Count one use of `name` by `user`; throws a readable error past the limit. */
export async function rateLimit(ctx: MutationCtx, name: RateLimitName, user: Doc<"users">, now = Date.now()) {
  if (isAdminUser(user)) return;
  const { max, windowMs, message } = RATE_LIMITS[name];
  const key = `${name}:${user._id}`;
  const row = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (!row || now - row.windowStart >= windowMs) {
    if (row) await ctx.db.patch(row._id, { windowStart: now, count: 1 });
    else await ctx.db.insert("rateLimits", { key, windowStart: now, count: 1 });
    return;
  }
  if (row.count >= max) throw new ConvexError(message);
  await ctx.db.patch(row._id, { count: row.count + 1 });
}

/**
 * A fixed-window limit on any key, for callers that have no account yet (the
 * quick submission before email verification). Same rateLimits table.
 */
export async function limitKey(
  ctx: MutationCtx,
  key: string,
  max: number,
  windowMs: number,
  message: string,
  now = Date.now(),
) {
  const row = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (!row || now - row.windowStart >= windowMs) {
    if (row) await ctx.db.patch(row._id, { windowStart: now, count: 1 });
    else await ctx.db.insert("rateLimits", { key, windowStart: now, count: 1 });
    return;
  }
  if (row.count >= max) throw new ConvexError(message);
  await ctx.db.patch(row._id, { count: row.count + 1 });
}
