// The social desk's queue. The database queues posts by itself:
//   award        - notify.awardAnnounced, when an award is announced
//   new_listing  - queueNewListings (cron), when a site goes public
//   call_*       - weekly calls for submissions and for jurors (cron)
//   roundup      - the Sunday roundup of the week (cron)
// and admins add announcement/custom posts in chat. Each post carries `facts`
// (plain data about the listing, studio and award) for Claude, who writes
// the Facebook / Instagram / LinkedIn captions through the MCP connector
// (mcp.ts). Nothing is published until an admin approves it; approving a
// new-listing post also emails the studio (emails.featured).

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { socialPostKind, socialPostStatus } from "./schema";
import { requireAdmin } from "./authHelpers";
import { categoryName, fail, listingCategories, mediaUrls } from "./lib/listingHelpers";
import { TIER_NAMES } from "./lib/awards";
import { DAY_MS, tbilisiDay, weekOf } from "./lib/time";
import { emailHtml, escapeHtml, sendEmail } from "./lib/email";
import { ensureListingClaimUrl } from "./claimLinks";
import { creatorPath, siteUrl, sitePath } from "./seo";

export type SocialKind = Doc<"socialPosts">["kind"] & string;
export type PostStatus = "waiting" | "approved" | "scheduled" | "sent" | "failed" | "rejected";

/** "pending" and "skipped" are award rows from before the desk: still waiting for captions. */
export function readStatus(status: Doc<"socialPosts">["status"]): PostStatus {
  return status === "pending" || status === "skipped" ? "waiting" : status;
}

/** New listings are queued while they are this fresh (a missed cron run catches up). */
export const NEW_LISTING_WINDOW_MS = 3 * DAY_MS;

// ─────────────────────────────────────────────────────────────────────────────
// Facts: what Claude writes from
// ─────────────────────────────────────────────────────────────────────────────

export async function listingFacts(ctx: QueryCtx, listing: Doc<"listings">) {
  const creator = listing.creatorId ? await ctx.db.get(listing.creatorId) : null;
  const awards = await ctx.db
    .query("awards")
    .withIndex("by_listing", (q) => q.eq("listingId", listing._id))
    .take(50);
  const media = await mediaUrls(ctx, listing);
  return {
    title: listing.title,
    tagline: listing.tagline,
    siteUrl: listing.url,
    pageUrl: `${siteUrl()}${sitePath(listing.slug)}`,
    slug: listing.slug,
    status: listing.status,
    studio: {
      name: listing.creditName,
      slug: creator?.slug ?? null,
      pageUrl: creator ? `${siteUrl()}${creatorPath(creator.slug)}` : null,
      tier: listing.creatorTier,
      location: creator?.location ?? null,
      website: creator?.website ?? listing.creditUrl ?? null,
      socials: creator?.socials ?? {},
      links: creator?.links ?? [],
    },
    categories: listingCategories(listing).map(categoryName),
    technologies: listing.technologies,
    region: listing.region,
    juryNote: listing.juryNote ?? null,
    finalScore: listing.finalScore ?? null,
    publishedDay: listing.publishedAt ? tbilisiDay(listing.publishedAt) : null,
    isClaimed: listing.isClaimed,
    byTeam: listing.byTeam ?? false,
    awards: awards
      .filter((a) => a.status === "active")
      .map((a) => ({ tier: a.tier, name: TIER_NAMES[a.tier], date: a.date, pageUrl: `${siteUrl()}/awards/${a.slug}` })),
    screenshots: [media.coverUrl, ...media.galleryUrls].filter((u): u is string => !!u),
    videoUrl: media.videoUrl,
  };
}

function listingMedia(facts: Awaited<ReturnType<typeof listingFacts>>) {
  return [
    ...facts.screenshots.map((url) => ({ kind: "image" as const, url, role: "screenshot" })),
    ...(facts.videoUrl ? [{ kind: "video" as const, url: facts.videoUrl, role: "preview" }] : []),
  ];
}

