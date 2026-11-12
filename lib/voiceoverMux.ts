// Browser-side voiceover reel: the listing's muted preview + an ElevenLabs
// narration → one Instagram-Reels-safe MP4, made with mediabunny (the same
// library and settings family as the preview pipeline in lib/videoUpload.ts).
//
//   preview MP4 ─▶ decode frames ─▶ H.264 (≤ 1280 px, 30 fps, 2 s GOP) ─┐
//   narration MP3 ─▶ Web Audio decode, 48 kHz stereo, padded ─▶ AAC ─────┴▶ MP4 (fast start)
//
// Length: when the narration runs longer than the video, the last frame is
// held (repeated at 30 fps) until the narration ends plus a short tail; when
// it is shorter, the video keeps its length and the audio ends in silence.
// Never shorter than Instagram's 3 s minimum.

import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  VideoSampleSink,
  VideoSampleSource,
  canEncodeAudio,
  canEncodeVideo,
  type VideoSample,
} from "mediabunny";
import { UploadError } from "./imagekitUpload";
import { VIDEO_MAX_WIDTH } from "./videoUpload";

/** Keep in sync with MAX_REEL_BYTES in convex/lib/voiceover.ts. */
export const MAX_REEL_BYTES = 100 * 1024 * 1024;
export const TAIL_SEC = 0.6;
export const MIN_SEC = 3;
const FPS = 30;
const SAMPLE_RATE = 48_000;
const VIDEO_BITRATE = 3_500_000;
const AUDIO_BITRATE = 128_000;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Reel length and how long the last frame is held. */
export function planReel(videoSec: number, audioSec: number) {
  const wanted = audioSec > videoSec ? audioSec + TAIL_SEC : videoSec;
  const target = Math.round(Math.max(wanted, MIN_SEC) * 1000) / 1000;
  return { target, hold: Math.max(0, Math.round((target - videoSec) * 1000) / 1000) };
}

async function download(url: string, what: string) {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    // A network error here is almost always CORS on the R2 bucket.
    throw new UploadError(
      `Could not download the ${what}. If this keeps happening, allow GET from this site in the R2 bucket's CORS policy.`,
    );
  }
  if (!res.ok) throw new UploadError(`Could not download the ${what} (HTTP ${res.status}).`);
  return res.blob();
}

/** The narration decoded and laid out over `target` seconds: 48 kHz stereo, silence after it ends. */
async function renderNarration(mp3: ArrayBuffer, target: number) {
  const frames = Math.ceil(target * SAMPLE_RATE);
  const ctx = new OfflineAudioContext(2, frames, SAMPLE_RATE);
  const source = ctx.createBufferSource();
  source.buffer = await ctx.decodeAudioData(mp3.slice(0));
  source.connect(ctx.destination);
  source.start(0);
  return ctx.startRendering();
}

async function narrationSeconds(mp3: ArrayBuffer) {
  const ctx = new OfflineAudioContext(2, 1, SAMPLE_RATE);
  try {
    return (await ctx.decodeAudioData(mp3.slice(0))).duration;
  } catch {
    throw new UploadError("The narration could not be decoded. Generate the voice again.");
  }
}

export type Reel = {
  blob: Blob;
  width: number;
  height: number;
  durationSec: number;
  videoSec: number;
  audioSec: number;
  heldSec: number;
};

/**
 * Build the reel. `onProgress` gets 0–1 while encoding. Throws an
 * UploadError the page can show.
 */
