import { ConvexError, v } from "convex/values";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { ActionCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireAdmin } from "./authHelpers";
import { cleanDuration, mediaRow, mediaUrl } from "./lib/media";
import { R2_SOCIAL_KEY, deleteObject, headObject, presignPut, r2Configured, r2PublicUrl } from "./lib/r2";
import { captionWord } from "./lib/reel";
import {
  MAX_REEL_BYTES,
  WORDS_PER_SECOND,
  alignmentToWords,
  base64Bytes,
  cleanScript,
  mp3Seconds,
  mp4Duration,
  parseVoices,
  resolveVoice,
  socialKey,
  targetWords,
  urlRangeReader,
  wordCount,
  type Alignment,
  type TimedWord,
} from "./lib/voiceover";

// Voiceover reels for the social desk. Claude (or Giorgi) writes a short
// narration for a listing, ElevenLabs voices it, and the admin's Voiceover
// page (app/voiceover) lays it over the listing's muted preview in the
// browser with mediabunny (lib/voiceoverMux.ts), then uploads the reel:
//
//   videoInfo (duration → word budget at 2.5 words/s)
//   create / generate: ElevenLabs MP3 → R2 social/<slug>/…-voiceover-….mp3 → { audioUrl, durationSec }
//   page: preview + MP3 → H.264/AAC MP4 → reelUploadUrl → PUT → registerReel → verifyReel
//
// create / generate spend ElevenLabs credits (one per character): only after
// Giorgi has read the script and said yes.
//
// Convex env:
//   ELEVENLABS_API_KEY  API key (xi-api-key)
//   ELEVENLABS_VOICES   JSON narrator name → voice id, e.g. {"Nino":"<id>","Luka":"<id>"}
//   ELEVENLABS_MODEL    optional, default eleven_multilingual_v2
//   R2_*                as for preview videos (convex/lib/r2.ts). The browser
//                       fetches the preview and the MP3 from R2_PUBLIC_URL, so
//                       the bucket's CORS policy must allow GET from the admin.

const ELEVENLABS = "https://api.elevenlabs.io";
const DEFAULT_MODEL = "eleven_multilingual_v2";
const OUTPUT_FORMAT = "mp3_44100_128";
const MP3_KBPS = 128;

function need(name: "ELEVENLABS_API_KEY") {
  const value = process.env[name]?.trim();
  if (!value) throw new ConvexError(`${name} is not set on this Convex deployment.`);
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// Voices
// ─────────────────────────────────────────────────────────────────────────────

const voiceOut = v.object({
  name: v.string(),
  voiceId: v.string(),
  description: v.optional(v.string()),
  previewUrl: v.optional(v.string()),
});
const voicesOut = v.object({ voices: v.array(voiceOut), wordsPerSecond: v.number() });
type VoicesOut = typeof voicesOut.type;

/** The narrators, with ElevenLabs' sample clip when it can be fetched (no credits used). */
async function voicesWithSamples(): Promise<VoicesOut> {
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
}

/** MCP (list_voices): the narrators in ELEVENLABS_VOICES. */
export const listVoices = internalAction({
  args: {},
  returns: voicesOut,
  handler: async (): Promise<VoicesOut> => voicesWithSamples(),
});

/** Admin page: same list. */
export const voices = action({
  args: {},
  returns: voicesOut,
  handler: async (ctx): Promise<VoicesOut> => {
    await ctx.runQuery(internal.users.assertAdmin, {});
    return voicesWithSamples();
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// The listing's preview video
// ─────────────────────────────────────────────────────────────────────────────

/** A URL the browser and Convex can fetch: ImageKit originals cost no video processing units. */
export async function fetchableVideoUrl(ctx: QueryCtx, listing: Doc<"listings">) {
  if (!listing.videoId) return null;
  const url = await mediaUrl(ctx, listing.videoId);
  const row = await mediaRow(ctx, listing.videoId);
  if (!url || !row || row.store === "r2") return url;
  const imagekit = new URL(url);
  imagekit.searchParams.set("tr", "orig-true"); // same as media.imagekitVideos
  return imagekit.toString();
}

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
    return { slug: listing.slug, title: listing.title, videoUrl: await fetchableVideoUrl(ctx, listing) };
  },
});

/** Admin page: every listing with a preview video, newest first. */
export const listings = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("listings"),
      slug: v.string(),
      title: v.string(),
      creditName: v.string(),
      status: v.string(),
      videoUrl: v.string(),
    }),
  ),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const out = [];
    for (const l of await ctx.db.query("listings").order("desc").take(1000)) {
      if (!l.videoId || l.status === "rejected") continue;
      const videoUrl = await fetchableVideoUrl(ctx, l);
      if (videoUrl) {
        out.push({ id: l._id, slug: l.slug, title: l.title, creditName: l.creditName, status: l.status, videoUrl });
      }
    }
    return out;
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

