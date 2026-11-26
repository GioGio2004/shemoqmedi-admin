// Quick submission: a site's name, link and the submitter's email, in one
// mobile-first screen (the site's /submit).
//
//   start     - no account needed. Saves an "unverified" pre-submission and
//               returns its id; the browser keeps a random secret whose hash
//               is stored, so only that browser can finalize it.
//   finalize  - after email-code (or Google) sign-in: ties it to the account
//               and marks it "confirmed". Already signed-in people call it
//               right after start.
//   track     - funnel steps that happen in the browser (form start,
//               verification start, verified). The server counts the rest.
//
// The editorial team turns a confirmed submission into a listing from the
// admin's Add site form (admin.createListing with quickId), with their own
// screenshots. Unverified rows expire after QUICK_TTL (crons.ts).

import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { requireAdmin, requireUser } from "./authHelpers";
import { cleanText, normalizeUrl } from "./lib/listingHelpers";
import { checkDomain, domainKey } from "./lib/domains";
import { isEmail } from "./lib/contacts";
import { getConfig } from "./lib/config";
import { limitKey } from "./lib/rateLimit";
import { tbilisiDay } from "./lib/time";
import { LIMITS } from "./lib/taxonomy";
import { pushAdmins } from "./push";
import { adminUrl } from "../lib/hosts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** An unverified pre-submission is kept this long, then deleted. */
export const QUICK_TTL = 2 * DAY;
/** Confirmed submissions waiting for the editors, per account. */
const MAX_OPEN_PER_USER = 5;

const TOKEN = /^[a-f0-9]{64}$/;

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const FUNNEL_EVENTS = ["form_start", "presubmit", "verify_start", "verify_success", "finalized"] as const;
type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

async function count(ctx: MutationCtx, event: FunnelEvent) {
  const day = tbilisiDay(Date.now());
  const row = await ctx.db
    .query("funnelCounts")
    .withIndex("by_day_event", (q) => q.eq("day", day).eq("event", event))
    .unique();
  if (row) await ctx.db.patch(row._id, { count: row.count + 1 });
  else await ctx.db.insert("funnelCounts", { day, event, count: 1 });
}

