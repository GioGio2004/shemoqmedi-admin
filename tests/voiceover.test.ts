/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { R2_KEY, R2_LISTING_KEY, R2_SOCIAL_KEY } from "../convex/lib/r2";
import {
  MAX_SCRIPT_CHARS,
  cleanScript,
  mp4Duration,
  parseVoices,
  resolveVoice,
  socialKey,
  targetWords,
  urlRangeReader,
} from "../convex/lib/voiceover";

const modules = import.meta.glob("../convex/**/*.{ts,js}");

const NINO = "21m00Tcm4TlvDq8ikWAM";
const LUKA = "pNInz6obpgDQGcFmaJgB";
const VOICES = JSON.stringify({ Nino: NINO, Luka: LUKA });

// ─────────────────────────────────────────────────────────────────────────────
// Voice map
// ─────────────────────────────────────────────────────────────────────────────

describe("ELEVENLABS_VOICES", () => {
  it("parses a name → voice id map, trimming names", () => {
    expect(parseVoices(VOICES)).toEqual([
      { name: "Nino", voiceId: NINO },
      { name: "Luka", voiceId: LUKA },
    ]);
    expect(parseVoices(JSON.stringify({ "  Ana ": NINO }))).toEqual([{ name: "Ana", voiceId: NINO }]);
  });

  it("explains what is wrong", () => {
    expect(() => parseVoices(undefined)).toThrow(/not set/);
    expect(() => parseVoices("  ")).toThrow(/not set/);
    expect(() => parseVoices("Nino=abc")).toThrow(/must be JSON/);
    expect(() => parseVoices(JSON.stringify([NINO]))).toThrow(/JSON object/);
    expect(() => parseVoices("null")).toThrow(/JSON object/);
    expect(() => parseVoices("{}")).toThrow(/no voices/);
    expect(() => parseVoices(JSON.stringify({ Nino: 42 }))).toThrow(/"Nino" does not look like/);
    expect(() => parseVoices(JSON.stringify({ Nino: "has spaces in it" }))).toThrow(/does not look like/);
    expect(() => parseVoices(JSON.stringify({ " ": NINO }))).toThrow(/not a usable narrator name/);
    expect(() => parseVoices(JSON.stringify({ Nino: NINO, " nino": LUKA }))).toThrow(/listed twice/);
    const eleven = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`V${i}`, NINO]));
    expect(() => parseVoices(JSON.stringify(eleven))).toThrow(/10 voices/);
  });

  it("resolves a narrator by name (any case) or voice id", () => {
    const voices = parseVoices(VOICES);
    expect(resolveVoice(voices, "luka").voiceId).toBe(LUKA);
    expect(resolveVoice(voices, " NINO ").voiceId).toBe(NINO);
    expect(resolveVoice(voices, LUKA).name).toBe("Luka");
    expect(() => resolveVoice(voices, "Giorgi")).toThrow(/Use one of: Nino, Luka/);
  });

  it("checks the script and sizes it to the video", () => {
    expect(cleanScript("  Paper   Weather,\n a studio  ")).toBe("Paper Weather, a studio");
    expect(() => cleanScript(" \n ")).toThrow(/empty/);
    expect(() => cleanScript("a".repeat(MAX_SCRIPT_CHARS + 1))).toThrow(/keep it under/);
    expect(targetWords(12)).toBe(30);
    expect(targetWords(0.1)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R2 keys
// ─────────────────────────────────────────────────────────────────────────────

describe("R2 keys", () => {
  it("accepts listing videos and social narration / reels", () => {
    for (const key of [
      "listings/paper-weather/paper-weather-website-preview-0123456789.mp4",
      "listings/a/a.webm",
      "social/paper-weather/paper-weather-voiceover-0123456789.mp3",
      "social/paper-weather/paper-weather-reel-0123456789.mp4",
    ]) {
      expect(R2_KEY.test(key), key).toBe(true);
    }
  });

  it("refuses anything else", () => {
    for (const key of [
      "social/a/a.webm",
      "social/a/a.mov",
      "listings/a/a.mp3",
      "social/../a/a.mp4",
      "social/a/../a.mp4",
      "social/A/a.mp4",
      "social/a/b/c.mp4",
      "social/a.mp4",
      "other/a/a.mp4",
      "xsocial/a/a.mp4",
      "social/a/a.mp4x",
      "listings/a/a.mp4\nsocial/a/a.mp4",
    ]) {
      expect(R2_KEY.test(key), key).toBe(false);
    }
  });

  it("keeps listing and social keys apart", () => {
    expect(R2_LISTING_KEY.test("social/a/a.mp4")).toBe(false);
    expect(R2_SOCIAL_KEY.test("listings/a/a.mp4")).toBe(false);
  });

  it("makes fresh social keys", () => {
    const a = socialKey("Paper Weather", "voiceover", "mp3");
    expect(a).toMatch(/^social\/paper-weather\/paper-weather-voiceover-[a-f0-9]{10}\.mp3$/);
    expect(socialKey("paper-weather", "voiceover", "mp3")).not.toBe(a);
    expect(R2_SOCIAL_KEY.test(socialKey("x", "reel", "mp4"))).toBe(true);
  });

  it("a social key cannot be registered as a listing's preview video", async () => {
    vi.stubEnv("R2_PUBLIC_URL", "https://pub-test.r2.dev");
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("users", { externalId: "maker", name: "Maker", email: "m@example.com", createdAt: 0, updatedAt: 0 }),
    );
    await expect(
      t.withIdentity({ subject: "maker" }).mutation(api.media.registerVideo, {
        key: "social/a/a-reel-0123456789.mp4",
        contentType: "video/mp4",
        size: 10,
      }),
    ).rejects.toThrow(/did not come from this site/);
    vi.unstubAllEnvs();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MP4 duration
// ─────────────────────────────────────────────────────────────────────────────

function box(type: string, payload: Uint8Array) {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set([...type].map((c) => c.charCodeAt(0)), 4);
  out.set(payload, 8);
  return out;
}

function mvhd(timescale: number, duration: number, version: 0 | 1 = 0) {
  const p = new Uint8Array(version === 1 ? 112 : 100);
  const d = new DataView(p.buffer);
  p[0] = version;
  if (version === 1) {
    d.setUint32(20, timescale);
    d.setBigUint64(24, BigInt(duration));
  } else {
    d.setUint32(12, timescale);
    d.setUint32(16, duration);
  }
  return box("mvhd", p);
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

function mp4({ seconds, moovLast = false, version = 0 }: { seconds: number; moovLast?: boolean; version?: 0 | 1 }) {
  const ftyp = box("ftyp", new TextEncoder().encode("isom\0\0\x02\0isomiso2avc1mp41"));
  const moov = box("moov", concat(mvhd(1000, Math.round(seconds * 1000), version), box("trak", new Uint8Array(40))));
  const mdat = box("mdat", new Uint8Array(5000));
  return moovLast ? concat(ftyp, mdat, moov) : concat(ftyp, moov, mdat);
}

const memoryReader = (bytes: Uint8Array) => {
  const reads: [number, number][] = [];
  const read = async (offset: number, length: number) => {
    reads.push([offset, length]);
    return bytes.subarray(offset, offset + length);
  };
  return { read, reads };
};

/** A fetch that serves `bytes` with Range support. */
function rangeServer(bytes: Uint8Array, honourRange = true) {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const range = new Headers(init?.headers).get("range");
    const m = range && /bytes=(\d+)-(\d+)/.exec(range);
    if (!honourRange || !m) return new Response(bytes.slice(), { status: 200 });
    const start = Number(m[1]);
    if (start >= bytes.length) return new Response(null, { status: 416 });
    return new Response(bytes.slice(start, Number(m[2]) + 1), { status: 206 });
  });
}

describe("mp4Duration", () => {
  it("reads mvhd from a faststart file in two small reads", async () => {
    const { read, reads } = memoryReader(mp4({ seconds: 12.5 }));
    expect(await mp4Duration(read)).toBe(12.5);
    expect(reads.length).toBe(3); // ftyp header, moov header, moov
  });

  it("walks past mdat when moov is at the end, and reads version 1", async () => {
    expect(await mp4Duration(memoryReader(mp4({ seconds: 31.25, moovLast: true })).read)).toBe(31.25);
    expect(await mp4Duration(memoryReader(mp4({ seconds: 7, version: 1 })).read)).toBe(7);
  });

  it("returns null for anything that is not an MP4", async () => {
    expect(await mp4Duration(memoryReader(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0])).read)).toBeNull();
    expect(await mp4Duration(memoryReader(new Uint8Array(4)).read)).toBeNull();
  });

  it("reads over HTTP with Range, or once when the server ignores Range", async () => {
    const bytes = mp4({ seconds: 9, moovLast: true });
    const ranged = rangeServer(bytes);
    expect(await mp4Duration(urlRangeReader("https://x/v.mp4", ranged as unknown as typeof fetch))).toBe(9);
    const whole = rangeServer(bytes, false);
    expect(await mp4Duration(urlRangeReader("https://x/v.mp4", whole as unknown as typeof fetch))).toBe(9);
    expect(whole).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Actions (fetch mocked: no ElevenLabs credits, no R2, no worker)
// ─────────────────────────────────────────────────────────────────────────────

const ENV = {
  R2_ACCOUNT_ID: "acct123",
  R2_ACCESS_KEY_ID: "AKIATEST",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "shemoqmedi-media",
  R2_PUBLIC_URL: "https://pub-test.r2.dev",
  ELEVENLABS_API_KEY: "xi-test",
  ELEVENLABS_VOICES: VOICES,
  RENDER_WORKER_URL: "https://render.example.test/",
  RENDER_WORKER_KEY: "render-key-0123456789",
};

const PREVIEW_KEY = "listings/paper-weather/paper-weather-website-preview-0123456789.mp4";

async function setupListing(withVideo = true) {
  const t = convexTest(schema, modules);
  const listingId = await t.run(async (ctx) => {
    const cover = await ctx.db.insert("media", {
      fileId: "cover123",
      url: "https://ik.imagekit.io/x/listings/paper-weather/cover.webp",
      filePath: "/listings/paper-weather/cover.webp",
      kind: "image",
      contentType: "image/webp",
      size: 100,
      createdAt: 0,
    });
    const video = withVideo
      ? await ctx.db.insert("media", {
          store: "r2",
          fileId: PREVIEW_KEY,
          url: `https://pub-test.r2.dev/${PREVIEW_KEY}`,
          filePath: `/${PREVIEW_KEY}`,
          kind: "video",
          contentType: "video/mp4",
          size: 5000,
          createdAt: 0,
        })
      : undefined;
    return await ctx.db.insert("listings", {
      source: "import",
      submissionTier: "standard",
      slug: "paper-weather",
      title: "Paper Weather",
      tagline: "A studio site",
      url: "https://paperweather.example",
      category: "portfolio",
      technologies: [],
      region: "georgia",
      creatorTier: "agency",
      creditName: "Paper Weather",
      coverId: cover,
      videoId: video,
      status: "in_voting",
      communityTotals: { design: 0, usability: 0, creativity: 0 },
      communityVotesCount: 0,
      awards: [],
      isClaimed: false,
      createdAt: 0,
      updatedAt: 0,
    });
  });
  return { t, listingId };
}

type Call = { method: string; url: URL; headers: Headers; body: string };

/** Routes every outgoing request of the voiceover flow; records them. */
function fakeServices(opts: { workerStatus?: number; stored?: boolean } = {}) {
  const calls: Call[] = [];
  const stored = new Map<string, { size: number; type: string }>();
  const preview = mp4({ seconds: 12 });
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    const body = req.method === "GET" || req.method === "HEAD" ? "" : await req.clone().text();
    calls.push({ method: req.method, url, headers: req.headers, body });

    if (url.host === "api.elevenlabs.io" && url.pathname.startsWith("/v1/text-to-speech/")) {
      return new Response(new Uint8Array(4096), { headers: { "content-type": "audio/mpeg" } });
    }
    if (url.host === "api.elevenlabs.io" && url.pathname.startsWith("/v1/voices/")) {
      const id = url.pathname.split("/").pop();
      if (id === LUKA) return new Response("nope", { status: 404 });
      return Response.json({ voice_id: id, description: "Warm", preview_url: `https://cdn.example/${id}.mp3` });
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
    if (url.host === "render.example.test" && url.pathname === "/mux") {
      if (opts.workerStatus) return Response.json({ error: "ffmpeg exploded" }, { status: opts.workerStatus });
      const { putUrl } = JSON.parse(body) as { putUrl: string };
      const key = decodeURIComponent(new URL(putUrl).pathname.replace("/shemoqmedi-media/", ""));
      if (opts.stored !== false) stored.set(key, { size: 2_000_000, type: "video/mp4" });
      return Response.json({ durationSec: 14.6, size: 2_000_000, width: 1280, height: 720 });
    }
    if (url.host === "pub-test.r2.dev") {
      return rangeServer(preview)(url, { headers: req.headers });
    }
    return new Response(`unexpected ${req.method} ${url}`, { status: 599 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, stored, fetchMock };
}

describe("voiceover actions", () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("listVoices names every narrator, with samples when ElevenLabs has them", async () => {
    fakeServices();
    const t = convexTest(schema, modules);
    const out = await t.action(internal.voiceover.listVoices, {});
    expect(out).toEqual({
      wordsPerSecond: 2.5,
      voices: [
        { name: "Nino", voiceId: NINO, description: "Warm", previewUrl: `https://cdn.example/${NINO}.mp3` },
        { name: "Luka", voiceId: LUKA },
      ],
    });
  });

  it("videoInfo reads the preview's length and the word budget", async () => {
    const { calls } = fakeServices();
    const { t, listingId } = await setupListing();
    expect(await t.action(internal.voiceover.videoInfo, { listingId })).toEqual({
      title: "Paper Weather",
      videoUrl: `https://pub-test.r2.dev/${PREVIEW_KEY}`,
      durationSec: 12,
      wordsPerSecond: 2.5,
      targetWords: 30,
    });
    expect(calls.every((c) => c.url.host === "pub-test.r2.dev" && c.headers.get("range"))).toBe(true);
  });

  it("create: narration → R2 → worker → checked reel in media; the MP3 is cleaned up", async () => {
    const { calls, stored } = fakeServices();
    const { t, listingId } = await setupListing();
    const out = await t.action(internal.voiceover.create, {
      listingId,
      script: "  Paper Weather builds quiet,   careful sites. ",
      voice: "nino",
    });

    expect(out.durationSec).toBe(14.6);
    expect(out.url).toMatch(/^https:\/\/pub-test\.r2\.dev\/social\/paper-weather\/paper-weather-reel-[a-f0-9]{10}\.mp4$/);
    const row = await t.run((ctx) => ctx.db.get(out.mediaId as Id<"media">));
    expect(row).toMatchObject({ store: "r2", kind: "video", contentType: "video/mp4", size: 2_000_000, width: 1280 });
    expect(R2_SOCIAL_KEY.test(row!.fileId)).toBe(true);

    const tts = calls.find((c) => c.url.pathname.startsWith("/v1/text-to-speech/"))!;
    expect(tts.method).toBe("POST");
    expect(tts.url.pathname).toBe(`/v1/text-to-speech/${NINO}`);
    expect(tts.url.searchParams.get("output_format")).toBe("mp3_44100_128");
    expect(tts.headers.get("xi-api-key")).toBe("xi-test");
    expect(JSON.parse(tts.body)).toEqual({
      text: "Paper Weather builds quiet, careful sites.",
      model_id: "eleven_multilingual_v2",
    });
    expect(calls.filter((c) => c.url.pathname.startsWith("/v1/text-to-speech/"))).toHaveLength(1);

    const mux = calls.find((c) => c.url.host === "render.example.test")!;
    expect(mux.headers.get("x-render-key")).toBe("render-key-0123456789");
    const sent = JSON.parse(mux.body);
    expect(sent.videoUrl).toBe(`https://pub-test.r2.dev/${PREVIEW_KEY}`);
    expect(sent.audioUrl).toMatch(/^https:\/\/pub-test\.r2\.dev\/social\/paper-weather\/paper-weather-voiceover-[a-f0-9]{10}\.mp3$/);
    expect(new URL(sent.putUrl).searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
    expect(sent.layout).toBe("source");

    // Only the reel is left on R2.
    expect([...stored.keys()]).toEqual([row!.fileId]);
  });

  it("create refuses bad input before spending any credits", async () => {
    const { calls } = fakeServices();
    const { t, listingId } = await setupListing();
    await expect(t.action(internal.voiceover.create, { listingId, script: "Hi", voice: "Giorgi" })).rejects.toThrow(
      /Unknown voice/,
    );
    await expect(t.action(internal.voiceover.create, { listingId, script: "   ", voice: "Nino" })).rejects.toThrow(
      /empty/,
    );
    vi.stubEnv("RENDER_WORKER_URL", "");
    await expect(t.action(internal.voiceover.create, { listingId, script: "Hi", voice: "Nino" })).rejects.toThrow(
      /RENDER_WORKER_URL is not set/,
    );
    vi.stubEnv("RENDER_WORKER_URL", ENV.RENDER_WORKER_URL);
    const bare = await setupListing(false);
    await expect(
      bare.t.action(internal.voiceover.create, { listingId: bare.listingId, script: "Hi", voice: "Nino" }),
    ).rejects.toThrow(/no preview video/);
    expect(calls.filter((c) => c.url.host === "api.elevenlabs.io")).toHaveLength(0);
  });

  it("a failed render leaves nothing on R2 and no media row", async () => {
    const { stored } = fakeServices({ workerStatus: 500 });
    const { t, listingId } = await setupListing();
    await expect(t.action(internal.voiceover.create, { listingId, script: "Hi there", voice: "Luka" })).rejects.toThrow(
      /render worker failed \(HTTP 500\): ffmpeg exploded/,
    );
    expect(stored.size).toBe(0);
    const reels = await t.run((ctx) => ctx.db.query("media").collect());
    expect(reels.filter((m) => m.fileId.startsWith("social/"))).toHaveLength(0);
  });

  it("a reel the worker did not actually store is refused", async () => {
    fakeServices({ stored: false });
    const { t, listingId } = await setupListing();
    await expect(t.action(internal.voiceover.create, { listingId, script: "Hi there", voice: "Nino" })).rejects.toThrow(
      /not on R2/,
    );
  });
});
