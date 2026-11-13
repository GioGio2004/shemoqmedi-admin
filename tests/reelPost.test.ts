// Reels in posts (lib/studio/reelPost.ts) and where the Studio shows them:
// the post sheet's Edit reel / Make a reel / New reel and the renders it
// offers to swap in or add, the queue card's reel chip and Home's "Ready to
// render" tile. Contract: docs/reel-editor.md section 6.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Id } from "../convex/_generated/dataModel";
import type { DraftSummary } from "../convex/reels";
import { validateRecipe, type ReelRecipe } from "../lib/reel/recipe";
import {
  draftHref,
  draftMadeFromVideo,
  draftLine,
  firstReelIndex,
  isReelItem,
  nearestAspect,
  newReelHref,
  readyDrafts,
  recipeFromVideo,
  reelAction,
  reelChipText,
  reelDurationText,
  reelEditorHref,
  reelOffers,
  reelPick,
  reelTitleFor,
  type PostItem,
} from "../lib/studio/reelPost";
import { appendItems, itemNotes, itemTitle, removeNote, replaceItem, type MediaDetail, type MediaItem } from "../components/studio/queue/mediaEdit";
import { formatText, type Post } from "../components/studio/queue/view";

const R2 = "https://pub-test.r2.dev/social";
const POST = "post1" as Id<"socialPosts">;
const DRAFT = "draft1" as Id<"reelDrafts">;

const recipe = (): ReelRecipe => ({
  version: 1,
  reel: { aspect: "9:16", fps: 30 },
  clips: [],
  audio: { voice: null, music: null, clipGain: 1 },
  fades: { videoInSec: 0, videoOutSec: 0, audioInSec: 0, audioOutSec: 0.5 },
});
const reelDesign = (draftId?: Id<"reelDrafts">): NonNullable<MediaDetail["design"]> => ({ kind: "reel", recipe: recipe(), ...(draftId ? { draftId } : {}), title: "Kencho reel" });
const video = (url: string, extra: Partial<MediaItem> = {}): MediaItem => ({ kind: "video", url, ...extra });
const detail = (m: MediaItem, extra: Partial<MediaDetail> = {}): MediaDetail => ({ url: m.url, mediaId: null, kind: m.kind, width: 1080, height: 1920, durationSec: 24, design: null, ...extra });
const draft = (extra: Partial<DraftSummary> = {}): DraftSummary => ({
  id: DRAFT,
  title: "Kencho reel",
  status: "rendered",
  createdBy: "studio",
  note: null,
  postId: null,
  listingIds: [],
  aspect: "9:16",
  clipCount: 3,
  durationSec: 24.4,
  cover: null,
  renderedUrl: `${R2}/kencho/kencho-reel-new.mp4`,
  mediaId: null,
  renderedAt: 1,
  createdAt: 1,
  updatedAt: 2,
  ...extra,
});

describe("which post videos are reels", () => {
  it("knows a reel by its recipe, its role or its file", () => {
    const plain = video(`${R2}/clip.mp4`);
    expect(isReelItem(plain)).toBe(false);
    expect(isReelItem(plain, detail(plain, { design: reelDesign() }))).toBe(true);
    expect(isReelItem(video(`${R2}/a.mp4`, { role: "reel" }))).toBe(true);
    expect(isReelItem(video(`${R2}/a.mp4`, { role: "voiceover" }))).toBe(true);
    expect(isReelItem(video(`${R2}/kencho/kencho-reel-abc123.mp4`))).toBe(true);
    expect(isReelItem({ kind: "image", url: "https://ik.imagekit.io/a/x.jpg", role: "reel" })).toBe(false);
    expect(firstReelIndex([{ kind: "image", url: "https://ik.imagekit.io/a/x.jpg" }, video(`${R2}/a.mp4`, { role: "reel" })])).toBe(1);
    expect(firstReelIndex([video(`${R2}/a.mp4`)])).toBe(-1);
  });

  it("offers Edit reel for a recipe, Make a reel for any other video, nothing for an image", () => {
    const m = video(`${R2}/kencho/kencho-reel-1.mp4`, { role: "reel" });
    expect(reelAction(m, detail(m, { design: reelDesign(DRAFT) }))).toEqual({ type: "edit", label: "Edit reel" });
    expect(reelAction(m, detail(m))).toEqual({ type: "make", label: "Make a reel" });
    expect(reelAction(video("http://insecure/a.mp4"), undefined)).toBeNull();
    expect(reelAction({ kind: "image", url: "https://ik.imagekit.io/a/x.jpg" }, undefined)).toBeNull();
  });

  it("the post sheet and the queue call reels Reel", () => {
    const m = video(`${R2}/kencho/kencho-reel-1.mp4`, { role: "reel" });
    expect(itemTitle(m, detail(m, { design: reelDesign(DRAFT) }))).toBe("Reel");
    expect(itemTitle(video(`${R2}/a.mp4`, { role: "voiceover" }), undefined)).toBe("Reel");
    expect(itemTitle(video(`${R2}/v.mp4`), undefined)).toBe("Video");
    expect(itemNotes(m, detail(m, { design: reelDesign(DRAFT) }), { instagram: true, story: false })).toEqual(["1080x1920", "24 s", "Recipe saved"]);
    expect(removeNote(m, detail(m, { design: reelDesign(DRAFT) }), false)).toBe("It leaves this post. Its draft stays in Reels.");
    const card = (media: PostItem[]) => ({ placement: "feed", media }) as unknown as Post;
    expect(formatText(card([m]))).toBe("Reel");
    expect(formatText(card([video(`${R2}/v.mp4`)]))).toBe("Video");
  });
});

