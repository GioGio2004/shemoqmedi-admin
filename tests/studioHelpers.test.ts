// The Studio app's pure helpers (lib/studio): Tbilisi times for the schedule
// and reminder sheets, caption counters and limits, first-draft captions,
// which actions a queued post offers, and what the Create page sends.
import { describe, expect, it } from "vitest";
import { CAPTION_MAX as SERVER_MAX } from "../convex/social";
import { STORY_NETWORKS as SERVER_STORY_NETWORKS } from "../convex/lib/socialApi";
import {
  CAPTION_MAX,
  NETWORKS,
  STORY_NETWORKS,
  captionCounter,
  captionLength,
  captionedNetworks,
  captionsDiffer,
  captionsFit,
  captionsForSave,
  fitCaption,
} from "../lib/studio/captions";
import { asUrl, draftCaptions, storyCaption, type DraftSource } from "../lib/studio/drafts";
import { nextScheduled, parseQueueTab, postActions, type QueuePostLike } from "../lib/studio/queue";
import {
  assetsUrl,
  formatFor,
  initialFields,
  kindFor,
  outputAllowed,
  renderArgs,
  renderKey,
  templatesFor,
  type Design,
} from "../lib/studio/create";
import { formatTbilisi, parseTbilisiInput, quickTimes, relativeTime, suggestedTime, toTbilisiInput } from "../lib/studio/time";

const MIN = 60_000;
const HOUR = 60 * MIN;
// Fri 13 Nov 2026, 10:00 in Tbilisi (06:00 UTC).
const NOW = Date.UTC(2026, 10, 13, 6, 0);

describe("Tbilisi times", () => {
  it("writes and reads datetime-local values in Tbilisi time (UTC+4)", () => {
    expect(toTbilisiInput(NOW)).toBe("2026-11-13T10:00");
    expect(parseTbilisiInput("2026-11-13T10:00")).toBe(NOW);
    expect(parseTbilisiInput("2026-11-13T23:30")).toBe(Date.UTC(2026, 10, 13, 19, 30));
    // Just after midnight in Tbilisi is still the previous day in UTC.
    expect(parseTbilisiInput("2026-11-14T01:15")).toBe(Date.UTC(2026, 10, 13, 21, 15));
    expect(parseTbilisiInput("2026-11-13T10:00:00")).toBe(NOW);
    for (const ms of [NOW, NOW + 37 * MIN, Date.UTC(2027, 0, 1, 0, 0)]) expect(parseTbilisiInput(toTbilisiInput(ms))).toBe(Math.floor(ms / MIN) * MIN);
  });

  it("refuses anything that isn't a real date and time", () => {
    for (const bad of ["", "tomorrow", "2026-02-31T10:00", "2026-13-01T10:00", "2026-11-13T24:00", "2026-11-13 10:00", "2026-11-13T9:00"]) {
      expect(parseTbilisiInput(bad)).toBeNull();
    }
  });

  it("names days relative to Tbilisi's today", () => {
    expect(formatTbilisi(NOW + 2 * HOUR, NOW)).toBe("Today 12:00");
    expect(formatTbilisi(NOW + 24 * HOUR, NOW)).toBe("Tomorrow 10:00");
    expect(formatTbilisi(NOW - 24 * HOUR, NOW)).toBe("Yesterday 10:00");
    expect(formatTbilisi(NOW + 6 * 24 * HOUR, NOW)).toBe("Thu 19 Nov 10:00");
    expect(formatTbilisi(Date.UTC(2027, 0, 5, 8, 5), NOW)).toBe("Tue 5 Jan 2027 12:05");
    // 23:30 UTC on the 13th is already the 14th in Tbilisi.
    expect(formatTbilisi(Date.UTC(2026, 10, 13, 21, 30), NOW)).toBe("Tomorrow 01:30");
  });

  it("says how far away a time is", () => {
    expect(relativeTime(NOW + 20_000, NOW)).toBe("now");
    expect(relativeTime(NOW + 5 * MIN, NOW)).toBe("in 5 min");
    expect(relativeTime(NOW + 3 * HOUR, NOW)).toBe("in 3 h");
    expect(relativeTime(NOW + 49 * HOUR, NOW)).toBe("in 2 days");
    expect(relativeTime(NOW + 24 * HOUR, NOW)).toBe("in 1 day");
    expect(relativeTime(NOW - 4 * MIN, NOW)).toBe("4 min ago");
  });

  it("suggests future times only", () => {
    expect(suggestedTime(NOW + 7 * MIN)).toBe(NOW + HOUR + 15 * MIN);
    expect(suggestedTime(NOW)).toBe(NOW + HOUR);
    const quick = quickTimes(NOW);
    expect(quick.map((q) => q.label)).toEqual(["In 1 hour", "Tonight 20:00", "Tomorrow 10:00"]);
    expect(quick.map((q) => toTbilisiInput(q.at))).toEqual(["2026-11-13T11:00", "2026-11-13T20:00", "2026-11-14T10:00"]);
    // Late in the evening "tonight" has passed: tomorrow evening instead.
    const late = quickTimes(parseTbilisiInput("2026-11-13T19:45")!);
    expect(late[1]).toEqual({ label: "Tomorrow 20:00", at: parseTbilisiInput("2026-11-14T20:00") });
    for (const q of [...quick, ...late]) expect(q.at).toBeGreaterThan(NOW);
  });
});

