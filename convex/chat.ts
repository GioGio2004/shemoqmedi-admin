/**
 * convex/chat.ts  (shemoqmedi-admin)
 * ─────────────────────────────────────────────────────────────────────────────
 * Multi-tenant AI chat — consolidated into the admin Convex deployment so
 * every Shemoqmedi cafe shares a single backend with strict per-cafe isolation.
 *
 * Tables used (defined in schema.ts):
 *   chatSessions  — one row per anonymous visitor session (scoped to cafeId)
 *   chatMessages  — one row per chat turn (user or assistant)
 *   chatRatings   — star ratings submitted after 4+ messages
 *
 * Isolation model:
 *   cafeId = the org's URL slug (e.g. "karabak").
 *   All queries are filtered by (sessionId + cafeId) so even if two cafes
 *   somehow share a UUID, their histories never leak between tenants.
 *
 * Data flow in VolooAI (frontend):
 *   1. Browser generates a UUID → localStorage("voloo_session_id")
 *   2. useQuery(api.chat.getMessages, { sessionId, cafeId }) → live stream
 *   3. sendMessage called twice per exchange: user turn, then assistant turn
 *   4. submitRating called once when user taps a star (≥4 messages seen)
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** 7-day TTL for anonymous sessions (ms). Not enforced server-side in Phase 1
 *  but stored for future cron-based cleanup. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// getMessages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the full chat history for a given (sessionId, cafeId) pair,
 * ordered oldest → newest.
 *
 * This is a Convex *query*, meaning the client receives live updates any
 * time a new message is inserted — no polling needed.
 *
 * Usage in React (VolooAI component):
 *   const messages = useQuery(api.chat.getMessages, { sessionId, cafeId });
 */
export const getMessages = query({
  args: {
    sessionId: v.string(), // UUID from localStorage
    cafeId:    v.string(), // org slug — tenant isolation key
  },
  handler: async (ctx, { sessionId, cafeId }) => {
    return await ctx.db
      .query("chatMessages")
      // Compound index scan — O(messages in session), not O(all messages)
      .withIndex("bySession", (q) =>
        q.eq("sessionId", sessionId).eq("cafeId", cafeId)
      )
      .order("asc") // oldest → newest (matches chat UI scroll direction)
      .collect();
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// sendMessage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inserts a single chat turn (user or assistant) into `chatMessages`.
 *
 * On the very first message in a session it also upserts a row in
 * `chatSessions` so we track session lifecycle for analytics / future cleanup.
 *
 * Called from VolooAI's sendMessage() function:
 *   — Once with role="user"      (the visitor's prompt)
 *   — Once with role="assistant" (Gemini's reply + optional productIds)
 *
 * Usage in React:
 *   const save = useMutation(api.chat.sendMessage);
 *   await save({ sessionId, cafeId, role: "user", content: "..." });
 */
export const sendMessage = mutation({
  args: {
    sessionId: v.string(),
    cafeId:    v.string(),
    role:      v.union(v.literal("user"), v.literal("assistant")),
    content:   v.string(),
    /**
     * Integer product IDs returned by Gemini — only on assistant messages.
     * The frontend maps these to the localizedProducts prop to render
     * ProductCard recommendation rows inline in the chat.
     */
    products:  v.optional(v.array(v.number())),
  },
  handler: async (ctx, { sessionId, cafeId, role, content, products }) => {
    const now = Date.now();

    // ── 1. Upsert session record (idempotent on first message) ───────────────
    const existingSession = await ctx.db
      .query("chatSessions")
      .withIndex("bySessionId", (q) => q.eq("sessionId", sessionId))
      .first();

    if (!existingSession) {
      await ctx.db.insert("chatSessions", {
        sessionId,
        cafeId,
        createdAt: now,
        expiresAt: now + SESSION_TTL_MS,
      });
    }

    // ── 2. Insert the chat turn ──────────────────────────────────────────────
    await ctx.db.insert("chatMessages", {
      sessionId,
      cafeId,
      role,
      content,
      // Only include `products` for assistant messages that carry IDs;
      // omit entirely for user messages to keep rows lean.
      ...(products && products.length > 0 ? { products } : {}),
      timestamp: now,
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// submitRating
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Records a 1-5 star rating for the AI experience.
 * The frontend shows this UI after the visitor has seen ≥4 messages.
 * Stored in `chatRatings` for the cafe owner to view in their dashboard.
 *
 * Usage in React:
 *   const rate = useMutation(api.chat.submitRating);
 *   await rate({ sessionId, cafeId, rating: 5 });
 */
export const submitRating = mutation({
  args: {
    sessionId: v.string(),
    cafeId:    v.string(),
    rating:    v.number(), // 1–5
  },
  handler: async (ctx, { sessionId, cafeId, rating }) => {
    await ctx.db.insert("chatRatings", {
      sessionId,
      cafeId,
      rating,
      timestamp: Date.now(),
    });
  },
});
