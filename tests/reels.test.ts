/// <reference types="vite/client" />
// The reel editor's backend (convex/reels.ts, voiceover.generateTimed /
// narrations, the MCP reel tools): drafts, sources, uploads, narration with
// word timings, the rendered reel and putting it in a post. fetch is mocked:
// no ElevenLabs credits, no R2.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { mintServiceCredential } from "../convex/lib/tokens";
import { defaultClip, defaultRecipe, defaultVoice, type ReelRecipe } from "../lib/reel/recipe";

const modules = import.meta.glob("../convex/**/*.{ts,js}");

const NINO = "21m00Tcm4TlvDq8ikWAM";
const ENV = {
  R2_ACCOUNT_ID: "acct123",
  R2_ACCESS_KEY_ID: "AKIATEST",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "shemoqmedi-media",
  R2_PUBLIC_URL: "https://pub-test.r2.dev",
  ELEVENLABS_API_KEY: "xi-test",
  ELEVENLABS_VOICES: JSON.stringify({ Nino: NINO }),
  MCP_SERVICE_SECRET: "test-secret-test-secret-test-secret",
};
const PUB = "https://pub-test.r2.dev";
const PREVIEW_KEY = "listings/paper-weather/paper-weather-website-preview-0123456789.mp4";
const COVER = "https://ik.imagekit.io/x/listings/paper-weather/cover.webp";
const SHOT2 = "https://ik.imagekit.io/x/listings/paper-weather/two.webp";

/** 2 s of 128 kb/s MP3 behind a 100-byte ID3 tag. */
const FAKE_MP3 = (() => {
  const bytes = new Uint8Array(10 + 100 + 32_000);
  bytes.set([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 100]);
  return bytes;
})();

const SPOKEN = "Paper Weather builds quiet sites.";

function alignment(text: string) {
  const chars = [...text];
  return {
    characters: chars,
    character_start_times_seconds: chars.map((_, i) => Math.round(i * 0.05 * 1000) / 1000),
    character_end_times_seconds: chars.map((_, i) => Math.round((i * 0.05 + 0.04) * 1000) / 1000),
  };
}

type Call = { method: string; url: URL; body: string };

function fakeServices() {
  const calls: Call[] = [];
  const stored = new Map<string, { size: number; type: string }>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      const body = req.method === "POST" ? await req.clone().text() : "";
      calls.push({ method: req.method, url, body });
      if (url.host === "api.elevenlabs.io" && url.pathname.endsWith("/with-timestamps")) {
        const { text } = JSON.parse(body) as { text: string };
        return Response.json({
          audio_base64: Buffer.from(FAKE_MP3).toString("base64"),
          alignment: alignment(text),
          normalized_alignment: null,
        });
      }
      if (url.host === "api.elevenlabs.io" && url.pathname.startsWith("/v1/text-to-speech/")) {
        return new Response(FAKE_MP3.slice(), { headers: { "content-type": "audio/mpeg" } });
      }
      if (url.host === "acct123.r2.cloudflarestorage.com") {
        const key = decodeURIComponent(url.pathname.replace("/shemoqmedi-media/", ""));
        if (req.method === "PUT") {
          stored.set(key, { size: (await req.arrayBuffer()).byteLength, type: req.headers.get("content-type") ?? "" });
          return new Response(null, { status: 200 });
        }
        if (req.method === "HEAD") {
          const file = stored.get(key);
          return file
            ? new Response(null, { headers: { "content-length": String(file.size), "content-type": file.type } })
            : new Response(null, { status: 404 });
        }
        if (req.method === "DELETE") {
          stored.delete(key);
          return new Response(null, { status: 204 });
        }
      }
      return new Response(`unexpected ${req.method} ${url}`, { status: 599 });
    }),
  );
  return { calls, stored };
}

