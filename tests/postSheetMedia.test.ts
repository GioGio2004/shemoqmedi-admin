// The post sheet's media editor (components/studio/queue/mediaEdit.ts): the
// media lists it sends to social.update (replace / move / remove / add), the
// carousel set of a recipe, the Feed / Story switch, the labels, the
// optimistic copy of the post, the Create links and the upload checks.
// Contract: docs/post-editing.md.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IG_MAX_RATIO as SERVER_IG_MAX, IG_MIN_RATIO as SERVER_IG_MIN, STORY_RATIO as SERVER_STORY } from "../convex/lib/socialApi";
import { LIMITS } from "../convex/lib/taxonomy";
import {
  IG_MAX_RATIO,
  IG_MIN_RATIO,
  STORY_RATIO,
  UPLOAD_MAX_BYTES,
  addHref,
  addProblem,
  appendItems,
  carouselSet,
  detailsFor,
  editHref,
  editLabel,
  fitSide,
  itemKeys,
  itemNotes,
  itemTitle,
  moveItem,
  optimisticDetail,
  paddedOnInstagram,
  pickedFileProblem,
  removeItem,
  removeNote,
  replaceItem,
  storyItemProblem,
  storySwitch,
  uploadAsIs,
  type Design,
  type MediaDetail,
  type MediaItem,
  type PostDetailData,
} from "../components/studio/queue/mediaEdit";

const IK = "https://ik.imagekit.io/acct/social/graphics";
const img = (name: string, extra: Partial<MediaItem> = {}): MediaItem => ({ kind: "image", url: `${IK}/${name}.jpg`, role: "graphic", ...extra });
const detail = (m: MediaItem, extra: Partial<MediaDetail> = {}): MediaDetail => ({ url: m.url, mediaId: null, kind: m.kind, width: 1080, height: 1350, durationSec: null, design: null, ...extra });
const slide = (setId: string, slideIndex: number, total: number): Design => ({
  kind: "carousel",
  palette: "auto",
  style: "glass",
  facts: {},
  story: {},
  slideIndex,
  slideName: "site",
  total,
  setId,
  listingSlug: null,
});
const graphic: Design = { kind: "graphic", template: "award", format: "ig_portrait", style: "glass", palette: "auto", fields: {}, imageUrls: [] };

function post(media: MediaItem[], extra: Partial<PostDetailData> = {}): PostDetailData {
  return {
    id: "p1" as PostDetailData["id"],
    kind: "award",
    status: "waiting",
    listing: null,
    facts: null,
    captions: { instagram: "Hello" },
    media,
    placement: "feed",
    scheduledFor: null,
    note: null,
    error: null,
    results: [],
    publishing: false,
    publishingUntil: null,
    createdAt: 1,
    approvedAt: null,
    sentAt: null,
    mediaDetails: media.map((m) => detail(m)),
    instagramProblem: null,
    ...extra,
  };
}

describe("rules match the server", () => {
  it("uses the server's Instagram ratios, story ratio and upload limit", () => {
    expect(IG_MIN_RATIO).toBe(SERVER_IG_MIN);
    expect(IG_MAX_RATIO).toBe(SERVER_IG_MAX);
    expect(STORY_RATIO).toBe(SERVER_STORY);
    expect(UPLOAD_MAX_BYTES).toBe(LIMITS.imageBytes);
  });
});

