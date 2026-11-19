// What the MCP connector may not do by itself: send an email, start a
// broadcast, or publish a social post. The connector's tools only ask
// (requestAction): a row waits here with exactly what would go out, admins
// get a push, and an admin approves or rejects it in the admin (Social) or
// the Studio (Queue). Only `approve`, a Clerk-session mutation that requires
// the admin role, executes it, through the same internals the Studio uses
// (social.ts approvePost / publishPost / retryPost, emails.ts deliver and
// broadcast). The connector's credential can't call it: MCP calls carry a
// service token, not a Clerk session, so Claude saying "approved" never counts.
//
// Daily caps (lib/config.ts MCP_DAILY_CAPS) apply twice: when Claude asks, so
// a looping or prompt-injected agent can't flood the list, and again when an
// admin approves, so a full list can't be approved past them.

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./authHelpers";
import { fail } from "./lib/listingHelpers";
import { MCP_DAILY_CAPS, PENDING_ACTION_TTL_MS, type McpCaps } from "./lib/config";
import { DAY_MS } from "./lib/time";
import { pendingActionKind, pendingActionStatus } from "./schema";
import { approvePost, captionedNetworks, checkApprovable, checkPublishable, checkRetryable, postMedia, publishPost, retryPost } from "./social";
import { deliver, type Audience } from "./emails";
import { pushAdmins } from "./push";
import { studioUrl } from "../lib/hosts";

export type PendingKind = Doc<"pendingActions">["kind"];

export type EmailPayload = {
  to: string;
  subject: string;
  text: string;
  meta: { kind: "outreach" | "custom"; listingId?: Id<"listings">; creatorId?: Id<"creators"> };
};
export type BroadcastPayload = { audience: Audience; subject: string; body: string; recipients: number; sample: string[] };
/** A post as it was when Claude asked: approving refuses when it changed since. */
export type PostSnapshot = {
  captions: Record<string, string>;
  media: { kind: "image" | "video"; url: string; networks?: string[] }[];
  placement: "feed" | "story";
  scheduledFor: number | null;
  networks: string[];
};
export type PostPayload = {
  postId: Id<"socialPosts">;
  mode: "approve" | "publish" | "retry";
  at?: number;
  title: string;
  snapshot: PostSnapshot;
};

/** Which daily cap a kind counts against. */
const CAP_OF: Record<PendingKind, keyof McpCaps> = {
  send_email: "emails",
  send_broadcast: "broadcasts",
  publish_post: "posts",
  retry_post: "posts",
};
const CAP_LABEL: Record<keyof McpCaps, string> = { emails: "emails", broadcasts: "broadcasts", posts: "post publishes" };

function kindsFor(cap: keyof McpCaps): PendingKind[] {
  return (Object.keys(CAP_OF) as PendingKind[]).filter((k) => CAP_OF[k] === cap);
}

/** Requests of these kinds that still count (waiting or approved) made since `since`. */
async function countRequested(ctx: QueryCtx, kinds: PendingKind[], since: number) {
  let n = 0;
  for (const kind of kinds) {
    const rows = await ctx.db
      .query("pendingActions")
      .withIndex("by_kind", (q) => q.eq("kind", kind).gte("createdAt", since))
      .take(500);
    n += rows.filter((r) => r.status === "pending" || r.status === "approved").length;
  }
  return n;
}

/** Requests of these kinds an admin approved since `since` (a request stays approvable for PENDING_ACTION_TTL_MS). */
async function countExecuted(ctx: QueryCtx, kinds: PendingKind[], since: number) {
  let n = 0;
  for (const kind of kinds) {
    const rows = await ctx.db
      .query("pendingActions")
      .withIndex("by_kind", (q) => q.eq("kind", kind).gte("createdAt", since - PENDING_ACTION_TTL_MS))
      .take(1000);
    n += rows.filter((r) => r.status === "approved" && (r.decidedAt ?? 0) >= since).length;
  }
  return n;
}