const eleven = (calls: Call[]) => calls.filter((c) => c.url.host === "api.elevenlabs.io");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("users", { externalId: "admin", name: "Admin", email: "a@example.com", role: "admin", createdAt: 0, updatedAt: 0 });
    await ctx.db.insert("users", { externalId: "maker", name: "Maker", email: "m@example.com", createdAt: 0, updatedAt: 0 });
    const image = (url: string, fileId: string) =>
      ctx.db.insert("media", {
        fileId,
        url,
        filePath: new URL(url).pathname.replace("/x", ""),
        kind: "image",
        contentType: "image/webp",
        size: 100,
        width: 1600,
        height: 1000,
        createdAt: 0,
      });
    const cover = await image(COVER, "cover1");
    const two = await image(SHOT2, "two1");
    const video = await ctx.db.insert("media", {
      store: "r2",
      fileId: PREVIEW_KEY,
      url: `${PUB}/${PREVIEW_KEY}`,
      filePath: `/${PREVIEW_KEY}`,
      kind: "video",
      contentType: "video/mp4",
      size: 5000,
      width: 1280,
      height: 720,
      durationSec: 12,
      createdAt: 0,
    });
    const listing = {
      source: "import" as const,
      submissionTier: "standard" as const,
      tagline: "A studio site",
      url: "https://paperweather.example",
      category: "portfolio",
      technologies: [],
      region: "georgia" as const,
      creatorTier: "agency" as const,
      status: "in_voting" as const,
      communityTotals: { design: 0, usability: 0, creativity: 0 },
      communityVotesCount: 0,
      awards: [],
      isClaimed: false,
      createdAt: 0,
      updatedAt: 0,
    };
    const listingId = await ctx.db.insert("listings", {
      ...listing,
      slug: "paper-weather",
      title: "Paper Weather",
      creditName: "Paper Weather",
      coverId: cover,
      galleryIds: [two],
      videoId: video,
    });
    const otherId = await ctx.db.insert("listings", {
      ...listing,
      slug: "floema",
      title: "Floema",
      creditName: "Floema Studio",
      coverId: cover,
    });
    return { listingId, otherId };
  });
  return {
    t,
    ...ids,
    admin: t.withIdentity({ subject: "admin" }),
    maker: t.withIdentity({ subject: "maker" }),
    token: (await mintServiceCredential("admin"))!,
  };
}
type Env = Awaited<ReturnType<typeof setup>>;

function studioRecipe(env: Env): ReelRecipe {
  const r = defaultRecipe();
  r.clips = [
    defaultClip(
      { kind: "listingVideo", url: `${PUB}/${PREVIEW_KEY}`, listingId: env.listingId, width: 1280, height: 720, durationSec: 12 },
      "9:16",
      "v1",
    ),
    { ...defaultClip({ kind: "screenshot", url: COVER, listingId: env.otherId }, "9:16", "s1"), durationSec: 2.5 },
  ];
  r.clips[0] = { ...r.clips[0], inSec: 1, outSec: 5 };
  return r;
}

const pushes = (env: Env) =>
  env.t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect())
      .filter((j) => j.name.includes("notifyAdmins"))
      .map((j) => j.args[0] as { title: string; body: string; url: string }),
  );

async function settle(env: Env) {
  vi.useFakeTimers();
  await env.t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.useRealTimers();
}

