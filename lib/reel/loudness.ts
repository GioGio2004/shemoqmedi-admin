// Loudness for the reel's mix (pure, no Web Audio): measure it the way
// Instagram, YouTube and TikTok do (ITU-R BS.1770-4 integrated loudness,
// K-weighted, gated) and bring it to a target with a look-ahead peak
// limiter, so a quiet ElevenLabs narration doesn't play 12 dB under every
// other reel and a loud one never clips.
//
//   [L, R] ─▶ K-weighting (shelf + high-pass) ─▶ 400 ms blocks, 75% overlap
//          ─▶ absolute gate −70 LUFS ─▶ relative gate −10 LU ─▶ LUFS
//   gain = target − measured (capped) ─▶ limiter (ceiling, 5 ms look-ahead)

/** Instagram / Facebook Reels play back at about −14 LUFS. */
export const TARGET_LUFS = -14;
/** Sample peaks stay under this (dBFS): AAC and inter-sample peaks add about 0.5 dB, so true peaks land under -1. */
export const CEILING_DB = -1.5;
/** Never turn a near-silent mix up by more than this. */
export const MAX_BOOST_DB = 20;

const dbToGain = (db: number) => Math.pow(10, db / 20);

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

/** The two BS.1770 K-weighting stages for any sample rate (bilinear transform of the analogue prototypes). */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  // Stage 1: high shelf, +4 dB above ~1.5 kHz (head effects).
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  // Stage 2: high-pass at ~38 Hz (RLB).
  const f1 = 38.13547087602444;
  const Q1 = 0.5003270373238773;
  const K1 = Math.tan((Math.PI * f1) / sampleRate);
  const a01 = 1 + K1 / Q1 + K1 * K1;
  const hp: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K1 * K1 - 1)) / a01, a2: (1 - K1 / Q1 + K1 * K1) / a01 };
  return [shelf, hp];
}

function filter(x: Float32Array, [f1, f2]: [Biquad, Biquad]) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0; // stage 1 state
  let u1 = 0, u2 = 0, z1 = 0, z2 = 0; // stage 2 state
  for (let i = 0; i < x.length; i++) {
    const s = x[i];
    const a = f1.b0 * s + f1.b1 * x1 + f1.b2 * x2 - f1.a1 * y1 - f1.a2 * y2;
    x2 = x1; x1 = s; y2 = y1; y1 = a;
    const b = f2.b0 * a + f2.b1 * u1 + f2.b2 * u2 - f2.a1 * z1 - f2.a2 * z2;
    u2 = u1; u1 = a; z2 = z1; z1 = b;
    y[i] = b;
  }
  return y;
}

/**
 * Integrated loudness in LUFS (BS.1770-4 / EBU R128), or -Infinity for
 * silence or a mix shorter than one 400 ms block.
 */
export function integratedLoudness(channels: readonly Float32Array[], sampleRate: number): number {
  if (!channels.length) return -Infinity;
  const weights = kWeighting(sampleRate);
  const k = channels.map((c) => filter(c, weights));
  const block = Math.round(0.4 * sampleRate);
  const hop = Math.round(0.1 * sampleRate);
  const n = channels[0].length;
  if (n < block) return -Infinity;
  // Sum of squares per 100 ms hop; a 400 ms block is four hops (75% overlap).
  const hops = Math.floor(n / hop);
  const hopSum = new Float64Array(hops);
  for (const c of k) {
    for (let h = 0; h < hops; h++) {
      let s = 0;
      for (let i = h * hop; i < (h + 1) * hop; i++) s += c[i] * c[i];
      hopSum[h] += s; // L and R weigh 1.0 each
    }
  }
  const per = Math.round(block / hop);
  const powers: number[] = [];
  for (let h = 0; h + per <= hops; h++) {
    let s = 0;
    for (let j = h; j < h + per; j++) s += hopSum[j];
    powers.push(s / (per * hop));
  }
  const lufs = (z: number) => -0.691 + 10 * Math.log10(z);
  const abs = powers.filter((z) => z > 0 && lufs(z) > -70);
  if (!abs.length) return -Infinity;
  const mean = (a: number[]) => a.reduce((s, z) => s + z, 0) / a.length;
  const rel = lufs(mean(abs)) - 10;
  const gated = abs.filter((z) => lufs(z) > rel);
  return gated.length ? lufs(mean(gated)) : -Infinity;
}

/** The highest absolute sample, in dBFS (-Infinity for silence). */
export function peakDb(channels: readonly Float32Array[]) {
  let p = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) p = Math.max(p, Math.abs(c[i]));
  return p > 0 ? 20 * Math.log10(p) : -Infinity;
}

/**
 * Look-ahead peak limiter, in place: the gain starts going down `lookahead`
 * seconds before a peak (so it never clips) and comes back up over
 * `release` seconds. Linked stereo (one gain for both sides).
 */
export function limit(channels: Float32Array[], sampleRate: number, ceilingDb = CEILING_DB, lookahead = 0.005, release = 0.12) {
  if (!channels.length) return;
  const n = channels[0].length;
  const ceil = dbToGain(ceilingDb);
  // The gain each sample needs on its own.
  const need = new Float32Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const c of channels) p = Math.max(p, Math.abs(c[i]));
    need[i] = p > ceil ? ceil / p : 1;
    if (need[i] < 1) any = true;
  }
  if (!any) return;
  const la = Math.max(1, Math.round(lookahead * sampleRate));
  // Backwards: each dip is reached by a straight ramp down that starts at most
  // `la` samples before it (O(n)); forwards: recover exponentially.
  const g = new Float32Array(n);
  const step = 1 / la;
  let next = 1;
  for (let i = n - 1; i >= 0; i--) {
    next = Math.min(need[i], next + step, 1);
    g[i] = next;
  }
  const rel = Math.exp(-1 / (release * sampleRate));
  let cur = 1;
  for (let i = 0; i < n; i++) {
    cur = g[i] < cur ? g[i] : g[i] + (cur - g[i]) * rel;
    // Never above what this sample needs (the release can't push a peak over).
    const gi = Math.min(cur, need[i]);
    for (const c of channels) c[i] *= gi;
  }
}

/**
 * Brings the mix to `target` LUFS, in place, and keeps peaks under the
 * ceiling. Returns what it did: the measured loudness, the gain applied (dB)
 * and the loudness after. Silence is left alone.
 */
export function normalizeLoudness(channels: Float32Array[], sampleRate: number, target = TARGET_LUFS) {
  const before = integratedLoudness(channels, sampleRate);
  if (!Number.isFinite(before)) return { before, gainDb: 0, after: before };
  const gainDb = Math.min(MAX_BOOST_DB, target - before);
  const g = dbToGain(gainDb);
  for (const c of channels) for (let i = 0; i < c.length; i++) c[i] *= g;
  limit(channels, sampleRate);
  return { before, gainDb, after: integratedLoudness(channels, sampleRate) };
}
