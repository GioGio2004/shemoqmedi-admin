// The Studio's reel editor (components/studio/reels/*): reel drafts, the
// sources a reel is cut from, uploads for it, and the finished render.
// Contract: docs/reel-editor.md. Nothing here publishes.
//
//   reelDrafts   a reel's whole edit (REEL RECIPE, lib/reel/recipe.ts), made in
//                the Studio or by Claude (MCP create_reel_draft → "ready", push)
//   sources      reels.listings / listingSources (preview videos, screenshots),
//                media.recentRenders (graphics), reels.uploads (phone videos)
//   uploads      uploadUrl → browser PUT to R2 → registerUpload (videos: media
//                row; music: reelAudio) → checked on R2 afterwards
//   narration    voiceover.narrate (with word timings) / voiceover.narrations
//   render       the browser renders the MP4 (lib/reel/render.ts) →
//                renderUploadUrl → PUT → registerRender: a media row with
//                design {kind:"reel", recipe, draftId}; the draft → "rendered"
//   posts        social.update (Studio) / MCP attach_reel put the reel in a post

import { ConvexError, v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireAdmin } from "./authHelpers";
import { pushAdmins } from "./push";
import { cleanDuration, mediaRow, mediaUrl, rowUrl } from "./lib/media";
import { mediaUrls } from "./lib/listingHelpers";
import { rowByUrl } from "./lib/mediaEntry";
import { R2_SOCIAL_KEY, deleteObject, headObject, presignPut, r2Configured, r2PublicUrl } from "./lib/r2";
import { socialKey } from "./lib/voiceover";
import {
  MAX_RENDER_BYTES,
  R2_UPLOAD_KEY,
  checkUpload,
  reelDraftStatus,
  reelFolder,
  reelRecipe,
  uploadKey,
  uploadKindOf,
} from "./lib/reel";
import { fetchableVideoUrl } from "./voiceover";
import {
  LIMITS,
  ReelRecipeError,
  normalizeRecipe,
  recipeListingIds,
  recipeWarnings,
  validateRecipe,
  type ReelRecipe,
} from "../lib/reel/recipe";
import { buildTimeline, estimateWords, wordsToLines } from "../lib/reel/timeline";
import { studioReelUrl } from "../lib/hosts";

