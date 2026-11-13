// The reel's sound: voice, music and the clips' own sound mixed at 48 kHz
// stereo by the rules of docs/reel-editor.md section 2.
//
//   planAudio (pure)  what plays where: start / stop on the reel, where in its
//                     file, at what speed, looped or not, and its gain over
//                     time (volume × ducking under the voice × the clip
//                     crossfades); plus the master fades.
//   mixPlan (pure)    sums the decoded sources into two channels (linear
//                     resampling for speed), then fades and clamps to [-1, 1].
//   mixAudio          decodes the files (Web Audio, resampled to 48 kHz;
//                     mediabunny when the browser can't decode a video's sound),
//                     cached by URL so the preview re-mixes fast, then mixes.
//
// The same buffer plays in the preview and is encoded to AAC by the render.

import { isVideoKind, type ReelRecipe } from "./recipe";
import { audioFadeAt, buildTimeline, duckAt, speechWindows, type Timeline } from "./timeline";
import { download, ReelAbortError, ReelSourceError } from "./frames";
import { normalizeLoudness } from "./loudness";

export const SAMPLE_RATE = 48_000;

/** Decoded sound: one Float32Array per channel. */
export type Pcm = { channels: Float32Array[]; sampleRate: number; length: number };

export type PlannedTrack = {
  /** "voice", "music" or "clip:<id>". */
  key: string;
  url: string;
  /** Reel seconds where it starts and stops. */
  startSec: number;
  endSec: number;
  /** Seconds into the file at startSec. */
  offsetSec: number;
  /** File seconds per reel second (a clip's speed). */
  rate: number;
  /** Start the file again from 0 when it ends (music). */
  loop: boolean;
  /** Gain at reel time t (volume, ducking, crossfades; not the master fades). */
  gainAt: (t: number) => number;
};

export type AudioPlan = {
  durationSec: number;
  tracks: PlannedTrack[];
  /** The whole mix's gain at t (audio fades). */
  masterAt: (t: number) => number;
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** What plays where (pure). `durationSec`: the reel's length (the timeline's). */
export function planAudio(recipe: ReelRecipe, durationSec?: number, timeline: Timeline = buildTimeline(recipe)): AudioPlan {
  const dur = Math.max(0, durationSec ?? timeline.durationSec);
  const tracks: PlannedTrack[] = [];
  const { voice, music, clipGain } = recipe.audio;

  if (voice?.url && voice.gain > 0 && voice.startSec < dur) {
    const gain = voice.gain;
    tracks.push({
      key: "voice",
      url: voice.url,
      startSec: voice.startSec,
      endSec: voice.durationSec ? Math.min(dur, voice.startSec + voice.durationSec) : dur,
      offsetSec: 0,
      rate: 1,
      loop: false,
      gainAt: () => gain,
    });
  }

  if (music?.url && music.gain > 0) {
    const windows = music.duck.on && voice?.url ? speechWindows(voice) : [];
    const { gain } = music;
    const amount = music.duck.amount;
    tracks.push({
      key: "music",
      url: music.url,
      startSec: 0,
      endSec: dur,
      offsetSec: music.offsetSec,
      rate: 1,
      loop: music.loop,
      gainAt: windows.length ? (t) => gain * duckAt(t, windows, amount) : () => gain,
    });
  }

  if (clipGain > 0) {
    for (const item of timeline.items) {
      const clip = item.clip;
      if (!isVideoKind(clip.source.kind) || !clip.audio.on || !(clip.audio.gain > 0)) continue;
      const g = clip.audio.gain * clipGain;
      const { start, end, transIn, transOut } = item;
      tracks.push({
        key: `clip:${clip.id}`,
        url: clip.source.url,
        startSec: start,
        endSec: Math.min(end, dur),
        offsetSec: clip.inSec,
        rate: clip.speed > 0 ? clip.speed : 1,
        loop: false,
        // Out-going × (1 - p), incoming × p across each transition.
        gainAt: (t) => {
          let k = 1;
          if (transIn > 0 && t < start + transIn) k *= clamp01((t - start) / transIn);
          if (transOut > 0 && t > end - transOut) k *= clamp01((end - t) / transOut);
          return g * k;
        },
      });
    }
  }

  const { audioInSec, audioOutSec } = recipe.fades;
  return { durationSec: dur, tracks, masterAt: (t) => audioFadeAt(t, dur, audioInSec, audioOutSec) };
}

