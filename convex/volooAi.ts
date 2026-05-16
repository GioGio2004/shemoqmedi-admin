// convex/volooAi.ts
// ─────────────────────────────────────────────────────────────────────────────
// VolooAI Admin Backend — Internal Mutations
//
// These are called exclusively by the Next.js API route (/api/voloo-ai) via
// ConvexHttpClient. They are declared as `internalMutation` so they bypass
// the Clerk JWT auth requirement — authentication is enforced at the API-route
// layer instead, keeping the voice loop latency tight.
// ─────────────────────────────────────────────────────────────────────────────

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ─────────────────────────────────────────────────────────────────────────────
// logChat — persists one turn of the manager ↔ VolooAI conversation.
//
// role: "manager"  → the voice command spoken by the human
//       "volooAI"  → the AI's spoken response
//       "system"   → automated status messages (e.g. "Item hidden")
// ─────────────────────────────────────────────────────────────────────────────
export const logChat = mutation({
  args: {
    orgId: v.string(),
    role: v.union(
      v.literal("manager"),
      v.literal("volooAI"),
      v.literal("system"),
    ),
    message: v.string(),
    actionExecuted: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("adminChats", {
      orgId: args.orgId,
      role: args.role,
      message: args.message,
      actionExecuted: args.actionExecuted,
      timestamp: Date.now(),
    });
    console.log(
      `💬 [VolooAI] Chat logged (${args.role}): "${args.message.slice(0, 60)}…"`,
    );
    return id;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// logAction — audit trail for every database mutation VolooAI executes.
//
// actionType examples: "MENU_MUTATION", "UI_NAVIGATION"
// targetId: the Convex document _id of the affected menuItem (as a string)
// details: human-readable summary for the audit log UI
// ─────────────────────────────────────────────────────────────────────────────
export const logAction = mutation({
  args: {
    orgId: v.string(),
    actionType: v.string(),
    targetId: v.optional(v.string()),
    details: v.string(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("aiActionLogs", {
      orgId: args.orgId,
      actionType: args.actionType,
      targetId: args.targetId,
      details: args.details,
      timestamp: Date.now(),
    });
    console.log(
      `🤖 [VolooAI] Action logged — ${args.actionType}: ${args.details}`,
    );
    return id;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// toggleMenuItem — the core "Menu Mutator" lever.
//
// Searches all menuItems for this org where ANY translation value in the
// multilingual `name` record fuzzy-matches `targetName` (case-insensitive).
// Updates `isAvailable` to true (show) or false (hide) for every match.
//
// Returns a summary object the API route uses to build the spoken_response.
// ─────────────────────────────────────────────────────────────────────────────
export const toggleMenuItem = mutation({
  args: {
    orgId: v.string(),
    targetName: v.string(),
    action: v.union(v.literal("hide"), v.literal("show")),
  },
  handler: async (ctx, { orgId, targetName, action }) => {
    // Fetch all menu items for this org
    const allItems = await ctx.db
      .query("menuItems")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    const needle = targetName.toLowerCase().trim();

    // Find items where any language translation value contains the target name
    const matches = allItems.filter((item) =>
      Object.values(item.name).some((translation) =>
        translation.toLowerCase().includes(needle),
      ),
    );

    if (matches.length === 0) {
      console.warn(
        `⚠️ [VolooAI] toggleMenuItem: No item matching "${targetName}" found in org "${orgId}".`,
      );
      return {
        success: false,
        matched: 0,
        targetName,
        action,
        itemNames: [],
      };
    }

    const newAvailability = action === "show";

    // Patch every matching item
    await Promise.all(
      matches.map((item) =>
        ctx.db.patch(item._id, { isAvailable: newAvailability }),
      ),
    );

    const itemNames = matches.map(
      // Prefer English name, fall back to first translation found
      (item) => item.name["en"] ?? Object.values(item.name)[0] ?? "Unknown",
    );

    console.log(
      `✅ [VolooAI] ${action.toUpperCase()}D ${matches.length} item(s): ${itemNames.join(", ")}`,
    );

    return {
      success: true,
      matched: matches.length,
      targetName,
      action,
      itemNames,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// getMenuStatus — read the menu for VolooAI to answer manager questions.
//
// Filters:
//   searchTerm  — case-insensitive substring match across ALL language values
//   isAvailable — if provided, filters to only available or only hidden items
//
// Returns a flat array of clean objects (no raw Convex doc internals).
// ─────────────────────────────────────────────────────────────────────────────
export const getMenuStatus = query({
  args: {
    orgId: v.string(),
    searchTerm: v.optional(v.string()),
    isAvailable: v.optional(v.boolean()),
  },
  handler: async (ctx, { orgId, searchTerm, isAvailable }) => {
    // 1. Fetch categories to map IDs to actual names
    const categoriesRaw = await ctx.db
      .query("categories")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
      
    const catMap = new Map<string, string>();
    for (const c of categoriesRaw) {
      catMap.set(c._id, c.name["en"] ?? Object.values(c.name)[0] ?? "Unknown");
    }

    let items = await ctx.db
      .query("menuItems")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    // Fetch all categories for this org to resolve category names
    const categories = await ctx.db
      .query("categories")
      .withIndex("by_org_and_sort", (q) => q.eq("orgId", orgId))
      .collect();
      
    const categoryMap = new Map(categories.map((c) => [c._id, c]));

    // Filter by availability if requested
    if (isAvailable !== undefined) {
      items = items.filter((item) => item.isAvailable === isAvailable);
    }

    // Filter by search term (multilingual name + category name)
    if (searchTerm) {
      const needle = searchTerm.toLowerCase().trim();
      items = items.filter((item) => {
        const nameMatches = Object.values(item.name).some((v) => v.toLowerCase().includes(needle));
        const catName = item.categoryId ? catMap.get(item.categoryId) : null;
        const catMatches = catName ? catName.toLowerCase().includes(needle) : false;
        return nameMatches || catMatches;
      });
    }

    return items.map((item) => ({
      id: item._id,
      name: item.name["en"] ?? Object.values(item.name)[0] ?? "Unnamed",
      nameAll: item.name,
      price: item.price ?? 0,
      isAvailable: item.isAvailable ?? true,
      category: item.categoryId ? (catMap.get(item.categoryId) ?? "Unknown") : null,
      imageUrl: item.imageUrl ?? null,
      description:
        item.description?.["en"] ??
        (item.description ? Object.values(item.description)[0] : "") ??
        "",
    }));
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// updateItemDescription — live CMS edit driven by VolooAI.
//
// Patches the "en" key of the description record for a specific menuItem.
// The AI calls this when the manager says "rewrite the description for X".
// ─────────────────────────────────────────────────────────────────────────────
export const updateItemDescription = mutation({
  args: {
    orgId: v.string(),
    targetId: v.string(),
    newDescription: v.string(),
  },
  handler: async (ctx, { orgId, targetId, newDescription }) => {
    // Resolve string → typed Id (ConvexHttpClient sends ids as strings)
    const item = await ctx.db.get(targetId as Parameters<typeof ctx.db.get>[0]);

    if (!item || (item as Record<string, unknown>).orgId !== orgId) {
      console.warn(
        `[VolooAI] updateItemDescription: item ${targetId} not found in org ${orgId}`,
      );
      return { success: false, message: "Item not found or org mismatch." };
    }

    const existing =
      ((item as Record<string, unknown>).description as
        | Record<string, string>
        | undefined) ?? {};

    await ctx.db.patch(targetId as Parameters<typeof ctx.db.get>[0], {
      description: { ...existing, en: newDescription },
    });

    console.log(
      `✏️ [VolooAI] Description updated for ${targetId}: "${newDescription.slice(0, 60)}…"`,
    );
    return { success: true, message: "Description saved." };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// updateStorefrontTheme — AI-driven visual theme control.
//
// Patches the `themeSettings` field on the organization document — the SAME
// field the "Live Theme Customizer" dashboard page reads and writes.
//
// Schema: themeSettings = { primaryColor, backgroundColor?, textColor?,
//                           fontFamily, buttonRadius }
//
// The mutation merges partial updates — AI can change a single field without
// overwriting the rest. No verifyOrgAccess needed because this is called via
// the ConvexHttpClient inside the VolooAI hook (already org-scoped by orgId).
// ─────────────────────────────────────────────────────────────────────────────
export const updateStorefrontTheme = mutation({
  args: {
    orgId:           v.string(),
    primaryColor:    v.optional(v.string()),  // e.g. "#4ade80"
    backgroundColor: v.optional(v.string()),  // e.g. "#0f0f0f"
    textColor:       v.optional(v.string()),  // e.g. "#f5f5f5"
    fontFamily:      v.optional(v.string()),  // e.g. "Inter" | "Playfair Display"
    buttonRadius:    v.optional(v.string()),  // e.g. "9999px" | "0.5rem"
  },
  handler: async (ctx, { orgId, primaryColor, backgroundColor, textColor, fontFamily, buttonRadius }) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", orgId))
      .first();

    if (!org) {
      console.warn(`[VolooAI] updateStorefrontTheme: org "${orgId}" not found`);
      return { success: false, message: "Organization not found.", applied: {} };
    }

    // Read existing themeSettings, fall back to defaults
    const existing = org.themeSettings ?? {
      primaryColor:    "#ffffff",
      backgroundColor: "#0f0f0f",
      textColor:       "#f5f5f5",
      fontFamily:      "Inter",
      buttonRadius:    "0.5rem",
    };

    // Merge — only overwrite keys the AI explicitly provided
    const merged = {
      primaryColor:    primaryColor    ?? existing.primaryColor,
      backgroundColor: backgroundColor ?? existing.backgroundColor,
      textColor:       textColor       ?? existing.textColor,
      fontFamily:      fontFamily      ?? existing.fontFamily,
      buttonRadius:    buttonRadius    ?? existing.buttonRadius,
    };

    await ctx.db.patch(org._id, {
      themeSettings: merged,
      updatedAt: Date.now(),
    });

    const changed = Object.entries({ primaryColor, backgroundColor, textColor, fontFamily, buttonRadius })
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");

    console.log(`🎨 [VolooAI] themeSettings updated for org "${orgId}": ${changed}`);

    return {
      success: true,
      message: `Theme updated: ${changed}. Changes are live on the customer menu.`,
      applied: merged,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// broadcastStorefrontAlert — VolooAI Megaphone.
//
// Writes a real-time alert string to the organizations document.
// The customer-facing menu page reads this via Convex's live reactivity and
// renders it as a sticky banner the instant it is non-empty.
//
// Pass alertMessage: "" to clear the alert and hide the banner.
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// getAdminChatHistory — reactive query for the text chat UI.
//
// Returns the last `limit` messages for the org ordered by timestamp desc,
// then reversed client-side so newest is at the bottom of the chat window.
// ─────────────────────────────────────────────────────────────────────────────
export const getAdminChatHistory = query({
  args: {
    orgId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { orgId, limit = 60 }) => {
    const rows = await ctx.db
      .query("adminChats")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(limit);
    // Return oldest first so the chat UI renders top→bottom
    return rows.reverse().map((r) => ({
      id: r._id,
      role: r.role,
      message: r.message,
      actionExecuted: r.actionExecuted,
      timestamp: r.timestamp,
    }));
  },
});

export const broadcastStorefrontAlert = mutation({
  args: {
    orgId:        v.string(),
    alertMessage: v.string(), // empty string = clear
  },
  handler: async (ctx, { orgId, alertMessage }) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", orgId))
      .first();

    if (!org) {
      console.warn(`[VolooAI] broadcastStorefrontAlert: org "${orgId}" not found`);
      return { success: false, message: "Organization not found." };
    }

    // Store null when clearing so the field is cleanly absent rather than ""
    await ctx.db.patch(org._id, {
      storefrontAlert: alertMessage.trim() || undefined,
      updatedAt: Date.now(),
    });

    const action = alertMessage.trim() ? "broadcast" : "cleared";
    console.log(
      `📢 [VolooAI] Alert ${action} for org "${orgId}": "${alertMessage.slice(0, 80)}"`,
    );

    return {
      success: true,
      message: alertMessage.trim()
        ? `Alert broadcasted: "${alertMessage}" — visible to all customers now.`
        : "Alert cleared. The banner has been removed from the customer menu.",
    };
  },
});
