// convex/aiTrainingLogs.ts
// ─────────────────────────────────────────────────────────────────────────────
// AI Training Data Flywheel — Backend Operations
//
// This module is the storage adapter for the Gemini Supervised Fine-Tuning
// (SFT) pipeline. It receives telemetry from the harvest endpoint after every
// real guest interaction and stores it in a format that can be directly
// serialized into a Gemini SFT JSONL file.
//
// JSONL target format (one row = one training example):
//   {
//     "systemInstruction": { "role": "system", "parts": [{ "text": "…" }] },
//     "contents": [
//       { "role": "user",  "parts": [{ "text": "…" }] },
//       { "role": "model", "parts": [{ "text": "…" }] }
//     ]
//   }
//
// Nootype categories (4 cognitive archetypes — drives behavioral tuning):
//   "form"       — Aesthetics, presentation, prestige, visual structure.
//   "overcoming" — Challenge, intensity, bold flavors, pushing limits.
//   "relaxation" — Frictionless ease, zero cognitive load, comfort.
//   "management" — Control, data, granular options, precise breakdowns.
// ─────────────────────────────────────────────────────────────────────────────

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ─────────────────────────────────────────────────────────────────────────────
// Shared validator for a single SFT content turn
// ─────────────────────────────────────────────────────────────────────────────
const sftTurnValidator = v.object({
  role: v.union(v.literal("user"), v.literal("model")),
  parts: v.array(v.object({ text: v.string() })),
});