describe("the reel editor's URLs", () => {
  it("opens a draft, from a post and item when given", () => {
    expect(reelEditorHref("d1")).toBe("/reels?draft=d1");
    expect(reelEditorHref("d1", { postId: "p1", item: 2 })).toBe("/reels?draft=d1&post=p1&item=2");
    expect(reelEditorHref("d1", { postId: "p1", item: null })).toBe("/reels?draft=d1&post=p1");
    expect(draftHref({ id: DRAFT })).toBe("/reels?draft=draft1");
  });

  it("starts a new reel, for a post when given", () => {
    expect(newReelHref()).toBe("/reels?new=1");
    expect(newReelHref("p1")).toBe("/reels?new=1&post=p1");
  });
});

describe("Make a reel from a post's video", () => {
  it("a second Make a reel on the same video of the same post reopens the draft made the first time", () => {
    const made = { postId: "p1", clipCount: 1, cover: { kind: "video" as const, url: "https://pub-test.r2.dev/a.mp4" }, id: "d1" };
    const drafts = [
      { ...made, id: "d0", postId: "p2" },
      { ...made, id: "d2", clipCount: 3 },
      made,
    ] as unknown as DraftSummary[];
    expect(draftMadeFromVideo(drafts, "p1", "https://pub-test.r2.dev/a.mp4")?.id).toBe("d1");
    expect(draftMadeFromVideo(drafts, "p1", "https://pub-test.r2.dev/b.mp4")).toBeNull();
    expect(draftMadeFromVideo(undefined, "p1", "https://pub-test.r2.dev/a.mp4")).toBeNull();
  });

  it("a listing preview: one silent listingVideo clip, shaped like the video, valid", () => {
    const m = video("https://pub-test.r2.dev/listings/kencho/preview.mp4", { role: "preview" });
    const r = recipeFromVideo(m, detail(m, { width: 1920, height: 1080, durationSec: 31, mediaId: "m1" as Id<"media"> }), { placement: "feed", listing: { slug: "kencho", title: "Kencho" } });
    expect(r.reel.aspect).toBe("16:9");
    expect(r.clips).toHaveLength(1);
    const c = r.clips[0];
    expect(c.source).toMatchObject({ kind: "listingVideo", url: m.url, mediaId: "m1", width: 1920, height: 1080, durationSec: 31, listingSlug: "kencho", label: "Kencho preview" });
    expect(c.audio.on).toBe(false);
    expect(c.outSec).toBe(15);
    expect(validateRecipe(r)).toEqual([]);
  });

  it("a quick reel keeps its own sound; a story is always 9:16; unknown sizes are left out", () => {
    const m = video(`${R2}/kencho/kencho-reel-1.mp4`, { role: "voiceover" });
    const r = recipeFromVideo(m, { width: null, height: null, durationSec: null, mediaId: null, design: null }, { placement: "story", listing: null });
    expect(r.reel.aspect).toBe("9:16");
    expect(r.clips[0].source).toEqual({ kind: "upload-video", url: m.url, label: "Reel from the post" });
    expect(r.clips[0].audio.on).toBe(true);
    expect(validateRecipe(r)).toEqual([]);
  });

  it("picks the nearest reel shape", () => {
    expect(nearestAspect(1080, 1920)).toBe("9:16");
    expect(nearestAspect(1080, 1350)).toBe("4:5");
    expect(nearestAspect(1000, 1000)).toBe("1:1");
    expect(nearestAspect(1280, 720)).toBe("16:9");
    expect(nearestAspect(null, 720)).toBe("9:16");
    expect(reelTitleFor({ listing: { title: "Kencho" } })).toBe("Kencho reel");
    expect(reelTitleFor({ listing: null })).toBeUndefined();
  });
});

