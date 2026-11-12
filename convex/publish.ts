// Publishing an approved post to every network that has a caption: the
// Facebook Page, Instagram, Threads and Giorgi's LinkedIn profile
// (convex/lib/socialApi.ts does the API calls; channels.ts holds the accounts).
//
//   social.approvePost ─▶ scheduler (now, or at scheduledFor) ─▶ post
//     begin   claims the post for one run (a lease), records networks it must
//             skip (no account), hands back what to publish
//     ...     each network in parallel, its result recorded as soon as it is known
//     finish  sent (every attempted network sent) | failed (any failed, with the
//             error) | approved (nothing could be attempted: connect and retry)
//
// A story (placement "story") goes to Instagram and Facebook only: Threads
// and LinkedIn are recorded as skipped with the reason.
//
// Networks already sent are never sent again, so a retry (social.retryPost)
// only attempts the rest. Every scheduled run carries a run number
// (socialPosts.publishRun): approving or retrying bumps it, so a run that was
// cancelled while already running (Convex lets a running action finish) can't
// claim the post later. Nor can a run before the post's publish time.
//
// One run always ends inside Convex's 10-minute action limit: networks run
// side by side, and every request and wait in lib/socialApi.ts respects a
// deadline (RUN_BUDGET_MS after the run starts). A network that runs out of
// time fails with that reason before it sends anything more; finish still runs.

import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { socialNetwork, socialPlacement } from "./schema";
import { captionedNetworks, postMedia, readStatus, withSizes } from "./social";
import { accountOf, ENV_VARS } from "./channels";
import {
  NETWORK_NAME,
  NO_STORIES,
  PlatformError,
  mediaFor,
  publishFacebook,
  publishInstagram,
  publishLinkedin,
  publishThreads,
  scrub,
  type Draft,
  type MediaItem,
  type Network,
  type Published,
} from "./lib/socialApi";

/** How long one run holds a post (a little under the action limit). */
export const PUBLISH_LEASE_MS = 9.5 * 60_000;
/** No request or wait of a run goes past this (from the run's start), leaving time to record and finish. */
export const RUN_BUDGET_MS = 8.5 * 60_000;
/** A run may start this much before the post's publish time (scheduler jitter). */
const EARLY_MS = 60_000;

type Result = NonNullable<Doc<"socialPosts">["results"]>[number];

const jobValidator = v.object({
  network: socialNetwork,
  caption: v.string(),
  media: v.array(v.any()),
  token: v.string(),
  target: v.string(), // Page id, IG user id, Threads user id or person URN
});
type Job = { network: Network; caption: string; media: MediaItem[]; token: string; target: string };

const draftValidator = v.object({
  link: v.union(v.string(), v.null()),
  title: v.union(v.string(), v.null()),
  description: v.union(v.string(), v.null()),
  thumbnail: v.union(v.string(), v.null()),
  placement: v.optional(socialPlacement),
});