describe("captions", () => {
  it("has the server's limits and story networks", () => {
    expect(CAPTION_MAX).toEqual(SERVER_MAX);
    expect([...STORY_NETWORKS].sort()).toEqual([...SERVER_STORY_NETWORKS].sort());
  });

  it("counts Threads emoji as their UTF-8 bytes, everything else by characters, trimmed", () => {
    expect(captionLength("instagram", "  hello  ")).toBe(5);
    expect(captionLength("threads", "Site of the Day 🏆")).toBe(16 + 4);
    expect(captionLength("instagram", "Site of the Day 🏆")).toBe("Site of the Day 🏆".length);
    const c = captionCounter("threads", "✨".repeat(170));
    expect(c).toMatchObject({ length: 510, max: 500, over: true, bytes: true });
    expect(captionCounter("threads", "a".repeat(460))).toMatchObject({ near: true, over: false, bytes: false });
    expect(captionCounter("facebook", "short")).toMatchObject({ near: false, over: false });
  });

  it("saves every network, blank ones as empty so the server clears them", () => {
    expect(captionsForSave({ instagram: "  hi  ", threads: "   " })).toEqual({ instagram: "hi", facebook: "", threads: "", linkedin: "" });
    expect(captionedNetworks({ instagram: "a", threads: " ", linkedin: "b" })).toEqual(["instagram", "linkedin"]);
    expect(captionsDiffer({ instagram: "a " }, { instagram: "a" })).toBe(false);
    expect(captionsDiffer({ instagram: "" }, {})).toBe(false);
    expect(captionsDiffer({ facebook: "x" }, {})).toBe(true);
    expect(captionsFit({ threads: "🏆".repeat(126) })).toBe(false);
    expect(captionsFit({ threads: "🏆".repeat(125) })).toBe(true);
  });

  it("cuts a long caption to fit, as its network counts", () => {
    const long = "word ".repeat(200);
    const cut = fitCaption("threads", long);
    expect(captionLength("threads", cut)).toBeLessThanOrEqual(500);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toMatch(/wor…$/);
    expect(captionLength("threads", fitCaption("threads", "🏆".repeat(400)))).toBeLessThanOrEqual(500);
    expect(fitCaption("instagram", "  fits  ")).toBe("fits");
  });
});