function cleanEmail(raw: string) {
  const email = raw.trim().toLowerCase();
  if (!isEmail(email) || email.length > 254) throw new ConvexError("Enter a valid email address.");
  return email;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public (the site)
// ─────────────────────────────────────────────────────────────────────────────

/** Save the pre-submission. Safe to call again for the same site and email: the row is reused. */
export const start = mutation({
  args: {
    name: v.string(),
    url: v.string(),
    email: v.string(),
    token: v.string(), // 64 hex chars, made in the browser
    source: v.optional(v.string()),
    website: v.optional(v.string()), // honeypot: a hidden field people never fill
  },
  returns: v.object({ id: v.id("quickSubmissions") }),
  handler: async (ctx, args) => {
    if (!TOKEN.test(args.token)) throw new ConvexError("Something went wrong. Please reload the page and try again.");
    const name = cleanText(args.name, "Site name", LIMITS.title);
    const url = normalizeUrl(args.url);
    const email = cleanEmail(args.email);
    const domain = domainKey(url);
    const now = Date.now();

    // Bots fill the hidden field: store nothing.
    if (args.website?.trim()) throw new ConvexError("Something went wrong. Please try again.");

    // No account yet, so limits are per email, per site and overall.
    await limitKey(ctx, `quick:email:${email}`, 6, DAY, "Too many submissions from this email today. Please try again tomorrow.", now);
    await limitKey(ctx, `quick:domain:${domain}`, 6, DAY, "This site was submitted several times today. We have it, thank you.", now);
    await limitKey(ctx, "quick:all", 300, HOUR, "We're getting a lot of submissions right now. Please try again in a few minutes.", now);

    // Already listed (or recently): same rules as the full form.
    const config = await getConfig(ctx);
    const check = await checkDomain(ctx, url, { resubmitMonths: config.resubmitMonths, now });
    if (!check.ok) throw new ConvexError(check.reason);

    const tokenHash = await sha256(args.token);
    const same = await ctx.db
      .query("quickSubmissions")
      .withIndex("by_domain", (q) => q.eq("domain", domain))
      .collect();
    const waiting = same.find((r) => r.status === "confirmed");
    if (waiting) throw new ConvexError("This site is already submitted and waiting for review. We'll be in touch.");
    const mine = same.find((r) => r.status === "unverified" && r.email === email);
    const source = args.source?.trim().slice(0, 60) || undefined;
    if (mine) {
      // Same person again (another tab, came back later): refresh it for this browser.
      await ctx.db.patch(mine._id, { name, url, tokenHash, source, expiresAt: now + QUICK_TTL });
      return { id: mine._id };
    }
    const id = await ctx.db.insert("quickSubmissions", {
      name,
      url,
      domain,
      email,
      tokenHash,
      status: "unverified",
      source,
      createdAt: now,
      expiresAt: now + QUICK_TTL,
    });
    await count(ctx, "presubmit");
    return { id };
  },
});

/** After sign-in: tie the pre-submission to the account and confirm it. Idempotent. */
export const finalize = mutation({
  args: { id: v.id("quickSubmissions"), token: v.string() },
  returns: v.object({ name: v.string() }),
  handler: async (ctx, { id, token }) => {
    const user = await requireUser(ctx);
    const row = await ctx.db.get(id);
    if (!row || !TOKEN.test(token) || row.tokenHash !== (await sha256(token))) {
      throw new ConvexError("This submission has expired. Please submit the site again.");
    }
    if (row.status !== "unverified") {
      if (row.userId === user._id) return { name: row.name }; // a second tab or a retry
      throw new ConvexError("This submission has already been sent.");
    }
    if (row.expiresAt < Date.now()) throw new ConvexError("This submission has expired. Please submit the site again.");

    const open = await ctx.db
      .query("quickSubmissions")
      .withIndex("by_status", (q) => q.eq("status", "confirmed"))
      .collect();
    if (open.filter((r) => r.userId === user._id).length >= MAX_OPEN_PER_USER) {
      throw new ConvexError(`You already have ${MAX_OPEN_PER_USER} sites waiting for review. Please wait for a decision first.`);
    }
    // Someone else confirmed the same site meanwhile.
    const taken = (
      await ctx.db
        .query("quickSubmissions")
        .withIndex("by_domain", (q) => q.eq("domain", row.domain))
        .collect()
    ).find((r) => r._id !== id && r.status === "confirmed");
    if (taken) throw new ConvexError("This site is already submitted and waiting for review. We'll be in touch.");

    // The account's own (verified) email is the one we write to from now on.
    await ctx.db.patch(id, {
      status: "confirmed",
      userId: user._id,
      email: user.email.trim().toLowerCase(),
      confirmedAt: Date.now(),
    });
    await count(ctx, "finalized");
    await pushAdmins(ctx, {
      title: "New site submitted",
      body: `${row.name} · ${row.url.replace(/^https?:\/\//, "")}`,
      url: adminUrl("/review/quick"),
      tag: `quick-${id}`,
    });
    return { name: row.name };
  },
});

/**
 * The pre-submission behind a draft, for the browser holding its secret: lets
 * a page opened in another browser (Instagram → Safari) pick up where it was.
 */
export const peek = query({
  args: { id: v.string(), token: v.string() },
  returns: v.union(v.null(), v.object({ name: v.string(), url: v.string(), email: v.string(), status: v.string() })),
  handler: async (ctx, { id, token }) => {
    const qid = ctx.db.normalizeId("quickSubmissions", id);
    const r = qid ? await ctx.db.get(qid) : null;
    if (!r || !TOKEN.test(token) || r.tokenHash !== (await sha256(token))) return null;
    if (r.status === "unverified" && r.expiresAt < Date.now()) return null;
    return { name: r.name, url: r.url, email: r.email, status: r.status };
  },
});

/** Funnel steps that happen in the browser. */
export const track = mutation({
  args: { event: v.union(v.literal("form_start"), v.literal("verify_start"), v.literal("verify_success")) },
  returns: v.null(),
  handler: async (ctx, { event }) => {
    await limitKey(ctx, `funnel:${event}`, 5000, HOUR, "Slow down.");
    await count(ctx, event);
    return null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────────────────────────────────────

const row = v.object({
  id: v.id("quickSubmissions"),
  name: v.string(),
  url: v.string(),
  email: v.string(),
  status: v.union(v.literal("unverified"), v.literal("confirmed"), v.literal("listed"), v.literal("dismissed")),
  userName: v.union(v.string(), v.null()),
  listingId: v.union(v.id("listings"), v.null()),
  source: v.union(v.string(), v.null()),
  createdAt: v.number(),
  confirmedAt: v.union(v.number(), v.null()),
});

/** Quick submissions by status, newest first. */
export const adminList = query({
  args: { status: v.union(v.literal("unverified"), v.literal("confirmed"), v.literal("listed"), v.literal("dismissed")) },
  returns: v.array(row),
  handler: async (ctx, { status }) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("quickSubmissions")
      .withIndex("by_status", (q) => q.eq("status", status))
      .order("desc")
      .take(200);
    return await Promise.all(
      rows.map(async (r) => {
        const user = r.userId ? await ctx.db.get(r.userId) : null;
        return {
          id: r._id,
          name: r.name,
          url: r.url,
          email: r.email,
          status: r.status,
          userName: user?.name ?? null,
          listingId: r.listingId ?? null,
          source: r.source ?? null,
          createdAt: r.createdAt,
          confirmedAt: r.confirmedAt ?? null,
        };
      }),
    );
  },
});

/** One confirmed submission, to prefill the Add site form (?quick=<id>). */
export const forListing = query({
  args: { id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      id: v.id("quickSubmissions"),
      name: v.string(),
      url: v.string(),
      owner: v.union(v.null(), v.object({ id: v.id("users"), name: v.string(), email: v.string() })),
    }),
  ),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const qid = ctx.db.normalizeId("quickSubmissions", id);
    const r = qid ? await ctx.db.get(qid) : null;
    if (!r || r.status !== "confirmed") return null;
    const user = r.userId ? await ctx.db.get(r.userId) : null;
    return {
      id: r._id,
      name: r.name,
      url: r.url,
      owner: user ? { id: user._id, name: user.name, email: user.email } : null,
    };
  },
});