/** Gains are evaluated every BLOCK samples and interpolated in between. */
const BLOCK = 64;

/** Where in a looped file a position falls: the first pass from the offset, then from 0 again. */
export function loopPosition(pos: number, length: number) {
  if (pos < length) return pos;
  return (pos - length) % length;
}

/**
 * Mixes the plan's tracks into [left, right] at `sampleRate` (pure): sources
 * missing from `sources` (or null: no sound) are silent; mono plays on both
 * sides; the master fades apply last and samples are clamped to [-1, 1].
 */
export function mixPlan(plan: AudioPlan, sources: Map<string, Pcm | null>, sampleRate = SAMPLE_RATE): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const n = Math.max(1, Math.ceil(plan.durationSec * sampleRate));
  const L = new Float32Array(n);
  const R = new Float32Array(n);

  for (const track of plan.tracks) {
    const src = sources.get(track.url);
    if (!src || !src.length || !src.channels.length) continue;
    const cl = src.channels[0];
    const cr = src.channels[1] ?? cl;
    const len = src.length;
    const step = (track.rate * src.sampleRate) / sampleRate; // file samples per output sample
    const startExact = track.startSec * sampleRate;
    const offset = track.offsetSec * src.sampleRate;
    if (!track.loop && offset >= len) continue;
    const s0 = Math.max(0, Math.ceil(startExact - 1e-9));
    const s1 = Math.min(n, Math.ceil(track.endSec * sampleRate));
    let ended = false;
    for (let b = s0; b < s1 && !ended; b += BLOCK) {
      const e = Math.min(b + BLOCK, s1);
      const g0 = track.gainAt(b / sampleRate);
      const g1 = track.gainAt(e / sampleRate);
      if (g0 === 0 && g1 === 0) continue;
      const dg = (g1 - g0) / (e - b);
      for (let j = b; j < e; j++) {
        let pos = offset + (j - startExact) * step;
        if (pos < 0) continue;
        if (track.loop) pos = loopPosition(pos, len);
        else if (pos > len - 1) {
          ended = true;
          break;
        }
        const k = Math.floor(pos);
        const f = pos - k;
        const k1 = k + 1 < len ? k + 1 : track.loop ? 0 : k;
        const g = g0 + dg * (j - b);
        L[j] += (cl[k] + (cl[k1] - cl[k]) * f) * g;
        R[j] += (cr[k] + (cr[k1] - cr[k]) * f) * g;
      }
    }
  }

  for (let b = 0; b < n; b += BLOCK) {
    const e = Math.min(b + BLOCK, n);
    const g0 = plan.masterAt(b / sampleRate);
    const g1 = plan.masterAt(e / sampleRate);
    const dg = (g1 - g0) / (e - b);
    for (let j = b; j < e; j++) {
      const g = g0 + dg * (j - b);
      const l = L[j] * g;
      const r = R[j] * g;
      L[j] = l > 1 ? 1 : l < -1 ? -1 : l;
      R[j] = r > 1 ? 1 : r < -1 ? -1 : r;
    }
  }
  return [L, R];
}

/**
 * Everything the mix depends on, as a string: the preview re-mixes only when
 * it changes (text, fits, motion and so on don't touch the sound).
 */
