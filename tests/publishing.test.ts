/// <reference types="vite/client" />
// Publishing: accounts seeded from env, the four networks' flows (fetch is
// mocked by a router that checks method, URL, headers and body), partial
// failure and retry, scheduling and cancelling, the Threads refresh window,
// LinkedIn expiry emails, and that no token ever leaves Convex.
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { mintServiceCredential } from "../convex/lib/tokens";
import { escapeLittle, instagramImageUrl, jpegUrl, publishFacebook, publishThreads, sha256Hex, threadsLength } from "../convex/lib/socialApi";
import { publishState } from "../lib/socialPublishState";
import { postActions } from "../lib/studio/queue";
import { mapLimit } from "../convex/graphics";
import { threadsRefreshDue } from "../convex/channels";
import * as channelsModule from "../convex/channels";
import * as publishModule from "../convex/publish";

const modules = import.meta.glob("../convex/**/*.{ts,js}");

const META = "EAAG-meta-page-token-1234567890";
const THREADS = "THQW-threads-token-1234567890";
const THREADS_NEW = "THQW-threads-refreshed-0987654321";
const LINKEDIN = "AQV-linkedin-token-1234567890";
const TOKENS = [META, THREADS, THREADS_NEW, LINKEDIN];
const DAY = 24 * 60 * 60 * 1000;
const IK = "https://ik.imagekit.io/shemoqmedi";
const SHOT = (n: number) => `${IK}/listings/site/shot-${n}.webp`;
const REEL = "https://pub-test.r2.dev/social/site/site-reel-1.mp4";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-11-12T08:00:00Z"));
  vi.stubEnv("MCP_SERVICE_SECRET", "test-secret-test-secret-test-secret");
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("SOCIAL_WAIT_SCALE", "0");
  vi.stubEnv("IMAGEKIT_URL_ENDPOINT", IK);
  vi.stubEnv("META_PAGE_ACCESS_TOKEN", META);
  vi.stubEnv("THREADS_ACCESS_TOKEN", THREADS);
  vi.stubEnv("LINKEDIN_ACCESS_TOKEN", LINKEDIN);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────
// The fake networks
// ─────────────────────────────────────────────────────────────────────────────

type Call = { method: string; url: URL; auth: string | null; headers: Headers; body: string; size: number };
type Override = (call: Call) => Response | null;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
const graphError = (message: string, code = 100, status = 400) => json({ error: { message, type: "OAuthException", code } }, status);

function fakeNetworks() {
  const calls: Call[] = [];
  const overrides: Override[] = [];
  let n = 0;
  const next = () => ++n;
  const igPolls = new Map<string, number>();
  const state = { igInProgress: 0 }; // how many IN_PROGRESS answers each IG container gives first

  function route(c: Call): Response {
    const { method, url } = c;
    const path = url.pathname;
    const bearer = (token: string) => c.auth === `Bearer ${token}`;

    // Meta Graph API
    if (url.host === "graph.facebook.com") {
      if (!bearer(META)) return graphError("Invalid OAuth access token.", 190, 401);
      if (method === "GET" && path === "/v26.0/me") {
        expect(url.searchParams.get("fields")).toBe("id,name");
        return json({ id: "PAGE1", name: "Shemoqmedi" });
      }
      if (method === "GET" && path === "/v26.0/PAGE1") {
        expect(url.searchParams.get("fields")).toBe("instagram_business_account{id,username}");
        return json({ id: "PAGE1", instagram_business_account: { id: "IG1", username: "shemoqmedi" } });
      }
      if (method === "POST" && path === "/v26.0/PAGE1/photos") {
        const id = next();
        return json({ id: `PH${id}`, post_id: `PAGE1_P${id}` });
      }
      if (method === "POST" && path === "/v26.0/PAGE1/feed") return json({ id: `PAGE1_F${next()}` });
      if (method === "POST" && path === "/v26.0/PAGE1/videos") return json({ id: `V${next()}` });
      if (method === "POST" && path === "/v26.0/IG1/media") return json({ id: `C${next()}` });
      if (method === "POST" && path === "/v26.0/IG1/media_publish") return json({ id: "IGM1" });
      if (method === "GET" && path === "/v26.0/IGM1") return json({ permalink: "https://www.instagram.com/p/abc/" });
      const container = /^\/v26\.0\/(C\d+)$/.exec(path);
      if (method === "GET" && container) {
        expect(url.searchParams.get("fields")).toBe("status_code,status");
        const polls = (igPolls.get(container[1]) ?? 0) + 1;
        igPolls.set(container[1], polls);
        return json({ status_code: polls <= state.igInProgress ? "IN_PROGRESS" : "FINISHED" });
      }
    }

    // Threads
    if (url.host === "graph.threads.net") {
      if (method === "GET" && path === "/refresh_access_token") {
        expect(bearer(THREADS) || bearer(THREADS_NEW)).toBe(true);
        expect(url.searchParams.get("grant_type")).toBe("th_refresh_token");
        return json({ access_token: THREADS_NEW, token_type: "bearer", expires_in: 5_184_000 });
      }
      if (!bearer(THREADS) && !bearer(THREADS_NEW)) return graphError("Invalid OAuth access token.", 190, 401);
      if (method === "GET" && path === "/v1.0/me") return json({ id: "TH1", username: "shemoqmedi" });
      if (method === "POST" && path === "/v1.0/TH1/threads") return json({ id: `TC${next()}` });
      if (method === "POST" && path === "/v1.0/TH1/threads_publish") return json({ id: "THP1" });
      if (method === "GET" && path === "/v1.0/THP1") return json({ permalink: "https://www.threads.com/@shemoqmedi/post/xyz" });
      if (method === "GET" && /^\/v1\.0\/TC\d+$/.test(path)) {
        expect(url.searchParams.get("fields")).toBe("status,error_message");
        return json({ status: "FINISHED" });
      }
    }

    // LinkedIn
    if (url.host === "api.linkedin.com") {
      if (!bearer(LINKEDIN)) return json({ message: "Invalid access token", status: 401 }, 401);
      if (method === "GET" && path === "/v2/userinfo") return json({ sub: "abc123", name: "Giorgi Khvichia" });
      expect(c.headers.get("linkedin-version")).toBe("202610");
      expect(c.headers.get("x-restli-protocol-version")).toBe("2.0.0");
      if (method === "POST" && path === "/rest/images" && url.searchParams.get("action") === "initializeUpload") {
        expect(JSON.parse(c.body)).toEqual({ initializeUploadRequest: { owner: "urn:li:person:abc123" } });
        const id = next();
        return json({ value: { uploadUrl: `https://www.linkedin.com/dms-uploads/u${id}`, image: `urn:li:image:I${id}`, uploadUrlExpiresAt: 0 } });
      }
      if (method === "POST" && path === "/rest/posts") return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:7001" } });
    }
    if (url.host === "www.linkedin.com" && method === "PUT" && path.startsWith("/dms-uploads/")) {
      expect(bearer(LINKEDIN)).toBe(true);
      expect(c.size).toBeGreaterThan(0);
      return new Response(null, { status: 201 });
    }

    // Screenshots on ImageKit: WebP unless the f-jpg transform asks for JPEG.
    if (url.host === "ik.imagekit.io" && method === "GET") {
      const jpeg = (url.searchParams.get("tr") ?? "").includes("f-jpg");
      return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-type": jpeg ? "image/jpeg" : "image/webp" } });
    }

    // Resend
    if (url.host === "api.resend.com" && method === "POST" && path === "/emails") return json({ id: `email${next()}` });

    return new Response(`unexpected ${method} ${url}`, { status: 599 });
  }

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    const buf = req.method === "GET" || req.method === "HEAD" ? new ArrayBuffer(0) : await req.clone().arrayBuffer();
    const call: Call = {
      method: req.method,
      url,
      auth: req.headers.get("authorization"),
      headers: req.headers,
      body: req.method === "PUT" ? "" : new TextDecoder().decode(buf),
      size: buf.byteLength,
    };
    calls.push(call);
    // A token never travels in a URL.
    for (const t of TOKENS) expect(url.href).not.toContain(t);
    for (const o of overrides) {
      const res = o(call);
      if (res) return res;
    }
    return route(call);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, overrides, state };
}

