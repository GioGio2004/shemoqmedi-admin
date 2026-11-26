// Website submissions from the site's 30-second form (/submit).
//
// The submission comes first and never depends on an account:
//   submit   - public. Saves the submission permanently ("received"), from a
//              guest or a signed-in visitor. Idempotent on the browser's
//              secret, so double-clicks, retries and refreshes save it once.
//              Signed-in and the email is the account's: linked right away.
//   link     - signed in, after the optional sign-in on /submit/received.
//              Needs the secret reference (the browser's, or the one in the
//              confirmation email) AND the account's verified email to be the
//              submitted one; otherwise nothing is linked ("mismatch").
//   mine     - the signed-in account's linked submissions (dashboard).
//   track    - funnel steps that happen in the browser. No personal data.
//
// Linking proves the contact email, nothing more: ownership of the site still
// goes through claims and approval, and editors decide what gets listed.
//
// A submission becomes a listing two ways: an editor makes it (Add site,
// admin.createListing with quickId), or its signed-in creator fills in the
// site's full form (/submit/full, listings.submit), which completes their open
// submission of the same website instead of adding a second entry
// (lib/quickSubmissions.ts).

import { ConvexError, v } from "convex/values";
import { internalAction, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { requireAdmin, requireUser } from "./authHelpers";
import { getUserByExternalId } from "./users";
import { cleanText, normalizeUrl } from "./lib/listingHelpers";
import { checkDomain, domainKey } from "./lib/domains";
import { ALREADY_SUBMITTED, isOpenSubmission } from "./lib/quickSubmissions";
import { isEmail } from "./lib/contacts";
import { getConfig } from "./lib/config";
import { limitKey } from "./lib/rateLimit";
import { tbilisiDay } from "./lib/time";
import { LIMITS } from "./lib/taxonomy";
import { pushAdmins } from "./push";
import { deliver } from "./emails";
import { siteUrl } from "./seo";
import { adminUrl } from "../lib/hosts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TOKEN = /^[a-f0-9]{64}$/;

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** "an•••@gmail.com" */
function maskEmail(email: string) {
  const [user, host] = email.split("@");
  return `${user.slice(0, 2)}•••@${host}`;
}

const clip = (s: string | undefined, n: number) => s?.trim().slice(0, n) || undefined;

// ─────────────────────────────────────────────────────────────────────────────
// Funnel (first-party counters: event, day, source; never an email)
// ─────────────────────────────────────────────────────────────────────────────

/** Steps the browser reports. */
export const CLIENT_EVENTS = [
  "submission_page_viewed",
  "submission_form_started",
  "submission_form_completed",
  "submission_validation_failed",
  "post_submission_auth_viewed",
  "post_submission_auth_started",
  "post_submission_auth_completed",
  "post_submission_auth_failed",
  "post_submission_auth_skipped",
  "submission_dashboard_viewed",
] as const;
/** Steps the server records. */
export const SERVER_EVENTS = ["guest_submission_saved", "account_submission_saved", "submission_linked_to_account"] as const;

const vClientEvent = v.union(...CLIENT_EVENTS.map((e) => v.literal(e)));
type FunnelEvent = (typeof CLIENT_EVENTS)[number] | (typeof SERVER_EVENTS)[number];

const cleanSource = (s: string | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "")
    .slice(0, 40) || "direct";

async function count(ctx: MutationCtx, event: FunnelEvent, source: string | undefined) {
  const day = tbilisiDay(Date.now());
  const src = cleanSource(source);
  const row = await ctx.db
    .query("funnelCounts")
    .withIndex("by_day_event", (q) => q.eq("day", day).eq("event", event).eq("source", src))
    .unique();
  if (row) await ctx.db.patch(row._id, { count: row.count + 1 });
  else await ctx.db.insert("funnelCounts", { day, event, source: src, count: 1 });
}

const vAttribution = v.object({
  utmSource: v.optional(v.string()),
  utmMedium: v.optional(v.string()),
  utmCampaign: v.optional(v.string()),
  referrer: v.optional(v.string()),
  device: v.optional(v.union(v.literal("mobile"), v.literal("tablet"), v.literal("desktop"))),
  inApp: v.optional(v.string()),
});

/** Where a submission came from, for the funnel. */
const sourceOf = (a: { utmSource?: string; inApp?: string }) => a.utmSource || a.inApp || "direct";

/** The signed-in account, if any (a submission never requires one). */
async function currentUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  return identity ? await getUserByExternalId(ctx, identity.subject) : null;
}