function str(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The link, title and thumbnail a post points to, from its facts. */
function linkInfo(facts: unknown) {
  const f = (facts ?? {}) as { award?: { pageUrl?: unknown }; pageUrl?: unknown; title?: unknown; tagline?: unknown; screenshots?: unknown };
  const shots = Array.isArray(f.screenshots) ? f.screenshots : [];
  return {
    link: str(f.award?.pageUrl) ?? str(f.pageUrl),
    title: str(f.title),
    description: str(f.tagline),
    thumbnail: str(shots[0]),
  };
}

function upsertResult(results: Result[], next: Result) {
  return [...results.filter((r) => r.network !== next.network), next];
}

/**
 * Claims the post for this run. Null when it isn't approved/scheduled, when
 * this run isn't the post's current one (it was cancelled or replaced), when
 * the post's publish time hasn't come, or when another run holds it. Records
 * networks without an account as skipped.
 */
export const begin = internalMutation({
  args: { postId: v.id("socialPosts"), run: v.number() },
  returns: v.union(v.null(), v.object({ jobs: v.array(jobValidator), draft: draftValidator })),
  handler: async (ctx, { postId, run }) => {
    const post = await ctx.db.get(postId);
    if (!post) return null;
    const status = readStatus(post.status);
    if (status !== "approved" && status !== "scheduled") return null;
    if (post.publishRun !== run) return null;
    const now = Date.now();
    if (post.scheduledFor && post.scheduledFor > now + EARLY_MS) return null;
    if (post.publishingUntil && post.publishingUntil > now) return null;

    const meta = await accountOf(ctx, "meta");
    const threads = await accountOf(ctx, "threads");
    const linkedin = await accountOf(ctx, "linkedin");
    const notConnected = (row: Doc<"socialAccounts"> | null, envVar: string, what: string) =>
      row?.lastError
        ? `Not connected: ${row.lastError}`
        : `Not connected: set ${envVar} on Convex${what ? ` (${what})` : ""}, then retry.`;

    let results = post.results ?? [];
    const sent = new Set(results.filter((r) => r.status === "sent").map((r) => r.network));
    const media = postMedia(post);
    const story = post.placement === "story";
    const jobs: Job[] = [];
    for (const network of captionedNetworks(post)) {
      if (sent.has(network)) continue;
      const caption = post.captions![network]!.trim();
      const own = mediaFor(media, network);
      const skip = (error: string) => (results = upsertResult(results, { network, status: "skipped", error, at: now }));
      const failNow = (error: string) => (results = upsertResult(results, { network, status: "failed", error, at: now }));
      const noStories = story ? NO_STORIES[network] : undefined;
      if (noStories) skip(noStories);
      else if (network === "facebook") {
        if (!meta?.ids.pageId) skip(notConnected(meta, ENV_VARS.meta, "a Facebook Page token"));
        // A feed post without media is a text post; a story has nothing to show.
        else if (story && own.length === 0) skip("The story's image or video is not for Facebook; nothing was posted there.");
        // Sizes, so a story's 9:16 check sees them (socialApi.storyProblem).
        else jobs.push({ network, caption, media: story ? await withSizes(ctx, own) : own, token: meta.token, target: meta.ids.pageId });
      } else if (network === "instagram") {
        if (!meta?.ids.igUserId) {
          skip(
            meta?.ids.pageId && !meta.lastError
              ? "Not connected: no Instagram Business account is linked to the Facebook Page."
              : notConnected(meta, ENV_VARS.meta, "a Facebook Page token with a linked Instagram Business account"),
          );
        } else if (own.length === 0) skip("Instagram needs an image or a video; nothing was posted there.");
        // Image sizes, so Instagram's 4:5 to 1.91:1 rule can be met (socialApi.instagramImageUrl).
        else jobs.push({ network, caption, media: await withSizes(ctx, own), token: meta.token, target: meta.ids.igUserId });
      } else if (network === "threads") {
        if (!threads?.ids.threadsUserId) skip(notConnected(threads, ENV_VARS.threads, ""));
        else jobs.push({ network, caption, media: own, token: threads.token, target: threads.ids.threadsUserId });
      } else {
        if (!linkedin?.ids.personUrn) skip(notConnected(linkedin, ENV_VARS.linkedin, ""));
        else if (linkedin.expiresAt && linkedin.expiresAt <= now) {
          failNow("The LinkedIn token expired: generate a new one, set LINKEDIN_ACCESS_TOKEN on Convex, then retry.");
        } else jobs.push({ network, caption, media: own, token: linkedin.token, target: linkedin.ids.personUrn });
      }
    }
    await ctx.db.patch(postId, { results, publishingUntil: now + PUBLISH_LEASE_MS, updatedAt: now });
    return { jobs, draft: { ...linkInfo(post.facts), ...(story ? { placement: "story" as const } : {}) } };
  },
});

/** One network's outcome, saved as soon as it is known. */
export const record = internalMutation({
  args: {
    postId: v.id("socialPosts"),
    network: socialNetwork,
    status: v.union(v.literal("sent"), v.literal("failed")),
    remoteId: v.optional(v.string()),
    url: v.optional(v.string()),
    error: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { postId, ...result }) => {
    const post = await ctx.db.get(postId);
    if (!post) return null;
    const clean = Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined)) as Omit<Result, "at">;
    await ctx.db.patch(postId, { results: upsertResult(post.results ?? [], { ...clean, at: Date.now() }), updatedAt: Date.now() });
    return null;
  },
});