type Fake = ReturnType<typeof fakeNetworks>;
const form = (c: Call) => Object.fromEntries(new URLSearchParams(c.body));
const find = (fake: Fake, method: string, host: string, path: string | RegExp) =>
  fake.calls.filter((c) => c.method === method && c.url.host === host && (typeof path === "string" ? c.url.pathname === path : path.test(c.url.pathname)));
const platformCalls = (fake: Fake) => fake.calls.filter((c) => !["ik.imagekit.io", "api.resend.com"].includes(c.url.host));

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("users", { externalId: "admin", name: "Giorgi Admin", email: "admin@example.com", role: "admin", createdAt: now, updatedAt: now });
  });
  const admin = t.withIdentity({ subject: "admin" });
  const token = (await mintServiceCredential("admin"))!;
  return { t, admin, token };
}
type Env = Awaited<ReturnType<typeof setup>>;

const FACTS = { title: "Paper Weather", tagline: "A studio site", pageUrl: "https://shemoqmedi.space/sites/paper-weather", screenshots: [SHOT(9)] };
const ALL = { facebook: "FB caption", instagram: "IG caption", threads: "Threads caption #webdesign", linkedin: "LinkedIn (caption) by @giorgi #webdesign" };

type Media = { kind: "image" | "video"; url: string; role?: string; networks?: ("facebook" | "instagram" | "threads" | "linkedin")[] };

async function newPost(env: Env, captions: Partial<typeof ALL>, media: Media[], facts: Record<string, unknown> = FACTS) {
  const view = await env.t.mutation(api.mcp.createPost, { token: env.token, kind: "custom", facts, captions, media });
  return view.id;
}
const getPost = (env: Env, id: Id<"socialPosts">) => env.t.run((ctx) => ctx.db.get(id));
const drain = (env: Env) => env.t.finishAllScheduledFunctions(vi.runAllTimers);

async function publishNow(env: Env, id: Id<"socialPosts">) {
  const approved = await env.t.mutation(api.mcp.approvePost, { token: env.token, id });
  expect(approved.status).toBe("scheduled");
  await drain(env);
  return (await getPost(env, id))!;
}

const result = <R extends { network: string }>(post: { results?: R[] }, network: string) => post.results?.find((r) => r.network === network);

// ─────────────────────────────────────────────────────────────────────────────
// Accounts
// ─────────────────────────────────────────────────────────────────────────────

