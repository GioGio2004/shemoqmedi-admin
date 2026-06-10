import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const get = query({
  args: { orgId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.orgId) return null;
    const orgId = args.orgId;
    return await ctx.db
      .query("aiChatThemes")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .first();
  },
});

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();

    if (!org) return null;

    return await ctx.db
      .query("aiChatThemes")
      .withIndex("by_org", (q) => q.eq("orgId", org.clerkId))
      .first();
  },
});

export const update = mutation({
  args: {
    orgId: v.string(),
    botName: v.optional(v.string()),
    botAvatarUrl: v.optional(v.string()),
    primaryColor: v.string(),
    backgroundColor: v.string(),
    textColor: v.string(),
    userMessageBg: v.string(),
    userMessageText: v.string(),
    botMessageBg: v.string(),
    botMessageText: v.string(),
    fontFamily: v.string(),
    backgroundTemplate: v.optional(v.string()),
    greetingMessage: v.optional(v.string()),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("aiChatThemes")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        botName: args.botName,
        botAvatarUrl: args.botAvatarUrl,
        primaryColor: args.primaryColor,
        backgroundColor: args.backgroundColor,
        textColor: args.textColor,
        userMessageBg: args.userMessageBg,
        userMessageText: args.userMessageText,
        botMessageBg: args.botMessageBg,
        botMessageText: args.botMessageText,
        fontFamily: args.fontFamily,
        backgroundTemplate: args.backgroundTemplate,
        greetingMessage: args.greetingMessage,
        isActive: args.isActive,
        updatedAt: Date.now(),
      });
      return existing._id;
    } else {
      const newId = await ctx.db.insert("aiChatThemes", {
        orgId: args.orgId,
        botName: args.botName,
        botAvatarUrl: args.botAvatarUrl,
        primaryColor: args.primaryColor,
        backgroundColor: args.backgroundColor,
        textColor: args.textColor,
        userMessageBg: args.userMessageBg,
        userMessageText: args.userMessageText,
        botMessageBg: args.botMessageBg,
        botMessageText: args.botMessageText,
        fontFamily: args.fontFamily,
        backgroundTemplate: args.backgroundTemplate,
        greetingMessage: args.greetingMessage,
        isActive: args.isActive,
        updatedAt: Date.now(),
      });
      return newId;
    }
  },
});
