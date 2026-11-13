// The reel editor's integration (docs/reel-editor.md section 6, docs/post-editing.md
// section 7): the /reels route (tab or editor, from a post or not), the links
// that lead there (post sheet, Home, push) meeting the route's parser, the
// Reels tab's lists, and the round trip back into the post.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DraftSummary } from "../convex/reels";
import { studioReelUrl } from "../lib/hosts";
import {
  draftHref,
  draftStatusText,
  newReelHref,
  parseReelTarget,
  recentRenders,
  reelCloseHref,
  reelEditorHref,
  reelTargetFrom,
  reelTargetKey,
} from "../lib/studio/reelPost";

const read = (path: string) => readFileSync(path, "utf8");
const ID = "j57a1b2c3d4e5f6g7h8i9k0m1n2p3q4r";
const POST = "k97zz8yy7xx6ww5vv4uu3tt2ss1rr0qq";

/** What the route sees for a link (the same parser the page uses). */
const targetOf = (href: string) => reelTargetFrom(new URL(href, "https://studio.shemoqmedi.space").searchParams);

describe("the /reels route", () => {
  it("is the tab without an editor link", () => {
    expect(parseReelTarget({})).toBeNull();
    expect(parseReelTarget({ post: POST })).toBeNull(); // a post alone opens nothing
    expect(parseReelTarget({ new: "0" })).toBeNull();
    expect(parseReelTarget({ draft: "../../x" })).toBeNull(); // never sent to the server
    expect(parseReelTarget({ draft: "short" })).toBeNull();
  });

  it("opens a draft, a new reel, and either from a post", () => {
    expect(parseReelTarget({ draft: ID })).toEqual({ draftId: ID, post: null });
    expect(parseReelTarget({ new: "1" })).toEqual({ draftId: null, post: null });
    expect(parseReelTarget({ new: "1", post: POST })).toEqual({ draftId: null, post: { id: POST, item: null } });
    expect(parseReelTarget({ draft: ID, post: POST, item: "2" })).toEqual({ draftId: ID, post: { id: POST, item: 2 } });
    expect(parseReelTarget({ draft: [ID, "x"], post: [POST], item: ["0"] })).toEqual({ draftId: ID, post: { id: POST, item: 0 } });
  });

  it("drops a bad post or item instead of guessing", () => {
    expect(parseReelTarget({ draft: ID, post: "nope", item: "1" })).toEqual({ draftId: ID, post: null });
    expect(parseReelTarget({ draft: ID, post: POST, item: "-1" })).toEqual({ draftId: ID, post: { id: POST, item: null } });
    expect(parseReelTarget({ draft: ID, post: POST, item: "1.5" })).toEqual({ draftId: ID, post: { id: POST, item: null } });
    expect(parseReelTarget({ draft: ID, post: POST, item: "999" })).toEqual({ draftId: ID, post: { id: POST, item: null } });
  });

  it("reads every link the Studio makes to it", () => {
    // Post sheet: Edit reel / Make a reel (replace item 1), New reel (add).
    expect(targetOf(reelEditorHref(ID, { postId: POST, item: 1 }))).toEqual({ draftId: ID, post: { id: POST, item: 1 } });
    expect(targetOf(newReelHref(POST))).toEqual({ draftId: null, post: { id: POST, item: null } });
    // Home's quick action, the Reels tab's New reel, Home's "Ready to render" rows and the tab's draft rows.
    expect(targetOf(newReelHref())).toEqual({ draftId: null, post: null });
    expect(targetOf(draftHref({ id: ID as DraftSummary["id"] }))).toEqual({ draftId: ID, post: null });
    // The push for a draft Claude made.
    expect(targetOf(studioReelUrl(ID))).toEqual({ draftId: ID, post: null });
  });

  it("keeps the editor mounted when a new reel's URL turns into its draft, and remounts it for another post", () => {
    const fresh = targetOf(newReelHref(POST))!;
    const saved = targetOf(reelEditorHref(ID, { postId: POST }))!;
    expect(reelTargetKey(fresh)).toBe(reelTargetKey(saved));
    expect(reelTargetKey(targetOf(newReelHref())!)).toBe(reelTargetKey(targetOf(draftHref({ id: ID as DraftSummary["id"] }))!));
    expect(reelTargetKey(targetOf(reelEditorHref(ID, { postId: POST, item: 0 }))!)).not.toBe(reelTargetKey(saved));
  });

  it("goes back to the post it came from, else to Reels", () => {
    expect(reelCloseHref({ post: { id: POST, item: 0 } })).toBe(`/queue?post=${POST}`);
    expect(reelCloseHref({ post: null })).toBe("/reels");
  });

  it("is wired: the page picks on the client, the editor's rewrite reaches Next's router", () => {
    const page = read("app/studio/reels/page.tsx");
    expect(page).toMatch(/<ReelsRoute \/>/);
    const reels = read("components/studio/reels/Reels.tsx");
    expect(reels).toMatch(/reelTargetFrom\(params\)/);
    expect(reels).toMatch(/<ReelEditor draftId=\{target\.draftId/);
    expect(reels).toMatch(/releaseProbes\(\)/);
    // Next's own history state (__NA) would skip its sync and the router would later restore ?new=1.
    const editor = read("components/studio/reels/editor/ReelEditor.tsx");
    expect(editor).toMatch(/window\.history\.replaceState\(null, ""/);
    expect(editor).not.toMatch(/replaceState\(window\.history\.state/);
  });
});

describe("the Reels tab", () => {
  const draft = (id: string, patch: Partial<DraftSummary>): DraftSummary =>
    ({
      id,
      title: id,
      status: "draft",
      createdBy: "studio",
      note: null,
      postId: null,
      listingIds: [],
      aspect: "9:16",
      clipCount: 1,
      durationSec: 10,
      cover: null,
      renderedUrl: null,
      mediaId: null,
      renderedAt: null,
      createdAt: 1,
      updatedAt: 1,
      ...patch,
    }) as DraftSummary;

  it("names each status", () => {
    expect(draftStatusText({ status: "ready" })).toBe("Ready to render");
    expect(draftStatusText({ status: "rendered" })).toBe("Rendered");
    expect(draftStatusText({ status: "draft" })).toBe("Draft");
  });

  it("lists recent reels by render time, only those with a render", () => {
    const list = [
      draft("a", { renderedUrl: "https://r2/a.mp4", renderedAt: 10, status: "rendered" }),
      draft("b", {}),
      draft("c", { renderedUrl: "https://r2/c.mp4", renderedAt: 30, status: "draft" }), // changed since: still listed
      draft("d", { renderedUrl: "https://r2/d.mp4", renderedAt: 20, status: "rendered" }),
    ];
    expect(recentRenders(list).map((d) => d.id)).toEqual(["c", "d", "a"]);
    expect(recentRenders(list, 1).map((d) => d.id)).toEqual(["c"]);
    expect(recentRenders(undefined)).toEqual([]);
  });

  it("keeps the quick voiceover reel and posts nothing by itself", () => {
    const reels = read("components/studio/reels/Reels.tsx");
    expect(reels).toMatch(/function QuickReel\(\)/);
    expect(reels).toMatch(/\{view === "editor" \? <Library \/> : <QuickReel \/>\}/);
    expect(reels).not.toMatch(/api\.social\.(approve|publish)/);
    expect(reels).toMatch(/role: "reel"/);
  });
});

describe("back into the post", () => {
  it("replaces only a video at the item it was opened from, with the post's base media", () => {
    const sheet = read("components/studio/reels/editor/RenderSheet.tsx");
    // The item is the video that was at post.item when the editor opened (found by its URL), and the media list
    // as it was then goes as baseMedia: a post changed meanwhile is refused, never the wrong item replaced.
    expect(sheet).toMatch(/if \(target && opened\.current === null\) opened\.current = target\.media\.map\(\(m\) => m\.url\)/);
    expect(sheet).toMatch(/const fromUrl = post\.item !== null \? base\[post\.item\] : undefined/);
    expect(sheet).toMatch(/m\.url === fromUrl && m\.kind === "video"/);
    expect(sheet).toMatch(/networks: old\.networks/);
    expect(sheet).toMatch(/baseMedia: base \}/);
    expect(sheet).toMatch(/router\.replace\(`\/queue\?post=\$\{post\.id\}`\)/);
    expect(sheet).not.toMatch(/api\.social\.(approve|publish)/);
  });

  it("the post sheet opens the editor at the item it came from", () => {
    const editor = read("components/studio/queue/MediaEditor.tsx");
    expect(editor).toMatch(/openFromMedia\(\{ url: m\.url, postId: detail\.id \}\)/);
    expect(editor).toMatch(/router\.push\(reelEditorHref\(id, \{ postId: detail\.id, item: i \}\)\)/);
    expect(editor).toMatch(/href=\{newReelHref\(detail\.id\)\}/);
  });
});
