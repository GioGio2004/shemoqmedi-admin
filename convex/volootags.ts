import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// 📍 LOG TAP — called on every NFC tap from the customer app (/t/[uuid])
// Increments tapCount on the volootags record and optionally records timezone.
export const logTapMoment = mutation({
  args: {
    uuid: v.string(),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tag = await ctx.db
      .query("volootags")
      .withIndex("by_uuid", (q) => q.eq("volooTagsUUID", args.uuid))
      .unique();

    if (!tag || !tag.isActive) return { success: false };

    await ctx.db.patch(tag._id, {
      tapCount: (tag.tapCount ?? 0) + 1,
      pendingActivationAlert: (tag.tapCount ?? 0) === 0 ? true : tag.pendingActivationAlert,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// 🔮 Switch between 'store' and 'magic' app mode
export const toggleAppMode = mutation({
  args: {
    userId: v.string(),
    activeAppMode: v.union(v.literal("store"), v.literal("magic")),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", args.userId))
      .unique();
    if (!user) throw new Error("User not found");
    if (!user.volooMagicUnlocked && args.activeAppMode === "magic") {
      throw new Error("User has not unlocked Voloo Magic");
    }
    await ctx.db.patch(user._id, { activeAppMode: args.activeAppMode });
    return { success: true, activeAppMode: args.activeAppMode };
  },
});

// 📱 Get User's Active Tag for the Magic Dashboard
export const getActiveTag = query({
  args: { userId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.userId) return null;
    return await ctx.db
      .query("volootags")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .first();
  },
});

// 🔍 Check if the user has unlocked Voloo Magic + unboxing popup status
export const getUserMagicStatus = query({
  args: { userId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.userId) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) =>
        q.eq("externalId", args.userId as string),
      )
      .unique();
    return {
      unlocked: user?.volooMagicUnlocked ?? false,
      hasSeenUnboxingPopup: user?.hasSeenUnboxingPopup ?? false,
    };
  },
});

// 🎊 Mark that the user has seen the first-time unboxing popup
export const markUnboxingSeen = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", args.userId))
      .unique();
    if (!user) throw new Error("User not found");
    await ctx.db.patch(user._id, { hasSeenUnboxingPopup: true });
    return { success: true };
  },
});

// 🌍 PUBLIC API: Used by the NFC tap (app/t/[uuid]/page.tsx)
export const getTagByUUID = query({
  args: { uuid: v.string() },
  handler: async (ctx, args) => {
    const tag = await ctx.db
      .query("volootags")
      .withIndex("by_uuid", (q) => q.eq("volooTagsUUID", args.uuid))
      .unique();
    if (!tag) return null;
    // Only return fields the tap experience actually needs — never
    // leak the full document publicly.
    return {
      _id: tag._id,
      userId: tag.userId,
      volooTagsUUID: tag.volooTagsUUID,
      isActive: tag.isActive,
      activeMode: tag.activeMode,
      showAnimation: tag.showAnimation,
      selectedAnimation: tag.selectedAnimation,
      redirectUrl: tag.redirectUrl,
      vcardName: tag.vcardName,
      vcardPhone: tag.vcardPhone,
      vcardEmail: tag.vcardEmail,
      vcardCompany: tag.vcardCompany,
      vcardTitle: tag.vcardTitle,
      vcardNote: tag.vcardNote,
      tapCount: tag.tapCount,
      // ── Cafe Hub fields ──────────────────────────────────────
      hubTheme: tag.hubTheme,
      hubBusinessName: tag.hubBusinessName,
      hubMenuUrl: tag.hubMenuUrl,
      hubInstagramUrl: tag.hubInstagramUrl,
      hubTiktokUrl: tag.hubTiktokUrl,
      hubFacebookUrl: tag.hubFacebookUrl,
      hubBackgroundImageUrl: tag.hubBackgroundImageUrl,
    };
  },
});