/** The account's verified email (Clerk's primary address is always verified). */
const accountEmail = (u: Doc<"users">) => u.email.trim().toLowerCase();

// ─────────────────────────────────────────────────────────────────────────────
// Public
// ─────────────────────────────────────────────────────────────────────────────

/** Save a submission. Returns only its id and whether it's linked to the signed-in account. */
export const submit = mutation({
  args: {
    name: v.string(),
    url: v.string(),
    email: v.string(),
    token: v.string(), // 64 hex chars made by the browser, kept for linking
    website: v.optional(v.string()), // honeypot: hidden from people
    attribution: v.optional(vAttribution),
    // Ticked "I agree to the Terms" and the submission guidelines (optional only
    // so a site build older than the popup keeps working during a deploy).
    acceptedTerms: v.optional(v.boolean()),
  },
  returns: v.object({ id: v.id("quickSubmissions"), linked: v.boolean() }),
  handler: async (ctx, args) => {
    if (!TOKEN.test(args.token)) throw new ConvexError("Something went wrong. Please reload the page and try again.");
    if (args.website?.trim()) throw new ConvexError("Something went wrong. Please try again.");
    const tokenHash = await sha256(args.token);
    const user = await currentUser(ctx);

    // The same submit again (double-click, retry, refresh): the saved one.
    const again = await ctx.db
      .query("quickSubmissions")
      .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (again) return { id: again._id, linked: !!again.userId && again.userId === user?._id };

    const name = cleanText(args.name, "Site name", LIMITS.title);
    const url = normalizeUrl(args.url);
    const email = args.email.trim().toLowerCase();
    if (!isEmail(email) || email.length > 254) throw new ConvexError("Enter a valid email address.");
    const domain = domainKey(url);
    const now = Date.now();
    const a = args.attribution ?? {};
    const attribution = {
      utmSource: clip(a.utmSource, 60),
      utmMedium: clip(a.utmMedium, 60),
      utmCampaign: clip(a.utmCampaign, 80),
      referrer: clip(a.referrer, 120),
      device: a.device,
      inApp: clip(a.inApp, 30),
    };

    await limitKey(ctx, `quick:email:${email}`, 6, DAY, "Too many submissions from this email today. Please try again tomorrow.", now);
    await limitKey(ctx, `quick:domain:${domain}`, 6, DAY, "This site was submitted several times today. We have it, thank you.", now);
    await limitKey(ctx, "quick:all", 300, HOUR, "We're getting a lot of submissions right now. Please try again in a few minutes.", now);

    // Already listed (or listed recently): the same rules as everywhere else.
    const config = await getConfig(ctx);
    const check = await checkDomain(ctx, url, { resubmitMonths: config.resubmitMonths, now });
    if (!check.ok) throw new ConvexError(check.reason);

    // Already submitted and still open.
    const open = (
      await ctx.db
        .query("quickSubmissions")
        .withIndex("by_domain", (q) => q.eq("domain", domain))
        .collect()
    ).find(isOpenSubmission);
    if (open) {
      if (open.email !== email) throw new ConvexError(ALREADY_SUBMITTED);
      // The same email from another browser: it can view and link it too (never correct the email).
      const extra = [...new Set([...(open.extraTokenHashes ?? []), tokenHash])].slice(-5);
      await ctx.db.patch(open._id, {
        extraTokenHashes: extra,
        ...(args.acceptedTerms && !open.termsAcceptedAt ? { termsAcceptedAt: now } : {}),
        updatedAt: now,
      });
      const linkNow = !!user && !open.userId && accountEmail(user) === email;
      if (linkNow) await ctx.db.patch(open._id, { userId: user!._id, linkedAt: now });
      return { id: open._id, linked: (!!open.userId && open.userId === user?._id) || linkNow };
    }

    const linked = !!user && accountEmail(user) === email;
    const emailSecret = newSecret();
    const id = await ctx.db.insert("quickSubmissions", {
      name,
      url,
      domain,
      email,
      tokenHash,
      emailTokenHash: await sha256(emailSecret),
      status: "received",
      ...(linked ? { userId: user!._id, linkedAt: now } : {}),
      ...attribution,
      ...(args.acceptedTerms ? { termsAcceptedAt: now } : {}),
      createdAt: now,
      updatedAt: now,
    });
    const source = sourceOf(attribution);
    await count(ctx, user ? "account_submission_saved" : "guest_submission_saved", source);
    if (linked) await count(ctx, "submission_linked_to_account", source);

    // One "we got it" email per address a day at most (an email can't be used to flood someone).
    const recent = (
      await ctx.db
        .query("quickSubmissions")
        .withIndex("by_email", (q) => q.eq("email", email))
        .collect()
    ).filter((r) => r._id !== id && now - r.createdAt < DAY);
    if (recent.length === 0) {
      await ctx.scheduler.runAfter(0, internal.quickSubmit.confirm, { id, secret: emailSecret });
    }
    await pushAdmins(ctx, {
      title: linked ? "New site submitted" : "New guest submission",
      body: `${name} · ${url.replace(/^https?:\/\//, "")}`,
      url: adminUrl("/review/quick"),
      tag: `quick-${id}`,
    });
    return { id, linked };
  },
});

