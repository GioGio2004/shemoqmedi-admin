// The admin's Emails page: Resend's own log of what went out (lib/resendApi.ts).
// Admin only. Read-only: nothing here sends anything.

import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdmin } from "./authHelpers";
import { getSent, listSent, resendEmail, resendPage, type ResendEmail, type ResendPage } from "./lib/resendApi";

/** Throws unless the caller is a signed-in admin (actions can't read the db themselves). */
export const checkAdmin = internalQuery({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return null;
  },
});

export const list = action({
  args: { after: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: resendPage,
  handler: async (ctx, args): Promise<ResendPage> => {
    await ctx.runQuery(internal.resendLog.checkAdmin, {});
    return await listSent(args);
  },
});

export const get = action({
  args: { id: v.string() },
  returns: v.object({ email: v.union(resendEmail, v.null()), error: v.union(v.string(), v.null()) }),
  handler: async (ctx, { id }): Promise<{ email: ResendEmail | null; error: string | null }> => {
    await ctx.runQuery(internal.resendLog.checkAdmin, {});
    return await getSent(id);
  },
});