// ─────────────────────────────────────────────────────────────────────────────
// ingestTurn
//
// Called by POST /api/ai/harvest immediately after every Gemini response.
// Inserts one training record per completed exchange.
//
// The `contents` array already arrives in SFT-ready format from the
// harvest endpoint — the chat route handles the "assistant" → "model"
// role translation before calling this.
// ─────────────────────────────────────────────────────────────────────────────
export const ingestTurn = mutation({
  args: {
    cafeId: v.string(),
    sessionId: v.string(),
    systemInstruction: v.string(),
    contents: v.array(sftTurnValidator),
    rawModelJson: v.string(),
    positiveSignal: v.boolean(),
    nootype: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("ai_training_logs", {
      cafeId: args.cafeId,
      sessionId: args.sessionId,
      systemInstruction: args.systemInstruction,
      contents: args.contents,
      rawModelJson: args.rawModelJson,
      positiveSignal: args.positiveSignal,
      nootype: args.nootype,
      exportedAt: undefined, // null until export job runs
      timestamp: Date.now(),
    });

    console.log(
      `📊 [SFT] Training turn logged — cafeId="${args.cafeId}" ` +
        `session="${args.sessionId.slice(0, 8)}…" ` +
        `nootype="${args.nootype ?? "unknown"}" ` +
        `turns=${args.contents.length} ` +
        `positive=${args.positiveSignal}`,
    );

    return { id };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// updateSignal
//
// Called by PATCH /api/ai/harvest when checkout completion is detected
// for a session AFTER the original training turn was already logged.
// Updates positiveSignal and optionally the nootype for all turns in
// the session.
// ─────────────────────────────────────────────────────────────────────────────
export const updateSignal = mutation({
  args: {
    cafeId: v.string(),
    sessionId: v.string(),
    positiveSignal: v.boolean(),
    nootype: v.optional(v.string()),
  },
  handler: async (ctx, { cafeId, sessionId, positiveSignal, nootype }) => {
    const rows = await ctx.db
      .query("ai_training_logs")
      .withIndex("byCafeAndSession", (q) =>
        q.eq("cafeId", cafeId).eq("sessionId", sessionId),
      )
      .collect();

    if (rows.length === 0) {
      console.warn(
        `[SFT] updateSignal: no training rows found for ` +
          `cafeId="${cafeId}" sessionId="${sessionId}"`,
      );
      return { updated: 0 };
    }

    await Promise.all(
      rows.map((row) =>
        ctx.db.patch(row._id, {
          positiveSignal,
          // Only overwrite nootype if a value is provided
          ...(nootype !== undefined ? { nootype } : {}),
        }),
      ),
    );

    console.log(
      `✅ [SFT] Signal updated for session "${sessionId.slice(0, 8)}…" ` +
        `(${rows.length} row(s)) — positiveSignal=${positiveSignal} ` +
        `nootype="${nootype ?? "—"}"`,
    );

    return { updated: rows.length };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// listForExport
//
// Read-only query for the admin export pipeline. Returns all un-exported
// training rows for a given cafe, ordered oldest-first, in a shape that
// can be directly JSON.stringify()'d into a JSONL line:
//
//   JSON.stringify({
//     systemInstruction: { role: "system", parts: [{ text: row.systemInstruction }] },
//     contents: row.contents,
//   }) + "\n"
//
// Optional filters:
//   onlyPositive  — restrict to verified checkout sessions
//   nootype       — restrict to a specific Nootype archetype
//   limit         — cap rows returned (default 1000)
// ─────────────────────────────────────────────────────────────────────────────
export const listForExport = query({
  args: {
    orgId: v.string(),
    onlyPositive: v.optional(v.boolean()),
    nootype: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { orgId, onlyPositive, nootype, limit = 1000 }) => {
    // 1. Resolve org slug from orgId
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", orgId))
      .unique();
    if (!org) return [];
    const cafeId = org.slug;

    let rows = await ctx.db
      .query("ai_training_logs")
      // Only return rows that have NOT been exported yet
      .withIndex("byExported", (q) =>
        q.eq("cafeId", cafeId).eq("exportedAt", undefined),
      )
      .order("asc")
      .take(limit);

    // Apply optional quality filters
    if (onlyPositive) {
      rows = rows.filter((r) => r.positiveSignal === true);
    }
    if (nootype) {
      rows = rows.filter((r) => r.nootype === nootype);
    }

    // Return in SFT JSONL-serializable shape
    return rows.map((row) => ({
      _id: row._id,
      cafeId: row.cafeId,
      sessionId: row.sessionId,
      nootype: row.nootype ?? null,
      positiveSignal: row.positiveSignal,
      timestamp: row.timestamp,
      // The two fields that directly compose the JSONL line:
      systemInstruction: {
        role: "system" as const,
        parts: [{ text: row.systemInstruction }],
      },
      contents: row.contents,
    }));
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// markExported
//
// Stamps a batch of row IDs with the current timestamp to mark them as
// included in a JSONL export. Subsequent listForExport calls will skip them.
// Call this after the JSONL file has been successfully written to GCS.
// ─────────────────────────────────────────────────────────────────────────────
export const markExported = mutation({
  args: {
    ids: v.array(v.id("ai_training_logs")),
  },
  handler: async (ctx, { ids }) => {
    const now = Date.now();
    await Promise.all(ids.map((id) => ctx.db.patch(id, { exportedAt: now })));
    console.log(`📦 [SFT] Marked ${ids.length} training row(s) as exported.`);
    return { marked: ids.length, exportedAt: now };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// getStats
//
// Dashboard-ready stats for the admin UI. Returns a per-nootype breakdown
// of total rows, positive signals, and export coverage for a given cafe.
// ─────────────────────────────────────────────────────────────────────────────
export const getStats = query({
  args: { orgId: v.string() },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db
      .query("organizations")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", orgId))
      .unique();
    if (!org) return null;
    const cafeId = org.slug;

    const allRows = await ctx.db
      .query("ai_training_logs")
      .withIndex("byCafe", (q) => q.eq("cafeId", cafeId))
      .collect();

    const NOOTYPES = [
      "form",
      "overcoming",
      "relaxation",
      "management",
    ] as const;

    const breakdown = NOOTYPES.map((nt) => {
      const rows = allRows.filter((r) => r.nootype === nt);
      return {
        nootype: nt,
        total: rows.length,
        positive: rows.filter((r) => r.positiveSignal).length,
        exported: rows.filter((r) => r.exportedAt !== undefined).length,
        pendingExport: rows.filter((r) => r.exportedAt === undefined).length,
      };
    });

    const unknown = allRows.filter((r) => !r.nootype);

    return {
      cafeId,
      total: allRows.length,
      positive: allRows.filter((r) => r.positiveSignal).length,
      exported: allRows.filter((r) => r.exportedAt !== undefined).length,
      breakdown,
      unknownNootype: unknown.length,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// listGlobalForExport
// ─────────────────────────────────────────────────────────────────────────────
export const listGlobalForExport = query({
  args: {
    onlyPositive: v.optional(v.boolean()),
    nootype: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { onlyPositive, nootype, limit = 5000 }) => {
    let rows = await ctx.db
      .query("ai_training_logs")
      .filter((q) => q.eq(q.field("exportedAt"), undefined)) // Filter out exported
      .order("asc")
      .take(limit);

    if (onlyPositive) {
      rows = rows.filter((r) => r.positiveSignal === true);
    }
    if (nootype) {
      rows = rows.filter((r) => r.nootype === nootype);
    }

    return rows.map((row) => ({
      _id: row._id,
      cafeId: row.cafeId,
      sessionId: row.sessionId,
      nootype: row.nootype ?? null,
      positiveSignal: row.positiveSignal,
      timestamp: row.timestamp,
      systemInstruction: {
        role: "system" as const,
        parts: [{ text: row.systemInstruction }],
      },
      contents: row.contents,
    }));
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// getGlobalStats
// ─────────────────────────────────────────────────────────────────────────────
export const getGlobalStats = query({
  args: {},
  handler: async (ctx) => {
    const allRows = await ctx.db.query("ai_training_logs").collect();

    const NOOTYPES = [
      "form",
      "overcoming",
      "relaxation",
      "management",
    ] as const;

    const breakdown = NOOTYPES.map((nt) => {
      const rows = allRows.filter((r) => r.nootype === nt);
      return {
        nootype: nt,
        total: rows.length,
        positive: rows.filter((r) => r.positiveSignal).length,
        exported: rows.filter((r) => r.exportedAt !== undefined).length,
        pendingExport: rows.filter((r) => r.exportedAt === undefined).length,
      };
    });

    const unknown = allRows.filter((r) => !r.nootype);

    return {
      total: allRows.length,
      positive: allRows.filter((r) => r.positiveSignal).length,
      exported: allRows.filter((r) => r.exportedAt !== undefined).length,
      breakdown,
      unknownNootype: unknown.length,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// getRecentLogs
//
// Read-only query for the admin UI to view raw training data in a Drawer.
// Returns the most recent 50 training logs, regardless of export status.
// ─────────────────────────────────────────────────────────────────────────────
export const getRecentLogs = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit = 50 }) => {
    const rows = await ctx.db
      .query("ai_training_logs")
      .order("desc")
      .take(limit);

    return rows.map((row) => ({
      _id: row._id,
      cafeId: row.cafeId,
      sessionId: row.sessionId,
      nootype: row.nootype,
      positiveSignal: row.positiveSignal,
      timestamp: row.timestamp,
      exportedAt: row.exportedAt,
      contents: row.contents,
      systemInstruction: row.systemInstruction,
      rawModelJson: row.rawModelJson,
    }));
  },
});
