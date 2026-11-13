"use client";

// Files from the device for the reel editor (docs/reel-editor.md section 4):
// a video clip or a music track goes straight to R2 with a presigned PUT
// (reels.uploadUrl → PUT with the file's own content-type → reels.registerUpload);
// a picture goes the Studio's ImageKit way (components/studio/queue/upload.ts).

import { UploadError } from "@/lib/imagekitUpload";
import type { ClipSource } from "@/lib/reel/recipe";

export const CLIP_TYPES: Record<string, string> = { mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm" };
export const MUSIC_TYPES: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", mp4: "audio/mp4" };
export const CLIP_MAX_BYTES = 200 * 1024 * 1024;
export const MUSIC_MAX_BYTES = 20 * 1024 * 1024;

const ext = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

/** The content type to upload a file as (some phones give none for .m4a / .mov), or null when it isn't one we take. */
export function uploadType(file: Pick<File, "name" | "type">, kind: "clip" | "music"): string | null {
  const table = kind === "clip" ? CLIP_TYPES : MUSIC_TYPES;
  const allowed = new Set(Object.values(table).concat(kind === "music" ? ["audio/x-m4a", "audio/mp3"] : []));
  const type = file.type.split(";")[0].trim().toLowerCase();
  if (type && allowed.has(type)) return type === "audio/mp3" ? "audio/mpeg" : type;
  return table[ext(file.name)] ?? null;
}

/** Why a picked file can't be uploaded, or null. */
export function uploadProblem(file: Pick<File, "name" | "type" | "size">, kind: "clip" | "music"): string | null {
  if (!uploadType(file, kind)) return kind === "clip" ? "Videos are MP4, MOV or WebM." : "Music is an MP3 or M4A file.";
  const max = kind === "clip" ? CLIP_MAX_BYTES : MUSIC_MAX_BYTES;
  if (file.size > max) return kind === "clip" ? "Videos can be up to 200 MB. Trim or compress it first." : "Music files can be up to 20 MB.";
  if (file.size <= 0) return "That file is empty.";
  return null;
}

/** Size and length of a local video or audio file, read by the browser (undefined when it can't). */
export function readMediaMeta(file: File, kind: "video" | "audio"): Promise<{ width?: number; height?: number; durationSec?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(kind);
    let settled = false;
    const done = (out: { width?: number; height?: number; durationSec?: number }) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      el.removeAttribute("src");
      el.load();
      URL.revokeObjectURL(url);
      resolve(out);
    };
    const timer = window.setTimeout(() => done({}), 15_000);
    el.preload = "metadata";
    el.muted = true;
    el.onloadedmetadata = () => {
      const d = el.duration;
      const v = el as HTMLVideoElement;
      done({
        durationSec: Number.isFinite(d) && d > 0 ? Math.round(d * 100) / 100 : undefined,
        width: kind === "video" && v.videoWidth > 0 ? v.videoWidth : undefined,
        height: kind === "video" && v.videoHeight > 0 ? v.videoHeight : undefined,
      });
    };
    el.onerror = () => done({});
    el.src = url;
  });
}

/** PUT a file to a presigned R2 URL with its content type, reporting progress 0..1. */
export function putFile(file: Blob, uploadUrl: string, contentType: string, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new UploadError(`Upload failed (HTTP ${xhr.status}). Please try again.`)));
    xhr.onerror = () =>
      reject(new UploadError(`The upload was blocked. Allow PUT from ${location.origin} in the R2 bucket's CORS policy, then try again.`));
    xhr.onabort = () => reject(Object.assign(new UploadError("Upload cancelled."), { code: "cancelled" }));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}

type UploadUrl = (args: { contentType: string; size: number; listingId?: string }) => Promise<{ uploadUrl: string; key: string; url: string; kind: "clip" | "music" }>;
type Register = (args: { key: string; contentType: string; size: number; width?: number; height?: number; durationSec?: number; title?: string }) => Promise<{
  kind: "clip" | "music";
  url: string;
  mediaId: string | null;
  audioId: string | null;
}>;

/** A video from the device as a clip source (on R2, registered as media). */
export async function uploadClipVideo(file: File, api: { uploadUrl: UploadUrl; register: Register }, onProgress?: (f: number) => void): Promise<ClipSource> {
  const problem = uploadProblem(file, "clip");
  if (problem) throw new UploadError(problem);
  const contentType = uploadType(file, "clip")!;
  const meta = await readMediaMeta(file, "video");
  const { uploadUrl, key } = await api.uploadUrl({ contentType, size: file.size });
  await putFile(file, uploadUrl, contentType, onProgress);
  const reg = await api.register({ key, contentType, size: file.size, ...meta });
  const source: ClipSource = { kind: "upload-video", url: reg.url, label: file.name.replace(/\.[^.]+$/, "").slice(0, 120) || "Uploaded video" };
  if (reg.mediaId) source.mediaId = reg.mediaId;
  if (meta.width) source.width = meta.width;
  if (meta.height) source.height = meta.height;
  if (meta.durationSec) source.durationSec = meta.durationSec;
  return source;
}

/** A music track from the device (on R2, a reelAudio row). */
export async function uploadMusicFile(
  file: File,
  api: { uploadUrl: UploadUrl; register: Register },
  onProgress?: (f: number) => void,
): Promise<{ audioId: string | null; url: string; title: string; durationSec?: number }> {
  const problem = uploadProblem(file, "music");
  if (problem) throw new UploadError(problem);
  const contentType = uploadType(file, "music")!;
  const meta = await readMediaMeta(file, "audio");
  const title = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 120) || "Music";
  const { uploadUrl, key } = await api.uploadUrl({ contentType, size: file.size });
  await putFile(file, uploadUrl, contentType, onProgress);
  const reg = await api.register({ key, contentType, size: file.size, durationSec: meta.durationSec, title });
  return { audioId: reg.audioId, url: reg.url, title, durationSec: meta.durationSec };
}
