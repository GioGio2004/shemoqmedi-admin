import { ConvexError } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { getUserByExternalId } from "./users";

/**
 * requireUser — the signed-in user's record, or throws.
 * Use at the top of every query/mutation that needs a signed-in caller.
 */
export async function requireUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Unauthenticated");

  const user = await getUserByExternalId(ctx, identity.subject);
  if (!user) {
    throw new ConvexError(
      "User record not found. Check that the Clerk webhook has synced this user.",
    );
  }
  return user;
}

/** requireAdmin — like requireUser, but only for platform admins. */
export async function requireAdmin(ctx: QueryCtx) {
  const user = await requireUser(ctx);
  if (user.role !== "admin" && user.role !== "super_admin") {
    throw new ConvexError("Forbidden: admin role required");
  }
  return user;
}
