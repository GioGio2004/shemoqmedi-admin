// The post sheet's media editor, as pure functions (tests/postSheetMedia.test.ts):
// the new media list for a replace / move / remove / add (social.update takes
// the whole list), a carousel recipe's set, the Feed / Story switch rules, the
// labels each item shows, the optimistic copy of social.get, the Create
// edit-mode links and the checks for an image picked from the device.
// Contract: docs/post-editing.md. Same rules as the server (convex/social.ts
// editPost, convex/lib/socialApi.ts storyProblem / instagramImageUrl).

import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { NETWORK_LABEL, type Network } from "@/lib/studio/captions";

export type PostDetailData = FunctionReturnType<typeof api.social.get>;
export type MediaItem = PostDetailData["media"][number];
export type MediaDetail = PostDetailData["mediaDetails"][number];
export type Design = NonNullable<MediaDetail["design"]>;

/** At most this many images or videos per post (server: editPost). */
export const MEDIA_MAX = 10;
/** Instagram feed images: 4:5 to 1.91:1 (server: IG_MIN_RATIO / IG_MAX_RATIO). */
export const IG_MIN_RATIO = 0.8;
export const IG_MAX_RATIO = 1.91;
/** A story is 9:16, give or take 0.02 (server: STORY_RATIO, STORY_RATIO_TOLERANCE). */
export const STORY_RATIO = 9 / 16;
const STORY_TOLERANCE = 0.02;
/** A story video runs 3 to 60 seconds. */
export const STORY_VIDEO_MIN = 3;
export const STORY_VIDEO_MAX = 60;

/** Only what social.update takes for an item (a view may carry more). */
export function cleanItem(m: MediaItem): MediaItem {
  return { kind: m.kind, url: m.url, ...(m.role ? { role: m.role } : {}), ...(m.networks?.length ? { networks: [...m.networks] } : {}) };
}

/** Item `from` moved to `to` (clamped); the same list when it doesn't move. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  const t = Math.max(0, Math.min(out.length - 1, to));
  if (from < 0 || from >= out.length || from === t) return out;
  const [it] = out.splice(from, 1);
  out.splice(t, 0, it);
  return out;
}

export function removeItem<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

/** What a picked file brings: a URL, its kind and what it is (role). */
export type Picked = { kind: "image" | "video"; url: string; role: string; width?: number | null; height?: number | null; durationSec?: number | null; design?: Design | null; mediaId?: MediaDetail["mediaId"] };

/**
 * Item `index` replaced by `next`: the new URL, kind and role, the old item's
 * networks kept (a "hook" item keeps its role: it is the Threads copy).
 */
export function replaceItem(list: readonly MediaItem[], index: number, next: Picked): MediaItem[] {
  return list.map((m, i) => {
    if (i !== index) return cleanItem(m);
    const role = m.role === "hook" ? "hook" : next.role || m.role;
    return cleanItem({ kind: next.kind, url: next.url, role, networks: m.networks });
  });
}

/** `items` added at the end (at most MEDIA_MAX in all: the rest are left out). */
export function appendItems(list: readonly MediaItem[], items: readonly Picked[]): MediaItem[] {
  const room = Math.max(0, MEDIA_MAX - list.length);
  return [...list.map(cleanItem), ...items.slice(0, room).map((p) => cleanItem({ kind: p.kind, url: p.url, role: p.role }))];
}

/** The indexes of the carousel set item `index` belongs to (just [index] for anything else). */
export function carouselSet(details: readonly (MediaDetail | undefined)[], index: number): number[] {
  const d = details[index]?.design;
  if (!d || d.kind !== "carousel") return [index];
  const out: number[] = [];
  details.forEach((x, i) => {
    if (x?.design?.kind === "carousel" && x.design.setId === d.setId) out.push(i);
  });
  return out;
}

const ratioOf = (w: number | null | undefined, h: number | null | undefined) => (w && h ? w / h : null);

export function isStoryShape(w: number | null | undefined, h: number | null | undefined) {
  const r = ratioOf(w, h);
  return r !== null && Math.abs(r - STORY_RATIO) <= STORY_TOLERANCE;
}

