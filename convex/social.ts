// The social desk's queue. The database queues posts by itself:
//   award        - notify.awardAnnounced, when an award is announced
//   new_listing  - queueNewListings (cron), when a site goes public
//   call_*       - weekly calls for submissions and for jurors (cron)
//   roundup      - the Sunday roundup of the week (cron)
// and admins add announcement/custom posts in chat. Each post carries `facts`
// (plain data about the listing, studio and award) for Claude, who writes
// the Facebook / Instagram / Threads / LinkedIn captions through the MCP
// connector (mcp.ts) or an admin writes them in the Studio (the Clerk-session
// functions at the end of this file). Nothing is published until an admin
// approves it: approving schedules publish.post (now, or at scheduledFor),
// which posts to every network with a caption and a connected account
// (channels.ts). Approving a new-listing post also emails the studio
// (emails.featured). A post is a feed post or, with placement "story", one
// 9:16 image or video for Instagram and Facebook stories.

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
import { publishResult, socialMediaItem, socialPlacement, socialPostKind, socialPostStatus } from "./schema";
import {
  NETWORKS,
  NETWORK_NAME,
  PlatformError,
  STORY_NETWORKS,
  THREADS_MAX,
  instagramImageUrl,
  mediaFor,
  storyProblem,
  threadsLength,
  type MediaItem,
  type Network,
  type Placement,
} from "./lib/socialApi";
import { channelView, channelsOf, type ChannelView } from "./channels";
import { requireAdmin } from "./authHelpers";
import { categoryName, fail, isPublicStatus, listingCategories, mediaUrls } from "./lib/listingHelpers";
import { TIER_NAMES } from "./lib/awards";
import { DAY_MS, tbilisiDay, weekOf } from "./lib/time";
import { emailHtml, escapeHtml, sendEmail } from "./lib/email";
import { ensureListingClaimUrl } from "./claimLinks";
import { creatorPath, siteUrl, sitePath } from "./seo";
import { pushAdmins } from "./push";
import { studioUrl } from "../lib/hosts";

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

/** The Studio queue tag: a newer "posts waiting" push replaces the older one on the device. */
const QUEUE_TAG = "social-queue";

/**
 * One push per queueing run that added posts (never one per post), linking
 * the Studio queue. Scheduled, so it rolls back with the run.
 */
async function pushQueued(ctx: MutationCtx, titles: string[]) {
  const n = titles.length;
  if (n === 0) return;
  await pushAdmins(ctx, {
    title: n === 1 ? "A post is waiting" : `${n} new posts are waiting`,
    body: digestBody(titles, n),
    url: studioUrl("/queue"),
    tag: QUEUE_TAG,
  });
}

/** An announced award → a waiting post (once per award; its id, or null). Not for the honorary First 100. */
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
    const id = await queuePost(ctx, {
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
    // No push here: notify.awardAnnounced sends one for the award and this post together.
    return id;
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
    const queued: string[] = [];
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
      queued.push(`New listing: ${listing.title}`);
    }
    await pushQueued(ctx, queued);
    return queued.length;
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
    const id = await queuePost(ctx, {
      kind,
      facts: {
        what: kind === "call_submissions" ? "Invite studios and freelancers to submit their best site." : "Invite designers and developers to join the jury (invite-only: they reply or email us).",
        stats: await siteStats(ctx),
        links: links(),
      },
    });
    await pushQueued(ctx, [KIND_LABEL[kind]]);
    return id;
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
    const id = await queuePost(ctx, {
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
    await pushQueued(ctx, [`${KIND_LABEL.roundup} (${fresh.length} new, ${awards.length} award${awards.length === 1 ? "" : "s"})`]);
    return id;
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
      isPublic: v.boolean(),
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
      isPublic: isPublicStatus(listing.status),
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
  threads: v.optional(v.string()),
});
export const mediaValidator = v.array(socialMediaItem);

/** Caption limits per network (Threads: 500; Instagram: 2,200; the rest: 3,000). */
export const CAPTION_MAX: Record<Network, number> = { facebook: 3000, instagram: 2200, threads: THREADS_MAX, linkedin: 3000 };

/** A caption's length as its network counts it: Threads counts emoji as their UTF-8 bytes. */
export function captionLength(network: Network, text: string) {
  return network === "threads" ? threadsLength(text) : text.length;
}

export const postView = v.object({
  id: v.id("socialPosts"),
  kind: socialPostKind,
  status: socialPostStatus,
  listing: v.union(v.object({ slug: v.string(), title: v.string() }), v.null()),
  facts: v.any(),
  captions: captionsValidator,
  media: mediaValidator,
  placement: socialPlacement,
  scheduledFor: v.union(v.number(), v.null()),
  note: v.union(v.string(), v.null()),
  error: v.union(v.string(), v.null()),
  results: v.array(publishResult),
  // A publish run holds the post until publishingUntil. `publishing` is that
  // compared with the time of the query; the admin page compares
  // publishingUntil with its own clock (a cached query does not re-run as time passes).
  publishing: v.boolean(),
  publishingUntil: v.union(v.number(), v.null()),
  createdAt: v.number(),
  approvedAt: v.union(v.number(), v.null()),
  sentAt: v.union(v.number(), v.null()),
});

/** A post's media; older award rows only have the screenshot in their payload. */
export function postMedia(post: Doc<"socialPosts">): MediaItem[] {
  if (post.media) return post.media;
  return post.payload?.screenshotUrl ? [{ kind: "image", url: post.payload.screenshotUrl, role: "screenshot" }] : [];
}

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
    media: postMedia(post),
    placement: post.placement ?? "feed",
    scheduledFor: post.scheduledFor ?? null,
    note: post.note ?? null,
    error: post.error ?? null,
    results: post.results ?? [],
    publishing: isPublishing(post),
    publishingUntil: post.publishingUntil ?? null,
    createdAt: post.createdAt,
    approvedAt: post.approvedAt ?? null,
    sentAt: post.sentAt ?? null,
  };
}