function capMessage(cap: keyof McpCaps) {
  return `Daily limit reached: the connector may send at most ${MCP_DAILY_CAPS[cap]} ${CAP_LABEL[cap]} in 24 hours.`;
}

export const WAITING_MESSAGE =
  "Nothing was sent or published yet: this is waiting for approval in Studio. Giorgi approves or rejects it under Pending on the Studio's Queue, or on the admin's Social page.";

/** A request, shaped for the connector's answer. */
export const requestView = v.object({
  pendingActionId: v.id("pendingActions"),
  status: v.literal("pending"),
  summary: v.string(),
  message: v.string(),
});

/** Asks for an action: refused over the daily cap; admins get a push. Nothing is executed. */
export async function requestAction(
  ctx: MutationCtx,
  input: { kind: PendingKind; payload: EmailPayload | BroadcastPayload | PostPayload; summary: string; requestedBy: Id<"users"> },
) {
  const cap = CAP_OF[input.kind];
  const now = Date.now();
  if ((await countRequested(ctx, kindsFor(cap), now - DAY_MS)) >= MCP_DAILY_CAPS[cap]) {
    fail(`${capMessage(cap)} Ask Giorgi to approve or reject the waiting ones first, or to do it himself in the Studio.`);
  }
  const summary = input.summary.slice(0, 200);
  const id = await ctx.db.insert("pendingActions", {
    kind: input.kind,
    payload: input.payload,
    summary,
    requestedBy: input.requestedBy,
    createdAt: now,
    status: "pending",
  });
  await pushAdmins(ctx, {
    title: "Claude is waiting for your approval",
    body: summary.slice(0, 140),
    url: studioUrl("/queue"),
    tag: "pending-actions",
  });
  return { pendingActionId: id, status: "pending" as const, summary, message: WAITING_MESSAGE };
}

/** What a post looks like now, to show and to compare at approval. */
export function snapshotOf(post: Doc<"socialPosts">): PostSnapshot {
  const captions: Record<string, string> = {};
  for (const [network, text] of Object.entries(post.captions ?? {})) {
    if (typeof text === "string" && text.trim()) captions[network] = text;
  }
  return {
    captions,
    media: postMedia(post).map((m) => ({ kind: m.kind, url: m.url, ...(m.networks?.length ? { networks: [...m.networks] } : {}) })),
    placement: post.placement ?? "feed",
    scheduledFor: post.scheduledFor ?? null,
    networks: captionedNetworks(post),
  };
}

function sameSnapshot(a: PostSnapshot, b: PostSnapshot) {
  const key = (s: PostSnapshot) => JSON.stringify([s.captions, s.media, s.placement, s.scheduledFor]);
  return key(a) === key(b);
}

function postTitle(post: Doc<"socialPosts">) {
  const facts = (post.facts ?? {}) as { title?: unknown };
  return typeof facts.title === "string" && facts.title ? facts.title : (post.kind ?? "post");
}

/** Asks to publish (approve_post, publish_post) or retry (retry_post) a post, after the same checks the Studio's buttons make. */
export async function requestPostAction(
  ctx: MutationCtx,
  input: { postId: Id<"socialPosts">; mode: PostPayload["mode"]; at?: number; requestedBy: Id<"users"> },
) {
  const post =
    input.mode === "approve"
      ? await checkApprovable(ctx, input.postId)
      : input.mode === "publish"
        ? await checkPublishable(ctx, input.postId)
        : await checkRetryable(ctx, input.postId);
  const snapshot = snapshotOf(post);
  const title = postTitle(post);
  const later = input.mode === "publish" && input.at && input.at > Date.now() ? ` at ${new Date(input.at).toISOString()}` : "";
  const verb = input.mode === "retry" ? "Retry" : "Publish";
  return await requestAction(ctx, {
    kind: input.mode === "retry" ? "retry_post" : "publish_post",
    payload: { postId: input.postId, mode: input.mode, ...(input.at !== undefined ? { at: input.at } : {}), title, snapshot },
    summary: `${verb} "${title}" to ${snapshot.networks.join(", ") || "no network"}${later}`,
    requestedBy: input.requestedBy,
  });
}

