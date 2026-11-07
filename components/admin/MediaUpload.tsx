"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { LIMITS } from "@/convex/lib/taxonomy";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/webm"];

export type UploadKind = "image" | "video";

/** Uploads one file to Convex storage and returns its storage id. */
export function useStorageUpload() {
  const generateUploadUrl = useMutation(api.listings.generateUploadUrl);
  return async (file: File): Promise<Id<"_storage">> => {
    const postUrl = await generateUploadUrl({});
    const res = await fetch(postUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
    if (!res.ok) throw new Error(`Upload failed (HTTP ${res.status}).`);
    const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
    return storageId;
  };
}

/** Client-side type/size check; returns an error message or null. */
export function checkFile(file: File, kind: UploadKind, label: string): string | null {
  if (kind === "image") {
    if (!IMAGE_TYPES.includes(file.type)) return `${label} must be a PNG, JPG or WebP image.`;
    if (file.size > LIMITS.imageBytes) return `${label} must be 5 MB or less.`;
  } else {
    if (!VIDEO_TYPES.includes(file.type)) return `${label} must be an MP4 or WebM video.`;
    if (file.size > LIMITS.videoBytes) return `${label} must be 10 MB or less.`;
  }
  return null;
}

/**
 * File picker with drag & drop and a local preview. It does NOT upload by
 * itself: the parent decides when (use useStorageUpload). `currentUrl`
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
