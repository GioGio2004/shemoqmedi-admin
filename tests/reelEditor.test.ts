// The reel editor's pure state (lib/studio/reelEditor.ts), its background
// render job (lib/studio/reelRender.ts) and the upload checks
// (components/studio/reels/editor/upload.ts). Contract: docs/reel-editor.md.

import { describe, expect, it, vi } from "vitest";
import type { DraftView } from "../convex/reels";
import type { NarrationView } from "../convex/voiceover";
import { defaultRecipe, defaultVoice, validateRecipe, type ClipSource, type ReelRecipe } from "../lib/reel/recipe";
import { buildTimeline } from "../lib/reel/timeline";
import {
  HISTORY_CAP,
  captionLinesFor,
  clipProblems,
  cleanClipPatch,
  countWords,
  editorReducer,
  formatClock,
  initialEditorState,
  isConflictError,
  recipeKey,
  saveProblems,
  scriptVoice,
  selectedClip,
  shouldRestore,
  storyFits,
  voiceFromNarration,
  wordBudget,
  type EditorAction,
  type EditorState,
} from "../lib/studio/reelEditor";
import { createReelRenders, isCancelled } from "../lib/studio/reelRender";
import { createDraftStore, type DraftStorage } from "../lib/studio/persist";
import { uploadProblem, uploadType } from "../components/studio/reels/editor/upload";

const video = (n: number, durationSec?: number): ClipSource => ({ kind: "listingVideo", url: `https://cdn.example.com/v${n}.mp4`, listingId: `l${n}`, label: `Video ${n}`, durationSec, width: 1080, height: 1920 });
const shot = (n: number): ClipSource => ({ kind: "screenshot", url: `https://ik.imagekit.io/x/s${n}.webp`, width: 1440, height: 900 });

const run = (state: EditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, state);
const fresh = () => initialEditorState(defaultRecipe());

function draft(recipe: ReelRecipe, extra: Partial<DraftView> = {}): DraftView {
  return {
    id: "d1" as DraftView["id"],
    title: "Paper Weather reel",
    status: "draft",
    createdBy: "studio",
    note: null,
    postId: null,
    listingIds: [],
    aspect: recipe.reel.aspect,
    clipCount: recipe.clips.length,
    durationSec: buildTimeline(recipe).durationSec,
    cover: null,
    renderedUrl: null,
    mediaId: null,
    renderedAt: null,
    createdAt: 1,
    updatedAt: 100,
    recipe,
    problems: [],
    warnings: [],
    ...extra,
  };
}