/** For actions (send_email, send_broadcast), which can't write themselves. */
export const request = internalMutation({
  args: { kind: pendingActionKind, payload: v.any(), summary: v.string(), requestedBy: v.id("users") },
  returns: requestView,
  handler: async (ctx, args) => await requestAction(ctx, args),
});

// ─────────────────────────────────────────────────────────────────────────────
// The admin's side (Clerk session): list, approve, reject
// ─────────────────────────────────────────────────────────────────────────────

const actionView = v.object({
  id: v.id("pendingActions"),
  kind: pendingActionKind,
  status: pendingActionStatus,
  summary: v.string(),
  payload: v.any(),
  requestedBy: v.string(),
  createdAt: v.number(),
  expiresAt: v.number(),
  decidedBy: v.union(v.string(), v.null()),
  decidedAt: v.union(v.number(), v.null()),
  result: v.any(),
  // Posts: the post changed (or is gone) since Claude asked, so approving is refused.
  changed: v.boolean(),
});

async function viewOf(ctx: QueryCtx, row: Doc<"pendingActions">, now: number) {
  const expiresAt = row.createdAt + PENDING_ACTION_TTL_MS;
  const requester = await ctx.db.get(row.requestedBy);
  const decider = row.decidedBy ? await ctx.db.get(row.decidedBy) : null;
  let changed = false;
  if (row.status === "pending" && (row.kind === "publish_post" || row.kind === "retry_post")) {
    const payload = row.payload as PostPayload;
    const post = await ctx.db.get(payload.postId);
    changed = !post || !sameSnapshot(snapshotOf(post), payload.snapshot);
  }
  return {
    id: row._id,
    kind: row.kind,
    // Expiry is written when someone acts on it; a list shows it at once.
    status: row.status === "pending" && now > expiresAt ? ("expired" as const) : row.status,
    summary: row.summary,
    payload: row.payload,
    requestedBy: requester?.name ?? "Unknown",
    createdAt: row.createdAt,
    expiresAt,
    decidedBy: decider?.name ?? null,
    decidedAt: row.decidedAt ?? null,
    result: row.result ?? null,
    changed,
  };
}

/** Waiting requests (oldest first), or the latest decided ones. */
export const list = query({
  args: { status: v.optional(v.union(v.literal("pending"), v.literal("decided"))) },
  returns: v.array(actionView),
  handler: async (ctx, { status }) => {
    await requireAdmin(ctx);
    const now = Date.now();
    if ((status ?? "pending") === "pending") {
      const rows = await ctx.db
        .query("pendingActions")
        .withIndex("by_status", (q) => q.eq("status", "pending"))
        .take(100);
      const views = await Promise.all(rows.map((r) => viewOf(ctx, r, now)));
      return views.filter((r) => r.status === "pending");
    }
    const rows = await ctx.db.query("pendingActions").order("desc").take(100);
    return await Promise.all(rows.filter((r) => r.status !== "pending").slice(0, 30).map((r) => viewOf(ctx, r, now)));
  },
});

export const pendingCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const now = Date.now();
    const rows = await ctx.db
      .query("pendingActions")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(200);
    return rows.filter((r) => now <= r.createdAt + PENDING_ACTION_TTL_MS).length;
  },
});

const decision = v.object({ status: pendingActionStatus, executed: v.boolean(), message: v.string() });

/**
 * An admin approves a request: it is executed once. Approving one that was
 * already approved, rejected or expired does nothing (a second tap, two
 * devices). Refused over the daily cap and when the post changed since Claude
 * asked (it would publish something the admin didn't see).
 */
