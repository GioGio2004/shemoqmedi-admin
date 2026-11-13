/// <reference types="vite/client" />
// Editing a post after it was made (docs/post-editing.md): every render keeps
// its design recipe on its media row, social.get / get_post / media.designs
// read the recipes back, recent renders and listing media to add, and
// social.update's media rules (whole-list replace, story and kind checks,
// baseMedia, the back-to-waiting rule). fetch is mocked: nothing leaves the test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { SLIDES_CONTENT_TYPE, packSlides } from "../lib/graphics/render";
import { mintServiceCredential } from "../convex/lib/tokens";

const modules = import.meta.glob("../convex/**/*.{ts,js}");

const IK = "https://ik.imagekit.io/shemoqmedi";
const ORIGIN = "https://admin.example.test";
const HOUR = 60 * 60 * 1000;
const STORY_IMG = `${IK}/social/graphics/story.jpg`;
const FEED_IMG = `${IK}/social/graphics/feed.jpg`;
const SQUARE_IMG = `${IK}/social/graphics/square.jpg`;
const SHOT = `${IK}/listings/paper/paper-cover.webp`;
const LONG_VIDEO = `${IK}/listings/paper/paper-preview.mp4`;
const TALL_OUTSIDE = "https://cdn.example/tall-phone.jpg";

beforeEach(() => {
  vi.stubEnv("ADMIN_ORIGIN", ORIGIN);
  vi.stubEnv("GRAPHICS_RENDER_KEY", "render-key-for-tests");
  vi.stubEnv("IMAGEKIT_PRIVATE_KEY", "private_test");
  vi.stubEnv("IMAGEKIT_PUBLIC_KEY", "public_test");
  vi.stubEnv("IMAGEKIT_URL_ENDPOINT", IK);
  vi.stubEnv("MCP_SERVICE_SECRET", "test-secret-test-secret-test-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** The admin app's render routes and ImageKit's upload API, faked (uploads land in the folder asked for). */
function fakeServices() {
  let uploads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      if (url.origin === ORIGIN && url.pathname === "/api/graphics") {
        return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { headers: { "Content-Type": "image/jpeg" } });
      }
      if (url.origin === ORIGIN && url.pathname === "/api/graphics/carousel") {
        const names = ["hook", "site", "cta"];
        const body = packSlides(names.map((n) => Buffer.from(`jpeg:${n}`)), names, { width: 1080, height: 1350, type: "image/jpeg" });
        return new Response(new Uint8Array(body), { headers: { "Content-Type": SLIDES_CONTENT_TYPE } });
      }
      if (url.host === "upload.imagekit.io") {
        const n = ++uploads; // before awaiting: slides upload at the same time
        const form = await req.formData();
        const folder = String(form.get("folder") ?? "/social/graphics").replace(/\/+$/, "");
        const path = `${folder}/f${n}.jpg`;
        return Response.json({ fileId: `file_${n}_abcdef`, url: `${IK}${path}`, filePath: path, size: 2048 });
      }
      return new Response("not found", { status: 404 });
    }),
  );
}

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { listingCover } = await t.run(async (ctx) => {
    await ctx.db.insert("users", { externalId: "admin", name: "Admin", email: "a@example.com", role: "admin", createdAt: now, updatedAt: now });
    await ctx.db.insert("users", { externalId: "maker", name: "Maker", email: "m@example.com", createdAt: now, updatedAt: now });
    const image = { kind: "image" as const, contentType: "image/jpeg", size: 200_000, createdAt: now - 1000 };
    await ctx.db.insert("media", { ...image, fileId: "ik-story", url: STORY_IMG, filePath: "/social/graphics/story.jpg", width: 1080, height: 1920 });
    await ctx.db.insert("media", { ...image, fileId: "ik-feed", url: FEED_IMG, filePath: "/social/graphics/feed.jpg", width: 1080, height: 1350 });
    await ctx.db.insert("media", { ...image, fileId: "ik-square", url: SQUARE_IMG, filePath: "/social/graphics/square.jpg", width: 1080, height: 1080 });
    await ctx.db.insert("media", { ...image, fileId: "cdn-tall", url: TALL_OUTSIDE, filePath: "/elsewhere/tall-phone.jpg", width: 1170, height: 2532 });
    await ctx.db.insert("media", {
      kind: "video",
      contentType: "video/mp4",
      size: 4_000_000,
      createdAt: now - 1000,
      fileId: "ik-video",
      url: LONG_VIDEO,
      filePath: "/listings/paper/paper-preview.mp4",
      width: 1080,
      height: 1920,
      durationSec: 75,
    });
    const listingCover = await ctx.db.insert("media", {
      ...image,
      contentType: "image/webp",
      fileId: "ik-cover",
      url: SHOT,
      filePath: "/listings/paper/paper-cover.webp",
      width: 1440,
      height: 900,
    });
    return { listingCover };
  });
  const admin = t.withIdentity({ subject: "admin" });
  const maker = t.withIdentity({ subject: "maker" });
  const token = (await mintServiceCredential("admin"))!;
  return { t, admin, maker, token, listingCover };
}
type Env = Awaited<ReturnType<typeof setup>>;

