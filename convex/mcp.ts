// The Shemoqmedi MCP connector's backend (the tools live in the admin app,
// lib/mcp/server.ts). Every function takes `token`, the short-lived service
// credential the admin app mints after checking the caller's Clerk OAuth
// token, and runs only for platform admins (lib/mcpAuth.ts). These are the
// social desk's hands: read listings, awards and studios; write, approve,
// publish, schedule and retry posts (feed posts and stories); see the
// connected channels (never their tokens); render graphics and voiceovers and
// find past renders and reels; draft reels for the Studio's reel editor (Claude
// writes the recipe, Giorgi renders it); email studios; broadcast to an audience.

import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { adminFromToken, requireTokenAdmin } from "./lib/mcpAuth";
import { fail, slugify } from "./lib/listingHelpers";
import { mergeSocials, normalizeEmail } from "./lib/contacts";
import { readPillars } from "./lib/scoring";
import { TIER_NAMES } from "./lib/awards";
import { folderOf, mediaDetails, mediaEntry, mediaEntryOf, mediaRole, roleOf } from "./lib/mediaEntry";
import { mediaDetail } from "./lib/design";
import { socialNetwork, socialPlacement, socialPostKind } from "./schema";
import { reelDraftStatus } from "./lib/reel";
import { draftSummary, draftView, insertDraft, patchDraft, resolveLooseRecipe, summarize, viewDraft } from "./reels";
import { rowUrl } from "./lib/media";
import {
  approvePost as approve,
  countPosts,
  captionsValidator,
  createPost as create,
  detailPost,
  editPost,
  listingFacts,
  listPosts,
  mediaValidator,
  postDetailView,
  postView,
  publishPost as publish,
  readStatus,
  rejectPost as reject,
  retryPost as retry,
  unschedulePost as unschedule,
  viewPost,
} from "./social";
import { channelView, type ChannelView } from "./channels";
import { audience, deliver, type Message } from "./emails";
import { ensureListingClaimUrl, newClaimToken } from "./claimLinks";
import { siteUrl } from "./seo";

const token = v.string();

// ─────────────────────────────────────────────────────────────────────────────
// Who
// ─────────────────────────────────────────────────────────────────────────────

/** The signed-in admin, or null (the admin app answers 401 then). */
export const whoami = query({
  args: { token },
  returns: v.union(v.object({ userId: v.id("users"), name: v.string(), email: v.string(), role: v.string() }), v.null()),
  handler: async (ctx, { token }) => {
    const user = await adminFromToken(ctx, token);
    return user ? { userId: user._id, name: user.name, email: user.email, role: user.role ?? "admin" } : null;
  },
});

/** For actions: the admin behind a token, or throws. */
export const checkToken = internalQuery({
  args: { token },
  returns: v.id("users"),
  handler: async (ctx, { token }) => (await requireTokenAdmin(ctx, token))._id,
});

// ─────────────────────────────────────────────────────────────────────────────
// Listings, awards, studios
// ─────────────────────────────────────────────────────────────────────────────

async function listingBySlug(ctx: Parameters<typeof requireTokenAdmin>[0], slug: string) {
  const listing = await ctx.db
    .query("listings")
    .withIndex("by_slug", (q) => q.eq("slug", slug.trim().toLowerCase()))
    .first();
  if (!listing) fail(`No listing with the slug "${slug}". Use search_listings to find it.`);
  return listing;
}

function summary(l: Doc<"listings">) {
  return {
    slug: l.slug,
    title: l.title,
    studio: l.creditName,
    status: l.status,
    awards: l.awards,
    finalScore: l.finalScore ?? null,
    isClaimed: l.isClaimed,
    publishedAt: l.publishedAt ?? null,
  };
}

export const searchListings = query({
  args: {
    token,
    text: v.optional(v.string()),
    status: v.optional(v.union(v.literal("pending"), v.literal("in_voting"), v.literal("awarded"), v.literal("archived"), v.literal("rejected"))),
    limit: v.optional(v.number()),
  },
  returns: v.array(v.any()),
  handler: async (ctx, { token, text, status, limit }) => {
    await requireTokenAdmin(ctx, token);
    const rows = status
      ? await ctx.db.query("listings").withIndex("by_status", (q) => q.eq("status", status)).order("desc").take(1000)
      : await ctx.db.query("listings").order("desc").take(1000);
    const needle = text?.trim().toLowerCase();
    const hits = needle
      ? rows.filter((l) => [l.title, l.creditName, l.slug, l.url, l.tagline].some((f) => f.toLowerCase().includes(needle)))
      : rows;
    return hits.slice(0, Math.min(Math.max(limit ?? 25, 1), 100)).map(summary);
  },
});

