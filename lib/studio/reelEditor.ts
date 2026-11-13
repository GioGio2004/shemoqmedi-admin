// The reel editor's state (components/studio/reels/editor/ReelEditor.tsx):
// the REEL RECIPE being edited, the selected clip, the playhead, undo / redo
// and whether there are unsaved changes. Pure: a reducer and selectors, so
// every edit is tested without a browser (tests/reelEditor.test.ts).
// Contract: docs/reel-editor.md section 4.

import type { DraftView } from "@/convex/reels";
import type { NarrationView } from "@/convex/voiceover";
import {
  LIMITS,
  clampToSource,
  defaultClip,
  defaultFit,
  defaultVoice,
  isVideoClip,
  newClipId,
  recipeWarnings,
  round2,
  validateRecipe,
  type CaptionLine,
  type CaptionWord,
  type Captions,
  type ClipSource,
  type MusicTrack,
  type ReelAspect,
  type ReelClip,
  type ReelFades,
  type ReelRecipe,
  type VoiceTrack,
} from "@/lib/reel/recipe";
import { buildTimeline, editCaptionText, estimateWords, wordsToLines, type Timeline } from "@/lib/reel/timeline";

/** Undo keeps this many steps. */
export const HISTORY_CAP = 50;
/** Narration budget: words a second of reel (the quick reel's rule too). */
export const WORDS_PER_SECOND = 2.5;

export type EditorState = {
  /** Id<"reelDrafts"> once the draft exists on the server. */
  draftId: DraftView["id"] | null;
  /** The draft's updatedAt last saved / loaded (the conflict check). */
  baseUpdatedAt: number | null;
  title: string;
  recipe: ReelRecipe;
  /** Selected clip id. */
  selected: string | null;
  time: number;
  playing: boolean;
  /** Changes not saved on the server yet. */
  dirty: boolean;
  past: ReelRecipe[];
  future: ReelRecipe[];
  /** What the last recipe edit touched: typing into one field is one undo step, not one per letter. */
  lastEdit: string | null;
};

export type EditorAction =
  | { type: "load"; draft: DraftView }
  /** Unsaved work kept on this device (a reload, the app evicted), over the loaded draft. */
  | { type: "restore"; recipe: ReelRecipe; title: string }
  | { type: "addClips"; sources: ClipSource[]; at?: number }
  | { type: "moveClip"; id: string; to: number }
  | { type: "duplicateClip"; id: string }
  | { type: "removeClip"; id: string }
  | { type: "updateClip"; id: string; patch: Partial<Omit<ReelClip, "id" | "source">> }
  | { type: "probed"; id: string; sourceSec: number; width: number; height: number }
  | { type: "setAspect"; aspect: ReelAspect }
  | { type: "setVoice"; voice: VoiceTrack | null }
  | { type: "patchVoice"; patch: Partial<VoiceTrack> }
  | { type: "setCaptions"; patch: Partial<Captions> }
  | { type: "editCaption"; index: number; text: string }
  | { type: "setMusic"; music: MusicTrack | null }
  | { type: "patchMusic"; patch: Partial<MusicTrack> }
  | { type: "setClipGain"; gain: number }
  | { type: "setEvenLoudness"; on: boolean }
  | { type: "setFades"; patch: Partial<ReelFades> }
  | { type: "setTitle"; title: string }
  | { type: "seek"; time: number }
  | { type: "play" }
  | { type: "pause" }
  | { type: "select"; id: string | null }
  | { type: "undo" }
  | { type: "redo" }
  /** The server saved `sent` (what was sent; edits made while saving stay unsaved). */
  | { type: "saved"; draft: DraftView; sent?: { recipe: ReelRecipe; title: string } }
  /** A draft was created for this editor (first save of a new reel). */
  | { type: "created"; draft: DraftView; sent: { recipe: ReelRecipe; title: string } };

