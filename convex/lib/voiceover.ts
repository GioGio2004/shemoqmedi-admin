// Pure helpers for convex/voiceover.ts: the narrator map, script limits,
// social/ object keys and an MP4 duration reader. No Convex context, so
// tests can call them directly.

import { ConvexError } from "convex/values";
import { R2_SOCIAL_KEY } from "./r2";
import { slugify } from "./listingHelpers";

/** Narration pace Claude writes to: about 2.5 spoken words per second. */
export const WORDS_PER_SECOND = 2.5;

/** Longest script we send to ElevenLabs (credits are per character). */
export const MAX_SCRIPT_CHARS = 1200;

/** Largest reel the admin page may upload (Instagram allows far more; this catches a runaway encode). */
export const MAX_REEL_BYTES = 100 * 1024 * 1024;

export type Voice = { name: string; voiceId: string };

const VOICE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * ELEVENLABS_VOICES: a JSON object of narrator name → ElevenLabs voice id,
 * e.g. {"Nino":"21m00Tcm4TlvDq8ikWAM","Luka":"pNInz6obpgDQGcFmaJgB"}.
 * Throws with a message that says what to fix.
 */
export function parseVoices(raw: string | undefined): Voice[] {
  if (!raw?.trim()) throw new ConvexError("ELEVENLABS_VOICES is not set on this Convex deployment.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConvexError('ELEVENLABS_VOICES must be JSON like {"Nino":"<voice id>","Luka":"<voice id>"}.');
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConvexError('ELEVENLABS_VOICES must be a JSON object of name → voice id, like {"Nino":"<voice id>"}.');
  }
  const voices: Voice[] = [];
  const seen = new Set<string>();
  for (const [rawName, voiceId] of Object.entries(parsed)) {
    const name = rawName.trim();
    if (!name || name.length > 40) throw new ConvexError(`ELEVENLABS_VOICES: "${rawName}" is not a usable narrator name.`);
    if (typeof voiceId !== "string" || !VOICE_ID.test(voiceId)) {
      throw new ConvexError(`ELEVENLABS_VOICES: the voice id for "${name}" does not look like an ElevenLabs voice id.`);
    }
    if (seen.has(name.toLowerCase())) throw new ConvexError(`ELEVENLABS_VOICES: "${name}" is listed twice.`);
    seen.add(name.toLowerCase());
    voices.push({ name, voiceId });
  }
  if (!voices.length) throw new ConvexError("ELEVENLABS_VOICES has no voices in it.");
  if (voices.length > 10) throw new ConvexError("ELEVENLABS_VOICES: keep it to 10 voices or fewer.");
  return voices;
}

/** A narrator by name (any case) or by its voice id; throws listing the names on a miss. */
export function resolveVoice(voices: Voice[], wanted: string): Voice {
  const w = wanted.trim();
  const hit = voices.find((v) => v.name.toLowerCase() === w.toLowerCase() || v.voiceId === w);
  if (!hit) throw new ConvexError(`Unknown voice "${wanted}". Use one of: ${voices.map((v) => v.name).join(", ")}.`);
  return hit;
}

/** Script check: not empty, not too long. Returns the trimmed script with tidied whitespace. */
export function cleanScript(script: string): string {
  const text = script.replace(/\s+/g, " ").trim();
  if (!text) throw new ConvexError("The narration script is empty.");
  if (text.length > MAX_SCRIPT_CHARS) {
    throw new ConvexError(`The narration script is ${text.length} characters; keep it under ${MAX_SCRIPT_CHARS}.`);
  }
  return text;
}

