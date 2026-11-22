// Technical audits of listed sites with Google PageSpeed Insights (Lighthouse
// run on Google's servers), for the jury.
//
// An admin starts a run from the review page (`request`); `run` calls the
// PageSpeed API for mobile and desktop in parallel and `save` stores a trimmed
// report (scores, lab and real-user metrics, top savings, failed checks, a
// final screenshot). Jurors read it in the Evaluate tool (`forJuror`); it is
// information for their judgement and never feeds a score.
//
// Env: PAGESPEED_API_KEY (Google Cloud, "PageSpeed Insights API"). Without it
// the API still answers, at a much lower shared quota.

import { ConvexError, v, type Infer } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireAdmin } from "./authHelpers";
import { currentJuror } from "./jury";
import { auditReport } from "./schema";

type Report = Infer<typeof auditReport>;
type Strategy = "mobile" | "desktop";

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
/** A run older than this is treated as lost (the action died), so a new one may start. */
const STALE_RUN_MS = 5 * 60_000;
const MAX_OPPORTUNITIES = 6;
const MAX_ISSUES = 40;

const auditRow = v.object({
  url: v.string(),
  status: v.union(v.literal("running"), v.literal("done"), v.literal("error")),
  error: v.union(v.string(), v.null()),
  requestedAt: v.number(),
  finishedAt: v.union(v.number(), v.null()),
  mobile: v.union(auditReport, v.null()),
  desktop: v.union(auditReport, v.null()),
});