function memoryStorage(): DraftStorage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe("editor reducer: clips", () => {
  it("adds clips with the recipe's defaults, selects the first and seeks to it", () => {
    const s = run(fresh(), { type: "addClips", sources: [video(1, 20), shot(1)] });
    expect(s.recipe.clips).toHaveLength(2);
    const [v, still] = s.recipe.clips;
    expect(v).toMatchObject({ inSec: 0, outSec: 15, speed: 1, motion: "none", fit: "fill", audio: { on: false, gain: 1 } });
    expect(still).toMatchObject({ durationSec: 3, motion: "zoomIn", fit: "blur" });
    expect(s.selected).toBe(v.id);
    expect(s.dirty).toBe(true);
    expect(validateRecipe(s.recipe)).toEqual([]);

    const t = run(s, { type: "addClips", sources: [shot(2)], at: 1 });
    expect(t.recipe.clips.map((c) => c.source.url)).toEqual([video(1).url, shot(2).url, shot(1).url]);
    expect(t.selected).toBe(t.recipe.clips[1].id);
    expect(t.time).toBeCloseTo(buildTimeline(t.recipe).items[1].start);
  });

  it("moves, duplicates (new id) and removes clips, keeping a sensible selection", () => {
    let s = run(fresh(), { type: "addClips", sources: [shot(1), shot(2), shot(3)] });
    const [a, b, c] = s.recipe.clips.map((x) => x.id);
    s = run(s, { type: "moveClip", id: a, to: 2 });
    expect(s.recipe.clips.map((x) => x.id)).toEqual([b, c, a]);
    expect(run(s, { type: "moveClip", id: a, to: 99 }).recipe.clips.map((x) => x.id)).toEqual([b, c, a]);

    s = run(s, { type: "duplicateClip", id: b });
    expect(s.recipe.clips).toHaveLength(4);
    const copy = s.recipe.clips[1];
    expect(copy.id).not.toBe(b);
    expect(copy.source).toEqual(s.recipe.clips[0].source);
    expect(copy.source).not.toBe(s.recipe.clips[0].source);
    expect(s.selected).toBe(copy.id);
    expect(new Set(s.recipe.clips.map((x) => x.id)).size).toBe(4);

    s = run(s, { type: "removeClip", id: copy.id });
    expect(s.selected).toBe(c); // the next one
    s = run(s, { type: "removeClip", id: a }, { type: "removeClip", id: c }, { type: "removeClip", id: b });
    expect(s.recipe.clips).toEqual([]);
    expect(s.selected).toBeNull();
    expect(s.time).toBe(0);
  });

  it("keeps clip edits inside the limits; stills stay stills", () => {
    let s = run(fresh(), { type: "addClips", sources: [video(1, 10), shot(1)] });
    const [v, still] = s.recipe.clips;
    s = run(s, { type: "updateClip", id: v.id, patch: { speed: 9, outSec: 50, inSec: -2 } });
    expect(s.recipe.clips[0]).toMatchObject({ speed: 2, inSec: 0, outSec: 10 });
    s = run(s, { type: "updateClip", id: still.id, patch: { durationSec: 99, speed: 2, inSec: 4 } });
    expect(s.recipe.clips[1]).toMatchObject({ durationSec: 30, speed: 1, inSec: 0, outSec: 0 });
    const cut = cleanClipPatch(s.recipe.clips[1], { transitionIn: { type: "cut", durationSec: 1 } });
    expect(cut.transitionIn).toEqual({ type: "cut", durationSec: 0 });
    const long = cleanClipPatch(s.recipe.clips[1], { transitionIn: { type: "morph", durationSec: 7 } });
    expect(long.transitionIn).toEqual({ type: "morph", durationSec: 2 });
    const text = cleanClipPatch(s.recipe.clips[1], { text: { ...still.text, on: true, text: "x".repeat(500) } });
    expect(text.text.text).toHaveLength(200);
  });

  it("applies a probe to the clip and its history: the trim fits the real video, the fit follows its shape", () => {
    const unknown: ClipSource = { kind: "upload-video", url: "https://r2.example.com/c.mp4" };
    let s = run(fresh(), { type: "addClips", sources: [unknown] });
    const id = s.recipe.clips[0].id;
    expect(s.recipe.clips[0]).toMatchObject({ outSec: 8, fit: "blur" });
    s = run(s, { type: "updateClip", id, patch: { inSec: 1 } });
    s = run(s, { type: "probed", id, sourceSec: 5, width: 1080, height: 1920 });
    expect(s.recipe.clips[0]).toMatchObject({ inSec: 1, outSec: 5, fit: "fill", source: { durationSec: 5, width: 1080, height: 1920 } });
    // Undo never brings back a trim past the end of the file.
    const u = run(s, { type: "undo" });
    expect(u.recipe.clips[0].outSec).toBe(5);
    expect(u.recipe.clips[0].inSec).toBe(0);
    // A second probe with the same answer changes nothing.
    expect(run(s, { type: "probed", id, sourceSec: 5, width: 1080, height: 1920 })).toBe(s);
  });

  it("keeps a chosen fit when the size arrives", () => {
    let s = run(fresh(), { type: "addClips", sources: [{ kind: "graphic", url: "https://ik.imagekit.io/g.png" }] });
    const id = s.recipe.clips[0].id;
    s = run(s, { type: "updateClip", id, patch: { fit: "letterbox" } });
    s = run(s, { type: "probed", id, sourceSec: 0, width: 1080, height: 1920 });
    expect(s.recipe.clips[0].fit).toBe("letterbox");
  });
});