export const dismiss = mutation({
  args: { id: v.id("quickSubmissions") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const r = await ctx.db.get(id);
    if (r && r.status !== "listed") await ctx.db.patch(id, { status: "dismissed" });
    return null;
  },
});

/** Funnel counts over the last `days` days (Tbilisi days), oldest first. */
export const funnel = query({
  args: { days: v.number() },
  returns: v.object({
    totals: v.record(v.string(), v.number()),
    byDay: v.array(v.object({ day: v.string(), counts: v.record(v.string(), v.number()) })),
  }),
  handler: async (ctx, { days }) => {
    await requireAdmin(ctx);
    const n = Math.max(1, Math.min(90, Math.round(days)));
    const totals: Record<string, number> = Object.fromEntries(FUNNEL_EVENTS.map((e) => [e, 0]));
    const byDay = [];
    for (let i = n - 1; i >= 0; i--) {
      const day = tbilisiDay(Date.now() - i * DAY);
      const counts: Record<string, number> = Object.fromEntries(FUNNEL_EVENTS.map((e) => [e, 0]));
      const rows = await ctx.db
        .query("funnelCounts")
        .withIndex("by_day_event", (q) => q.eq("day", day))
        .collect();
      for (const r of rows) {
        counts[r.event] = r.count;
        totals[r.event] = (totals[r.event] ?? 0) + r.count;
      }
      byDay.push({ day, counts });
    }
    return { totals, byDay };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Expiry (crons.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** Delete unverified pre-submissions past their expiry. The funnel counts stay. */
export const expire = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const old = await ctx.db
      .query("quickSubmissions")
      .withIndex("by_expires", (q) => q.eq("status", "unverified").lt("expiresAt", Date.now()))
      .take(500);
    for (const r of old) await ctx.db.delete(r._id);
    return old.length;
  },
});