function fail(message: string): never {
  throw new ConvexError(message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Views
// ─────────────────────────────────────────────────────────────────────────────

export const draftSummary = v.object({
  id: v.id("reelDrafts"),
  title: v.string(),
  status: reelDraftStatus,
  createdBy: v.union(v.literal("studio"), v.literal("claude")),
  note: v.union(v.string(), v.null()),
  postId: v.union(v.id("socialPosts"), v.null()),
  listingIds: v.array(v.id("listings")),
  aspect: v.string(),
  clipCount: v.number(),
  durationSec: v.number(),
  /** The first clip's picture (a still's URL, or a video to show a frame of), for the list. */
  cover: v.union(v.object({ kind: v.union(v.literal("image"), v.literal("video")), url: v.string() }), v.null()),
  renderedUrl: v.union(v.string(), v.null()),
  mediaId: v.union(v.id("media"), v.null()),
  renderedAt: v.union(v.number(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
});
export type DraftSummary = typeof draftSummary.type;

export const draftView = v.object({
  ...draftSummary.fields,
  recipe: reelRecipe,
  /** What stops a render now (e.g. "Voice: the script is not voiced yet ..."); [] = ready. */
  problems: v.array(v.string()),
  /** Notes that don't stop a render. */
  warnings: v.array(v.string()),
});
export type DraftView = typeof draftView.type;

function summaryOf(d: Doc<"reelDrafts">, renderedUrl: string | null): DraftSummary {
  const first = d.recipe.clips[0];
  const video = first && (first.source.kind === "listingVideo" || first.source.kind === "upload-video");
  return {
    id: d._id,
    title: d.title,
    status: d.status,
    createdBy: d.createdBy,
    note: d.note ?? null,
    postId: d.postId ?? null,
    listingIds: d.listingIds,
    aspect: d.recipe.reel.aspect,
    clipCount: d.recipe.clips.length,
    durationSec: Math.round(buildTimeline(d.recipe).durationSec * 100) / 100,
    cover: first ? { kind: video ? "video" : "image", url: first.source.url } : null,
    renderedUrl,
    mediaId: d.mediaId ?? null,
    renderedAt: d.renderedAt ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

/** The render's current URL (R2 rows follow R2_PUBLIC_URL); the stored one when the row is gone. */
async function renderedUrlOf(ctx: QueryCtx, d: Doc<"reelDrafts">) {
  if (d.mediaId) {
    const row = await ctx.db.get(d.mediaId);
    if (row && !row.invalid) return rowUrl(row);
    if (row?.invalid) return null;
  }
  return d.renderedUrl ?? null;
}

export async function summarize(ctx: QueryCtx, d: Doc<"reelDrafts">): Promise<DraftSummary> {
  return summaryOf(d, await renderedUrlOf(ctx, d));
}

export async function viewDraft(ctx: QueryCtx, d: Doc<"reelDrafts">): Promise<DraftView> {
  const summary = await summarize(ctx, d);
  return {
    ...summary,
    recipe: d.recipe,
    problems: validateRecipe(d.recipe, { forRender: true }),
    warnings: recipeWarnings(d.recipe, summary.durationSec),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared by the Studio and the MCP tools
// ─────────────────────────────────────────────────────────────────────────────

/** Refuses a recipe that validateRecipe finds problems in (all of them, one per line). */
export function assertRecipe(recipe: ReelRecipe) {
  const errors = validateRecipe(recipe);
  if (errors.length) fail(errors.slice(0, 8).join("\n"));
}

/** The recipe's listing ids that are real listings, in order. */
async function listingIdsOf(ctx: QueryCtx, recipe: ReelRecipe): Promise<Id<"listings">[]> {
  const out: Id<"listings">[] = [];
  for (const raw of recipeListingIds(recipe)) {
    const id = ctx.db.normalizeId("listings", raw);
    if (id && !out.includes(id) && (await ctx.db.get(id))) out.push(id);
  }
  return out;
}

function cleanTitle(title: string | undefined) {
  const t = title?.replace(/\s+/g, " ").trim().slice(0, LIMITS.titleChars);
  return t || undefined;
}

async function defaultTitle(ctx: QueryCtx, listingIds: Id<"listings">[]) {
  const first = listingIds[0] ? await ctx.db.get(listingIds[0]) : null;
  if (!first) return "New reel";
  return listingIds.length > 1 ? `${first.title} and ${listingIds.length - 1} more` : `${first.title} reel`;
}

function cleanNote(note: string | undefined) {
  const n = note?.trim().slice(0, 500);
  return n || undefined;
}

export async function insertDraft(
  ctx: MutationCtx,
  input: {
    recipe: ReelRecipe;
    title?: string;
    note?: string;
    postId?: Id<"socialPosts">;
    createdBy: "studio" | "claude";
    userId?: Id<"users">;
  },
): Promise<Id<"reelDrafts">> {
  assertRecipe(input.recipe);
  if (input.postId && !(await ctx.db.get(input.postId))) fail("Post not found.");
  const listingIds = await listingIdsOf(ctx, input.recipe);
  const now = Date.now();
  const id = await ctx.db.insert("reelDrafts", {
    title: cleanTitle(input.title) ?? (await defaultTitle(ctx, listingIds)),
    recipe: input.recipe,
    listingIds,
    status: input.createdBy === "claude" ? "ready" : "draft",
    createdBy: input.createdBy,
    userId: input.userId,
    note: cleanNote(input.note),
    postId: input.postId,
    createdAt: now,
    updatedAt: now,
  });
  if (input.createdBy === "claude") await pushReady(ctx, id);
  return id;
}

/** A recipe as text with its keys sorted (two recipes are the same reel when these match). */
function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(",")}]`;
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(x) ?? "null";
}

/** True when two recipes make the same reel (deep, key order ignored). */
export function sameRecipe(a: ReelRecipe, b: ReelRecipe) {
  return canonical(a) === canonical(b);
}

/**
 * Saves changes to a draft. A recipe that differs from the draft's puts a
 * rendered draft back to draft (its last render stays); `by: "claude"` makes
 * it "ready" (pushed when it wasn't ready already). The same recipe sent
 * again (a rename, a note) changes no status. `baseUpdatedAt`: refuse if the
 * draft changed since the caller read it.
 */
export async function patchDraft(
  ctx: MutationCtx,
  id: Id<"reelDrafts">,
  edit: { recipe?: ReelRecipe; title?: string; note?: string; postId?: Id<"socialPosts"> | null; baseUpdatedAt?: number },
  by: "studio" | "claude",
) {
  const draft = await ctx.db.get(id);
  if (!draft) fail("Reel draft not found.");
  if (edit.baseUpdatedAt !== undefined && edit.baseUpdatedAt !== draft.updatedAt) {
    fail("This reel changed since you opened it (another device or Claude). Open it again and redo the change.");
  }
  const patch: Partial<Doc<"reelDrafts">> = { updatedAt: Math.max(Date.now(), draft.updatedAt + 1) };
  const recipeChanged = !!edit.recipe && !sameRecipe(edit.recipe, draft.recipe);
  if (edit.recipe) assertRecipe(edit.recipe);
  if (edit.recipe && recipeChanged) {
    patch.recipe = edit.recipe;
    patch.listingIds = await listingIdsOf(ctx, edit.recipe);
    patch.status = by === "claude" ? "ready" : "draft";
  }
  if (edit.title !== undefined) patch.title = cleanTitle(edit.title) ?? draft.title;
  if (edit.note !== undefined) patch.note = cleanNote(edit.note);
  if (edit.postId !== undefined) {
    if (edit.postId && !(await ctx.db.get(edit.postId))) fail("Post not found.");
    patch.postId = edit.postId ?? undefined;
  }
  await ctx.db.patch(id, patch);
  if (by === "claude" && recipeChanged && draft.status !== "ready") await pushReady(ctx, id);
}

async function pushReady(ctx: MutationCtx, id: Id<"reelDrafts">) {
  const d = await ctx.db.get(id);
  if (!d) return;
  const seconds = Math.round(buildTimeline(d.recipe).durationSec);
  const clips = d.recipe.clips.length;
  await pushAdmins(ctx, {
    title: "Reel draft ready to render",
    body: `${d.title}: ${clips} ${clips === 1 ? "clip" : "clips"}, ${seconds} s. Open it to check and render.`,
    url: studioReelUrl(id),
    tag: `reel-${id}`,
  });
}

/** Source details from our media row for a URL (size, length, id), when the source lacks them. */
async function withRowDetails(ctx: QueryCtx, source: Record<string, unknown>) {
  if (typeof source.url !== "string") return source;
  const row = await rowByUrl(ctx, source.url);
  if (!row) return source;
  return {
    ...source,
    mediaId: source.mediaId ?? row._id,
    width: source.width ?? row.width,
    height: source.height ?? row.height,
    durationSec: source.durationSec ?? row.durationSec,
  };
}

const looseObj = (x: unknown): Record<string, unknown> | null =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;

/**
 * Fills a loose recipe from Claude before normalizeRecipe: a clip may name
 * its listing by slug and leave out the URL (listingVideo: the preview video;
 * screenshot: screenshot number `shot`, 0 = cover), sizes and lengths come
 * from our media rows, and a voice may name only its narrationId (URL,
 * length, script and captions filled in from the stored narration).
 */
export async function resolveLooseRecipe(ctx: QueryCtx, input: unknown): Promise<ReelRecipe> {
  const raw = looseObj(input);
  if (!raw) fail("The recipe must be an object.");
  const clips = Array.isArray(raw.clips) ? raw.clips : null;
  const resolved: unknown[] = [];
  for (const [i, c] of (clips ?? []).entries()) {
    const clip = looseObj(c);
    const source = looseObj(clip?.source);
    if (!clip || !source) {
      resolved.push(c);
      continue;
    }
    let next: Record<string, unknown> = { ...source };
    const slug = typeof source.listingSlug === "string" ? source.listingSlug.trim().toLowerCase() : null;
    const listing = slug
      ? await ctx.db
          .query("listings")
          .withIndex("by_slug", (q) => q.eq("slug", slug))
          .first()
      : typeof source.listingId === "string" && ctx.db.normalizeId("listings", source.listingId)
        ? await ctx.db.get(ctx.db.normalizeId("listings", source.listingId)!)
        : null;
    if (slug && !listing) fail(`Clip ${i + 1}: no listing with the slug "${slug}". Use search_listings.`);
    if (listing) {
      next = { ...next, listingId: listing._id, listingSlug: listing.slug, label: next.label ?? listing.title };
      if (!next.url && source.kind === "listingVideo") {
        const url = await fetchableVideoUrl(ctx, listing);
        if (!url) fail(`Clip ${i + 1}: "${listing.title}" has no preview video.`);
        const row = listing.videoId ? await mediaRow(ctx, listing.videoId) : null;
        next = { ...next, url, mediaId: row?._id, width: row?.width, height: row?.height, durationSec: row?.durationSec };
      }
      if (!next.url && source.kind === "screenshot") {
        const { coverUrl, galleryUrls } = await mediaUrls(ctx, listing);
        const shots = [coverUrl, ...galleryUrls].filter((u): u is string => !!u);
        const n = typeof source.shot === "number" ? Math.floor(source.shot) : 0;
        if (!shots[n]) fail(`Clip ${i + 1}: "${listing.title}" has ${shots.length} screenshots (shot 0-${Math.max(0, shots.length - 1)}).`);
        next = { ...next, url: shots[n] };
      }
    }
    delete next.shot;
    resolved.push({ ...clip, source: await withRowDetails(ctx, next) });
  }

  const audio = looseObj(raw.audio);
  let voice = looseObj(audio?.voice);
  if (voice && typeof voice.narrationId === "string") {
    const id = ctx.db.normalizeId("reelAudio", voice.narrationId);
    const row = id ? await ctx.db.get(id) : null;
    if (!row || row.kind !== "voice" || row.invalid) fail("Voice: no narration with that narrationId.");
    voice = {
      ...voice,
      url: voice.url ?? r2PublicUrl(row.key) ?? undefined,
      durationSec: voice.durationSec ?? row.durationSec,
      script: voice.script ?? row.script,
      voice: voice.voice ?? row.voice,
    };
    const captions = looseObj(voice.captions);
    const lines = Array.isArray(captions?.lines) ? captions.lines : [];
    if (!lines.length && captions?.on !== false) {
      const words = row.words?.length ? row.words : estimateWords(row.script ?? "", row.durationSec ?? 0);
      voice = { ...voice, captions: { ...(captions ?? {}), lines: wordsToLines(words) } };
    }
  }

  try {
    return normalizeRecipe({ ...raw, clips: clips ? resolved : raw.clips, audio: audio ? { ...audio, voice } : raw.audio });
  } catch (err) {
    if (err instanceof ReelRecipeError) fail(err.message);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Drafts (Studio)
// ─────────────────────────────────────────────────────────────────────────────

/** Reel drafts, last changed first (optionally one status). Limit 1-100 (default 50). */
export const list = query({
  args: { status: v.optional(reelDraftStatus), limit: v.optional(v.number()) },
  returns: v.array(draftSummary),
  handler: async (ctx, { status, limit }) => {
    await requireAdmin(ctx);
    const n = Math.min(Math.max(Math.floor(limit ?? 50), 1), 100);
    const rows = status
      ? await ctx.db.query("reelDrafts").withIndex("by_status", (q) => q.eq("status", status)).order("desc").take(n)
      : await ctx.db.query("reelDrafts").withIndex("by_updated").order("desc").take(n);
    return await Promise.all(rows.map((d) => summarize(ctx, d)));
  },
});

/** One draft with its recipe, what stops a render (problems) and notes (warnings); null when deleted. */
export const get = query({
  args: { id: v.id("reelDrafts") },
  returns: v.union(draftView, v.null()),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const d = await ctx.db.get(id);
    return d ? await viewDraft(ctx, d) : null;
  },
});

export const create = mutation({
  args: {
    recipe: reelRecipe,
    title: v.optional(v.string()),
    note: v.optional(v.string()),
    postId: v.optional(v.id("socialPosts")),
  },
  returns: draftView,
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx);
    const id = await insertDraft(ctx, { ...args, createdBy: "studio", userId: user._id });
    return await viewDraft(ctx, (await ctx.db.get(id))!);
  },
});

/**
 * Saves the editor's changes. Send only what changed; `baseUpdatedAt` = the
 * draft's updatedAt when it was loaded (an edit over a newer version is
 * refused). A changed recipe makes the draft "draft" again (needs a render).
 */
export const update = mutation({
  args: {
    id: v.id("reelDrafts"),
    recipe: v.optional(reelRecipe),
    title: v.optional(v.string()),
    note: v.optional(v.string()),
    postId: v.optional(v.union(v.id("socialPosts"), v.null())),
    baseUpdatedAt: v.optional(v.number()),
  },
  returns: draftView,
  handler: async (ctx, { id, ...edit }) => {
    await requireAdmin(ctx);
    await patchDraft(ctx, id, edit, "studio");
    return await viewDraft(ctx, (await ctx.db.get(id))!);
  },
});

/** A copy to try something else (status draft, no render). */
export const duplicate = mutation({
  args: { id: v.id("reelDrafts") },
  returns: draftView,
  handler: async (ctx, { id }) => {
    const user = await requireAdmin(ctx);
    const d = await ctx.db.get(id);
    if (!d) fail("Reel draft not found.");
    const copy = await insertDraft(ctx, {
      recipe: d.recipe,
      title: `${d.title.slice(0, LIMITS.titleChars - 7)} (copy)`,
      note: d.note,
      postId: d.postId,
      createdBy: "studio",
      userId: user._id,
    });
    return await viewDraft(ctx, (await ctx.db.get(copy))!);
  },
});

/** Deletes a draft. Its rendered reel (media row, file) and any post using it stay. */
export const remove = mutation({
  args: { id: v.id("reelDrafts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    if (await ctx.db.get(id)) await ctx.db.delete(id);
    return null;
  },
});

/**
 * "Edit reel" on a post's video: the draft behind a rendered reel (its
 * design.draftId, when that draft still exists), else a new draft from the
 * reel's recipe. Null when the URL is not a reel with a recipe.
 */
export const openFromMedia = mutation({
  args: { url: v.string(), postId: v.optional(v.id("socialPosts")) },
  returns: v.union(v.id("reelDrafts"), v.null()),
  handler: async (ctx, { url, postId }) => {
    const user = await requireAdmin(ctx);
    const row = await rowByUrl(ctx, url);
    const design = row?.design;
    if (!row || design?.kind !== "reel") return null;
    if (postId && !(await ctx.db.get(postId))) fail("Post not found.");
    if (design.draftId && (await ctx.db.get(design.draftId))) {
      if (postId) await ctx.db.patch(design.draftId, { postId });
      return design.draftId;
    }
    const id = await insertDraft(ctx, {
      recipe: design.recipe,
      title: design.title,
      postId,
      createdBy: "studio",
      userId: user._id,
    });
    // Rendered already: this draft is that render until it is edited.
    await ctx.db.patch(id, { status: "rendered", mediaId: row._id, renderedUrl: rowUrl(row), renderedAt: row.createdAt });
    // The reel now points at this draft: the next "Edit reel" opens it instead of making another.
    await ctx.db.patch(row._id, { design: { ...design, draftId: id } });
    return id;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Sources
// ─────────────────────────────────────────────────────────────────────────────

const listingPick = v.object({
  id: v.id("listings"),
  slug: v.string(),
  title: v.string(),
  creditName: v.string(),
  status: v.string(),
  coverUrl: v.union(v.string(), v.null()),
  hasVideo: v.boolean(),
});

/** Listings to cut a reel from, newest first, optionally matching text (title, studio, slug). Limit 1-200 (default 60). */
export const listings = query({
  args: { text: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.array(listingPick),
  handler: async (ctx, { text, limit }) => {
    await requireAdmin(ctx);
    const n = Math.min(Math.max(Math.floor(limit ?? 60), 1), 200);
    const needle = text?.trim().toLowerCase();
    const out = [];
    for (const l of await ctx.db.query("listings").order("desc").take(1000)) {
      if (l.status === "rejected") continue;
      if (needle && ![l.title, l.creditName, l.slug].some((f) => f.toLowerCase().includes(needle))) continue;
      out.push({
        id: l._id,
        slug: l.slug,
        title: l.title,
        creditName: l.creditName,
        status: l.status,
        coverUrl: await mediaUrl(ctx, l.coverId),
        hasVideo: !!l.videoId,
      });
      if (out.length >= n) break;
    }
    return out;
  },
});

const sourceFile = v.object({
  url: v.string(),
  mediaId: v.union(v.id("media"), v.null()),
  width: v.union(v.number(), v.null()),
  height: v.union(v.number(), v.null()),
  durationSec: v.union(v.number(), v.null()),
});

async function fileOf(ctx: QueryCtx, url: string, id: Id<"media"> | Id<"_storage"> | undefined) {
  const row = id ? await mediaRow(ctx, id) : await rowByUrl(ctx, url);
  return {
    url,
    mediaId: row?._id ?? null,
    width: row?.width ?? null,
    height: row?.height ?? null,
    durationSec: row?.durationSec ?? null,
  };
}

/** One listing's clip sources: its preview video (a URL the browser can fetch) and screenshots (cover first). */
export const listingSources = query({
  args: { listingId: v.id("listings") },
  returns: v.union(
    v.null(),
    v.object({
      id: v.id("listings"),
      slug: v.string(),
      title: v.string(),
      creditName: v.string(),
      video: v.union(sourceFile, v.null()),
      screenshots: v.array(sourceFile),
    }),
  ),
  handler: async (ctx, { listingId }) => {
    await requireAdmin(ctx);
    const l = await ctx.db.get(listingId);
    if (!l) return null;
    const videoUrl = await fetchableVideoUrl(ctx, l);
    const ids = [l.coverId, ...(l.galleryIds ?? [])];
    const screenshots = [];
    for (const id of ids) {
      const url = await mediaUrl(ctx, id);
      if (url) screenshots.push(await fileOf(ctx, url, id));
    }
    return {
      id: l._id,
      slug: l.slug,
      title: l.title,
      creditName: l.creditName,
      video: videoUrl && l.videoId ? await fileOf(ctx, videoUrl, l.videoId) : null,
      screenshots,
    };
  },
});

/** Videos uploaded from a device for reels, newest first. Limit 1-100 (default 30). */
export const uploads = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      id: v.id("media"),
      url: v.string(),
      contentType: v.string(),
      size: v.number(),
      width: v.union(v.number(), v.null()),
      height: v.union(v.number(), v.null()),
      durationSec: v.union(v.number(), v.null()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, { limit }) => {
    await requireAdmin(ctx);
    const n = Math.min(Math.max(Math.floor(limit ?? 30), 1), 100);
    const rows = await ctx.db.query("media").order("desc").take(2000);
    return rows
      .filter((r) => !r.invalid && r.store === "r2" && uploadKindOf(r.fileId) === "clip")
      .slice(0, n)
      .map((r) => ({
        id: r._id,
        url: rowUrl(r),
        contentType: r.contentType,
        size: r.size,
        width: r.width ?? null,
        height: r.height ?? null,
        durationSec: r.durationSec ?? null,
        createdAt: r.createdAt,
      }));
  },
});

/** Uploaded music tracks, newest first. Limit 1-100 (default 30). */
export const music = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      id: v.id("reelAudio"),
      url: v.string(),
      title: v.union(v.string(), v.null()),
      durationSec: v.union(v.number(), v.null()),
      size: v.number(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, { limit }) => {
    await requireAdmin(ctx);
    const n = Math.min(Math.max(Math.floor(limit ?? 30), 1), 100);
    const rows = await ctx.db
      .query("reelAudio")
      .withIndex("by_kind", (q) => q.eq("kind", "music"))
      .order("desc")
      .take(300);
    const out = [];
    for (const r of rows) {
      const url = r2PublicUrl(r.key);
      if (r.invalid || !url) continue;
      out.push({ id: r._id, url, title: r.title ?? null, durationSec: r.durationSec ?? null, size: r.size, createdAt: r.createdAt });
      if (out.length >= n) break;
    }
    return out;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Uploads from the device (browser → R2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A presigned PUT (15 minutes) for a video clip (MP4 / MOV / WebM, up to
 * 200 MB) or a music track (MP3 / M4A, up to 20 MB). Files go to
 * social/<listing slug or "reels">/. PUT with the same content-type header,
 * then registerUpload.
 */
export const uploadUrl = action({
  args: { contentType: v.string(), size: v.number(), listingId: v.optional(v.id("listings")) },
  returns: v.object({ uploadUrl: v.string(), key: v.string(), url: v.string(), kind: v.union(v.literal("clip"), v.literal("music")) }),
  handler: async (ctx, { contentType, size, listingId }): Promise<{ uploadUrl: string; key: string; url: string; kind: "clip" | "music" }> => {
    await ctx.runQuery(internal.users.assertAdmin, {});
    if (!r2Configured()) throw new ConvexError("R2 is not configured on this Convex deployment.");
    const { kind, ext } = checkUpload(contentType, size);
    const slug: string | null = listingId ? await ctx.runQuery(internal.voiceover.listingSlug, { listingId }) : null;
    const key = uploadKey(reelFolder(slug), kind, ext);
    return { uploadUrl: await presignPut(key), key, url: r2PublicUrl(key)!, kind };
  },
});

/**
 * Records a finished upload: a video becomes a media row (source kind
 * "upload-video"), music a reelAudio row. Both are checked on R2 afterwards
 * (a missing or wrong file is flagged and deleted). Same answer when called
 * twice for one key.
 */
export const registerUpload = mutation({
  args: {
    key: v.string(),
    contentType: v.string(),
    size: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationSec: v.optional(v.number()),
    title: v.optional(v.string()),
  },
  returns: v.object({
    kind: v.union(v.literal("clip"), v.literal("music")),
    url: v.string(),
    mediaId: v.union(v.id("media"), v.null()),
    audioId: v.union(v.id("reelAudio"), v.null()),
  }),
  handler: async (ctx, { key, contentType, size, width, height, durationSec, title }) => {
    const user = await requireAdmin(ctx);
    const keyKind = uploadKindOf(key);
    if (!keyKind) fail("That upload did not come from the reel editor. Upload it again.");
    const { kind, ext } = checkUpload(contentType, size);
    if (kind !== keyKind || !key.endsWith(`.${ext}`)) fail("The file type does not match the upload. Upload it again.");
    const url = r2PublicUrl(key);
    if (!url) fail("R2 is not configured on this Convex deployment.");
    const type = contentType.split(";")[0].trim().toLowerCase();
    const okSize = (n: number | undefined) => (n !== undefined && Number.isFinite(n) && n > 0 && n <= 10000 ? Math.round(n) : undefined);

    if (kind === "clip") {
      const existing = await ctx.db.query("media").withIndex("by_fileId", (q) => q.eq("fileId", key)).first();
      if (existing) return { kind, url, mediaId: existing._id, audioId: null };
      const mediaId = await ctx.db.insert("media", {
        store: "r2",
        fileId: key,
        url,
        filePath: `/${key}`,
        kind: "video",
        contentType: type,
        size,
        width: okSize(width),
        height: okSize(height),
        durationSec: cleanDuration(durationSec),
        uploadedBy: user._id,
        createdAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.reels.verifyUpload, { key, mediaId });
      return { kind, url, mediaId, audioId: null };
    }

    const existing = await ctx.db.query("reelAudio").withIndex("by_key", (q) => q.eq("key", key)).first();
    if (existing) return { kind, url, mediaId: null, audioId: existing._id };
    const audioId = await ctx.db.insert("reelAudio", {
      kind: "music",
      key,
      contentType: type,
      size,
      durationSec: cleanDuration(durationSec),
      title: title?.replace(/\s+/g, " ").trim().slice(0, LIMITS.labelChars) || undefined,
      userId: user._id,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.reels.verifyUpload, { key, audioId });
    return { kind, url, mediaId: null, audioId };
  },
});

/** Double-checks an upload on R2: it exists, its type and size are allowed. Otherwise flagged invalid and deleted. */
export const verifyUpload = internalAction({
  args: { key: v.string(), mediaId: v.optional(v.id("media")), audioId: v.optional(v.id("reelAudio")) },
  returns: v.null(),
  handler: async (ctx, { key, mediaId, audioId }) => {
    const file = await headObject(key); // throws (and retries) on R2 errors
    let ok = !!file;
    if (file) {
      try {
        ok = checkUpload(file.contentType, file.size).kind === uploadKindOf(key);
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      if (mediaId) await ctx.runMutation(internal.media.markInvalid, { id: mediaId });
      if (audioId) await ctx.runMutation(internal.reels.markAudioInvalid, { id: audioId });
      if (file) await deleteObject(key);
    }
    return null;
  },
});

export const markAudioInvalid = internalMutation({
  args: { id: v.id("reelAudio") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    if (await ctx.db.get(id)) await ctx.db.patch(id, { invalid: true });
    return null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// The rendered reel
// ─────────────────────────────────────────────────────────────────────────────

/** The folder of a draft's files: its first listing's slug, or "reels". */
export const draftFolder = internalQuery({
  args: { draftId: v.optional(v.id("reelDrafts")), listingId: v.optional(v.id("listings")) },
  returns: v.string(),
  handler: async (ctx, { draftId, listingId }) => {
    const d = draftId ? await ctx.db.get(draftId) : null;
    const id = listingId ?? d?.listingIds[0];
    const l = id ? await ctx.db.get(id) : null;
    return reelFolder(l?.slug);
  },
});

/** A presigned PUT (15 minutes) for the rendered MP4 (up to 100 MB): social/<folder>/<folder>-reel-<id>.mp4. */
export const renderUploadUrl = action({
  args: { size: v.number(), draftId: v.optional(v.id("reelDrafts")), listingId: v.optional(v.id("listings")) },
  returns: v.object({ uploadUrl: v.string(), key: v.string() }),
  handler: async (ctx, { size, draftId, listingId }): Promise<{ uploadUrl: string; key: string }> => {
    await ctx.runQuery(internal.users.assertAdmin, {});
    if (!r2Configured()) throw new ConvexError("R2 is not configured on this Convex deployment.");
    if (!(size > 0) || size > MAX_RENDER_BYTES) throw new ConvexError("The reel must be an MP4 of 100 MB or less.");
    const folder: string = await ctx.runQuery(internal.reels.draftFolder, { draftId, listingId });
    const key = socialKey(folder, "reel", "mp4");
    return { uploadUrl: await presignPut(key), key };
  },
});

/**
 * Records the uploaded render: a media row (role reel) whose design is
 * {kind:"reel", recipe, draftId, title}, so it can be edited again. With a
 * draftId the draft becomes "rendered" (renderedUrl, mediaId) when the
 * rendered recipe is still the draft's (a rename or note meanwhile doesn't
 * matter; a recipe edited meanwhile keeps its status). `draftUpdatedAt` is
 * accepted for older clients and not needed.
 */
export const registerRender = mutation({
  args: {
    key: v.string(),
    size: v.number(),
    width: v.number(),
    height: v.number(),
    durationSec: v.number(),
    recipe: reelRecipe,
    draftId: v.optional(v.id("reelDrafts")),
    draftUpdatedAt: v.optional(v.number()),
  },
  returns: v.object({ mediaId: v.id("media"), url: v.string() }),
  handler: async (ctx, { key, size, width, height, durationSec, recipe, draftId }) => {
    const user = await requireAdmin(ctx);
    if (!R2_SOCIAL_KEY.test(key) || !/-reel-[a-f0-9]{10}\.mp4$/.test(key) || R2_UPLOAD_KEY.test(key)) {
      fail("That is not a reel upload.");
    }
    if (!(size > 0) || size > MAX_RENDER_BYTES) fail("The reel must be an MP4 of 100 MB or less.");
    const problems = validateRecipe(recipe, { forRender: true });
    if (problems.length) fail(problems.slice(0, 8).join("\n"));
    const url = r2PublicUrl(key);
    if (!url) fail("R2 is not configured on this Convex deployment.");
    const draft = draftId ? await ctx.db.get(draftId) : null;
    if (draftId && !draft) fail("Reel draft not found.");

    let mediaId: Id<"media">;
    const existing = await ctx.db.query("media").withIndex("by_fileId", (q) => q.eq("fileId", key)).first();
    if (existing) mediaId = existing._id;
    else {
      mediaId = await ctx.db.insert("media", {
        store: "r2",
        fileId: key,
        url,
        filePath: `/${key}`,
        kind: "video",
        contentType: "video/mp4",
        size,
        width: Math.round(width) || undefined,
        height: Math.round(height) || undefined,
        durationSec: cleanDuration(durationSec),
        design: { kind: "reel", recipe, draftId: draftId ?? undefined, title: draft?.title },
        uploadedBy: user._id,
        createdAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.voiceover.verifyReel, { id: mediaId, key });
    }
    if (draft && sameRecipe(recipe, draft.recipe)) {
      await ctx.db.patch(draft._id, { status: "rendered", renderedUrl: url, mediaId, renderedAt: Date.now() });
    } else if (draft) {
      // Edited while it rendered: keep the newer edit's status, still remember this render.
      await ctx.db.patch(draft._id, { renderedUrl: url, mediaId, renderedAt: Date.now() });
    }
    return { mediaId, url };
  },
});
