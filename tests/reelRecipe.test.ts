// The REEL RECIPE (lib/reel/recipe.ts) and its timeline math
// (lib/reel/timeline.ts): pure functions shared by the editor, the preview,
// the render, Convex and the MCP tools.

import { describe, expect, it } from "vitest";
import {
  ASPECTS,
  LIMITS,
  ReelRecipeError,
  clampToSource,
  defaultClip,
  defaultFit,
  defaultMusic,
  defaultRecipe,
  defaultVoice,
  normalizeRecipe,
  recipeListingIds,
  recipeWarnings,
  validateRecipe,
  type ClipSource,
  type ReelRecipe,
} from "../lib/reel/recipe";
import {
  audioFadeAt,
  buildTimeline,
  captionAt,
  clipIndexAt,
  clipLength,
  containRect,
  coverRect,
  duckAt,
  editCaptionText,
  effectiveTransition,
  estimateWords,
  fitRect,
  frameAt,
  frameCount,
  motionAt,
  sourceTimeAt,
  speechWindows,
  transitionLook,
  videoFadeAt,
  wordsToLines,
} from "../lib/reel/timeline";
import { alignmentToWords, base64Bytes } from "../convex/lib/voiceover";
import { R2_UPLOAD_KEY, checkUpload, reelFolder, uploadKey, uploadKindOf } from "../convex/lib/reel";
import { R2_KEY, R2_SOCIAL_KEY } from "../convex/lib/r2";

const VIDEO: ClipSource = { kind: "listingVideo", url: "https://pub.r2.dev/listings/a/a.mp4", width: 1280, height: 720, durationSec: 12 };
const SHOT: ClipSource = { kind: "screenshot", url: "https://ik.imagekit.io/x/listings/a/cover.webp", width: 1600, height: 1000 };
const CARD: ClipSource = { kind: "graphic", url: "https://ik.imagekit.io/x/social/graphics/card.jpg", width: 1080, height: 1920 };

function recipe(clips = [defaultClip(VIDEO, "9:16", "a"), defaultClip(SHOT, "9:16", "b")]): ReelRecipe {
  return { ...defaultRecipe(), clips };
}

describe("recipe defaults", () => {
  it("an empty 9:16 reel at 30 fps", () => {
    const r = defaultRecipe();
    expect(r).toEqual({
      version: 1,
      reel: { aspect: "9:16", fps: 30 },
      clips: [],
      audio: { voice: null, music: null, clipGain: 1, evenLoudness: true },
      fades: { videoInSec: 0, videoOutSec: 0, audioInSec: 0, audioOutSec: 0.5 },
    });
    expect(ASPECTS["4:5"]).toMatchObject({ width: 1080, height: 1350 });
    expect(validateRecipe(r)).toEqual([]);
    expect(validateRecipe(r, { forRender: true })).toEqual(["Add at least one clip."]);
  });

  it("clips get sensible defaults by kind", () => {
    const v = defaultClip(VIDEO, "9:16", "v");
    expect(v).toMatchObject({ inSec: 0, outSec: 12, durationSec: 0, speed: 1, motion: "none", fit: "blur", audio: { on: false, gain: 1 } });
    expect(v.transitionIn).toEqual({ type: "crossfade", durationSec: 0.4 });
    expect(v.text).toEqual({ on: false, text: "", position: "bottom", style: "glass", size: "m" });
    expect(defaultClip({ ...VIDEO, durationSec: 40 }).outSec).toBe(15);
    expect(defaultClip({ ...VIDEO, durationSec: undefined }).outSec).toBe(8);
    const s = defaultClip(SHOT);
    expect(s).toMatchObject({ inSec: 0, outSec: 0, durationSec: 3, motion: "zoomIn", fit: "blur" });
    expect(defaultClip(CARD)).toMatchObject({ motion: "none", fit: "fill" });
    expect(defaultClip({ kind: "upload-video", url: "https://x/v.mp4" }).audio.on).toBe(true);
    expect(defaultFit({ width: 1080, height: 1080 }, "1:1")).toBe("fill");
    expect(defaultFit({}, "1:1")).toBe("blur");
    expect(defaultClip(SHOT).id).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
    expect(defaultClip(SHOT).id).not.toBe(defaultClip(SHOT).id);
  });

  it("voice and music defaults", () => {
    expect(defaultVoice({ url: "https://x/v.mp3" })).toEqual({
      url: "https://x/v.mp3",
      startSec: 0,
      gain: 1,
      captions: { on: true, style: "bold", position: "bottom", lines: [] },
    });
    expect(defaultMusic("https://x/m.mp3")).toEqual({ url: "https://x/m.mp3", offsetSec: 0, gain: 0.5, loop: true, duck: { on: true, amount: 0.6 } });
  });

  it("clamps a trim to a probed source and lists listings", () => {
    const v = { ...defaultClip(VIDEO, "9:16", "v"), inSec: 9, outSec: 12 };
    expect(clampToSource(v, 10)).toMatchObject({ inSec: 9, outSec: 10, source: { durationSec: 10 } });
    expect(clampToSource({ ...v, inSec: 9.9 }, 10).inSec).toBe(9.7);
    expect(clampToSource(defaultClip(SHOT), 10)).toEqual(expect.objectContaining({ durationSec: 3 }));
    const r = recipe([
      defaultClip({ ...VIDEO, listingId: "L1" }),
      defaultClip({ ...SHOT, listingId: "L2" }),
      defaultClip({ ...SHOT, listingId: "L1" }),
      defaultClip(CARD),
    ]);
    expect(recipeListingIds(r)).toEqual(["L1", "L2"]);
  });
});

