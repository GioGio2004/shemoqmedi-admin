// The reel engine's pure parts (lib/reel/compositor.ts layout, lib/reel/audio.ts
// plan and mix, lib/reel/frames.ts sizing, lib/reel/render.ts budget): what the
// preview and the render share, checked without a browser.

import { describe, expect, it } from "vitest";
import { defaultClip, defaultMusic, defaultRecipe, defaultVoice, type ClipSource, type ReelRecipe } from "../lib/reel/recipe";
import { buildTimeline, frameAt, transitionLook } from "../lib/reel/timeline";
import {
  BLOCK_GAP,
  TEXT_WIDTH,
  blockTop,
  boxRadius,
  captionReserve,
  captionSpec,
  layoutBlock,
  lookMatrix,
  safeInsets,
  textSpec,
  unitFor,
  wrapWords,
  type Measure,
} from "../lib/reel/compositor";
import { audioKey, loopPosition, mixPlan, planAudio, type Pcm } from "../lib/reel/audio";
import { neededWidth, renderSourceTimes, sizedImageUrl } from "../lib/reel/frames";
import { MAX_RENDER_BYTES, AUDIO_BITRATE, overallProgress, RenderError, videoBitrate } from "../lib/reel/render";
import { looksLikeImage } from "../lib/reel/probe";

// A monospace stand-in for measureText: every character is half the font size wide.
const mono: Measure = (text, size) => text.length * size * 0.5;

const video = (url = "https://cdn.example.com/a.mp4", durationSec = 8): ClipSource => ({ kind: "listingVideo", url, width: 1080, height: 1920, durationSec });
const shot = (url = "https://ik.imagekit.io/x/shot.webp"): ClipSource => ({ kind: "screenshot", url, width: 1440, height: 900 });

function recipeWith(clips: ReelRecipe["clips"], patch: Partial<ReelRecipe> = {}): ReelRecipe {
  return { ...defaultRecipe(), clips, ...patch };
}

describe("layout: safe zones and placement", () => {
  it("keeps 9:16 texts clear of Instagram's top 12% and bottom 22%, others 6%", () => {
    expect(safeInsets("9:16")).toEqual({ top: 0.12, bottom: 0.22 });
    for (const a of ["4:5", "1:1", "16:9"] as const) expect(safeInsets(a)).toEqual({ top: 0.06, bottom: 0.06 });
  });

  it("places blocks at top / center / bottom inside the safe zone", () => {
    const H = 1920;
    const ins = safeInsets("9:16");
    expect(blockTop("top", 100, H, ins)).toBeCloseTo(0.12 * H);
    expect(blockTop("bottom", 100, H, ins)).toBeCloseTo(H - 0.22 * H - 100);
    expect(blockTop("center", 100, H, ins)).toBeCloseTo((H - 100) / 2);
  });

  it("moves a clip text clear of the captions when they share a position", () => {
    const H = 1920;
    const ins = safeInsets("9:16");
    const avoid = { position: "bottom" as const, height: 200 };
    const gap = BLOCK_GAP * H;
    expect(blockTop("bottom", 100, H, ins, avoid)).toBeCloseTo(H - 0.22 * H - 100 - 200 - gap);
    expect(blockTop("top", 100, H, ins, { position: "top", height: 200 })).toBeCloseTo(0.12 * H + 200 + gap);
    // Center: the text sits just above the centred captions.
    expect(blockTop("center", 100, H, ins, { position: "center", height: 200 })).toBeCloseTo(H / 2 - 100 - gap - 100);
    // A different position is left alone.
    expect(blockTop("top", 100, H, ins, avoid)).toBeCloseTo(0.12 * H);
  });

  it("never places a block outside the frame", () => {
    expect(blockTop("bottom", 5000, 1920, safeInsets("9:16"))).toBe(0);
    expect(blockTop("top", 100, 1080, { top: 0.06, bottom: 0.06 }, { position: "top", height: 2000 })).toBe(980);
  });

  it("reserves two caption lines for the captions' style", () => {
    const s = captionSpec("glass");
    expect(captionReserve("glass")).toBeCloseTo(s.lineHeight * 2 + s.padY * 2);
    expect(captionReserve("bold")).toBeCloseTo(captionSpec("bold").lineHeight * 2);
  });

  it("uses one size unit for every aspect (their short side is 1080)", () => {
    expect(unitFor(1080, 1920)).toBe(1);
    expect(unitFor(1920, 1080)).toBe(1);
    expect(unitFor(540, 960)).toBe(0.5);
  });
});

