/// <reference types="vite/client" />
// The Studio's publishing API (Clerk session: social.get/create/update/
// publish/unschedule/channels/recent), story placement (validation and the
// Instagram STORIES / Facebook Page stories flows against a mocked fetch), and
// the MCP additions (publish_post, unschedule_post, list_media, find_reel, and
// the template / palette catalogs).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { mintServiceCredential } from "../convex/lib/tokens";
import { cannotPublish, retryableNetworks, storyProblem, storyVideoProblem } from "../convex/lib/socialApi";
import { publishState } from "../lib/socialPublishState";
import { postActions } from "../lib/studio/queue";
import { folderOf, roleOf } from "../convex/mcp";
import {
  FORMAT_ENUM,
  MEDIA_ROLE_ENUM,
  PALETTE_DESCRIPTION,
  STYLE_DESCRIPTION,
  STYLE_ENUM,
  TEMPLATE_ENUM,
  paletteCatalog,
  styleCatalog,
  templateCatalog,
} from "../lib/mcp/catalog";
import { FORMAT_IDS, STYLES, STYLE_INFO, TEMPLATE_IDS } from "../lib/graphics/spec";
import { MEDIA_ROLES } from "../lib/mediaRoles";
import { PALETTE_IDS } from "../lib/palettes";

const modules = import.meta.glob("../convex/**/*.{ts,js}");

const META = "EAAG-meta-page-token-1234567890";
const THREADS = "THQW-threads-token-1234567890";
const IK = "https://ik.imagekit.io/shemoqmedi";
const R2 = "https://pub-test.r2.dev";
const STORY_IMG = `${IK}/social/graphics/shemoqmedi-award-story.jpg`;
const FEED_IMG = `${IK}/social/graphics/shemoqmedi-award-ig.jpg`;
const REEL = `${R2}/social/site/site-reel-abc123.mp4`;
const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-11-12T08:00:00Z"));
  vi.stubEnv("MCP_SERVICE_SECRET", "test-secret-test-secret-test-secret");
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("SOCIAL_WAIT_SCALE", "0");
  vi.stubEnv("IMAGEKIT_URL_ENDPOINT", IK);
  vi.stubEnv("R2_PUBLIC_URL", R2);
  vi.stubEnv("META_PAGE_ACCESS_TOKEN", META);
  vi.stubEnv("THREADS_ACCESS_TOKEN", THREADS);
  vi.stubEnv("LINKEDIN_ACCESS_TOKEN", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────
// A fake Meta (Facebook Page, Instagram) and Threads
// ─────────────────────────────────────────────────────────────────────────────

type Call = { method: string; url: URL; headers: Headers; form: Record<string, string> };

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function fakeMeta() {
  const calls: Call[] = [];
  let n = 0;
  const state = { videoPolls: 0, uploadingFor: 1 }; // the FB story video reports "in_progress" this many times first

  function route(c: Call): Response {
    const { method, url } = c;
    const path = url.pathname;
    if (url.host === "graph.facebook.com") {
      if (c.headers.get("authorization") !== `Bearer ${META}`) return json({ error: { message: "bad token", code: 190 } }, 401);
      if (method === "GET" && path === "/v26.0/me") return json({ id: "PAGE1", name: "Shemoqmedi" });
      if (method === "GET" && path === "/v26.0/PAGE1") return json({ instagram_business_account: { id: "IG1", username: "shemoqmedi" } });
      if (method === "POST" && path === "/v26.0/PAGE1/photos") return json({ id: `PH${++n}` });
      if (method === "POST" && path === "/v26.0/PAGE1/feed") return json({ id: "PAGE1_F1" });
      if (method === "POST" && path === "/v26.0/PAGE1/photo_stories") return json({ success: true, post_id: "PAGE1_S1" });
      if (method === "POST" && path === "/v26.0/PAGE1/video_stories") {
        if (c.form.upload_phase === "start") return json({ video_id: "VS1", upload_url: "https://rupload.facebook.com/video-upload/v26.0/VS1" });
        return json({ success: true, post_id: "PAGE1_VS1" });
      }
      if (method === "GET" && path === "/v26.0/VS1") {
        state.videoPolls += 1;
        const phase = state.videoPolls <= state.uploadingFor ? "in_progress" : "complete";
        return json({ status: { video_status: "upload_complete", uploading_phase: { status: phase } } });
      }
      if (method === "POST" && path === "/v26.0/IG1/media") return json({ id: `C${++n}` });
      if (method === "GET" && /^\/v26\.0\/C\d+$/.test(path)) return json({ status_code: "FINISHED" });
      if (method === "POST" && path === "/v26.0/IG1/media_publish") return json({ id: "IGS1" });
      if (method === "GET" && path === "/v26.0/IGS1") return json({ permalink: "https://www.instagram.com/stories/shemoqmedi/1/" });
    }
    if (url.host === "rupload.facebook.com" && method === "POST") return json({ success: true });
    if (url.host === "graph.threads.net" && method === "GET" && path === "/v1.0/me") return json({ id: "TH1", username: "shemoqmedi" });
    return new Response(`unexpected ${method} ${url}`, { status: 599 });
  }

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const body = req.method === "POST" ? await req.clone().text() : "";
    const call: Call = { method: req.method, url: new URL(req.url), headers: req.headers, form: Object.fromEntries(new URLSearchParams(body)) };
    calls.push(call);
    for (const token of [META, THREADS]) expect(call.url.href).not.toContain(token);
    return route(call);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, state };
}

