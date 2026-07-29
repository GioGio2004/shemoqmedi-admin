import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./authHelpers";

// ─────────────────────────────────────────────────────────────────────────────
// ONBOARDING — guided-tour tracking, one row per user per flow.
//
// The workspace tutorial drives this: every step advance is recorded
// (stepsSeen keeps the exact path), and finishing or skipping stamps the row.
// A row without completedAt/skippedAt is an unfinished tour — the UI resumes
// it on the next visit. Rows double as onboarding-funnel analytics.
// ─────────────────────────────────────────────────────────────────────────────

export const getMine = query({
  args: { flow: v.string() },
  handler: async (ctx, { flow }) => {
    const user = await requireUser(ctx);
    return await ctx.db
      .query("onboarding")
      .withIndex("by_user_flow", (q) => q.eq("userId", user._id).eq("flow", flow))
      .unique();
  },
});

export const recordStep = mutation({
  args: { flow: v.string(), orgId: v.string(), step: v.string() },
  handler: async (ctx, { flow, orgId, step }) => {
    const user = await requireUser(ctx);
    const now = Date.now();

    const existing = await ctx.db
      .query("onboarding")
      .withIndex("by_user_flow", (q) => q.eq("userId", user._id).eq("flow", flow))
      .unique();

    if (existing) {
      const stepsSeen = existing.stepsSeen.includes(step)
        ? existing.stepsSeen
        : [...existing.stepsSeen, step];
      await ctx.db.patch(existing._id, {
        stepsSeen,
        lastStepAt: now,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("onboarding", {
      userId: user._id,
      orgId,
      flow,
      startedAt: now,
      stepsSeen: [step],
      lastStepAt: now,
      updatedAt: now,
    });
  },
});

export const finish = mutation({
  args: {
    flow: v.string(),
    orgId: v.string(),
    outcome: v.union(v.literal("completed"), v.literal("skipped")),
  },
  handler: async (ctx, { flow, orgId, outcome }) => {
    const user = await requireUser(ctx);
    const now = Date.now();

    const existing = await ctx.db
      .query("onboarding")
      .withIndex("by_user_flow", (q) => q.eq("userId", user._id).eq("flow", flow))
      .unique();

    const stamp =
      outcome === "completed" ? { completedAt: now } : { skippedAt: now };

    if (existing) {
      await ctx.db.patch(existing._id, { ...stamp, updatedAt: now });
      return existing._id;
    }

    // Skipped before any step was recorded — still worth a row.
    return await ctx.db.insert("onboarding", {
      userId: user._id,
      orgId,
      flow,
      startedAt: now,
      stepsSeen: [],
      ...stamp,
      updatedAt: now,
    });
  },
});