/** Whether Instagram pads this image with white at publish (ImageKit images outside 4:5 to 1.91:1). */
export function paddedOnInstagram(d: Pick<MediaDetail, "url" | "kind" | "width" | "height"> | undefined) {
  if (!d || d.kind === "video" || !/^https:\/\/ik\.imagekit\.io\//.test(d.url)) return false;
  const r = ratioOf(d.width, d.height);
  return r !== null && (r < IG_MIN_RATIO || r > IG_MAX_RATIO);
}

/**
 * What switching a post to a story does, worked out before asking the
 * server (which checks again):
 * - `ok`: send `placement: "story"` with `media` (the post's one item, or none);
 * - `pick`: exactly one 9:16 item among several: keep only it (ask first);
 * - `no`: a reason to show instead.
 */
export type StorySwitch = { type: "ok"; media: MediaItem[] } | { type: "pick"; index: number; media: MediaItem[]; drops: number } | { type: "no"; reason: string };

export function storySwitch(media: readonly MediaItem[], details: readonly (MediaDetail | undefined)[]): StorySwitch {
  if (media.length === 0) return { type: "ok", media: [] };
  const problemOf = (i: number) => {
    const d = details[i];
    if (d?.width && d.height && !isStoryShape(d.width, d.height)) return `A story must be 9:16, and this ${media[i].kind} is ${d.width}x${d.height}. Make a story design first.`;
    if (media[i].kind === "video" && d?.durationSec && (d.durationSec < STORY_VIDEO_MIN || d.durationSec > STORY_VIDEO_MAX)) {
      return `A story video runs 3 to 60 seconds, and this one runs ${Math.round(d.durationSec)} s.`;
    }
    return null;
  };
  if (media.length === 1) {
    const p = problemOf(0);
    return p ? { type: "no", reason: p } : { type: "ok", media: [cleanItem(media[0])] };
  }
  const fits = media.map((_, i) => i).filter((i) => isStoryShape(details[i]?.width, details[i]?.height) && !problemOf(i));
  if (fits.length === 1) return { type: "pick", index: fits[0], media: [cleanItem(media[fits[0]])], drops: media.length - 1 };
  if (fits.length > 1) return { type: "no", reason: `A story is one image or video, and this post has ${fits.length} that fit 9:16. Remove the others first.` };
  return { type: "no", reason: `A story is one 9:16 image or video, and none of these ${media.length} is 9:16. Make a story design first.` };
}

/** Why a story can't take one more item, or null. */
export function addProblem(count: number, story: boolean) {
  if (story && count >= 1) return "A story is exactly one image or video. Replace it instead.";
  if (count >= MEDIA_MAX) return `At most ${MEDIA_MAX} images or videos per post.`;
  return null;
}

/** Why an item can't replace a story's one item, or null (unknown sizes pass: the server checks). */
export function storyItemProblem(p: Pick<Picked, "kind" | "width" | "height" | "durationSec">) {
  if (p.width && p.height && !isStoryShape(p.width, p.height)) return `A story must be 9:16, and this is ${p.width}x${p.height}.`;
  if (p.kind === "video" && p.durationSec && (p.durationSec < STORY_VIDEO_MIN || p.durationSec > STORY_VIDEO_MAX)) return "A story video runs 3 to 60 seconds.";
  return null;
}

const ROLE_WORD: Record<string, string> = {
  graphic: "Graphic",
  carousel: "Carousel slide",
  screenshot: "Screenshot",
  upload: "Upload",
  hook: "Hook",
  preview: "Video",
  voiceover: "Reel",
};

/** "Graphic", "Slide 2 of 6", "Screenshot", "Video". */
export function itemTitle(m: MediaItem, d: MediaDetail | undefined) {
  const design = d?.design;
  if (design?.kind === "carousel") return `Slide ${design.slideIndex + 1} of ${design.total}`;
  if (design?.kind === "graphic") return "Graphic";
  if (m.kind === "video") return "Video";
  if (m.role && ROLE_WORD[m.role]) return ROLE_WORD[m.role];
  if (/\/listings\//.test(m.url)) return "Screenshot";
  return "Image";
}

/** "Only on Threads", "Only on Instagram and Facebook", or null for every network. */
export function networksText(networks: readonly Network[] | undefined) {
  if (!networks?.length) return null;
  const names = networks.map((n) => NETWORK_LABEL[n] ?? n);
  const list = names.length < 2 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `Only on ${list}`;
}

/** The small line under an item: its size, whether a design is saved, and what Instagram does with it. */
export function itemNotes(m: MediaItem, d: MediaDetail | undefined, opts: { instagram: boolean; story: boolean }) {
  const out: string[] = [];
  if (d?.width && d.height) out.push(`${d.width}x${d.height}`);
  if (m.kind === "video" && d?.durationSec) out.push(`${Math.round(d.durationSec)} s`);
  if (m.kind === "image") out.push(d?.design ? "Design saved" : "No design saved");
  const nets = networksText(m.networks as Network[] | undefined);
  if (nets) out.push(nets);
  if (!opts.story && opts.instagram && paddedOnInstagram(d)) out.push("Padded with white on Instagram");
  return out;
}

/**
 * Keys for the list that follow each item, not its place (a move keeps the
 * row, and focus can find it): the URL plus how many times it came before
 * (the Threads copy of a carousel's hook repeats slide 1's URL).
 */
export function itemKeys(media: readonly MediaItem[]) {
  const seen = new Map<string, number>();
  return media.map((m) => {
    const n = seen.get(m.url) ?? 0;
    seen.set(m.url, n + 1);
    return `${n}:${m.url}`;
  });
}

/** What Remove says about getting the item back: only renders are in Recent renders. */
export function removeNote(m: MediaItem, d: MediaDetail | undefined, hasListing: boolean) {
  const what = m.kind === "video" ? "video" : "image";
  if (m.kind === "image" && (d?.design || m.role === "graphic" || m.role === "carousel")) return "It leaves this post. It stays in Recent renders.";
  if (hasListing && (m.role === "screenshot" || m.role === "preview" || /\/listings\//.test(m.url))) return `It leaves this post. You can add it back from Listing while the listing still has this ${what}.`;
  return `It leaves this post. You can't add this ${what} back here.`;
}

/** Whether "Edit design" can open this item in Create ("Redesign" without a recipe; never for a video). */
export function editLabel(m: MediaItem, d: MediaDetail | undefined) {
  if (m.kind === "video") return null;
  return d?.design ? "Edit design" : "Redesign";
}

/** Create in edit mode for item `index` (docs/post-editing.md section 5). */
export function editHref(postId: string, index: number) {
  return `/create?${new URLSearchParams({ post: postId, item: String(index) })}`;
}

/** Create in add mode: a new graphic appended to the post. */
export function addHref(postId: string) {
  return `/create?${new URLSearchParams({ post: postId, mode: "add" })}`;
}

/**
 * The details for a new media list: kept items keep theirs (looked up by
 * URL), picked ones bring what is known, anything else is unknown (null).
 */
export function detailsFor(media: readonly MediaItem[], known: readonly MediaDetail[], picked: readonly Picked[] = []): MediaDetail[] {
  const byUrl = new Map<string, MediaDetail>();
  for (const d of known) byUrl.set(d.url, d);
  for (const p of picked) {
    if (!byUrl.has(p.url)) {
      byUrl.set(p.url, { url: p.url, mediaId: p.mediaId ?? null, kind: p.kind, width: p.width ?? null, height: p.height ?? null, durationSec: p.durationSec ?? null, design: p.design ?? null });
    }
  }
  return media.map((m) => byUrl.get(m.url) ?? { url: m.url, mediaId: null, kind: m.kind, width: null, height: null, durationSec: null, design: null });
}

/**
 * The sheet's post as it will be after an edit, shown while the server saves
 * it: the new media and placement, and back to waiting when the edit resets it.
 */
export function optimisticDetail(post: PostDetailData, edit: { media?: MediaItem[]; placement?: "feed" | "story" }, picked: readonly Picked[] = []): PostDetailData {
  const media = edit.media ?? post.media;
  const resets = post.status === "approved" || post.status === "scheduled" || post.status === "failed";
  return {
    ...post,
    media,
    mediaDetails: edit.media ? detailsFor(media, post.mediaDetails, picked) : post.mediaDetails,
    placement: edit.placement ?? post.placement,
    ...(resets ? { status: "waiting" as const, error: null, approvedAt: null } : {}),
  };
}

// ── An image from the device ─────────────────────────────────────────────

/** ImageKit's social folder takes JPEG or PNG of at most 5 MB and 4096 px a side (media.registerSocial). */
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const UPLOAD_MAX_SIDE = 4096;
/** Largest file read before converting. */
export const UPLOAD_INPUT_MAX = 40 * 1024 * 1024;

/** Why a picked file can't be used at all, or null. */
export function pickedFileProblem(file: { type: string; size: number }) {
  if (!file.type.startsWith("image/")) return "Pick an image (JPEG, PNG, WebP or HEIC).";
  if (file.type === "image/gif" || file.type === "image/svg+xml") return "Pick a photo or a still image (JPEG, PNG, WebP or HEIC).";
  if (file.size > UPLOAD_INPUT_MAX) return "That image is over 40 MB. Pick a smaller one.";
  if (file.size <= 0) return "That file is empty.";
  return null;
}

/** The size to upload at: at most 4096 px a side, the shape kept. */
export function fitSide(width: number, height: number, max = UPLOAD_MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scaled: scale < 1 };
}

/** Whether the file goes up as it is (a JPEG or PNG small enough), else it is redrawn as a JPEG. */
export function uploadAsIs(file: { type: string; size: number }, width: number, height: number) {
  return (file.type === "image/jpeg" || file.type === "image/png") && file.size <= UPLOAD_MAX_BYTES && Math.max(width, height) <= UPLOAD_MAX_SIDE;
}