async function siteStats(ctx: QueryCtx) {
  const live = await ctx.db
    .query("listings")
    .withIndex("by_status", (q) => q.eq("status", "in_voting"))
    .take(1000);
  const awarded = await ctx.db
    .query("listings")
    .withIndex("by_status", (q) => q.eq("status", "awarded"))
    .take(1000);
  const jurors = (await ctx.db.query("jurors").take(500)).filter((j) => j.active);
  return { inVoting: live.length, awarded: awarded.length, jurors: jurors.length };
}

function links() {
  const base = siteUrl();
  return {
    home: base,
    submit: `${base}/submit`,
    jury: `${base}/jury`,
    howWeScore: `${base}/how-we-score`,
    siteOfTheDay: `${base}/site-of-the-day`,
    badges: `${base}/badges`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Queueing
// ─────────────────────────────────────────────────────────────────────────────

type MediaItem = { kind: "image" | "video"; url: string; role?: string };

export async function queuePost(
  ctx: MutationCtx,
  input: { kind: SocialKind; listingId?: Id<"listings">; awardId?: Id<"awards">; facts: unknown; media?: MediaItem[] },
) {
  const now = Date.now();
  return await ctx.db.insert("socialPosts", {
    kind: input.kind,
    listingId: input.listingId,
    awardId: input.awardId,
    status: "waiting",
    facts: input.facts,
    media: input.media ?? [],
    createdAt: now,
    updatedAt: now,
  });
}

/** An announced award → a waiting post (once per award). Not for the honorary First 100. */
export const queueAward = internalMutation({
  args: { awardId: v.id("awards") },
  returns: v.union(v.id("socialPosts"), v.null()),
  handler: async (ctx, { awardId }) => {
    const award = await ctx.db.get(awardId);
    if (!award || award.status !== "active" || award.tier === "F100") return null;
    const existing = await ctx.db
      .query("socialPosts")
      .withIndex("by_award", (q) => q.eq("awardId", awardId))
      .first();
    if (existing) return null;
    const listing = await ctx.db.get(award.listingId);
    if (!listing) return null;
    const facts = await listingFacts(ctx, listing);
    return await queuePost(ctx, {
      kind: "award",
      awardId,
      listingId: listing._id,
      facts: {
        ...facts,
        award: {
          tier: award.tier,
          name: TIER_NAMES[award.tier],
          date: award.date,
          period: award.period,
          score: award.score,
          pageUrl: `${siteUrl()}/awards/${award.slug}`,
          badgeImage: `${siteUrl()}/badge/${award.slug}`,
        },
        links: links(),
      },
      media: listingMedia(facts),
    });
  },
});

/** Cron: every listing that went public in the last few days gets one "new listing" post. */
export const queueNewListings = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const since = Date.now() - NEW_LISTING_WINDOW_MS;
    const fresh = await ctx.db
      .query("listings")
      .withIndex("by_status_published", (q) => q.eq("status", "in_voting").gte("publishedAt", since))
      .take(200);
    let queued = 0;
    for (const listing of fresh) {
      const existing = await ctx.db
        .query("socialPosts")
        .withIndex("by_listing_kind", (q) => q.eq("listingId", listing._id).eq("kind", "new_listing"))
        .first();
      if (existing) continue;
      const facts = await listingFacts(ctx, listing);
      await queuePost(ctx, {
        kind: "new_listing",
        listingId: listing._id,
        facts: { ...facts, links: links() },
        media: listingMedia(facts),
      });
      queued++;
    }
    return queued;
  },
});

/** The newest post of a kind, if it is younger than `withinMs`. */
async function recentOfKind(ctx: QueryCtx, kind: SocialKind, withinMs: number) {
  const last = await ctx.db
    .query("socialPosts")
    .withIndex("by_kind", (q) => q.eq("kind", kind))
    .order("desc")
    .first();
  return last && last.createdAt > Date.now() - withinMs ? last : null;
}

/** ISO-ish week number parity of a Tbilisi week, for every-other-week posts. */
export function isEvenWeek(ms: number) {
  const monday = Date.parse(`${weekOf(ms)}T00:00:00Z`);
  return Math.floor(monday / (7 * DAY_MS)) % 2 === 0;
}

