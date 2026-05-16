import { ConvexError } from "convex/values";
import { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import { DataModel } from "./_generated/dataModel";

// ─────────────────────────────────────────────────────────────────────────────
// Shared auth context type — works for both queries and mutations
// ─────────────────────────────────────────────────────────────────────────────
type AnyCtx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;

/**
 * Resolves the current user from the JWT identity injected by Convex.
 * Throws `ConvexError("Unauthenticated")` if there is no valid session.
 */
export async function requireUser(ctx: AnyCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError("Unauthenticated: No valid session found.");
  }

  const user = await ctx.db
    .query("users")
    .withIndex("byExternalId", (q) => q.eq("externalId", identity.subject))
    .unique();

  if (!user) {
    throw new ConvexError(
      "Unauthenticated: User record not found in database. " +
        "Ensure the Clerk webhook has synced this user."
    );
  }

  return user;
}

/**
 * verifyOrgAccess — the RBAC gatekeeper for all catalog & fleet mutations.
 *
 * Verifies that the currently authenticated user has a membership record
 * in the requested organization. Throws `ConvexError("Unauthorized")` if not.
 *
 * Usage (in any query or mutation):
 *   const { user, membership } = await verifyOrgAccess(ctx, orgId);
 *
 * @returns { user, membership } — both typed Convex documents, ready to use.
 */
export async function verifyOrgAccess(ctx: AnyCtx, orgId: string) {
  const user = await requireUser(ctx);

  // ── Super-admin bypass ───────────────────────────────────────────────────
  // Users with the platform-level "super_admin" role have unrestricted access
  // to every organization's data. They are not required to have a membership
  // row in the `memberships` table for the target org.
  if (user.role === "super_admin") {
    // Return a synthetic membership object so callers don't need to null-check
    const syntheticMembership = {
      _id: "synthetic" as unknown as import("./_generated/dataModel").Id<"memberships">,
      _creationTime: 0,
      userId: user._id,
      orgId,
      role: "org:admin", // Super admin gets full org permissions
    };
    return { user, membership: syntheticMembership };
  }

  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_user_and_org", (q) =>
      q.eq("userId", user._id).eq("orgId", orgId)
    )
    .unique();

  if (!membership) {
    throw new ConvexError(
      `Unauthorized: User "${user.email}" is not a member of organization "${orgId}".`
    );
  }

  return { user, membership };
}

/**
 * verifyOrgAdmin — stricter gate for admin-only operations.
 * Builds on verifyOrgAccess and additionally checks that the user's role
 * is "org:admin". Use this for destructive operations (delete, deactivate org, etc.).
 */
export async function verifyOrgAdmin(ctx: AnyCtx, orgId: string) {
  const { user, membership } = await verifyOrgAccess(ctx, orgId);

  if (membership.role !== "org:admin") {
    throw new ConvexError(
      `Forbidden: Operation requires "org:admin" role. ` +
        `User "${user.email}" has role "${membership.role}".`
    );
  }

  return { user, membership };
}