describe("validateRecipe", () => {
  it("accepts a good recipe and names each problem", () => {
    expect(validateRecipe(recipe())).toEqual([]);
    const bad = recipe();
    bad.clips[0] = { ...bad.clips[0], inSec: 5, outSec: 4, speed: 3 };
    bad.clips[1] = { ...bad.clips[1], id: "a", durationSec: 40, source: { ...SHOT, url: "http://plain.example/x.jpg" } };
    const errors = validateRecipe(bad);
    expect(errors).toContain("Clip 1: the end must be after the start.");
    expect(errors).toContain("Clip 1: speed must be 0.5x to 2x.");
    expect(errors).toContain("Clip 2: its id is used twice.");
    expect(errors).toContain("Clip 2: the source must be a public https URL.");
    expect(errors).toContain("Clip 2: show a still for 0.5 to 30 seconds.");
  });

  it("checks trims against the source, transitions, texts and sound", () => {
    const r = recipe();
    r.clips[0] = { ...r.clips[0], outSec: 13, transitionIn: { type: "crossfade", durationSec: 3 }, audio: { on: true, gain: 5 } };
    r.clips[1] = { ...r.clips[1], text: { on: true, text: "x".repeat(201), position: "top", style: "glass", size: "m" } };
    const e = validateRecipe(r);
    expect(e).toContain("Clip 1: ends after the video does (12 s).");
    expect(e).toContain("Clip 1: a transition lasts 0 to 2 seconds.");
    expect(e).toContain("Clip 1: bad clip sound settings.");
    expect(e).toContain("Clip 2: keep the text under 200 characters.");
    const tiny = recipe([{ ...defaultClip(VIDEO, "9:16", "t"), inSec: 1, outSec: 1.2 }]);
    expect(validateRecipe(tiny)).toEqual(["Clip 1: too short (at least 0.3 s)."]);
  });

  it("a voice needs a narration or a script; rendering needs it voiced", () => {
    const r = recipe();
    r.audio.voice = defaultVoice({ script: "Paper Weather builds quiet sites." });
    expect(validateRecipe(r)).toEqual([]);
    expect(validateRecipe(r, { forRender: true })).toEqual([
      "Voice: the script is not voiced yet. Generate the voice first, or turn the voice off.",
    ]);
    r.audio.voice = defaultVoice({});
    expect(validateRecipe(r)).toContain("Voice: give a narration or a script.");
    r.audio.voice = defaultVoice({ url: "https://x/v.mp3", captions: { on: true, style: "bold", position: "bottom", lines: [{ text: "Hi", startSec: 2, endSec: 1 }] } });
    expect(validateRecipe(r)).toEqual(["Caption 1: bad timing."]);
    r.audio.voice = null;
    r.audio.music = { ...defaultMusic("https://x/m.mp3"), duck: { on: true, amount: 2 } };
    expect(validateRecipe(r)).toEqual(["Music: ducking is 0 to 1."]);
    r.audio.music = null;
    r.fades.audioOutSec = 9;
    expect(validateRecipe(r)).toEqual(["Fades last 0 to 5 seconds."]);
  });

  it("caps clips and length", () => {
    const many = recipe(Array.from({ length: LIMITS.clips + 1 }, (_, i) => defaultClip(SHOT, "9:16", `s${i}`)));
    expect(validateRecipe(many)).toContain("At most 40 clips.");
    const long = recipe(Array.from({ length: 7 }, (_, i) => ({ ...defaultClip(SHOT, "9:16", `s${i}`), durationSec: 30 })));
    expect(validateRecipe(long)).toContain("The reel is too long: keep it under 3 minutes.");
  });

  it("warns without refusing", () => {
    const r = recipe();
    r.audio.voice = defaultVoice({ url: "https://x/v.mp3", durationSec: 20 });
    const sec = buildTimeline(r).durationSec;
    expect(recipeWarnings(r, sec)).toEqual([
      `The narration runs ${Math.round((20 - sec) * 100) / 100} s past the end of the reel; it is cut there.`,
      "Captions are on but there are none yet.",
    ]);
  });
});