export const getListing = query({
  args: { token, slug: v.string() },
  returns: v.any(),
  handler: async (ctx, { token, slug }) => {
    await requireTokenAdmin(ctx, token);
    const listing = await listingBySlug(ctx, slug);
    const creator = listing.creatorId ? await ctx.db.get(listing.creatorId) : null;
    const ownerId = listing.ownerId ?? creator?.claimedBy;
    const owner = ownerId ? await ctx.db.get(ownerId) : null;
    const evaluations = await ctx.db
      .query("juryEvaluations")
      .withIndex("by_listing", (q) => q.eq("listingId", listing._id))
      .take(50);
    const jurors = await Promise.all(evaluations.map((e) => ctx.db.get(e.jurorId)));
    const posts = await ctx.db
      .query("socialPosts")
      .withIndex("by_listing_kind", (q) => q.eq("listingId", listing._id))
      .take(20);
    const emails = await ctx.db
      .query("emailLog")
      .withIndex("by_listing_kind", (q) => q.eq("listingId", listing._id))
      .take(20);
    return {
      ...(await listingFacts(ctx, listing)),
      private: {
        contactEmail: creator?.contactEmail ?? null,
        owner: owner ? { name: owner.name, email: owner.email } : null,
        claimLink: listing.claimToken ? `${siteUrl()}/claim/${listing.claimToken}` : null,
        reviewNote: listing.reviewNote ?? null,
      },
      jury: evaluations.map((e, i) => ({
        juror: jurors[i]?.name ?? "Juror",
        title: jurors[i]?.title ?? null,
        scores: readPillars(e.scores),
        comment: e.comment,
      })),
      socialPosts: posts.map((p) => ({ id: p._id, kind: p.kind ?? "award", status: readStatus(p.status) })),
      emailsSent: emails.map((e) => ({ kind: e.kind, to: e.to, status: e.status, sentAt: e.sentAt })),
    };
  },
});

export const listAwards = query({
  args: { token, limit: v.optional(v.number()) },
  returns: v.array(v.any()),
  handler: async (ctx, { token, limit }) => {
    await requireTokenAdmin(ctx, token);
    const awards = await ctx.db.query("awards").order("desc").take(Math.min(Math.max(limit ?? 20, 1), 100));
    return Promise.all(
      awards.map(async (a) => {
        const listing = await ctx.db.get(a.listingId);
        return {
          tier: a.tier,
          name: TIER_NAMES[a.tier],
          period: a.period,
          date: a.date,
          status: a.status,
          score: a.score,
          pageUrl: `${siteUrl()}/awards/${a.slug}`,
          listing: listing ? { slug: listing.slug, title: listing.title, studio: listing.creditName } : null,
          emailed: Boolean(a.notifiedAt),
        };
      }),
    );
  },
});

export const getCreator = query({
  args: { token, slug: v.string() },
  returns: v.any(),
  handler: async (ctx, { token, slug }) => {
    await requireTokenAdmin(ctx, token);
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_slug", (q) => q.eq("slug", slug.trim().toLowerCase()))
      .first();
    if (!creator) fail(`No creator with the slug "${slug}".`);
    const owner = creator.claimedBy ? await ctx.db.get(creator.claimedBy) : null;
    const listings = await ctx.db
      .query("listings")
      .withIndex("by_creator", (q) => q.eq("creatorId", creator._id))
      .take(200);
    return {
      slug: creator.slug,
      name: creator.name,
      tier: creator.tier,
      region: creator.region,
      location: creator.location ?? null,
      website: creator.website ?? null,
      links: creator.links ?? [],
      bio: creator.bio ?? null,
      contactEmail: creator.contactEmail ?? null,
      socials: creator.socials ?? {},
      isClaimed: creator.isClaimed,
      owner: owner ? { name: owner.name, email: owner.email } : null,
      pageUrl: `${siteUrl()}/creators/${creator.slug}`,
      listings: listings.map(summary),
    };
  },
});

/** Studios we can't email yet (no owner, no contact email) with a public listing: outreach to-do. */
export const studiosWithoutContact = query({
  args: { token },
  returns: v.array(v.any()),
  handler: async (ctx, { token }) => {
    await requireTokenAdmin(ctx, token);
    const creators = await ctx.db.query("creators").take(1000);
    const out = [];
    for (const c of creators) {
      if (c.contactEmail || c.claimedBy) continue;
      const listings = await ctx.db
        .query("listings")
        .withIndex("by_creator", (q) => q.eq("creatorId", c._id))
        .take(50);
      const live = listings.filter((l) => l.status === "in_voting" || l.status === "awarded" || l.status === "archived");
      if (live.length === 0 || live.every((l) => l.ownerId)) continue;
      out.push({ slug: c.slug, name: c.name, website: c.website ?? null, links: c.links ?? [], listings: live.map((l) => l.title) });
    }
    return out;
  },
});