type VideoInfo = { title: string; videoUrl: string; durationSec: number; wordsPerSecond: number; targetWords: number };

/** MCP (get_listing / create_voiceover): how long the preview is, and about how many words fit it. */
export const videoInfo = internalAction({
  args: { listingId: v.id("listings") },
  returns: v.object({
    title: v.string(),
    videoUrl: v.string(),
    durationSec: v.number(),
    wordsPerSecond: v.number(),
    targetWords: v.number(),
  }),
  handler: async (ctx, { listingId }): Promise<VideoInfo> => {
    const { title, videoUrl } = await loadVideo(ctx, listingId);
    const seconds = await mp4Duration(urlRangeReader(videoUrl)).catch(() => null);
    if (!seconds) throw new ConvexError("Could not read how long the preview video is (it is not an MP4).");
    const durationSec = Math.round(seconds * 100) / 100;
    return { title, videoUrl, durationSec, wordsPerSecond: WORDS_PER_SECOND, targetWords: targetWords(durationSec) };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Narration (spends ElevenLabs credits)
// ─────────────────────────────────────────────────────────────────────────────

/** ElevenLabs text-to-speech → MP3 bytes. */
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

/**
 * ElevenLabs text-to-speech with timestamps: MP3 bytes and the spoken time
 * of every word (for the reel editor's captions). One call, same credits.
 */
async function narrateTimed(text: string, voiceId: string): Promise<{ audio: Uint8Array; words: TimedWord[] }> {
  const url = new URL(`${ELEVENLABS}/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`);
  url.searchParams.set("output_format", OUTPUT_FORMAT);
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": need("ELEVENLABS_API_KEY"), "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL?.trim() || DEFAULT_MODEL }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new ConvexError(`ElevenLabs refused the narration (HTTP ${res.status}): ${detail}`);
  }
  const body = (await res.json()) as {
    audio_base64?: string;
    alignment?: Alignment | null;
    normalized_alignment?: Alignment | null;
  };
  const audio = body.audio_base64 ? base64Bytes(body.audio_base64) : new Uint8Array(0);
  if (audio.byteLength < 512) throw new ConvexError("ElevenLabs returned an empty narration.");
  // The alignment of the text as sent; the normalized one (numbers spelled out) when that is missing.
  const words = alignmentToWords(body.alignment);
  return { audio, words: words.length ? words : alignmentToWords(body.normalized_alignment) };
}

/** Slug of a listing (any listing: a narration needs no preview video), or null. */
export const listingSlug = internalQuery({
  args: { listingId: v.id("listings") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { listingId }) => (await ctx.db.get(listingId))?.slug ?? null,
});

/** Records a stored narration or music track (reelAudio). */
export const recordAudio = internalMutation({
  args: {
    kind: v.union(v.literal("voice"), v.literal("music")),
    key: v.string(),
    contentType: v.string(),
    size: v.number(),
    durationSec: v.optional(v.number()),
    title: v.optional(v.string()),
    listingId: v.optional(v.id("listings")),
    script: v.optional(v.string()),
    voice: v.optional(v.string()),
    words: v.optional(v.array(captionWord)),
    userId: v.optional(v.id("users")),
  },
  returns: v.id("reelAudio"),
  handler: async (ctx, args) => await ctx.db.insert("reelAudio", { ...args, createdAt: Date.now() }),
});

async function storeMp3(key: string, audio: ArrayBuffer | Uint8Array) {
  const put = await fetch(await presignPut(key), {
    method: "PUT",
    headers: { "content-type": "audio/mpeg" },
    body: audio as BodyInit,
  });
  if (!put.ok) throw new ConvexError(`Could not store the narration on R2 (HTTP ${put.status}).`);
}

type Narration = { audioUrl: string; durationSec: number; narrationId: Id<"reelAudio"> };

async function makeNarration(ctx: ActionCtx, listingId: Id<"listings">, script: string, voice: string): Promise<Narration> {
  // Every check that can fail runs before ElevenLabs is called.
  const text = cleanScript(script);
  const narrator = resolveVoice(parseVoices(process.env.ELEVENLABS_VOICES), voice);
  need("ELEVENLABS_API_KEY");
  if (!r2Configured()) throw new ConvexError("R2 is not configured on this Convex deployment.");
  const { slug } = await loadVideo(ctx, listingId);

  const audio = await narrate(text, narrator.voiceId);
  const key = socialKey(slug, "voiceover", "mp3");
  await storeMp3(key, audio);
  const durationSec = Math.round(mp3Seconds(new Uint8Array(audio), MP3_KBPS) * 10) / 10;
  console.log(`voiceover ${slug}: ${wordCount(text)} words, ${text.length} chars, voice ${narrator.name}, ~${durationSec}s`);
  // Kept so the reel editor can use it again (no word timings: its captions are spread evenly).
  const narrationId: Id<"reelAudio"> = await ctx.runMutation(internal.voiceover.recordAudio, {
    kind: "voice",
    key,
    contentType: "audio/mpeg",
    size: audio.byteLength,
    durationSec,
    listingId,
    script: text,
    voice: narrator.name,
  });
  return { audioUrl: r2PublicUrl(key)!, durationSec, narrationId };
}

const narrationArgs = { listingId: v.id("listings"), script: v.string(), voice: v.string() };
const narrationOut = v.object({ audioUrl: v.string(), durationSec: v.number(), narrationId: v.id("reelAudio") });

/**
 * MCP (create_voiceover): voice a script for a listing. Returns the MP3 on
 * R2 and its length; the reel itself is built on the admin's Voiceover page.
 * Spends ElevenLabs credits, so only after Giorgi approved the script.
 * `voice` is a narrator name (any case) or a voice id from ELEVENLABS_VOICES.
 */
export const create = internalAction({
  args: narrationArgs,
  returns: narrationOut,
  handler: async (ctx, { listingId, script, voice }): Promise<Narration> =>
    makeNarration(ctx, listingId, script, voice),
});

/** Admin page ("Generate voice"): same as create. */
export const generate = action({
  args: narrationArgs,
  returns: narrationOut,
  handler: async (ctx, { listingId, script, voice }): Promise<Narration> => {
    await ctx.runQuery(internal.users.assertAdmin, {});
    return makeNarration(ctx, listingId, script, voice);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Narration with captions (the reel editor; spends ElevenLabs credits)
// ─────────────────────────────────────────────────────────────────────────────

export const narrationView = v.object({
  id: v.id("reelAudio"),
  url: v.string(),
  durationSec: v.number(),
  script: v.union(v.string(), v.null()),
  voice: v.union(v.string(), v.null()),
  listingId: v.union(v.id("listings"), v.null()),
  /** Spoken word timings; null when made without them (spread the script with lib/reel/timeline.ts estimateWords). */
  words: v.union(v.array(captionWord), v.null()),
  createdAt: v.number(),
});
export type NarrationView = typeof narrationView.type;

/**
 * Reel editor ("Generate voice"): voice a script with word timings, store the
 * MP3 on R2 (social/<listing slug or "reels">/...-voiceover-....mp3) and keep
 * it in reelAudio. Any listing, or none (a reel may mix several). Spends
 * ElevenLabs credits: the Studio asks first.
 */
export const generateTimed = action({
  args: { script: v.string(), voice: v.string(), listingId: v.optional(v.id("listings")) },
  returns: narrationView,
  handler: async (ctx, { script, voice, listingId }): Promise<NarrationView> => {
    await ctx.runQuery(internal.users.assertAdmin, {});
    // Every check that can fail runs before ElevenLabs is called.
    const text = cleanScript(script);
    const narrator = resolveVoice(parseVoices(process.env.ELEVENLABS_VOICES), voice);
    need("ELEVENLABS_API_KEY");
    if (!r2Configured()) throw new ConvexError("R2 is not configured on this Convex deployment.");
    const slug: string | null = listingId ? await ctx.runQuery(internal.voiceover.listingSlug, { listingId }) : null;
    if (listingId && !slug) throw new ConvexError("Listing not found.");

    const { audio, words } = await narrateTimed(text, narrator.voiceId);
    const key = socialKey(slug ?? "reels", "voiceover", "mp3");
    await storeMp3(key, audio);
    const measured = mp3Seconds(audio, MP3_KBPS);
    const spoken = words.length ? words[words.length - 1].endSec : 0;
    const durationSec = Math.round(Math.max(measured, spoken) * 100) / 100;
    console.log(`narration ${slug ?? "reels"}: ${wordCount(text)} words, ${words.length} timed, voice ${narrator.name}, ~${durationSec}s`);
    const id: Id<"reelAudio"> = await ctx.runMutation(internal.voiceover.recordAudio, {
      kind: "voice",
      key,
      contentType: "audio/mpeg",
      size: audio.byteLength,
      durationSec,
      listingId,
      script: text,
      voice: narrator.name,
      words: words.length ? words : undefined,
    });
    return {
      id,
      url: r2PublicUrl(key)!,
      durationSec,
      script: text,
      voice: narrator.name,
      listingId: listingId ?? null,
      words: words.length ? words : null,
      createdAt: Date.now(),
    };
  },
});

/** Reel editor: earlier narrations newest first (optionally one listing's), to use again. Limit 1-100 (default 30). */
export const narrations = query({
  args: { listingId: v.optional(v.id("listings")), limit: v.optional(v.number()) },
  returns: v.array(narrationView),
  handler: async (ctx, { listingId, limit }) => {
    await requireAdmin(ctx);
    const n = Math.min(Math.max(Math.floor(limit ?? 30), 1), 100);
    const rows = await ctx.db
      .query("reelAudio")
      .withIndex("by_kind", (q) => q.eq("kind", "voice"))
      .order("desc")
      .take(500);
    const out: NarrationView[] = [];
    for (const row of rows) {
      if (row.invalid || (listingId && row.listingId !== listingId)) continue;
      const url = r2PublicUrl(row.key);
      if (!url) continue;
      out.push({
        id: row._id,
        url,
        durationSec: row.durationSec ?? 0,
        script: row.script ?? null,
        voice: row.voice ?? null,
        listingId: row.listingId ?? null,
        words: row.words ?? null,
        createdAt: row.createdAt,
      });
      if (out.length >= n) break;
    }
    return out;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// The finished reel (built in the browser, uploaded straight to R2)
// ─────────────────────────────────────────────────────────────────────────────

/** Admin page: a presigned URL for one browser → R2 reel upload (valid 15 minutes). */
export const reelUploadUrl = action({
  args: { listingId: v.id("listings"), size: v.number() },
  returns: v.object({ uploadUrl: v.string(), key: v.string() }),
  handler: async (ctx, { listingId, size }): Promise<{ uploadUrl: string; key: string }> => {
    await ctx.runQuery(internal.users.assertAdmin, {});
    if (!r2Configured()) throw new ConvexError("R2 is not configured on this Convex deployment.");
    if (!(size > 0) || size > MAX_REEL_BYTES) throw new ConvexError("The reel must be an MP4 of 100 MB or less.");
    const { slug } = await loadVideo(ctx, listingId);
    const key = socialKey(slug, "reel", "mp4");
    return { uploadUrl: await presignPut(key), key };
  },
});

/** Admin page: record an uploaded reel as a media row (size and length, for the story check); returns its id and public URL. */
export const registerReel = mutation({
  args: {
    key: v.string(),
    size: v.number(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationSec: v.optional(v.number()),
  },
  returns: v.object({ mediaId: v.id("media"), url: v.string() }),
  handler: async (ctx, { key, size, width, height, durationSec }) => {
    const user = await requireAdmin(ctx);
    if (!R2_SOCIAL_KEY.test(key) || !key.endsWith(".mp4")) throw new ConvexError("That is not a reel upload.");
    if (!(size > 0) || size > MAX_REEL_BYTES) throw new ConvexError("The reel must be an MP4 of 100 MB or less.");
    const url = r2PublicUrl(key);
    if (!url) throw new ConvexError("R2 is not configured on this Convex deployment.");
    const existing = await ctx.db
      .query("media")
      .withIndex("by_fileId", (q) => q.eq("fileId", key))
      .first();
    if (existing) return { mediaId: existing._id, url };
    const mediaId = await ctx.db.insert("media", {
      store: "r2",
      fileId: key,
      url,
      filePath: `/${key}`,
      kind: "video",
      contentType: "video/mp4",
      size,
      width,
      height,
      durationSec: cleanDuration(durationSec),
      uploadedBy: user._id,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.voiceover.verifyReel, { id: mediaId, key });
    return { mediaId, url };
  },
});

/** Double-check a registered reel against R2 (it exists, is an MP4, not oversized). */
export const verifyReel = internalAction({
  args: { id: v.id("media"), key: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, key }) => {
    const file = await headObject(key); // throws (and retries) on R2 errors
    const ok = !!file && file.contentType.startsWith("video/mp4") && file.size > 0 && file.size <= MAX_REEL_BYTES;
    if (!ok) {
      await ctx.runMutation(internal.media.markInvalid, { id });
      if (file) await deleteObject(key);
    }
    return null;
  },
});