describe("media lists for social.update", () => {
  const a = img("a");
  const b = img("b", { networks: ["threads"] });
  const c = img("c", { role: "screenshot" });

  it("moves an item and clamps the target", () => {
    expect(moveItem([a, b, c], 0, 2).map((m) => m.url)).toEqual([b.url, c.url, a.url]);
    expect(moveItem([a, b, c], 2, 0).map((m) => m.url)).toEqual([c.url, a.url, b.url]);
    expect(moveItem([a, b, c], 1, 9).map((m) => m.url)).toEqual([a.url, c.url, b.url]);
    expect(moveItem([a, b, c], 1, 1)).toEqual([a, b, c]);
  });

  it("removes one item", () => {
    expect(removeItem([a, b, c], 1)).toEqual([a, c]);
  });

  it("replaces an item in place, keeping its networks and taking the new role and kind", () => {
    const out = replaceItem([a, b, c], 1, { kind: "image", url: `${IK}/new.jpg`, role: "upload" });
    expect(out[1]).toEqual({ kind: "image", url: `${IK}/new.jpg`, role: "upload", networks: ["threads"] });
    expect(out[0]).toEqual(a);
    const video = replaceItem([a], 0, { kind: "video", url: "https://r2.example/v.mp4", role: "preview" });
    expect(video[0]).toEqual({ kind: "video", url: "https://r2.example/v.mp4", role: "preview" });
  });

  it("keeps the hook role of a Threads hook copy", () => {
    const hook = img("h", { role: "hook", networks: ["threads"] });
    expect(replaceItem([hook], 0, { kind: "image", url: `${IK}/x.jpg`, role: "graphic" })[0].role).toBe("hook");
  });

  it("appends up to 10 items in all and sends only kind, url and role", () => {
    const nine = Array.from({ length: 9 }, (_, i) => img(`n${i}`));
    const out = appendItems(nine, [
      { kind: "image", url: `${IK}/x.jpg`, role: "screenshot", width: 1, height: 1, design: graphic },
      { kind: "image", url: `${IK}/y.jpg`, role: "screenshot" },
    ]);
    expect(out).toHaveLength(10);
    expect(out[9]).toEqual({ kind: "image", url: `${IK}/x.jpg`, role: "screenshot" });
  });

  it("says when nothing more can be added", () => {
    expect(addProblem(10, false)).toMatch(/At most 10/);
    expect(addProblem(9, false)).toBeNull();
    expect(addProblem(1, true)).toMatch(/exactly one/);
    expect(addProblem(0, true)).toBeNull();
  });
});

describe("carousel sets", () => {
  it("finds every slide rendered with the edited one, and only that one for anything else", () => {
    const media = [img("s0"), img("g"), img("s1"), img("t0"), img("s2")];
    const details = [
      detail(media[0], { design: slide("A", 0, 3) }),
      detail(media[1], { design: graphic }),
      detail(media[2], { design: slide("A", 1, 3) }),
      detail(media[3], { design: slide("B", 0, 1) }),
      detail(media[4], { design: slide("A", 2, 3) }),
    ];
    expect(carouselSet(details, 2)).toEqual([0, 2, 4]);
    expect(carouselSet(details, 3)).toEqual([3]);
    expect(carouselSet(details, 1)).toEqual([1]);
    expect(carouselSet([undefined], 0)).toEqual([0]);
  });
});

describe("feed and story", () => {
  const story = img("story");
  const feed = img("feed");
  const sd = detail(story, { width: 1080, height: 1920 });
  const fd = detail(feed);

  it("lets an empty post or one 9:16 item become a story", () => {
    expect(storySwitch([], [])).toEqual({ type: "ok", media: [] });
    expect(storySwitch([story], [sd])).toEqual({ type: "ok", media: [story] });
  });

  it("refuses one item that is not 9:16, and a video outside 3 to 60 s", () => {
    const r = storySwitch([feed], [fd]);
    expect(r.type).toBe("no");
    if (r.type === "no") expect(r.reason).toMatch(/9:16, and this image is 1080x1350/);
    const v: MediaItem = { kind: "video", url: "https://r2.example/v.mp4" };
    const long = storySwitch([v], [detail(v, { width: 1080, height: 1920, durationSec: 75 })]);
    expect(long.type === "no" && long.reason).toMatch(/3 to 60 seconds/);
  });

  it("lets an item of unknown size through (the server checks)", () => {
    expect(storySwitch([feed], [detail(feed, { width: null, height: null })]).type).toBe("ok");
  });

  it("offers to keep the one 9:16 item among several", () => {
    expect(storySwitch([feed, story, feed], [fd, sd, fd])).toEqual({ type: "pick", index: 1, media: [story], drops: 2 });
  });

  it("refuses several items with none, or more than one, at 9:16", () => {
    expect(storySwitch([feed, feed], [fd, fd]).type).toBe("no");
    expect(storySwitch([story, story], [sd, sd]).type).toBe("no");
  });

  it("checks a picked item for a story", () => {
    expect(storyItemProblem({ kind: "image", width: 1080, height: 1920 })).toBeNull();
    expect(storyItemProblem({ kind: "image", width: 1080, height: 1080 })).toMatch(/9:16/);
    expect(storyItemProblem({ kind: "image" })).toBeNull();
    expect(storyItemProblem({ kind: "video", width: 1080, height: 1920, durationSec: 2 })).toMatch(/3 to 60/);
  });
});

