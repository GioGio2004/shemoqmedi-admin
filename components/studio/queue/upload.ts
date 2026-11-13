"use client";

// An image from the device, added to a post (docs/post-editing.md section 4):
// checked, redrawn as a JPEG when it isn't a small enough JPEG or PNG (at most
// 4096 px a side, 5 MB), uploaded straight to ImageKit's /social/graphics
// folder with a signature from graphics.finalUploadAuth, then registered
// with media.registerSocial (no recipe: it wasn't rendered here).

import { UploadError, seoSlug } from "@/lib/imagekitUpload";
import { UPLOAD_MAX_BYTES, fitSide, pickedFileProblem, uploadAsIs, type Picked } from "./mediaEdit";

export type FinalAuth = { token: string; expire: number; signature: string; publicKey: string; urlEndpoint: string; folder: string };
export type RegisterSocial = (args: { url: string; fileId: string; filePath: string; size: number; width: number; height: number; contentType: string }) => Promise<unknown>;

async function readImage(file: File) {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new UploadError("This browser can't read that image. Use a JPEG or PNG.");
  }
}

/** The file to upload: as it is, or redrawn as a JPEG (white under any transparency), smaller until it fits 5 MB. */
async function prepare(file: File): Promise<{ blob: Blob; width: number; height: number; type: string }> {
  const bitmap = await readImage(file);
  try {
    if (uploadAsIs(file, bitmap.width, bitmap.height)) return { blob: file, width: bitmap.width, height: bitmap.height, type: file.type };
    const { width, height } = fitSide(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d");
    if (!g) throw new UploadError("This browser can't convert that image. Use a JPEG or PNG.");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, width, height);
    g.imageSmoothingQuality = "high";
    g.drawImage(bitmap, 0, 0, width, height);
    for (const q of [0.9, 0.82, 0.72, 0.6]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", q));
      if (blob && blob.size <= UPLOAD_MAX_BYTES) return { blob, width, height, type: "image/jpeg" };
    }
    throw new UploadError("That image is still over 5 MB after compression. Pick a smaller one.");
  } finally {
    bitmap.close();
  }
}

/** Uploads one image from the device; returns it as a picked item (role "upload"). */
export async function uploadDeviceImage(file: File, name: string, getAuth: () => Promise<FinalAuth>, register: RegisterSocial): Promise<Picked> {
  const problem = pickedFileProblem(file);
  if (problem) throw new UploadError(problem);
  const { blob, width, height, type } = await prepare(file);
  const fileName = `shemoqmedi-upload-${seoSlug(name, "post")}.${type === "image/png" ? "png" : "jpg"}`;
  const auth = await getAuth();
  const form = new FormData();
  form.append("file", blob, fileName);
  form.append("fileName", fileName);
  form.append("folder", auth.folder);
  form.append("useUniqueFileName", "true");
  form.append("tags", "social,upload");
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
  const out = (await res.json()) as { fileId: string; url: string; filePath: string; size?: number; width?: number; height?: number };
  const w = out.width ?? width;
  const h = out.height ?? height;
  await register({ url: out.url, fileId: out.fileId, filePath: out.filePath, size: out.size ?? blob.size, width: w, height: h, contentType: type });
  return { kind: "image", url: out.url, role: "upload", width: w, height: h, design: null };
}
