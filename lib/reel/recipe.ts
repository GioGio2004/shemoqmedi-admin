// The REEL RECIPE: everything a reel is made from, as plain JSON. The Studio's
// reel editor edits it, the browser renders it (lib/reel/render.ts), Convex
// stores it (reelDrafts.recipe, media.design {kind:"reel"}) and Claude writes
// it through the MCP connector. Pure data and functions: safe to import from
// Convex, Next (server and client) and tests. Contract: docs/reel-editor.md.
//
// Convex mirrors the type as validators in convex/lib/reel.ts (a compile-time
// check there keeps the two equal).

// ─────────────────────────────────────────────────────────────────────────────
// Options
// ─────────────────────────────────────────────────────────────────────────────

export const RECIPE_VERSION = 1 as const;

export const ASPECTS = {
  "9:16": { width: 1080, height: 1920, label: "9:16 Reel" },
  "4:5": { width: 1080, height: 1350, label: "4:5 Feed" },
  "1:1": { width: 1080, height: 1080, label: "1:1 Square" },
  "16:9": { width: 1920, height: 1080, label: "16:9 Wide" },
} as const;
export type ReelAspect = keyof typeof ASPECTS;
export const ASPECT_IDS = Object.keys(ASPECTS) as ReelAspect[];

/** The only frame rate for now (kept in the recipe so it can change later). */
export const FPS = 30 as const;