beforeEach(() => {
  for (const [k, val] of Object.entries(ENV)) vi.stubEnv(k, val);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("reel drafts in the Studio", () => {
  it("admins create, read, edit, copy and delete drafts", async () => {
    const env = await setup();
    const recipe = studioRecipe(env);
    await expect(env.maker.mutation(api.reels.create, { recipe })).rejects.toThrow(/admin/);

    const d = await env.admin.mutation(api.reels.create, { recipe });
    expect(d).toMatchObject({
      title: "Paper Weather and 1 more",
      status: "draft",
      createdBy: "studio",
      listingIds: [env.listingId, env.otherId],
      aspect: "9:16",
      clipCount: 2,
      durationSec: 6.1, // 4 s + 2.5 s - 0.4 s crossfade
      cover: { kind: "video", url: `${PUB}/${PREVIEW_KEY}` },
      renderedUrl: null,
      problems: [],
      postId: null,
    });
    expect(d.recipe).toEqual(recipe);
    expect(await env.admin.query(api.reels.get, { id: d.id })).toEqual(d);
    expect((await env.admin.query(api.reels.list, {})).map((x) => x.id)).toEqual([d.id]);

    const bad = { ...recipe, clips: [{ ...recipe.clips[0], inSec: 6, outSec: 5 }] };
    await expect(env.admin.mutation(api.reels.create, { recipe: bad })).rejects.toThrow("Clip 1: the end must be after the start.");

    const renamed = await env.admin.mutation(api.reels.update, { id: d.id, title: "  Friday   reel ", baseUpdatedAt: d.updatedAt });
    expect(renamed).toMatchObject({ title: "Friday reel", status: "draft" });
    expect(renamed.updatedAt).toBeGreaterThan(d.updatedAt);
    await expect(env.admin.mutation(api.reels.update, { id: d.id, title: "Late", baseUpdatedAt: d.updatedAt })).rejects.toThrow(
      /changed since you opened it/,
    );
    const shorter = await env.admin.mutation(api.reels.update, { id: d.id, recipe: { ...recipe, clips: [recipe.clips[1]] } });
    expect(shorter).toMatchObject({ listingIds: [env.otherId], clipCount: 1, durationSec: 2.5, cover: { kind: "image", url: COVER } });

    const copy = await env.admin.mutation(api.reels.duplicate, { id: d.id });
    expect(copy).toMatchObject({ title: "Friday reel (copy)", status: "draft", renderedUrl: null });
    await env.admin.mutation(api.reels.remove, { id: d.id });
    expect(await env.admin.query(api.reels.get, { id: d.id })).toBeNull();
    expect((await env.admin.query(api.reels.list, {})).map((x) => x.id)).toEqual([copy.id]);
  });

  it("lists sources: listings, a listing's video and screenshots", async () => {
    const env = await setup();
    await expect(env.maker.query(api.reels.listings, {})).rejects.toThrow(/admin/);
    expect((await env.admin.query(api.reels.listings, {})).map((l) => [l.slug, l.hasVideo, l.coverUrl])).toEqual([
      ["floema", false, COVER],
      ["paper-weather", true, COVER],
    ]);
    expect((await env.admin.query(api.reels.listings, { text: "PAPER" })).map((l) => l.slug)).toEqual(["paper-weather"]);
    const sources = await env.admin.query(api.reels.listingSources, { listingId: env.listingId });
    expect(sources).toMatchObject({
      slug: "paper-weather",
      video: { url: `${PUB}/${PREVIEW_KEY}`, width: 1280, height: 720, durationSec: 12 },
      screenshots: [
        { url: COVER, width: 1600, height: 1000 },
        { url: SHOT2, width: 1600, height: 1000 },
      ],
    });
    expect((await env.admin.query(api.reels.listingSources, { listingId: env.otherId }))?.video).toBeNull();
  });
});

describe("reel drafts from Claude (MCP)", () => {
  it("fills sources from slugs, marks the draft ready and pushes", async () => {
    const env = await setup();
    await expect(env.t.mutation(api.mcp.createReelDraft, { token: "nope", recipe: {} })).rejects.toThrow(/Not signed in/);
    const d = await env.t.mutation(api.mcp.createReelDraft, {
      token: env.token,
      title: "SOTD reel",
      note: "For Friday",
      recipe: {
        clips: [
          { source: { kind: "listingVideo", listingSlug: "paper-weather" }, inSec: 2, outSec: 6 },
          { source: { kind: "screenshot", listingSlug: "paper-weather", shot: 1 }, text: { text: "Quiet sites" }, transitionIn: { type: "morph" } },
        ],
        audio: { voice: { script: SPOKEN, voice: "Nino" } },
      },
    });
    expect(d).toMatchObject({ title: "SOTD reel", note: "For Friday", status: "ready", createdBy: "claude", listingIds: [env.listingId] });
    expect(d.recipe.clips[0].source).toMatchObject({
      kind: "listingVideo",
      url: `${PUB}/${PREVIEW_KEY}`,
      listingId: env.listingId,
      listingSlug: "paper-weather",
      label: "Paper Weather",
      width: 1280,
      height: 720,
      durationSec: 12,
    });
    expect(d.recipe.clips[1].source).toMatchObject({ url: SHOT2, width: 1600, height: 1000 });
    expect(d.recipe.clips[1]).toMatchObject({ motion: "zoomIn", fit: "blur", text: { on: true, text: "Quiet sites" }, transitionIn: { type: "morph", durationSec: 0.4 } });
    expect(d.problems).toEqual(["Voice: the script is not voiced yet. Generate the voice first, or turn the voice off."]);
    expect(await pushes(env)).toEqual([
      { title: "Reel draft ready to render", body: "SOTD reel: 2 clips, 7 s. Open it to check and render.", url: `https://studio.shemoqmedi.space/reels?draft=${d.id}`, tag: `reel-${d.id}` },
    ]);

    await expect(
      env.t.mutation(api.mcp.createReelDraft, { token: env.token, recipe: { clips: [{ source: { kind: "listingVideo", listingSlug: "nope" } }] } }),
    ).rejects.toThrow(/no listing with the slug "nope"/);
    await expect(
      env.t.mutation(api.mcp.createReelDraft, { token: env.token, recipe: { clips: [{ source: { kind: "listingVideo", listingSlug: "floema" } }] } }),
    ).rejects.toThrow(/"Floema" has no preview video/);
    await expect(
      env.t.mutation(api.mcp.createReelDraft, { token: env.token, recipe: { clips: [{ source: { kind: "screenshot", listingSlug: "floema", shot: 3 } }] } }),
    ).rejects.toThrow(/has 1 screenshots \(shot 0-0\)/);
    await expect(env.t.mutation(api.mcp.createReelDraft, { token: env.token, recipe: { clips: "x" } })).rejects.toThrow(/clips list/);

    // Changing it: ready again, no second push while it is still ready.
    const changed = await env.t.mutation(api.mcp.updateReelDraft, {
      token: env.token,
      id: d.id,
      recipe: { ...d.recipe, clips: d.recipe.clips.slice(0, 1) },
    });
    expect(changed).toMatchObject({ status: "ready", clipCount: 1 });
    expect(changed.recipe.clips[0].id).toBe(d.recipe.clips[0].id);
    expect(await pushes(env)).toHaveLength(1);
    expect(await env.t.query(api.mcp.getReelDraft, { token: env.token, id: d.id })).toEqual(changed);
    expect((await env.t.query(api.mcp.listReelDrafts, { token: env.token, status: "ready" })).map((x) => x.id)).toEqual([d.id]);
    expect(await env.t.query(api.mcp.listReelDrafts, { token: env.token, status: "rendered" })).toEqual([]);

    // Giorgi edits it in the Studio: a draft again.
    const edited = { ...changed.recipe, fades: { ...changed.recipe.fades, videoOutSec: 1 } };
    expect((await env.admin.mutation(api.reels.update, { id: d.id, recipe: edited })).status).toBe("draft");
  });
});

describe("narration with captions", () => {
  it("voices a script with word timings, keeps it to reuse, admins only", async () => {
    const { calls, stored } = fakeServices();
    const env = await setup();
    await expect(env.maker.action(api.voiceover.generateTimed, { script: SPOKEN, voice: "Nino" })).rejects.toThrow(/admin/);
    await expect(env.admin.action(api.voiceover.generateTimed, { script: "  ", voice: "Nino" })).rejects.toThrow(/empty/);
    await expect(env.admin.action(api.voiceover.generateTimed, { script: SPOKEN, voice: "Giorgi" })).rejects.toThrow(/Unknown voice/);
    expect(eleven(calls)).toHaveLength(0);

    const n = await env.admin.action(api.voiceover.generateTimed, { script: SPOKEN, voice: "nino", listingId: env.listingId });
    const tts = eleven(calls);
    expect(tts).toHaveLength(1);
    expect(tts[0].url.pathname).toBe(`/v1/text-to-speech/${NINO}/with-timestamps`);
    expect(tts[0].url.searchParams.get("output_format")).toBe("mp3_44100_128");
    expect(JSON.parse(tts[0].body)).toEqual({ text: SPOKEN, model_id: "eleven_multilingual_v2" });
    expect(n.url).toMatch(/^https:\/\/pub-test\.r2\.dev\/social\/paper-weather\/paper-weather-voiceover-[a-f0-9]{10}\.mp3$/);
    expect(stored.get(n.url.replace(`${PUB}/`, ""))).toEqual({ size: FAKE_MP3.length, type: "audio/mpeg" });
    expect(n).toMatchObject({ durationSec: 2, script: SPOKEN, voice: "Nino", listingId: env.listingId });
    expect(n.words?.map((w) => w.text)).toEqual(["Paper", "Weather", "builds", "quiet", "sites."]);
    expect(n.words?.[1]).toEqual({ text: "Weather", startSec: 0.3, endSec: 0.64 });

    const loose = await env.admin.action(api.voiceover.generateTimed, { script: "Hello.", voice: "Nino" });
    expect(loose.url).toMatch(/\/social\/reels\/reels-voiceover-[a-f0-9]{10}\.mp3$/);

    const list = await env.admin.query(api.voiceover.narrations, {});
    expect(list.map((x) => x.id)).toEqual([loose.id, n.id]);
    expect(list[1]).toEqual({ ...n, createdAt: list[1].createdAt });
    expect((await env.admin.query(api.voiceover.narrations, { listingId: env.listingId })).map((x) => x.id)).toEqual([n.id]);
    await expect(env.maker.query(api.voiceover.narrations, {})).rejects.toThrow(/admin/);

    // The quick reel's narration (create_voiceover) is kept too, without timings.
    const quick = await env.t.action(internal.voiceover.create, { listingId: env.listingId, script: SPOKEN, voice: "Nino" });
    expect(quick.narrationId).toBeTruthy();
    expect((await env.admin.query(api.voiceover.narrations, {}))[0]).toMatchObject({ id: quick.narrationId, words: null, script: SPOKEN });

    // Claude points a draft at it: URL, length and evenly spread captions are filled in.
    const d = await env.t.mutation(api.mcp.createReelDraft, {
      token: env.token,
      recipe: { clips: [{ source: { kind: "listingVideo", listingSlug: "paper-weather" } }], audio: { voice: { narrationId: quick.narrationId } } },
    });
    expect(d.recipe.audio.voice).toMatchObject({ url: quick.audioUrl, durationSec: 2, script: SPOKEN, voice: "Nino", captions: { on: true } });
    expect(d.recipe.audio.voice?.captions.lines.map((l) => l.text).join(" ")).toBe(SPOKEN);
    expect(d.problems).toEqual([]);
    await expect(
      env.t.mutation(api.mcp.createReelDraft, {
        token: env.token,
        recipe: { clips: [{ source: { kind: "graphic", url: COVER } }], audio: { voice: { narrationId: "nope" } } },
      }),
    ).rejects.toThrow(/no narration with that narrationId/);
  });
});

describe("uploads from the device", () => {
  it("presigns clip and music uploads, registers them and checks them on R2", async () => {
    const { stored } = fakeServices();
    const env = await setup();
    await expect(env.maker.action(api.reels.uploadUrl, { contentType: "video/mp4", size: 10 })).rejects.toThrow(/admin/);
    await expect(env.admin.action(api.reels.uploadUrl, { contentType: "image/gif", size: 10 })).rejects.toThrow(/Upload an MP4/);
    await expect(env.admin.action(api.reels.uploadUrl, { contentType: "video/mp4", size: 300 * 1024 * 1024 })).rejects.toThrow(/200 MB/);

    const clip = await env.admin.action(api.reels.uploadUrl, { contentType: "video/quicktime", size: 5000, listingId: env.listingId });
    expect(clip.kind).toBe("clip");
    expect(clip.key).toMatch(/^social\/paper-weather\/paper-weather-clip-[a-f0-9]{10}\.mov$/);
    expect(new URL(clip.uploadUrl).pathname).toBe(`/shemoqmedi-media/${clip.key}`);
    expect(clip.url).toBe(`${PUB}/${clip.key}`);
    const song = await env.admin.action(api.reels.uploadUrl, { contentType: "audio/mpeg", size: 3000 });
    expect(song.key).toMatch(/^social\/reels\/reels-music-[a-f0-9]{10}\.mp3$/);

    for (const key of [PREVIEW_KEY, "social/paper-weather/paper-weather-reel-0123456789.mp4"]) {
      await expect(env.admin.mutation(api.reels.registerUpload, { key, contentType: "video/mp4", size: 10 })).rejects.toThrow(/did not come from the reel editor/);
    }
    await expect(env.admin.mutation(api.reels.registerUpload, { key: clip.key, contentType: "video/mp4", size: 10 })).rejects.toThrow(/does not match/);
    await expect(env.admin.mutation(api.reels.registerUpload, { key: song.key, contentType: "video/quicktime", size: 10 })).rejects.toThrow(/does not match/);

    stored.set(clip.key, { size: 5000, type: "video/quicktime" });
    const c = await env.admin.mutation(api.reels.registerUpload, { key: clip.key, contentType: "video/quicktime", size: 5000, width: 1080, height: 1920, durationSec: 7.123 });
    expect(c).toMatchObject({ kind: "clip", url: clip.url, audioId: null });
    expect((await env.admin.mutation(api.reels.registerUpload, { key: clip.key, contentType: "video/quicktime", size: 5000 })).mediaId).toBe(c.mediaId);
    // Music never reaches R2: flagged and hidden after the check.
    const m = await env.admin.mutation(api.reels.registerUpload, { key: song.key, contentType: "audio/mpeg", size: 3000, durationSec: 30, title: "  Night   drive " });
    expect(m).toMatchObject({ kind: "music", mediaId: null });
    expect(await env.admin.query(api.reels.music, {})).toEqual([
      { id: m.audioId, url: song.url, title: "Night drive", durationSec: 30, size: 3000, createdAt: expect.any(Number) },
    ]);
    await settle(env);
    expect(await env.admin.query(api.reels.uploads, {})).toEqual([
      { id: c.mediaId, url: clip.url, contentType: "video/quicktime", size: 5000, width: 1080, height: 1920, durationSec: 7.12, createdAt: expect.any(Number) },
    ]);
    expect(await env.admin.query(api.reels.music, {})).toEqual([]);
    expect((await env.t.run((ctx) => ctx.db.get(m.audioId!)))?.invalid).toBe(true);
  });
});

describe("the rendered reel", () => {
  it("registers the render with its recipe, marks the draft rendered and opens again from the post", async () => {
    const { stored } = fakeServices();
    const env = await setup();
    const recipe = studioRecipe(env);
    const d = await env.admin.mutation(api.reels.create, { recipe });

    await expect(env.admin.action(api.reels.renderUploadUrl, { size: 101 * 1024 * 1024, draftId: d.id })).rejects.toThrow(/100 MB/);
    const { key } = await env.admin.action(api.reels.renderUploadUrl, { size: 4_000_000, draftId: d.id });
    expect(key).toMatch(/^social\/paper-weather\/paper-weather-reel-[a-f0-9]{10}\.mp4$/);
    expect((await env.admin.action(api.reels.renderUploadUrl, { size: 10 })).key).toMatch(/^social\/reels\/reels-reel-/);

    const unvoiced = { ...recipe, audio: { ...recipe.audio, voice: defaultVoice({ script: "Not voiced" }) } };
    const args = { key, size: 4_000_000, width: 1080, height: 1920, durationSec: 6.1, draftId: d.id, draftUpdatedAt: d.updatedAt };
    await expect(env.admin.mutation(api.reels.registerRender, { ...args, recipe: unvoiced })).rejects.toThrow(/not voiced yet/);
    await expect(env.admin.mutation(api.reels.registerRender, { ...args, key: PREVIEW_KEY, recipe })).rejects.toThrow(/not a reel upload/);
    await expect(env.maker.mutation(api.reels.registerRender, { ...args, recipe })).rejects.toThrow(/admin/);

    stored.set(key, { size: 4_000_000, type: "video/mp4" });
    const { mediaId, url } = await env.admin.mutation(api.reels.registerRender, { ...args, recipe });
    expect(url).toBe(`${PUB}/${key}`);
    const view = await env.admin.query(api.reels.get, { id: d.id });
    expect(view).toMatchObject({ status: "rendered", renderedUrl: url, mediaId });
    const [detail] = await env.admin.query(api.media.designs, { urls: [url] });
    expect(detail).toMatchObject({ mediaId, kind: "video", width: 1080, height: 1920, durationSec: 6.1 });
    expect(detail.design).toEqual({ kind: "reel", recipe, draftId: d.id, title: "Paper Weather and 1 more" });
    // It is a reel for the MCP tools too.
    expect(await env.t.query(api.mcp.findReel, { token: env.token, listingSlug: "paper-weather" })).toMatchObject({ role: "reel", url });
    await settle(env);
    expect((await env.t.run((ctx) => ctx.db.get(mediaId)))?.invalid).toBeUndefined();

    // "Edit reel" on the post's video opens the same draft; editing it needs a new render.
    expect(await env.admin.mutation(api.reels.openFromMedia, { url })).toBe(d.id);
    expect(await env.admin.mutation(api.reels.openFromMedia, { url: COVER })).toBeNull();
    const edited = await env.admin.mutation(api.reels.update, { id: d.id, recipe: { ...recipe, fades: { ...recipe.fades, videoOutSec: 1 } } });
    expect(edited).toMatchObject({ status: "draft", renderedUrl: url });

    // With the draft gone, a new one is made from the reel's recipe (already rendered).
    await env.admin.mutation(api.reels.remove, { id: d.id });
    const again = await env.admin.mutation(api.reels.openFromMedia, { url });
    expect(again).not.toBe(d.id);
    expect(await env.admin.query(api.reels.get, { id: again! })).toMatchObject({ status: "rendered", mediaId, renderedUrl: url, recipe });
  });

  it("a render made while the draft changed keeps the newer edit's status", async () => {
    fakeServices();
    const env = await setup();
    const recipe = studioRecipe(env);
    const d = await env.admin.mutation(api.reels.create, { recipe });
    const later = await env.admin.mutation(api.reels.update, { id: d.id, recipe: { ...recipe, fades: { ...recipe.fades, videoOutSec: 1 } } });
    const { key } = await env.admin.action(api.reels.renderUploadUrl, { size: 10, draftId: d.id });
    const { url } = await env.admin.mutation(api.reels.registerRender, {
      key,
      size: 10,
      width: 1080,
      height: 1920,
      durationSec: 6,
      recipe,
      draftId: d.id,
      draftUpdatedAt: d.updatedAt,
    });
    expect(later.updatedAt).not.toBe(d.updatedAt);
    expect(await env.admin.query(api.reels.get, { id: d.id })).toMatchObject({ status: "draft", renderedUrl: url });
  });

  it("a rename or the same recipe sent again keeps a rendered reel rendered", async () => {
    fakeServices();
    const env = await setup();
    const recipe = studioRecipe(env);
    const d = await env.admin.mutation(api.reels.create, { recipe });
    // Renamed while it rendered: the render still matches the recipe.
    await env.admin.mutation(api.reels.update, { id: d.id, title: "Renamed" });
    const { key } = await env.admin.action(api.reels.renderUploadUrl, { size: 10, draftId: d.id });
    const { url } = await env.admin.mutation(api.reels.registerRender, { key, size: 10, width: 1080, height: 1920, durationSec: 6, recipe, draftId: d.id, draftUpdatedAt: d.updatedAt });
    expect(await env.admin.query(api.reels.get, { id: d.id })).toMatchObject({ status: "rendered", renderedUrl: url });
    // The editor's autosave sends the unchanged recipe with a new title; Claude sends it with a note.
    const view = (await env.admin.query(api.reels.get, { id: d.id }))!;
    await env.admin.mutation(api.reels.update, { id: d.id, recipe: view.recipe, title: "Renamed again" });
    expect(await env.admin.query(api.reels.get, { id: d.id })).toMatchObject({ status: "rendered", title: "Renamed again" });
  });

  it("Edit reel on a reel whose draft is gone makes one draft, then reopens it", async () => {
    const { stored } = fakeServices();
    const env = await setup();
    const recipe = studioRecipe(env);
    const d = await env.admin.mutation(api.reels.create, { recipe });
    const { key } = await env.admin.action(api.reels.renderUploadUrl, { size: 10, draftId: d.id });
    stored.set(key, { size: 10, type: "video/mp4" });
    const { url } = await env.admin.mutation(api.reels.registerRender, { key, size: 10, width: 1080, height: 1920, durationSec: 6, recipe, draftId: d.id });
    await env.admin.mutation(api.reels.remove, { id: d.id });
    const first = await env.admin.mutation(api.reels.openFromMedia, { url });
    const second = await env.admin.mutation(api.reels.openFromMedia, { url });
    expect(first).not.toBe(d.id);
    expect(second).toBe(first);
    const [detail] = await env.admin.query(api.media.designs, { urls: [url] });
    expect(detail.design).toMatchObject({ kind: "reel", draftId: first });
  });
});

describe("attach_reel", () => {
  it("puts a rendered draft's reel into a post, never before it is rendered", async () => {
    const { stored } = fakeServices();
    const env = await setup();
    const recipe = studioRecipe(env);
    const d = await env.admin.mutation(api.reels.create, { recipe });
    const post = await env.t.mutation(api.mcp.createPost, { token: env.token, kind: "custom", media: [{ kind: "image", url: COVER, role: "screenshot" }] });
    await expect(env.t.mutation(api.mcp.attachReel, { token: env.token, postId: post.id, draftId: d.id })).rejects.toThrow(/not rendered yet/);

    const { key } = await env.admin.action(api.reels.renderUploadUrl, { size: 10, draftId: d.id });
    // The file is in storage (the render's check after upload finds it).
    stored.set(key, { size: 10, type: "video/mp4" });
    const { url } = await env.admin.mutation(api.reels.registerRender, {
      key,
      size: 10,
      width: 1080,
      height: 1920,
      durationSec: 6.1,
      recipe,
      draftId: d.id,
      draftUpdatedAt: d.updatedAt,
    });
    const reel = { kind: "video", url, role: "reel" };
    const kept = await env.t.mutation(api.mcp.attachReel, { token: env.token, postId: post.id, draftId: d.id, keepOthers: true });
    expect(kept.media).toEqual([reel, { kind: "image", url: COVER, role: "screenshot" }]);
    // Never a second copy, never an item silently dropped.
    await expect(env.t.mutation(api.mcp.attachReel, { token: env.token, postId: post.id, draftId: d.id, keepOthers: true })).rejects.toThrow(/already in the post/);
    const full = await env.t.mutation(api.mcp.createPost, {
      token: env.token,
      kind: "custom",
      media: Array.from({ length: 10 }, (_, i) => ({ kind: "image" as const, url: `${COVER}?n=${i}`, role: "screenshot" })),
    });
    await expect(env.t.mutation(api.mcp.attachReel, { token: env.token, postId: full.id, draftId: d.id, keepOthers: true })).rejects.toThrow(/10 media items/);
    await expect(env.t.mutation(api.mcp.attachReel, { token: env.token, postId: post.id, draftId: d.id, replaceIndex: 5 })).rejects.toThrow(
      /replaceIndex is 0-1/,
    );
    const swapped = await env.t.mutation(api.mcp.attachReel, { token: env.token, postId: post.id, draftId: d.id, replaceIndex: 1, networks: ["instagram"] });
    expect(swapped.media).toEqual([reel, { ...reel, networks: ["instagram"] }]);
    const only = await env.t.mutation(api.mcp.attachReel, { token: env.token, postId: post.id, draftId: d.id });
    expect(only.media).toEqual([reel]);
    expect((await env.admin.query(api.reels.get, { id: d.id }))?.postId).toBe(post.id);

    // A 9:16 reel of 3-60 s can be a story.
    const story = await env.t.mutation(api.mcp.createPost, { token: env.token, kind: "custom", placement: "story" });
    expect((await env.t.mutation(api.mcp.attachReel, { token: env.token, postId: story.id, draftId: d.id })).media).toEqual([reel]);

    // Changed since the render: refused until it is rendered again.
    await env.admin.mutation(api.reels.update, { id: d.id, recipe: { ...recipe, fades: { ...recipe.fades, audioInSec: 1 } } });
    await expect(env.t.mutation(api.mcp.attachReel, { token: env.token, postId: post.id, draftId: d.id })).rejects.toThrow(
      /changed since its last render/,
    );
    // The Studio uses social.update with the render's URL (the editor's "Use in a post").
    const viaStudio = await env.admin.mutation(api.social.update, {
      id: post.id as Id<"socialPosts">,
      media: [reel as { kind: "video"; url: string; role: string }],
      baseMedia: [url],
    });
    expect(viaStudio.mediaDetails[0].design).toMatchObject({ kind: "reel", draftId: d.id });
  });
});