describe("accounts", () => {
  it("seeds from env, looks up ids, and only looks again when a token changes", async () => {
    const fake = fakeNetworks();
    const env = await setup();
    expect(await env.t.action(internal.channels.sync, {})).toEqual({ changed: ["meta", "threads", "linkedin"], removed: [] });
    const rows = await env.t.run((ctx) => ctx.db.query("socialAccounts").collect());
    const by = Object.fromEntries(rows.map((r) => [r.network, r]));
    expect(by.meta).toMatchObject({ token: META, seedHash: await sha256Hex(META), ids: { pageId: "PAGE1", pageName: "Shemoqmedi", igUserId: "IG1", igUsername: "shemoqmedi" } });
    expect(by.meta.expiresAt).toBeUndefined();
    expect(by.threads).toMatchObject({ token: THREADS, ids: { threadsUserId: "TH1", threadsUsername: "shemoqmedi" } });
    expect(by.linkedin).toMatchObject({ ids: { personUrn: "urn:li:person:abc123", name: "Giorgi Khvichia" }, expiresAt: Date.now() + 60 * DAY });
    expect(find(fake, "GET", "graph.facebook.com", "/v26.0/me")[0].auth).toBe(`Bearer ${META}`);
    expect(find(fake, "GET", "api.linkedin.com", "/v2/userinfo")[0].auth).toBe(`Bearer ${LINKEDIN}`);

    // Same env: no calls.
    const before = fake.calls.length;
    expect(await env.t.action(internal.channels.sync, {})).toEqual({ changed: [], removed: [] });
    expect(fake.calls.length).toBe(before);

    // A new LinkedIn token replaces the row; an unset Threads token disconnects it.
    vi.stubEnv("LINKEDIN_ACCESS_TOKEN", `${LINKEDIN}`); // same value: nothing
    vi.stubEnv("THREADS_ACCESS_TOKEN", "");
    expect(await env.t.action(internal.channels.sync, {})).toEqual({ changed: [], removed: ["threads"] });
    expect(await env.t.run((ctx) => ctx.db.query("socialAccounts").collect())).toHaveLength(2);
  });

  it("keeps a failed lookup's error (without the token) and tries again on the next sync", async () => {
    const fake = fakeNetworks();
    fake.overrides.push((c) =>
      c.url.host === "graph.threads.net" && c.url.pathname === "/v1.0/me" ? graphError(`Token ${THREADS} has expired.`, 190, 400) : null,
    );
    const env = await setup();
    await env.t.action(internal.channels.sync, {});
    const row = (await env.t.run((ctx) => ctx.db.query("socialAccounts").collect())).find((r) => r.network === "threads")!;
    expect(row.seedHash).toBe("");
    expect(row.lastError).toMatch(/Account lookup failed: Token \[token\] has expired\. \(code 190\)/);
    expect(row.lastError).not.toContain(THREADS);
    const channels = await env.t.action(api.mcp.listChannels, { token: env.token });
    expect(channels.find((c) => c.network === "threads")).toMatchObject({ connected: false, lastError: row.lastError });
    expect(find(fake, "GET", "graph.threads.net", "/v1.0/me")).toHaveLength(2); // looked again
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Network flows
// ─────────────────────────────────────────────────────────────────────────────

describe("publishing", () => {
  it("a carousel goes to every network in one approval", async () => {
    const fake = fakeNetworks();
    const env = await setup();
    const id = await newPost(env, ALL, [1, 2, 3].map((i) => ({ kind: "image", url: SHOT(i), role: "carousel" })));
    const post = await publishNow(env, id);
    expect(post.status).toBe("sent");
    expect(post.sentAt).toBeGreaterThanOrEqual(post.approvedAt!);
    expect(post.results?.map((r) => [r.network, r.status]).sort()).toEqual([
      ["facebook", "sent"],
      ["instagram", "sent"],
      ["linkedin", "sent"],
      ["threads", "sent"],
    ]);
    expect(result(post, "instagram")).toMatchObject({ remoteId: "IGM1", url: "https://www.instagram.com/p/abc/" });
    expect(result(post, "linkedin")).toMatchObject({ remoteId: "urn:li:share:7001", url: "https://www.linkedin.com/feed/update/urn:li:share:7001/" });
    expect(result(post, "threads")).toMatchObject({ url: "https://www.threads.com/@shemoqmedi/post/xyz" });

    // Facebook: unpublished photos, then one feed post with attached_media.
    const photos = find(fake, "POST", "graph.facebook.com", "/v26.0/PAGE1/photos");
    expect(photos.map(form)).toEqual([1, 2, 3].map((i) => ({ url: `${SHOT(i)}?tr=f-jpg`, published: "false" })));
    const [feed] = find(fake, "POST", "graph.facebook.com", "/v26.0/PAGE1/feed");
    const ids = photos.map((_, i) => JSON.parse(form(feed)[`attached_media[${i}]`]).media_fbid);
    expect(ids).toHaveLength(3);
    expect(form(feed).message).toBe("FB caption");
    expect(result(post, "facebook")).toMatchObject({ remoteId: expect.stringMatching(/^PAGE1_F\d+$/), url: expect.stringMatching(/^https:\/\/www\.facebook\.com\/PAGE1_F\d+$/) });

    // Instagram: children, a CAROUSEL container, media_publish.
    const ig = find(fake, "POST", "graph.facebook.com", "/v26.0/IG1/media").map(form);
    expect(ig.slice(0, 3)).toEqual([1, 2, 3].map((i) => ({ image_url: `${SHOT(i)}?tr=f-jpg`, is_carousel_item: "true" })));
    expect(ig[3]).toMatchObject({ media_type: "CAROUSEL", caption: "IG caption" });
    expect(ig[3].children.split(",")).toHaveLength(3);
    expect(form(find(fake, "POST", "graph.facebook.com", "/v26.0/IG1/media_publish")[0]).creation_id).toMatch(/^C\d+$/);

    // Threads: children, CAROUSEL with the text, threads_publish.
    const th = find(fake, "POST", "graph.threads.net", "/v1.0/TH1/threads").map(form);
    expect(th.slice(0, 3).every((f) => f.media_type === "IMAGE" && f.is_carousel_item === "true" && f.image_url.endsWith("?tr=f-jpg"))).toBe(true);
    expect(th[3]).toMatchObject({ media_type: "CAROUSEL", text: "Threads caption #webdesign" });
    expect(find(fake, "POST", "graph.threads.net", "/v1.0/TH1/threads_publish")).toHaveLength(1);

    // LinkedIn: three uploads (JPEG bytes), one multiImage post, escaped commentary.
    expect(find(fake, "PUT", "www.linkedin.com", /^\/dms-uploads\//)).toHaveLength(3);
    const [li] = find(fake, "POST", "api.linkedin.com", "/rest/posts");
    expect(JSON.parse(li.body)).toEqual({
      author: "urn:li:person:abc123",
      commentary: "LinkedIn \\(caption\\) by \\@giorgi #webdesign",
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { multiImage: { images: expect.arrayContaining([{ id: expect.stringMatching(/^urn:li:image:I\d+$/) }]) } },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    });
    expect(JSON.parse(li.body).content.multiImage.images).toHaveLength(3);
    // The images LinkedIn got were the JPEG renditions.
    expect(find(fake, "GET", "ik.imagekit.io", /./).every((c) => c.url.searchParams.get("tr") === "f-jpg")).toBe(true);
  });

  it("one image, and per-network media (the hook slide for Threads)", async () => {
    const fake = fakeNetworks();
    const env = await setup();
    const id = await newPost(env, ALL, [
      { kind: "image", url: SHOT(1), networks: ["facebook", "instagram", "linkedin"] },
      { kind: "image", url: SHOT(2), networks: ["facebook", "instagram", "linkedin"] },
      { kind: "image", url: SHOT(1), networks: ["threads"] },
    ]);
    await env.t.mutation(api.mcp.updatePost, { token: env.token, id, media: [{ kind: "image", url: SHOT(1) }] });
    expect(await publishNow(env, id)).toMatchObject({ status: "sent" });
    // Page Photos: the text goes in `caption` (`message` is deprecated on /photos).
    expect(form(find(fake, "POST", "graph.facebook.com", "/v26.0/PAGE1/photos")[0])).toEqual({ url: `${SHOT(1)}?tr=f-jpg`, caption: "FB caption" });
    expect(find(fake, "POST", "graph.facebook.com", "/v26.0/PAGE1/feed")).toHaveLength(0);
    expect(form(find(fake, "POST", "graph.facebook.com", "/v26.0/IG1/media")[0])).toEqual({ image_url: `${SHOT(1)}?tr=f-jpg`, caption: "IG caption" });
    expect(form(find(fake, "POST", "graph.threads.net", "/v1.0/TH1/threads")[0])).toEqual({
      media_type: "IMAGE",
      image_url: `${SHOT(1)}?tr=f-jpg`,
      text: "Threads caption #webdesign",
    });
    expect(JSON.parse(find(fake, "POST", "api.linkedin.com", "/rest/posts")[0].body).content).toEqual({ media: { id: expect.stringMatching(/^urn:li:image:/) } });

    // Per-network media: Threads gets only the hook slide.
    const fake2 = fakeNetworks();
    const id2 = await newPost(env, { threads: "Hook", instagram: "Carousel" }, [
      { kind: "image", url: SHOT(1), networks: ["instagram"] },
      { kind: "image", url: SHOT(2), networks: ["instagram"] },
      { kind: "image", url: SHOT(1), role: "hook", networks: ["threads"] },
    ]);
    expect(await publishNow(env, id2)).toMatchObject({ status: "sent" });
    expect(find(fake2, "POST", "graph.threads.net", "/v1.0/TH1/threads").map(form)).toEqual([
      { media_type: "IMAGE", image_url: `${SHOT(1)}?tr=f-jpg`, text: "Hook" },
    ]);
    expect(find(fake2, "POST", "graph.facebook.com", "/v26.0/IG1/media").map(form).at(-1)).toMatchObject({ media_type: "CAROUSEL" });
  });

  it("text only: a Facebook link post, a Threads text post, a LinkedIn article", async () => {
    const fake = fakeNetworks();
    const env = await setup();
    const id = await newPost(env, { facebook: "FB", threads: "TH", linkedin: "LI" }, []);
    expect(await publishNow(env, id)).toMatchObject({ status: "sent" });
    expect(form(find(fake, "POST", "graph.facebook.com", "/v26.0/PAGE1/feed")[0])).toEqual({ message: "FB", link: FACTS.pageUrl });
    expect(form(find(fake, "POST", "graph.threads.net", "/v1.0/TH1/threads")[0])).toEqual({ media_type: "TEXT", text: "TH" });
    // The article card's thumbnail is the listing's screenshot, uploaded as JPEG.
    expect(find(fake, "PUT", "www.linkedin.com", /^\/dms-uploads\//)).toHaveLength(1);
    expect(JSON.parse(find(fake, "POST", "api.linkedin.com", "/rest/posts")[0].body).content).toEqual({
      article: { source: FACTS.pageUrl, title: "Paper Weather", description: "A studio site", thumbnail: expect.stringMatching(/^urn:li:image:/) },
    });

    // No link and no media: plain text everywhere.
    const fake2 = fakeNetworks();
    const id2 = await newPost(env, { facebook: "Plain", linkedin: "Plain" }, [], { what: "news" });
    expect(await publishNow(env, id2)).toMatchObject({ status: "sent" });
    expect(form(find(fake2, "POST", "graph.facebook.com", "/v26.0/PAGE1/feed")[0])).toEqual({ message: "Plain" });
    expect(JSON.parse(find(fake2, "POST", "api.linkedin.com", "/rest/posts")[0].body).content).toBeUndefined();
  });

  it("video: a Facebook video, an Instagram reel (polled), a Threads video; LinkedIn falls back to the image", async () => {
    const fake = fakeNetworks();
    fake.state.igInProgress = 2;
    const env = await setup();
    const id = await newPost(env, ALL, [
      { kind: "video", url: REEL, role: "voiceover" },
      { kind: "image", url: SHOT(1) },
    ]);
    const post = await publishNow(env, id);
    expect(post.status).toBe("sent");
    expect(form(find(fake, "POST", "graph.facebook.com", "/v26.0/PAGE1/videos")[0])).toEqual({ file_url: REEL, description: "FB caption" });
    expect(form(find(fake, "POST", "graph.facebook.com", "/v26.0/IG1/media")[0])).toEqual({
      media_type: "REELS",
      video_url: REEL,
      caption: "IG caption",
      share_to_feed: "true",
    });
    expect(find(fake, "GET", "graph.facebook.com", /^\/v26\.0\/C\d+$/)).toHaveLength(3); // IN_PROGRESS, IN_PROGRESS, FINISHED
    expect(form(find(fake, "POST", "graph.threads.net", "/v1.0/TH1/threads")[0])).toEqual({ media_type: "VIDEO", video_url: REEL, text: "Threads caption #webdesign" });
    expect(JSON.parse(find(fake, "POST", "api.linkedin.com", "/rest/posts")[0].body).content).toEqual({ media: { id: expect.stringMatching(/^urn:li:image:/) } });
    expect(result(post, "linkedin")).toMatchObject({ status: "sent", note: expect.stringMatching(/LinkedIn video isn't supported yet/) });
    expect(result(post, "facebook")).toMatchObject({ note: "1 item not posted (a video post carries one video)." });
  });

  it("converts ImageKit images to JPEG, leaves other URLs alone", () => {
    vi.stubEnv("IMAGEKIT_URL_ENDPOINT", IK);
    expect(jpegUrl(SHOT(1))).toBe(`${SHOT(1)}?tr=f-jpg`);
    expect(jpegUrl(`${SHOT(1)}?tr=w-1080`)).toBe(`${SHOT(1)}?tr=w-1080%3Af-jpg`);
    expect(decodeURIComponent(jpegUrl(`${SHOT(1)}?tr=w-1080`))).toBe(`${SHOT(1)}?tr=w-1080:f-jpg`);
    expect(jpegUrl(`${SHOT(1)}?tr=f-jpg`)).toBe(`${SHOT(1)}?tr=f-jpg`);
    expect(jpegUrl("https://cdn.example/a.png")).toBe("https://cdn.example/a.png");
  });

  it("escapes LinkedIn's little format, keeping real hashtags", () => {
    expect(escapeLittle("Hi (all) @studio [x] {y} <z> a|b *c* _d_ ~e~ back\\slash #webdesign C# #1 #")).toBe(
      "Hi \\(all\\) \\@studio \\[x\\] \\{y\\} \\<z\\> a\\|b \\*c\\* \\_d\\_ \\~e\\~ back\\\\slash #webdesign C\\# #1 \\#",
    );
    expect(escapeLittle("#shemoqmedi\nNew line")).toBe("#shemoqmedi\nNew line");
  });

  it("skips Instagram with no media and networks with no account", async () => {
    fakeNetworks();
    vi.stubEnv("THREADS_ACCESS_TOKEN", "");
    const env = await setup();
    const id = await newPost(env, { facebook: "FB", instagram: "IG", threads: "TH" }, [{ kind: "image", url: SHOT(1), networks: ["facebook"] }]);
    // Instagram has no media of its own: approval refuses.
    await expect(env.t.mutation(api.mcp.approvePost, { token: env.token, id })).rejects.toThrow(/Instagram needs/);
    await env.t.mutation(api.mcp.updatePost, { token: env.token, id, captions: { instagram: "" } });
    const post = await publishNow(env, id);
    expect(post.status).toBe("sent");
    expect(result(post, "threads")).toMatchObject({ status: "skipped", error: expect.stringMatching(/THREADS_ACCESS_TOKEN/) });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Failure, retry, scheduling
// ─────────────────────────────────────────────────────────────────────────────

describe("failure and retry", () => {
  it("a failed network is retried alone; sent networks are never sent twice", async () => {
    const fake = fakeNetworks();
    let failIg = true;
    fake.overrides.push((c) =>
      failIg && c.url.pathname === "/v26.0/IG1/media_publish" ? graphError(`Media not ready (access_token=${META})`, 9007) : null,
    );
    const env = await setup();
    const id = await newPost(env, ALL, [{ kind: "image", url: SHOT(1) }]);
    const failed = await publishNow(env, id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("Instagram: Media not ready (access_token=[token]) (code 9007)");
    expect(failed.error).not.toContain(META);
    expect(failed.publishingUntil).toBeUndefined();
    expect(result(failed, "facebook")?.status).toBe("sent");
    expect(result(failed, "instagram")?.status).toBe("failed");

    // The admin page and the MCP show it, and Retry sends Instagram only.
    const counts = () => ({
      fb: find(fake, "POST", "graph.facebook.com", "/v26.0/PAGE1/photos").length,
      th: find(fake, "POST", "graph.threads.net", "/v1.0/TH1/threads_publish").length,
      li: find(fake, "POST", "api.linkedin.com", "/rest/posts").length,
      ig: find(fake, "POST", "graph.facebook.com", "/v26.0/IG1/media_publish").length,
    });
    const before = counts();
    failIg = false;
    const retried = await env.t.mutation(api.mcp.retryPost, { token: env.token, id });
    expect(retried.status).toBe("scheduled");
    await drain(env);
    const after = counts();
    expect(after).toEqual({ ...before, ig: before.ig + 1 });
    const sent = (await getPost(env, id))!;
    expect(sent.status).toBe("sent");
    expect(sent.error).toBeUndefined();
    await expect(env.t.mutation(api.mcp.retryPost, { token: env.token, id })).rejects.toThrow(/already sent/);

    // The admin's Retry button runs the same mutation.
    await expect(env.admin.mutation(api.social.retry, { id })).rejects.toThrow(/already sent/);
  });

  it("with no account connected, approval works and the post waits as approved with a clear error", async () => {
    const fake = fakeNetworks();
    vi.stubEnv("META_PAGE_ACCESS_TOKEN", "");
    vi.stubEnv("THREADS_ACCESS_TOKEN", "");
    vi.stubEnv("LINKEDIN_ACCESS_TOKEN", "");
    const env = await setup();
    const id = await newPost(env, { facebook: "FB", linkedin: "LI" }, []);
    const post = await publishNow(env, id);
    expect(post.status).toBe("approved");
    expect(post.error).toMatch(/no connected account for Facebook, LinkedIn/);
    expect(platformCalls(fake)).toHaveLength(0);

    // Connect, retry: published.
    vi.stubEnv("META_PAGE_ACCESS_TOKEN", META);
    vi.stubEnv("LINKEDIN_ACCESS_TOKEN", LINKEDIN);
    await env.admin.mutation(api.social.retry, { id });
    await drain(env);
    expect((await getPost(env, id))!.status).toBe("sent");
  });

  it("publishes at scheduledFor; editing or rejecting cancels the job", async () => {
    const fake = fakeNetworks();
    const env = await setup();
    const at = Date.now() + 2 * 60 * 60 * 1000;
    const id = await newPost(env, { facebook: "Later" }, []);
    await env.t.mutation(api.mcp.updatePost, { token: env.token, id, scheduledFor: at });
    await env.t.mutation(api.mcp.approvePost, { token: env.token, id });
    const scheduled = (await getPost(env, id))!;
    expect(scheduled.status).toBe("scheduled");
    const job = await env.t.run((ctx) => ctx.db.system.get(scheduled.publishJobId!));
    expect(job).toMatchObject({ scheduledTime: at, state: { kind: "pending" } });

    // Editing sends it back to waiting and cancels the job.
    const edited = await env.t.mutation(api.mcp.updatePost, { token: env.token, id, captions: { facebook: "Later, edited" } });
    expect(edited.status).toBe("waiting");
    expect((await env.t.run((ctx) => ctx.db.system.get(scheduled.publishJobId!)))!.state.kind).toBe("canceled");
    expect((await getPost(env, id))!.publishJobId).toBeUndefined();

    // Approve again, then reject: cancelled again; nothing is ever published.
    await env.t.mutation(api.mcp.approvePost, { token: env.token, id });
    const again = (await getPost(env, id))!;
    expect(again.publishJobId).not.toBe(scheduled.publishJobId);
    const rejected = await env.t.mutation(api.mcp.rejectPost, { token: env.token, id, note: "Not now" });
    expect(rejected.status).toBe("rejected");
    expect((await env.t.run((ctx) => ctx.db.system.get(again.publishJobId!)))!.state.kind).toBe("canceled");
    await drain(env);
    expect(find(fake, "POST", "graph.facebook.com", "/v26.0/PAGE1/feed")).toHaveLength(0);

    // A fresh post approved for later publishes at that time (a fresh MCP credential: the clock moved).
    env.token = (await mintServiceCredential("admin"))!;
    const id2 = await newPost(env, { facebook: "Timed" }, []);
    await env.t.mutation(api.mcp.updatePost, { token: env.token, id: id2, scheduledFor: at });
    await env.t.mutation(api.mcp.approvePost, { token: env.token, id: id2 });
    await drain(env);
    const sent = (await getPost(env, id2))!;
    expect(sent.status).toBe("sent");
    expect(sent.sentAt).toBeGreaterThanOrEqual(at);
  });

  it("a post being published can't be edited, rejected, retried or published twice", async () => {
    fakeNetworks();
    const env = await setup();
    const id = await newPost(env, { facebook: "Busy" }, []);
    await env.t.mutation(api.mcp.approvePost, { token: env.token, id });
    await env.t.run((ctx) => ctx.db.patch(id, { publishingUntil: Date.now() + 60_000 }));
    await expect(env.t.mutation(api.mcp.updatePost, { token: env.token, id, note: "x" })).rejects.toThrow(/being published/);
    await expect(env.t.mutation(api.mcp.rejectPost, { token: env.token, id })).rejects.toThrow(/being published/);
    await expect(env.t.mutation(api.mcp.retryPost, { token: env.token, id })).rejects.toThrow(/being published/);
    expect(await env.t.mutation(internal.publish.begin, { postId: id, run: (await getPost(env, id))!.publishRun! })).toBeNull();
  });

  it("refuses a Threads caption over 500 characters", async () => {
    fakeNetworks();
    const env = await setup();
    const id = await newPost(env, {}, []);
    await expect(env.t.mutation(api.mcp.updatePost, { token: env.token, id, captions: { threads: "x".repeat(501) } })).rejects.toThrow(
      /Threads caption is too long \(500/,
    );
    const ok = await env.t.mutation(api.mcp.updatePost, { token: env.token, id, captions: { threads: "x".repeat(500) } });
    expect(ok.captions.threads).toHaveLength(500);
    // A Threads caption alone is enough to approve.
    expect((await env.t.mutation(api.mcp.approvePost, { token: env.token, id })).status).toBe("scheduled");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tokens over time
// ─────────────────────────────────────────────────────────────────────────────

describe("tokens", () => {
  it("refreshes the Threads token in its window", async () => {
    const fake = fakeNetworks();
    const env = await setup();
    await env.t.action(internal.channels.sync, {});
    const threadsRow = () => env.t.run(async (ctx) => (await ctx.db.query("socialAccounts").collect()).find((r) => r.network === "threads")!);
    const refreshes = () => find(fake, "GET", "graph.threads.net", "/refresh_access_token");

    // Younger than 24 hours: not yet.
    expect(await env.t.action(internal.channels.refreshThreads, {})).toBe("not_due");
    // A day later: refreshed once to learn the real expiry.
    vi.setSystemTime(Date.now() + DAY + 60_000);
    expect(await env.t.action(internal.channels.refreshThreads, {})).toBe("refreshed");
    const first = await threadsRow();
    expect(first).toMatchObject({ token: THREADS_NEW, expiresAt: Date.now() + 5_184_000_000, refreshedAt: Date.now() });
    expect(refreshes()[0].auth).toBe(`Bearer ${THREADS}`);
    // 50 days left: not due. 19 days left: refreshed.
    vi.setSystemTime(Date.now() + 10 * DAY);
    expect(await env.t.action(internal.channels.refreshThreads, {})).toBe("not_due");
    vi.setSystemTime(first.expiresAt! - 19 * DAY);
    expect(await env.t.action(internal.channels.refreshThreads, {})).toBe("refreshed");
    expect(refreshes()).toHaveLength(2);
    // The env token didn't change, so sync keeps the refreshed one.
    await env.t.action(internal.channels.sync, {});
    expect((await threadsRow()).token).toBe(THREADS_NEW);

    expect(threadsRefreshDue({ issuedAt: 0, expiresAt: 30 * DAY, refreshedAt: 0 }, 2 * DAY)).toBe(false);
    expect(threadsRefreshDue({ issuedAt: 0, expiresAt: 30 * DAY, refreshedAt: 0 }, 11 * DAY)).toBe(true);
    expect(threadsRefreshDue({ issuedAt: 0, expiresAt: 30 * DAY, refreshedAt: 0 }, 31 * DAY)).toBe(false); // expired
  });

  it("emails the admins once a week before the LinkedIn token expires, and once when it has", async () => {
    const fake = fakeNetworks();
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const env = await setup();
    await env.t.action(internal.channels.sync, {});
    const t0 = Date.now();
    const emails = () => find(fake, "POST", "api.resend.com", "/emails").map((c) => JSON.parse(c.body));

    expect(await env.t.action(internal.channels.warnLinkedin, {})).toBeNull();
    vi.setSystemTime(t0 + 52 * DAY);
    expect(await env.t.action(internal.channels.warnLinkedin, {})).toBeNull(); // 8 days left
    vi.setSystemTime(t0 + 53 * DAY + 60_000);
    expect(await env.t.action(internal.channels.warnLinkedin, {})).toBe("soon");
    expect(await env.t.action(internal.channels.daily, {})).toBeNull(); // already warned
    vi.setSystemTime(t0 + 60 * DAY + 60_000);
    expect(await env.t.action(internal.channels.warnLinkedin, {})).toBe("expired");
    expect(await env.t.action(internal.channels.warnLinkedin, {})).toBeNull();

    const sent = emails();
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ to: ["admin@example.com"], subject: "The LinkedIn token expires in 7 days" });
    expect(sent[1].subject).toMatch(/expired/);
    // The email says what publishing really does: LinkedIn fails (the post shows as failed), the rest go out.
    expect(sent[1].text).toMatch(/LinkedIn fails on every post with a LinkedIn caption, so those posts show as failed/);
    expect(sent[1].text).not.toMatch(/skip/);
    for (const e of sent) for (const tkn of TOKENS) expect(JSON.stringify(e)).not.toContain(tkn);

    // An expired LinkedIn token fails that network with a clear error.
    env.token = (await mintServiceCredential("admin"))!;
    const id = await newPost(env, { linkedin: "Late" }, []);
    const post = await publishNow(env, id);
    expect(post.status).toBe("failed");
    expect(post.error).toMatch(/LinkedIn token expired/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tokens stay inside Convex
// ─────────────────────────────────────────────────────────────────────────────

describe("token privacy", () => {
  it("no public or MCP function returns a token", async () => {
    fakeNetworks();
    const env = await setup();
    const id = await newPost(env, ALL, [{ kind: "image", url: SHOT(1) }]);
    await publishNow(env, id);
    const channels = await env.t.action(api.mcp.listChannels, { token: env.token });
    const outputs = [
      channels,
      await env.t.query(api.mcp.socialQueue, { token: env.token, status: "all" }),
      await env.t.query(api.mcp.getPost, { token: env.token, id }),
      await env.t.query(api.mcp.stats, { token: env.token }),
      await env.admin.query(api.social.queue, { status: "all" }),
    ];
    const text = JSON.stringify(outputs);
    for (const tkn of TOKENS) expect(text).not.toContain(tkn);
    expect(channels.map((c) => [c.network, c.connected, c.account])).toEqual([
      ["facebook", true, "Shemoqmedi"],
      ["instagram", true, "@shemoqmedi"],
      ["threads", true, "@shemoqmedi"],
      ["linkedin", true, "Giorgi Khvichia"],
    ]);

    // Every function in channels.ts and publish.ts is internal.
    for (const mod of [channelsModule, publishModule]) {
      for (const [name, fn] of Object.entries(mod)) {
        const f = fn as { isQuery?: boolean; isMutation?: boolean; isAction?: boolean; isInternal?: boolean };
        if (f && (f.isQuery || f.isMutation || f.isAction)) expect({ name, internal: f.isInternal }).toEqual({ name, internal: true });
      }
    }
    // Only those two modules (and the schema) touch the accounts table.
    const dir = new URL("../convex/", import.meta.url);
    const readers = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => readFileSync(new URL(f, dir), "utf8").includes("socialAccounts"));
    expect(readers.sort()).toEqual(["channels.ts", "publish.ts", "schema.ts"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Review fixes
// ─────────────────────────────────────────────────────────────────────────────

const draft = (caption: string, media: Media[] = []) => ({ caption, media, link: null, title: null, description: null, thumbnail: null });

async function addMediaRow(env: Env, url: string, width: number, height: number) {
  await env.t.run((ctx) =>
    ctx.db.insert("media", {
      fileId: url,
      url,
      filePath: new URL(url).pathname,
      kind: "image",
      contentType: "image/jpeg",
      size: 1000,
      width,
      height,
      createdAt: Date.now(),
    }),
  );
}

describe("Threads counts emoji as their UTF-8 bytes", () => {
  it("threadsLength counts emoji as Threads does", () => {
    expect(threadsLength("hello")).toBe(5);
    expect(threadsLength("🏆")).toBe(4); // U+1F3C6: 2 UTF-16 units, 4 bytes
    expect(threadsLength("✨")).toBe(3); // U+2728: 1 unit, 3 bytes
    expect(threadsLength("➡️")).toBe(6); // U+27A1 + VS16
    expect(threadsLength("შემოქმედი")).toBe(9); // letters count as 1, emoji only by bytes
    for (const text of ["a🏆b", "✨✨", "plain", "👩‍💻 dev"]) expect(threadsLength(text)).toBeGreaterThanOrEqual(text.length);
  });

  it("editPost, publishThreads and the MCP schema refuse a caption that is over 500 for Threads", async () => {
    const fake = fakeNetworks();
    const env = await setup();
    const id = await newPost(env, {}, []);
    // 497 UTF-16 units: 493 letters + 2 trophies; Threads counts 493 + 8 = 501.
    const tooLong = `${"x".repeat(493)}🏆🏆`;
    expect(tooLong.length).toBe(497);
    await expect(env.t.mutation(api.mcp.updatePost, { token: env.token, id, captions: { threads: tooLong } })).rejects.toThrow(
      /Threads caption is too long \(500 characters at most, it has 501, counting emoji/,
    );
    const fits = `${"x".repeat(492)}🏆🏆`; // 500 as Threads counts it
    expect((await env.t.mutation(api.mcp.updatePost, { token: env.token, id, captions: { threads: fits } })).captions.threads).toBe(fits);

    // The publish step checks again before calling Threads (a row written some other way).
    await expect(publishThreads(draft(tooLong), THREADS, "TH1")).rejects.toThrow(/501 characters as Threads counts them/);
    expect(platformCalls(fake)).toHaveLength(0);

    // The MCP tool schema counts the same way.
    const source = readFileSync(new URL("../lib/mcp/server.ts", import.meta.url), "utf8");
    expect(source).toMatch(/threadsLength\(s\.trim\(\)\) <= THREADS_MAX/);
  });
});

describe("Facebook photo text", () => {
  it("a single photo sends its text as caption, a multi-photo or text post as message", async () => {
    const fake = fakeNetworks();
    await publishFacebook(draft("One photo", [{ kind: "image", url: SHOT(1) }]), META, "PAGE1");
    expect(form(find(fake, "POST", "graph.facebook.com", "/v26.0/PAGE1/photos")[0])).toEqual({ url: `${SHOT(1)}?tr=f-jpg`, caption: "One photo" });
    await publishFacebook(draft("Two photos", [{ kind: "image", url: SHOT(1) }, { kind: "image", url: SHOT(2) }]), META, "PAGE1");
    expect(form(find(fake, "POST", "graph.facebook.com", "/v26.0/PAGE1/feed")[0]).message).toBe("Two photos");
    expect(find(fake, "POST", "graph.facebook.com", "/v26.0/PAGE1/photos").slice(1).every((c) => !("message" in form(c)) && !("caption" in form(c)))).toBe(true);
  });
});

describe("Instagram aspect ratio", () => {
  const STORY = `${IK}/social/graphics/story.jpg`;
  const LINK = `${IK}/social/graphics/link.jpg`;
  const PORTRAIT = `${IK}/social/graphics/portrait.jpg`;
  const tr = (url: string) => new URL(url).searchParams.get("tr");

  it("pads story and link graphics into 4:5 to 1.91:1 for Instagram only", async () => {
    const fake = fakeNetworks();
    const env = await setup();
    await addMediaRow(env, STORY, 1080, 1920);
    await addMediaRow(env, LINK, 1200, 627);
    await addMediaRow(env, PORTRAIT, 1080, 1350);

    const id = await newPost(env, { instagram: "IG", facebook: "FB" }, [{ kind: "image", url: STORY }]);
    expect(await publishNow(env, id)).toMatchObject({ status: "sent" });
    const [single] = find(fake, "POST", "graph.facebook.com", "/v26.0/IG1/media").map(form);
    expect(tr(single.image_url)).toBe("w-1080,h-1350,cm-pad_resize,bg-FFFFFF,f-jpg");
    expect(tr(form(find(fake, "POST", "graph.facebook.com", "/v26.0/PAGE1/photos")[0]).url)).toBe("f-jpg"); // Facebook gets it as it is

    // A carousel: the 4:5 slide as it is, the link graphic padded to 1080x566 (1.908:1).
    const fake2 = fakeNetworks();
    const id2 = await newPost(env, { instagram: "IG" }, [
      { kind: "image", url: PORTRAIT },
      { kind: "image", url: LINK },
    ]);
    expect(await publishNow(env, id2)).toMatchObject({ status: "sent" });
    const children = find(fake2, "POST", "graph.facebook.com", "/v26.0/IG1/media").map(form).filter((c) => c.is_carousel_item);
    expect(children.map((c) => tr(c.image_url))).toEqual(["f-jpg", "w-1080,h-566,cm-pad_resize,bg-FFFFFF,f-jpg"]);
  });

  it("refuses at approval an image Instagram can't take and we can't pad", async () => {
    fakeNetworks();
    const env = await setup();
    const tall = "https://cdn.example/tall-phone.jpg";
    await addMediaRow(env, tall, 1170, 2532);
    const id = await newPost(env, { instagram: "IG", facebook: "FB" }, [{ kind: "image", url: tall }]);
    await expect(env.t.mutation(api.mcp.approvePost, { token: env.token, id })).rejects.toThrow(/Instagram takes images between 4:5 and 1\.91:1/);
    // Limited to the other networks, the same image is fine.
    await env.t.mutation(api.mcp.updatePost, { token: env.token, id, captions: { instagram: "" } });
    expect((await env.t.mutation(api.mcp.approvePost, { token: env.token, id })).status).toBe("scheduled");
  });

  it("instagramImageUrl keeps images in range and of unknown size, chains after other transforms", () => {
    expect(instagramImageUrl({ url: SHOT(1) })).toBe(`${SHOT(1)}?tr=f-jpg`);
    expect(instagramImageUrl({ url: SHOT(1), width: 1080, height: 1080 })).toBe(`${SHOT(1)}?tr=f-jpg`);
    expect(instagramImageUrl({ url: SHOT(1), width: 1910, height: 1000 })).toBe(`${SHOT(1)}?tr=f-jpg`);
    expect(tr(instagramImageUrl({ url: `${SHOT(1)}?tr=w-2000`, width: 1080, height: 1920 }))).toBe("w-2000:w-1080,h-1350,cm-pad_resize,bg-FFFFFF,f-jpg");
    expect(tr(instagramImageUrl({ url: SHOT(1), width: 1200, height: 627 }))).toBe("w-1080,h-566,cm-pad_resize,bg-FFFFFF,f-jpg");
    expect(1080 / 566).toBeLessThanOrEqual(1.91);
  });
});

describe("Threads carousel timing and the run deadline", () => {
  it("polls carousel items together, with one 30-second wait before publishing", async () => {
    vi.stubEnv("SOCIAL_WAIT_SCALE", "1");
    const fake = fakeNetworks();
    const images: Media[] = Array.from({ length: 10 }, (_, i) => ({ kind: "image", url: SHOT(i + 1) }));
    let done = false;
    const run = publishThreads(draft("Ten slides", images), THREADS, "TH1").then((r) => ((done = true), r));
    await vi.advanceTimersByTimeAsync(29_000);
    expect(done).toBe(false);
    expect(find(fake, "POST", "graph.threads.net", "/v1.0/TH1/threads").map(form).at(-1)).toMatchObject({ media_type: "CAROUSEL" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(done).toBe(true); // 30 s in all, not 11 x 30 s
    expect((await run).remoteId).toBe("THP1");
  });

  it("stops before the deadline instead of waiting past it, and publishes nothing", async () => {
    vi.stubEnv("SOCIAL_WAIT_SCALE", "1");
    const fake = fakeNetworks();
    fake.overrides.push((c) => (c.method === "GET" && /^\/v1\.0\/TC\d+$/.test(c.url.pathname) ? json({ status: "IN_PROGRESS" }) : null));
    const images: Media[] = [1, 2, 3].map((i) => ({ kind: "image", url: SHOT(i) }));
    const run = publishThreads(draft("Slow", images), THREADS, "TH1", Date.now() + 14_000).catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(20_000);
    const err = await run;
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/ran out of time/);
    expect(find(fake, "POST", "graph.threads.net", "/v1.0/TH1/threads").map(form).some((f) => f.media_type === "CAROUSEL")).toBe(false);
    expect(find(fake, "POST", "graph.threads.net", "/v1.0/TH1/threads_publish")).toHaveLength(0);

    // With no time left, not even the first request is made.
    const before = fake.calls.length;
    await expect(publishFacebook(draft("Late"), META, "PAGE1", Date.now() + 1_000)).rejects.toThrow(/ran out of time/);
    expect(fake.calls.length).toBe(before);
  });
});

describe("publish runs", () => {
  it("a run cancelled while already running can't publish the post, nor can a run before its time", async () => {
    const fake = fakeNetworks();
    const env = await setup();
    const id = await newPost(env, { facebook: "Now" }, []);
    await env.t.mutation(api.mcp.approvePost, { token: env.token, id });
    const first = (await getPost(env, id))!;
    expect(first.publishRun).toBe(1);

    // Edited (run 1 is cancelled, but it may already be running) and approved again for tomorrow.
    const tomorrow = Date.now() + DAY;
    await env.t.mutation(api.mcp.updatePost, { token: env.token, id, captions: { facebook: "Tomorrow" }, scheduledFor: tomorrow });
    await env.t.mutation(api.mcp.approvePost, { token: env.token, id });
    expect((await getPost(env, id))!.publishRun).toBe(2);

    // Run 1 reaching begin now: refused. Run 2 before its time: refused.
    expect(await env.t.action(internal.publish.post, { postId: id, run: 1 })).toBeNull();
    expect(await env.t.mutation(internal.publish.begin, { postId: id, run: 2 })).toBeNull();
    expect(find(fake, "POST", "graph.facebook.com", "/v26.0/PAGE1/feed")).toHaveLength(0);
    expect((await getPost(env, id))!.status).toBe("scheduled");

    // At its time, run 2 publishes the edited text.
    await drain(env);
    const sent = (await getPost(env, id))!;
    expect(sent.status).toBe("sent");
    expect(sent.sentAt).toBeGreaterThanOrEqual(tomorrow);
    expect(find(fake, "POST", "graph.facebook.com", "/v26.0/PAGE1/feed").map((c) => form(c).message)).toEqual(["Tomorrow"]);
  });

  it("a run that died after claiming the post shows as stopped and can be retried from the admin page", async () => {
    fakeNetworks();
    const env = await setup();
    const id = await newPost(env, { facebook: "Crash" }, []);
    await env.t.mutation(api.mcp.approvePost, { token: env.token, id });
    const lease = Date.now() + 9.5 * 60_000;
    // The run claimed the post, then died: the job is gone, the lease stays.
    await env.t.run(async (ctx) => {
      const post = (await ctx.db.get(id))!;
      await ctx.scheduler.cancel(post.publishJobId!);
      await ctx.db.patch(id, { publishingUntil: lease });
    });
    const view = (await env.admin.query(api.social.queue, { status: "scheduled" })).find((p) => p.id === id)!;
    expect(view.publishingUntil).toBe(lease);
    // While the lease holds: publishing, no retry.
    expect(publishState(view, Date.now())).toMatchObject({ publishing: true, stalled: false, canRetry: false });
    await expect(env.admin.mutation(api.social.retry, { id })).rejects.toThrow(/being published/);
    // Once it ran out, the page's own clock shows it stopped, with Retry.
    vi.setSystemTime(Date.now() + 10 * 60_000);
    expect(publishState(view, Date.now())).toMatchObject({ publishing: false, stalled: true, canRetry: true });
    await env.admin.mutation(api.social.retry, { id });
    expect((await getPost(env, id))!.publishRun).toBe(2);
    await drain(env);
    expect((await getPost(env, id))!.status).toBe("sent");
  });

  it("an approved post from before publishing existed is not retried", async () => {
    const fake = fakeNetworks();
    const env = await setup();
    const id = await env.t.run((ctx) =>
      ctx.db.insert("socialPosts", {
        kind: "award",
        status: "approved",
        captions: { facebook: "Old award post" },
        media: [],
        approvedAt: Date.now() - 20 * DAY,
        createdAt: Date.now() - 21 * DAY,
        updatedAt: Date.now() - 20 * DAY,
      }),
    );
    await expect(env.admin.mutation(api.social.retry, { id })).rejects.toThrow(/approved before publishing was connected/);
    await expect(env.t.mutation(api.mcp.retryPost, { token: env.token, id })).rejects.toThrow(/may have been posted by hand/);
    const [view] = await env.admin.query(api.social.queue, { status: "approved" });
    expect(publishState(view, Date.now())).toMatchObject({ legacy: true, canRetry: false });
    expect(platformCalls(fake)).toHaveLength(0);
    // Editing sends it back to waiting; approving again publishes it.
    expect((await env.t.mutation(api.mcp.updatePost, { token: env.token, id, note: "Publish it after all" })).status).toBe("waiting");
    expect((await publishNow(env, id)).status).toBe("sent");

    // An approved post that found no connected account (it has results) is still retried.
    expect(publishState({ ...view, results: [{ network: "facebook", status: "skipped" }] }, Date.now())).toMatchObject({ legacy: false, canRetry: true });
  });
});

describe("a failed Instagram lookup", () => {
  it("keeps the Facebook Page connected, and Instagram connects on a later sync", async () => {
    const fake = fakeNetworks();
    let igFails = true;
    let meFails = false;
    fake.overrides.push((c) => {
      if (c.url.host !== "graph.facebook.com" || c.method !== "GET") return null;
      if (igFails && c.url.pathname === "/v26.0/PAGE1") return graphError("(#10) This endpoint requires the 'instagram_basic' permission.", 10, 403);
      if (meFails && c.url.pathname === "/v26.0/me") return graphError("An unexpected error has occurred.", 2, 500);
      return null;
    });
    const env = await setup();
    const id = await newPost(env, { facebook: "FB", instagram: "IG" }, [{ kind: "image", url: SHOT(1) }]);
    const post = await publishNow(env, id);
    expect(result(post, "facebook")?.status).toBe("sent");
    expect(result(post, "instagram")).toMatchObject({ status: "skipped", error: expect.stringMatching(/Not connected: Instagram lookup failed: .*instagram_basic/) });
    expect(post.status).toBe("sent");

    const channels = async () => Object.fromEntries((await env.t.action(api.mcp.listChannels, { token: env.token })).map((c) => [c.network, c]));
    let view = await channels();
    expect(view.facebook).toMatchObject({ connected: true, account: "Shemoqmedi", lastError: null });
    expect(view.instagram).toMatchObject({ connected: false, lastError: expect.stringMatching(/^Instagram lookup failed/) });

    // A passing error on the whole lookup doesn't drop the Page found earlier with the same token.
    meFails = true;
    view = await channels();
    expect(view.facebook).toMatchObject({ connected: true, account: "Shemoqmedi" });

    // Instagram works again: connected, and no more lookups after that.
    meFails = false;
    igFails = false;
    view = await channels();
    expect(view.instagram).toMatchObject({ connected: true, account: "@shemoqmedi", lastError: null });
    const lookups = find(fake, "GET", "graph.facebook.com", "/v26.0/me").length;
    await channels();
    expect(find(fake, "GET", "graph.facebook.com", "/v26.0/me")).toHaveLength(lookups);
  });
});

describe("render_carousel runs slides side by side", () => {
  it("mapLimit keeps the order and never runs more than the limit at once", async () => {
    vi.useRealTimers();
    let running = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3, 0, 6], 3, async (n, i) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n));
      running--;
      return `${i}:${n}`;
    });
    expect(out).toEqual(["0:5", "1:1", "2:4", "3:2", "4:3", "5:0", "6:6"]);
    expect(peak).toBe(3);
    const route = readFileSync(new URL("../app/api/mcp/route.ts", import.meta.url), "utf8");
    expect(route).toMatch(/export const maxDuration = 300;/);
  });
});

describe("a new schedule after a run that died", () => {
  it("editing (MCP update_post) and publishing again clears the dead run's lease, so the post isn't shown as stalled", async () => {
    fakeNetworks();
    const env = await setup();
    const id = await newPost(env, { facebook: "Crash" }, []);
    await env.t.mutation(api.mcp.approvePost, { token: env.token, id });
    // The run claimed the post, then died: the job is gone, the lease stays and runs out.
    await env.t.run(async (ctx) => {
      const post = (await ctx.db.get(id))!;
      await ctx.scheduler.cancel(post.publishJobId!);
      await ctx.db.patch(id, { publishingUntil: Date.now() + 9.5 * 60_000 });
    });
    vi.setSystemTime(Date.now() + 10 * 60_000);
    const token = (await mintServiceCredential("admin"))!; // the agent's credential lives a minute

    // Fix the caption over MCP: back to waiting, without the old lease.
    expect((await env.t.mutation(api.mcp.updatePost, { token, id, captions: { facebook: "Fixed" } })).status).toBe("waiting");
    expect((await getPost(env, id))!.publishingUntil).toBeUndefined();

    // Schedule it for tomorrow: a normal schedule (unschedule, move time, edit), not a stalled run.
    const tomorrow = Date.now() + DAY;
    await env.t.mutation(api.mcp.publishPost, { token, id, at: tomorrow });
    const view = (await env.admin.query(api.social.queue, { status: "scheduled" })).find((p) => p.id === id)!;
    expect(view.publishingUntil).toBeNull();
    expect(publishState(view, Date.now())).toMatchObject({ publishing: false, stalled: false, canRetry: false });
    expect(postActions(view, Date.now())).toMatchObject({ unschedule: true, schedule: true, edit: true, retry: false });
    await expect(env.admin.mutation(api.social.retry, { id })).rejects.toThrow(/already scheduled/);
  });

  it("approving a waiting post that still carries an old lease clears it", async () => {
    fakeNetworks();
    const env = await setup();
    const id = await newPost(env, { facebook: "Old lease" }, []);
    // A row from before the fix: waiting, with a dead run's lease.
    await env.t.run((ctx) => ctx.db.patch(id, { publishingUntil: Date.now() - 60_000 }));
    await env.t.mutation(api.mcp.publishPost, { token: env.token, id, at: Date.now() + DAY });
    const post = (await getPost(env, id))!;
    expect(post.status).toBe("scheduled");
    expect(post.publishingUntil).toBeUndefined();
  });
});
