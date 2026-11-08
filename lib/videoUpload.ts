// Browser-side preview-video pipeline (identical copy in shemoqmedi/lib/videoUpload.ts).
//
//   video ─▶ H.264 MP4 (max 1280 px wide, ~2 Mbps, ≤ 30 fps, no sound, fast start) ─▶ Cloudflare R2
//
// R2 serves the file exactly as uploaded: no re-encoding (which is what
// spent ImageKit's video processing units) and no bandwidth bill. So the
// file has to be web-sized before it leaves the browser: a 40-second
// screen recording comes out at about 10 MB. H.264 MP4 plays in every
// browser. The upload URL is signed by Convex (media.videoUploadUrl) and the
// result is registered with media.registerVideo, which returns the id the
// listing mutations accept.

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  canEncodeVideo,
} from "mediabunny";
import { UploadError, seoSlug } from "./imagekitUpload";

export const VIDEO_MAX_WIDTH = 1280;
const VIDEO_BITRATE = 2_000_000;
const VIDEO_MAX_FPS = 30;
/** Keep in sync with LIMITS.videoBytes / videoSeconds / videoInputBytes. */
export const MAX_VIDEO_BYTES = 15 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 60;
export const MAX_VIDEO_INPUT_BYTES = 500 * 1024 * 1024;

export type RegisterVideoArgs = {
  key: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
};

export type VideoUploadUrl = (args: {
  site: string;
  label: string;
  contentType: string;
  size: number;
}) => Promise<{ uploadUrl: string; key: string }>;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * Compress a video for the web. Throws an UploadError the uploader can read
 * when the video is too long or cannot be read. When this browser cannot
 * encode H.264, a file that is already small enough is used as it is.
 */
export async function compressVideo(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<{ blob: Blob; width?: number; height?: number }> {
  const asIs = () => {
    if (file.size <= MAX_VIDEO_BYTES && (file.type === "video/mp4" || file.type === "video/webm")) {
      return { blob: file as Blob };
    }
    throw new UploadError(
      "This browser cannot compress videos. Use a recent Chrome, Edge or Safari, or pick a file of 15 MB or less.",
    );
  };

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    let track;
    let duration;
    try {
      track = await input.getPrimaryVideoTrack();
      duration = await input.computeDuration();
    } catch {
      throw new UploadError("This video could not be read. Export it again as an MP4 and retry.");
    }
    if (!track) throw new UploadError("This file has no video in it.");
    if (duration > MAX_VIDEO_SECONDS + 0.5) {
      throw new UploadError(
        `The preview video must be ${MAX_VIDEO_SECONDS} seconds or shorter (this one is ${Math.round(duration)} s).`,
      );
    }

    const scale = Math.min(1, VIDEO_MAX_WIDTH / track.displayWidth);
    const width = even(track.displayWidth * scale);
    const height = even(track.displayHeight * scale);
    // An explicit bitrate (a bare number would be a 0–1 quality level): predictable file sizes.
    const quality = new Quality({ bitrate: VIDEO_BITRATE, bitrateMode: "variable" });
    if (typeof VideoEncoder === "undefined" || !(await canEncodeVideo("avc", { width, height, quality }))) {
      return asIs();
    }

    let fps = 0;
    try {
      fps = (await track.computePacketStats(120)).averagePacketRate;
    } catch {
      // unknown: keep the source frame rate
    }

    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
    const conversion = await Conversion.init({
      input,
      output,
      tracks: "primary",
      video: {
        codec: "avc",
        width,
        height,
        fit: "fill",
        quality,
        ...(fps > VIDEO_MAX_FPS + 1 ? { frameRate: VIDEO_MAX_FPS } : {}),
        forceTranscode: true,
      },
      audio: { discard: true },
      tags: {},
      showWarnings: false,
    });
    if (!conversion.isValid) return asIs();
    if (onProgress) conversion.onProgress = (p) => onProgress(p);
    try {
      await conversion.execute();
    } catch {
      return asIs();
    }
    const buffer = output.target.buffer;
    if (!buffer) return asIs();
    const blob = new Blob([buffer], { type: "video/mp4" });
    // Already-tiny originals can beat our settings; keep the smaller one.
    if (blob.size > file.size && file.type === "video/mp4" && file.size <= MAX_VIDEO_BYTES) return { blob: file };
    if (blob.size > MAX_VIDEO_BYTES) {
      throw new UploadError("This video is still over 15 MB after compression. Trim it and try again.");
    }
    return { blob, width, height };
  } finally {
    input.dispose();
  }
}

/**
 * Compress and upload one preview video straight to R2; returns what
 * media.registerVideo needs. `onProgress` gets 0–1 while compressing.
 *
 * @param site  the listing's slug or title (used for the folder and file name)
 * @param label what the file is: "preview"
 */
export async function uploadVideoToR2(
  file: File,
  { site, label }: { site: string; label: string },
  getUploadUrl: VideoUploadUrl,
  onProgress?: (fraction: number) => void,
): Promise<RegisterVideoArgs> {
  if (file.size > MAX_VIDEO_INPUT_BYTES) throw new UploadError("Pick a video file of 500 MB or less.");
  const { blob, width, height } = await compressVideo(file, onProgress);
  const contentType = blob.type || file.type;
  const { uploadUrl, key } = await getUploadUrl({
    site: seoSlug(site),
    label: seoSlug(label, "preview"),
    contentType,
    size: blob.size,
  });
  const res = await fetch(uploadUrl, { method: "PUT", body: blob, headers: { "Content-Type": contentType } });
  if (!res.ok) throw new UploadError(`Video upload failed (HTTP ${res.status}). Please try again.`);
  return { key, contentType, size: blob.size, width, height };
}