describe("editor reducer: undo, saving, loading", () => {
  it("undoes and redoes; typing in one field is one step", () => {
    let s = run(fresh(), { type: "addClips", sources: [shot(1)] });
    const id = s.recipe.clips[0].id;
    const text = s.recipe.clips[0].text;
    for (const t of ["H", "He", "Hel", "Hello"]) s = run(s, { type: "updateClip", id, patch: { text: { ...text, on: true, text: t } } });
    expect(s.past).toHaveLength(2); // add, then the whole word
    s = run(s, { type: "undo" });
    expect(s.recipe.clips[0].text.text).toBe("");
    expect(s.future).toHaveLength(1);
    s = run(s, { type: "redo" });
    expect(s.recipe.clips[0].text.text).toBe("Hello");
    // A new edit drops the redo steps.
    s = run(s, { type: "undo" }, { type: "setAspect", aspect: "1:1" });
    expect(s.future).toEqual([]);
    expect(run(fresh(), { type: "undo" })).toEqual(fresh());
  });

  it("caps the history", () => {
    let s = run(fresh(), { type: "addClips", sources: [shot(1)] });
    for (let i = 0; i < HISTORY_CAP + 20; i++) s = run(s, { type: "setAspect", aspect: i % 2 ? "9:16" : "1:1" });
    expect(s.past).toHaveLength(HISTORY_CAP);
  });

  it("stays dirty when edits came in while saving", () => {
    let s = run(fresh(), { type: "addClips", sources: [shot(1)] });
    const sent = { recipe: s.recipe, title: s.title };
    expect(run(s, { type: "saved", draft: draft(s.recipe, { updatedAt: 5 }), sent })).toMatchObject({ dirty: false, baseUpdatedAt: 5, draftId: "d1" });
    s = run(s, { type: "setAspect", aspect: "4:5" });
    expect(run(s, { type: "saved", draft: draft(sent.recipe, { updatedAt: 6 }), sent }).dirty).toBe(true);
  });

  it("takes the server's name for a new reel saved without one", () => {
    const s = run(fresh(), { type: "addClips", sources: [shot(1)] });
    const out = run(s, { type: "created", draft: draft(s.recipe), sent: { recipe: s.recipe, title: "" } });
    expect(out).toMatchObject({ title: "Paper Weather reel", dirty: false, draftId: "d1", baseUpdatedAt: 100 });
  });

  it("loads a draft fresh and puts a device copy back as an undoable change", () => {
    const recipe = run(fresh(), { type: "addClips", sources: [shot(1), shot(2)] }).recipe;
    const loaded = run(fresh(), { type: "load", draft: draft(recipe) });
    expect(loaded).toMatchObject({ draftId: "d1", baseUpdatedAt: 100, title: "Paper Weather reel", dirty: false, past: [] });
    expect(loaded.selected).toBe(recipe.clips[0].id);
    const local = { ...recipe, reel: { ...recipe.reel, aspect: "1:1" as const } };
    const restored = run(loaded, { type: "restore", recipe: local, title: "Mine" });
    expect(restored).toMatchObject({ dirty: true, title: "Mine" });
    expect(run(restored, { type: "undo" }).recipe).toBe(recipe);
  });

  it("restores a device copy only over the version it was made from", () => {
    const recipe = defaultRecipe();
    const copy = { recipe, title: "", baseUpdatedAt: 100, draftId: "d1", at: 1 };
    expect(shouldRestore(copy, { updatedAt: 100 })).toBe(true);
    expect(shouldRestore(copy, { updatedAt: 120 })).toBe(false);
    expect(shouldRestore(null, { updatedAt: 100 })).toBe(false);
    expect(shouldRestore({ ...copy, draftId: null, baseUpdatedAt: null }, null)).toBe(true);
  });

  it("recognises the server's conflict message", () => {
    expect(isConflictError("This reel changed since you opened it (by Claude). Load it again.")).toBe(true);
    expect(isConflictError("Clip 1: bad id.")).toBe(false);
  });

  it("seeks inside the reel and only plays with clips", () => {
    expect(run(fresh(), { type: "play" }).playing).toBe(false);
    const s = run(fresh(), { type: "addClips", sources: [shot(1)] }, { type: "seek", time: 99 }, { type: "play" });
    expect(s.time).toBe(3);
    expect(s.playing).toBe(true);
    expect(run(s, { type: "seek", time: -4 }).time).toBe(0);
  });
});