export const approve = mutation({
  args: { id: v.id("pendingActions") },
  returns: decision,
  handler: async (ctx, { id }) => {
    const admin = await requireAdmin(ctx);
    const row = await ctx.db.get(id);
    if (!row) fail("This request is gone.");
    if (row.status !== "pending") return { status: row.status, executed: false, message: `Already ${row.status}.` };
    const now = Date.now();
    if (now > row.createdAt + PENDING_ACTION_TTL_MS) {
      await ctx.db.patch(id, { status: "expired", decidedAt: now });
      return { status: "expired" as const, executed: false, message: "This request expired: ask Claude again if it is still wanted." };
    }
    const cap = CAP_OF[row.kind];
    if ((await countExecuted(ctx, kindsFor(cap), now - DAY_MS)) >= MCP_DAILY_CAPS[cap]) {
      fail(`${capMessage(cap)} Approve it tomorrow, or send it yourself.`);
    }
    let result: unknown;
    switch (row.kind) {
      case "publish_post":
      case "retry_post": {
        const payload = row.payload as PostPayload;
        const post = await ctx.db.get(payload.postId);
        if (!post) fail("The post is gone.");
        if (!sameSnapshot(snapshotOf(post), payload.snapshot)) {
          fail("The post changed after Claude asked to publish it. Reject this request and look at the post again.");
        }
        if (payload.mode === "retry") await retryPost(ctx, payload.postId);
        else if (payload.mode === "publish") await publishPost(ctx, payload.postId, admin._id, payload.at);
        else await approvePost(ctx, payload.postId, admin._id);
        result = { postId: payload.postId };
        break;
      }
      case "send_broadcast": {
        const payload = row.payload as BroadcastPayload;
        const broadcastId = `b${now.toString(36)}`;
        await ctx.scheduler.runAfter(0, internal.emails.broadcast, {
          audience: payload.audience,
          subject: payload.subject,
          body: payload.body,
          broadcastId,
        });
        result = { broadcastId };
        break;
      }
      case "send_email": {
        await ctx.scheduler.runAfter(0, internal.pendingActions.deliverEmail, { id });
        result = { status: "sending" };
        break;
      }
    }
    await ctx.db.patch(id, { status: "approved", decidedBy: admin._id, decidedAt: now, result });
    return { status: "approved" as const, executed: true, message: "Approved." };
  },
});

export const reject = mutation({
  args: { id: v.id("pendingActions") },
  returns: decision,
  handler: async (ctx, { id }) => {
    const admin = await requireAdmin(ctx);
    const row = await ctx.db.get(id);
    if (!row) fail("This request is gone.");
    if (row.status !== "pending") return { status: row.status, executed: false, message: `Already ${row.status}.` };
    await ctx.db.patch(id, { status: "rejected", decidedBy: admin._id, decidedAt: Date.now() });
    return { status: "rejected" as const, executed: false, message: "Rejected. Nothing was sent." };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Executing an approved email (actions can send; mutations can't)
// ─────────────────────────────────────────────────────────────────────────────

export const approvedEmail = internalQuery({
  args: { id: v.id("pendingActions") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    return row && row.kind === "send_email" && row.status === "approved" ? (row.payload as EmailPayload) : null;
  },
});

export const recordResult = internalMutation({
  args: { id: v.id("pendingActions"), result: v.any() },
  returns: v.null(),
  handler: async (ctx, { id, result }) => {
    await ctx.db.patch(id, { result });
    return null;
  },
});

/** Scheduled once by `approve`: sends the email exactly as it was shown. */
export const deliverEmail = internalAction({
  args: { id: v.id("pendingActions") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const payload: EmailPayload | null = await ctx.runQuery(internal.pendingActions.approvedEmail, { id });
    if (!payload) return null;
    const delivery = await deliver(ctx, payload.to, { subject: payload.subject, text: payload.text }, payload.meta);
    await ctx.runMutation(internal.pendingActions.recordResult, { id, result: delivery });
    return null;
  },
});
