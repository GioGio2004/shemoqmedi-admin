// Reels in posts, as pure functions (tests/reelPost.test.ts): which post
// videos are reels, what the post sheet offers for each ("Edit reel" for a
// reel with a recipe, "Make a reel" for any other video), the reel editor's
// URLs (docs/reel-editor.md section 6), a one-clip recipe from a post's
// video, the renders waiting to go into a post, and short labels for cards.

import type { DraftSummary } from "@/convex/reels";
import type { DesignView, MediaDetail } from "@/convex/lib/design";
import { ASPECTS, LIMITS, defaultClip, defaultRecipe, type ClipSource, type ReelAspect, type ReelRecipe } from "@/lib/reel/recipe";
import type { Captions } from "./captions";
import { draftCaptions, storyCaption } from "./drafts";

/** A post item as the queue and the post sheet have it. */
export type PostItem = { kind: "image" | "video"; url: string; role?: string; networks?: readonly string[] };
type Detail = Pick<MediaDetail, "width" | "height" | "durationSec" | "mediaId" | "design"> | undefined;
export type ReelDesignView = Extract<DesignView, { kind: "reel" }>;

/** Item roles that mean "a reel": the editor's renders and the quick voiceover reel. */
export const REEL_ROLES: readonly string[] = ["reel", "voiceover"];
/** A rendered reel's file on R2 (convex/lib/mediaEntry.ts roleOf "reel"). */
const REEL_FILE = /\/social\/[a-z0-9-]+\/[a-z0-9_-]*-reel-[a-z0-9_-]+\.mp4(?:[?#].*)?$/i;

/** The reel recipe behind an item, or null (a quick reel, a preview, a graphic). */
export function reelDesignOf(d: Detail): ReelDesignView | null {
  const design = d?.design;
  return design && design.kind === "reel" ? design : null;
}

/** Whether a post item is a reel (a video with a reel recipe, a reel role or a reel file). */
export function isReelItem(m: PostItem, d?: Detail) {
  if (m.kind !== "video") return false;
  return !!reelDesignOf(d) || (!!m.role && REEL_ROLES.includes(m.role)) || REEL_FILE.test(m.url);
}

/** The first reel in a post's media, or -1. */
export function firstReelIndex(media: readonly PostItem[], details: readonly Detail[] = []) {
  return media.findIndex((m, i) => isReelItem(m, details[i]));
}

export type ReelAction = { type: "edit"; label: "Edit reel" } | { type: "make"; label: "Make a reel" };

/**
 * What the post sheet offers for an item: "Edit reel" opens the recipe in
 * the reel editor; "Make a reel" starts a new reel from any other video
 * (a quick reel, a listing preview, an upload). Images: nothing (they have Edit design).
 */
export function reelAction(m: PostItem, d: Detail): ReelAction | null {
  if (m.kind !== "video") return null;
  if (reelDesignOf(d)) return { type: "edit", label: "Edit reel" };
  if (!/^https:\/\//.test(m.url)) return null;
  return { type: "make", label: "Make a reel" };
}

// ── URLs (docs/reel-editor.md section 6) ─────────────────────────────────

/** The editor with a draft; from a post (`postId`, `item` = the item it replaces) when given. */
export function reelEditorHref(draftId: string, from?: { postId: string; item?: number | null } | null) {
  const q = new URLSearchParams({ draft: draftId });
  if (from?.postId) {
    q.set("post", from.postId);
    if (from.item !== undefined && from.item !== null && from.item >= 0) q.set("item", String(from.item));
  }
  return `/reels?${q}`;
}

/** The editor with a new, empty reel; for a post when given (its result is added to that post). */
export function newReelHref(postId?: string | null) {
  const q = new URLSearchParams({ new: "1" });
  if (postId) q.set("post", postId);
  return `/reels?${q}`;
}

/** Where a Home tile sends a draft: the editor with it. */
export const draftHref = (d: Pick<DraftSummary, "id">) => reelEditorHref(d.id);

// ── A reel from a post's video ───────────────────────────────────────────

/** The reel shape closest to a video's own (9:16 when unknown). */
export function nearestAspect(width: number | null | undefined, height: number | null | undefined): ReelAspect {
  if (!width || !height || width <= 0 || height <= 0) return "9:16";
  const r = width / height;
  let best: ReelAspect = "9:16";
  let gap = Infinity;
  for (const [id, a] of Object.entries(ASPECTS) as [ReelAspect, (typeof ASPECTS)[ReelAspect]][]) {
    const d = Math.abs(Math.log(r / (a.width / a.height)));
    if (d < gap) {
      gap = d;
      best = id;
    }
  }
  return best;
}

/** Whether a post video came from a listing (its preview recording). */
function isListingVideo(m: PostItem) {
  return m.role === "preview" || /\/listings\//.test(m.url);
}

/**
 * A new reel with this one video as its only clip: a listing preview is a
 * `listingVideo` (silent), anything else an `upload-video` (its own sound on:
 * a quick reel keeps its narration). The shape follows the video (a story
 * is always 9:16); every option stays Giorgi's to change in the editor.
 */
export function recipeFromVideo(m: PostItem, d: Detail, post: { placement?: "feed" | "story"; listing?: { slug: string; title: string } | null }): ReelRecipe {
  const listing = isListingVideo(m);
  const source: ClipSource = { kind: listing ? "listingVideo" : "upload-video", url: m.url };
  if (d?.mediaId) source.mediaId = d.mediaId;
  if (d?.width && d.width > 0) source.width = d.width;
  if (d?.height && d.height > 0) source.height = d.height;
  if (d?.durationSec && d.durationSec > 0) source.durationSec = d.durationSec;
  if (listing && post.listing) {
    source.listingSlug = post.listing.slug;
    source.label = `${post.listing.title} preview`.slice(0, LIMITS.labelChars);
  } else if (m.role && REEL_ROLES.includes(m.role)) {
    source.label = "Reel from the post";
  }
  const aspect = post.placement === "story" ? "9:16" : nearestAspect(d?.width, d?.height);
  const recipe = defaultRecipe(aspect);
  recipe.clips = [defaultClip(source, aspect)];
  return recipe;
}

/**
 * "Make a reel" again on the same video of the same post: the draft already
 * made from it (one clip, that video), so a second tap doesn't make another.
 */
export function draftMadeFromVideo<T extends Pick<DraftSummary, "postId" | "clipCount" | "cover">>(
  drafts: readonly T[] | undefined,
  postId: string,
  url: string,
): T | null {
  return (drafts ?? []).find((d) => d.postId === postId && d.clipCount === 1 && d.cover?.kind === "video" && d.cover.url === url) ?? null;
}

/** A new reel's title for a post ("Paper Weather reel"); undefined lets the server choose. */
export function reelTitleFor(post: { listing?: { title: string } | null }) {
  const t = post.listing?.title?.trim();
  return t ? `${t} reel`.slice(0, LIMITS.titleChars) : undefined;
}

// ── Renders waiting to go into a post ────────────────────────────────────

/** A draft's render as a post item (with what the sheet needs to show it before the server answers). */
export type ReelPick = {
  kind: "video";
  url: string;
  role: "reel";
  width: number;
  height: number;
  durationSec: number;
  mediaId: DraftSummary["mediaId"];
};

/** The draft's last render as an item for the post; null when it has none. */
export function reelPick(d: Pick<DraftSummary, "renderedUrl" | "aspect" | "durationSec" | "mediaId">): ReelPick | null {
  if (!d.renderedUrl) return null;
  const a = ASPECTS[d.aspect as ReelAspect] ?? ASPECTS["9:16"];
  return { kind: "video", url: d.renderedUrl, role: "reel", width: a.width, height: a.height, durationSec: d.durationSec, mediaId: d.mediaId };
}

/**
 * Renders that aren't in the post yet:
 * - `replace`: a reel in the post was edited and rendered again (its recipe
 *   names the draft): offer to swap the new render in at `index`;
 * - `add`: a reel made for this post (draft.postId) whose render isn't in it.
 * Only drafts whose render matches their recipe (status "rendered").
 */
export type ReelOffer = { type: "replace"; index: number; draft: DraftSummary } | { type: "add"; draft: DraftSummary };

export function reelOffers(postId: string, media: readonly PostItem[], details: readonly Detail[], drafts: readonly DraftSummary[] | undefined): ReelOffer[] {
  if (!drafts?.length) return [];
  const inPost = new Set(media.map((m) => m.url));
  const out: ReelOffer[] = [];
  const replaced = new Set<number>();
  for (const draft of drafts) {
    if (draft.status !== "rendered" || !draft.renderedUrl || inPost.has(draft.renderedUrl)) continue;
    const index = media.findIndex((m, i) => !replaced.has(i) && m.kind === "video" && reelDesignOf(details[i])?.draftId === draft.id);
    if (index >= 0) {
      replaced.add(index);
      out.push({ type: "replace", index, draft });
    } else if (draft.postId === postId) {
      out.push({ type: "add", draft });
    }
  }
  return out;
}

// ── Labels ────────────────────────────────────────────────────────────────

/** "24 s", "1:05". */
export function reelDurationText(sec: number | null | undefined) {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return null;
  const s = Math.round(sec);
  if (s < 60) return `${Math.max(1, s)} s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The chip on a card: "Reel", "Reel · 24 s". */
export function reelChipText(sec?: number | null) {
  const d = reelDurationText(sec);
  return d ? `Reel · ${d}` : "Reel";
}

/** A draft's line: "4 clips · 24 s · 9:16". */
export function draftLine(d: Pick<DraftSummary, "clipCount" | "durationSec" | "aspect">) {
  const parts = [`${d.clipCount} ${d.clipCount === 1 ? "clip" : "clips"}`];
  const len = reelDurationText(d.durationSec);
  if (len) parts.push(len);
  parts.push(d.aspect);
  return parts.join(" · ");
}

/** Drafts Claude made or changed, waiting for Giorgi to check and render (newest first, as listed). */
export function readyDrafts<T extends Pick<DraftSummary, "status">>(drafts: readonly T[] | undefined): T[] {
  return (drafts ?? []).filter((d) => d.status === "ready");
}

// ── The /reels route (docs/reel-editor.md section 6) ──────────────────────

/** What /reels opens: the editor with a draft (or a new reel), maybe from a post; null = the Reels tab. */
export type ReelTarget = {
  draftId: string | null;
  /** Opened from a post: its render replaces item `item` (null: is added to the post). */
  post: { id: string; item: number | null } | null;
};

type Param = string | string[] | undefined;
const firstParam = (v: Param) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
/** A Convex id as it appears in a link (anything else is ignored, never sent to the server). */
const LINK_ID = /^[a-z0-9]{10,64}$/i;

/**
 * Reads `?draft=<id>[&post=<id>[&item=<i>]]` and `?new=1[&post=<id>[&item=<i>]]`.
 * A malformed draft id with no `new=1` is no editor link (the Reels tab shows);
 * a malformed post id or item is dropped (the editor then isn't tied to a post).
 */
export function parseReelTarget(params: { draft?: Param; post?: Param; item?: Param; new?: Param }): ReelTarget | null {
  const raw = firstParam(params.draft);
  const draftId = raw && LINK_ID.test(raw) ? raw : null;
  if (!draftId && firstParam(params.new) !== "1") return null;
  const postRaw = firstParam(params.post);
  const postId = postRaw && LINK_ID.test(postRaw) ? postRaw : null;
  const itemRaw = firstParam(params.item);
  const item = itemRaw && /^\d{1,2}$/.test(itemRaw) ? Number(itemRaw) : null;
  return { draftId, post: postId ? { id: postId, item } : null };
}

/** The same, from the address bar's search params (the Studio route reads them on the client). */
export function reelTargetFrom(search: Pick<URLSearchParams, "get">): ReelTarget | null {
  const get = (k: string) => search.get(k) ?? undefined;
  return parseReelTarget({ draft: get("draft"), post: get("post"), item: get("item"), new: get("new") });
}

/**
 * The editor's key in the route: a different post (or item) remounts it. A
 * different draft doesn't need to (ReelEditor keys its loader by draft and
 * keeps itself when the URL names the draft it just created).
 */
export function reelTargetKey(t: ReelTarget) {
  return t.post ? `${t.post.id}|${t.post.item ?? "add"}` : "reels";
}

/** Where the editor's Back goes: the post it was opened from, else the Reels tab. */
export function reelCloseHref(t: Pick<ReelTarget, "post">) {
  return t.post ? `/queue?post=${encodeURIComponent(t.post.id)}` : "/reels";
}

/** The status chip of a draft in the Reels tab. */
export function draftStatusText(d: Pick<DraftSummary, "status">) {
  return d.status === "ready" ? "Ready to render" : d.status === "rendered" ? "Rendered" : "Draft";
}

/** Drafts with a render, newest render first (the Reels tab's "Recent reels"). */
export function recentRenders<T extends Pick<DraftSummary, "renderedUrl" | "renderedAt">>(drafts: readonly T[] | undefined, limit = 6): T[] {
  return (drafts ?? [])
    .filter((d) => !!d.renderedUrl)
    .slice()
    .sort((a, b) => (b.renderedAt ?? 0) - (a.renderedAt ?? 0))
    .slice(0, limit);
}

/** A listing a reel was cut from, as the captions need it. */
export type ReelListing = { title: string; creditName: string; slug: string };

/**
 * First-draft captions for a new post made from a reel. One listing: the
 * listing drafts ("New on Shemoqmedi: X by Y"). Several: one post naming them
 * all. None: a plain post titled after the reel. A story only needs a label.
 * Always something, so the post never starts with every network skipped.
 */
export function reelCaptions(listings: readonly ReelListing[], placement: "feed" | "story", reelTitle: string, siteUrl: (slug: string) => string): Captions {
  const names = listings.map((l) => (l.creditName ? `${l.title} by ${l.creditName}` : l.title));
  const label = (listings.length === 1 ? listings[0].title : reelTitle.trim()) || "Reel";
  if (placement === "story") return { instagram: storyCaption({ title: label }), facebook: storyCaption({ title: label }) };
  if (listings.length === 1) {
    const l = listings[0];
    return draftCaptions("listing", { title: l.title, studio: l.creditName, pageUrl: siteUrl(l.slug) });
  }
  if (listings.length > 1) {
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
    return draftCaptions("announcement", {
      headline: `New on Shemoqmedi: ${list}`,
      body: "Each one reviewed by hand and scored by an independent jury.",
      cta: "shemoqmedi.space",
    });
  }
  return draftCaptions("free", { headline: label === "Reel" ? "" : label });
}