describe("labels", () => {
  it("names items by recipe, role or URL", () => {
    const m = img("x");
    expect(itemTitle(m, detail(m, { design: slide("A", 1, 6) }))).toBe("Slide 2 of 6");
    expect(itemTitle(m, detail(m, { design: graphic }))).toBe("Graphic");
    expect(itemTitle({ kind: "image", url: "https://ik.imagekit.io/a/listings/kencho/shot.webp" }, undefined)).toBe("Screenshot");
    expect(itemTitle({ kind: "video", url: "https://r2.example/v.mp4" }, undefined)).toBe("Video");
    expect(itemTitle(img("u", { role: "upload" }), undefined)).toBe("Upload");
  });

  it("notes the size, the recipe, the networks and Instagram's white padding", () => {
    const wide = img("wide", { networks: ["threads"] });
    const d = detail(wide, { width: 1600, height: 600 });
    expect(itemNotes(wide, d, { instagram: true, story: false })).toEqual(["1600x600", "No design saved", "Only on Threads", "Padded with white on Instagram"]);
    expect(itemNotes(wide, d, { instagram: false, story: false })).not.toContain("Padded with white on Instagram");
    const m = img("ok");
    expect(itemNotes(m, detail(m, { design: graphic }), { instagram: true, story: false })).toEqual(["1080x1350", "Design saved"]);
  });

  it("pads only ImageKit images outside 4:5 to 1.91:1", () => {
    expect(paddedOnInstagram({ url: `${IK}/a.jpg`, kind: "image", width: 1080, height: 1920 })).toBe(true);
    expect(paddedOnInstagram({ url: `${IK}/a.jpg`, kind: "image", width: 1080, height: 1350 })).toBe(false);
    expect(paddedOnInstagram({ url: "https://example.com/a.jpg", kind: "image", width: 1080, height: 1920 })).toBe(false);
    expect(paddedOnInstagram({ url: `${IK}/a.jpg`, kind: "image", width: null, height: null })).toBe(false);
  });

  it("offers Edit design with a recipe, Redesign without, nothing for a video", () => {
    const m = img("x");
    expect(editLabel(m, detail(m, { design: graphic }))).toBe("Edit design");
    expect(editLabel(m, detail(m))).toBe("Redesign");
    expect(editLabel({ kind: "video", url: "https://r2.example/v.mp4" }, undefined)).toBeNull();
  });
});

describe("Create links", () => {
  it("opens Create in edit mode for an item, or in add mode", () => {
    expect(editHref("abc", 2)).toBe("/create?post=abc&item=2");
    expect(addHref("abc")).toBe("/create?post=abc&mode=add");
  });
});

describe("optimistic post", () => {
  it("reorders the details with the media and fills picked files", () => {
    const a = img("a");
    const b = img("b");
    const p = post([a, b], { mediaDetails: [detail(a, { design: graphic }), detail(b)] });
    const added = { kind: "image" as const, url: `${IK}/up.jpg`, role: "upload", width: 800, height: 1000 };
    const next = optimisticDetail(p, { media: [b, a, { kind: "image", url: added.url, role: "upload" }] }, [added]);
    expect(next.mediaDetails.map((d) => d.url)).toEqual([b.url, a.url, added.url]);
    expect(next.mediaDetails[1].design).toEqual(graphic);
    expect(next.mediaDetails[2]).toMatchObject({ width: 800, height: 1000, design: null });
    expect(next.status).toBe("waiting");
  });

  it("sends an approved, scheduled or failed post back to waiting, and keeps a waiting one", () => {
    for (const status of ["approved", "scheduled", "failed"] as const) {
      const next = optimisticDetail(post([img("a")], { status, error: "x", approvedAt: 5 }), { placement: "story" });
      expect(next).toMatchObject({ status: "waiting", error: null, approvedAt: null, placement: "story" });
    }
    const waiting = post([img("a")]);
    expect(optimisticDetail(waiting, { media: [] })).toMatchObject({ status: "waiting", media: [], mediaDetails: [] });
  });

  it("marks files it knows nothing about as unknown", () => {
    const m = img("z");
    expect(detailsFor([m], [])).toEqual([{ url: m.url, mediaId: null, kind: "image", width: null, height: null, durationSec: null, design: null }]);
  });
});