type Fake = ReturnType<typeof fakeMeta>;
const find = (fake: Fake, method: string, host: string, path: string) =>
  fake.calls.filter((c) => c.method === method && c.url.host === host && c.url.pathname === path);

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("users", { externalId: "admin", name: "Giorgi Admin", email: "admin@example.com", role: "admin", createdAt: now, updatedAt: now });
    await ctx.db.insert("users", { externalId: "member", name: "Member", email: "member@example.com", createdAt: now, updatedAt: now });
    // Sizes of our renders, as graphics.render registers them.
    const image = { kind: "image" as const, contentType: "image/jpeg", size: 200_000, createdAt: now };
    await ctx.db.insert("media", { ...image, fileId: "ik-story", url: STORY_IMG, filePath: "/social/graphics/shemoqmedi-award-story.jpg", width: 1080, height: 1920 });
    await ctx.db.insert("media", { ...image, fileId: "ik-feed", url: FEED_IMG, filePath: "/social/graphics/shemoqmedi-award-ig.jpg", width: 1080, height: 1350 });
  });
  const admin = t.withIdentity({ subject: "admin" });
  const member = t.withIdentity({ subject: "member" });
  const token = (await mintServiceCredential("admin"))!;
  return { t, admin, member, token };
}
type Env = Awaited<ReturnType<typeof setup>>;

const drain = (env: Env) => env.t.finishAllScheduledFunctions(vi.runAllTimers);
const row = (env: Env, id: Id<"socialPosts">) => env.t.run((ctx) => ctx.db.get(id));

async function listing(env: Env) {
  const coverId = await env.t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/jpeg" })));
  const { id } = await env.admin.mutation(api.admin.createListing, {
    title: "Paper Weather",
    tagline: "A studio site",
    url: "https://paper-weather.example",
    categories: ["portfolio"],
    technologies: [],
    region: "global",
    creatorTier: "agency",
    creditName: "Paper Studio",
    coverId,
    status: "in_voting",
    isClaimed: false,
  });
  return id;
}

const storyImage = { kind: "image" as const, url: STORY_IMG, role: "graphic" };

// ─────────────────────────────────────────────────────────────────────────────
// The Clerk-session API
// ─────────────────────────────────────────────────────────────────────────────