export function initialEditorState(recipe: ReelRecipe, opts: { title?: string; draftId?: DraftView["id"] | null; baseUpdatedAt?: number | null } = {}): EditorState {
  return {
    draftId: opts.draftId ?? null,
    baseUpdatedAt: opts.baseUpdatedAt ?? null,
    title: opts.title ?? "",
    recipe,
    selected: recipe.clips[0]?.id ?? null,
    time: 0,
    playing: false,
    dirty: false,
    past: [],
    future: [],
    lastEdit: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Recipe edits
// ─────────────────────────────────────────────────────────────────────────────

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** A new recipe, kept as one undo step (or merged into the last one when `key` repeats). */
function commit(state: EditorState, recipe: ReelRecipe, key: string | null = null, extra: Partial<EditorState> = {}): EditorState {
  if (recipe === state.recipe) return { ...state, ...extra };
  const merge = key !== null && key === state.lastEdit;
  const past = merge ? state.past : [...state.past, state.recipe].slice(-HISTORY_CAP);
  const next: EditorState = { ...state, ...extra, recipe, past, future: [], dirty: true, lastEdit: key };
  return keepInReel(next);
}

/** The playhead and selection stay inside the reel after an edit. */
function keepInReel(state: EditorState): EditorState {
  const { durationSec } = buildTimeline(state.recipe);
  const selected = state.selected && state.recipe.clips.some((c) => c.id === state.selected) ? state.selected : (state.recipe.clips[0]?.id ?? null);
  const time = clamp(state.time, 0, durationSec);
  return selected === state.selected && time === state.time ? state : { ...state, selected, time };
}

const withClips = (r: ReelRecipe, clips: ReelClip[]): ReelRecipe => ({ ...r, clips });
const withAudio = (r: ReelRecipe, audio: Partial<ReelRecipe["audio"]>): ReelRecipe => ({ ...r, audio: { ...r.audio, ...audio } });

/** A clip patch made safe: numbers inside the recipe's limits, a still keeps still fields. */
export function cleanClipPatch(clip: ReelClip, patch: Partial<Omit<ReelClip, "id" | "source">>): ReelClip {
  const next: ReelClip = { ...clip, ...patch, id: clip.id, source: clip.source };
  if (patch.text) next.text = { ...clip.text, ...patch.text, text: (patch.text.text ?? clip.text.text).slice(0, LIMITS.textChars) };
  if (patch.transitionIn) {
    const t = { ...clip.transitionIn, ...patch.transitionIn };
    next.transitionIn = { type: t.type, durationSec: t.type === "cut" ? 0 : round2(clamp(t.durationSec || 0.4, 0.1, LIMITS.transitionMaxSec)) };
  }
  if (patch.audio) next.audio = { ...clip.audio, ...patch.audio, gain: round2(clamp(patch.audio.gain ?? clip.audio.gain, 0, LIMITS.gainMax)) };
  if (isVideoClip(clip)) {
    next.speed = round2(clamp(next.speed, LIMITS.speedMin, LIMITS.speedMax));
    const max = clip.source.durationSec ?? Infinity;
    next.inSec = round2(clamp(next.inSec, 0, max));
    next.outSec = round2(clamp(next.outSec, 0, max));
    next.durationSec = 0;
  } else {
    next.durationSec = round2(clamp(next.durationSec, LIMITS.stillMinSec, LIMITS.stillMaxSec));
    next.inSec = 0;
    next.outSec = 0;
    next.speed = 1;
  }
  return next;
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(clamp(to, 0, out.length), 0, item);
  return out;
}

/** Applies a probe result to every copy of a clip (history too: undo never brings back an unclamped trim). */
function applyProbe(recipe: ReelRecipe, a: Extract<EditorAction, { type: "probed" }>): ReelRecipe {
  let changed = false;
  const clips = recipe.clips.map((c) => {
    if (c.id !== a.id) return c;
    let next = c;
    if (a.width > 0 && a.height > 0 && (!c.source.width || !c.source.height)) {
      const source = { ...c.source, width: Math.round(a.width), height: Math.round(a.height) };
      // A clip added before its size was known got the "unknown size" fit; give it the one its shape wants.
      const fit = c.fit === defaultFit({}, recipe.reel.aspect) ? defaultFit(source, recipe.reel.aspect) : c.fit;
      next = { ...next, source, fit };
    }
    if (isVideoClip(c) && a.sourceSec > 0 && Math.abs((c.source.durationSec ?? 0) - a.sourceSec) > 0.01) next = clampToSource(next, a.sourceSec);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? withClips(recipe, clips) : recipe;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const r = state.recipe;
  switch (action.type) {
    case "load": {
      const d = action.draft;
      return {
        ...initialEditorState(d.recipe, { title: d.title, draftId: d.id, baseUpdatedAt: d.updatedAt }),
        // Keep where Giorgi was looking when the same reel reloads.
        selected: d.recipe.clips.some((c) => c.id === state.selected) ? state.selected : (d.recipe.clips[0]?.id ?? null),
        time: Math.min(state.time, buildTimeline(d.recipe).durationSec),
      };
    }
    case "restore":
      return keepInReel({ ...state, recipe: action.recipe, title: action.title, dirty: true, past: [...state.past, r].slice(-HISTORY_CAP), future: [], lastEdit: null });
    case "addClips": {
      if (!action.sources.length) return state;
      const room = LIMITS.clips - r.clips.length;
      const added = action.sources.slice(0, Math.max(0, room)).map((s) => defaultClip(s, r.reel.aspect, uniqueId(r)));
      if (!added.length) return state;
      const at = clamp(action.at ?? r.clips.length, 0, r.clips.length);
      const clips = [...r.clips.slice(0, at), ...added, ...r.clips.slice(at)];
      const recipe = withClips(r, clips);
      const start = buildTimeline(recipe).items[at]?.start ?? 0;
      return commit(state, recipe, null, { selected: added[0].id, time: start, playing: false });
    }
    case "moveClip": {
      const from = r.clips.findIndex((c) => c.id === action.id);
      if (from < 0) return state;
      const to = clamp(action.to, 0, r.clips.length - 1);
      if (to === from) return state;
      return commit(state, withClips(r, moveItem(r.clips, from, to)), null, { selected: action.id });
    }
    case "duplicateClip": {
      const i = r.clips.findIndex((c) => c.id === action.id);
      if (i < 0 || r.clips.length >= LIMITS.clips) return state;
      const copy: ReelClip = structuredCloneClip(r.clips[i], uniqueId(r));
      const clips = [...r.clips.slice(0, i + 1), copy, ...r.clips.slice(i + 1)];
      return commit(state, withClips(r, clips), null, { selected: copy.id });
    }
    case "removeClip": {
      const i = r.clips.findIndex((c) => c.id === action.id);
      if (i < 0) return state;
      const clips = r.clips.filter((c) => c.id !== action.id);
      const selected = state.selected === action.id ? (clips[i]?.id ?? clips[i - 1]?.id ?? null) : state.selected;
      return commit(state, withClips(r, clips), null, { selected });
    }
    case "updateClip": {
      const i = r.clips.findIndex((c) => c.id === action.id);
      if (i < 0) return state;
      const next = cleanClipPatch(r.clips[i], action.patch);
      const clips = r.clips.map((c, k) => (k === i ? next : c));
      return commit(state, withClips(r, clips), `clip:${action.id}:${Object.keys(action.patch).sort().join(",")}`);
    }
    case "probed": {
      const recipe = applyProbe(r, action);
      if (recipe === r) return state;
      return keepInReel({
        ...state,
        recipe,
        dirty: true,
        past: state.past.map((p) => applyProbe(p, action)),
        future: state.future.map((f) => applyProbe(f, action)),
      });
    }
    case "setAspect":
      if (action.aspect === r.reel.aspect) return state;
      return commit(state, { ...r, reel: { ...r.reel, aspect: action.aspect } });
    case "setVoice":
      return commit(state, withAudio(r, { voice: action.voice }));
    case "patchVoice": {
      if (!r.audio.voice) return state;
      const patch = { ...action.patch };
      if (patch.gain !== undefined) patch.gain = round2(clamp(patch.gain, 0, LIMITS.gainMax));
      if (patch.startSec !== undefined) patch.startSec = round2(clamp(patch.startSec, 0, LIMITS.maxReelSec));
      if (patch.script !== undefined) patch.script = patch.script.slice(0, LIMITS.scriptChars);
      return commit(state, withAudio(r, { voice: { ...r.audio.voice, ...patch } }), `voice:${Object.keys(patch).sort().join(",")}`);
    }
    case "setCaptions": {
      const v = r.audio.voice;
      if (!v) return state;
      return commit(state, withAudio(r, { voice: { ...v, captions: { ...v.captions, ...action.patch } } }), action.patch.lines ? null : `captions:${Object.keys(action.patch).sort().join(",")}`);
    }
    case "editCaption": {
      const v = r.audio.voice;
      const line = v?.captions.lines[action.index];
      if (!v || !line) return state;
      const lines = v.captions.lines.map((l, i) => (i === action.index ? editCaptionText(l, action.text) : l));
      return commit(state, withAudio(r, { voice: { ...v, captions: { ...v.captions, lines } } }), `caption:${action.index}`);
    }
    case "setMusic":
      return commit(state, withAudio(r, { music: action.music }));
    case "patchMusic": {
      const m = r.audio.music;
      if (!m) return state;
      const patch = { ...action.patch };
      if (patch.gain !== undefined) patch.gain = round2(clamp(patch.gain, 0, LIMITS.gainMax));
      if (patch.offsetSec !== undefined) patch.offsetSec = round2(clamp(patch.offsetSec, 0, 3600));
      if (patch.duck) patch.duck = { ...m.duck, ...patch.duck, amount: round2(clamp(patch.duck.amount ?? m.duck.amount, 0, 1)) };
      return commit(state, withAudio(r, { music: { ...m, ...patch } }), `music:${Object.keys(patch).sort().join(",")}`);
    }
    case "setClipGain":
      return commit(state, withAudio(r, { clipGain: round2(clamp(action.gain, 0, LIMITS.gainMax)) }), "clipGain");
    case "setEvenLoudness":
      return commit(state, withAudio(r, { evenLoudness: action.on }));
    case "setFades": {
      const fades = { ...r.fades };
      for (const [k, val] of Object.entries(action.patch) as [keyof ReelFades, number][]) fades[k] = round2(clamp(val, 0, LIMITS.fadeMaxSec));
      return commit(state, { ...r, fades }, `fades:${Object.keys(action.patch).sort().join(",")}`);
    }
    case "setTitle": {
      const title = action.title.slice(0, LIMITS.titleChars);
      return title === state.title ? state : { ...state, title, dirty: true };
    }
    case "seek": {
      const time = clamp(action.time, 0, buildTimeline(r).durationSec);
      return time === state.time ? state : { ...state, time };
    }
    case "play":
      return r.clips.length ? { ...state, playing: true } : state;
    case "pause":
      return state.playing ? { ...state, playing: false } : state;
    case "select":
      return action.id === state.selected ? state : { ...state, selected: action.id };
    case "undo": {
      const prev = state.past[state.past.length - 1];
      if (!prev) return state;
      return keepInReel({ ...state, recipe: prev, past: state.past.slice(0, -1), future: [r, ...state.future].slice(0, HISTORY_CAP), dirty: true, lastEdit: null, playing: false });
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return keepInReel({ ...state, recipe: next, past: [...state.past, r].slice(-HISTORY_CAP), future: state.future.slice(1), dirty: true, lastEdit: null, playing: false });
    }
    case "saved":
    case "created": {
      const sent = action.sent;
      const same = !sent || (sent.recipe === state.recipe && sent.title === state.title);
      return {
        ...state,
        draftId: action.draft.id,
        baseUpdatedAt: action.draft.updatedAt,
        // A new reel saved without a name takes the server's ("<listing> reel").
        title: state.title || action.draft.title,
        dirty: !same,
        // Typing on after a save starts a new undo step.
        lastEdit: null,
      };
    }
  }
}

function uniqueId(r: ReelRecipe) {
  let id = newClipId();
  while (r.clips.some((c) => c.id === id)) id = newClipId();
  return id;
}

function structuredCloneClip(c: ReelClip, id: string): ReelClip {
  return { ...c, id, source: { ...c.source }, text: { ...c.text }, transitionIn: { ...c.transitionIn }, audio: { ...c.audio } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Selectors
// ─────────────────────────────────────────────────────────────────────────────

const timelines = new WeakMap<ReelRecipe, Timeline>();
/** The recipe's timeline (cached per recipe object). */
export function timelineOf(recipe: ReelRecipe): Timeline {
  let t = timelines.get(recipe);
  if (!t) {
    t = buildTimeline(recipe);
    timelines.set(recipe, t);
  }
  return t;
}

export function selectedClip(state: EditorState): ReelClip | null {
  return state.recipe.clips.find((c) => c.id === state.selected) ?? null;
}

/** What stops saving (the server refuses these), as messages for people. */
export function saveProblems(state: Pick<EditorState, "recipe">) {
  return validateRecipe(state.recipe);
}

/** What stops a render now. */
export function renderProblems(state: Pick<EditorState, "recipe">) {
  return validateRecipe(state.recipe, { forRender: true });
}

export function editorWarnings(state: Pick<EditorState, "recipe">) {
  return recipeWarnings(state.recipe, timelineOf(state.recipe).durationSec);
}

export const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Words that fit the reel at WORDS_PER_SECOND (at least 1 when there is a reel). */
export function wordBudget(reelSec: number, startSec = 0) {
  const sec = Math.max(0, reelSec - startSec);
  return sec > 0 ? Math.max(1, Math.round(sec * WORDS_PER_SECOND)) : 0;
}

/** The problems of one clip (the "Clip n:" messages), for the inspector. */
export function clipProblems(problems: string[], index: number) {
  const tag = `Clip ${index + 1}:`;
  return problems.filter((p) => p.startsWith(tag)).map((p) => p.slice(tag.length).trim());
}

/** Seconds as "12.4 s" / "1:05". */
export function formatSec(sec: number, precise = false) {
  if (!Number.isFinite(sec) || sec < 0) return "0 s";
  if (sec < 60) return `${precise ? sec.toFixed(2) : sec.toFixed(1)} s`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec - m * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Playhead as "0:04.2". */
export function formatClock(sec: number) {
  const t = Math.max(0, sec);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Voice and captions
// ─────────────────────────────────────────────────────────────────────────────

/** Caption lines from a narration: its spoken word timings, or the script spread over its length. */
export function captionLinesFor(n: { words: CaptionWord[] | null | undefined; script: string | null | undefined; durationSec: number | null | undefined }): CaptionLine[] {
  const words = n.words?.length ? n.words : estimateWords(n.script ?? "", n.durationSec ?? 0);
  return wordsToLines(words).slice(0, LIMITS.captionLines);
}

/** The voice track for a narration, keeping the reel's own choices (start, volume, caption look). */
export function voiceFromNarration(n: NarrationView, prev: VoiceTrack | null): VoiceTrack {
  const base = prev ?? defaultVoice();
  const voice: VoiceTrack = {
    ...base,
    narrationId: n.id,
    url: n.url,
    durationSec: n.durationSec > 0 ? n.durationSec : undefined,
    script: (n.script ?? base.script ?? "").slice(0, LIMITS.scriptChars) || undefined,
    voice: n.voice ?? base.voice,
    captions: { ...base.captions, lines: captionLinesFor(n) },
  };
  for (const k of Object.keys(voice) as (keyof VoiceTrack)[]) if (voice[k] === undefined) delete voice[k];
  return voice;
}

/** A written script not voiced yet (the voice track holds it until "Generate voice"). */
export function scriptVoice(script: string, voiceName: string, prev: VoiceTrack | null): VoiceTrack {
  const base = prev ?? defaultVoice();
  const voice: VoiceTrack = { ...base, script: script.slice(0, LIMITS.scriptChars), voice: voiceName || base.voice };
  // A changed script no longer matches the old MP3: it must be voiced again.
  if (prev?.url && prev.script !== voice.script) {
    delete voice.url;
    delete voice.narrationId;
    delete voice.durationSec;
    voice.captions = { ...voice.captions, lines: [] };
  }
  if (!voice.voice) delete voice.voice;
  return voice;
}

// ─────────────────────────────────────────────────────────────────────────────
// Saving and the device copy
// ─────────────────────────────────────────────────────────────────────────────

/** What a "changed since you opened it" refusal from reels.update looks like. */
export function isConflictError(message: string) {
  return /changed since you opened it/i.test(message);
}

/** The title a new reel gets when none was typed (the server's default is the same idea). */
export function defaultTitle(recipe: ReelRecipe, listingTitle?: string | null) {
  if (listingTitle) return `${listingTitle} reel`.slice(0, LIMITS.titleChars);
  return recipe.clips[0]?.source.label ? `${recipe.clips[0].source.label}`.slice(0, LIMITS.titleChars) : "New reel";
}

/** Unsaved work kept on this device per draft ("new" before the draft exists). */
export type LocalCopy = { recipe: ReelRecipe; title: string; baseUpdatedAt: number | null; draftId: string | null; at: number };

/**
 * Whether a device copy should be put back over the server's draft: only
 * when it was made from this very version (else the server's is newer and
 * wins; the editor says so).
 */
export function shouldRestore(local: LocalCopy | null, draft: Pick<DraftView, "updatedAt"> | null): boolean {
  if (!local) return false;
  if (!draft) return local.draftId === null;
  return local.baseUpdatedAt === draft.updatedAt;
}

/** A short stable fingerprint of a recipe (is this render still the reel on screen?). */
export function recipeKey(recipe: ReelRecipe): string {
  const s = JSON.stringify(recipe);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** A story takes one 9:16 video of 3 to 60 seconds. */
export function storyFits(aspect: ReelAspect, durationSec: number) {
  return aspect === "9:16" && durationSec >= 3 && durationSec <= 60;
}