export function wordCount(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

/** About how many words fit a video of this length at WORDS_PER_SECOND. */
export function targetWords(durationSec: number) {
  return Math.max(1, Math.round(durationSec * WORDS_PER_SECOND));
}

/** A fresh, unguessable social/<slug>/<slug>-<label>-<suffix>.<ext> key. */
export function socialKey(slug: string, label: string, ext: "mp3" | "mp4") {
  const s = slugify(slug);
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  const key = `social/${s}/${s}-${slugify(label, "file")}-${suffix}.${ext}`;
  if (!R2_SOCIAL_KEY.test(key)) throw new Error(`Bad social key ${key}`);
  return key;
}

/**
 * Seconds of a constant-bitrate MP3 (ElevenLabs' mp3_44100_128), from its
 * size: an ID3v2 tag at the start is skipped. Close enough to size the reel;
 * the browser decodes the real length before muxing.
 */
export function mp3Seconds(bytes: Uint8Array, kbps: number) {
  let start = 0;
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    // ID3v2: 10-byte header + syncsafe size (+ 10-byte footer when flagged).
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    start = 10 + size + (bytes[5] & 0x10 ? 10 : 0);
  }
  return (Math.max(0, bytes.length - start) * 8) / (kbps * 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// MP4 duration (moov → mvhd), read with a few small ranged requests, so a
// 15 MB preview is not downloaded just to learn its length.
// ─────────────────────────────────────────────────────────────────────────────

/** Read `length` bytes at `offset` (fewer at the end of the file). */
export type RangeReader = (offset: number, length: number) => Promise<Uint8Array>;

const MAX_BOXES = 64;
const MAX_MOOV_BYTES = 16 * 1024 * 1024;

function u32(b: Uint8Array, at: number) {
  return ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
}

function u64(b: Uint8Array, at: number) {
  return u32(b, at) * 2 ** 32 + u32(b, at + 4);
}

function boxType(b: Uint8Array, at: number) {
  return String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
}

/** Duration in seconds from an mvhd box payload (starting at its version byte). */
function mvhdSeconds(b: Uint8Array, at: number): number | null {
  const version = b[at];
  const timescale = version === 1 ? u32(b, at + 20) : u32(b, at + 12);
  const duration = version === 1 ? u64(b, at + 24) : u32(b, at + 16);
  if (!timescale || !duration || duration === 0xffffffff) return null;
  return duration / timescale;
}

/** Seconds of an MP4 / MOV file, or null when it is not one (or has no usable duration). */
export async function mp4Duration(read: RangeReader): Promise<number | null> {
  let offset = 0;
  for (let i = 0; i < MAX_BOXES; i++) {
    const head = await read(offset, 16);
    if (head.length < 8) return null;
    let size = u32(head, 0);
    const type = boxType(head, 4);
    let headerLen = 8;
    if (size === 1) {
      if (head.length < 16) return null;
      size = u64(head, 8);
      headerLen = 16;
    }
    if (i === 0 && type !== "ftyp" && type !== "moov" && type !== "free" && type !== "wide") return null;
    if (type === "moov") {
      const len = size === 0 ? MAX_MOOV_BYTES : Math.min(size, MAX_MOOV_BYTES);
      const moov = await read(offset, len);
      // Children of moov: mvhd comes first in practice, but walk them to be safe.
      let at = headerLen;
      while (at + 8 <= moov.length) {
        const childSize = u32(moov, at);
        if (boxType(moov, at + 4) === "mvhd") return at + 8 + 32 <= moov.length ? mvhdSeconds(moov, at + 8) : null;
        if (childSize < 8) return null;
        at += childSize;
      }
      return null;
    }
    if (size === 0 || size < headerLen) return null; // box runs to end of file without a moov
    offset += size;
  }
  return null;
}

/**
 * A RangeReader over a URL. Servers that ignore Range (200 with the whole
 * body) are read once and sliced from memory.
 */
export function urlRangeReader(url: string, fetcher: typeof fetch = fetch): RangeReader {
  let whole: Uint8Array | null = null;
  return async (offset, length) => {
    if (whole) return whole.subarray(offset, offset + length);
    const res = await fetcher(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
    if (res.status === 416) return new Uint8Array(0);
    if (!res.ok) throw new ConvexError(`Could not read the preview video (HTTP ${res.status}).`);
    const body = new Uint8Array(await res.arrayBuffer());
    if (res.status === 206) return body;
    whole = body;
    return whole.subarray(offset, offset + length);
  };
}