/**
 * For the browser holding a submission's secret (its own, or the one from the
 * confirmation email): the name and contact email, to prefill sign-in.
 * Nothing without the secret.
 */
export const prefill = query({
  args: { id: v.string(), token: v.string() },
  returns: v.union(
    v.null(),
    v.object({ name: v.string(), email: v.string(), linked: v.boolean(), canCorrect: v.boolean() }),
  ),
  handler: async (ctx, { id, token }) => {
    const r = await rowFor(ctx, id, token);
    if (!r) return null;
    return { name: r.name, email: r.email, linked: !!r.userId, canCorrect: correctable(r, await sha256(token)) };
  },
});

/** Whether this secret may fix the contact email (see correctEmail). */
function correctable(r: Doc<"quickSubmissions">, hash: string) {
  return (
    r.tokenHash === hash &&
    !r.userId &&
    (r.status === "received" || r.status === "preparing") &&
    Date.now() - r.createdAt <= DAY
  );
}

async function rowFor(ctx: QueryCtx, id: string, token: string) {
  if (!TOKEN.test(token)) return null;
  const qid = ctx.db.normalizeId("quickSubmissions", id);
  const r = qid ? await ctx.db.get(qid) : null;
  if (!r) return null;
  const hash = await sha256(token);
  return r.tokenHash === hash || r.emailTokenHash === hash || r.extraTokenHashes?.includes(hash) ? r : null;
}

/**
 * After sign-in: link the submission to this account, only if the account's
 * verified email is the submitted one. Returns what happened; never throws on
 * a mismatch, so the page can offer the way forward.
 */
export const link = mutation({
  args: { id: v.string(), token: v.string() },
  returns: v.object({
    status: v.union(v.literal("linked"), v.literal("mismatch"), v.literal("taken"), v.literal("not_found")),
    submittedEmail: v.union(v.string(), v.null()), // masked
  }),
  handler: async (ctx, { id, token }) => {
    const user = await requireUser(ctx);
    await limitKey(ctx, `quick:link:${user._id}`, 30, HOUR, "Too many attempts. Please try again later.");
    const r = await rowFor(ctx, id, token);
    if (!r) return { status: "not_found" as const, submittedEmail: null };
    if (r.userId === user._id) return { status: "linked" as const, submittedEmail: null };
    if (r.userId) return { status: "taken" as const, submittedEmail: null };
    if (accountEmail(user) !== r.email) return { status: "mismatch" as const, submittedEmail: maskEmail(r.email) };
    await ctx.db.patch(r._id, { userId: user._id, linkedAt: Date.now(), updatedAt: Date.now() });
    // A listing already made from it: the account is its submitter (emails; ownership stays with approval).
    if (r.listingId) {
      const listing = await ctx.db.get(r.listingId);
      if (listing && !listing.submittedBy) await ctx.db.patch(listing._id, { submittedBy: user._id });
    }
    await count(ctx, "submission_linked_to_account", sourceOf(r));
    return { status: "linked" as const, submittedEmail: null };
  },
});

/**
 * The submitter fixes a typo in the contact email before signing in. Only the
 * browser that created the submission can, within a day, while it's open and
 * not linked (not the emailed link, nor a browser that resubmitted it): it
 * changes an unverified contact, and linking still needs that address verified.
 */