describe("layout: text styles", () => {
  it("sizes s < m < l and headlines bigger than plain text", () => {
    for (const style of ["glass", "solid", "light", "shadow", "headline"] as const) {
      expect(textSpec(style, "s").size).toBeLessThan(textSpec(style, "m").size);
      expect(textSpec(style, "m").size).toBeLessThan(textSpec(style, "l").size);
    }
    expect(textSpec("headline", "m").size).toBeGreaterThan(textSpec("glass", "l").size);
  });

  it("boxes glass / solid / light and shadows the rest; never blue", () => {
    expect(textSpec("glass", "m").box).toBe("glass");
    expect(textSpec("solid", "m").box).toBe("dark");
    expect(textSpec("light", "m").box).toBe("light");
    expect(textSpec("shadow", "m")).toMatchObject({ box: null, shadow: true });
    expect(textSpec("headline", "m")).toMatchObject({ box: null, shadow: true, maxLines: 3 });
    const all = [
      ...(["glass", "solid", "light", "shadow", "headline"] as const).map((s) => textSpec(s, "m")),
      ...(["glass", "bold", "highlight", "box", "light"] as const).map((s) => captionSpec(s)),
    ];
    for (const s of all) expect(`${s.ink} ${s.dim ?? ""}`).not.toMatch(/blue|#00f|#0000ff|rgb\(0,\s*0,\s*255/i);
  });

  it("captions take at most two lines, texts three; highlight dims the other words", () => {
    for (const s of ["glass", "bold", "highlight", "box", "light"] as const) expect(captionSpec(s).maxLines).toBe(2);
    expect(captionSpec("highlight").dim).toBeTruthy();
    expect(captionSpec("bold").dim).toBeNull();
    expect(textSpec("glass", "m").maxLines).toBe(3);
  });

  it("rounds one line as a pill and several as a card", () => {
    expect(boxRadius({ height: 80, size: 50, lines: [{ pieces: [], width: 0 }] })).toBe(40);
    expect(boxRadius({ height: 200, size: 50, lines: [{ pieces: [], width: 0 }, { pieces: [], width: 0 }] })).toBe(31);
  });
});

describe("layout: wrapping", () => {
  const at = (size: number) => (s: string) => mono(s, size);

  it("wraps greedily at word boundaries", () => {
    // size 10: 5 px per char; max 60 px = 12 chars.
    const lines = wrapWords("make every reel your own".split(" "), at(10), 60);
    expect(lines.map((l) => l.pieces.map((p) => p.text).join(" "))).toEqual(["make every", "reel your", "own"]);
    expect(lines[0].width).toBe(50);
  });

  it("keeps each piece's word index (for the said-word highlight)", () => {
    const lines = wrapWords(["a", "bb", "ccc", "dddd"], at(10), 30);
    expect(lines.flatMap((l) => l.pieces.map((p) => p.index))).toEqual([0, 1, 2, 3]);
  });

  it("breaks a word longer than the line into pieces that fit", () => {
    const lines = wrapWords(["supercalifragilistic"], at(10), 40);
    expect(lines.length).toBe(3);
    for (const l of lines) expect(l.width).toBeLessThanOrEqual(40);
    expect(lines.map((l) => l.pieces[0].text).join("")).toBe("supercalifragilistic");
    expect(new Set(lines.flatMap((l) => l.pieces.map((p) => p.index)))).toEqual(new Set([0]));
  });

  it("sets text at its size when it fits", () => {
    const spec = textSpec("glass", "m");
    const layout = layoutBlock("Hello there", spec, 1080 * TEXT_WIDTH - spec.padX * 2, mono);
    expect(layout.size).toBe(spec.size);
    expect(layout.lines.length).toBe(1);
    expect(layout.width).toBeCloseTo(layout.lines[0].width + spec.padX * 2);
    expect(layout.height).toBeCloseTo(spec.lineHeight + spec.padY * 2);
    expect(layout.truncated).toBe(false);
  });

  it("shrinks a long text to fit its lines before cutting it", () => {
    const spec = captionSpec("bold");
    const text = "one two three four five six seven eight nine ten eleven twelve thirteen";
    const max = 1080 * TEXT_WIDTH;
    const layout = layoutBlock(text, spec, max, mono);
    expect(layout.lines.length).toBeLessThanOrEqual(2);
    expect(layout.size).toBeLessThan(spec.size);
    expect(layout.size).toBeGreaterThanOrEqual(spec.size * 0.6 - 1e-9);
    expect(layout.truncated).toBe(false);
    for (const l of layout.lines) expect(l.width).toBeLessThanOrEqual(max + 1e-6);
  });

  it("cuts what still doesn't fit with an ellipsis", () => {
    const spec = captionSpec("bold");
    const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const max = 1080 * TEXT_WIDTH;
    const layout = layoutBlock(text, spec, max, mono);
    expect(layout.truncated).toBe(true);
    expect(layout.lines.length).toBe(2);
    expect(layout.size).toBeCloseTo(spec.size * 0.6);
    const last = layout.lines[1].pieces;
    expect(last[last.length - 1].text.endsWith("…")).toBe(true);
    expect(layout.lines[1].width).toBeLessThanOrEqual(max + 1e-6);
  });

  it("lays out an empty text as no lines", () => {
    expect(layoutBlock("   ", textSpec("glass", "m"), 900, mono).lines).toEqual([]);
  });
});

describe("transition drawing", () => {
  it("maps a look to translate + scale around the centre", () => {
    expect(lookMatrix({ dx: 0, dy: 0, scale: 1 }, 1080, 1920)).toEqual({ a: 1, d: 1, e: 0, f: 0 });
    const m = lookMatrix({ dx: 0.5, dy: 0, scale: 1 }, 1080, 1920);
    expect(m.e).toBe(540);
    const z = lookMatrix({ dx: 0, dy: 0, scale: 1.25 }, 1080, 1920);
    // The centre stays put: 540·1.25 + e = 540.
    expect(540 * z.a + z.e).toBeCloseTo(540);
    expect(960 * z.d + z.f).toBeCloseTo(960);
  });

  it("slides and pushes start off-frame and end in place", () => {
    for (const type of ["slideLeft", "slideRight", "slideUp", "pushLeft", "pushRight", "pushUp"] as const) {
      const start = transitionLook(type, 0).b;
      const end = transitionLook(type, 1).b;
      expect(Math.abs(start.dx) + Math.abs(start.dy)).toBeCloseTo(1);
      expect(end.dx).toBeCloseTo(0);
      expect(end.dy).toBeCloseTo(0);
    }
  });

  it("the morph blurs both clips mid-way with a real radius", () => {
    const mid = transitionLook("morph", 0.5);
    expect(mid.a.blur).toBeGreaterThan(0);
    expect(mid.b.blur).toBeGreaterThan(0);
    expect(mid.a.blur * 1080).toBeGreaterThan(10);
  });
});

describe("pictures: sizes", () => {
  it("decodes a picture as sharp as its biggest use on the reel, never wider than it is", () => {
    // 1440×900 into 1080×1920 cover: scale 1920/900 → 3072 px wide; capped by the file (1440).
    expect(neededWidth({ width: 1440, height: 900 }, 1080, 1920)).toBe(1440);
    // A portrait phone video at 2160×3840: needs ~1080·1.12·1.05.
    expect(neededWidth({ width: 2160, height: 3840 }, 1080, 1920)).toBe(Math.ceil(1080 * 1.12 * 1.05));
    // The half-size preview needs half.
    expect(neededWidth({ width: 2160, height: 3840 }, 1080, 1920, 0.5)).toBe(Math.ceil(540 * 1.12 * 1.05));
    // Unknown size: twice the frame, capped.
    expect(neededWidth({}, 1080, 1920)).toBe(2160);
  });

  it("asks ImageKit for a sized copy, leaves other URLs and existing transforms alone", () => {
    expect(sizedImageUrl("https://ik.imagekit.io/x/a.webp", 1200)).toBe("https://ik.imagekit.io/x/a.webp?tr=w-1200");
    expect(sizedImageUrl("https://ik.imagekit.io/x/a.webp?v=2", 1200)).toBe("https://ik.imagekit.io/x/a.webp?v=2&tr=w-1200");
    expect(sizedImageUrl("https://ik.imagekit.io/x/a.webp?tr=w-300", 1200)).toBe("https://ik.imagekit.io/x/a.webp?tr=w-300");
    expect(sizedImageUrl("https://r2.example.com/a.png", 1200)).toBe("https://r2.example.com/a.png");
  });

  it("the render decodes the same source time the preview seeks to and the clip's sound starts from", () => {
    const a = { ...defaultClip({ ...video("https://r2.example.com/a.mp4"), kind: "upload-video" }, "9:16", "a"), inSec: 2, outSec: 6 };
    const b = { ...defaultClip({ ...video("https://r2.example.com/b.mp4"), kind: "upload-video" }, "9:16", "b"), inSec: 0.4, speed: 2 };
    const r = recipeWith([a, b], { audio: { voice: null, music: null, clipGain: 1 } });
    const tl = buildTimeline(r);
    const times = renderSourceTimes(r, tl);
    const plan = planAudio(r, tl.durationSec, tl);
    for (const item of tl.items) {
      const first = times.get(item.id)![0];
      // Presentation time, no shift by the file's first timestamp: what <video>.currentTime and decodeAudioData use.
      expect(first).toBeCloseTo(item.clip.inSec, 6);
      expect(plan.tracks.find((t) => t.key === `clip:${item.id}`)!.offsetSec).toBe(first);
      // The preview's layer at the clip's first frame (it sets <video>.currentTime to this) asks for the same time.
      const f = frameAt(tl, item.start);
      const layer = [f.a, f.b].find((l) => l?.item.id === item.id)!;
      expect(layer.sourceSec).toBeCloseTo(first, 6);
    }
  });

  it("tells pictures from videos by extension", () => {
    expect(looksLikeImage("https://ik.imagekit.io/x/a.webp")).toBe(true);
    expect(looksLikeImage("https://r2.example.com/a.mp4")).toBe(false);
    expect(looksLikeImage("https://r2.example.com/a")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sound
// ─────────────────────────────────────────────────────────────────────────────

const SR = 1000; // a small sample rate keeps the fake buffers tiny

function constant(value: number, seconds: number, rate = SR, channels = 1): Pcm {
  const length = Math.round(seconds * rate);
  return { channels: Array.from({ length: channels }, (_, c) => new Float32Array(length).fill(c === 0 ? value : value / 2)), sampleRate: rate, length };
}

function ramp(seconds: number, rate = SR): Pcm {
  const length = Math.round(seconds * rate);
  const ch = new Float32Array(length);
  for (let i = 0; i < length; i++) ch[i] = i / length;
  return { channels: [ch], sampleRate: rate, length };
}

const at = (buf: Float32Array, sec: number) => buf[Math.round(sec * SR)];

function silentFades(r: ReelRecipe): ReelRecipe {
  return { ...r, fades: { videoInSec: 0, videoOutSec: 0, audioInSec: 0, audioOutSec: 0 } };
}

describe("sound: the plan", () => {
  it("places the voice at its start, cut at the reel's end", () => {
    const r = recipeWith([defaultClip(video(), "9:16", "c1")], {
      audio: { voice: defaultVoice({ url: "https://r2.example.com/v.mp3", startSec: 1, durationSec: 20, gain: 0.8 }), music: null, clipGain: 1 },
    });
    const plan = planAudio(r);
    const v = plan.tracks.find((t) => t.key === "voice")!;
    expect(v).toMatchObject({ startSec: 1, endSec: 8, offsetSec: 0, rate: 1, loop: false });
    expect(v.gainAt(3)).toBe(0.8);
  });

  it("leaves out a voice that isn't voiced, and muted tracks", () => {
    const r = recipeWith([defaultClip(video(), "9:16", "c1")], {
      audio: { voice: defaultVoice({ script: "Hello" }), music: { ...defaultMusic("https://r2.example.com/m.mp3"), gain: 0 }, clipGain: 1 },
    });
    expect(planAudio(r).tracks).toEqual([]);
  });

  it("ducks the music under the spoken words and lets it up in long pauses", () => {
    const voice = defaultVoice({
      url: "https://r2.example.com/v.mp3",
      durationSec: 6,
      captions: {
        on: true,
        style: "bold",
        position: "bottom",
        lines: [
          { text: "one two", startSec: 0, endSec: 1, words: [{ text: "one", startSec: 0, endSec: 0.5 }, { text: "two", startSec: 0.5, endSec: 1 }] },
          { text: "three", startSec: 4, endSec: 5 },
        ],
      },
    });
    const r = recipeWith([defaultClip(video(), "9:16", "c1")], {
      audio: { voice, music: defaultMusic("https://r2.example.com/m.mp3", { gain: 0.5, duck: { on: true, amount: 0.6 } }), clipGain: 1 },
    });
    const music = planAudio(r).tracks.find((t) => t.key === "music")!;
    expect(music.gainAt(0.5)).toBeCloseTo(0.5 * 0.4); // under the voice
    expect(music.gainAt(2.5)).toBeCloseTo(0.5); // the pause between 1 s and 4 s is longer than 0.8 s
    expect(music.gainAt(1.125)).toBeCloseTo(0.5 * (1 - 0.6 * 0.5)); // half-way up the 0.25 s ramp
    expect(music.loop).toBe(true);

    const off = recipeWith(r.clips, { audio: { ...r.audio, music: { ...r.audio.music!, duck: { on: false, amount: 0.6 } } } });
    expect(planAudio(off).tracks.find((t) => t.key === "music")!.gainAt(0.5)).toBe(0.5);
  });

  it("plays a clip's own sound from its trim at its speed, crossfading with the transition", () => {
    const a = { ...defaultClip({ ...video("https://r2.example.com/a.mp4"), kind: "upload-video" }, "9:16", "a"), inSec: 2, outSec: 6 };
    const b = { ...defaultClip({ ...video("https://r2.example.com/b.mp4"), kind: "upload-video" }, "9:16", "b"), speed: 2, transitionIn: { type: "crossfade" as const, durationSec: 1 } };
    const r = recipeWith([a, b], { audio: { voice: null, music: null, clipGain: 0.5 } });
    const tl = buildTimeline(r);
    const plan = planAudio(r, tl.durationSec, tl);
    const ta = plan.tracks.find((t) => t.key === "clip:a")!;
    const tb = plan.tracks.find((t) => t.key === "clip:b")!;
    expect(ta).toMatchObject({ startSec: 0, endSec: 4, offsetSec: 2, rate: 1 });
    expect(tb).toMatchObject({ startSec: 3, offsetSec: 0, rate: 2 });
    // Middle of the 1 s transition (3..4): out-going × (1-p), incoming × p.
    expect(ta.gainAt(3.5)).toBeCloseTo(0.5 * 0.5);
    expect(tb.gainAt(3.5)).toBeCloseTo(0.5 * 0.5);
    expect(ta.gainAt(1)).toBeCloseTo(0.5);
    expect(tb.gainAt(5)).toBeCloseTo(0.5);
  });

  it("skips the clips' sound when it is off (listing previews by default)", () => {
    const r = recipeWith([defaultClip(video(), "9:16", "c1")]);
    expect(planAudio(r).tracks).toEqual([]);
    const muted = recipeWith([defaultClip({ ...video(), kind: "upload-video" }, "9:16", "c1")], { audio: { voice: null, music: null, clipGain: 0 } });
    expect(planAudio(muted).tracks).toEqual([]);
  });

  it("fades the whole mix", () => {
    const r = recipeWith([defaultClip(video(), "9:16", "c1")], { fades: { videoInSec: 0, videoOutSec: 0, audioInSec: 1, audioOutSec: 2 } });
    const plan = planAudio(r);
    expect(plan.masterAt(0)).toBe(0);
    expect(plan.masterAt(0.5)).toBeCloseTo(0.5);
    expect(plan.masterAt(4)).toBe(1);
    expect(plan.masterAt(7)).toBeCloseTo(0.5);
  });
});

describe("sound: the mix", () => {
  it("puts the voice where it starts and nowhere before", () => {
    const r = silentFades(
      recipeWith([defaultClip(video(), "9:16", "c1")], { audio: { voice: defaultVoice({ url: "v", startSec: 2, gain: 0.5 }), music: null, clipGain: 1 } }),
    );
    const [L, R] = mixPlan(planAudio(r), new Map([["v", constant(0.8, 3)]]), SR);
    expect(L.length).toBe(8 * SR);
    expect(at(L, 1)).toBe(0);
    expect(at(L, 3)).toBeCloseTo(0.4);
    expect(at(R, 3)).toBeCloseTo(0.4); // mono plays on both sides
    expect(at(L, 6)).toBe(0); // the narration ended at 5 s
  });

  it("keeps stereo sides apart", () => {
    const r = silentFades(recipeWith([defaultClip(video(), "9:16", "c1")], { audio: { voice: defaultVoice({ url: "v" }), music: null, clipGain: 1 } }));
    const [L, R] = mixPlan(planAudio(r), new Map([["v", constant(0.8, 3, SR, 2)]]), SR);
    expect(at(L, 1)).toBeCloseTo(0.8);
    expect(at(R, 1)).toBeCloseTo(0.4);
  });

  it("reads a sped-up clip twice as fast through its file", () => {
    const clip = { ...defaultClip({ ...video("f", 10), url: "https://r2.example.com/f.mp4", kind: "upload-video" }, "9:16", "c"), inSec: 0, outSec: 4, speed: 2 };
    const r = silentFades(recipeWith([clip], { audio: { voice: null, music: null, clipGain: 1 } }));
    const [L] = mixPlan(planAudio(r), new Map([["https://r2.example.com/f.mp4", ramp(10)]]), SR);
    expect(L.length).toBe(2 * SR);
    // At reel 1 s the file is at 2 s (ramp value 0.2).
    expect(at(L, 1)).toBeCloseTo(0.2, 2);
  });

  it("loops music from the start of the file after its first pass from the offset", () => {
    const r = silentFades(
      recipeWith([{ ...defaultClip(video(), "9:16", "c1"), outSec: 6 }], {
        audio: { voice: null, music: defaultMusic("m", { gain: 1, offsetSec: 1, loop: true, duck: { on: false, amount: 0 } }), clipGain: 1 },
      }),
    );
    const [L] = mixPlan(planAudio(r), new Map([["m", ramp(2)]]), SR);
    expect(at(L, 0)).toBeCloseTo(0.5, 2); // file 1 s of 2 s
    expect(at(L, 1.5)).toBeCloseTo(0.25, 2); // wrapped: file 0.5 s
    expect(loopPosition(2500, 2000)).toBe(500);
    expect(loopPosition(1500, 2000)).toBe(1500);

    const once = { ...r, audio: { ...r.audio, music: { ...r.audio.music!, loop: false } } };
    const [L2] = mixPlan(planAudio(once), new Map([["m", ramp(2)]]), SR);
    expect(at(L2, 1.5)).toBe(0); // ended at 1 s
  });

  it("is silent for missing or soundless sources", () => {
    const r = silentFades(recipeWith([defaultClip(video(), "9:16", "c1")], { audio: { voice: defaultVoice({ url: "v" }), music: null, clipGain: 1 } }));
    const [L] = mixPlan(planAudio(r), new Map([["v", null]]), SR);
    expect(L.every((x) => x === 0)).toBe(true);
    const [L2] = mixPlan(planAudio(r), new Map(), SR);
    expect(L2.every((x) => x === 0)).toBe(true);
  });

  it("fades the whole mix, then clamps it to [-1, 1]", () => {
    const r = recipeWith([defaultClip(video(), "9:16", "c1")], {
      audio: { voice: defaultVoice({ url: "v", gain: 2 }), music: defaultMusic("m", { gain: 2, duck: { on: false, amount: 0 } }), clipGain: 1 },
      fades: { videoInSec: 0, videoOutSec: 0, audioInSec: 0, audioOutSec: 2 },
    });
    const [L] = mixPlan(planAudio(r), new Map([["v", constant(0.3, 8)], ["m", constant(0.3, 8)]]), SR);
    expect(at(L, 1)).toBe(1); // 0.6 + 0.6, clamped
    expect(Math.max(...L)).toBeLessThanOrEqual(1);
    expect(at(L, 7)).toBeCloseTo(0.6, 2); // 1.2 faded half-way
  });

  it("re-mixes only when something the sound depends on changes", () => {
    const base = recipeWith([defaultClip(video(), "9:16", "c1")], { audio: { voice: defaultVoice({ url: "v" }), music: null, clipGain: 1 } });
    const key = audioKey(base);
    const texted = { ...base, clips: base.clips.map((c) => ({ ...c, text: { ...c.text, on: true, text: "Hi" }, motion: "zoomIn" as const, fit: "letterbox" as const })) };
    expect(audioKey(texted)).toBe(key);
    expect(audioKey({ ...base, reel: { ...base.reel, aspect: "1:1" } })).toBe(key);
    const trimmed = { ...base, clips: base.clips.map((c) => ({ ...c, outSec: 5 })) };
    expect(audioKey(trimmed)).not.toBe(key);
    expect(audioKey({ ...base, audio: { ...base.audio, clipGain: 0.5 } })).not.toBe(key);
  });

  it("handles stills-only reels and an empty mix", () => {
    const r = silentFades(recipeWith([defaultClip(shot(), "9:16", "s1")]));
    const plan = planAudio(r);
    expect(plan.durationSec).toBe(3);
    const [L] = mixPlan(plan, new Map(), SR);
    expect(L.length).toBe(3 * SR);
  });
});

describe("render: budget and progress", () => {
  it("aims at ~8 Mb/s for a full reel and stays under 100 MB for the longest", () => {
    expect(videoBitrate(1080, 1920, 30)).toBe(8_000_000);
    expect(videoBitrate(1080, 1080, 30)).toBeLessThan(8_000_000);
    for (const sec of [30, 90, 180]) {
      const bits = (videoBitrate(1080, 1920, sec) + AUDIO_BITRATE) * sec;
      expect(bits / 8).toBeLessThan(MAX_RENDER_BYTES);
    }
  });

  it("reports progress in stage order, 0 to 1", () => {
    const seq = [
      overallProgress("Preparing", 0),
      overallProgress("Preparing", 1),
      overallProgress("Mixing sound", 1),
      overallProgress("Rendering", 0.5),
      overallProgress("Rendering", 1),
      overallProgress("Finishing", 1),
    ];
    expect(seq[0]).toBe(0);
    expect(seq[seq.length - 1]).toBe(1);
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1]);
  });

  it("carries a code with each render error", () => {
    const e = new RenderError("too-big", "The reel came out over 100 MB.");
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("too-big");
    expect(e.message).toMatch(/100 MB/);
  });
});