describe("draft captions", () => {
  const site = { title: "Floema", studio: "Studio Lumen", tagline: "A furniture house online", pageUrl: "https://www.shemoqmedi.space/sites/floema" };
  const sources: DraftSource[] = ["listing", "award", "announcement", "call_submissions", "call_jury", "free"];

  it("writes every network within its limit, for every source", () => {
    for (const source of sources) {
      const drafts = draftCaptions(source, { ...site, tierName: "Site of the Day", date: "12 Nov 2026", headline: "Big news", body: "x".repeat(4000), cta: "shemoqmedi.space" });
      for (const n of NETWORKS) {
        expect(drafts[n], `${source} ${n}`).toBeTruthy();
        expect(captionCounter(n, drafts[n]!).over, `${source} ${n}`).toBe(false);
      }
    }
  });

  it("says what the site and award are; links only where they are clickable", () => {
    const award = draftCaptions("award", { ...site, tierName: "Site of the Day", date: "12 Nov 2026" });
    expect(award.instagram).toMatch(/^Site of the Day: Floema by Studio Lumen\./);
    expect(award.instagram).not.toContain("https://");
    expect(award.instagram).toContain("#shemoqmedi");
    expect(award.facebook).toContain(site.pageUrl);
    expect(award.linkedin).toContain("Floema by Studio Lumen is the Shemoqmedi Site of the Day for 12 Nov 2026.");
    expect(award.threads).toContain(site.pageUrl);
    const listing = draftCaptions("listing", site);
    expect(listing.facebook).toMatch(/^New on Shemoqmedi: Floema by Studio Lumen\.\n\nA furniture house online\./);
  });

  it("fills calls with their page when no link is given", () => {
    expect(draftCaptions("call_submissions", {}).facebook).toContain("https://shemoqmedi.space/submit");
    expect(draftCaptions("call_jury", {}).linkedin).toContain("https://shemoqmedi.space/jury");
    expect(draftCaptions("call_jury", {}).instagram).toContain("Link in bio.");
    expect(asUrl("shemoqmedi.space/submit")).toBe("https://shemoqmedi.space/submit");
    expect(asUrl("http://x.com")).toBe("http://x.com");
    expect(asUrl("  ")).toBe("");
  });

  it("gives stories a short label (their caption only picks the network)", () => {
    expect(storyCaption({ title: " Floema " })).toBe("Floema");
    expect(storyCaption({ headline: "News" })).toBe("News");
    expect(storyCaption({})).toBe("Story");
  });
});

describe("the queue", () => {
  const base: QueuePostLike = { status: "waiting", placement: "feed", captions: { instagram: "x" }, results: [], publishingUntil: null, scheduledFor: null };

  it("reads ?status= (old /social links too)", () => {
    expect(parseQueueTab("failed")).toBe("failed");
    expect(parseQueueTab(["scheduled", "sent"])).toBe("scheduled");
    expect(parseQueueTab("pending")).toBe("waiting");
    expect(parseQueueTab("nonsense")).toBe("waiting");
    expect(parseQueueTab(undefined)).toBe("waiting");
  });

  it("offers what the server allows for each status", () => {
    expect(postActions(base, NOW)).toMatchObject({ publishNow: true, schedule: true, reject: true, edit: true, unschedule: false, retry: false, editResets: false });
    expect(postActions({ ...base, status: "scheduled", scheduledFor: NOW + HOUR }, NOW)).toMatchObject({ publishNow: true, schedule: true, unschedule: true, reject: true, editResets: true, retry: false });
    expect(postActions({ ...base, status: "failed", results: [{ network: "instagram", status: "failed" }] }, NOW)).toMatchObject({ retry: true, reject: true, publishNow: false });
    expect(postActions({ ...base, status: "rejected" }, NOW)).toMatchObject({ publishNow: false, reject: false, edit: false, retry: false });
  });

  it("only retries a sent post with networks left, and holds a post while it publishes", () => {
    expect(postActions({ ...base, status: "sent", results: [{ network: "instagram", status: "sent" }] }, NOW).retry).toBe(false);
    const skipped = { ...base, status: "sent", captions: { instagram: "x", threads: "y" }, results: [{ network: "instagram", status: "sent" }, { network: "threads", status: "skipped" }] };
    expect(postActions(skipped, NOW)).toMatchObject({ retry: true, edit: false, reject: false });
    expect(postActions({ ...base, status: "scheduled", publishingUntil: NOW + MIN }, NOW)).toMatchObject({ publishing: true, publishNow: false, reject: false, retry: false });
    // A run that claimed it and died: retry, not publish.
    expect(postActions({ ...base, status: "scheduled", publishingUntil: NOW - MIN, results: [] }, NOW)).toMatchObject({ publishing: false, retry: true, publishNow: false });
    // Approved before publishing existed: never retried (edit it instead).
    expect(postActions({ ...base, status: "approved" }, NOW)).toMatchObject({ retry: false, edit: true });
  });

  it("finds the next post out", () => {
    const posts = [
      { id: "a", status: "scheduled", scheduledFor: NOW + 3 * HOUR },
      { id: "b", status: "waiting", scheduledFor: NOW + HOUR },
      { id: "c", status: "scheduled", scheduledFor: NOW + 2 * HOUR },
    ];
    expect(nextScheduled(posts)?.id).toBe("c");
    expect(nextScheduled([...posts, { id: "d", status: "scheduled", scheduledFor: null }])?.id).toBe("d");
    expect(nextScheduled([posts[1]])).toBeNull();
  });
});