describe("studio publishing API", () => {
  it("is for admins only", async () => {
    const env = await setup();
    const { id } = await env.admin.mutation(api.social.create, { kind: "custom", captions: { facebook: "FB" } });
    for (const caller of [env.member, env.t]) {
      const refused = caller === env.member ? /admin/ : /Unauthenticated/;
      await expect(caller.query(api.social.get, { id })).rejects.toThrow(refused);
      await expect(caller.mutation(api.social.create, { kind: "custom" })).rejects.toThrow(refused);
      await expect(caller.mutation(api.social.update, { id, note: "x" })).rejects.toThrow(refused);
      await expect(caller.mutation(api.social.publish, { id })).rejects.toThrow(refused);
      await expect(caller.mutation(api.social.unschedule, { id })).rejects.toThrow(refused);
      await expect(caller.query(api.social.channels, {})).rejects.toThrow(refused);
      await expect(caller.query(api.social.recent, {})).rejects.toThrow(refused);
    }
    // Nothing changed.
    expect(await env.admin.query(api.social.get, { id })).toMatchObject({ status: "waiting", note: null });
  });

  it("creates a post from a listing, edits it and reads it back", async () => {
    const env = await setup();
    const listingId = await listing(env);
    const created = await env.admin.mutation(api.social.create, { kind: "announcement", listingId, facts: { angle: "studio story" } });
    expect(created).toMatchObject({ kind: "announcement", status: "waiting", placement: "feed", listing: { title: "Paper Weather" } });
    expect(created.facts).toMatchObject({ title: "Paper Weather", angle: "studio story" });
    expect(created.media).toHaveLength(1);
    expect(created.media[0]).toMatchObject({ kind: "image", role: "screenshot" });

    const at = Date.now() + 5 * HOUR;
    const edited = await env.admin.mutation(api.social.update, {
      id: created.id,
      captions: { instagram: "  IG text  ", facebook: "FB text" },
      media: [{ kind: "image", url: FEED_IMG, role: "graphic" }],
      publishAt: at,
      note: "for Friday",
    });
    expect(edited).toMatchObject({ captions: { instagram: "IG text", facebook: "FB text" }, scheduledFor: at, note: "for Friday" });
    expect(edited.media).toEqual([{ kind: "image", url: FEED_IMG, role: "graphic" }]);
    expect(await env.admin.query(api.social.get, { id: created.id })).toEqual(edited);

    // null clears the publish time.
    expect((await env.admin.mutation(api.social.update, { id: created.id, publishAt: null })).scheduledFor).toBeNull();
    await expect(env.admin.mutation(api.social.update, { id: created.id, media: [{ kind: "image", url: "http://insecure.example/a.jpg" }] })).rejects.toThrow(
      /public https URL/,
    );
  });

  it("publishes now, or schedules, unschedules and reschedules", async () => {
    fakeMeta();
    const env = await setup();
    const post = await env.admin.mutation(api.social.create, { kind: "custom", captions: { facebook: "FB text" } });

    // Later: scheduled with a pending job at that time.
    const at = Date.now() + 3 * HOUR;
    const scheduled = await env.admin.mutation(api.social.publish, { id: post.id, at });
    expect(scheduled).toMatchObject({ status: "scheduled", scheduledFor: at });
    const job = (await row(env, post.id))!.publishJobId!;
    expect((await env.t.run((ctx) => ctx.db.system.get(job)))!).toMatchObject({ state: { kind: "pending" }, scheduledTime: at });

    // Unschedule: waiting, the job cancelled, the time kept.
    const back = await env.admin.mutation(api.social.unschedule, { id: post.id });
    expect(back).toMatchObject({ status: "waiting", scheduledFor: at, approvedAt: null });
    expect((await env.t.run((ctx) => ctx.db.system.get(job)))!.state.kind).toBe("canceled");
    await expect(env.admin.mutation(api.social.unschedule, { id: post.id })).rejects.toThrow(/waiting, not scheduled/);

    // Publishing a scheduled post moves it: the old job is cancelled.
    await env.admin.mutation(api.social.publish, { id: post.id, at });
    const first = (await row(env, post.id))!.publishJobId!;
    const later = at + HOUR;
    expect(await env.admin.mutation(api.social.publish, { id: post.id, at: later })).toMatchObject({ status: "scheduled", scheduledFor: later });
    expect((await env.t.run((ctx) => ctx.db.system.get(first)))!.state.kind).toBe("canceled");

    // A past time means now: it is published at once.
    await env.admin.mutation(api.social.unschedule, { id: post.id });
    const now = await env.admin.mutation(api.social.publish, { id: post.id, at: Date.now() - HOUR });
    expect(now).toMatchObject({ status: "scheduled", scheduledFor: null });
    await drain(env);
    const sent = await env.admin.query(api.social.get, { id: post.id });
    expect(sent.status).toBe("sent");
    expect(sent.results).toEqual([expect.objectContaining({ network: "facebook", status: "sent" })]);
    await expect(env.admin.mutation(api.social.publish, { id: post.id })).rejects.toThrow(/sent; it can't be published again/);
  });

  it("refuses to publish a failed post (retry is for that) and a post without captions", async () => {
    const env = await setup();
    const empty = await env.admin.mutation(api.social.create, { kind: "custom" });
    await expect(env.admin.mutation(api.social.publish, { id: empty.id })).rejects.toThrow(/at least one caption/);
    await env.t.run((ctx) => ctx.db.patch(empty.id, { status: "failed", captions: { facebook: "x" } }));
    await expect(env.admin.mutation(api.social.publish, { id: empty.id })).rejects.toThrow(/failed: retry it instead/);
  });

  it("lists channels without tokens, and the latest sent posts by when they went out", async () => {
    const env = await setup();
    await env.t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("socialAccounts", { network: "meta", token: META, seedHash: "h", issuedAt: now, ids: { pageId: "PAGE1", pageName: "Shemoqmedi", igUserId: "IG1", igUsername: "shemoqmedi" }, updatedAt: now });
      const base = { kind: "custom" as const, status: "sent" as const, captions: { facebook: "x" }, media: [] };
      await ctx.db.insert("socialPosts", { ...base, note: "old, sent late", createdAt: now - 10 * HOUR, sentAt: now - HOUR });
      await ctx.db.insert("socialPosts", { ...base, note: "new, sent early", createdAt: now - 5 * HOUR, sentAt: now - 4 * HOUR });
      await ctx.db.insert("socialPosts", { ...base, status: "waiting", note: "not sent", createdAt: now });
    });
    const channels = await env.admin.query(api.social.channels, {});
    expect(channels.map((c) => [c.network, c.connected, c.account])).toEqual([
      ["facebook", true, "Shemoqmedi"],
      ["instagram", true, "@shemoqmedi"],
      ["threads", false, null],
      ["linkedin", false, null],
    ]);
    expect(JSON.stringify(channels)).not.toContain(META);

    const recent = await env.admin.query(api.social.recent, { limit: 5 });
    expect(recent.map((p) => p.note)).toEqual(["old, sent late", "new, sent early"]);
    expect(await env.admin.query(api.social.recent, { limit: 1 })).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Stories
// ─────────────────────────────────────────────────────────────────────────────

describe("story placement", () => {
  it("storyProblem: exactly one item, 9:16 when the size is known", () => {
    expect(storyProblem([])).toMatch(/exactly one image or video \(this one has 0\)/);
    expect(storyProblem([{ kind: "image", url: "a" }, { kind: "image", url: "b" }])).toMatch(/has 2/);
    expect(storyProblem([{ kind: "image", url: "a", width: 1080, height: 1920 }])).toBeNull();
    expect(storyProblem([{ kind: "video", url: "a", width: 720, height: 1282 }])).toBeNull(); // rounding
    expect(storyProblem([{ kind: "image", url: "a", width: 1080, height: 1350 }])).toMatch(/must be 9:16.*1080x1350/);
    expect(storyProblem([{ kind: "video", url: "a" }])).toBeNull(); // unknown size: left to Meta
  });

  it("validates story media on create, edit and publish", async () => {
    const env = await setup();
    const listingId = await listing(env);
    // A story from a listing starts without its screenshots.
    const story = await env.admin.mutation(api.social.create, { kind: "custom", listingId, placement: "story", captions: { instagram: "x" } });
    expect(story).toMatchObject({ placement: "story", media: [] });
    await expect(env.admin.mutation(api.social.publish, { id: story.id })).rejects.toThrow(/exactly one image or video \(this one has 0\)/);

    await expect(env.admin.mutation(api.social.update, { id: story.id, media: [storyImage, storyImage] })).rejects.toThrow(/exactly one/);
    // A known 4:5 render is refused for a story.
    await expect(env.admin.mutation(api.social.update, { id: story.id, media: [{ kind: "image", url: FEED_IMG }] })).rejects.toThrow(/must be 9:16/);
    // Switching a feed post with a 4:5 image to a story is refused too.
    const feed = await env.admin.mutation(api.social.create, { kind: "custom", media: [{ kind: "image", url: FEED_IMG }] });
    await expect(env.admin.mutation(api.social.update, { id: feed.id, placement: "story" })).rejects.toThrow(/must be 9:16/);

    // A story needs an Instagram or Facebook caption to pick its networks.
    await env.admin.mutation(api.social.update, { id: story.id, media: [storyImage], captions: { instagram: "", threads: "Threads text" } });
    await expect(env.admin.mutation(api.social.publish, { id: story.id })).rejects.toThrow(/Instagram and Facebook only/);

    // Back to feed: absent placement reads as feed.
    const backToFeed = await env.admin.mutation(api.social.update, { id: story.id, placement: "feed" });
    expect(backToFeed.placement).toBe("feed");
    expect((await row(env, story.id))!.placement).toBeUndefined();
  });

  it("an image story goes to Instagram (STORIES) and the Facebook Page (photo_stories); Threads is skipped", async () => {
    const fake = fakeMeta();
    const env = await setup();
    const post = await env.admin.mutation(api.social.create, {
      kind: "custom",
      placement: "story",
      media: [storyImage],
      captions: { instagram: "IG", facebook: "FB", threads: "Threads" },
    });
    await env.admin.mutation(api.social.publish, { id: post.id });
    await drain(env);
    const done = await env.admin.query(api.social.get, { id: post.id });
    expect(done.status).toBe("sent");
    const by = Object.fromEntries(done.results.map((r) => [r.network, r]));
    expect(by.instagram).toMatchObject({ status: "sent", remoteId: "IGS1", url: "https://www.instagram.com/stories/shemoqmedi/1/", note: expect.stringMatching(/story/) });
    expect(by.facebook).toMatchObject({ status: "sent", remoteId: "PAGE1_S1", note: expect.stringMatching(/story/) });
    expect(by.threads).toMatchObject({ status: "skipped", error: expect.stringMatching(/Threads has no stories/) });

    // Instagram: one STORIES container with the JPEG, no caption, then media_publish.
    const ig = find(fake, "POST", "graph.facebook.com", "/v26.0/IG1/media");
    expect(ig.map((c) => c.form)).toEqual([{ media_type: "STORIES", image_url: `${STORY_IMG}?tr=f-jpg` }]);
    expect(find(fake, "POST", "graph.facebook.com", "/v26.0/IG1/media_publish")[0].form.creation_id).toMatch(/^C\d+$/);

    // Facebook: an unpublished photo, then photo_stories with its id; no feed post.
    const [photo] = find(fake, "POST", "graph.facebook.com", "/v26.0/PAGE1/photos");
    expect(photo.form).toEqual({ url: `${STORY_IMG}?tr=f-jpg`, published: "false" });
    expect(find(fake, "POST", "graph.facebook.com", "/v26.0/PAGE1/photo_stories")[0].form).toEqual({ photo_id: "PH1" });
    expect(find(fake, "POST", "graph.facebook.com", "/v26.0/PAGE1/feed")).toHaveLength(0);
    // Nothing was sent to Threads beyond the account lookup.
    expect(fake.calls.filter((c) => c.url.host === "graph.threads.net" && c.method === "POST")).toHaveLength(0);
  });

  it("a video story: Instagram video_url, Facebook video_stories start → hosted upload → finish", async () => {
    const fake = fakeMeta();
    const env = await setup();
    const post = await env.admin.mutation(api.social.create, {
      kind: "custom",
      placement: "story",
      media: [{ kind: "video", url: REEL, role: "reel" }],
      captions: { instagram: "IG", facebook: "FB" },
    });
    await env.admin.mutation(api.social.publish, { id: post.id });
    await drain(env);
    expect((await env.admin.query(api.social.get, { id: post.id })).status).toBe("sent");

    expect(find(fake, "POST", "graph.facebook.com", "/v26.0/IG1/media").map((c) => c.form)).toEqual([{ media_type: "STORIES", video_url: REEL }]);

    const phases = find(fake, "POST", "graph.facebook.com", "/v26.0/PAGE1/video_stories").map((c) => c.form);
    expect(phases).toEqual([{ upload_phase: "start" }, { upload_phase: "finish", video_id: "VS1" }]);
    const [upload] = find(fake, "POST", "rupload.facebook.com", "/video-upload/v26.0/VS1");
    expect(upload.headers.get("file_url")).toBe(REEL);
    expect(upload.headers.get("authorization")).toBe(`OAuth ${META}`);
    // Finished only after Meta reported the upload complete.
    expect(fake.state.videoPolls).toBe(2);
    const order = fake.calls.map((c) => `${c.method} ${c.url.host}${c.url.pathname}`);
    expect(order.indexOf("POST rupload.facebook.com/video-upload/v26.0/VS1")).toBeLessThan(order.lastIndexOf("GET graph.facebook.com/v26.0/VS1"));
  });

  it("a story whose media is not for Facebook is skipped there, not failed", async () => {
    const fake = fakeMeta();
    const env = await setup();
    const post = await env.admin.mutation(api.social.create, {
      kind: "custom",
      placement: "story",
      media: [{ ...storyImage, networks: ["instagram"] }],
      captions: { instagram: "IG", facebook: "FB" },
    });
    await env.admin.mutation(api.social.publish, { id: post.id });
    await drain(env);
    const done = await env.admin.query(api.social.get, { id: post.id });
    expect(done.status).toBe("sent");
    const by = Object.fromEntries(done.results.map((r) => [r.network, r]));
    expect(by.instagram).toMatchObject({ status: "sent" });
    expect(by.facebook).toMatchObject({ status: "skipped", error: expect.stringMatching(/not for Facebook/) });
    expect(fake.calls.filter((c) => c.url.pathname.startsWith("/v26.0/PAGE1/") && c.method === "POST")).toHaveLength(0);
  });

  it("a story whose only network has no stories publishes nothing and says why", async () => {
    fakeMeta();
    const env = await setup();
    const post = await env.admin.mutation(api.social.create, { kind: "custom", placement: "story", media: [storyImage], captions: { facebook: "FB", threads: "T" } });
    vi.stubEnv("META_PAGE_ACCESS_TOKEN", ""); // Facebook disconnected
    await env.admin.mutation(api.social.publish, { id: post.id });
    await drain(env);
    const done = (await row(env, post.id))!;
    expect(done.status).toBe("approved");
    // Threads (no stories) is not reported as a missing account.
    expect(done.error).toMatch(/no connected account for Facebook\./);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MCP additions
// ─────────────────────────────────────────────────────────────────────────────

describe("MCP: publish, unschedule, placement", () => {
  it("publish_post and unschedule_post, and placement on create/update", async () => {
    const env = await setup();
    const created = await env.t.mutation(api.mcp.createPost, {
      token: env.token,
      kind: "custom",
      placement: "story",
      media: [storyImage],
      captions: { instagram: "IG" },
    });
    expect(created.placement).toBe("story");
    const at = Date.now() + 2 * HOUR;
    expect(await env.t.mutation(api.mcp.publishPost, { token: env.token, id: created.id, at })).toMatchObject({ status: "scheduled", scheduledFor: at });
    expect(await env.t.mutation(api.mcp.unschedulePost, { token: env.token, id: created.id })).toMatchObject({ status: "waiting" });
    const feed = await env.t.mutation(api.mcp.updatePost, { token: env.token, id: created.id, placement: "feed", media: [{ kind: "image", url: FEED_IMG }] });
    expect(feed.placement).toBe("feed");
    await expect(env.t.mutation(api.mcp.publishPost, { token: "nope", id: created.id })).rejects.toThrow();
  });
});

describe("MCP: media", () => {
  it("roleOf and folderOf read where a file was stored", () => {
    expect(roleOf({ filePath: "/social/graphics/a.jpg", kind: "image" })).toBe("graphic");
    expect(roleOf({ filePath: "/social/carousels/site-x1/a.jpg", kind: "image" })).toBe("carousel");
    expect(roleOf({ filePath: "/social/site/site-reel-abc123.mp4", kind: "video" })).toBe("reel");
    expect(roleOf({ filePath: "/listings/site/cover.webp", kind: "image" })).toBe("screenshot");
    expect(roleOf({ filePath: "/listings/site/preview.mp4", kind: "video" })).toBe("preview");
    expect(roleOf({ filePath: "/elsewhere/x.png", kind: "image" })).toBe("other");
    expect(folderOf("/social/graphics/a.jpg")).toBe("/social/graphics");
    expect(folderOf("a.jpg")).toBe("/");
  });

  it("list_media filters by kind, role and folder, newest first, without invalid files", async () => {
    const env = await setup();
    await env.t.run(async (ctx) => {
      const base = { contentType: "image/jpeg", size: 1000 };
      vi.setSystemTime(Date.now() + 1000);
      await ctx.db.insert("media", { ...base, kind: "image", fileId: "c1", url: `${IK}/social/carousels/site-x/1.jpg`, filePath: "/social/carousels/site-x/1.jpg", createdAt: Date.now() });
      await ctx.db.insert("media", { ...base, kind: "image", fileId: "s1", url: `${IK}/listings/site/cover.webp`, filePath: "/listings/site/cover.webp", createdAt: Date.now() });
      await ctx.db.insert("media", { ...base, kind: "image", fileId: "bad", url: `${IK}/social/graphics/bad.jpg`, filePath: "/social/graphics/bad.jpg", invalid: true, createdAt: Date.now() });
      await ctx.db.insert("media", {
        store: "r2",
        kind: "video",
        contentType: "video/mp4",
        size: 5_000_000,
        width: 1080,
        height: 1920,
        fileId: "social/site/site-reel-abc123.mp4",
        url: "https://old-bucket.example/social/site/site-reel-abc123.mp4",
        filePath: "/social/site/site-reel-abc123.mp4",
        createdAt: Date.now(),
      });
    });
    const all = await env.t.query(api.mcp.listMedia, { token: env.token });
    expect(all.map((m) => m.role)).toEqual(["reel", "screenshot", "carousel", "graphic", "graphic"]);
    expect(all[0]).toMatchObject({ kind: "video", url: REEL, folder: "/social/site", size: 5_000_000, width: 1080, height: 1920 }); // R2 rows follow R2_PUBLIC_URL

    const graphics = await env.t.query(api.mcp.listMedia, { token: env.token, role: "graphic" });
    expect(graphics.map((m) => m.url).sort()).toEqual([FEED_IMG, STORY_IMG].sort());
    expect((await env.t.query(api.mcp.listMedia, { token: env.token, kind: "video" })).map((m) => m.role)).toEqual(["reel"]);
    expect((await env.t.query(api.mcp.listMedia, { token: env.token, folder: "social/graphics/" })).map((m) => m.role)).toEqual(["graphic", "graphic"]);
    expect((await env.t.query(api.mcp.listMedia, { token: env.token, folder: "/social" })).length).toBe(4);
    expect(await env.t.query(api.mcp.listMedia, { token: env.token, limit: 1 })).toHaveLength(1);
    await expect(env.t.query(api.mcp.listMedia, { token: "nope" })).rejects.toThrow();
  });

  it("find_reel returns a listing's newest valid reel", async () => {
    const env = await setup();
    const listingId = await listing(env);
    const slug = (await env.t.run((ctx) => ctx.db.get(listingId)))!.slug;
    expect(await env.t.query(api.mcp.findReel, { token: env.token, listingSlug: slug })).toBeNull();
    await env.t.run(async (ctx) => {
      const reel = (key: string, createdAt: number, invalid?: boolean) =>
        ctx.db.insert("media", {
          store: "r2",
          kind: "video",
          contentType: "video/mp4",
          size: 1000,
          fileId: key,
          url: `${R2}/${key}`,
          filePath: `/${key}`,
          createdAt,
          ...(invalid ? { invalid } : {}),
        });
      const now = Date.now();
      await reel(`social/${slug}/${slug}-reel-old0000001.mp4`, now - 2 * HOUR);
      await reel(`social/${slug}/${slug}-reel-new0000002.mp4`, now - HOUR);
      await reel(`social/${slug}/${slug}-reel-broken0003.mp4`, now, true);
      await reel(`social/${slug}-other/${slug}-other-reel-x000000004.mp4`, now); // another listing
      await reel(`social/${slug}/${slug}-voiceover-a000000005.mp4`, now); // not a reel
    });
    const found = await env.t.query(api.mcp.findReel, { token: env.token, listingSlug: slug });
    expect(found).toMatchObject({ role: "reel", url: `${R2}/social/${slug}/${slug}-reel-new0000002.mp4` });
    await expect(env.t.query(api.mcp.findReel, { token: env.token, listingSlug: "missing" })).rejects.toThrow(/No listing/);
  });

  it("find_reel finds a reel of a listing whose slug is longer than a reel folder", async () => {
    const env = await setup();
    const listingId = await listing(env);
    const long = `${"long-slug-".repeat(7)}end`; // 73 characters; reel keys keep the first 60
    await env.t.run(async (ctx) => {
      await ctx.db.patch(listingId, { slug: long });
      const key = `social/${long.slice(0, 60)}/${long.slice(0, 60)}-reel-abcdef1234.mp4`;
      await ctx.db.insert("media", { store: "r2", kind: "video", contentType: "video/mp4", size: 1000, fileId: key, url: `${R2}/${key}`, filePath: `/${key}`, createdAt: Date.now() });
    });
    const found = await env.t.query(api.mcp.findReel, { token: env.token, listingSlug: long });
    expect(found).toMatchObject({ role: "reel", url: expect.stringContaining("-reel-abcdef1234.mp4") });
  });
});

describe("MCP: catalogs", () => {
  it("templates and formats come from the spec", () => {
    const { templates, formats } = templateCatalog();
    expect(templates.map((t) => t.id)).toEqual(TEMPLATE_IDS);
    expect(formats.map((f) => f.id)).toEqual(FORMAT_IDS);
    expect(TEMPLATE_ENUM).toEqual(TEMPLATE_IDS);
    expect(FORMAT_ENUM).toEqual(FORMAT_IDS);
    const award = templates.find((t) => t.id === "award")!;
    expect(award.images).toEqual(["screenshot", "badge"]);
    expect(award.fields.find((f) => f.key === "tier")).toMatchObject({ options: expect.arrayContaining(["SOTD"]) });
    expect(Object.fromEntries(formats.map((f) => [f.id, f.instagram]))).toEqual({
      ig_portrait: "feed",
      square: "feed",
      story: "story",
      reel_cover: "story",
      link: "padded",
    });
  });

  it("palettes and their description come from PALETTE_IDS", () => {
    expect(paletteCatalog().palettes.map((p) => p.id)).toEqual(PALETTE_IDS);
    for (const id of PALETTE_IDS) expect(PALETTE_DESCRIPTION).toContain(id);
    expect(PALETTE_DESCRIPTION).toContain('"auto"');
  });

  it("styles and their description come from STYLES", () => {
    const { styles, default: fallback } = styleCatalog();
    expect(styles.map((s) => s.id)).toEqual([...STYLES]);
    expect(STYLE_ENUM).toEqual([...STYLES]);
    for (const s of styles) expect(s).toMatchObject({ label: STYLE_INFO[s.id].label, description: STYLE_INFO[s.id].description });
    expect(styles.find((s) => s.id === "glass")!.speed).toMatch(/slower/);
    expect(styles.filter((s) => s.id !== "glass").every((s) => s.speed.startsWith("fast"))).toBe(true);
    expect(fallback).toBe("glass");
    for (const id of STYLES) expect(STYLE_DESCRIPTION).toContain(id);
  });

  it("the media roles are one list for list_media's schema and roleOf", () => {
    expect(MEDIA_ROLE_ENUM).toEqual([...MEDIA_ROLES]);
    for (const path of ["/social/graphics/a.jpg", "/social/carousels/x/a.jpg", "/listings/s/a.webp", "/x/y.png"]) {
      expect(MEDIA_ROLES).toContain(roleOf({ filePath: path, kind: "image" }));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Review fixes: stories that can't be retried, story video length
// ─────────────────────────────────────────────────────────────────────────────

/** Pushes scheduled so far (push.notifyAdmins jobs), with their titles. */
const pushes = (env: Env) =>
  env.t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect())
      .filter((j) => j.name.includes("notifyAdmins"))
      .map((j) => (j.args[0] as { title: string }).title),
  );

describe("a sent story is not retried for networks it can never reach", () => {
  it("Threads and LinkedIn captions on a story: no Retry, no second push, sentAt kept", async () => {
    fakeMeta();
    const env = await setup();
    // Over MCP, all four captions on a story are accepted (the caption only picks the network).
    const post = await env.t.mutation(api.mcp.createPost, {
      token: env.token,
      kind: "custom",
      placement: "story",
      media: [storyImage],
      captions: { instagram: "IG", facebook: "FB", threads: "Threads", linkedin: "LinkedIn" },
    });
    await env.admin.mutation(api.social.publish, { id: post.id });
    await drain(env);
    const sent = (await row(env, post.id))!;
    expect(sent.status).toBe("sent");
    expect(sent.results!.filter((r) => r.status === "skipped").map((r) => r.network).sort()).toEqual(["linkedin", "threads"]);
    expect(await pushes(env)).toEqual(["Published: Story"]);

    // The server refuses the retry, and the Studio shows no Retry button.
    await expect(env.admin.mutation(api.social.retry, { id: post.id })).rejects.toThrow(/can go to is already sent/);
    await expect(env.t.mutation(api.mcp.retryPost, { token: env.token, id: post.id })).rejects.toThrow(/can go to is already sent/);
    const view = await env.admin.query(api.social.get, { id: post.id });
    expect(publishState(view, Date.now()).canRetry).toBe(false);
    expect(postActions(view, Date.now()).retry).toBe(false);

    // A run that tries nothing new (an old job, say) keeps sentAt and pushes nothing.
    vi.setSystemTime(Date.now() + HOUR);
    expect(await env.t.mutation(internal.publish.finish, { postId: post.id, attempted: 0 })).toBe("sent");
    expect((await row(env, post.id))!.sentAt).toBe(sent.sentAt);
    expect(await pushes(env)).toEqual(["Published: Story"]);
  });

  it("Facebook with no media for it on a story is not retried either; a network without an account still is", async () => {
    fakeMeta();
    const env = await setup();
    const post = await env.admin.mutation(api.social.create, {
      kind: "custom",
      placement: "story",
      media: [{ ...storyImage, networks: ["instagram"] }],
      captions: { instagram: "IG", facebook: "FB" },
    });
    await env.admin.mutation(api.social.publish, { id: post.id });
    await drain(env);
    const view = await env.admin.query(api.social.get, { id: post.id });
    expect(view.status).toBe("sent");
    expect(publishState(view, Date.now()).canRetry).toBe(false);
    await expect(env.admin.mutation(api.social.retry, { id: post.id })).rejects.toThrow(/can go to is already sent/);

    // The rule itself: what a story never reaches, and what a feed post can still get.
    const media = [{ networks: ["instagram" as const] }];
    expect(cannotPublish("threads", "story", media)).toBe(true);
    expect(cannotPublish("facebook", "story", media)).toBe(true);
    expect(cannotPublish("instagram", "story", media)).toBe(false);
    expect(cannotPublish("threads", "feed", [])).toBe(false); // a text post
    expect(cannotPublish("instagram", "feed", [])).toBe(true);
    expect(cannotPublish("facebook", "story", undefined)).toBe(false); // media not known: only the stories rule
    // A feed post's Threads that was skipped for want of an account is still retried.
    expect(
      retryableNetworks({
        captions: { facebook: "a", threads: "b" },
        placement: "feed",
        media: [],
        results: [
          { network: "facebook", status: "sent" },
          { network: "threads", status: "skipped" },
        ],
      }),
    ).toEqual(["threads"]);
  });
});

describe("story video length", () => {
  it("storyVideoProblem and storyProblem: 3 to 60 seconds, unknown left to Meta", () => {
    expect(storyVideoProblem(60.4, "this reel")).toMatch(/3 to 60 seconds.*this reel is 60\.4 s.*shorter/);
    expect(storyVideoProblem(2, "this reel")).toMatch(/is 2\.0 s.*longer/);
    for (const ok of [3, 30, 59.8, 60, undefined, null, Number.NaN]) expect(storyVideoProblem(ok)).toBeNull();
    expect(storyProblem([{ kind: "video", url: REEL, width: 1080, height: 1920, durationSec: 61 }])).toMatch(/3 to 60 seconds/);
    expect(storyProblem([{ kind: "video", url: REEL, width: 1080, height: 1920, durationSec: 45 }])).toBeNull();
    // An image has no length.
    expect(storyProblem([{ kind: "image", url: STORY_IMG, width: 1080, height: 1920, durationSec: 99 }])).toBeNull();
  });

  it("a registered reel keeps its length, and a story over 60 s is refused on edit and approval (also over MCP)", async () => {
    const env = await setup();
    const listingId = await listing(env);
    const slug = (await env.t.run((ctx) => ctx.db.get(listingId)))!.slug;
    const key = `social/${slug}/${slug}-reel-long000001.mp4`;
    const { mediaId, url } = await env.admin.mutation(api.voiceover.registerReel, { key, size: 2_000_000, width: 1080, height: 1920, durationSec: 60.437 });
    expect((await env.t.run((ctx) => ctx.db.get(mediaId)))!.durationSec).toBe(60.44);
    const long = { kind: "video" as const, url, role: "reel" };

    // The Studio (Reels → Post as story) and MCP both go through editPost.
    await expect(env.admin.mutation(api.social.create, { kind: "custom", placement: "story", media: [long], captions: { instagram: "IG" } })).rejects.toThrow(
      /3 to 60 seconds.*60\.4 s/,
    );
    const story = await env.t.mutation(api.mcp.createPost, { token: env.token, kind: "custom", placement: "story", captions: { instagram: "IG" } });
    await expect(env.t.mutation(api.mcp.updatePost, { token: env.token, id: story.id, media: [long] })).rejects.toThrow(/3 to 60 seconds/);
    // A feed reel of that length is fine, but it can't become a story.
    const feed = await env.admin.mutation(api.social.create, { kind: "custom", media: [long], captions: { instagram: "IG" } });
    expect(feed.media).toHaveLength(1);
    await expect(env.admin.mutation(api.social.update, { id: feed.id, placement: "story" })).rejects.toThrow(/3 to 60 seconds/);
    // Approval checks it too (a story whose media row learned its length later).
    await env.t.run((ctx) => ctx.db.patch(story.id, { media: [long] }));
    await expect(env.admin.mutation(api.social.publish, { id: story.id })).rejects.toThrow(/3 to 60 seconds/);

    // A 45-second reel makes a story.
    const short = await env.admin.mutation(api.voiceover.registerReel, { key: `social/${slug}/${slug}-reel-short00002.mp4`, size: 1_000_000, width: 1080, height: 1920, durationSec: 45 });
    const ok = await env.admin.mutation(api.social.create, { kind: "custom", placement: "story", media: [{ kind: "video", url: short.url }], captions: { instagram: "IG" } });
    expect(ok.placement).toBe("story");
    // Nonsense lengths aren't stored.
    const odd = await env.admin.mutation(api.voiceover.registerReel, { key: `social/${slug}/${slug}-reel-odd0000003.mp4`, size: 10, durationSec: -4 });
    expect((await env.t.run((ctx) => ctx.db.get(odd.mediaId)))!.durationSec).toBeUndefined();
  });

  it("registerVideo keeps a preview video's length", async () => {
    const env = await setup();
    const key = "listings/paper-weather/paper-weather-website-preview-abc1234567.mp4";
    const id = await env.admin.mutation(api.media.registerVideo, { key, contentType: "video/mp4", size: 1000, width: 720, height: 1280, durationSec: 58.2 });
    expect((await env.t.run((ctx) => ctx.db.get(id)))!.durationSec).toBe(58.2);
  });
});
