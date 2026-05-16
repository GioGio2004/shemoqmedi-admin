"use client";

import { useState, useRef } from "react";
import {
  upload,
  ImageKitAbortError,
  ImageKitInvalidRequestError,
  ImageKitServerError,
  ImageKitUploadNetworkError,
} from "@imagekit/next";
import type { UploadResponse } from "@imagekit/next";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Strips special chars, collapses spaces to hyphens, forces lowercase. */
function slugify(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")   // remove non-alphanumeric (except - and space)
    .replace(/[\s_]+/g, "-")    // collapse spaces/underscores to single hyphen
    .replace(/--+/g, "-")       // collapse repeated hyphens
    .replace(/^-+|-+$/g, "");   // trim leading/trailing hyphens
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ImageUploaderProps {
  itemName: string;
  cafeName: string;
  /** Called with the full UploadResponse once the upload succeeds. */
  onSuccess?: (response: UploadResponse) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ImageUploader({ itemName, cafeName, onSuccess }: ImageUploaderProps) {
  const [progress, setProgress] = useState<number>(0);
  const [status, setStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleUpload(file: File) {
    setStatus("uploading");
    setProgress(0);
    setErrorMessage(null);

    abortControllerRef.current = new AbortController();

    // Build the SEO-optimised file name
    const fileName = `${slugify(cafeName)}-${slugify(itemName)}-tbilisi.webp`;

    try {
      // Fetch short-lived credentials from our server-side auth route
      const authRes = await fetch("/api/upload-auth");
      if (!authRes.ok) throw new Error("Failed to fetch upload auth params");
      const { token, expire, signature, publicKey } = await authRes.json();

      const result = await upload({
        file,
        token,
        expire,
        signature,
        publicKey,
        fileName,
        folder: "/menu-items",
        useUniqueFileName: true,    // true ensures fresh URL and bypasses CDN cache
        overwriteFile: false,       // no need to overwrite since we use unique names
        // Removed urlEndpoint here to satisfy TS UploadOptions
        abortSignal: abortControllerRef.current.signal,
        onProgress(event) {
          if (event.total > 0) {
            setProgress(Math.round((event.loaded / event.total) * 100));
          }
        },
      });

      setStatus("success");
      setProgress(100);
      // Added fallback to null to satisfy TS SetStateAction<string | null>
      setUploadedUrl(result.url ?? null);
      onSuccess?.(result);
    } catch (err) {
      if (err instanceof ImageKitAbortError) {
        // User-initiated cancellation — return to idle silently
        setStatus("idle");
        setProgress(0);
      } else if (err instanceof ImageKitUploadNetworkError) {
        setErrorMessage("Network error — please check your connection and try again.");
        setStatus("error");
      } else if (err instanceof ImageKitInvalidRequestError) {
        setErrorMessage(`Invalid request: ${(err as Error).message}`);
        setStatus("error");
      } else if (err instanceof ImageKitServerError) {
        setErrorMessage(`ImageKit server error: ${(err as Error).message}`);
        setStatus("error");
      } else {
        setErrorMessage("An unexpected error occurred.");
        setStatus("error");
      }
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  }

  function handleCancel() {
    abortControllerRef.current?.abort();
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Hidden native file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        aria-label="Select image to upload"
      />

      {/* Trigger button */}
      {status !== "uploading" && (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 transition-all"
        >
          {status === "success" ? "Replace Image" : "Upload Image"}
        </button>
      )}

      {/* Progress bar */}
      {status === "uploading" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span>Uploading… {progress}%</span>
            <button
              type="button"
              onClick={handleCancel}
              className="text-zinc-500 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
          <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-white transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Success preview */}
      {status === "success" && uploadedUrl && (
        <p className="text-xs text-zinc-400 truncate">
          ✓ Uploaded:{" "}
          <a
            href={uploadedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-white underline underline-offset-2 hover:text-zinc-300"
          >
            {uploadedUrl}
          </a>
        </p>
      )}

      {/* Error message */}
      {status === "error" && errorMessage && (
        <p className="text-xs text-red-400">{errorMessage}</p>
      )}
    </div>
  );
}