export const updateCreator = mutation({
  args: {
    token,
    slug: v.string(),
    contactEmail: v.optional(v.string()), // "" clears
    socials: v.optional(v.object({ instagram: v.optional(v.string()), facebook: v.optional(v.string()), linkedin: v.optional(v.string()) })),
  },
  returns: v.object({ contactEmail: v.union(v.string(), v.null()), socials: v.any() }),
  handler: async (ctx, { token, slug, contactEmail, socials }) => {
    await requireTokenAdmin(ctx, token);
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_slug", (q) => q.eq("slug", slug.trim().toLowerCase()))
      .first();
    if (!creator) fail(`No creator with the slug "${slug}".`);
    const nextEmail = contactEmail === undefined ? creator.contactEmail : contactEmail.trim() ? normalizeEmail(contactEmail) : undefined;
    const nextSocials = socials === undefined ? creator.socials : mergeSocials(creator.socials, socials);
    await ctx.db.patch(creator._id, { contactEmail: nextEmail, socials: nextSocials, updatedAt: Date.now() });
    return { contactEmail: nextEmail ?? null, socials: nextSocials ?? {} };
  },
});

export const ensureClaim = internalMutation({
  args: { slug: v.string(), freshToken: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { slug, freshToken }) => {
    const listing = await listingBySlug(ctx, slug);
    return await ensureListingClaimUrl(ctx, listing._id, freshToken);
  },
});

/** The claim link of an unclaimed listing (minted on first use), for outreach. */
export const claimLink = action({
  args: { token, slug: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { token, slug }): Promise<string | null> => {
    await ctx.runQuery(internal.mcp.checkToken, { token });
    return await ctx.runMutation(internal.mcp.ensureClaim, { slug, freshToken: newClaimToken() });
  },
});