export const correctEmail = mutation({
  args: { id: v.string(), token: v.string(), email: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, token, email: raw }) => {
    if (!TOKEN.test(token)) throw new ConvexError("Something went wrong. Please reload the page and try again.");
    const qid = ctx.db.normalizeId("quickSubmissions", id);
    const r = qid ? await ctx.db.get(qid) : null;
    if (!r || !correctable(r, await sha256(token))) {
      throw new ConvexError("This email can't be changed here any more. Sign in with the address you submitted with.");
    }
    const email = raw.trim().toLowerCase();
    if (!isEmail(email) || email.length > 254) throw new ConvexError("Enter a valid email address.");
    await limitKey(ctx, `quick:correct:${r._id}`, 5, DAY, "Too many changes. Please try again tomorrow.");
    if (email !== r.email) await ctx.db.patch(r._id, { email, updatedAt: Date.now() });
    return null;
  },
});

/** The signed-in account's linked submissions, newest first (dashboard). */
export const mine = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("quickSubmissions"),
      name: v.string(),
      url: v.string(),
      status: v.union(v.literal("received"), v.literal("preparing"), v.literal("listed"), v.literal("rejected")),
      createdAt: v.number(),
      listing: v.union(v.null(), v.object({ slug: v.string(), status: v.string() })),
    }),
  ),
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return [];
    const rows = await ctx.db
      .query("quickSubmissions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    rows.sort((x, y) => y.createdAt - x.createdAt);
    return await Promise.all(
      rows.map(async (r) => {
        const l = r.listingId ? await ctx.db.get(r.listingId) : null;
        return {
          id: r._id,
          name: r.name,
          url: r.url,
          status: r.status,
          createdAt: r.createdAt,
          listing: l ? { slug: l.slug, status: l.status } : null,
        };
      }),
    );
  },
});