export async function buildReel(
  { videoUrl, audioUrl }: { videoUrl: string; audioUrl: string },
  onProgress?: (fraction: number) => void,
): Promise<Reel> {
  if (typeof VideoEncoder === "undefined" || typeof AudioEncoder === "undefined") {
    throw new UploadError("This browser cannot encode video. Use a recent Chrome or Edge.");
  }
  const [videoBlob, audioBlob] = await Promise.all([
    download(videoUrl, "preview video"),
    download(audioUrl, "narration"),
  ]);
  const mp3 = await audioBlob.arrayBuffer();
  const audioSec = await narrationSeconds(mp3);

  const input = new Input({ source: new BlobSource(videoBlob), formats: ALL_FORMATS });
  try {
    let track;
    let videoSec;
    try {
      track = await input.getPrimaryVideoTrack();
      videoSec = await input.computeDuration();
    } catch {
      throw new UploadError("The preview video could not be read.");
    }
    if (!track) throw new UploadError("The preview has no video in it.");
    if (!(await track.canDecode())) throw new UploadError("This browser cannot decode the preview video.");

    const { target, hold } = planReel(videoSec, audioSec);
    const scale = Math.min(1, VIDEO_MAX_WIDTH / track.displayWidth);
    const width = even(track.displayWidth * scale);
    const height = even(track.displayHeight * scale);
    const videoQuality = new Quality({ bitrate: VIDEO_BITRATE, bitrateMode: "variable" });
    const audioQuality = new Quality({ bitrate: AUDIO_BITRATE });
    if (!(await canEncodeVideo("avc", { width, height, quality: videoQuality }))) {
      throw new UploadError("This browser cannot encode H.264 video. Use a recent Chrome or Edge.");
    }
    if (!(await canEncodeAudio("aac", { numberOfChannels: 2, sampleRate: SAMPLE_RATE, quality: audioQuality }))) {
      throw new UploadError("This browser cannot encode AAC audio (Instagram needs it). Use Chrome or Edge on Windows or macOS.");
    }

    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
    const videoSource = new VideoSampleSource({
      codec: "avc",
      quality: videoQuality,
      keyFrameInterval: 2,
      transform: { width, height, fit: "fill" },
    });
    const audioSource = new AudioSampleSource({ codec: "aac", quality: audioQuality });
    output.addVideoTrack(videoSource, { frameRate: FPS });
    output.addAudioTrack(audioSource);
    await output.start();

    const feedVideo = async () => {
      const sink = new VideoSampleSink(track);
      let first: number | null = null;
      let last: VideoSample | null = null;
      let end = 0;
      try {
        for await (const sample of sink.samples()) {
          first ??= sample.timestamp;
          const ts = sample.timestamp - first;
          if (ts >= target) {
            sample.close();
            break;
          }
          sample.setTimestamp(ts);
          end = Math.min(target, ts + sample.duration);
          await videoSource.add(sample);
          last?.close();
          last = sample;
          onProgress?.(Math.min(0.99, end / target));
        }
        if (!last) throw new UploadError("The preview video has no frames.");
        // Hold the last frame (as real 30 fps frames, so every player shows it).
        for (let t = end; t < target - 1e-3; t += 1 / FPS) {
          const frame = last.clone();
          frame.setTimestamp(t);
          frame.setDuration(Math.min(1 / FPS, target - t));
          await videoSource.add(frame);
          frame.close();
          onProgress?.(Math.min(0.99, t / target));
        }
      } finally {
        last?.close();
      }
      videoSource.close();
    };

    const feedAudio = async () => {
      const narration = await renderNarration(mp3, target);
      for (const sample of AudioSample.fromAudioBuffer(narration, 0)) {
        await audioSource.add(sample);
        sample.close();
      }
      audioSource.close();
    };

    try {
      await Promise.all([feedVideo(), feedAudio()]);
      await output.finalize();
    } catch (err) {
      await output.cancel().catch(() => {});
      if (err instanceof UploadError) throw err;
      throw new UploadError(`Building the reel failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const buffer = output.target.buffer;
    if (!buffer) throw new UploadError("Building the reel produced no file.");
    const blob = new Blob([buffer], { type: "video/mp4" });
    if (blob.size > MAX_REEL_BYTES) throw new UploadError("The reel came out over 100 MB.");
    onProgress?.(1);
    return { blob, width, height, durationSec: target, videoSec, audioSec, heldSec: hold };
  } finally {
    input.dispose();
  }
}

/** PUT the reel to a presigned R2 URL. */
export async function uploadReel(blob: Blob, uploadUrl: string) {
  const res = await fetch(uploadUrl, { method: "PUT", body: blob, headers: { "Content-Type": "video/mp4" } });
  if (!res.ok) throw new UploadError(`Reel upload failed (HTTP ${res.status}). Please try again.`);
}