/** The stored statuses behind a view ("waiting" includes the older "pending"/"skipped"). */
const STORED: Record<PostStatus, Doc<"socialPosts">["status"][]> = {
  waiting: ["waiting", "pending", "skipped"],
  approved: ["approved"],
  scheduled: ["scheduled"],
  sent: ["sent"],
  failed: ["failed"],
  rejected: ["rejected"],
};

/** Newest first, through the status index, so no post ever falls out of view. */
export async function postsWithStatus(ctx: QueryCtx, status: PostStatus | "all", limit: number) {
  if (status === "all") return await ctx.db.query("socialPosts").order("desc").take(limit);
  const lists = await Promise.all(
    STORED[status].map((s) =>
      ctx.db
        .query("socialPosts")
        .withIndex("by_status", (q) => q.eq("status", s))
        .order("desc")
        .take(limit),
    ),
  );
  return lists
    .flat()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

/** How many posts have a status (exact up to `max` per stored status). */
export async function countPosts(ctx: QueryCtx, status: PostStatus, max = 5000) {
  let n = 0;
  for (const s of STORED[status]) {
    n += (await ctx.db.query("socialPosts").withIndex("by_status", (q) => q.eq("status", s)).take(max)).length;
  }
  return n;
}

export async function listPosts(ctx: QueryCtx, status: PostStatus | "all", limit: number) {
  const picked = await postsWithStatus(ctx, status, limit);
  return Promise.all(picked.map((p) => viewPost(ctx, p)));
}

/** A publish run holds the post (publish.begin) until its lease ends. */
export function isPublishing(post: Doc<"socialPosts">) {
  return !!post.publishingUntil && post.publishingUntil > Date.now();
}

/**
 * Media with the width and height of the files we uploaded (the media table):
 * images for Instagram's ratio rule, images and videos for a story's 9:16.
 */
export async function withSizes(ctx: QueryCtx, media: MediaItem[]): Promise<MediaItem[]> {
  return await Promise.all(
    media.map(async (m) => {
      if (m.width && m.height) return m;
      const row = await ctx.db
        .query("media")
        .withIndex("by_url", (q) => q.eq("url", m.url))
        .first();
      return row?.width && row.height ? { ...m, width: row.width, height: row.height } : m;
    }),
  );
}

/** Why Instagram would refuse the post's images (a ratio that can't be padded), or null. */
async function instagramMediaProblem(ctx: QueryCtx, post: Doc<"socialPosts">) {
  const media = await withSizes(ctx, mediaFor(postMedia(post), "instagram"));
  if (media[0]?.kind !== "image") return null;
  for (const m of media.filter((x) => x.kind === "image")) {
    try {
      instagramImageUrl(m);
    } catch (err) {
      if (err instanceof PlatformError) return err.message;
      throw err;
    }
  }
  return null;
}

/** Why these media can't make a story (count, or a known size that isn't 9:16), or null. */
async function storyMediaProblem(ctx: QueryCtx, media: MediaItem[]) {
  return storyProblem(await withSizes(ctx, media));
}

/** Networks with a caption, in a fixed order. */
export function captionedNetworks(post: Doc<"socialPosts">): Network[] {
  const captions = post.captions ?? {};
  return NETWORKS.filter((n) => !!captions[n]?.trim());
}

/** Cancels the pending publish job of a scheduled post (a no-op when it already ran). */
async function cancelJob(ctx: MutationCtx, post: Doc<"socialPosts">) {
  if (!post.publishJobId) return;
  const job = await ctx.db.system.get(post.publishJobId);
  if (job && (job.state.kind === "pending" || job.state.kind === "inProgress")) await ctx.scheduler.cancel(post.publishJobId);
}

/**
 * Captions, media, time or note of a post that isn't published yet. Editing
 * an approved, scheduled or failed post sends it back to waiting (a scheduled
 * post's publish job is cancelled); networks already sent stay sent.
 */
export async function editPost(
  ctx: MutationCtx,
  id: Id<"socialPosts">,
  edit: {
    captions?: Partial<Record<Network, string>>;
    media?: MediaItem[];
    scheduledFor?: number | null;
    note?: string;
    placement?: Placement;
  },
) {
  const post = await ctx.db.get(id);
  if (!post) fail("Post not found.");
  const status = readStatus(post.status);
  if (status === "sent" || status === "rejected") fail(`This post is ${status}; it can't be changed any more.`);
  if (isPublishing(post)) fail("This post is being published right now; wait a few minutes.");
  const captions = { ...(post.captions ?? {}) };
  for (const network of NETWORKS) {
    const text = edit.captions?.[network];
    if (text === undefined) continue;
    const clean = text.trim();
    const max = CAPTION_MAX[network];
    const length = captionLength(network, clean);
    if (length > max) {
      const how = length !== clean.length ? ", counting emoji as Threads does (2-4 each)" : "";
      fail(`The ${NETWORK_NAME[network]} caption is too long (${max} characters at most, it has ${length}${how}).`);
    }
    if (clean) captions[network] = clean;
    else delete captions[network];
  }
  if (edit.media) {
    if (edit.media.length > 10) fail("At most 10 images or videos per post.");
    for (const m of edit.media) if (!/^https:\/\//.test(m.url)) fail(`Media must be a public https URL: ${m.url}`);
  }
  // A story is checked as soon as it has media; an empty one is still being made.
  const placement = edit.placement ?? post.placement ?? "feed";
  const media = edit.media ?? postMedia(post);
  if (placement === "story" && media.length > 0) {
    const problem = await storyMediaProblem(ctx, media);
    if (problem) fail(problem);
  }
  if (edit.scheduledFor != null && edit.scheduledFor < Date.now() - 60_000) fail("The publish time is in the past.");
  if (status === "scheduled") await cancelJob(ctx, post);
  const backToWaiting = status === "approved" || status === "scheduled" || status === "failed";
  await ctx.db.patch(id, {
    captions,
    // Older award rows keep their screenshot in `payload`: store it as media on the first edit.
    ...(edit.media ? { media: edit.media } : post.media ? {} : { media: postMedia(post) }),
    ...(edit.scheduledFor !== undefined ? { scheduledFor: edit.scheduledFor ?? undefined } : {}),
    ...(edit.note !== undefined ? { note: edit.note.trim() || undefined } : {}),
    // Absent means feed, so older rows and feed posts read the same.
    ...(edit.placement !== undefined ? { placement: edit.placement === "story" ? ("story" as const) : undefined } : {}),
    // Editing an approved, scheduled or failed post sends it back for another look.
    ...(backToWaiting
      ? { status: "waiting" as const, approvedAt: undefined, approvedBy: undefined, publishJobId: undefined, error: undefined }
      : {}),
    updatedAt: Date.now(),
  });
}

/**
 * Schedules publish.post: at `scheduledFor` when it is in the future, else
 * now. Each schedule gets the next run number (publishRun), and only that run
 * may claim the post (publish.begin): a cancelled run that was already
 * running can't publish it.
 */
async function schedulePublish(ctx: MutationCtx, post: Doc<"socialPosts">) {
  const at = post.scheduledFor;
  const run = (post.publishRun ?? 0) + 1;
  const publishJobId =
    at && at > Date.now()
      ? await ctx.scheduler.runAt(at, internal.publish.post, { postId: post._id, run })
      : await ctx.scheduler.runAfter(0, internal.publish.post, { postId: post._id, run });
  return { publishJobId, publishRun: run };
}

/**
 * Approve a post: it needs at least one caption, and Instagram needs an image
 * or a video. Approval schedules publishing to every network with a caption
 * (now, or at the post's publish time). A new-listing post also emails the studio.
 */
export async function approvePost(ctx: MutationCtx, id: Id<"socialPosts">, by: Id<"users">) {
  const post = await ctx.db.get(id);
  if (!post) fail("Post not found.");
  const status = readStatus(post.status);
  if (status !== "waiting") fail(`This post is ${status}, not waiting.`);
  const captions = post.captions ?? {};
  if (captionedNetworks(post).length === 0) fail("Write at least one caption first.");
  if (post.placement === "story") {
    // Stories show no text, but the captions still pick the networks.
    if (!captionedNetworks(post).some((n) => STORY_NETWORKS.includes(n))) {
      fail("A story goes to Instagram and Facebook only: give it an Instagram or Facebook caption (stories show no text; the caption picks the network).");
    }
    const problem = await storyMediaProblem(ctx, postMedia(post));
    if (problem) fail(problem);
  } else if (captions.instagram) {
    if (!mediaFor(postMedia(post), "instagram").length) fail("Instagram needs an image or a video.");
    const problem = await instagramMediaProblem(ctx, post);
    if (problem) fail(problem);
  }
  // The award or the listing may have changed since the post was queued.
  if (post.awardId) {
    const award = await ctx.db.get(post.awardId);
    if (!award || award.status !== "active") fail("This award was revoked: reject the post instead.");
  }
  if (post.listingId) {
    const listing = await ctx.db.get(post.listingId);
    if (!listing || !isPublicStatus(listing.status)) fail("This site isn't public any more: reject the post instead.");
  }
  const now = Date.now();
  const { publishJobId, publishRun } = await schedulePublish(ctx, post);
  await ctx.db.patch(id, {
    status: "scheduled",
    approvedAt: now,
    approvedBy: by,
    publishJobId,
    publishRun,
    // Older award rows keep their screenshot in `payload`: publishing reads `media`.
    ...(post.media ? {} : { media: postMedia(post) }),
    error: undefined,
    updatedAt: now,
  });
  if (post.kind === "new_listing" && post.listingId) {
    await ctx.scheduler.runAfter(0, internal.emails.featured, { listingId: post.listingId, postId: id });
  }
}

export async function rejectPost(ctx: MutationCtx, id: Id<"socialPosts">, note?: string) {
  const post = await ctx.db.get(id);
  if (!post) fail("Post not found.");
  const status = readStatus(post.status);
  if (status === "sent") fail(`This post is already ${status}.`);
  if (isPublishing(post)) fail("This post is being published right now; wait a few minutes.");
  if (status === "scheduled") await cancelJob(ctx, post);
  await ctx.db.patch(id, { status: "rejected", publishJobId: undefined, note: note?.trim() || post.note, updatedAt: Date.now() });
}

/**
 * An "approved" post with no publish results was approved before publishing
 * existed (the old approve only marked it): nothing was published from here,
 * but it may have been posted by hand. It is never retried; editing it sends
 * it back to waiting, and approving it again publishes it.
 */
export function isLegacyApproved(post: Doc<"socialPosts">) {
  return readStatus(post.status) === "approved" && (post.results ?? []).length === 0;
}

/**
 * Publish a post again: only the networks that aren't sent yet (failed ones,
 * and ones skipped because no account was connected). For failed posts,
 * approved posts that found no account, sent posts with skipped networks, and
 * scheduled posts whose publish run died. A future publish time is kept.
 */
export async function retryPost(ctx: MutationCtx, id: Id<"socialPosts">) {
  const post = await ctx.db.get(id);
  if (!post) fail("Post not found.");
  const status = readStatus(post.status);
  if (isPublishing(post)) fail("This post is being published right now; wait a few minutes.");
  const crashed = status === "scheduled" && !!post.publishingUntil;
  if (!(status === "failed" || status === "approved" || status === "sent" || crashed)) {
    fail(status === "scheduled" ? "This post is already scheduled." : `This post is ${status}; approve it first.`);
  }
  if (isLegacyApproved(post)) {
    fail(
      "This post was approved before publishing was connected: nothing was published from here, but it may have been posted by hand. To publish it now, edit it (it goes back to waiting) and approve it again.",
    );
  }
  const sent = new Set((post.results ?? []).filter((r) => r.status === "sent").map((r) => r.network));
  if (captionedNetworks(post).every((n) => sent.has(n))) fail("Every network of this post is already sent.");
  const { publishJobId, publishRun } = await schedulePublish(ctx, post);
  await ctx.db.patch(id, {
    status: "scheduled",
    publishJobId,
    publishRun,
    publishingUntil: undefined,
    error: undefined,
    updatedAt: Date.now(),
  });
}

/**
 * A post an admin starts (Studio or MCP). With a listing it gets the listing's
 * facts (extra facts merged in) and, for a feed post, its screenshots; a
 * story starts without media (it needs one 9:16 file). Captions, media and
 * placement go through editPost, so they are checked like any edit.
 */
export async function createPost(
  ctx: MutationCtx,
  input: {
    kind: SocialKind;
    listingId?: Id<"listings">;
    facts?: unknown;
    captions?: Partial<Record<Network, string>>;
    media?: MediaItem[];
    placement?: Placement;
  },
) {
  const listing = input.listingId ? await ctx.db.get(input.listingId) : null;
  if (input.listingId && !listing) fail("Listing not found.");
  const base = listing ? await listingFacts(ctx, listing) : null;
  const extra = input.facts && typeof input.facts === "object" ? input.facts : {};
  const story = input.placement === "story";
  const id = await queuePost(ctx, {
    kind: input.kind,
    listingId: listing?._id,
    facts: base ? { ...base, ...extra } : (input.facts ?? {}),
    media: base && !story ? base.screenshots.map((url) => ({ kind: "image" as const, url, role: "screenshot" })) : [],
  });
  if (input.captions || input.media || input.placement) {
    await editPost(ctx, id, { captions: input.captions, media: input.media, placement: input.placement });
  }
  return id;
}

/**
 * Approve and publish in one step: now when `at` is absent or past, else at
 * `at`. A scheduled post is unscheduled first, so this also moves its time.
 * Failed posts are retried instead (retryPost), so sent networks stay sent.
 */
export async function publishPost(ctx: MutationCtx, id: Id<"socialPosts">, by: Id<"users">, at?: number) {
  const post = await ctx.db.get(id);
  if (!post) fail("Post not found.");
  const status = readStatus(post.status);
  if (status === "scheduled") await unschedulePost(ctx, id);
  else if (status === "failed" || status === "approved") {
    fail(`This post is ${status}: retry it instead (or edit it, which sends it back to waiting).`);
  }
  else if (status !== "waiting") fail(`This post is ${status}; it can't be published again.`);
  const now = Date.now();
  await ctx.db.patch(id, { scheduledFor: at !== undefined && at > now ? at : undefined, updatedAt: now });
  await approvePost(ctx, id, by);
}

/** A scheduled post back to waiting: its publish job is cancelled; its publish time is kept for the next approval. */
export async function unschedulePost(ctx: MutationCtx, id: Id<"socialPosts">) {
  const post = await ctx.db.get(id);
  if (!post) fail("Post not found.");
  const status = readStatus(post.status);
  if (status !== "scheduled") fail(`This post is ${status}, not scheduled.`);
  if (isPublishing(post)) fail("This post is being published right now; wait a few minutes.");
  await cancelJob(ctx, post);
  await ctx.db.patch(id, {
    status: "waiting",
    approvedAt: undefined,
    approvedBy: undefined,
    publishJobId: undefined,
    publishingUntil: undefined,
    updatedAt: Date.now(),
  });
}

/** The latest sent posts, by when they went out (looked up among the newest 200 sent). */
export async function recentSent(ctx: QueryCtx, limit: number) {
  const sent = await postsWithStatus(ctx, "sent", 200);
  const picked = sent.sort((a, b) => (b.sentAt ?? b.createdAt) - (a.sentAt ?? a.createdAt)).slice(0, limit);
  return await Promise.all(picked.map((p) => viewPost(ctx, p)));
}

async function viewById(ctx: QueryCtx, id: Id<"socialPosts">) {
  const post = await ctx.db.get(id);
  if (!post) fail("Post not found.");
  return await viewPost(ctx, post);
}

// Admin Social page and the Studio (Clerk session).

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
    return await countPosts(ctx, "waiting");
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

export const retry = mutation({
  args: { id: v.id("socialPosts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    await retryPost(ctx, id);
    return null;
  },
});

export const get = query({
  args: { id: v.id("socialPosts") },
  returns: postView,
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    return await viewById(ctx, id);
  },
});

export const create = mutation({
  args: {
    kind: socialPostKind,
    listingId: v.optional(v.id("listings")),
    facts: v.optional(v.any()),
    captions: v.optional(captionsValidator),
    media: v.optional(mediaValidator),
    placement: v.optional(socialPlacement),
  },
  returns: postView,
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await viewById(ctx, await createPost(ctx, args));
  },
});

export const update = mutation({
  args: {
    id: v.id("socialPosts"),
    captions: v.optional(captionsValidator),
    media: v.optional(mediaValidator),
    publishAt: v.optional(v.union(v.number(), v.null())), // null: as soon as approved
    note: v.optional(v.string()),
    placement: v.optional(socialPlacement),
  },
  returns: postView,
  handler: async (ctx, { id, publishAt, ...edit }) => {
    await requireAdmin(ctx);
    await editPost(ctx, id, { ...edit, scheduledFor: publishAt });
    return await viewById(ctx, id);
  },
});

export const publish = mutation({
  args: { id: v.id("socialPosts"), at: v.optional(v.number()) },
  returns: postView,
  handler: async (ctx, { id, at }) => {
    const admin = await requireAdmin(ctx);
    await publishPost(ctx, id, admin._id, at);
    return await viewById(ctx, id);
  },
});

export const unschedule = mutation({
  args: { id: v.id("socialPosts") },
  returns: postView,
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    await unschedulePost(ctx, id);
    return await viewById(ctx, id);
  },
});