describe("editor reducer: sound and captions", () => {
  const narration: NarrationView = {
    id: "a1" as NarrationView["id"],
    url: "https://r2.example.com/v.mp3",
    durationSec: 2,
    script: "Hello there. Paper Weather.",
    voice: "Crow",
    listingId: null,
    words: [
      { text: "Hello", startSec: 0, endSec: 0.4 },
      { text: "there.", startSec: 0.4, endSec: 0.8 },
      { text: "Paper", startSec: 1, endSec: 1.4 },
      { text: "Weather.", startSec: 1.4, endSec: 1.9 },
    ],
    createdAt: 1,
  };

  it("makes a voice track from a narration, keeping the reel's own choices", () => {
    const prev = { ...defaultVoice({ script: "old" }), startSec: 1.5, gain: 0.8 };
    prev.captions = { ...prev.captions, style: "highlight", position: "top" };
    const v = voiceFromNarration(narration, prev);
    expect(v).toMatchObject({ narrationId: "a1", url: narration.url, durationSec: 2, voice: "Crow", startSec: 1.5, gain: 0.8 });
    expect(v.captions).toMatchObject({ style: "highlight", position: "top", on: true });
    expect(v.captions.lines.map((l) => l.text)).toEqual(["Hello there.", "Paper Weather."]);
    expect(v.captions.lines[0].words).toHaveLength(2);
  });

  it("spreads a narration without timings over its length", () => {
    const lines = captionLinesFor({ words: null, script: "one two three four", durationSec: 2 });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[lines.length - 1].endSec).toBeCloseTo(2);
  });

  it("a changed script must be voiced again", () => {
    const voiced = voiceFromNarration(narration, null);
    const same = scriptVoice(narration.script!, "Crow", voiced);
    expect(same.url).toBe(narration.url);
    const changed = scriptVoice("Something else", "Crow", voiced);
    expect(changed.url).toBeUndefined();
    expect(changed.narrationId).toBeUndefined();
    expect(changed.captions.lines).toEqual([]);
    let s = run(fresh(), { type: "addClips", sources: [shot(1)] }, { type: "setVoice", voice: changed });
    expect(saveProblems(s)).toEqual([]); // a script alone saves
    expect(validateRecipe(s.recipe, { forRender: true }).join(" ")).toMatch(/not voiced/);
    s = run(s, { type: "setVoice", voice: voiced });
    expect(validateRecipe(s.recipe, { forRender: true })).toEqual([]);
  });

  it("edits voice, captions and music within their limits", () => {
    let s = run(fresh(), { type: "addClips", sources: [shot(1)] }, { type: "setVoice", voice: voiceFromNarration(narration, null) });
    s = run(s, { type: "patchVoice", patch: { gain: 5, startSec: -1 } });
    expect(s.recipe.audio.voice).toMatchObject({ gain: 2, startSec: 0 });
    s = run(s, { type: "editCaption", index: 0, text: "Hi  you." });
    expect(s.recipe.audio.voice!.captions.lines[0]).toMatchObject({ text: "Hi you.", words: [{ text: "Hi" }, { text: "you." }] });
    s = run(s, { type: "editCaption", index: 1, text: "Paper Weather by Kencho" });
    expect(s.recipe.audio.voice!.captions.lines[1].words).toBeUndefined();
    s = run(s, { type: "setCaptions", patch: { style: "box", on: false } });
    expect(s.recipe.audio.voice!.captions).toMatchObject({ style: "box", on: false });

    s = run(s, { type: "setMusic", music: { url: "https://r2.example.com/m.mp3", offsetSec: 0, gain: 0.5, loop: true, duck: { on: true, amount: 0.6 } } });
    s = run(s, { type: "patchMusic", patch: { gain: -1, offsetSec: 12, duck: { on: false, amount: 3 } } });
    expect(s.recipe.audio.music).toMatchObject({ gain: 0, offsetSec: 12, duck: { on: false, amount: 1 } });
    s = run(s, { type: "setClipGain", gain: 3 }, { type: "setFades", patch: { videoInSec: 9, audioOutSec: 1 } });
    expect(s.recipe.audio.clipGain).toBe(2);
    expect(s.recipe.fades).toMatchObject({ videoInSec: 5, audioOutSec: 1 });
    expect(validateRecipe(s.recipe)).toEqual([]);
  });

  it("budgets words at 2.5 a second", () => {
    expect(wordBudget(10)).toBe(25);
    expect(wordBudget(10, 4)).toBe(15);
    expect(wordBudget(0)).toBe(0);
    expect(countWords("  one two\nthree ")).toBe(3);
  });
});

