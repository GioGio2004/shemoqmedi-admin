import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { requireUser } from "./authHelpers";
import { rateLimit } from "./lib/rateLimit";

/** For actions (upload signing): counts one use for the signed-in caller. */
export const hit = internalMutation({
  args: { name: v.union(v.literal("imageUpload"), v.literal("videoUpload")) },
  returns: v.null(),
  handler: async (ctx, { name }) => {
    await rateLimit(ctx, name, await requireUser(ctx));
    return null;
  },
});