// ✅ NEW: Called by the Magic dashboard after the owner sees the
// first-tap popup. Clears the flag so it never shows again.
export const clearActivationAlert = mutation({
  args: { tagId: v.id("volootags") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const tag = await ctx.db.get(args.tagId);
    if (!tag) throw new Error("Tag not found");
    if (tag.userId !== identity.subject) throw new Error("Unauthorized");

    await ctx.db.patch(args.tagId, {
      pendingActivationAlert: false,
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

export const getUserTags = query({
  args: { userId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.userId) return [];
    return await ctx.db
      .query("volootags")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .order("desc") // Newest first
      .collect();
  },
});

// 👤 Get user profile data to pre-fill vCard form
export const getUserProfile = query({
  args: { userId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.userId) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) =>
        q.eq("externalId", args.userId as string),
      )
      .unique();
    if (!user) return null;
    return {
      name: user.name || "",
      lastname: user.lastname || "",
      email: user.email || "",
      phone: user.phone || "",
      location: user.location || "",
    };
  },
});

// 📊 Get personal tap statistics for a user
export const getTagTapStats = query({
  args: { userId: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!args.userId) return null;

    const tag = await ctx.db
      .query("volootags")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .first();

    if (!tag) return null;

    const now = Date.now();
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000;

    return {
      total: tag.tapCount ?? 0,
    };
  },
});

// 🏆 Global Leaderboard — top tags by tapCount
export const getLeaderboard = query({
  args: {},
  handler: async (ctx) => {
    const topTags = await ctx.db
      .query("volootags")
      .withIndex("by_tapCount")
      .order("desc")
      .filter((q) => q.eq(q.field("isActive"), true))
      .take(10);

    const enriched = await Promise.all(
      topTags.map(async (tag, index) => {
        let firstName = "Voloo User";
        if (tag.userId) {
          const user = await ctx.db
            .query("users")
            .withIndex("byExternalId", (q) => q.eq("externalId", tag.userId!))
            .unique();
          if (user?.name) firstName = user.name;
        }
        return {
          rank: index + 1,
          firstName,
          tapCount: tag.tapCount ?? 0,
          uuid: tag.volooTagsUUID.slice(0, 8),
        };
      }),
    );

    return enriched.filter((e) => e.tapCount > 0);
  },
});

// 📈 Global aggregate stats for the landing page
export const getGlobalStats = query({
  args: {},
  handler: async (ctx) => {
    const allActiveTags = await ctx.db
      .query("volootags")
      .filter((q) => q.eq(q.field("isActive"), true))
      .take(500);

    const totalTags = allActiveTags.length;
    const totalTaps = allActiveTags.reduce(
      (sum, t) => sum + (t.tapCount ?? 0),
      0,
    );

    return {
      totalTags,
      totalTaps,
      activatedUsers: totalTags,
    };
  },
});

export const updateTagMode = mutation({
  args: {
    tagId: v.id("volootags"),
    activeMode: v.string(),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated request");

    const tag = await ctx.db.get(args.tagId);
    if (!tag) throw new Error("Tag not found");
    if (tag.userId !== identity.subject)
      throw new Error("Unauthorized: You do not own this tag");

    const patchData: any = {
      activeMode: args.activeMode as any,
      updatedAt: Date.now(),
    };
    if (args.payload) {
      const p = args.payload;
      if (p.redirectUrl !== undefined) patchData.redirectUrl = p.redirectUrl;
      if (p.wifiSsid !== undefined) patchData.wifiSsid = p.wifiSsid;
      if (p.wifiPassword !== undefined) patchData.wifiPassword = p.wifiPassword;
      if (p.lostMessage !== undefined) patchData.lostMessage = p.lostMessage;
      if (p.lostContactNumber !== undefined)
        patchData.lostContactNumber = p.lostContactNumber;
      if (p.vcardName !== undefined) patchData.vcardName = p.vcardName;
      if (p.vcardPhone !== undefined) patchData.vcardPhone = p.vcardPhone;
      if (p.vcardEmail !== undefined) patchData.vcardEmail = p.vcardEmail;
      if (p.vcardCompany !== undefined) patchData.vcardCompany = p.vcardCompany;
      if (p.vcardTitle !== undefined) patchData.vcardTitle = p.vcardTitle;
      if (p.vcardNote !== undefined) patchData.vcardNote = p.vcardNote;
      // ── Cafe Hub fields ─────────────────────────────────────
      if (p.hubTheme !== undefined) patchData.hubTheme = p.hubTheme;
      if (p.hubBusinessName !== undefined)
        patchData.hubBusinessName = p.hubBusinessName;
      if (p.hubMenuUrl !== undefined) patchData.hubMenuUrl = p.hubMenuUrl;
      if (p.hubInstagramUrl !== undefined)
        patchData.hubInstagramUrl = p.hubInstagramUrl;
      if (p.hubTiktokUrl !== undefined) patchData.hubTiktokUrl = p.hubTiktokUrl;
      if (p.hubFacebookUrl !== undefined)
        patchData.hubFacebookUrl = p.hubFacebookUrl;
      if (p.hubBackgroundImageUrl !== undefined)
        patchData.hubBackgroundImageUrl = p.hubBackgroundImageUrl;
    }
    await ctx.db.patch(args.tagId, patchData);
    return { success: true };
  },
});