export const stats = query({
  args: { token },
  returns: v.any(),
  handler: async (ctx, { token }) => {
    await requireTokenAdmin(ctx, token);
    const byStatus: Record<string, number> = {};
    for (const s of ["waiting", "approved", "scheduled", "sent", "failed", "rejected"] as const) {
      byStatus[s] = await countPosts(ctx, s);
    }
    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const emails = await ctx.db
      .query("emailLog")
      .withIndex("by_sentAt", (q) => q.gte("sentAt", since))
      .take(5000);
    const listingsByStatus: Record<string, number> = {};
    for (const s of ["pending", "in_voting", "awarded", "archived"] as const) {
      listingsByStatus[s] = (await ctx.db.query("listings").withIndex("by_status", (q) => q.eq("status", s)).take(2000)).length;
    }
    const creators = await ctx.db.query("creators").take(2000);
    return {
      socialPosts: byStatus,
      emailsLast30Days: {
        sent: emails.filter((e) => e.status === "sent").length,
        failed: emails.filter((e) => e.status === "failed").length,
        skipped: emails.filter((e) => e.status === "skipped").length,
      },
      listings: listingsByStatus,
      creators: { total: creators.length, withContactEmail: creators.filter((c) => c.contactEmail).length, claimed: creators.filter((c) => c.isClaimed).length },
      optOuts: (await ctx.db.query("emailOptOuts").take(5000)).length,
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// The social queue
// ─────────────────────────────────────────────────────────────────────────────

const statusFilter = v.union(
  v.literal("waiting"),
  v.literal("approved"),
  v.literal("scheduled"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("rejected"),
  v.literal("all"),
);

export const socialQueue = query({
  args: { token, status: v.optional(statusFilter), limit: v.optional(v.number()) },
  returns: v.array(postView),
  handler: async (ctx, { token, status, limit }) => {
    await requireTokenAdmin(ctx, token);
    return await listPosts(ctx, status ?? "waiting", Math.min(Math.max(limit ?? 20, 1), 100));
  },
});

/** One post, with `mediaDetails`: each media item's size and design recipe (to edit a graphic: re-render from it). */
export const getPost = query({
  args: { token, id: v.id("socialPosts") },
  returns: postDetailView,
  handler: async (ctx, { token, id }) => {
    await requireTokenAdmin(ctx, token);
    const post = await ctx.db.get(id);
    if (!post) fail("Post not found.");
    return await detailPost(ctx, post);
  },
});

export const updatePost = mutation({
  args: {
    token,
    id: v.id("socialPosts"),
    captions: v.optional(captionsValidator),
    media: v.optional(mediaValidator),
    scheduledFor: v.optional(v.union(v.number(), v.null())),
    note: v.optional(v.string()),
    placement: v.optional(socialPlacement),
  },
  returns: postView,
  handler: async (ctx, { token, id, ...edit }) => {
    await requireTokenAdmin(ctx, token);
    await editPost(ctx, id, edit);
    return await viewPost(ctx, (await ctx.db.get(id))!);
  },
});

export const createPost = mutation({
  args: {
    token,
    kind: socialPostKind,
    listingSlug: v.optional(v.string()),
    facts: v.optional(v.any()),
    captions: v.optional(captionsValidator),
    media: v.optional(mediaValidator),
    placement: v.optional(socialPlacement),
  },
  returns: postView,
  handler: async (ctx, { token, listingSlug, ...input }) => {
    await requireTokenAdmin(ctx, token);
    const listing = listingSlug ? await listingBySlug(ctx, listingSlug) : null;
    const id = await create(ctx, { ...input, listingId: listing?._id });
    return await viewPost(ctx, (await ctx.db.get(id))!);
  },
});

export const approvePost = mutation({
  args: { token, id: v.id("socialPosts") },
  returns: postView,
  handler: async (ctx, { token, id }) => {
    const admin = await requireTokenAdmin(ctx, token);
    await approve(ctx, id, admin._id);
    return await viewPost(ctx, (await ctx.db.get(id))!);
  },
});

/** Approve and publish in one step: now, or at `at` (epoch ms) when that is in the future. */
export const publishPost = mutation({
  args: { token, id: v.id("socialPosts"), at: v.optional(v.number()) },
  returns: postView,
  handler: async (ctx, { token, id, at }) => {
    const admin = await requireTokenAdmin(ctx, token);
    await publish(ctx, id, admin._id, at);
    return await viewPost(ctx, (await ctx.db.get(id))!);
  },
});

export const unschedulePost = mutation({
  args: { token, id: v.id("socialPosts") },
  returns: postView,
  handler: async (ctx, { token, id }) => {
    await requireTokenAdmin(ctx, token);
    await unschedule(ctx, id);
    return await viewPost(ctx, (await ctx.db.get(id))!);
  },
});

export const rejectPost = mutation({
  args: { token, id: v.id("socialPosts"), note: v.optional(v.string()) },
  returns: postView,
  handler: async (ctx, { token, id, note }) => {
    await requireTokenAdmin(ctx, token);
    await reject(ctx, id, note);
    return await viewPost(ctx, (await ctx.db.get(id))!);
  },
});

export const retryPost = mutation({
  args: { token, id: v.id("socialPosts") },
  returns: postView,
  handler: async (ctx, { token, id }) => {
    await requireTokenAdmin(ctx, token);
    await retry(ctx, id);
    return await viewPost(ctx, (await ctx.db.get(id))!);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Channels (the accounts posts go to; tokens never leave Convex)
// ─────────────────────────────────────────────────────────────────────────────

/** Picks up newly set env tokens, then lists the four networks: account, expiry, last error. */
export const listChannels = action({
  args: { token },
  returns: v.array(channelView),
  handler: async (ctx, { token }): Promise<ChannelView[]> => {
    await ctx.runQuery(internal.mcp.checkToken, { token });
    await ctx.runAction(internal.channels.sync, {});
    return await ctx.runQuery(internal.channels.view, {});
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Graphics and voiceovers (graphics.ts, voiceover.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** One graphic (JPEG on ImageKit): graphics.render. */
export const renderGraphic = action({
  args: {
    token,
    template: v.string(),
    format: v.string(),
    palette: v.string(),
    fields: v.optional(v.record(v.string(), v.string())),
    imageUrls: v.optional(v.array(v.string())),
    glass: v.optional(v.string()),
    style: v.optional(v.string()),
  },
  returns: v.object({ url: v.string(), mediaId: v.id("media"), width: v.number(), height: v.number() }),
  handler: async (ctx, { token, ...args }): Promise<{ url: string; mediaId: Id<"media">; width: number; height: number }> => {
    await ctx.runQuery(internal.mcp.checkToken, { token });
    return await ctx.runAction(internal.graphics.render, args);
  },
});

/** The storytelling carousel of a listing (or of facts): graphics.renderCarousel. */
export const renderCarousel = action({
  args: {
    token,
    listingSlug: v.optional(v.string()),
    facts: v.optional(v.record(v.string(), v.string())),
    palette: v.string(),
    style: v.optional(v.string()),
    story: v.optional(
      v.object({
        chips: v.optional(v.array(v.string())),
        notes: v.optional(v.array(v.string())),
        cta: v.optional(v.string()),
        glass: v.optional(v.string()),
        shots: v.optional(v.array(v.string())),
        mobile: v.optional(v.string()),
      }),
    ),
  },
  returns: v.object({ urls: v.array(v.string()), mediaIds: v.array(v.id("media")), slides: v.array(v.string()) }),
  handler: async (ctx, { token, listingSlug, ...args }): Promise<{ urls: string[]; mediaIds: Id<"media">[]; slides: string[] }> => {
    await ctx.runQuery(internal.mcp.checkToken, { token });
    const listingId: Id<"listings"> | undefined = listingSlug
      ? await ctx.runQuery(internal.mcp.listingIdBySlug, { slug: listingSlug })
      : undefined;
    return await ctx.runAction(internal.graphics.renderCarousel, { ...args, listingId });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Media: past renders, reels, screenshots (the media table)
// ─────────────────────────────────────────────────────────────────────────────

export { folderOf, roleOf };

/** How far back list_media looks (newest rows first); the media table has no kind or role index. */
const MEDIA_SCAN = 2000;

/** Uploaded files newest first, by kind, role and/or folder (prefix), with URLs and sizes. Never invalid ones. */
export const listMedia = query({
  args: {
    token,
    kind: v.optional(v.union(v.literal("image"), v.literal("video"))),
    role: v.optional(mediaRole),
    folder: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(mediaEntry),
  handler: async (ctx, { token, kind, role, folder, limit }) => {
    await requireTokenAdmin(ctx, token);
    const n = Math.min(Math.max(Math.floor(limit ?? 20), 1), 100);
    const clean = folder?.trim().replace(/^\/+|\/+$/g, "");
    const prefix = clean ? `/${clean}` : null;
    const rows = await ctx.db.query("media").order("desc").take(MEDIA_SCAN);
    return rows
      .filter(
        (row) =>
          !row.invalid &&
          (!kind || row.kind === kind) &&
          (!role || roleOf(row) === role) &&
          (!prefix || row.filePath === prefix || row.filePath.startsWith(`${prefix}/`)),
      )
      .slice(0, n)
      .map(mediaEntryOf);
  },
});

/** At most this many URLs per getDesigns call. */
const DESIGNS_MAX = 50;

/** Size and design recipe of each URL, in order (nulls for a file we don't hold, or a render from before recipes). */
export const getDesigns = query({
  args: { token, urls: v.array(v.string()) },
  returns: v.array(mediaDetail),
  handler: async (ctx, { token, urls }) => {
    await requireTokenAdmin(ctx, token);
    if (urls.length > DESIGNS_MAX) fail(`At most ${DESIGNS_MAX} URLs at once.`);
    return await mediaDetails(ctx, urls);
  },
});

/** The newest reel registered for a listing (R2 social/<slug>/…-reel-….mp4), or null. */
export const findReel = query({
  args: { token, listingSlug: v.string() },
  returns: v.union(mediaEntry, v.null()),
  handler: async (ctx, { token, listingSlug }) => {
    await requireTokenAdmin(ctx, token);
    const listing = await listingBySlug(ctx, listingSlug);
    // R2 rows use the object key as fileId, so the listing's social folder is a
    // range of by_fileId. The folder is the slug as socialKey writes it
    // (slugified, at most 60 characters), not always the listing's own slug.
    const folder = `social/${slugify(listing.slug)}`;
    const rows = await ctx.db
      .query("media")
      .withIndex("by_fileId", (q) => q.gte("fileId", `${folder}/`).lt("fileId", `${folder}0`))
      .take(500);
    const reels = rows.filter((row) => !row.invalid && roleOf(row) === "reel").sort((a, b) => b.createdAt - a.createdAt);
    return reels[0] ? mediaEntryOf(reels[0]) : null;
  },
});

type VoiceList = {
  voices: { name: string; voiceId: string; description?: string; previewUrl?: string }[];
  wordsPerSecond: number;
  video?: { title: string; videoUrl: string; durationSec: number; targetWords: number };
};

/** The narrators; with a listing, also its preview's length and the word budget. */
export const listVoices = action({
  args: { token, listingSlug: v.optional(v.string()) },
  returns: v.object({
    voices: v.array(
      v.object({ name: v.string(), voiceId: v.string(), description: v.optional(v.string()), previewUrl: v.optional(v.string()) }),
    ),
    wordsPerSecond: v.number(),
    video: v.optional(v.object({ title: v.string(), videoUrl: v.string(), durationSec: v.number(), targetWords: v.number() })),
  }),
  handler: async (ctx, { token, listingSlug }): Promise<VoiceList> => {
    await ctx.runQuery(internal.mcp.checkToken, { token });
    const list: VoiceList = await ctx.runAction(internal.voiceover.listVoices, {});
    if (!listingSlug) return list;
    const listingId: Id<"listings"> = await ctx.runQuery(internal.mcp.listingIdBySlug, { slug: listingSlug });
    const info: { title: string; videoUrl: string; durationSec: number; targetWords: number } = await ctx.runAction(
      internal.voiceover.videoInfo,
      { listingId },
    );
    return { ...list, video: { title: info.title, videoUrl: info.videoUrl, durationSec: info.durationSec, targetWords: info.targetWords } };
  },
});

/** Voices a script for a listing (spends ElevenLabs credits): voiceover.create. */
export const createVoiceover = action({
  args: { token, listingSlug: v.string(), script: v.string(), voice: v.string() },
  returns: v.object({ audioUrl: v.string(), durationSec: v.number(), narrationId: v.id("reelAudio") }),
  handler: async (ctx, { token, listingSlug, script, voice }): Promise<{ audioUrl: string; durationSec: number; narrationId: Id<"reelAudio"> }> => {
    await ctx.runQuery(internal.mcp.checkToken, { token });
    const listingId: Id<"listings"> = await ctx.runQuery(internal.mcp.listingIdBySlug, { slug: listingSlug });
    return await ctx.runAction(internal.voiceover.create, { listingId, script, voice });
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Reel drafts (convex/reels.ts, docs/reel-editor.md). Claude writes the
// recipe; the Studio renders it in the browser when Giorgi opens it.
// ─────────────────────────────────────────────────────────────────────────────

/** A reel draft from a (loose) recipe: status "ready", Giorgi gets a push to open and render it. */
export const createReelDraft = mutation({
  args: {
    token,
    recipe: v.any(),
    title: v.optional(v.string()),
    note: v.optional(v.string()),
    postId: v.optional(v.id("socialPosts")),
  },
  returns: draftView,
  handler: async (ctx, { token, recipe, ...rest }) => {
    const user = await requireTokenAdmin(ctx, token);
    const full = await resolveLooseRecipe(ctx, recipe);
    const id = await insertDraft(ctx, { ...rest, recipe: full, createdBy: "claude", userId: user._id });
    return await viewDraft(ctx, (await ctx.db.get(id))!);
  },
});

/** Changes a draft: a new recipe replaces the old one whole and makes it "ready" again (needs a new render). */
export const updateReelDraft = mutation({
  args: {
    token,
    id: v.id("reelDrafts"),
    recipe: v.optional(v.any()),
    title: v.optional(v.string()),
    note: v.optional(v.string()),
    postId: v.optional(v.union(v.id("socialPosts"), v.null())),
  },
  returns: draftView,
  handler: async (ctx, { token, id, recipe, ...rest }) => {
    await requireTokenAdmin(ctx, token);
    const full = recipe === undefined ? undefined : await resolveLooseRecipe(ctx, recipe);
    await patchDraft(ctx, id, { ...rest, recipe: full }, "claude");
    return await viewDraft(ctx, (await ctx.db.get(id))!);
  },
});

export const getReelDraft = query({
  args: { token, id: v.id("reelDrafts") },
  returns: draftView,
  handler: async (ctx, { token, id }) => {
    await requireTokenAdmin(ctx, token);
    const d = await ctx.db.get(id);
    if (!d) fail("Reel draft not found.");
    return await viewDraft(ctx, d);
  },
});

export const listReelDrafts = query({
  args: { token, status: v.optional(reelDraftStatus), limit: v.optional(v.number()) },
  returns: v.array(draftSummary),
  handler: async (ctx, { token, status, limit }) => {
    await requireTokenAdmin(ctx, token);
    const n = Math.min(Math.max(Math.floor(limit ?? 20), 1), 100);
    const rows = status
      ? await ctx.db.query("reelDrafts").withIndex("by_status", (q) => q.eq("status", status)).order("desc").take(n)
      : await ctx.db.query("reelDrafts").withIndex("by_updated").order("desc").take(n);
    return await Promise.all(rows.map((d) => summarize(ctx, d)));
  },
});

/**
 * Puts a draft's rendered reel into a post (update_post rules: a story needs
 * a 9:16 reel of 3-60 s; editing an approved/scheduled/failed post sends it
 * back to waiting). Default: the reel becomes the post's only media;
 * replaceIndex swaps one item; keepOthers puts it first and keeps the rest
 * (refused when the post already has 10 items or this reel).
 * Never publishes.
 */
export const attachReel = mutation({
  args: {
    token,
    postId: v.id("socialPosts"),
    draftId: v.id("reelDrafts"),
    replaceIndex: v.optional(v.number()),
    keepOthers: v.optional(v.boolean()),
    networks: v.optional(v.array(socialNetwork)),
  },
  returns: postView,
  handler: async (ctx, { token, postId, draftId, replaceIndex, keepOthers, networks }) => {
    await requireTokenAdmin(ctx, token);
    const draft = await ctx.db.get(draftId);
    if (!draft) fail("Reel draft not found.");
    const row = draft.mediaId ? await ctx.db.get(draft.mediaId) : null;
    if (draft.status !== "rendered" || !row || row.invalid) {
      fail(
        draft.mediaId && draft.status !== "rendered"
          ? "This reel changed since its last render. Ask Giorgi to open it in the Studio (Reels) and render it again."
          : "This reel is not rendered yet. Ask Giorgi to open it in the Studio (Reels) and render it.",
      );
    }
    const post = await ctx.db.get(postId);
    if (!post) fail("Post not found.");
    const item = { kind: "video" as const, url: rowUrl(row), role: "reel", ...(networks?.length ? { networks } : {}) };
    const current = post.media ?? [];
    let media;
    if (replaceIndex !== undefined) {
      const i = Math.floor(replaceIndex);
      if (!(i >= 0 && i < current.length)) fail(`The post has ${current.length} media items: replaceIndex is 0-${Math.max(0, current.length - 1)}.`);
      const old = current[i];
      media = current.map((m, j) => (j === i ? { ...item, networks: networks?.length ? networks : old.networks } : m));
    } else if (keepOthers) {
      if (current.some((m) => m.url === item.url)) fail("This reel is already in the post. Use replaceIndex to move or change it.");
      if (current.length >= 10) fail(`The post has ${current.length} media items, the most it can have. Use replaceIndex to swap one for the reel.`);
      media = [item, ...current];
    } else {
      media = [item];
    }
    const clean = media.map((m) => ({
      kind: m.kind,
      url: m.url,
      ...(m.role ? { role: m.role } : {}),
      ...(m.networks?.length ? { networks: m.networks } : {}),
    }));
    await editPost(ctx, postId, { media: clean });
    await ctx.db.patch(draftId, { postId });
    return await viewPost(ctx, (await ctx.db.get(postId))!);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Email
// ─────────────────────────────────────────────────────────────────────────────

export const creatorContact = internalQuery({
  args: { slug: v.string() },
  returns: v.union(v.object({ email: v.string(), name: v.string(), creatorId: v.id("creators") }), v.null()),
  handler: async (ctx, { slug }) => {
    const creator = await ctx.db
      .query("creators")
      .withIndex("by_slug", (q) => q.eq("slug", slug.trim().toLowerCase()))
      .first();
    if (!creator) fail(`No creator with the slug "${slug}".`);
    const owner = creator.claimedBy ? await ctx.db.get(creator.claimedBy) : null;
    const email = owner?.email ?? creator.contactEmail;
    return email ? { email, name: owner?.name ?? creator.name, creatorId: creator._id } : null;
  },
});

export const listingIdBySlug = internalQuery({
  args: { slug: v.string() },
  returns: v.id("listings"),
  handler: async (ctx, { slug }) => (await listingBySlug(ctx, slug))._id,
});

type EmailPreview = { sent: boolean; to: string; subject: string; text: string; status?: string; error?: string };
type StudioContact = {
  email: string;
  name: string;
  title: string;
  pageUrl: string;
  claimUrl: string | null;
  creatorId: Id<"creators"> | null;
  isOwner: boolean;
};

const emailPreview = v.object({
  sent: v.boolean(),
  to: v.string(),
  subject: v.string(),
  text: v.string(),
  status: v.optional(v.string()),
  error: v.optional(v.string()),
});

/**
 * One email Claude wrote, to a listing's studio (owner or contact email; its
 * claim link available as {claimLink} in the body), a creator, or any address
 * (outreach to a studio that isn't listed yet). Without `confirm` it only
 * returns the preview.
 */
export const sendEmail = action({
  args: {
    token,
    listingSlug: v.optional(v.string()),
    creatorSlug: v.optional(v.string()),
    to: v.optional(v.string()),
    subject: v.string(),
    body: v.string(),
    confirm: v.boolean(),
  },
  returns: emailPreview,
  handler: async (ctx, args): Promise<EmailPreview> => {
    await ctx.runQuery(internal.mcp.checkToken, { token: args.token });
    const subject = args.subject.trim();
    if (!subject || subject.length > 200) fail("The subject must be 1–200 characters.");
    if (!args.body.trim() || args.body.length > 10_000) fail("The body must be 1–10,000 characters.");
    let to: string;
    let meta: { kind: "outreach" | "custom"; listingId?: Id<"listings">; creatorId?: Id<"creators"> };
    let claimLink: string | null = null;
    if (args.listingSlug) {
      const listingId: Id<"listings"> = await ctx.runQuery(internal.mcp.listingIdBySlug, { slug: args.listingSlug });
      const contact: StudioContact | null = await ctx.runMutation(internal.social.studioContact, {
        listingId,
        freshToken: newClaimToken(),
      });
      if (!contact && !args.to) fail("This listing's studio has no email yet: set one with update_creator, or pass `to`.");
      to = args.to ?? contact!.email;
      claimLink = contact?.claimUrl ?? null;
      meta = { kind: "custom", listingId, creatorId: contact?.creatorId ?? undefined };
    } else if (args.creatorSlug) {
      const contact: { email: string; name: string; creatorId: Id<"creators"> } | null = await ctx.runQuery(
        internal.mcp.creatorContact,
        { slug: args.creatorSlug },
      );
      if (!contact && !args.to) fail("This creator has no email yet: set one with update_creator, or pass `to`.");
      to = args.to ?? contact!.email;
      meta = { kind: "custom", creatorId: contact?.creatorId };
    } else if (args.to) {
      to = args.to;
      meta = { kind: "outreach" };
    } else {
      fail("Say who it's for: listingSlug, creatorSlug or to.");
    }
    to = normalizeEmail(to);
    if (args.body.includes("{claimLink}") && !claimLink) fail("{claimLink} works only for an unclaimed listing (listingSlug).");
    const text: string = args.body.replaceAll("{claimLink}", claimLink ?? "").trim();
    if (!args.confirm) return { sent: false, to, subject, text };
    const message: Message = { subject, text };
    const result = await deliver(ctx, to, message, meta);
    return { sent: result.status === "sent", to, subject, text, status: result.status, ...(result.error ? { error: result.error } : {}) };
  },
});

/** Preview (count + a few addresses) or, with `confirm`, start a broadcast in the background. */
export const sendBroadcast = action({
  args: { token, audience, subject: v.string(), body: v.string(), confirm: v.boolean() },
  returns: v.object({ started: v.boolean(), recipients: v.number(), sample: v.array(v.string()), broadcastId: v.optional(v.string()) }),
  handler: async (ctx, { token, audience, subject, body, confirm }) => {
    await ctx.runQuery(internal.mcp.checkToken, { token });
    if (!subject.trim() || subject.length > 200) fail("The subject must be 1–200 characters.");
    if (!body.trim() || body.length > 20_000) fail("The body must be 1–20,000 characters.");
    const emails: string[] = await ctx.runQuery(internal.emails.audienceEmails, { audience });
    if (!confirm) return { started: false, recipients: emails.length, sample: emails.slice(0, 10) };
    if (emails.length === 0) fail("Nobody is in this audience.");
    const broadcastId = `b${Date.now().toString(36)}`;
    await ctx.scheduler.runAfter(0, internal.emails.broadcast, { audience, subject: subject.trim(), body, broadcastId });
    return { started: true, recipients: emails.length, sample: emails.slice(0, 10), broadcastId };
  },
});

export const emailHistory = query({
  args: { token, to: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.array(v.any()),
  handler: async (ctx, { token, to, limit }) => {
    await requireTokenAdmin(ctx, token);
    const n = Math.min(Math.max(limit ?? 30, 1), 200);
    const rows = to
      ? await ctx.db.query("emailLog").withIndex("by_to", (q) => q.eq("to", to.trim().toLowerCase())).order("desc").take(n)
      : await ctx.db.query("emailLog").withIndex("by_sentAt").order("desc").take(n);
    return rows.map((r) => ({ to: r.to, subject: r.subject, kind: r.kind, status: r.status, error: r.error ?? null, sentAt: r.sentAt, broadcastId: r.broadcastId ?? null }));
  },
});
