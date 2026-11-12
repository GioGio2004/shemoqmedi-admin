import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { mediaRow, mediaUrl } from "./lib/media";
import { R2_SOCIAL_KEY, deleteObject, headObject, presignPut, r2Configured, r2PublicUrl } from "./lib/r2";
import {
  WORDS_PER_SECOND,
  cleanScript,
  mp4Duration,
  parseVoices,
  resolveVoice,
  socialKey,
  targetWords,
  urlRangeReader,
  wordCount,
} from "./lib/voiceover";

// Voiceover reels for the social desk. Claude writes a short narration for a
// new listing, ElevenLabs voices it, and the render worker (workers/render,
// on the VPS next to Postiz) lays it over the listing's muted preview:
//
//   videoInfo (duration → word budget) → Claude writes the script → create:
//     ElevenLabs MP3 → R2 social/<slug>/…mp3 → worker /mux → R2 social/<slug>/…mp4
//     → headObject check → media row → { url, mediaId, durationSec }
//
// create spends ElevenLabs credits (one per character): only call it after
// Giorgi has read the script and said yes.
//
// Convex env:
//   ELEVENLABS_API_KEY  API key (xi-api-key)
//   ELEVENLABS_VOICES   JSON narrator name → voice id, e.g. {"Nino":"<id>","Luka":"<id>"}
//   ELEVENLABS_MODEL    optional, default eleven_multilingual_v2
//   RENDER_WORKER_URL   e.g. https://render.shemoqmedi.space
//   RENDER_WORKER_KEY   shared secret, sent as x-render-key
//   R2_*                as for preview videos (convex/lib/r2.ts)

const ELEVENLABS = "https://api.elevenlabs.io";
const DEFAULT_MODEL = "eleven_multilingual_v2";
const OUTPUT_FORMAT = "mp3_44100_128";
/** Instagram's Reels file limit is far higher; this just catches a runaway render. */
const MAX_REEL_BYTES = 300 * 1024 * 1024;

function need(name: "ELEVENLABS_API_KEY" | "RENDER_WORKER_URL" | "RENDER_WORKER_KEY") {
  const value = process.env[name]?.trim();
  if (!value) throw new ConvexError(`${name} is not set on this Convex deployment.`);
  return name === "RENDER_WORKER_URL" ? value.replace(/\/+$/, "") : value;
}

const vLayout = v.union(v.literal("source"), v.literal("vertical"));

// ─────────────────────────────────────────────────────────────────────────────
// Voices
// ─────────────────────────────────────────────────────────────────────────────

const voiceOut = v.object({
  name: v.string(),
  voiceId: v.string(),
  description: v.optional(v.string()),
  previewUrl: v.optional(v.string()),
});