export function audioKey(recipe: ReelRecipe): string {
  const v = recipe.audio.voice;
  const m = recipe.audio.music;
  return JSON.stringify([
    v && [v.url, v.startSec, v.gain, v.durationSec, v.captions.lines.map((l) => [l.startSec, l.endSec, l.words?.map((w) => [w.startSec, w.endSec])])],
    m && [m.url, m.offsetSec, m.gain, m.loop, m.duck.on, m.duck.amount],
    recipe.audio.clipGain,
    recipe.audio.evenLoudness !== false,
    recipe.fades.audioInSec,
    recipe.fades.audioOutSec,
    recipe.clips.map((c) => [c.source.kind, c.source.url, c.inSec, c.outSec, c.durationSec, c.speed, c.transitionIn.type, c.transitionIn.durationSec, c.audio.on, c.audio.gain]),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Decoding (cached by URL)
// ─────────────────────────────────────────────────────────────────────────────

const MAX_CACHED = 12;
const decoded = new Map<string, Promise<Pcm | null>>();

function remember(url: string, p: Promise<Pcm | null>) {
  decoded.set(url, p);
  p.catch(() => decoded.delete(url));
  while (decoded.size > MAX_CACHED) decoded.delete(decoded.keys().next().value as string);
}

/** Decodes a video's sound with mediabunny (formats Web Audio can't open). Null when it has none. */
async function decodeWithMediabunny(blob: Blob): Promise<Pcm | null> {
  const { ALL_FORMATS, AudioBufferSink, BlobSource, Input } = await import("mediabunny");
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return null;
    const sink = new AudioBufferSink(track);
    const parts: AudioBuffer[] = [];
    let rate = 0;
    let first: number | null = null;
    let total = 0;
    for await (const { buffer, timestamp } of sink.buffers()) {
      first ??= timestamp;
      rate ||= buffer.sampleRate;
      parts.push(buffer);
      total = Math.max(total, Math.round((timestamp - first) * rate) + buffer.length);
    }
    if (!parts.length || !rate) return null;
    const left = new Float32Array(total);
    const right = new Float32Array(total);
    let at = 0;
    for (const b of parts) {
      left.set(b.getChannelData(0).subarray(0, Math.max(0, Math.min(b.length, total - at))), at);
      right.set(b.getChannelData(b.numberOfChannels > 1 ? 1 : 0).subarray(0, Math.max(0, Math.min(b.length, total - at))), at);
      at += b.length;
    }
    return { channels: [left, right], sampleRate: rate, length: total };
  } finally {
    input.dispose();
  }
}

/**
 * The file at `url` decoded at 48 kHz (cached). `what` names it in errors.
 * Videos without sound give null; a narration or a track that can't be
 * decoded throws a ReelSourceError.
 */
export function decodeSound(url: string, what: "voice" | "music" | "clip", signal?: AbortSignal): Promise<Pcm | null> {
  const cached = decoded.get(url);
  if (cached) return cached;
  const p = (async () => {
    const label = what === "voice" ? "narration" : what === "music" ? "music track" : "clip's video";
    const blob = await download(url, label, signal);
    const data = await blob.arrayBuffer();
    try {
      const ctx = new OfflineAudioContext(2, 1, SAMPLE_RATE);
      const buffer = await ctx.decodeAudioData(data);
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
      return { channels, sampleRate: buffer.sampleRate, length: buffer.length };
    } catch {
      if (what !== "clip") {
        throw new ReelSourceError(what === "voice" ? "The narration could not be decoded. Generate the voice again." : "The music track could not be decoded. Use an MP3 or M4A file.");
      }
      try {
        return await decodeWithMediabunny(blob);
      } catch {
        return null;
      }
    }
  })();
  remember(url, p);
  return p;
}

/**
 * The reel's mix as an AudioBuffer (48 kHz stereo, `durationSec` long).
 * Throws ReelSourceError (a file can't be read) or ReelAbortError (signal).
 */
export async function mixAudio(recipe: ReelRecipe, durationSec: number, signal?: AbortSignal): Promise<AudioBuffer> {
  const plan = planAudio(recipe, durationSec);
  const urls = new Map<string, "voice" | "music" | "clip">();
  for (const t of plan.tracks) urls.set(t.url, t.key === "voice" ? "voice" : t.key === "music" ? "music" : (urls.get(t.url) ?? "clip"));
  const sources = new Map<string, Pcm | null>();
  await Promise.all(
    [...urls].map(async ([url, what]) => {
      sources.set(url, await decodeSound(url, what, signal));
    }),
  );
  if (signal?.aborted) throw new ReelAbortError();
  const [L, R] = mixPlan(plan, sources, SAMPLE_RATE);
  // The preview plays this same buffer, so it sounds as loud as the render.
  if (recipe.audio.evenLoudness !== false) normalizeLoudness([L, R], SAMPLE_RATE);
  const buffer = new AudioBuffer({ length: L.length, numberOfChannels: 2, sampleRate: SAMPLE_RATE });
  buffer.copyToChannel(L, 0);
  buffer.copyToChannel(R, 1);
  return buffer;
}