/** The four networks as stored (no tokens). Newly set env tokens show after the next sync (daily, or before a publish). */
export const channels = query({
  args: {},
  returns: v.array(channelView),
  handler: async (ctx): Promise<ChannelView[]> => {
    await requireAdmin(ctx);
    return await channelsOf(ctx);
  },
});

export const recent = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(postView),
  handler: async (ctx, { limit }) => {
    await requireAdmin(ctx);
    return await recentSent(ctx, Math.min(Math.max(Math.floor(limit ?? 10), 1), 50));
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Daily nudge
// ─────────────────────────────────────────────────────────────────────────────

export const waitingSummary = internalQuery({
  args: {},
  returns: v.object({
    total: v.number(),
    items: v.array(v.object({ kind: v.string(), title: v.union(v.string(), v.null()) })),
  }),
  handler: async (ctx) => {
    const posts = await listPosts(ctx, "waiting", 30);
    return {
      total: await countPosts(ctx, "waiting"),
      items: posts.map((p) => ({ kind: p.kind, title: p.listing?.title ?? null })),
    };
  },
});

export const KIND_LABEL: Record<string, string> = {
  award: "Award",
  new_listing: "New listing",
  call_submissions: "Call for submissions",
  call_jury: "Call for jurors",
  roundup: "Weekly roundup",
  announcement: "Announcement",
  custom: "Post",
};

/** A push body: the first few waiting posts, then how many more. */
export function digestBody(labels: string[], total: number) {
  const shown = labels.slice(0, 3);
  const more = total - shown.length;
  return `${shown.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}

/** Cron (morning, Tbilisi): "N posts are waiting", to every admin (email and push). */
export const waitingPing = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const summary: { total: number; items: { kind: string; title: string | null }[] } = await ctx.runQuery(
      internal.social.waitingSummary,
      {},
    );
    const waiting = summary.items;
    if (summary.total === 0) return null;
    const to: string[] = await ctx.runQuery(internal.notify.adminEmails, {});
    const items = waiting.map((w) => `${KIND_LABEL[w.kind] ?? w.kind}${w.title ? `: ${w.title}` : ""}`);
    if (summary.total > waiting.length) items.push(`…and ${summary.total - waiting.length} more`);
    const n = summary.total;
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
    await pushAdmins(ctx, {
      title: `${n} post${n === 1 ? " is" : "s are"} waiting`,
      body: digestBody(waiting.map((w) => `${KIND_LABEL[w.kind] ?? w.kind}${w.title ? `: ${w.title}` : ""}`), n),
      url: studioUrl("/queue"),
      tag: QUEUE_TAG,
    });
    return null;
  },
});
