import { query } from "./_generated/server";
import { v } from "convex/values";
import { verifyOrgAccess } from "./authHelpers";

/**
 * getOrgGating — lightweight gating check for the admin dashboards.
 *
 * Returns which onboarding flavour this org has:
 *   "bags" → org only gets the Surprise Bags dashboard
 *   "full" → full admin (existing orgs with the field undefined count as full)
 */
export const getOrgGating = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    await verifyOrgAccess(ctx, orgId);

    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", orgId))
      .unique();

    return {
      onboardingType: (org?.onboardingType ?? "full") as "full" | "bags",
      hasSurpriseBags: org?.features?.hasSurpriseBags ?? true,
    };
  },
});
