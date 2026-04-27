import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { GenericQueryCtx } from "convex/server";

// Helper to find an org quickly
async function getOrgByClerkId(ctx: GenericQueryCtx<any>, clerkId: string) {
  return await ctx.db
    .query("organizations")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
    .unique();
}

export const upsertFromClerk = internalMutation({
  args: { data: v.any() },
  handler: async (ctx, { data }) => {
    if (!data.id) {
      throw new Error(
        `Missing org ID from Clerk. Data: ${JSON.stringify(data)}`,
      );
    }

    const orgAttributes = {
      clerkId: data.id,
      name: data.name,
      slug: data.slug || "",
      logoUrl: data.image_url || "",
      updatedAt: Date.now(),
    };

    const existingOrg = await getOrgByClerkId(ctx, data.id);

    if (existingOrg === null) {
      console.log("✅ Creating new organization:", orgAttributes.name);
      await ctx.db.insert("organizations", {
        ...orgAttributes,
        isActive: true,
        createdAt: Date.now(),
      });
    } else {
      console.log("📝 Updating existing organization:", orgAttributes.name);
      await ctx.db.patch(existingOrg._id, orgAttributes);
    }
  },
});

export const deleteFromClerk = internalMutation({
  args: { clerkId: v.string() },
  handler: async (ctx, { clerkId }) => {
    const org = await getOrgByClerkId(ctx, clerkId);
    if (org !== null) {
      console.log("🗑️ Deleting organization:", org.name);
      await ctx.db.delete(org._id);
    } else {
      console.log("⚠️ Organization not found for deletion:", clerkId);
    }
  },
});
