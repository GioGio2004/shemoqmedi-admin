// Browser-side media pipeline (identical copy in shemoqmedi/lib/imagekitUpload.ts).
//
//   screenshot ─▶ WebP (max 2560 px wide, q 0.86) ─▶ SEO file name ─▶ ImageKit
//
// Videos do not come here: they are compressed and stored on Cloudflare R2
// (lib/videoUpload.ts), because ImageKit re-encodes every new video and
// that spends its free video processing units.
//
// Files land in /listings/<site-slug>/ as e.g.
//   kencho-group-website-screenshot-2.webp
// (ImageKit appends a short unique suffix so a replaced file never serves a
// stale CDN copy). The upload is signed by Convex (media.uploadAuth) and the
// result is registered with media.register, which returns the id that the
// listing mutations accept.

export const MAX_IMAGE_WIDTH = 2560;
const WEBP_QUALITY = 0.86;
/** Largest screenshot we accept before conversion (the server limit applies after). */
export const MAX_IMAGE_INPUT_BYTES = 20 * 1024 * 1024;
/** Server limit after conversion (keep in sync with LIMITS.imageBytes). */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** A readable upload problem, safe to show the person uploading. */
export class UploadError extends Error {
  override name = "UploadError";
}

export type UploadAuth = {
  token: string;
  expire: number;
  signature: string;
  publicKey: string;
  urlEndpoint: string;
};

export type RegisterArgs = {
  fileId: string;
  url: string;
  filePath: string;
  kind: "image" | "video";
  contentType: string;
  size: number;
  width?: number;
  height?: number;
};

/** "Kencho Group — Kitchens!" → "kencho-group-kitchens" (same rules as the server's slugify). */
export function seoSlug(value: string, fallback = "site") {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || fallback
  );
}

/**
 * Re-encode a screenshot as WebP, at most MAX_IMAGE_WIDTH wide (tall
 * full-page shots keep their full height). Falls back to the original when
 * the browser cannot encode WebP or the result would not be smaller.
 */
export async function toWebp(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_IMAGE_WIDTH / bitmap.width);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d");
    if (!g) return { blob: file, width: bitmap.width, height: bitmap.height };
    g.imageSmoothingQuality = "high";
    g.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", WEBP_QUALITY));
    const usable = blob && blob.type === "image/webp" && (blob.size < file.size || file.type !== "image/webp");
    return usable ? { blob, width, height } : { blob: file, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

function extensionFor(type: string) {
  return { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "video/mp4": "mp4", "video/webm": "webm" }[type] ?? "bin";
}

/**
 * Convert (images), name, and upload one file straight to ImageKit; returns
 * what media.register needs.
 *
 * @param site  the listing's slug or title (used for the folder and file name)
 * @param label what the file is: "cover", "screenshot-3", "preview"
 */
export async function uploadToImageKit(
  file: File,
  { site, label }: { site: string; label: string },
  getAuth: () => Promise<UploadAuth>,
): Promise<RegisterArgs> {
  const kind = file.type.startsWith("video/") ? "video" : "image";
  let body: Blob = file;
  let width: number | undefined;
  let height: number | undefined;
  if (kind === "image") {
    ({ blob: body, width, height } = await toWebp(file));
    if (body.size > MAX_IMAGE_BYTES) {
      throw new UploadError("This screenshot is still over 5 MB after compression. Use a smaller image.");
    }
  }

  const slug = seoSlug(site);
  const fileName = `${slug}-website-${seoSlug(label, "image")}.${extensionFor(body.type)}`;
  const auth = await getAuth();

  const form = new FormData();
  form.append("file", body, fileName);
  form.append("fileName", fileName);
  form.append("folder", `/listings/${slug}`);
  form.append("useUniqueFileName", "true");
  form.append("tags", `listing,${slug},${kind}`);
  form.append("publicKey", auth.publicKey);
  form.append("signature", auth.signature);
  form.append("expire", String(auth.expire));
  form.append("token", auth.token);

  const res = await fetch("https://upload.imagekit.io/api/v1/files/upload", { method: "POST", body: form });
  if (!res.ok) {
    let reason = "";
    try {
      reason = ((await res.json()) as { message?: string }).message ?? "";
    } catch {
      // not JSON
    }
    throw new UploadError(reason ? `Upload failed: ${reason}` : `Upload failed (HTTP ${res.status}). Please try again.`);
  }
  const out = (await res.json()) as {
    fileId: string;
    url: string;
    filePath: string;
    size: number;
    width?: number;
    height?: number;
  };
  return {
    fileId: out.fileId,
    url: out.url,
    filePath: out.filePath,
    kind,
    contentType: body.type || file.type,
    size: out.size ?? body.size,
    width: out.width ?? width,
    height: out.height ?? height,
  };
}