/** The narrators in ELEVENLABS_VOICES, with ElevenLabs' sample clip when it can be fetched (no credits used). */
export const listVoices = internalAction({
  args: {},
  returns: v.object({ voices: v.array(voiceOut), wordsPerSecond: v.number() }),
  handler: async () => {
    const voices = parseVoices(process.env.ELEVENLABS_VOICES);
    const key = process.env.ELEVENLABS_API_KEY?.trim();
    const out = await Promise.all(
      voices.map(async (voice) => {
        if (!key) return voice;
        try {
          const res = await fetch(`${ELEVENLABS}/v1/voices/${encodeURIComponent(voice.voiceId)}`, {
            headers: { "xi-api-key": key },
          });
          if (!res.ok) return voice;
          const info = (await res.json()) as { description?: string | null; preview_url?: string | null };
          return {
            ...voice,
            ...(info.description ? { description: info.description } : {}),
            ...(info.preview_url ? { previewUrl: info.preview_url } : {}),
          };
        } catch {
          return voice;
        }
      }),
    );
    return { voices: out, wordsPerSecond: WORDS_PER_SECOND };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// The listing's preview video
// ─────────────────────────────────────────────────────────────────────────────

/** Slug, title and a fetchable URL of the listing's preview video (null when it has none). */
export const listingVideo = internalQuery({
  args: { listingId: v.id("listings") },
  returns: v.union(
    v.null(),
    v.object({ slug: v.string(), title: v.string(), videoUrl: v.union(v.string(), v.null()) }),
  ),
  handler: async (ctx, { listingId }) => {
    const listing = await ctx.db.get(listingId);
    if (!listing) return null;
    let videoUrl = listing.videoId ? await mediaUrl(ctx, listing.videoId) : null;
    const row = listing.videoId ? await mediaRow(ctx, listing.videoId) : null;
    if (videoUrl && row && row.store !== "r2") {
      // Older videos still on ImageKit: fetch the stored original, which
      // costs no video processing units (same as media.imagekitVideos).
      const url = new URL(videoUrl);
      url.searchParams.set("tr", "orig-true");
      videoUrl = url.toString();
    }
    return { slug: listing.slug, title: listing.title, videoUrl };
  },
});

type ListingVideo = { slug: string; title: string; videoUrl: string };

// Explicit types here and on the handlers below: without them TypeScript's
// inference loops through internal.voiceover and turns all of `api` into any.
async function loadVideo(ctx: ActionCtx, listingId: Id<"listings">): Promise<ListingVideo> {
  const info: { slug: string; title: string; videoUrl: string | null } | null = await ctx.runQuery(
    internal.voiceover.listingVideo,
    { listingId },
  );
  if (!info) throw new ConvexError("Listing not found.");
  if (!info.videoUrl) throw new ConvexError(`"${info.title}" has no preview video, so there is nothing to narrate over.`);
  return { ...info, videoUrl: info.videoUrl };
}

async function callWorker<T>(path: "/mux" | "/probe", body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${need("RENDER_WORKER_URL")}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-render-key": need("RENDER_WORKER_KEY") },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON: report the status
  }
  if (!res.ok) {
    const detail = (json as { error?: string } | null)?.error ?? text.slice(0, 200);
    throw new ConvexError(`The render worker failed (HTTP ${res.status}): ${detail}`);
  }
  return json as T;
}

/** Seconds of the preview: read from the MP4 header, or asked of the render worker (ffprobe). */
async function videoDuration(videoUrl: string): Promise<number> {
  try {
    const seconds = await mp4Duration(urlRangeReader(videoUrl));
    if (seconds && seconds > 0) return seconds;
  } catch {
    // fall through to the worker
  }
  if (process.env.RENDER_WORKER_URL && process.env.RENDER_WORKER_KEY) {
    const { durationSec } = await callWorker<{ durationSec: number }>("/probe", { url: videoUrl });
    if (durationSec > 0) return durationSec;
  }
  throw new ConvexError("Could not read how long the preview video is.");
}

/** How long the listing's preview is, and about how many narration words fit it. */
export const videoInfo = internalAction({
  args: { listingId: v.id("listings") },
  returns: v.object({
    title: v.string(),
    videoUrl: v.string(),
    durationSec: v.number(),
    wordsPerSecond: v.number(),
    targetWords: v.number(),
  }),
  handler: async (
    ctx,
    { listingId },
  ): Promise<{ title: string; videoUrl: string; durationSec: number; wordsPerSecond: number; targetWords: number }> => {
    const { title, videoUrl } = await loadVideo(ctx, listingId);
    const durationSec = Math.round((await videoDuration(videoUrl)) * 100) / 100;
    return { title, videoUrl, durationSec, wordsPerSecond: WORDS_PER_SECOND, targetWords: targetWords(durationSec) };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Making the reel
// ─────────────────────────────────────────────────────────────────────────────

/** ElevenLabs text-to-speech → MP3 bytes. Spends credits. */
async function narrate(text: string, voiceId: string): Promise<ArrayBuffer> {
  const url = new URL(`${ELEVENLABS}/v1/text-to-speech/${encodeURIComponent(voiceId)}`);
  url.searchParams.set("output_format", OUTPUT_FORMAT);
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": need("ELEVENLABS_API_KEY"), "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL?.trim() || DEFAULT_MODEL }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new ConvexError(`ElevenLabs refused the narration (HTTP ${res.status}): ${detail}`);
  }
  const audio = await res.arrayBuffer();
  if (audio.byteLength < 512) throw new ConvexError("ElevenLabs returned an empty narration.");
  return audio;
}

async function putToR2(key: string, body: ArrayBuffer, contentType: string) {
  const res = await fetch(await presignPut(key), { method: "PUT", headers: { "content-type": contentType }, body });
  if (!res.ok) throw new Error(`R2 PUT ${key}: HTTP ${res.status}`);
}

/** Record a finished reel (server-side, social/ keys only). */
export const registerReel = internalMutation({
  args: { key: v.string(), size: v.number(), width: v.optional(v.number()), height: v.optional(v.number()) },
  returns: v.id("media"),
  handler: async (ctx, { key, size, width, height }) => {
    if (!R2_SOCIAL_KEY.test(key) || !key.endsWith(".mp4")) throw new ConvexError("Not a social reel key.");
    const existing = await ctx.db
      .query("media")
      .withIndex("by_fileId", (q) => q.eq("fileId", key))
      .first();
    if (existing) return existing._id;
    const url = r2PublicUrl(key);
    if (!url) throw new ConvexError("R2_PUBLIC_URL is not set on this Convex deployment.");
    return await ctx.db.insert("media", {
      store: "r2",
      fileId: key,
      url,
      filePath: `/${key}`,
      kind: "video",
      contentType: "video/mp4",
      size,
      width,
      height,
      createdAt: Date.now(),
    });
  },
});

/**
 * Voice a script and lay it over the listing's preview video: an
 * Instagram-Reels-ready MP4 on R2, registered as a media row. Spends
 * ElevenLabs credits, so only after Giorgi approved the script.
 *
 * layout "source" (default) keeps the preview's own frame; "vertical" puts
 * it on a 1080×1920 black canvas.
 */
export const create = internalAction({
  args: { listingId: v.id("listings"), script: v.string(), voice: v.string(), layout: v.optional(vLayout) },
  returns: v.object({ url: v.string(), mediaId: v.id("media"), durationSec: v.number() }),
  handler: async (
    ctx,
    { listingId, script, voice, layout },
  ): Promise<{ url: string; mediaId: Id<"media">; durationSec: number }> => {
    // Every check that can fail runs before ElevenLabs is called.
    const text = cleanScript(script);
    const narrator = resolveVoice(parseVoices(process.env.ELEVENLABS_VOICES), voice);
    need("ELEVENLABS_API_KEY");
    need("RENDER_WORKER_URL");
    need("RENDER_WORKER_KEY");
    if (!r2Configured()) throw new ConvexError("R2 is not configured on this Convex deployment.");
    const { slug, videoUrl } = await loadVideo(ctx, listingId);

    const audioKey = socialKey(slug, "voiceover", "mp3");
    const reelKey = socialKey(slug, "reel", "mp4");
    const audioUrl = r2PublicUrl(audioKey)!;
    let done = false;
    try {
      await putToR2(audioKey, await narrate(text, narrator.voiceId), "audio/mpeg");
      const result = await callWorker<{ durationSec: number; width?: number; height?: number }>("/mux", {
        videoUrl,
        audioUrl,
        putUrl: await presignPut(reelKey, 30 * 60),
        layout: layout ?? "source",
      });

      const file = await headObject(reelKey);
      if (!file || !file.size) throw new ConvexError("The render worker said it finished, but the reel is not on R2.");
      if (!file.contentType.startsWith("video/mp4")) {
        throw new ConvexError(`The reel was stored as ${file.contentType || "an unknown type"}, not video/mp4.`);
      }
      if (file.size > MAX_REEL_BYTES) throw new ConvexError("The reel came out over 300 MB.");

      const mediaId: Id<"media"> = await ctx.runMutation(internal.voiceover.registerReel, {
        key: reelKey,
        size: file.size,
        width: result.width,
        height: result.height,
      });
      done = true;
      console.log(
        `voiceover ${slug}: ${wordCount(text)} words, ${text.length} chars, voice ${narrator.name}, ${result.durationSec}s`,
      );
      return { url: r2PublicUrl(reelKey)!, mediaId, durationSec: result.durationSec };
    } finally {
      // The MP3 only exists for the worker to fetch; a failed render leaves no reel behind.
      for (const key of done ? [audioKey] : [audioKey, reelKey]) {
        await deleteObject(key).catch((err) => console.error(String(err)));
      }
    }
  },
});