describe("an image from the device", () => {
  it("takes images only, up to 40 MB", () => {
    expect(pickedFileProblem({ type: "image/heic", size: 3_000_000 })).toBeNull();
    expect(pickedFileProblem({ type: "video/mp4", size: 1 })).toMatch(/Pick an image/);
    expect(pickedFileProblem({ type: "image/gif", size: 1 })).toMatch(/still image/);
    expect(pickedFileProblem({ type: "image/png", size: 41 * 1024 * 1024 })).toMatch(/over 40 MB/);
  });

  it("uploads a small JPEG or PNG as it is and redraws the rest", () => {
    expect(uploadAsIs({ type: "image/jpeg", size: 1_000_000 }, 1080, 1350)).toBe(true);
    expect(uploadAsIs({ type: "image/png", size: 6 * 1024 * 1024 }, 1080, 1350)).toBe(false);
    expect(uploadAsIs({ type: "image/webp", size: 100 }, 1080, 1350)).toBe(false);
    expect(uploadAsIs({ type: "image/jpeg", size: 100 }, 5000, 3000)).toBe(false);
  });

  it("scales down to 4096 px a side, keeping the shape", () => {
    expect(fitSide(8192, 4096)).toEqual({ width: 4096, height: 2048, scaled: true });
    expect(fitSide(1080, 1350)).toEqual({ width: 1080, height: 1350, scaled: false });
  });
});

describe("the list's keys, Remove's wording and the pick sheet's yes", () => {
  it("keys follow each item, not its place (a repeated URL counted)", () => {
    const a = img("a");
    const b = img("b");
    const keys = itemKeys([a, b, { ...a, networks: ["threads"] }]);
    expect(new Set(keys).size).toBe(3);
    const moved = itemKeys([b, a, { ...a, networks: ["threads"] }]);
    expect(moved[0]).toBe(keys[1]);
    expect(moved[1]).toBe(keys[0]);
    const editor = readFileSync("components/studio/queue/MediaEditor.tsx", "utf8");
    expect(editor).toMatch(/key=\{keys\[i\]\}/);
    expect(editor).toMatch(/aria-label=\{`Open item \$\{i \+ 1\}: \$\{name\}`\}/);
  });

  it("says Recent renders only for renders", () => {
    expect(removeNote(img("g"), undefined, false)).toMatch(/Recent renders/);
    expect(removeNote({ kind: "video", url: "https://r2/v.mp4", role: "voiceover" }, undefined, true)).toBe("It leaves this post. You can't add this video back here.");
    expect(removeNote({ kind: "image", url: "https://ik.imagekit.io/x/listings/a/1.jpg", role: "screenshot" }, undefined, true)).toMatch(/from Listing/);
    expect(removeNote({ kind: "image", url: "https://ik.imagekit.io/x/uploads/u.jpg", role: "upload" }, undefined, false)).toBe("It leaves this post. You can't add this image back here.");
  });

  it("an upload is picked, not saved: the Add / Replace button saves it", () => {
    const sheet = readFileSync("components/studio/queue/PickSheet.tsx", "utf8");
    const upload = sheet.slice(sheet.indexOf("async function upload"), sheet.indexOf("const sources"));
    expect(upload).not.toMatch(/save\(/);
    expect(upload).toMatch(/setChosen/);
    expect(sheet).not.toMatch(/source === "device" \? null/);
    // A video tile is named.
    expect(sheet).toMatch(/aria-label=\{p\.kind === "video" \? describe\(p\) : undefined\}/);
  });
});
