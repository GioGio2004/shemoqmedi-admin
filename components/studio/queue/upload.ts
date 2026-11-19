"use client";

// An image from the device, added to a post (docs/post-editing.md section 4):
// checked, redrawn as a JPEG when it isn't a small enough JPEG or PNG (at most
// 4096 px a side, 5 MB), uploaded straight to ImageKit's /social/graphics
// folder with a signature from graphics.finalUploadAuth, then registered
// with media.registerSocial (no recipe: it wasn't rendered here).

import { UploadError, postSignedUpload, type UploadAuth } from "@/lib/imagekitUpload";
import { UPLOAD_MAX_BYTES, fitSide, pickedFileProblem, uploadAsIs, type Picked } from "./mediaEdit";

export type FinalAuth = UploadAuth;
export type GetFinalAuth = (args: { name: string; contentType: "image/jpeg" | "image/png" }) => Promise<FinalAuth>;
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
export async function uploadDeviceImage(file: File, name: string, getAuth: GetFinalAuth, register: RegisterSocial): Promise<Picked> {
  const problem = pickedFileProblem(file);
  if (problem) throw new UploadError(problem);
  const { blob, width, height, type } = await prepare(file);
  // The server names the file and pins the folder (/social/graphics) in the signed token.
  const out = await postSignedUpload(blob, await getAuth({ name, contentType: type === "image/png" ? "image/png" : "image/jpeg" }));
  const w = out.width ?? width;
  const h = out.height ?? height;
  await register({ url: out.url, fileId: out.fileId, filePath: out.filePath, size: out.size ?? blob.size, width: w, height: h, contentType: type });
  return { kind: "image", url: out.url, role: "upload", width: w, height: h, design: null };
}