describe("the Create page", () => {
  const design: Design = {
    source: "listing",
    output: "single",
    template: "new_listing",
    format: "ig_portrait",
    style: "swiss",
    palette: "house",
    glass: "frost",
    fields: { title: " Floema ", studio: "Lumen", tagline: "", url: "floema.com" },
    carouselFields: { quote: "", juror: "", role: "", cta: "" },
    shot: "https://ik.imagekit.io/shemoqmedi/a.webp",
    listingId: "listing123",
  };

  it("fetches preview assets only for glass and auto", () => {
    expect(assetsUrl({ ...design, palette: "house" })).toBeNull();
    expect(assetsUrl({ ...design, palette: "auto" })).toBe(`/api/graphics/assets?palette=auto&glass=frost&format=ig_portrait&shot=${encodeURIComponent(design.shot!)}`);
    expect(assetsUrl({ ...design, palette: "auto", shot: null })).toBeNull();
    expect(assetsUrl({ ...design, style: "glass", shot: null })).toBe("/api/graphics/assets?palette=house&glass=frost&format=ig_portrait");
  });

  it("renders a single image with its filled fields and screenshot", () => {
    expect(renderArgs(design)).toEqual({
      template: "new_listing",
      format: "ig_portrait",
      palette: "house",
      style: "swiss",
      glass: undefined,
      fields: { title: "Floema", studio: "Lumen", url: "floema.com" },
      imageUrls: [design.shot],
      carousel: undefined,
      listingId: undefined,
    });
    expect(renderArgs({ ...design, template: "call_jury", style: "glass" })).toMatchObject({ glass: "frost", imageUrls: [design.shot] });
    expect(renderArgs({ ...design, output: "story" }).format).toBe("story");
  });

  it("renders a carousel from the listing", () => {
    expect(renderArgs({ ...design, output: "carousel", carouselFields: { quote: "Lovely", juror: "", role: "", cta: "" } })).toEqual({
      template: "new_listing",
      format: "ig_portrait",
      palette: "house",
      style: "swiss",
      glass: undefined,
      fields: { quote: "Lovely" },
      carousel: true,
      listingId: "listing123",
    });
    expect(outputAllowed("carousel", "listing")).toBe(true);
    expect(outputAllowed("carousel", "announcement")).toBe(false);
    expect(outputAllowed("story", "free")).toBe(true);
  });

  it("marks a render stale when anything it depends on changes", () => {
    const key = renderKey(design);
    expect(renderKey({ ...design })).toBe(key);
    expect(renderKey({ ...design, fields: { ...design.fields, title: "Other" } })).not.toBe(key);
    expect(renderKey({ ...design, palette: "night" })).not.toBe(key);
    // The carousel's own text doesn't touch a single image.
    expect(renderKey({ ...design, carouselFields: { quote: "x" } })).toBe(key);
  });

  it("keeps feed formats Instagram accepts, and picks templates and kinds per source", () => {
    expect(formatFor("single", "story")).toBe("ig_portrait");
    expect(formatFor("single", "square")).toBe("square");
    expect(formatFor("story", "square")).toBe("story");
    expect(formatFor("carousel", "link")).toBe("ig_portrait");
    expect(templatesFor("award")[0]).toBe("award");
    expect(new Set(templatesFor("free")).size).toBe(templatesFor("free").length);
    // Approving a new_listing post emails the studio: listing posts made here are custom.
    expect(kindFor("listing")).toBe("custom");
    expect(kindFor("award")).toBe("award");
    expect(kindFor("call_jury")).toBe("call_jury");
    expect(initialFields().award.tier).toBe("SOTD");
  });
});
