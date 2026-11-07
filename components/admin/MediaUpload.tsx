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