export const SOURCE_KINDS = ["listingVideo", "screenshot", "graphic", "upload-video", "upload-image"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const MOTIONS = ["none", "zoomIn", "zoomOut", "panLeft", "panRight", "panUp", "panDown"] as const;
export type Motion = (typeof MOTIONS)[number];

/** fill: crop to fill the frame. blur: whole picture over a blurred, zoomed copy of itself. letterbox: whole picture on black. */
export const FITS = ["fill", "blur", "letterbox"] as const;
export type Fit = (typeof FITS)[number];

export const TEXT_POSITIONS = ["top", "center", "bottom"] as const;
export type TextPosition = (typeof TEXT_POSITIONS)[number];

/** glass: frosted pill. solid: black box, white text. light: white box, black text. shadow: white text with a soft shadow. headline: big bold display text. */
export const TEXT_STYLES = ["glass", "solid", "light", "shadow", "headline"] as const;
export type TextStyle = (typeof TEXT_STYLES)[number];

export const TEXT_SIZES = ["s", "m", "l"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

/**
 * The transition INTO a clip. Every transition but cut overlaps the two clips
 * for its duration (the reel gets that much shorter).
 *   crossfade: the new clip fades in over the old one.
 *   dipBlack / dipWhite: the old clip fades to black/white, the new one fades in from it.
 *   morph: zoom-blur: the old clip zooms in and blurs away while the new one settles in.
 *   slideX: the new clip slides in over the old one, moving toward X.
 *   pushX: the new clip pushes the old one out, both moving toward X.
 */
export const TRANSITIONS = [
  "cut",
  "crossfade",
  "dipBlack",
  "dipWhite",
  "morph",
  "slideLeft",
  "slideRight",
  "slideUp",
  "pushLeft",
  "pushRight",
  "pushUp",
] as const;
export type TransitionType = (typeof TRANSITIONS)[number];

/** glass: frosted pill. bold: big white words with a shadow. highlight: the word being said is white, the rest dimmed. box: black box. light: white box. */
export const CAPTION_STYLES = ["glass", "bold", "highlight", "box", "light"] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];

export const CAPTION_POSITIONS = ["top", "center", "bottom"] as const;
export type CaptionPosition = (typeof CAPTION_POSITIONS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Limits
// ─────────────────────────────────────────────────────────────────────────────

export const LIMITS = {
  clips: 40,
  /** Shortest a clip may be on the timeline (after trim and speed). */
  minClipSec: 0.3,
  stillMinSec: 0.5,
  stillMaxSec: 30,
  speedMin: 0.5,
  speedMax: 2,
  transitionMaxSec: 2,
  /** Longest reel (Instagram reels run up to 3 minutes; stories 60 s). */
  maxReelSec: 180,
  textChars: 200,
  captionLineChars: 120,
  captionLines: 400,
  captionWords: 3000,
  gainMax: 2,
  fadeMaxSec: 5,
  urlChars: 2048,
  labelChars: 120,
  scriptChars: 1200,
  titleChars: 120,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// The recipe
// ─────────────────────────────────────────────────────────────────────────────

export type ClipSource = {
  kind: SourceKind;
  /** https URL the browser fetches (R2 / ImageKit; CORS allows the Studio). */
  url: string;
  /** media row id (Id<"media">) when the file is ours. */
  mediaId?: string;
  /** Id<"listings"> the clip shows, when it is a listing's video or screenshot. */
  listingId?: string;
  /** That listing's slug (for people and for Claude; the id wins). */
  listingSlug?: string;
  /** What to call the clip in the editor ("Paper Weather preview"). */
  label?: string;
  width?: number;
  height?: number;
  /** Length of the source video file in seconds (videos). */
  durationSec?: number;
};

export type ClipText = {
  on: boolean;
  text: string;
  position: TextPosition;
  style: TextStyle;
  size: TextSize;
};

export type Transition = { type: TransitionType; durationSec: number };

/** A video clip's own sound (stills have none). */
export type ClipAudio = { on: boolean; gain: number };

export type ReelClip = {
  /** Stable id within the recipe ([A-Za-z0-9_-], 1-40): React keys, drag and drop. */
  id: string;
  source: ClipSource;
  /** Videos: trim in / out, in seconds of the source file. Stills: 0 and 0. */
  inSec: number;
  outSec: number;
  /** Stills: seconds on screen. Videos: 0 (their length is (outSec - inSec) / speed). */
  durationSec: number;
  /** Videos: playback speed 0.5-2. Stills: 1. */
  speed: number;
  /** Stills: Ken Burns move over the clip. Videos may use it too. */
  motion: Motion;
  fit: Fit;
  text: ClipText;
  /** How this clip comes in. The first clip's is always treated as a cut (use fades.videoInSec). */
  transitionIn: Transition;
  audio: ClipAudio;
};

export type CaptionWord = { text: string; startSec: number; endSec: number };

/**
 * One caption on screen, times in seconds from the start of the narration.
 * `words` carries the spoken timing for the highlight style; it is dropped
 * when the line's text is edited into a different number of words.
 */
export type CaptionLine = { text: string; startSec: number; endSec: number; words?: CaptionWord[] };

export type Captions = { on: boolean; style: CaptionStyle; position: CaptionPosition; lines: CaptionLine[] };

export type VoiceTrack = {
  /** reelAudio row id (Id<"reelAudio">) of a stored narration. */
  narrationId?: string;
  /** The MP3. Absent while the script is not voiced yet (render refuses then). */
  url?: string;
  script?: string;
  /** Narrator name from ELEVENLABS_VOICES. */
  voice?: string;
  durationSec?: number;
  /** Where on the reel the narration starts. */
  startSec: number;
  gain: number;
  captions: Captions;
};

export type Ducking = {
  on: boolean;
  /** How far the music goes down while the voice speaks: 0 = not at all, 1 = silent. */
  amount: number;
};

export type MusicTrack = {
  /** reelAudio row id (Id<"reelAudio">) of an uploaded track. */
  audioId?: string;
  url: string;
  title?: string;
  durationSec?: number;
  /** Where in the track the reel's music starts (skip an intro). */
  offsetSec: number;
  gain: number;
  /** Start the track again when it ends before the reel. */
  loop: boolean;
  duck: Ducking;
};

export type ReelAudio = {
  voice: VoiceTrack | null;
  music: MusicTrack | null;
  /** Master volume of the clips' own sound (each clip has its own on/off and gain too). */
  clipGain: number;
  /**
   * Bring the finished mix to Instagram's level (-14 LUFS, peaks under -1.5 dB).
   * Absent = on (recipes from before the option).
   */
  evenLoudness?: boolean;
};

export type ReelFades = {
  /** Video from black at the start / to black at the end. */
  videoInSec: number;
  videoOutSec: number;
  /** The whole mix fades in / out. */
  audioInSec: number;
  audioOutSec: number;
};

export type ReelRecipe = {
  version: typeof RECIPE_VERSION;
  reel: { aspect: ReelAspect; fps: typeof FPS };
  clips: ReelClip[];
  audio: ReelAudio;
  fades: ReelFades;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers and defaults
// ─────────────────────────────────────────────────────────────────────────────

export const isVideoKind = (kind: SourceKind) => kind === "listingVideo" || kind === "upload-video";
export const isVideoClip = (clip: Pick<ReelClip, "source">) => isVideoKind(clip.source.kind);

export function aspectSize(aspect: ReelAspect) {
  const a = ASPECTS[aspect];
  return { width: a.width, height: a.height };
}

const CLIP_ID = /^[A-Za-z0-9_-]{1,40}$/;

/** A fresh clip id. */
export function newClipId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return `c${c.randomUUID().replace(/-/g, "").slice(0, 11)}`;
  return `c${Math.random().toString(36).slice(2, 13)}`;
}

/** Default length of a still and of a video whose length is not known yet. */
export const DEFAULT_STILL_SEC = 3;
export const DEFAULT_VIDEO_SEC = 8;
/** A new video clip uses at most this much of its source. */
export const DEFAULT_VIDEO_MAX_SEC = 15;
export const DEFAULT_TRANSITION: Transition = { type: "crossfade", durationSec: 0.4 };
export const CUT: Transition = { type: "cut", durationSec: 0 };

export const DEFAULT_TEXT: ClipText = { on: false, text: "", position: "bottom", style: "glass", size: "m" };

/** Crop to fill when the picture is about the frame's shape, else fit over a blur. */
export function defaultFit(source: Pick<ClipSource, "width" | "height">, aspect: ReelAspect): Fit {
  const { width, height } = ASPECTS[aspect];
  if (!source.width || !source.height) return "blur";
  const ratio = source.width / source.height / (width / height);
  return ratio > 0.9 && ratio < 1.1 ? "fill" : "blur";
}

/** A new clip for a source, with the editor's defaults. */
export function defaultClip(source: ClipSource, aspect: ReelAspect = "9:16", id = newClipId()): ReelClip {
  const video = isVideoKind(source.kind);
  const known = source.durationSec && source.durationSec > 0 ? source.durationSec : null;
  return {
    id,
    source,
    inSec: 0,
    outSec: video ? round2(Math.min(known ?? DEFAULT_VIDEO_SEC, DEFAULT_VIDEO_MAX_SEC)) : 0,
    durationSec: video ? 0 : DEFAULT_STILL_SEC,
    speed: 1,
    motion: source.kind === "screenshot" || source.kind === "upload-image" ? "zoomIn" : "none",
    fit: defaultFit(source, aspect),
    text: { ...DEFAULT_TEXT },
    transitionIn: { ...DEFAULT_TRANSITION },
    // Listing previews are muted recordings; a phone video usually has sound worth keeping.
    audio: { on: source.kind === "upload-video", gain: 1 },
  };
}

export const DEFAULT_CAPTIONS: Captions = { on: true, style: "bold", position: "bottom", lines: [] };

export function defaultVoice(track: Partial<VoiceTrack> = {}): VoiceTrack {
  return { startSec: 0, gain: 1, ...track, captions: track.captions ?? { ...DEFAULT_CAPTIONS, lines: [] } };
}

export function defaultMusic(url: string, track: Partial<MusicTrack> = {}): MusicTrack {
  return { offsetSec: 0, gain: 0.5, loop: true, duck: { on: true, amount: 0.6 }, ...track, url };
}

export const DEFAULT_FADES: ReelFades = { videoInSec: 0, videoOutSec: 0, audioInSec: 0, audioOutSec: 0.5 };

/** An empty reel. */
export function defaultRecipe(aspect: ReelAspect = "9:16"): ReelRecipe {
  return {
    version: RECIPE_VERSION,
    reel: { aspect, fps: FPS },
    clips: [],
    audio: { voice: null, music: null, clipGain: 1, evenLoudness: true },
    fades: { ...DEFAULT_FADES },
  };
}

/** Keep a video clip's trim inside a source whose real length is now known (the editor probes each video). */
export function clampToSource(clip: ReelClip, sourceSec: number): ReelClip {
  if (!isVideoClip(clip) || !(sourceSec > 0)) return clip;
  const outSec = Math.min(clip.outSec, sourceSec);
  const inSec = Math.min(clip.inSec, Math.max(0, outSec - LIMITS.minClipSec * clip.speed));
  return { ...clip, inSec: round2(inSec), outSec: round2(outSec), source: { ...clip.source, durationSec: round2(sourceSec) } };
}

/** Every listing id the reel shows, in order of first appearance. */
export function recipeListingIds(recipe: Pick<ReelRecipe, "clips">): string[] {
  const out: string[] = [];
  for (const c of recipe.clips) if (c.source.listingId && !out.includes(c.source.listingId)) out.push(c.source.listingId);
  return out;
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation: short, plain messages ("Clip 2: ..."); empty = fine
// ─────────────────────────────────────────────────────────────────────────────

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const within = (n: unknown, lo: number, hi: number) => isNum(n) && n >= lo && n <= hi;
const oneOf = <T extends string>(list: readonly T[], x: unknown): x is T => typeof x === "string" && (list as readonly string[]).includes(x);

export function isHttpsUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.length > LIMITS.urlChars) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Length on the timeline of a clip (same as timeline.clipLength, kept here so validation needs no import). */
function lengthOf(c: ReelClip) {
  return isVideoKind(c.source.kind) ? (c.outSec - c.inSec) / (c.speed || 1) : c.durationSec;
}

/**
 * Problems that make a recipe unusable, as messages for people. Empty when
 * it is fine. `forRender`: also what rendering needs (at least one clip, a
 * voiced narration).
 */
export function validateRecipe(recipe: ReelRecipe, opts: { forRender?: boolean } = {}): string[] {
  const errors: string[] = [];
  const add = (m: string) => errors.push(m);
  if (recipe.version !== RECIPE_VERSION) add(`Unknown recipe version ${String(recipe.version)}.`);
  if (!oneOf(ASPECT_IDS, recipe.reel?.aspect)) add(`Unknown aspect "${String(recipe.reel?.aspect)}". Use ${ASPECT_IDS.join(", ")}.`);
  if (recipe.reel?.fps !== FPS) add(`The frame rate is ${FPS}.`);

  const clips = recipe.clips ?? [];
  if (clips.length > LIMITS.clips) add(`At most ${LIMITS.clips} clips.`);
  if (opts.forRender && clips.length === 0) add("Add at least one clip.");
  const ids = new Set<string>();
  clips.forEach((c, i) => {
    const n = `Clip ${i + 1}`;
    if (!CLIP_ID.test(c.id)) add(`${n}: bad id.`);
    else if (ids.has(c.id)) add(`${n}: its id is used twice.`);
    ids.add(c.id);
    const s = c.source;
    if (!oneOf(SOURCE_KINDS, s.kind)) add(`${n}: unknown source "${String(s.kind)}".`);
    if (!isHttpsUrl(s.url)) add(`${n}: the source must be a public https URL.`);
    if (s.label !== undefined && s.label.length > LIMITS.labelChars) add(`${n}: the label is too long.`);
    for (const k of ["width", "height", "durationSec"] as const) {
      if (s[k] !== undefined && !(isNum(s[k]) && s[k]! > 0)) add(`${n}: bad source ${k}.`);
    }
    const video = isVideoKind(s.kind);
    if (video) {
      if (!isNum(c.inSec) || c.inSec < 0) add(`${n}: the start must be 0 or more.`);
      if (!isNum(c.outSec) || c.outSec <= c.inSec) add(`${n}: the end must be after the start.`);
      if (s.durationSec && c.outSec > s.durationSec + 0.05) add(`${n}: ends after the video does (${round2(s.durationSec)} s).`);
      if (!within(c.speed, LIMITS.speedMin, LIMITS.speedMax)) add(`${n}: speed must be ${LIMITS.speedMin}x to ${LIMITS.speedMax}x.`);
    } else if (!within(c.durationSec, LIMITS.stillMinSec, LIMITS.stillMaxSec)) {
      add(`${n}: show a still for ${LIMITS.stillMinSec} to ${LIMITS.stillMaxSec} seconds.`);
    }
    if (video && isNum(c.inSec) && isNum(c.outSec) && isNum(c.speed) && lengthOf(c) < LIMITS.minClipSec - 1e-9) {
      add(`${n}: too short (at least ${LIMITS.minClipSec} s).`);
    }
    if (!oneOf(MOTIONS, c.motion)) add(`${n}: unknown motion "${String(c.motion)}".`);
    if (!oneOf(FITS, c.fit)) add(`${n}: unknown fit "${String(c.fit)}".`);
    const t = c.text;
    if (!t || typeof t.on !== "boolean" || typeof t.text !== "string") add(`${n}: bad text.`);
    else {
      if (t.text.length > LIMITS.textChars) add(`${n}: keep the text under ${LIMITS.textChars} characters.`);
      if (!oneOf(TEXT_POSITIONS, t.position)) add(`${n}: unknown text position "${String(t.position)}".`);
      if (!oneOf(TEXT_STYLES, t.style)) add(`${n}: unknown text style "${String(t.style)}".`);
      if (!oneOf(TEXT_SIZES, t.size)) add(`${n}: unknown text size "${String(t.size)}".`);
    }
    if (!oneOf(TRANSITIONS, c.transitionIn?.type)) add(`${n}: unknown transition "${String(c.transitionIn?.type)}".`);
    else if (!within(c.transitionIn.durationSec, 0, LIMITS.transitionMaxSec)) {
      add(`${n}: a transition lasts 0 to ${LIMITS.transitionMaxSec} seconds.`);
    }
    if (!c.audio || typeof c.audio.on !== "boolean" || !within(c.audio.gain, 0, LIMITS.gainMax)) add(`${n}: bad clip sound settings.`);
  });

  const total = clips.reduce((sum, c) => sum + Math.max(0, lengthOf(c) || 0), 0);
  if (total > LIMITS.maxReelSec + 1) add(`The reel is too long: keep it under ${LIMITS.maxReelSec / 60} minutes.`);

  const a = recipe.audio;
  if (!a || !within(a.clipGain, 0, LIMITS.gainMax)) add("Bad clip volume.");
  const voice = a?.voice;
  if (voice) {
    if (voice.url !== undefined && !isHttpsUrl(voice.url)) add("Voice: the narration must be a public https URL.");
    if (!voice.url && !voice.script?.trim()) add("Voice: give a narration or a script.");
    if (opts.forRender && !voice.url) add("Voice: the script is not voiced yet. Generate the voice first, or turn the voice off.");
    if (voice.script !== undefined && voice.script.length > LIMITS.scriptChars) add(`Voice: keep the script under ${LIMITS.scriptChars} characters.`);
    if (!within(voice.startSec, 0, LIMITS.maxReelSec)) add("Voice: bad start time.");
    if (!within(voice.gain, 0, LIMITS.gainMax)) add("Voice: bad volume.");
    if (voice.durationSec !== undefined && !(isNum(voice.durationSec) && voice.durationSec > 0)) add("Voice: bad length.");
    const cap = voice.captions;
    if (!cap || typeof cap.on !== "boolean") add("Captions: bad settings.");
    else {
      if (!oneOf(CAPTION_STYLES, cap.style)) add(`Captions: unknown style "${String(cap.style)}".`);
      if (!oneOf(CAPTION_POSITIONS, cap.position)) add(`Captions: unknown position "${String(cap.position)}".`);
      if (cap.lines.length > LIMITS.captionLines) add(`Captions: at most ${LIMITS.captionLines} lines.`);
      let words = 0;
      cap.lines.forEach((l, i) => {
        const n = `Caption ${i + 1}`;
        if (typeof l.text !== "string" || l.text.length > LIMITS.captionLineChars) add(`${n}: keep it under ${LIMITS.captionLineChars} characters.`);
        if (!isNum(l.startSec) || !isNum(l.endSec) || l.startSec < 0 || l.endSec <= l.startSec) add(`${n}: bad timing.`);
        words += l.words?.length ?? 0;
      });
      if (words > LIMITS.captionWords) add("Captions: too many timed words.");
    }
  }
  const music = a?.music;
  if (music) {
    if (!isHttpsUrl(music.url)) add("Music: the track must be a public https URL.");
    if (!within(music.offsetSec, 0, 3600)) add("Music: bad start in the track.");
    if (!within(music.gain, 0, LIMITS.gainMax)) add("Music: bad volume.");
    if (typeof music.loop !== "boolean") add("Music: bad loop setting.");
    if (!music.duck || typeof music.duck.on !== "boolean" || !within(music.duck.amount, 0, 1)) add("Music: ducking is 0 to 1.");
    if (music.title !== undefined && music.title.length > LIMITS.labelChars) add("Music: the title is too long.");
  }
  const f = recipe.fades;
  if (!f || ![f.videoInSec, f.videoOutSec, f.audioInSec, f.audioOutSec].every((x) => within(x, 0, LIMITS.fadeMaxSec))) {
    add(`Fades last 0 to ${LIMITS.fadeMaxSec} seconds.`);
  }
  return errors;
}

/** Things worth a look that don't stop a render (shown as notes, never refused). */
export function recipeWarnings(recipe: ReelRecipe, reelSec: number): string[] {
  const out: string[] = [];
  const voice = recipe.audio.voice;
  if (voice?.durationSec && voice.startSec + voice.durationSec > reelSec + 0.05) {
    out.push(`The narration runs ${round2(voice.startSec + voice.durationSec - reelSec)} s past the end of the reel; it is cut there.`);
  }
  if (voice?.captions.on && voice.url && voice.captions.lines.length === 0) out.push("Captions are on but there are none yet.");
  if (reelSec > 90) out.push("Longer than 90 s: fine as a reel, too long for a story (60 s).");
  if (reelSec > 0 && reelSec < 3) out.push("Shorter than 3 s: Instagram wants at least 3 s.");
  if (recipe.clips.some((c) => c.text.on && !c.text.text.trim())) out.push("A clip has its text on but empty.");
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// normalizeRecipe: a loose recipe (Claude, an older version, hand-written
// JSON) → a full one with defaults. Throws ReelRecipeError on what can't be
// guessed (no clips list, a clip without a source); anything else is filled
// in or clamped. Run validateRecipe on the result.
// ─────────────────────────────────────────────────────────────────────────────

export class ReelRecipeError extends Error {}

type Loose = Record<string, unknown>;
const obj = (x: unknown): Loose | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Loose) : null);
const str = (x: unknown) => (typeof x === "string" ? x : undefined);
const num = (x: unknown) => (isNum(x) ? x : undefined);
const bool = (x: unknown, d: boolean) => (typeof x === "boolean" ? x : d);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const pick = <T extends string>(list: readonly T[], x: unknown, d: T): T => (oneOf(list, x) ? x : d);
const optStr = (x: unknown, max: number) => {
  const s = str(x)?.trim();
  return s ? s.slice(0, max) : undefined;
};
const posNum = (x: unknown) => {
  const n = num(x);
  return n !== undefined && n > 0 ? round2(n) : undefined;
};

/** Drops undefined fields (Convex refuses explicit undefined in nested objects only for missing optionals; this keeps JSON tidy). */
function tidy<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

function normalizeSource(raw: unknown, n: string): ClipSource {
  const s = obj(raw);
  if (!s) throw new ReelRecipeError(`${n}: give a source.`);
  const kind = s.kind;
  if (!oneOf(SOURCE_KINDS, kind)) throw new ReelRecipeError(`${n}: source kind must be one of ${SOURCE_KINDS.join(", ")}.`);
  const url = str(s.url)?.trim();
  if (!url) throw new ReelRecipeError(`${n}: the source has no URL.`);
  return tidy({
    kind,
    url,
    mediaId: optStr(s.mediaId, 64),
    listingId: optStr(s.listingId, 64),
    listingSlug: optStr(s.listingSlug, 80),
    label: optStr(s.label, LIMITS.labelChars),
    width: posNum(s.width),
    height: posNum(s.height),
    durationSec: posNum(s.durationSec),
  });
}

function normalizeText(raw: unknown): ClipText {
  const t = obj(raw);
  if (typeof raw === "string") return { ...DEFAULT_TEXT, on: !!raw.trim(), text: raw.slice(0, LIMITS.textChars) };
  if (!t) return { ...DEFAULT_TEXT };
  const text = (str(t.text) ?? "").slice(0, LIMITS.textChars);
  return {
    on: bool(t.on, !!text.trim()),
    text,
    position: pick(TEXT_POSITIONS, t.position, DEFAULT_TEXT.position),
    style: pick(TEXT_STYLES, t.style, DEFAULT_TEXT.style),
    size: pick(TEXT_SIZES, t.size, DEFAULT_TEXT.size),
  };
}

function normalizeTransition(raw: unknown): Transition {
  // The first clip's is kept as given (the timeline treats it as a cut), so moving clips around never loses one.
  const t = obj(raw);
  const type = typeof raw === "string" ? raw : t?.type;
  if (!oneOf(TRANSITIONS, type)) return { ...DEFAULT_TRANSITION };
  if (type === "cut") return { ...CUT };
  const d = num(t?.durationSec);
  return { type, durationSec: round2(clamp(d ?? DEFAULT_TRANSITION.durationSec, 0.1, LIMITS.transitionMaxSec)) };
}

function normalizeClip(raw: unknown, i: number, aspect: ReelAspect, used: Set<string>): ReelClip {
  const n = `Clip ${i + 1}`;
  const c = obj(raw);
  if (!c) throw new ReelRecipeError(`${n}: not an object.`);
  const source = normalizeSource(c.source, n);
  let id = str(c.id);
  if (!id || !CLIP_ID.test(id) || used.has(id)) id = newClipId();
  used.add(id);
  const base = defaultClip(source, aspect, id);
  const video = isVideoKind(source.kind);
  const speed = video ? round2(clamp(num(c.speed) ?? 1, LIMITS.speedMin, LIMITS.speedMax)) : 1;
  let inSec = 0;
  let outSec = 0;
  let durationSec = 0;
  if (video) {
    inSec = Math.max(0, num(c.inSec) ?? 0);
    if (source.durationSec) inSec = Math.min(inSec, Math.max(0, source.durationSec - LIMITS.minClipSec * speed));
    const len = num(c.durationSec);
    outSec = num(c.outSec) ?? (len ? inSec + len * speed : source.durationSec ?? inSec + DEFAULT_VIDEO_SEC);
    if (source.durationSec) outSec = Math.min(outSec, source.durationSec);
    outSec = Math.max(outSec, inSec + LIMITS.minClipSec * speed);
    inSec = round2(inSec);
    outSec = round2(outSec);
  } else {
    durationSec = round2(clamp(num(c.durationSec) ?? DEFAULT_STILL_SEC, LIMITS.stillMinSec, LIMITS.stillMaxSec));
  }
  const audio = obj(c.audio);
  return {
    id,
    source,
    inSec,
    outSec,
    durationSec,
    speed,
    motion: pick(MOTIONS, c.motion, base.motion),
    fit: pick(FITS, c.fit, base.fit),
    text: normalizeText(c.text),
    transitionIn: normalizeTransition(c.transitionIn ?? c.transition),
    audio: {
      on: bool(audio?.on, base.audio.on),
      gain: round2(clamp(num(audio?.gain) ?? 1, 0, LIMITS.gainMax)),
    },
  };
}

function normalizeWords(raw: unknown): CaptionWord[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: CaptionWord[] = [];
  for (const w of raw.slice(0, LIMITS.captionWords)) {
    const o = obj(w);
    const text = str(o?.text)?.trim();
    const startSec = num(o?.startSec);
    const endSec = num(o?.endSec);
    if (text && startSec !== undefined && endSec !== undefined && startSec >= 0 && endSec > startSec) {
      out.push({ text, startSec: round3(startSec), endSec: round3(endSec) });
    }
  }
  return out.length ? out : undefined;
}

function normalizeCaptions(raw: unknown): Captions {
  const c = obj(raw);
  const lines: CaptionLine[] = [];
  if (Array.isArray(c?.lines)) {
    for (const l of c.lines.slice(0, LIMITS.captionLines)) {
      const o = obj(l);
      const text = str(o?.text)?.trim().slice(0, LIMITS.captionLineChars);
      const startSec = num(o?.startSec);
      const endSec = num(o?.endSec);
      if (!text || startSec === undefined || endSec === undefined || startSec < 0 || endSec <= startSec) continue;
      lines.push(tidy({ text, startSec: round3(startSec), endSec: round3(endSec), words: normalizeWords(o?.words) }));
    }
  }
  return {
    on: bool(c?.on, DEFAULT_CAPTIONS.on),
    style: pick(CAPTION_STYLES, c?.style, DEFAULT_CAPTIONS.style),
    position: pick(CAPTION_POSITIONS, c?.position, DEFAULT_CAPTIONS.position),
    lines,
  };
}

function normalizeVoice(raw: unknown): VoiceTrack | null {
  const v = obj(raw);
  if (!v) return null;
  const url = optStr(v.url, LIMITS.urlChars);
  const script = optStr(v.script, LIMITS.scriptChars);
  if (!url && !script) return null;
  return tidy({
    narrationId: optStr(v.narrationId, 64),
    url,
    script,
    voice: optStr(v.voice, 80),
    durationSec: posNum(v.durationSec),
    startSec: round2(clamp(num(v.startSec) ?? 0, 0, LIMITS.maxReelSec)),
    gain: round2(clamp(num(v.gain) ?? 1, 0, LIMITS.gainMax)),
    captions: normalizeCaptions(v.captions),
  });
}

function normalizeMusic(raw: unknown): MusicTrack | null {
  const m = obj(raw);
  const url = optStr(m?.url, LIMITS.urlChars);
  if (!m || !url) return null;
  const duck = obj(m.duck);
  const base = defaultMusic(url);
  return tidy({
    audioId: optStr(m.audioId, 64),
    url,
    title: optStr(m.title, LIMITS.labelChars),
    durationSec: posNum(m.durationSec),
    offsetSec: round2(clamp(num(m.offsetSec) ?? 0, 0, 3600)),
    gain: round2(clamp(num(m.gain) ?? base.gain, 0, LIMITS.gainMax)),
    loop: bool(m.loop, base.loop),
    duck: { on: bool(duck?.on, base.duck.on), amount: round2(clamp(num(duck?.amount) ?? base.duck.amount, 0, 1)) },
  });
}

/** A full recipe from a loose one: defaults filled, numbers clamped. Throws ReelRecipeError when it can't be read. */
export function normalizeRecipe(input: unknown): ReelRecipe {
  const r = obj(input);
  if (!r) throw new ReelRecipeError("The recipe must be an object.");
  if (r.version !== undefined && r.version !== RECIPE_VERSION) throw new ReelRecipeError(`Unknown recipe version ${String(r.version)}.`);
  const reel = obj(r.reel);
  const aspect = pick(ASPECT_IDS, reel?.aspect ?? r.aspect, "9:16");
  if (!Array.isArray(r.clips)) throw new ReelRecipeError("The recipe needs a clips list.");
  if (r.clips.length > LIMITS.clips) throw new ReelRecipeError(`At most ${LIMITS.clips} clips.`);
  const used = new Set<string>();
  const clips = r.clips.map((c, i) => normalizeClip(c, i, aspect, used));
  const audio = obj(r.audio);
  const fades = obj(r.fades);
  const fade = (x: unknown, d: number) => round2(clamp(num(x) ?? d, 0, LIMITS.fadeMaxSec));
  return {
    version: RECIPE_VERSION,
    reel: { aspect, fps: FPS },
    clips,
    audio: {
      voice: normalizeVoice(audio?.voice),
      music: normalizeMusic(audio?.music),
      clipGain: round2(clamp(num(audio?.clipGain) ?? 1, 0, LIMITS.gainMax)),
      evenLoudness: (audio as { evenLoudness?: unknown } | undefined)?.evenLoudness !== false,
    },
    fades: {
      videoInSec: fade(fades?.videoInSec, DEFAULT_FADES.videoInSec),
      videoOutSec: fade(fades?.videoOutSec, DEFAULT_FADES.videoOutSec),
      audioInSec: fade(fades?.audioInSec, DEFAULT_FADES.audioInSec),
      audioOutSec: fade(fades?.audioOutSec, DEFAULT_FADES.audioOutSec),
    },
  };
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