describe("editor selectors and helpers", () => {
  it("finds the selected clip and its problems", () => {
    const s = run(fresh(), { type: "addClips", sources: [shot(1)] });
    expect(selectedClip(s)?.id).toBe(s.recipe.clips[0].id);
    expect(clipProblems(["Clip 1: too short.", "Clip 2: bad id.", "Voice: bad"], 0)).toEqual(["too short."]);
  });

  it("fingerprints recipes and checks story fit", () => {
    const a = run(fresh(), { type: "addClips", sources: [shot(1)] }).recipe;
    expect(recipeKey(a)).toBe(recipeKey(JSON.parse(JSON.stringify(a))));
    expect(recipeKey({ ...a, reel: { ...a.reel, aspect: "1:1" } })).not.toBe(recipeKey(a));
    expect(storyFits("9:16", 10)).toBe(true);
    expect(storyFits("9:16", 61)).toBe(false);
    expect(storyFits("4:5", 10)).toBe(false);
    expect(formatClock(65.25)).toBe("1:05.3");
  });
});

describe("render job", () => {
  const out = { url: "https://r2.example.com/r.mp4", mediaId: "m1", width: 1080, height: 1920, durationSec: 9, size: 1000 };

  it("runs one render at a time, keeps the result per draft and guards leaving", async () => {
    const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const jobs = createReelRenders(createDraftStore("t-render", memoryStorage), () => target as never);
    const seen: (string | null)[] = [];
    jobs.subscribe(() => seen.push(jobs.get().stage?.label ?? null));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const p = jobs.run("d1", "k1", async (report) => {
      report({ label: "Rendering", fraction: 0.5 });
      await gate;
      return out;
    });
    expect(jobs.get().running).toBe("d1");
    expect(target.addEventListener).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    expect(await jobs.run("d2", "k2", async () => out)).toBeNull();
    release();
    const done = await p;
    expect(done).toMatchObject({ ...out, key: "d1", recipeKey: "k1" });
    expect(jobs.get()).toEqual({ running: null, stage: null });
    expect(jobs.done("d1")).toMatchObject({ url: out.url });
    expect(target.removeEventListener).toHaveBeenCalled();
    expect(seen).toContain("Rendering");

    jobs.adopt("d1", "d9");
    expect(jobs.done("d1")).toBeNull();
    expect(jobs.done("d9")?.key).toBe("d9");
    jobs.clear("d9");
    expect(jobs.done("d9")).toBeNull();
  });

  it("cancels", async () => {
    const jobs = createReelRenders(createDraftStore("t-render-2", memoryStorage), () => null);
    const p = jobs.run("d1", "k", (_report, signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("Cancelled."), { code: "cancelled" })))));
    jobs.cancel();
    const err = await p.catch((e: unknown) => e);
    expect(isCancelled(err)).toBe(true);
    expect(jobs.get().running).toBeNull();
    expect(jobs.done("d1")).toBeNull();
  });
});

describe("device uploads", () => {
  it("takes MP4 / MOV / WebM clips and MP3 / M4A music, by type or file name", () => {
    expect(uploadType({ name: "a.mov", type: "" }, "clip")).toBe("video/quicktime");
    expect(uploadType({ name: "a.mp4", type: "video/mp4" }, "clip")).toBe("video/mp4");
    expect(uploadType({ name: "a.avi", type: "video/x-msvideo" }, "clip")).toBeNull();
    expect(uploadType({ name: "song.m4a", type: "" }, "music")).toBe("audio/mp4");
    expect(uploadType({ name: "song", type: "audio/mp3" }, "music")).toBe("audio/mpeg");
    expect(uploadProblem({ name: "a.mp4", type: "video/mp4", size: 201 * 1024 * 1024 }, "clip")).toMatch(/200 MB/);
    expect(uploadProblem({ name: "a.wav", type: "audio/wav", size: 10 }, "music")).toMatch(/MP3 or M4A/);
    expect(uploadProblem({ name: "a.mp3", type: "audio/mpeg", size: 1000 }, "music")).toBeNull();
  });
});