async function listing(env: Env) {
  const { id } = await env.admin.mutation(api.admin.createListing, {
    title: "Paper Weather",
    tagline: "A studio site",
    url: "https://paper-weather.example",
    categories: ["portfolio"],
    technologies: [],
    region: "global",
    creatorTier: "agency",
    creditName: "Paper Studio",
    coverId: env.listingCover,
    status: "in_voting",
    isClaimed: false,
  });
  const slug = (await env.t.run((ctx) => ctx.db.get(id)))!.slug;
  return { id, slug };
}

const designOf = (env: Env, url: string) =>
  env.t.run(async (ctx) => (await ctx.db.query("media").withIndex("by_url", (q) => q.eq("url", url)).first())?.design);

// ─────────────────────────────────────────────────────────────────────────────
// Recipes
// ─────────────────────────────────────────────────────────────────────────────

describe("design recipes are recorded with every render", () => {
  it("one graphic: the Studio's renderForPost and the MCP render_graphic", async () => {
    const env = await setup();
    fakeServices();
    const studio = await env.admin.action(api.graphics.renderForPost, {
      template: "award",
      format: "square",
      palette: "egypt",
      fields: { title: "Floema", tier: "SOTD" },
      imageUrls: [SHOT],
    });
    expect(await designOf(env, studio.urls[0])).toEqual({
      kind: "graphic",
      template: "award",
      format: "square",
      style: "glass", // the default, written out
      palette: "egypt",
      fields: { title: "Floema", tier: "SOTD" },
      imageUrls: [SHOT],
    });

    const mcp = await env.t.action(api.mcp.renderGraphic, { token: env.token, template: "announcement", format: "story", palette: "night", style: "glass", glass: "liquid", fields: { headline: "News" } });
    expect(await designOf(env, mcp.url)).toEqual({
      kind: "graphic",
      template: "announcement",
      format: "story",
      style: "glass",
      palette: "night",
      glass: "liquid",
      fields: { headline: "News" },
      imageUrls: [],
    });
  });

  it("a carousel: every slide knows its set, place and inputs", async () => {
    const env = await setup();
    const { id: listingId, slug } = await listing(env);
    fakeServices();
    const out = await env.t.action(api.mcp.renderCarousel, {
      token: env.token,
      listingSlug: slug,
      facts: { cta: "Go see it" },
      palette: "moss",
      style: "magazine",
      story: { chips: ["The type"], notes: ["Big serif"], glass: "tint" },
    });
    expect(out.urls).toHaveLength(3);
    const designs = await Promise.all(out.urls.map((u) => designOf(env, u)));
    const setIds = new Set(designs.map((d) => (d?.kind === "carousel" ? d.setId : null)));
    expect(setIds.size).toBe(1);
    expect(designs.map((d) => (d?.kind === "carousel" ? [d.slideIndex, d.slideName, d.total] : null))).toEqual([
      [0, "hook", 3],
      [1, "site", 3],
      [2, "cta", 3],
    ]);
    expect(designs[0]).toMatchObject({
      kind: "carousel",
      listingId,
      palette: "moss",
      style: "magazine",
      facts: { cta: "Go see it" },
      story: { chips: ["The type"], notes: ["Big serif"], glass: "tint" },
    });

    // The Studio's carousel (renderForPost carousel: true): fields are its facts, imageUrls its shots, style defaults to glass.
    const studio = await env.admin.action(api.graphics.renderForPost, { template: "new_listing", format: "ig_portrait", palette: "house", carousel: true, listingId, fields: { quote: "Lovely" }, imageUrls: [SHOT] });
    expect(await designOf(env, studio.urls[1])).toMatchObject({ kind: "carousel", listingId, style: "glass", facts: { quote: "Lovely" }, story: { shots: [SHOT] }, slideIndex: 1 });

    // Rendered again from an MCP recipe: its chips and notes come along; glass and imageUrls win over the story's.
    const again = await env.admin.action(api.graphics.renderForPost, {
      template: "new_listing",
      format: "ig_portrait",
      palette: "moss",
      style: "glass",
      glass: "frost",
      carousel: true,
      listingId,
      story: { chips: ["The type"], notes: ["Big serif"], glass: "tint", shots: ["https://elsewhere.example/old.jpg"] },
      imageUrls: [SHOT],
    });
    expect(await designOf(env, again.urls[0])).toMatchObject({ story: { chips: ["The type"], notes: ["Big serif"], glass: "frost", shots: [SHOT] } });
  });

  it("media.designs reads recipes by URL, in order, for admins only; the MCP get_designs too", async () => {
    const env = await setup();
    const { slug } = await listing(env);
    fakeServices();
    const one = await env.t.action(api.mcp.renderGraphic, { token: env.token, template: "award", format: "ig_portrait", palette: "egypt", fields: { title: "Floema" } });
    const car = await env.t.action(api.mcp.renderCarousel, { token: env.token, listingSlug: slug, palette: "egypt" });
    const urls = [car.urls[2], "https://elsewhere.example/a.jpg", one.url, SHOT];

    await expect(env.maker.query(api.media.designs, { urls })).rejects.toThrow(/admin/);
    const got = await env.admin.query(api.media.designs, { urls });
    expect(got.map((d) => d.url)).toEqual(urls);
    expect(got[0]).toMatchObject({ kind: "image", width: 1080, height: 1350, design: { kind: "carousel", slideIndex: 2, listingSlug: slug } });
    expect(got[1]).toEqual({ url: urls[1], mediaId: null, kind: null, width: null, height: null, durationSec: null, design: null });
    expect(got[2]).toMatchObject({ mediaId: one.mediaId, design: { kind: "graphic", template: "award" } });
    expect(got[3]).toMatchObject({ kind: "image", width: 1440, height: 900, design: null }); // a screenshot has no recipe
    expect(await env.t.query(api.mcp.getDesigns, { token: env.token, urls })).toEqual(got);
    await expect(env.admin.query(api.media.designs, { urls: Array(51).fill(SHOT) })).rejects.toThrow(/At most 50/);
  });

  it("an upload registered with media.registerSocial keeps a recipe when given one", async () => {
    const env = await setup();
    const file = { url: `${IK}/social/graphics/final_x.jpg`, fileId: "file_upload1", filePath: "/social/graphics/final_x.jpg", size: 300_000, width: 1080, height: 1350, contentType: "image/jpeg" };
    const plain = await env.admin.mutation(api.media.registerSocial, file);
    expect(await designOf(env, file.url)).toBeFalsy();
    const design = { kind: "graphic" as const, template: "announcement", format: "ig_portrait", style: "swiss", palette: "paper", fields: { headline: "Hi" }, imageUrls: [] };
    // Registering it again with its recipe adds the recipe (same row).
    expect(await env.admin.mutation(api.media.registerSocial, { ...file, design })).toBe(plain);
    expect(await designOf(env, file.url)).toEqual(design);
  });
});