function toRow(a: Doc<"siteAudits">) {
  return {
    url: a.url,
    status: a.status,
    error: a.error ?? null,
    requestedAt: a.requestedAt,
    finishedAt: a.finishedAt ?? null,
    mobile: a.mobile ?? null,
    desktop: a.desktop ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────────────────────────────────────

/** Start (or restart) the audit of a listing's site. */
export const request = mutation({
  args: { listingId: v.id("listings") },
  returns: v.null(),
  handler: async (ctx, { listingId }) => {
    await requireAdmin(ctx);
    const listing = await ctx.db.get(listingId);
    if (!listing) throw new ConvexError("Listing not found.");
    const now = Date.now();
    const existing = await ctx.db
      .query("siteAudits")
      .withIndex("by_listing", (q) => q.eq("listingId", listingId))
      .unique();
    if (existing?.status === "running" && now - existing.requestedAt < STALE_RUN_MS) {
      throw new ConvexError("An audit of this site is already running.");
    }
    if (existing) {
      await ctx.db.patch(existing._id, { url: listing.url, status: "running", error: undefined, requestedAt: now });
    } else {
      await ctx.db.insert("siteAudits", { listingId, url: listing.url, status: "running", requestedAt: now });
    }
    await ctx.scheduler.runAfter(0, internal.audits.run, { listingId, url: listing.url });
    return null;
  },
});

/** The latest audit of a listing, for the review page. */
export const forListing = query({
  args: { listingId: v.id("listings") },
  returns: v.union(auditRow, v.null()),
  handler: async (ctx, { listingId }) => {
    await requireAdmin(ctx);
    const a = await ctx.db
      .query("siteAudits")
      .withIndex("by_listing", (q) => q.eq("listingId", listingId))
      .unique();
    return a ? toRow(a) : null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Jury
// ─────────────────────────────────────────────────────────────────────────────

/** The audit of a listed site, for jurors only; null for anyone else or when there is none. */
export const forJuror = query({
  args: { slug: v.string() },
  returns: v.union(auditRow, v.null()),
  handler: async (ctx, { slug }) => {
    if (!(await currentJuror(ctx))) return null;
    const listing = await ctx.db
      .query("listings")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!listing) return null;
    const a = await ctx.db
      .query("siteAudits")
      .withIndex("by_listing", (q) => q.eq("listingId", listing._id))
      .unique();
    return a ? toRow(a) : null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Running it
// ─────────────────────────────────────────────────────────────────────────────

export const run = internalAction({
  args: { listingId: v.id("listings"), url: v.string() },
  returns: v.null(),
  handler: async (ctx, { listingId, url }) => {
    const results = await Promise.allSettled([pageSpeed(url, "mobile"), pageSpeed(url, "desktop")]);
    const [mobile, desktop] = results.map((r) => (r.status === "fulfilled" ? r.value : null));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    await ctx.runMutation(internal.audits.save, {
      listingId,
      mobile: mobile ?? undefined,
      desktop: desktop ?? undefined,
      error: failed ? String(failed.reason instanceof Error ? failed.reason.message : failed.reason) : undefined,
    });
    return null;
  },
});

export const save = internalMutation({
  args: {
    listingId: v.id("listings"),
    mobile: v.optional(auditReport),
    desktop: v.optional(auditReport),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { listingId, mobile, desktop, error }) => {
    const row = await ctx.db
      .query("siteAudits")
      .withIndex("by_listing", (q) => q.eq("listingId", listingId))
      .unique();
    if (!row) return null;
    const ok = Boolean(mobile || desktop);
    await ctx.db.patch(row._id, {
      status: ok ? "done" : "error",
      // A partial run (one strategy failed) keeps the other strategy's old report.
      mobile: mobile ?? (ok ? row.mobile : undefined),
      desktop: desktop ?? (ok ? row.desktop : undefined),
      error: error?.slice(0, 500),
      finishedAt: Date.now(),
    });
    return null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// PageSpeed Insights → Report
// ─────────────────────────────────────────────────────────────────────────────

type LhAudit = {
  title?: string;
  score?: number | null;
  scoreDisplayMode?: string;
  numericValue?: number;
  details?: { type?: string; overallSavingsMs?: number; items?: unknown[]; data?: string };
};
type LhCategory = { score?: number | null; auditRefs?: { id: string; weight?: number }[] };
type PsiResponse = {
  error?: { message?: string };
  lighthouseResult?: {
    lighthouseVersion?: string;
    runtimeError?: { message?: string };
    categories?: Record<string, LhCategory | undefined>;
    audits?: Record<string, LhAudit | undefined>;
  };
  loadingExperience?: {
    overall_category?: string;
    metrics?: Record<string, { percentile?: number } | undefined>;
  };
};

async function pageSpeed(url: string, strategy: Strategy): Promise<Report> {
  const params = new URLSearchParams({ url, strategy });
  for (const c of ["performance", "accessibility", "best-practices", "seo"]) params.append("category", c);
  const key = process.env.PAGESPEED_API_KEY;
  if (key) params.set("key", key);
  const res = await fetch(`${ENDPOINT}?${params.toString()}`);
  const body = (await res.json().catch(() => ({}))) as PsiResponse;
  if (!res.ok) {
    const message = body.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 429 || /quota/i.test(message)) {
      throw new Error(
        key
          ? "Google's daily PageSpeed quota for our key is used up. Try again tomorrow."
          : "Google's shared PageSpeed quota is used up. Set PAGESPEED_API_KEY on this Convex deployment.",
      );
    }
    throw new Error(`PageSpeed ${strategy}: ${message}`);
  }
  const lh = body.lighthouseResult;
  if (!lh) throw new Error(`PageSpeed ${strategy}: no Lighthouse result`);
  if (lh.runtimeError?.message && !lh.categories?.performance?.score) {
    throw new Error(`PageSpeed ${strategy}: ${lh.runtimeError.message}`);
  }
  return toReport(lh, body.loadingExperience);
}

const pct = (score: number | null | undefined) => (typeof score === "number" ? Math.round(score * 100) : null);
const num = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null);

function toReport(
  lh: NonNullable<PsiResponse["lighthouseResult"]>,
  field: PsiResponse["loadingExperience"],
): Report {
  const audits = lh.audits ?? {};
  const cats = lh.categories ?? {};
  const metric = (id: string) => num(audits[id]?.numericValue);

  const opportunities = Object.values(audits)
    .filter((a): a is LhAudit => !!a && a.details?.type === "opportunity" && (a.details.overallSavingsMs ?? 0) >= 100)
    .sort((a, b) => (b.details?.overallSavingsMs ?? 0) - (a.details?.overallSavingsMs ?? 0))
    .slice(0, MAX_OPPORTUNITIES)
    .map((a) => ({ title: a.title ?? "Untitled", savingsMs: Math.round(a.details?.overallSavingsMs ?? 0) }));

  const issues: Report["issues"] = [];
  for (const category of ["accessibility", "best-practices", "seo"] as const) {
    for (const ref of cats[category]?.auditRefs ?? []) {
      // Zero-weight checks don't affect the score; listing them next to a 100 confuses jurors.
      if (!ref.weight) continue;
      const a = audits[ref.id];
      if (!a || a.scoreDisplayMode === "notApplicable" || a.scoreDisplayMode === "manual") continue;
      if (a.scoreDisplayMode === "informative") continue;
      if (typeof a.score === "number" && a.score < 0.9 && a.title) issues.push({ category, title: a.title });
    }
  }

  const fm = field?.metrics;
  const fieldPct = (k: string) => (typeof fm?.[k]?.percentile === "number" ? fm[k]!.percentile! : null);
  const hasField = !!fm && Object.keys(fm).length > 0;

  const shot = audits["final-screenshot"]?.details?.data;
  return {
    scores: {
      performance: pct(cats.performance?.score),
      accessibility: pct(cats.accessibility?.score),
      bestPractices: pct(cats["best-practices"]?.score),
      seo: pct(cats.seo?.score),
    },
    lab: {
      fcp: metric("first-contentful-paint"),
      lcp: metric("largest-contentful-paint"),
      tbt: metric("total-blocking-time"),
      cls: metric("cumulative-layout-shift"),
      speedIndex: metric("speed-index"),
      ttfb: metric("server-response-time"),
    },
    field: hasField
      ? {
          category: field?.overall_category ?? "NONE",
          lcp: fieldPct("LARGEST_CONTENTFUL_PAINT_MS"),
          // CrUX reports CLS × 100.
          cls: fieldPct("CUMULATIVE_LAYOUT_SHIFT_SCORE") === null ? null : fieldPct("CUMULATIVE_LAYOUT_SHIFT_SCORE")! / 100,
          inp: fieldPct("INTERACTION_TO_NEXT_PAINT"),
          fcp: fieldPct("FIRST_CONTENTFUL_PAINT_MS"),
          ttfb: fieldPct("EXPERIMENTAL_TIME_TO_FIRST_BYTE"),
        }
      : null,
    pageBytes: metric("total-byte-weight"),
    requests: Array.isArray(audits["network-requests"]?.details?.items)
      ? audits["network-requests"]!.details!.items!.length
      : null,
    opportunities,
    issues: issues.slice(0, MAX_ISSUES),
    // Skip oversized screenshots so a row stays well under Convex's 1 MB document limit.
    screenshot: shot && shot.startsWith("data:image/") && shot.length < 200_000 ? shot : undefined,
    lighthouseVersion: lh.lighthouseVersion ?? "",
  };
}