describe("renders waiting to go into a post", () => {
  const old = video(`${R2}/kencho/kencho-reel-old.mp4`, { role: "reel" });
  const img: MediaItem = { kind: "image", url: "https://ik.imagekit.io/a/social/graphics/g.jpg", role: "graphic" };
  const media = [img, old];
  const details = [detail(img, { width: 1080, height: 1350 }), detail(old, { design: reelDesign(DRAFT) })];

  it("a new render of a reel in the post replaces it in place", () => {
    const offers = reelOffers(POST, media, details, [draft()]);
    expect(offers).toEqual([{ type: "replace", index: 1, draft: draft() }]);
    const pick = reelPick(draft())!;
    expect(pick).toEqual({ kind: "video", url: `${R2}/kencho/kencho-reel-new.mp4`, role: "reel", width: 1080, height: 1920, durationSec: 24.4, mediaId: null });
    const next = replaceItem([img, { ...old, networks: ["instagram"] }], 1, pick);
    expect(next[1]).toEqual({ kind: "video", url: pick.url, role: "reel", networks: ["instagram"] });
  });

  it("a reel made for this post is offered to add; others, unrendered or already-in renders are not", () => {
    const forPost = draft({ id: "d2" as Id<"reelDrafts">, postId: POST, renderedUrl: `${R2}/reels/reels-reel-x.mp4` });
    expect(reelOffers(POST, [img], [details[0]], [forPost])).toEqual([{ type: "add", draft: forPost }]);
    expect(appendItems([img], [reelPick(forPost)!])[1]).toEqual({ kind: "video", url: forPost.renderedUrl, role: "reel" });
    // Another post's reel, a draft changed since its render, one with no render, one already in the post.
    expect(reelOffers(POST, [img], [details[0]], [draft({ postId: "other" as Id<"socialPosts"> })])).toEqual([]);
    expect(reelOffers(POST, media, details, [draft({ status: "draft" })])).toEqual([]);
    expect(reelOffers(POST, media, details, [draft({ renderedUrl: null })])).toEqual([]);
    expect(reelOffers(POST, media, details, [draft({ renderedUrl: old.url })])).toEqual([]);
    expect(reelOffers(POST, media, details, undefined)).toEqual([]);
  });

  it("each item is offered at most one render", () => {
    const newer = draft({ renderedUrl: `${R2}/kencho/kencho-reel-newer.mp4` });
    expect(reelOffers(POST, media, details, [newer, draft()]).map((o) => o.type)).toEqual(["replace"]);
  });

  it("other aspects give their own size", () => {
    expect(reelPick(draft({ aspect: "4:5" }))).toMatchObject({ width: 1080, height: 1350 });
    expect(reelPick(draft({ aspect: "16:9" }))).toMatchObject({ width: 1920, height: 1080 });
  });
});

describe("labels", () => {
  it("lengths, chips and draft lines", () => {
    expect(reelDurationText(24.4)).toBe("24 s");
    expect(reelDurationText(0.3)).toBe("1 s");
    expect(reelDurationText(65)).toBe("1:05");
    expect(reelDurationText(null)).toBeNull();
    expect(reelChipText()).toBe("Reel");
    expect(reelChipText(42)).toBe("Reel · 42 s");
    expect(draftLine({ clipCount: 1, durationSec: 8, aspect: "1:1" })).toBe("1 clip · 8 s · 1:1");
    expect(draftLine({ clipCount: 4, durationSec: 0, aspect: "9:16" })).toBe("4 clips · 9:16");
    expect(readyDrafts([draft({ status: "ready" }), draft(), draft({ status: "draft" })])).toHaveLength(1);
    expect(readyDrafts(undefined)).toEqual([]);
  });
});

describe("where the Studio shows reels", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("the post sheet opens reels in the editor from this post and item, and adds new ones", () => {
    const editor = read("components/studio/queue/MediaEditor.tsx");
    expect(editor).toMatch(/openFromMedia\(\{ url: m\.url, postId: detail\.id \}\)/);
    expect(editor).toMatch(/createReel\(\{ recipe: recipeFromVideo\(m, d, detail\)/);
    expect(editor).toMatch(/router\.push\(reelEditorHref\(id, \{ postId: detail\.id, item: i \}\)\)/);
    expect(editor).toMatch(/href=\{newReelHref\(detail\.id\)\}/);
    // A render goes in through the same save as every other change (baseMedia, back to Waiting asked first).
    expect(editor).toMatch(/onReplace=\{\(index, pick\) => change\(\{ media: replaceItem\(media, index, pick\) \}/);
    expect(editor).toMatch(/onAdd=\{\(pick\) => change\(\{ media: appendItems\(media, \[pick\]\) \}/);
    expect(read("components/studio/queue/ReelOffers.tsx")).toMatch(/postId: null, baseUpdatedAt: o\.draft\.updatedAt/);
  });

  it("queue cards show a reel chip with its length", () => {
    const card = read("components/studio/queue/PostCard.tsx");
    expect(card).toMatch(/firstReelIndex\(post\.media\)/);
    expect(card).toMatch(/reelChipText\(/);
    expect(read("components/studio/queue/Carousel.tsx")).toMatch(/onVideoMeta\?\.\(i, v\.duration\)/);
  });

  it("Home lists Claude's drafts ready to render and starts a new reel", () => {
    const home = read("components/studio/home/Home.tsx");
    expect(home).toMatch(/useQuery\(api\.reels\.list, \{ status: "ready", limit: 20 \}\)/);
    expect(home).toMatch(/href=\{draftHref\(draft\)\}/);
    expect(home).toMatch(/href=\{newReelHref\(\)\}/);
  });
});
