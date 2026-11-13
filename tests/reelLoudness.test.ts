import { describe, expect, it } from "vitest";
import { CEILING_DB, integratedLoudness, limit, normalizeLoudness, peakDb, TARGET_LUFS } from "@/lib/reel/loudness";
import { audioKey } from "@/lib/reel/audio";
import { defaultRecipe, normalizeRecipe } from "@/lib/reel/recipe";

const SR = 48_000;

function sine(freq: number, amp: number, sec: number, sr = SR) {
  const n = Math.round(sec * sr);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return x;
}

describe("integratedLoudness (BS.1770-4)", () => {
  it("matches the EBU reference: a 1 kHz sine at -20 dBFS on both channels reads about -20 LUFS", () => {
    // EBU Tech 3341: 1 kHz, -23 dBFS stereo → -23 LUFS. Same relation at -20 dBFS.
    const amp = Math.pow(10, -20 / 20);
    const l = sine(1000, amp, 5);
    const lufs = integratedLoudness([l, l.slice()], SR);
    expect(lufs).toBeGreaterThan(-20.3);
    expect(lufs).toBeLessThan(-19.7);
  });

  it("is about 3 dB lower for one channel than for two", () => {
    const amp = Math.pow(10, -23 / 20);
    const both = integratedLoudness([sine(1000, amp, 4), sine(1000, amp, 4)], SR);
    const one = integratedLoudness([sine(1000, amp, 4), new Float32Array(4 * SR)], SR);
    expect(both - one).toBeGreaterThan(2.8);
    expect(both - one).toBeLessThan(3.2);
  });

  it("gates out silence: a tone with long silent gaps reads like the tone", () => {
    const amp = Math.pow(10, -20 / 20);
    const tone = sine(1000, amp, 3);
    const gappy = new Float32Array(9 * SR);
    gappy.set(tone, 0);
    gappy.set(tone, 6 * SR);
    const lufs = integratedLoudness([gappy, gappy.slice()], SR);
    expect(lufs).toBeGreaterThan(-20.5);
    expect(lufs).toBeLessThan(-19.5);
  });

  it("is -Infinity for silence and for a mix shorter than one block", () => {
    expect(integratedLoudness([new Float32Array(SR), new Float32Array(SR)], SR)).toBe(-Infinity);
    expect(integratedLoudness([sine(1000, 0.5, 0.2)], SR)).toBe(-Infinity);
  });
});

describe("normalizeLoudness", () => {
  it("brings a quiet mix up to the target and keeps peaks under the ceiling", () => {
    const amp = Math.pow(10, -30 / 20);
    const ch = [sine(440, amp, 6), sine(440, amp, 6)];
    const r = normalizeLoudness(ch, SR);
    expect(r.gainDb).toBeGreaterThan(10);
    expect(r.after).toBeGreaterThan(TARGET_LUFS - 0.6);
    expect(r.after).toBeLessThan(TARGET_LUFS + 0.6);
    expect(peakDb(ch)).toBeLessThanOrEqual(CEILING_DB + 0.01);
  });

  it("turns a too-loud mix down", () => {
    const ch = [sine(440, 0.95, 4), sine(440, 0.95, 4)];
    const r = normalizeLoudness(ch, SR);
    expect(r.gainDb).toBeLessThan(0);
    expect(Math.abs(r.after - TARGET_LUFS)).toBeLessThan(0.6);
  });

  it("limits a voice-like signal with sharp peaks instead of clipping it", () => {
    // Quiet bed with short loud bursts: the gain the bed needs would push the bursts far over 0 dBFS.
    const bed = sine(300, 0.02, 6);
    for (let s = 0; s < 6; s++) bed.set(sine(300, 0.5, 0.02), s * SR + 1000);
    const ch = [bed, bed.slice()];
    normalizeLoudness(ch, SR);
    expect(peakDb(ch)).toBeLessThanOrEqual(CEILING_DB + 0.01);
    expect(ch.every((c) => c.every((v) => Number.isFinite(v)))).toBe(true);
  });

  it("leaves silence alone and never boosts more than 20 dB", () => {
    const silent = [new Float32Array(SR * 2), new Float32Array(SR * 2)];
    expect(normalizeLoudness(silent, SR).gainDb).toBe(0);
    const whisper = [sine(1000, 1e-3, 3), sine(1000, 1e-3, 3)]; // -60 dBFS: over the -70 gate, far under the target
    expect(normalizeLoudness(whisper, SR).gainDb).toBe(20);
  });
});

describe("limit", () => {
  it("does nothing when nothing is over the ceiling", () => {
    const c = sine(440, 0.5, 1);
    const before = c.slice();
    limit([c], SR);
    expect(c).toEqual(before);
  });

  it("starts lowering the gain before the peak (look-ahead)", () => {
    const c = new Float32Array(SR).fill(0.5);
    c[SR / 2] = 2;
    limit([c], SR);
    expect(Math.abs(c[SR / 2])).toBeLessThanOrEqual(Math.pow(10, CEILING_DB / 20) + 1e-6);
    expect(c[SR / 2 - 10]).toBeLessThan(0.5); // already going down
    expect(c[0]).toBeCloseTo(0.5, 5); // far before: untouched
  });
});

describe("evenLoudness in the recipe", () => {
  it("is on by default and survives normalizeRecipe; old recipes without it count as on", () => {
    expect(defaultRecipe().audio.evenLoudness).toBe(true);
    const old = defaultRecipe();
    delete (old.audio as { evenLoudness?: boolean }).evenLoudness;
    expect(normalizeRecipe(old).audio.evenLoudness).toBe(true);
    const off = defaultRecipe();
    off.audio.evenLoudness = false;
    expect(normalizeRecipe(off).audio.evenLoudness).toBe(false);
  });

  it("changes the audio key, so the preview re-mixes when it is switched", () => {
    const on = defaultRecipe();
    const off = { ...on, audio: { ...on.audio, evenLoudness: false } };
    expect(audioKey(on)).not.toBe(audioKey(off));
  });
});

import { reelCaptions } from "@/lib/studio/reelPost";

describe("reelCaptions (new post from a reel)", () => {
  const url = (slug: string) => `https://www.shemoqmedi.space/sites/${slug}`;
  const a = { title: "Paper Weather", creditName: "Studio A", slug: "paper-weather" };
  const b = { title: "Kencho", creditName: "Kencho Group", slug: "kencho" };

  it("one listing: the listing drafts with its page", () => {
    const c = reelCaptions([a], "feed", "Paper Weather reel", url);
    expect(c.instagram).toContain("Paper Weather by Studio A");
    expect(c.facebook).toContain("https://www.shemoqmedi.space/sites/paper-weather");
  });

  it("several listings: one post naming them all, on every network", () => {
    const c = reelCaptions([a, b], "feed", "Two studios", url);
    for (const n of ["instagram", "facebook", "threads", "linkedin"] as const) {
      expect(c[n]).toContain("Paper Weather by Studio A and Kencho by Kencho Group");
    }
  });

  it("no listing: a plain post titled after the reel, never empty", () => {
    expect(reelCaptions([], "feed", "Behind the jury", url).instagram).toContain("Behind the jury");
    expect(reelCaptions([], "feed", "  ", url).instagram?.trim()).toBeTruthy();
  });

  it("story: a short label for Instagram and Facebook only", () => {
    const c = reelCaptions([a, b], "story", "Two studios", url);
    expect(c).toEqual({ instagram: "Two studios", facebook: "Two studios" });
    expect(reelCaptions([a], "story", "x", url).instagram).toBe("Paper Weather");
  });
});
