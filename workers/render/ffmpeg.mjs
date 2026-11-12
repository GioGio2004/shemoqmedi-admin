// ffmpeg / ffprobe for the render worker. The argument builders are pure so
// test/plan.test.mjs can check them without running ffmpeg.

import { spawn } from "node:child_process";

/** Seconds of picture kept after the narration ends when the video has to be held. */
export const TAIL_SEC = 0.6;
/** Instagram refuses Reels shorter than 3 seconds. */
export const MIN_SEC = 3;

/**
 * How long the reel runs and how long the last frame is held.
 * Narration longer than the video: hold the last frame until it ends (+ a short tail).
 * Narration shorter: keep the video's length; the audio is padded with silence.
 */
export function planMux(videoSec, audioSec) {
  const wanted = audioSec > videoSec ? audioSec + TAIL_SEC : videoSec;
  const target = round3(Math.max(wanted, MIN_SEC));
  const hold = round3(Math.max(0, target - videoSec));
  return { target, hold };
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

const LAYOUTS = {
  // The preview's own frame, at most 1920 px on either side, even dimensions.
  source: "scale=w='min(1920,iw)':h='min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
  // Centred on a 1080×1920 (9:16) black canvas, the Reels frame.
  vertical:
    "scale=w=1080:h=1920:force_original_aspect_ratio=decrease:force_divisible_by=2," +
    "pad=w=1080:h=1920:x=(ow-iw)/2:y=(oh-ih)/2:color=black",
};

export function isLayout(value) {
  return Object.hasOwn(LAYOUTS, value);
}

/**
 * ffmpeg arguments for an Instagram-Reels-safe MP4: H.264 High 4.1, yuv420p,
 * 30 fps with a closed 2 s GOP, AAC-LC 128 kb/s 48 kHz stereo, moov first
 * (faststart). The narration is loudness-normalised for phones (-14 LUFS).
 */
export function muxArgs({ video, audio, out, videoSec, audioSec, layout = "source", threads = 2 }) {
  const { target, hold } = planMux(videoSec, audioSec);
  const v = [LAYOUTS[layout] ?? LAYOUTS.source, "setsar=1", "fps=30"];
  if (hold > 0) v.push(`tpad=stop_mode=clone:stop_duration=${hold}`);
  v.push("format=yuv420p");
  // loudnorm resamples to 192 kHz internally, so resample after it.
  const a = ["loudnorm=I=-14:TP=-1.5:LRA=11", "aresample=48000", "aformat=channel_layouts=stereo", "apad"];
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-i", video,
    "-i", audio,
    "-filter_complex", `[0:v:0]${v.join(",")}[v];[1:a:0]${a.join(",")}[a]`,
    "-map", "[v]",
    "-map", "[a]",
    "-t", String(target),
    "-c:v", "libx264",
    "-preset", "medium",
    "-profile:v", "high",
    "-level:v", "4.1",
    "-crf", "20",
    "-maxrate", "8M",
    "-bufsize", "16M",
    "-g", "60",
    "-keyint_min", "30",
    "-sc_threshold", "0",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "48000",
    "-ac", "2",
    "-movflags", "+faststart",
    "-threads", String(threads),
    out,
  ];
}

/** Run a command; resolves with stdout, rejects with the tail of stderr. Killed after timeoutMs. */
export function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} took longer than ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited with ${code}: ${stderr.trim().split("\n").slice(-5).join(" | ")}`));
    });
  });
}

/** Duration (s) and the first video stream's size, via ffprobe. */
export async function probe(file, timeoutMs = 30_000) {
  const out = await run(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,duration", "-of", "json", file],
    timeoutMs,
  );
  const info = JSON.parse(out);
  const streams = info.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  const durationSec = Number(info.format?.duration ?? video?.duration ?? audio?.duration);
  return {
    durationSec: Number.isFinite(durationSec) ? durationSec : 0,
    hasVideo: !!video,
    hasAudio: !!audio,
    width: video?.width,
    height: video?.height,
  };
}
