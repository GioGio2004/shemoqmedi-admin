// Convex validators for the REEL RECIPE (lib/reel/recipe.ts holds the type,
// defaults, validation and normalizeRecipe; this mirrors the type so tables
// and function args can store it). The compile-time check at the bottom keeps
// the two equal. Also the R2 keys and limits of the reel editor's uploads.
// Safe to import from Convex and Next. Contract: docs/reel-editor.md.

import { v, type Infer } from "convex/values";
import { ConvexError } from "convex/values";
import {
  ASPECT_IDS,
  CAPTION_POSITIONS,
  CAPTION_STYLES,
  FITS,
  MOTIONS,
  SOURCE_KINDS,
  TEXT_POSITIONS,
  TEXT_SIZES,
  TEXT_STYLES,
  TRANSITIONS,
  type ReelRecipe,
} from "../../lib/reel/recipe";

const literals = <T extends string>(list: readonly T[]) => {
  const [a, b, ...rest] = list.map((x) => v.literal(x));
  return v.union(a, b, ...rest);
};

export const reelSource = v.object({
  kind: literals(SOURCE_KINDS),
  url: v.string(),
  mediaId: v.optional(v.string()),
  listingId: v.optional(v.string()),
  listingSlug: v.optional(v.string()),
  label: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  durationSec: v.optional(v.number()),
});

export const reelClip = v.object({
  id: v.string(),
  source: reelSource,
  inSec: v.number(),
  outSec: v.number(),
  durationSec: v.number(),
  speed: v.number(),
  motion: literals(MOTIONS),
  fit: literals(FITS),
  text: v.object({
    on: v.boolean(),
    text: v.string(),
    position: literals(TEXT_POSITIONS),
    style: literals(TEXT_STYLES),
    size: literals(TEXT_SIZES),
  }),
  transitionIn: v.object({ type: literals(TRANSITIONS), durationSec: v.number() }),
  audio: v.object({ on: v.boolean(), gain: v.number() }),
});

export const captionWord = v.object({ text: v.string(), startSec: v.number(), endSec: v.number() });

export const captionLine = v.object({
  text: v.string(),
  startSec: v.number(),
  endSec: v.number(),
  words: v.optional(v.array(captionWord)),
});

export const reelVoice = v.object({
  narrationId: v.optional(v.string()),
  url: v.optional(v.string()),
  script: v.optional(v.string()),
  voice: v.optional(v.string()),
  durationSec: v.optional(v.number()),
  startSec: v.number(),
  gain: v.number(),
  captions: v.object({
    on: v.boolean(),
    style: literals(CAPTION_STYLES),
    position: literals(CAPTION_POSITIONS),
    lines: v.array(captionLine),
  }),
});

export const reelMusic = v.object({
  audioId: v.optional(v.string()),
  url: v.string(),
  title: v.optional(v.string()),
  durationSec: v.optional(v.number()),
  offsetSec: v.number(),
  gain: v.number(),
  loop: v.boolean(),
  duck: v.object({ on: v.boolean(), amount: v.number() }),
});

export const reelRecipe = v.object({
  version: v.literal(1),
  reel: v.object({ aspect: literals(ASPECT_IDS), fps: v.literal(30) }),
  clips: v.array(reelClip),
  audio: v.object({
    voice: v.union(reelVoice, v.null()),
    music: v.union(reelMusic, v.null()),
    clipGain: v.number(),
    evenLoudness: v.optional(v.boolean()),
  }),
  fades: v.object({
    videoInSec: v.number(),
    videoOutSec: v.number(),
    audioInSec: v.number(),
    audioOutSec: v.number(),
  }),
});

/** A rendered reel's recipe on its media row (media.design): the full edit, and the draft it came from. */
export const reelDesign = v.object({
  kind: v.literal("reel"),
  recipe: reelRecipe,
  draftId: v.optional(v.id("reelDrafts")),
  title: v.optional(v.string()),
});
export type ReelDesign = Infer<typeof reelDesign>;

export const reelDraftStatus = v.union(v.literal("draft"), v.literal("ready"), v.literal("rendered"));
export type ReelDraftStatus = Infer<typeof reelDraftStatus>;

// Compile-time: the validator and lib/reel/recipe.ts describe the same thing.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const recipeMatches: Same<Infer<typeof reelRecipe>, ReelRecipe> = true;
void recipeMatches;

// ─────────────────────────────────────────────────────────────────────────────
// Uploads for the reel editor (browser → R2 with a presigned PUT)
// ─────────────────────────────────────────────────────────────────────────────

/** What can be uploaded, and as what. */
export const UPLOAD_TYPES = {
  "video/mp4": { kind: "clip", ext: "mp4" },
  "video/quicktime": { kind: "clip", ext: "mov" },
  "video/webm": { kind: "clip", ext: "webm" },
  "audio/mpeg": { kind: "music", ext: "mp3" },
  "audio/mp4": { kind: "music", ext: "m4a" },
  "audio/x-m4a": { kind: "music", ext: "m4a" },
  "audio/aac": { kind: "music", ext: "m4a" },
} as const;
export type UploadContentType = keyof typeof UPLOAD_TYPES;
export type UploadKind = "clip" | "music";

/** A phone video before the editor trims it (the Studio may compress first). */
export const MAX_CLIP_BYTES = 200 * 1024 * 1024;
export const MAX_MUSIC_BYTES = 20 * 1024 * 1024;
/** Same cap as the old Reels page (convex/lib/voiceover.ts MAX_REEL_BYTES). */
export const MAX_RENDER_BYTES = 100 * 1024 * 1024;

/** Reel editor uploads: social/<folder>/<folder>-clip|music-<10 hex>.<ext>. */
export const R2_UPLOAD_KEY = /^social\/[a-z0-9-]{1,60}\/[a-z0-9-]{1,60}-(clip|music)-[a-f0-9]{10}\.(mp4|mov|webm|mp3|m4a)$/;

/** The folder for a reel's files: the first listing's slug (as listingHelpers.slugify makes it), or "reels". */
export function reelFolder(slug: string | null | undefined) {
  // Own copy of slugify: importing listingHelpers here would loop through the schema.
  const s = (slug ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return s || "reels";
}

/** Checks an upload's type and size; returns what it is and its extension. */
export function checkUpload(contentType: string, size: number): { kind: UploadKind; ext: string } {
  const type = contentType.split(";")[0].trim().toLowerCase();
  const known = (UPLOAD_TYPES as Record<string, { kind: UploadKind; ext: string } | undefined>)[type];
  if (!known) throw new ConvexError("Upload an MP4, MOV or WebM video, or an MP3 or M4A track.");
  const max = known.kind === "clip" ? MAX_CLIP_BYTES : MAX_MUSIC_BYTES;
  if (!(size > 0) || size > max) {
    throw new ConvexError(known.kind === "clip" ? "Videos can be up to 200 MB." : "Music tracks can be up to 20 MB.");
  }
  return known;
}

/** A fresh upload key in a reel folder. */
export function uploadKey(folder: string, kind: UploadKind, ext: string) {
  const f = reelFolder(folder);
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  const key = `social/${f}/${f}-${kind}-${suffix}.${ext}`;
  if (!R2_UPLOAD_KEY.test(key)) throw new Error(`Bad upload key ${key}`);
  return key;
}

/** The kind an upload key was made for, or null when it isn't one. */
export function uploadKindOf(key: string): UploadKind | null {
  const m = R2_UPLOAD_KEY.exec(key);
  return m ? (m[1] as UploadKind) : null;
}
