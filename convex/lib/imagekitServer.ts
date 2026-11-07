// Server-side ImageKit upload (Convex actions only; uses the private key).
// Browsers upload directly with a signed request instead (convex/media.ts).

export type ImageKitFile = {
  fileId: string;
  url: string;
  filePath: string;
  size: number;
  width?: number;
  height?: number;
  mime?: string;
};

/** Upload bytes to /listings/<folder>/ on ImageKit and return the stored file. */
export async function uploadToImageKitFromServer(
  body: Blob,
  { fileName, folder, tags }: { fileName: string; folder: string; tags: string[] },
): Promise<ImageKitFile> {
  const key = process.env.IMAGEKIT_PRIVATE_KEY;
  if (!key) throw new Error("IMAGEKIT_PRIVATE_KEY is not set on this Convex deployment.");
  const form = new FormData();
  form.append("file", body, fileName);
  form.append("fileName", fileName);
  form.append("folder", folder);
  form.append("useUniqueFileName", "true");
  form.append("tags", tags.join(","));
  const res = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${key}:`)}` },
    body: form,
  });
  if (!res.ok) throw new Error(`ImageKit upload failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as ImageKitFile;
}