export const updateTagAnimation = mutation({
  args: {
    tagId: v.id("volootags"),
    showAnimation: v.optional(v.boolean()),
    selectedAnimation: v.optional(v.string()),
    greetingText: v.optional(v.string()),
    textAnimationStyle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated request");

    const tag = await ctx.db.get(args.tagId);
    if (!tag) throw new Error("Tag not found");
    if (tag.userId !== identity.subject)
      throw new Error("Unauthorized: You do not own this tag");

    const patch: any = { updatedAt: Date.now() };
    if (args.showAnimation !== undefined)
      patch.showAnimation = args.showAnimation;
    if (args.selectedAnimation !== undefined)
      patch.selectedAnimation = args.selectedAnimation;
    if (args.greetingText !== undefined) patch.greetingText = args.greetingText;
    if (args.textAnimationStyle !== undefined)
      patch.textAnimationStyle = args.textAnimationStyle;
    await ctx.db.patch(args.tagId, patch);
    return { success: true };
  },
});

export const claimTag = mutation({
  args: { uuid: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("You must be logged in to claim a tag.");

    const tag = await ctx.db
      .query("volootags")
      .withIndex("by_uuid", (q) => q.eq("volooTagsUUID", args.uuid))
      .unique();

    if (!tag) throw new Error("Invalid tag.");
    if (!tag.isActive) throw new Error("Tag not authorized for activation.");
    if (tag.userId) throw new Error("Tag already claimed.");

    // ✅ FIX: Removed the strict `order.userId === identity.subject` check.
    // Since tags are physical NFC items, possessing and scanning the tag
    // is proof of ownership. This allows users to buy tags for friends/employees
    // or properly claim a tag that was given to them via the "Wipe & Gift" feature.

    await ctx.db.patch(tag._id, {
      userId: identity.subject,
      activeMode: "cafe_hub",
      updatedAt: Date.now(),
    });

    const user = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", identity.subject))
      .unique();
    if (user && !user.volooMagicUnlocked) {
      await ctx.db.patch(user._id, { volooMagicUnlocked: true });
    }

    return { success: true };
  },
});

export const releaseTag = mutation({
  args: { tagId: v.id("volootags") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated request");

    const tag = await ctx.db.get(args.tagId);
    if (!tag) throw new Error("Tag not found");
    if (tag.userId !== identity.subject) throw new Error("Unauthorized.");

    await ctx.db.patch(args.tagId, {
      userId: undefined,
      activeMode: "cafe_hub",
      redirectUrl: undefined,
      wifiSsid: undefined,
      wifiPassword: undefined,
      lostMessage: undefined,
      lostContactNumber: undefined,
      vcardName: undefined,
      vcardPhone: undefined,
      vcardEmail: undefined,
      vcardCompany: undefined,
      vcardTitle: undefined,
      vcardNote: undefined,
      selectedAnimation: undefined,
      showAnimation: true,
      pendingActivationAlert: false,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});