/** Funnel steps that happen in the browser. */
export const track = mutation({
  args: { event: vClientEvent, source: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { event, source }) => {
    await limitKey(ctx, `funnel:${event}`, 5000, HOUR, "Slow down.");
    await count(ctx, event, source);
    return null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Confirmation email (Resend; sign-in emails are Clerk's)
// ─────────────────────────────────────────────────────────────────────────────

export const forEmail = internalQuery({
  args: { id: v.id("quickSubmissions") },
  returns: v.union(v.null(), v.object({ name: v.string(), url: v.string(), email: v.string(), linked: v.boolean() })),
  handler: async (ctx, { id }) => {
    const r = await ctx.db.get(id);
    return r ? { name: r.name, url: r.url, email: r.email, linked: !!r.userId } : null;
  },
});

/** "We got your project", once, with a private link to track it (sign-in is optional). */
export const confirm = internalAction({
  args: { id: v.id("quickSubmissions"), secret: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, secret }): Promise<null> => {
    const r = await ctx.runQuery(internal.quickSubmit.forEmail, { id });
    if (!r) return null;
    const base = siteUrl();
    const track = r.linked ? `${base}/account` : `${base}/submit/received?r=${id}&k=${secret}`;
    const text = [
      "Hi,",
      `Thanks for submitting ${r.name} (${r.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}). Your project is in.`,
      "Our editorial team reviews every site by hand and prepares its listing if it's accepted. Shemoqmedi is a creative space: we list original, creative work, and awards and recognition here are earned, never bought.",
      "If it goes live, we'll email you when its week of jury voting starts, and again with the jury's scores and reviews.",
      r.linked
        ? "You can follow it in your account."
        : "Want to follow its progress and see your jury scores? Create a free account or sign in. It takes about 30 seconds, and it's optional: your submission stays with us either way.",
      "Shemoqmedi",
    ];
    await deliver(
      ctx,
      r.email,
      {
        subject: `We got your project: ${r.name}`,
        text: [...text, `Track your submission: ${track}`].join("\n\n"),
        paragraphs: text,
        eyebrow: "Submission received",
        headline: "Your work is in.",
        primary: { label: "Track your submission", href: track },
        footerNote: "You get this because you submitted a website to Shemoqmedi.",
      },
      { kind: "submission" },
    );
    return null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────────────────────────────────────

const vStatus = v.union(v.literal("received"), v.literal("preparing"), v.literal("listed"), v.literal("rejected"));

const adminRow = v.object({
  id: v.id("quickSubmissions"),
  name: v.string(),
  url: v.string(),
  email: v.string(),
  status: vStatus,
  linked: v.boolean(),
  userName: v.union(v.string(), v.null()),
  listingId: v.union(v.id("listings"), v.null()),
  source: v.string(),
  device: v.union(v.string(), v.null()),
  referrer: v.union(v.string(), v.null()),
  utmCampaign: v.union(v.string(), v.null()),
  agreedToTerms: v.boolean(),
  createdAt: v.number(),
});

/** Submissions by editorial status, newest first. */
export const adminList = query({
  args: { status: vStatus },
  returns: v.array(adminRow),
  handler: async (ctx, { status }) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("quickSubmissions")
      .withIndex("by_status", (q) => q.eq("status", status))
      .order("desc")
      .take(300);
    return await Promise.all(
      rows.map(async (r) => {
        const user = r.userId ? await ctx.db.get(r.userId) : null;
        return {
          id: r._id,
          name: r.name,
          url: r.url,
          email: r.email,
          status: r.status,
          linked: !!r.userId,
          userName: user?.name ?? null,
          listingId: r.listingId ?? null,
          source: sourceOf(r),
          device: r.device ?? null,
          referrer: r.referrer ?? null,
          utmCampaign: r.utmCampaign ?? null,
          agreedToTerms: !!r.termsAcceptedAt,
          createdAt: r.createdAt,
        };
      }),
    );
  },
});

/** Open submissions waiting for the team (the Review tab's count). */
export const adminOpenCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const received = await ctx.db
      .query("quickSubmissions")
      .withIndex("by_status", (q) => q.eq("status", "received"))
      .collect();
    return received.length;
  },
});

/** Move a submission between received, preparing and rejected ("listed" comes from Add site). */
export const setStatus = mutation({
  args: { id: v.id("quickSubmissions"), status: v.union(v.literal("received"), v.literal("preparing"), v.literal("rejected")) },
  returns: v.null(),
  handler: async (ctx, { id, status }) => {
    await requireAdmin(ctx);
    const r = await ctx.db.get(id);
    if (!r) throw new ConvexError("Submission not found.");
    if (r.status === "listed") throw new ConvexError("This submission is already a listing; manage it from its review page.");
    await ctx.db.patch(id, { status, updatedAt: Date.now() });
    return null;
  },
});

/** One open submission, to prefill the Add site form (?quick=<id>). */
export const forListing = query({
  args: { id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      id: v.id("quickSubmissions"),
      name: v.string(),
      url: v.string(),
      email: v.string(),
      owner: v.union(v.null(), v.object({ id: v.id("users"), name: v.string(), email: v.string() })),
    }),
  ),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const qid = ctx.db.normalizeId("quickSubmissions", id);
    const r = qid ? await ctx.db.get(qid) : null;
    if (!r || (r.status !== "received" && r.status !== "preparing")) return null;
    const user = r.userId ? await ctx.db.get(r.userId) : null;
    return {
      id: r._id,
      name: r.name,
      url: r.url,
      email: r.email,
      owner: user ? { id: user._id, name: user.name, email: user.email } : null,
    };
  },
});

/** Funnel totals over the last `days` Tbilisi days, plus saved submissions by source. */
export const funnel = query({
  args: { days: v.number() },
  returns: v.object({
    totals: v.record(v.string(), v.number()),
    savedBySource: v.array(v.object({ source: v.string(), count: v.number() })),
  }),
  handler: async (ctx, { days }) => {
    await requireAdmin(ctx);
    const n = Math.max(1, Math.min(90, Math.round(days)));
    const totals: Record<string, number> = {};
    const bySource = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const day = tbilisiDay(Date.now() - i * DAY);
      const rows = await ctx.db
        .query("funnelCounts")
        .withIndex("by_day_event", (q) => q.eq("day", day))
        .collect();
      for (const r of rows) {
        totals[r.event] = (totals[r.event] ?? 0) + r.count;
        if (r.event === "guest_submission_saved" || r.event === "account_submission_saved") {
          bySource.set(r.source, (bySource.get(r.source) ?? 0) + r.count);
        }
      }
    }
    const savedBySource = [...bySource].map(([source, c]) => ({ source, count: c })).sort((x, y) => y.count - x.count);
    return { totals, savedBySource };
  },
});