/** Cron: the weekly call for submissions, or (every other week) for jurors. */
export const queueCall = internalMutation({
  args: { kind: v.union(v.literal("call_submissions"), v.literal("call_jury")), everyOtherWeek: v.optional(v.boolean()) },
  returns: v.union(v.id("socialPosts"), v.null()),
  handler: async (ctx, { kind, everyOtherWeek }) => {
    if (everyOtherWeek && !isEvenWeek(Date.now())) return null;
    if (await recentOfKind(ctx, kind, 6 * DAY_MS)) return null;
    return await queuePost(ctx, {
      kind,
      facts: {
        what: kind === "call_submissions" ? "Invite studios and freelancers to submit their best site." : "Invite designers and developers to join the jury (invite-only: they reply or email us).",
        stats: await siteStats(ctx),
        links: links(),
      },
    });
  },
});

/** Cron (Sunday): the week in one post, when anything happened. */
export const queueRoundup = internalMutation({
  args: {},
  returns: v.union(v.id("socialPosts"), v.null()),
  handler: async (ctx) => {
    if (await recentOfKind(ctx, "roundup", 6 * DAY_MS)) return null;
    const since = Date.now() - 7 * DAY_MS;
    const fresh = await ctx.db
      .query("listings")
      .withIndex("by_status_published", (q) => q.eq("status", "in_voting").gte("publishedAt", since))
      .take(100);
    const awards = (await ctx.db.query("awards").order("desc").take(200)).filter(
      (a) => a.status === "active" && a.createdAt >= since && a.tier !== "F100",
    );
    if (fresh.length === 0 && awards.length === 0) return null;
    const awardListings = await Promise.all(awards.map((a) => ctx.db.get(a.listingId)));
    return await queuePost(ctx, {
      kind: "roundup",
      facts: {
        week: weekOf(Date.now()),
        newListings: fresh.map((l) => ({ title: l.title, studio: l.creditName, pageUrl: `${siteUrl()}${sitePath(l.slug)}` })),
        awards: awards.map((a, i) => ({
          tier: a.tier,
          name: TIER_NAMES[a.tier],
          date: a.date,
          title: awardListings[i]?.title ?? null,
          studio: awardListings[i]?.creditName ?? null,
          pageUrl: `${siteUrl()}/awards/${a.slug}`,
        })),
        stats: await siteStats(ctx),
        links: links(),
      },
    });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Studio contact (emails.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Who to email about a listing: its owner (or the owner of its creator
 * profile), else the creator's private contact email. Unclaimed listings get
 * their claim link (minted from `freshToken` on first use).
 */
export const studioContact = internalMutation({
  args: { listingId: v.id("listings"), freshToken: v.string() },
  returns: v.union(
    v.object({
      email: v.string(),
      name: v.string(),
      title: v.string(),
      pageUrl: v.string(),
      claimUrl: v.union(v.string(), v.null()),
      creatorId: v.union(v.id("creators"), v.null()),
      isOwner: v.boolean(),
    }),
    v.null(),
  ),
  handler: async (ctx, { listingId, freshToken }) => {
    const listing = await ctx.db.get(listingId);
    if (!listing) return null;
    const creator = listing.creatorId ? await ctx.db.get(listing.creatorId) : null;
    const ownerId = listing.ownerId ?? creator?.claimedBy;
    const owner = ownerId ? await ctx.db.get(ownerId) : null;
    const email = owner?.email ?? creator?.contactEmail;
    if (!email) return null;
    return {
      email,
      name: owner?.name ?? creator?.name ?? listing.creditName,
      title: listing.title,
      pageUrl: `${siteUrl()}${sitePath(listing.slug)}`,
      claimUrl: listing.isClaimed ? null : await ensureListingClaimUrl(ctx, listingId, freshToken),
      creatorId: creator?._id ?? null,
      isOwner: Boolean(owner),
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Reading and changing posts (shared by mcp.ts and the admin Social page)
// ─────────────────────────────────────────────────────────────────────────────

export const captionsValidator = v.object({
  facebook: v.optional(v.string()),
  instagram: v.optional(v.string()),
  linkedin: v.optional(v.string()),
});
export const mediaValidator = v.array(
  v.object({ kind: v.union(v.literal("image"), v.literal("video")), url: v.string(), role: v.optional(v.string()) }),
);

export const postView = v.object({
  id: v.id("socialPosts"),
  kind: socialPostKind,
  status: socialPostStatus,
  listing: v.union(v.object({ slug: v.string(), title: v.string() }), v.null()),
  facts: v.any(),
  captions: captionsValidator,
  media: mediaValidator,
  scheduledFor: v.union(v.number(), v.null()),
  note: v.union(v.string(), v.null()),
  error: v.union(v.string(), v.null()),
  createdAt: v.number(),
  approvedAt: v.union(v.number(), v.null()),
});

export async function viewPost(ctx: QueryCtx, post: Doc<"socialPosts">) {
  const listing = post.listingId ? await ctx.db.get(post.listingId) : null;
  return {
    id: post._id,
    kind: post.kind ?? "award",
    status: readStatus(post.status),
    listing: listing ? { slug: listing.slug, title: listing.title } : null,
    // Older award rows have only the one-line payload.
    facts: post.facts ?? (post.payload ? { legacy: post.payload } : null),
    captions: post.captions ?? {},
    media:
      post.media ??
      (post.payload?.screenshotUrl ? [{ kind: "image" as const, url: post.payload.screenshotUrl, role: "screenshot" }] : []),
    scheduledFor: post.scheduledFor ?? null,
    note: post.note ?? null,
    error: post.error ?? null,
    createdAt: post.createdAt,
    approvedAt: post.approvedAt ?? null,
  };
}

export async function listPosts(ctx: QueryCtx, status: PostStatus | "all", limit: number) {
  const rows = await ctx.db.query("socialPosts").order("desc").take(500);
  const picked = rows.filter((p) => status === "all" || readStatus(p.status) === status).slice(0, limit);
  return Promise.all(picked.map((p) => viewPost(ctx, p)));
}

/** Captions, media, time or note of a post that hasn't gone to Postiz yet. */
export async function editPost(
  ctx: MutationCtx,
  id: Id<"socialPosts">,
  edit: { captions?: Partial<Record<"facebook" | "instagram" | "linkedin", string>>; media?: MediaItem[]; scheduledFor?: number | null; note?: string },
) {
  const post = await ctx.db.get(id);
  if (!post) fail("Post not found.");
  const status = readStatus(post.status);
  if (status !== "waiting" && status !== "approved") fail(`This post is ${status}; it can't be changed any more.`);
  const captions = { ...(post.captions ?? {}) };
  for (const network of ["facebook", "instagram", "linkedin"] as const) {
    const text = edit.captions?.[network];
    if (text === undefined) continue;
    const clean = text.trim();
    if (clean.length > 3000) fail(`The ${network} caption is too long (3000 characters at most).`);
    if (clean) captions[network] = clean;
    else delete captions[network];
  }
  if (edit.media) {
    if (edit.media.length > 10) fail("At most 10 images or videos per post.");
    for (const m of edit.media) if (!/^https:\/\//.test(m.url)) fail(`Media must be a public https URL: ${m.url}`);
  }
  if (edit.scheduledFor != null && edit.scheduledFor < Date.now() - 60_000) fail("The publish time is in the past.");
  await ctx.db.patch(id, {
    captions,
    ...(edit.media ? { media: edit.media } : {}),
    ...(edit.scheduledFor !== undefined ? { scheduledFor: edit.scheduledFor ?? undefined } : {}),
    ...(edit.note !== undefined ? { note: edit.note.trim() || undefined } : {}),
    // Editing an approved post sends it back for another look.
    ...(status === "approved" ? { status: "waiting" as const, approvedAt: undefined, approvedBy: undefined } : {}),
    updatedAt: Date.now(),
  });
}

/**
 * Approve a post: it needs at least one caption, and Instagram needs an image
 * or a video. A new-listing post also emails the studio. (Publishing through
 * Postiz hooks in here once it is connected.)
 */
export async function approvePost(ctx: MutationCtx, id: Id<"socialPosts">, by: Id<"users">) {
  const post = await ctx.db.get(id);
  if (!post) fail("Post not found.");
  const status = readStatus(post.status);
  if (status !== "waiting") fail(`This post is ${status}, not waiting.`);
  const captions = post.captions ?? {};
  if (!captions.facebook && !captions.instagram && !captions.linkedin) fail("Write at least one caption first.");
  if (captions.instagram && !(post.media ?? []).length) fail("Instagram needs an image or a video.");
  const now = Date.now();
  await ctx.db.patch(id, { status: "approved", approvedAt: now, approvedBy: by, error: undefined, updatedAt: now });
  if (post.kind === "new_listing" && post.listingId) {
    await ctx.scheduler.runAfter(0, internal.emails.featured, { listingId: post.listingId, postId: id });
  }
}

export async function rejectPost(ctx: MutationCtx, id: Id<"socialPosts">, note?: string) {
  const post = await ctx.db.get(id);
  if (!post) fail("Post not found.");
  const status = readStatus(post.status);
  if (status === "scheduled" || status === "sent") fail(`This post is already ${status}.`);
  await ctx.db.patch(id, { status: "rejected", note: note?.trim() || post.note, updatedAt: Date.now() });
}

// Admin Social page (Clerk session).

export const queue = query({
  args: { status: v.optional(v.union(socialPostStatus, v.literal("all"))) },
  returns: v.array(postView),
  handler: async (ctx, { status }) => {
    await requireAdmin(ctx);
    const wanted = status === "pending" || status === "skipped" ? "waiting" : (status ?? "waiting");
    return await listPosts(ctx, wanted, 100);
  },
});

export const waitingCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return (await listPosts(ctx, "waiting", 100)).length;
  },
});

export const approve = mutation({
  args: { id: v.id("socialPosts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const admin = await requireAdmin(ctx);
    await approvePost(ctx, id, admin._id);
    return null;
  },
});

export const reject = mutation({
  args: { id: v.id("socialPosts"), note: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { id, note }) => {
    await requireAdmin(ctx);
    await rejectPost(ctx, id, note);
    return null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Daily nudge
// ─────────────────────────────────────────────────────────────────────────────

export const waitingSummary = internalQuery({
  args: {},
  returns: v.array(v.object({ kind: v.string(), title: v.union(v.string(), v.null()) })),
  handler: async (ctx) => {
    const posts = await listPosts(ctx, "waiting", 50);
    return posts.map((p) => ({ kind: p.kind, title: p.listing?.title ?? null }));
  },
});

const KIND_LABEL: Record<string, string> = {
  award: "Award",
  new_listing: "New listing",
  call_submissions: "Call for submissions",
  call_jury: "Call for jurors",
  roundup: "Weekly roundup",
  announcement: "Announcement",
  custom: "Post",
};

/** Cron (morning, Tbilisi): "N posts are waiting", to every admin. */
export const waitingPing = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const waiting: { kind: string; title: string | null }[] = await ctx.runQuery(internal.social.waitingSummary, {});
    if (waiting.length === 0) return null;
    const to: string[] = await ctx.runQuery(internal.notify.adminEmails, {});
    const items = waiting.map((w) => `${KIND_LABEL[w.kind] ?? w.kind}${w.title ? `: ${w.title}` : ""}`);
    const n = waiting.length;
    const error = await sendEmail({
      to,
      subject: `${n} post${n === 1 ? "" : "s"} waiting on the social desk`,
      text: `${items.join("\n")}\n\nOpen Claude and ask "what's waiting on the social desk?"`,
      html: emailHtml([
        `<strong>${n} post${n === 1 ? " is" : "s are"} waiting</strong> for captions and your approval:`,
        items.map(escapeHtml).join("<br>"),
        `Open Claude (the Shemoqmedi connector) and ask: <em>what's waiting on the social desk?</em>`,
      ]),
    });
    if (error) console.warn(`Social desk nudge not sent: ${error}`);
    return null;
  },
});