/** The post's status from its results; releases the lease. */
export const finish = internalMutation({
  args: { postId: v.id("socialPosts") },
  returns: v.union(v.literal("sent"), v.literal("failed"), v.literal("approved"), v.null()),
  handler: async (ctx, { postId }) => {
    const post = await ctx.db.get(postId);
    if (!post) return null;
    const now = Date.now();
    const networks = captionedNetworks(post);
    const results = post.results ?? [];
    const latest = networks.map((n) => results.find((r) => r.network === n)).filter((r): r is Result => !!r);
    const failed = latest.filter((r) => r.status === "failed");
    const sent = latest.filter((r) => r.status === "sent");
    const skipped = latest.filter((r) => r.status === "skipped");
    const base = { publishingUntil: undefined, publishJobId: undefined, updatedAt: now };
    if (failed.length > 0) {
      const error = failed.map((r) => `${NETWORK_NAME[r.network]}: ${r.error ?? "failed"}`).join(" · ");
      await ctx.db.patch(postId, { ...base, status: "failed", error });
      return "failed";
    }
    if (sent.length > 0) {
      await ctx.db.patch(postId, { ...base, status: "sent", sentAt: now, error: undefined });
      return "sent";
    }
    // Networks a story never goes to (Threads, LinkedIn) are not missing an account.
    const unconnected = skipped.filter((r) => !(post.placement === "story" && NO_STORIES[r.network]));
    const names = unconnected.map((r) => NETWORK_NAME[r.network]).join(", ") || "any network";
    await ctx.db.patch(postId, {
      ...base,
      status: "approved",
      error: `Nothing was published: no connected account for ${names}. Connect it (Convex env tokens; list_channels shows what's missing), then retry.`,
    });
    return "approved";
  },
});

async function publishOne(job: Job, base: Omit<Draft, "caption" | "media">, deadline: number): Promise<Published> {
  const draft: Draft = { ...base, caption: job.caption, media: job.media };
  if (job.network === "facebook") return await publishFacebook(draft, job.token, job.target, deadline);
  if (job.network === "instagram") return await publishInstagram(draft, job.token, job.target, deadline);
  if (job.network === "threads") return await publishThreads(draft, job.token, job.target, deadline);
  return await publishLinkedin(draft, job.token, job.target, deadline);
}

/** Publishes a post (scheduled by approvePost / retryPost). Idempotent per network. */
export const post = internalAction({
  args: { postId: v.id("socialPosts"), run: v.number() },
  returns: v.union(v.literal("sent"), v.literal("failed"), v.literal("approved"), v.null()),
  handler: async (ctx, { postId, run }): Promise<"sent" | "failed" | "approved" | null> => {
    const deadline = Date.now() + RUN_BUDGET_MS;
    // Newly set env tokens are picked up before publishing.
    try {
      await ctx.runAction(internal.channels.sync, {});
    } catch (err) {
      console.warn(`Channel sync before publishing failed: ${(err as Error).message}`);
    }
    const claim: { jobs: Job[]; draft: Omit<Draft, "caption" | "media"> } | null = await ctx.runMutation(internal.publish.begin, { postId, run });
    if (!claim) return null;
    await Promise.all(
      claim.jobs.map(async (job) => {
        try {
          const done = await publishOne(job, claim.draft, deadline);
          await ctx.runMutation(internal.publish.record, {
            postId,
            network: job.network,
            status: "sent",
            remoteId: done.remoteId,
            url: done.url,
            note: done.note,
          });
        } catch (err) {
          const message = err instanceof PlatformError ? err.message : `Unexpected error: ${(err as Error).message}`;
          await ctx.runMutation(internal.publish.record, {
            postId,
            network: job.network,
            status: "failed",
            error: scrub(message, job.token).slice(0, 1000),
          });
        }
      }),
    );
    return await ctx.runMutation(internal.publish.finish, { postId });
  },
});

