"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LIMITS } from "@/convex/lib/taxonomy";
import { MAX_IMAGE_INPUT_BYTES, uploadToImageKit } from "@/lib/imagekitUpload";
import { uploadVideoToR2 } from "@/lib/videoUpload";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
// MOV (QuickTime) too: it is re-encoded to MP4 before upload.
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

export type UploadKind = "image" | "video";

/**
 * Uploads one file and returns the media id the listing mutations take.
 * Screenshots go to ImageKit as WebP (lib/imagekitUpload.ts); videos are
 * compressed in the browser and go to Cloudflare R2 (lib/videoUpload.ts).
 * Both get SEO file names.
 *
 * @param seo.site   the listing's slug or title, used for the folder and file name
 * @param seo.label  what the file is: "cover", "screenshot-3", "preview"
 * @param onProgress videos only: 0–1 while compressing
 */
export function useMediaUpload() {
  const getAuth = useAction(api.media.uploadAuth);
  const register = useMutation(api.media.register);
  const getVideoUrl = useAction(api.media.videoUploadUrl);
  const registerVideo = useMutation(api.media.registerVideo);
  return async (
    file: File,
    seo: { site: string; label: string },
    onProgress?: (fraction: number) => void,
  ): Promise<Id<"media">> => {
    if (file.type.startsWith("video/")) {
      return await registerVideo(await uploadVideoToR2(file, seo, (args) => getVideoUrl(args), onProgress));
    }
    const args = await uploadToImageKit(file, seo, () => getAuth({}));
    return await register(args);
  };
}

/** Client-side type/size check; returns an error message or null. */
export function checkFile(file: File, kind: UploadKind, label: string): string | null {
  if (kind === "image") {
    if (!IMAGE_TYPES.includes(file.type)) return `${label} must be a PNG, JPG or WebP image.`;
    // Checked again after WebP conversion against LIMITS.imageBytes (5 MB).
    if (file.size > MAX_IMAGE_INPUT_BYTES) return `${label} must be 20 MB or less.`;
  } else {
    if (!VIDEO_TYPES.includes(file.type)) return `${label} must be an MP4, WebM or MOV video.`;
    // Compressed before upload; length and the 15 MB stored limit are checked then.
    if (file.size > LIMITS.videoInputBytes) return `${label} must be 500 MB or less.`;
  }
  return null;
}

/**
 * File picker with drag & drop and a local preview. It does NOT upload by
 * itself: the parent decides when (use useMediaUpload). `currentUrl`
 * shows the existing media when nothing new is picked.
 */
export function MediaPicker({
  id,
  label,
  hint,
  kind,
  file,
  onChange,
  currentUrl,
  aspect = "16 / 9",
}: {
  id: string;
  label: string;
  hint?: string;
  kind: UploadKind;
  file: File | null;
  onChange: (file: File | null, error: string | null) => void;
  currentUrl?: string | null;
  aspect?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const shown = preview ?? currentUrl ?? null;

  const pick = (f: File | null) => {
    if (!f) return onChange(null, null);
    onChange(f, checkFile(f, kind, label));
  };

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="admin-eyebrow">
        {label}
      </label>
      <label
        htmlFor={id}
        className="media-drop"
        data-dragging={dragging || undefined}
        style={{ aspectRatio: aspect }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files?.[0] ?? null);
        }}
      >
        {shown ? (
          kind === "image" ? (
            <img src={shown} alt="" />
          ) : (
            <video src={shown} muted loop playsInline autoPlay />
          )
        ) : (
          <span>
            Drop {kind === "image" ? "an image" : "a video"} or <u>browse</u>
          </span>
        )}
        <input
          ref={input}
          id={id}
          type="file"
          accept={(kind === "image" ? IMAGE_TYPES : VIDEO_TYPES).join(",")}
          className="sr-only"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />
      </label>
      <div className="flex items-center justify-between gap-3">
        {hint && <p className="text-xs text-black/55">{hint}</p>}
        {file && (
          <button
            type="button"
            className="admin-text-link min-h-0"
            onClick={() => {
              if (input.current) input.current.value = "";
              onChange(null, null);
            }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Several images at once (drag & drop or browse), with local previews and a
 * remove button on each. Like MediaPicker it does not upload by itself.
 */
export function MultiImagePicker({
  id,
  label,
  hint,
  files,
  max,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  files: File[];
  max: number;
  onChange: (files: File[], error: string | null) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p)), [previews]);

  const add = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    if (!picked.length) return;
    const room = max - files.length;
    const next = [...files, ...picked.slice(0, Math.max(0, room))];
    const error =
      picked.map((f) => checkFile(f, "image", "Each screenshot")).find(Boolean) ??
      (picked.length > room ? `Only ${max} fit here; the rest were left out.` : null);
    onChange(
      next.filter((f) => !checkFile(f, "image", "Screenshot")),
      error,
    );
  };

  return (
    <div className="grid gap-2">
      <span className="admin-eyebrow">
        {label} {files.length}/{max}
      </span>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {files.map((file, i) => (
          <figure key={`${file.name}-${file.size}-${i}`} className="relative overflow-hidden rounded-xl border border-[var(--line)]" style={{ aspectRatio: "16 / 9" }}>
            <img src={previews[i]} alt="" className="absolute inset-0 size-full object-cover object-top" />
            <button
              type="button"
              aria-label={`Remove ${file.name}`}
              onClick={() => onChange(files.filter((_, k) => k !== i), null)}
              className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-white text-sm leading-none hover:bg-black hover:text-white"
            >
              ×
            </button>
          </figure>
        ))}
        {files.length < max && (
          <label
            htmlFor={id}
            className="media-drop"
            data-dragging={dragging || undefined}
            style={{ aspectRatio: "16 / 9" }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              add(e.dataTransfer.files);
            }}
          >
            <span className="px-2 text-xs">
              Drop images or <u>browse</u>
            </span>
            <input
              id={id}
              type="file"
              multiple
              accept={IMAGE_TYPES.join(",")}
              className="sr-only"
              onChange={(e) => {
                add(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>
      {hint && <p className="text-xs text-black/55">{hint}</p>}
    </div>
  );
}
