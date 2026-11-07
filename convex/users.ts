import { v } from "convex/values";
import { internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { requireAdmin } from "./authHelpers";

const userDoc = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  externalId: v.string(),
  name: v.string(),
  email: v.string(),
  profilePicture: v.optional(v.string()),
  role: v.optional(v.union(v.literal("admin"), v.literal("super_admin"))),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export async function getUserByExternalId(ctx: QueryCtx, externalId: string) {
  return await ctx.db
    .query("users")
    .withIndex("byExternalId", (q) => q.eq("externalId", externalId))
    .unique();
}

type ClerkEmail = { id: string; email_address: string };
type ClerkUserPayload = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  image_url?: string | null;
  primary_email_address_id?: string | null;
  email_addresses?: ClerkEmail[];
};

function primaryEmail(data: ClerkUserPayload): string {
  const list = data.email_addresses ?? [];
  const primary = list.find((e) => e.id === data.primary_email_address_id);
  return primary?.email_address ?? list[0]?.email_address ?? "";
}

/** Called by the Clerk webhook on user.created / user.updated. */
export const upsertFromClerk = internalMutation({
  args: { data: v.any() },
  returns: v.null(),
  handler: async (ctx, { data }) => {
    const clerk = data as ClerkUserPayload;
    if (!clerk.id) throw new Error("Clerk payload is missing the user id");

    const email = primaryEmail(clerk);
    // Users without an email yet (unverified sign-up) are synced on the
    // next user.updated event.
    if (!email) return null;

    const name =
      `${clerk.first_name ?? ""} ${clerk.last_name ?? ""}`.trim() ||
      clerk.username ||
      email.split("@")[0];

    const fields = {
      externalId: clerk.id,
      name,
      email,
      profilePicture: clerk.image_url ?? undefined,
      updatedAt: Date.now(),
    };

    const existing = await getUserByExternalId(ctx, clerk.id);
    if (existing) {
      // `role` is intentionally not part of `fields`: it is managed here,
      // never by Clerk data.
      await ctx.db.patch(existing._id, fields);
    } else {
      await ctx.db.insert("users", { ...fields, createdAt: Date.now() });
    }
    return null;
  },
});

/** Called by the Clerk webhook on user.deleted. */
export const deleteFromClerk = internalMutation({
  args: { clerkUserId: v.string() },
  returns: v.null(),
  handler: async (ctx, { clerkUserId }) => {
    const user = await getUserByExternalId(ctx, clerkUserId);
    if (user) await ctx.db.delete(user._id);
    return null;
  },
});

/** The signed-in user's Convex record, or null (signed out / not synced yet). */
export const getCurrentUser = query({
  args: {},
  returns: v.union(userDoc, v.null()),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await getUserByExternalId(ctx, identity.subject);
  },
});

/** For actions: throws unless the caller is a platform admin. */
export const assertAdmin = internalQuery({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return null;
  },
});

/**
 * Grant or remove a platform role. Internal: run it from the CLI only, e.g.
 *   npx convex run users:setRole '{"email":"you@example.com","role":"admin"}'
 * Pass "role": null to remove the role.
 */
export const setRole = internalMutation({
  args: {
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("super_admin"), v.null()),
  },
  returns: v.string(),
  handler: async (ctx, { email, role }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("byEmail", (q) => q.eq("email", email.trim()))
      .first();
    if (!user) {
      throw new Error(`No user with email ${email}. Sign up first so the Clerk webhook creates the record.`);
    }
    await ctx.db.patch(user._id, { role: role ?? undefined, updatedAt: Date.now() });
    return `${user.email} is now ${role ?? "a regular user"}`;
  },
});
