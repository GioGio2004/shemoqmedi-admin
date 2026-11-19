// Rows of the claimLinks table (see convex/claimLinks.ts): finding a
// target's links, revoking them and the admin-facing status. Kept apart from
// claimLinks.ts so jury.ts, listings.ts and admin.ts can use it without an
// import cycle.

import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

export type Target = { kind: "juror"; id: Id<"jurors"> } | { kind: "listing"; id: Id<"listings"> };

/** Every link row of a target (a handful: one per copy or email). */
export async function linksOf(ctx: QueryCtx, t: Target) {
  return t.kind === "juror"
    ? await ctx.db.query("claimLinks").withIndex("by_juror", (q) => q.eq("jurorId", t.id)).take(200)
    : await ctx.db.query("claimLinks").withIndex("by_listing", (q) => q.eq("listingId", t.id)).take(200);
}

export const isOpenLink = (l: Doc<"claimLinks">, now: number) => !l.usedBy && !l.revokedAt && l.expiresAt > now;

/** Kills every open link of a target (rotating, claiming, unclaiming), except `keep`. */
export async function revokeClaimLinks(ctx: MutationCtx, t: Target, now: number, keep?: Id<"claimLinks">) {
  for (const l of await linksOf(ctx, t)) {
    if (l._id !== keep && !l.usedBy && !l.revokedAt) await ctx.db.patch(l._id, { revokedAt: now });
  }
}

/**
 * Admin-facing state of a target's links, never the token: when the newest
 * open link expires, or null when there is none. `expiresAt` null marks a
 * legacy plaintext link (migrations:hashClaimTokens gives it an expiry).
 */
export const claimLinkStatus = v.union(v.object({ expiresAt: v.union(v.number(), v.null()) }), v.null());

export async function linkStatus(ctx: QueryCtx, t: Target, doc: { claimToken?: string }) {
  const now = Date.now();
  const open = (await linksOf(ctx, t)).filter((l) => isOpenLink(l, now));
  if (open.length > 0) return { expiresAt: Math.max(...open.map((l) => l.expiresAt)) };
  return doc.claimToken ? { expiresAt: null } : null;
}