describe("recent renders", () => {
  it("lists rendered and uploaded images newest first, with recipes, never screenshots, videos or invalid files", async () => {
    const env = await setup();
    const { slug } = await listing(env);
    fakeServices();
    const car = await env.t.action(api.mcp.renderCarousel, { token: env.token, listingSlug: slug, palette: "egypt" });
    const one = await env.t.action(api.mcp.renderGraphic, { token: env.token, template: "award", format: "square", palette: "egypt" });
    await env.t.run((ctx) => ctx.db.patch(car.mediaIds[0], { invalid: true }));

    await expect(env.maker.query(api.media.recentRenders, {})).rejects.toThrow(/admin/);
    const all = await env.admin.query(api.media.recentRenders, {});
    expect(all[0]).toMatchObject({ url: one.url, role: "graphic", design: { kind: "graphic", template: "award" } });
    expect(all.map((m) => m.url)).not.toContain(car.urls[0]);
    expect(all.map((m) => m.url)).not.toContain(SHOT);
    expect(all.every((m) => m.kind === "image" && (m.role === "graphic" || m.role === "carousel"))).toBe(true);
    // Seeded graphics (no recipe) come last: they are the oldest.
    expect(all.at(-1)!.design).toBeNull();

    const slides = await env.admin.query(api.media.recentRenders, { role: "carousel" });
    expect(slides.map((m) => m.url).sort()).toEqual(car.urls.slice(1).sort());
    expect(await env.admin.query(api.media.recentRenders, { limit: 2 })).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Posts
// ─────────────────────────────────────────────────────────────────────────────

describe("a post's media details", () => {
  it("social.get and the MCP get_post give each media item's size and recipe, in media order", async () => {
    const env = await setup();
    fakeServices();
    const one = await env.t.action(api.mcp.renderGraphic, { token: env.token, template: "announcement", format: "ig_portrait", palette: "egypt", fields: { headline: "News" } });
    const post = await env.t.mutation(api.mcp.createPost, {
      token: env.token,
      kind: "announcement",
      captions: { facebook: "FB" },
      media: [
        { kind: "image", url: FEED_IMG, role: "graphic" },
        { kind: "image", url: one.url, role: "graphic", networks: ["instagram"] },
      ],
    });
    const viaMcp = await env.t.query(api.mcp.getPost, { token: env.token, id: post.id });
    expect(viaMcp.mediaDetails.map((d) => d.url)).toEqual([FEED_IMG, one.url]);
    expect(viaMcp.mediaDetails[0]).toMatchObject({ width: 1080, height: 1350, design: null });
    expect(viaMcp.mediaDetails[1]).toMatchObject({ mediaId: one.mediaId, design: { kind: "graphic", fields: { headline: "News" } } });
    expect(await env.admin.query(api.social.get, { id: post.id })).toEqual(viaMcp);
    expect(viaMcp.instagramProblem).toBeNull(); // no Instagram caption
  });

  it("tells early when approval would refuse the media for Instagram", async () => {
    const env = await setup();
    const post = await env.admin.mutation(api.social.create, { kind: "custom", captions: { instagram: "IG" } });
    expect((await env.admin.query(api.social.get, { id: post.id })).instagramProblem).toMatch(/Instagram needs an image or a video/);
    // An image Instagram can't take and ImageKit can't pad (it isn't ours): saved, but flagged (approval refuses it).
    const saved = await env.admin.mutation(api.social.update, { id: post.id, media: [{ kind: "image", url: TALL_OUTSIDE }] });
    expect(saved.instagramProblem).toMatch(/between 4:5 and 1\.91:1/);
    await expect(env.admin.mutation(api.social.approve, { id: post.id })).rejects.toThrow(/between 4:5 and 1\.91:1/);
    expect((await env.admin.mutation(api.social.update, { id: post.id, media: [{ kind: "image", url: FEED_IMG }] })).instagramProblem).toBeNull();
  });

  it("listingMedia gives the post's listing screenshots and video with sizes, nothing without a listing", async () => {
    const env = await setup();
    const { id: listingId } = await listing(env);
    const post = await env.admin.mutation(api.social.create, { kind: "custom", listingId });
    await expect(env.maker.query(api.social.listingMedia, { id: post.id })).rejects.toThrow(/admin/);
    expect(await env.admin.query(api.social.listingMedia, { id: post.id })).toEqual([
      { kind: "image", url: SHOT, role: "screenshot", width: 1440, height: 900, durationSec: null },
    ]);
    const bare = await env.admin.mutation(api.social.create, { kind: "custom" });
    expect(await env.admin.query(api.social.listingMedia, { id: bare.id })).toEqual([]);
  });
});

describe("editing a post's media with social.update", () => {
  it("replaces, reorders, removes and adds by sending the whole list", async () => {
    const env = await setup();
    const post = await env.admin.mutation(api.social.create, {
      kind: "custom",
      media: [
        { kind: "image", url: FEED_IMG, role: "graphic" },
        { kind: "image", url: SQUARE_IMG, role: "graphic", networks: ["threads"] },
      ],
    });
    const base = post.media.map((m) => m.url);
    const reordered = await env.admin.mutation(api.social.update, { id: post.id, media: [post.media[1], post.media[0]], baseMedia: base });
    expect(reordered.media.map((m) => m.url)).toEqual([SQUARE_IMG, FEED_IMG]);
    expect(reordered.media[0].networks).toEqual(["threads"]);
    expect(reordered.mediaDetails.map((d) => d.url)).toEqual([SQUARE_IMG, FEED_IMG]);

    // An edit made from the old order is refused: the media changed meanwhile.
    await expect(env.admin.mutation(api.social.update, { id: post.id, media: [post.media[0]], baseMedia: base })).rejects.toThrow(/changed since you opened it/);

    const removed = await env.admin.mutation(api.social.update, { id: post.id, media: [reordered.media[1]], baseMedia: [SQUARE_IMG, FEED_IMG] });
    expect(removed.media).toEqual([{ kind: "image", url: FEED_IMG, role: "graphic" }]);
    const added = await env.admin.mutation(api.social.update, { id: post.id, media: [...removed.media, { kind: "image", url: SHOT, role: "screenshot" }] });
    expect(added.media.map((m) => m.url)).toEqual([FEED_IMG, SHOT]);
    expect((await env.admin.mutation(api.social.update, { id: post.id, media: [] })).media).toEqual([]);
  });

  it("refuses items that are not what they say, a network named twice, or a file that failed its check", async () => {
    const env = await setup();
    const post = await env.admin.mutation(api.social.create, { kind: "custom" });
    await expect(env.admin.mutation(api.social.update, { id: post.id, media: [{ kind: "video", url: FEED_IMG }] })).rejects.toThrow(/Item 1 is an image, not a video/);
    await expect(env.admin.mutation(api.social.update, { id: post.id, media: [{ kind: "image", url: FEED_IMG }, { kind: "image", url: LONG_VIDEO }] })).rejects.toThrow(
      /Item 2 is a video, not an image/,
    );
    await expect(env.admin.mutation(api.social.update, { id: post.id, media: [{ kind: "image", url: FEED_IMG, networks: ["threads", "threads"] }] })).rejects.toThrow(
      /names a network twice/,
    );
    await env.t.run(async (ctx) => {
      const row = await ctx.db.query("media").withIndex("by_url", (q) => q.eq("url", SQUARE_IMG)).first();
      await ctx.db.patch(row!._id, { invalid: true });
    });
    await expect(env.admin.mutation(api.social.update, { id: post.id, media: [{ kind: "image", url: SQUARE_IMG }] })).rejects.toThrow(/failed the upload check/);
    // A URL we don't hold is the admin's call (sizes unknown).
    expect((await env.admin.mutation(api.social.update, { id: post.id, media: [{ kind: "image", url: "https://elsewhere.example/a.jpg" }] })).media).toHaveLength(1);
  });

  it("a story is exactly one 9:16 image or a 3-60 s video, checked on every media or placement change", async () => {
    const env = await setup();
    const story = await env.admin.mutation(api.social.create, { kind: "custom", placement: "story" });
    expect(story.media).toEqual([]); // an empty story is still being made
    await expect(env.admin.mutation(api.social.update, { id: story.id, media: [{ kind: "image", url: FEED_IMG }] })).rejects.toThrow(/must be 9:16/);
    await expect(
      env.admin.mutation(api.social.update, { id: story.id, media: [{ kind: "image", url: STORY_IMG }, { kind: "image", url: STORY_IMG }] }),
    ).rejects.toThrow(/exactly one image or video \(this one has 2\)/);
    await expect(env.admin.mutation(api.social.update, { id: story.id, media: [{ kind: "video", url: LONG_VIDEO }] })).rejects.toThrow(/3 to 60 seconds/);
    expect((await env.admin.mutation(api.social.update, { id: story.id, media: [{ kind: "image", url: STORY_IMG }] })).media).toHaveLength(1);

    // Feed → story with feed media is refused; with one 9:16 item it goes through.
    const feed = await env.admin.mutation(api.social.create, { kind: "custom", media: [{ kind: "image", url: FEED_IMG }, { kind: "image", url: SQUARE_IMG }] });
    await expect(env.admin.mutation(api.social.update, { id: feed.id, placement: "story" })).rejects.toThrow(/exactly one image or video/);
    const switched = await env.admin.mutation(api.social.update, { id: feed.id, placement: "story", media: [{ kind: "image", url: STORY_IMG }] });
    expect(switched).toMatchObject({ placement: "story", media: [{ kind: "image", url: STORY_IMG }] });
    // And back to the feed: any media.
    expect((await env.admin.mutation(api.social.update, { id: feed.id, placement: "feed", media: [{ kind: "image", url: FEED_IMG }, { kind: "image", url: SQUARE_IMG }] })).placement).toBe("feed");
  });

  it("changing the graphic of a scheduled or failed post sends it back to waiting; sent posts can't change", async () => {
    vi.useFakeTimers();
    const env = await setup();
    const post = await env.admin.mutation(api.social.create, { kind: "custom", captions: { facebook: "FB" }, media: [{ kind: "image", url: FEED_IMG, role: "graphic" }] });
    const at = Date.now() + 5 * HOUR;
    expect(await env.admin.mutation(api.social.publish, { id: post.id, at })).toMatchObject({ status: "scheduled", scheduledFor: at });
    const job = (await env.t.run((ctx) => ctx.db.get(post.id)))!.publishJobId!;

    const edited = await env.admin.mutation(api.social.update, { id: post.id, media: [{ kind: "image", url: SQUARE_IMG, role: "graphic" }] });
    expect(edited).toMatchObject({ status: "waiting", approvedAt: null, scheduledFor: at, media: [{ url: SQUARE_IMG }] });
    expect((await env.t.run((ctx) => ctx.db.system.get(job)))!.state.kind).toBe("canceled");
    expect((await env.t.run((ctx) => ctx.db.get(post.id)))!.publishJobId).toBeUndefined();

    await env.t.run((ctx) => ctx.db.patch(post.id as Id<"socialPosts">, { status: "failed", error: "Meta said no" }));
    const fixed = await env.admin.mutation(api.social.update, { id: post.id, media: [{ kind: "image", url: FEED_IMG, role: "graphic" }] });
    expect(fixed).toMatchObject({ status: "waiting", error: null });

    await env.t.run((ctx) => ctx.db.patch(post.id as Id<"socialPosts">, { status: "sent" }));
    await expect(env.admin.mutation(api.social.update, { id: post.id, media: [] })).rejects.toThrow(/sent; it can't be changed/);
    await env.t.run((ctx) => ctx.db.patch(post.id as Id<"socialPosts">, { status: "waiting", publishingUntil: Date.now() + 60_000 }));
    await expect(env.admin.mutation(api.social.update, { id: post.id, media: [] })).rejects.toThrow(/being published right now/);
  });

  it("the MCP update_post follows the same media rules", async () => {
    const env = await setup();
    const post = await env.t.mutation(api.mcp.createPost, { token: env.token, kind: "custom", placement: "story" });
    await expect(env.t.mutation(api.mcp.updatePost, { token: env.token, id: post.id, media: [{ kind: "image", url: FEED_IMG }] })).rejects.toThrow(/must be 9:16/);
    await expect(env.t.mutation(api.mcp.updatePost, { token: env.token, id: post.id, media: [{ kind: "video", url: STORY_IMG }] })).rejects.toThrow(/an image, not a video/);
    expect((await env.t.mutation(api.mcp.updatePost, { token: env.token, id: post.id, media: [{ kind: "image", url: STORY_IMG }] })).media).toHaveLength(1);
  });
});