describe("normalizeRecipe", () => {
  it("fills a loose recipe from Claude with defaults", () => {
    const r = normalizeRecipe({
      clips: [
        { source: { kind: "listingVideo", url: VIDEO.url, durationSec: 12 }, inSec: 2, durationSec: 4, speed: 9 },
        { source: { kind: "screenshot", url: SHOT.url }, durationSec: 100, motion: "panLeft", text: "Paper Weather", transitionIn: "morph" },
        { source: { kind: "graphic", url: CARD.url, width: 1080, height: 1920 }, transitionIn: { type: "dipBlack", durationSec: 0.6 }, fit: "nope" },
      ],
      audio: { voice: { script: "  Hello there.  ", voice: "Nino" }, music: { url: "https://x/m.mp3", gain: 0.3 } },
    });
    expect(validateRecipe(r)).toEqual([]);
    expect(r.reel).toEqual({ aspect: "9:16", fps: 30 });
    const [a, b, c] = r.clips;
    expect(a).toMatchObject({ inSec: 2, outSec: 10, speed: 2, transitionIn: { type: "crossfade", durationSec: 0.4 } });
    expect(b).toMatchObject({ durationSec: 30, motion: "panLeft", transitionIn: { type: "morph", durationSec: 0.4 } });
    expect(b.text).toEqual({ on: true, text: "Paper Weather", position: "bottom", style: "glass", size: "m" });
    expect(c).toMatchObject({ fit: "fill", transitionIn: { type: "dipBlack", durationSec: 0.6 } });
    expect(new Set(r.clips.map((x) => x.id)).size).toBe(3);
    expect(r.audio.voice).toEqual({ script: "Hello there.", voice: "Nino", startSec: 0, gain: 1, captions: { on: true, style: "bold", position: "bottom", lines: [] } });
    expect(r.audio.music).toEqual({ url: "https://x/m.mp3", offsetSec: 0, gain: 0.3, loop: true, duck: { on: true, amount: 0.6 } });
  });

  it("keeps a full recipe as it is", () => {
    const r = recipe();
    r.audio.voice = defaultVoice({
      url: "https://x/v.mp3",
      narrationId: "n1",
      durationSec: 3,
      captions: { on: true, style: "highlight", position: "top", lines: [{ text: "Hi there", startSec: 0, endSec: 1, words: [{ text: "Hi", startSec: 0, endSec: 0.4 }, { text: "there", startSec: 0.5, endSec: 1 }] }] },
    });
    r.clips[1].transitionIn = { type: "pushUp", durationSec: 0.5 };
    expect(normalizeRecipe(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  it("refuses what it can't guess", () => {
    expect(() => normalizeRecipe(null)).toThrow(ReelRecipeError);
    expect(() => normalizeRecipe({})).toThrow("The recipe needs a clips list.");
    expect(() => normalizeRecipe({ version: 2, clips: [] })).toThrow("Unknown recipe version 2.");
    expect(() => normalizeRecipe({ clips: [{}] })).toThrow("Clip 1: give a source.");
    expect(() => normalizeRecipe({ clips: [{ source: { kind: "gif", url: "https://x" } }] })).toThrow(/source kind must be one of/);
    expect(() => normalizeRecipe({ clips: [{ source: { kind: "graphic" } }] })).toThrow("Clip 1: the source has no URL.");
  });
});

describe("timeline", () => {
  const r = recipe([
    { ...defaultClip(VIDEO, "9:16", "a"), inSec: 2, outSec: 6, speed: 2 }, // 2 s
    { ...defaultClip(SHOT, "9:16", "b"), durationSec: 3, transitionIn: { type: "crossfade", durationSec: 0.5 } },
    { ...defaultClip(CARD, "9:16", "c"), durationSec: 2, transitionIn: { type: "cut", durationSec: 0.5 } },
    { ...defaultClip(CARD, "9:16", "d"), durationSec: 0.6, transitionIn: { type: "pushLeft", durationSec: 1 } },
  ]);
  const tl = buildTimeline(r);

  it("places clips with overlapping transitions", () => {
    expect(clipLength(r.clips[0])).toBe(2);
    expect(tl.items.map((i) => [i.start, i.end, i.transIn, i.transOut])).toEqual([
      [0, 2, 0, 0.5],
      [1.5, 4.5, 0.5, 0],
      [4.5, 6.5, 0, 0.3],
      [6.2, 6.8, 0.3, 0],
    ]);
    expect(tl.durationSec).toBeCloseTo(6.8);
    expect(effectiveTransition("crossfade", 1, 4, 0.6)).toBe(0.3);
    expect(effectiveTransition("cut", 1, 4, 4)).toBe(0);
    expect(effectiveTransition("morph", 5, 10, 10)).toBe(2);
    expect(frameCount(tl.durationSec)).toBe(204);
    expect(frameCount(0)).toBe(1);
    expect(buildTimeline({ clips: [] })).toEqual({ items: [], durationSec: 0 });
  });

  it("says what is on screen at t", () => {
    expect(frameAt(tl, 1)).toMatchObject({ a: { item: { id: "a" }, localSec: 1, sourceSec: 4 }, b: null, transition: null });
    const mid = frameAt(tl, 1.75);
    expect(mid.a?.item.id).toBe("a");
    expect(mid.b?.item.id).toBe("b");
    expect(mid.transition?.type).toBe("crossfade");
    expect(mid.transition?.progress).toBeCloseTo(0.5);
    expect(mid.b?.localSec).toBeCloseTo(0.25);
    expect(frameAt(tl, 4.5)).toMatchObject({ a: { item: { id: "c" } }, b: null });
    expect(frameAt(tl, 99).a?.item.id).toBe("d");
    expect(frameAt(tl, -1).a?.item.id).toBe("a");
    expect(clipIndexAt(tl, 1.75)).toBe(1);
    expect(frameAt(buildTimeline({ clips: [] }), 0)).toEqual({ a: null, b: null, transition: null });
    expect(sourceTimeAt({ inSec: 2, outSec: 6, speed: 2 }, 5)).toBeCloseTo(5.999);
  });

  it("fits pictures and moves them", () => {
    expect(coverRect(1920, 1080, 1080, 1920)).toEqual({ x: -1166.6666666666665, y: 0, w: 3413.333333333333, h: 1920 });
    expect(containRect(1920, 1080, 1080, 1920)).toEqual({ x: 0, y: 656.25, w: 1080, h: 607.5 });
    expect(fitRect("fill", 100, 100, 50, 100)).toEqual(coverRect(100, 100, 50, 100));
    expect(fitRect("letterbox", 100, 100, 50, 100)).toEqual(containRect(100, 100, 50, 100));
    expect(motionAt("none", 0.5)).toEqual({ scale: 1, dx: 0, dy: 0 });
    expect(motionAt("zoomIn", 0)).toEqual({ scale: 1, dx: 0, dy: 0 });
    expect(motionAt("zoomIn", 1).scale).toBeCloseTo(1.12);
    expect(motionAt("zoomOut", 1).scale).toBeCloseTo(1);
    expect(motionAt("panLeft", 0).dx).toBeCloseTo(0.06);
    expect(motionAt("panLeft", 1).dx).toBeCloseTo(-0.06);
    expect(motionAt("panUp", 1).dy).toBeCloseTo(-0.06);
    expect(motionAt("panDown", 2).dy).toBeCloseTo(0.06);
  });

  it("describes every transition", () => {
    expect(transitionLook("cut", 0.5)).toMatchObject({ a: { alpha: 0 }, b: { alpha: 1 } });
    expect(transitionLook("crossfade", 0.25).b.alpha).toBe(0.25);
    expect(transitionLook("dipBlack", 0.25)).toMatchObject({ a: { alpha: 1 }, b: { alpha: 0 }, overlay: { color: "black", alpha: 0.5 } });
    expect(transitionLook("dipWhite", 0.75)).toMatchObject({ a: { alpha: 0 }, b: { alpha: 1 }, overlay: { color: "white", alpha: 0.5 } });
    const m = transitionLook("morph", 0.5);
    expect(m.a.scale).toBeGreaterThan(1);
    expect(m.a.blur).toBeGreaterThan(0);
    expect(m.b.alpha).toBeCloseTo(0.5);
    expect(transitionLook("slideLeft", 0).b.dx).toBe(1);
    expect(transitionLook("slideLeft", 1).b.dx).toBe(0);
    expect(transitionLook("slideRight", 0).b.dx).toBe(-1);
    expect(transitionLook("slideUp", 0).b.dy).toBe(1);
    expect(transitionLook("pushLeft", 1)).toMatchObject({ a: { dx: -1 }, b: { dx: 0 } });
    expect(transitionLook("pushRight", 1).a.dx).toBe(1);
    expect(transitionLook("pushUp", 1).a.dy).toBe(-1);
  });

  it("fades video and sound", () => {
    expect(videoFadeAt(0, 10, 1, 0)).toBe(1);
    expect(videoFadeAt(0.5, 10, 1, 0)).toBe(0.5);
    expect(videoFadeAt(9.5, 10, 0, 1)).toBe(0.5);
    expect(videoFadeAt(5, 10, 1, 1)).toBe(0);
    expect(audioFadeAt(0.25, 10, 0.5, 0)).toBe(0.5);
    expect(audioFadeAt(10, 10, 0, 0.5)).toBe(0);
    expect(audioFadeAt(5, 10, 0.5, 0.5)).toBe(1);
  });
});

describe("audio ducking and captions", () => {
  const words = [
    { text: "Paper", startSec: 0, endSec: 0.4 },
    { text: "Weather", startSec: 0.45, endSec: 0.9 },
    { text: "builds", startSec: 2.5, endSec: 2.8 },
    { text: "sites.", startSec: 2.85, endSec: 3.2 },
    { text: "Quiet", startSec: 3.3, endSec: 3.6 },
  ];

  it("ducks the music while the voice speaks", () => {
    const voice = defaultVoice({ url: "https://x/v.mp3", startSec: 1, durationSec: 4, captions: { on: true, style: "bold", position: "bottom", lines: wordsToLines(words) } });
    expect(speechWindows(voice)).toEqual([
      [1, 1.9],
      [3.5, 4.6],
    ]);
    expect(speechWindows(defaultVoice({ url: "https://x/v.mp3", startSec: 1, durationSec: 4 }))).toEqual([[1, 5]]);
    expect(speechWindows(null)).toEqual([]);
    const w = speechWindows(voice);
    expect(duckAt(1.5, w, 0.6)).toBeCloseTo(0.4);
    expect(duckAt(0.5, w, 0.6)).toBe(1);
    expect(duckAt(0.875, w, 0.6)).toBeCloseTo(0.7);
    expect(duckAt(2.5, w, 0.6)).toBe(1);
  });

  it("groups words into caption lines and finds the word being said", () => {
    const lines = wordsToLines(words);
    expect(lines.map((l) => [l.text, l.startSec, l.endSec])).toEqual([
      ["Paper Weather", 0, 0.9],
      ["builds sites.", 2.5, 3.2],
      ["Quiet", 3.3, 3.6],
    ]);
    expect(wordsToLines(words, { maxChars: 8 }).map((l) => l.text)).toEqual(["Paper", "Weather", "builds", "sites.", "Quiet"]);
    expect(captionAt(lines, 0.6)).toMatchObject({ index: 0, word: 1 });
    expect(captionAt(lines, 0.42)).toMatchObject({ index: 0, word: 0 });
    expect(captionAt(lines, 1.5)).toBeNull();
    expect(captionAt([{ text: "Whole", startSec: 0, endSec: 1 }], 0.5)).toMatchObject({ word: -1 });
  });

  it("spreads a script without timings, and keeps timings through small edits", () => {
    const est = estimateWords("Hi there friend", 3);
    expect(est.map((w) => w.text)).toEqual(["Hi", "there", "friend"]);
    expect(est[0].startSec).toBe(0);
    expect(est[2].endSec).toBe(3);
    expect(estimateWords("", 3)).toEqual([]);
    const [line] = wordsToLines(words.slice(0, 2));
    expect(editCaptionText(line, " Paper  Wether ")).toMatchObject({ text: "Paper Wether", words: [{ text: "Paper" }, { text: "Wether", startSec: 0.45 }] });
    expect(editCaptionText(line, "Paper Weather Studio")).toEqual({ text: "Paper Weather Studio", startSec: 0, endSec: 0.9 });
  });

  it("turns ElevenLabs character timings into words", () => {
    const text = "Hi  there.";
    const chars = [...text];
    const starts = chars.map((_, i) => i * 0.1);
    const ends = chars.map((_, i) => i * 0.1 + 0.08);
    expect(alignmentToWords({ characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends })).toEqual([
      { text: "Hi", startSec: 0, endSec: 0.18 },
      { text: "there.", startSec: 0.4, endSec: 0.98 },
    ]);
    expect(alignmentToWords(null)).toEqual([]);
    expect(alignmentToWords({ characters: ["a"], character_start_times_seconds: [], character_end_times_seconds: [] })).toEqual([]);
    expect(Array.from(base64Bytes("AAEC/w=="))).toEqual([0, 1, 2, 255]);
  });
});

describe("reel upload keys", () => {
  it("makes and recognises clip and music keys", () => {
    const clip = uploadKey("Paper Weather", "clip", "mov");
    expect(clip).toMatch(/^social\/paper-weather\/paper-weather-clip-[a-f0-9]{10}\.mov$/);
    expect(uploadKindOf(clip)).toBe("clip");
    expect(uploadKindOf(uploadKey("reels", "music", "m4a"))).toBe("music");
    expect(reelFolder(null)).toBe("reels");
    expect(reelFolder("  ")).toBe("reels");
    expect(reelFolder("Café Ünïcode")).toBe("cafe-unicode");
    for (const bad of [
      "social/a/a-reel-0123456789.mp4",
      "social/a/a-clip-0123456789.exe",
      "social/a/b/a-clip-0123456789.mp4",
      "social/../a-clip-0123456789.mp4",
      "listings/a/a-clip-0123456789.mp4",
      "social/a/a-clip-012345678Z.mp4",
    ]) {
      expect(R2_UPLOAD_KEY.test(bad), bad).toBe(false);
    }
    // Reel uploads never pass as narration / reel keys (registerReel, registerRender).
    expect(R2_SOCIAL_KEY.test(uploadKey("a", "clip", "mov"))).toBe(false);
    expect(R2_KEY.test("social/a/a.mov")).toBe(false);
  });

  it("checks type and size", () => {
    expect(checkUpload("video/quicktime", 10)).toEqual({ kind: "clip", ext: "mov" });
    expect(checkUpload("audio/mpeg; charset=binary", 10)).toEqual({ kind: "music", ext: "mp3" });
    expect(checkUpload("audio/x-m4a", 10)).toEqual({ kind: "music", ext: "m4a" });
    expect(() => checkUpload("image/png", 10)).toThrow(/Upload an MP4, MOV or WebM video, or an MP3 or M4A track/);
    expect(() => checkUpload("video/mp4", 201 * 1024 * 1024)).toThrow(/200 MB/);
    expect(() => checkUpload("audio/mpeg", 21 * 1024 * 1024)).toThrow(/20 MB/);
    expect(() => checkUpload("video/mp4", 0)).toThrow(/200 MB/);
  });
});
