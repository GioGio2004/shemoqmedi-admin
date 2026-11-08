import { AwsClient } from "aws4fetch";

// Cloudflare R2 holds the preview videos (ImageKit keeps the screenshots).
// R2 serves files exactly as uploaded: no re-encoding, so no processing
// units, and no bandwidth charge. Videos are compressed in the browser
// before upload (lib/videoUpload.ts in both apps).
//
// Convex env (dev and prod):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
//   R2_PUBLIC_URL  public base of the bucket, e.g. https://pub-<id>.r2.dev
//                  or https://media.shemoqmedi.space. Read on every page
//                  view, so changing it moves every video at once.

type R2Env = "R2_ACCOUNT_ID" | "R2_ACCESS_KEY_ID" | "R2_SECRET_ACCESS_KEY" | "R2_BUCKET" | "R2_PUBLIC_URL";

function env(name: R2Env) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set on this Convex deployment.`);
  return value.replace(/\/+$/, "");
}

/** True when every R2 variable is set. */
export function r2Configured() {
  return (["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_URL"] as const).every(
    (name) => !!process.env[name],
  );
}

/** Object keys we create: listings/<slug>/<name>.mp4|webm (lowercase, dashes, underscores). */
export const R2_KEY = /^listings\/[a-z0-9-]{1,60}\/[a-z0-9_-]{1,120}\.(mp4|webm)$/;

function encodeKey(key: string) {
  return key.split("/").map(encodeURIComponent).join("/");
}

/** Public URL of an object, or null when R2_PUBLIC_URL is not set. */
export function r2PublicUrl(key: string) {
  const base = process.env.R2_PUBLIC_URL?.replace(/\/+$/, "");
  return base ? `${base}/${encodeKey(key)}` : null;
}

function client() {
  return new AwsClient({
    accessKeyId: env("R2_ACCESS_KEY_ID"),
    secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
    service: "s3",
    region: "auto",
  });
}

function objectUrl(key: string) {
  return `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${env("R2_BUCKET")}/${encodeKey(key)}`;
}

/** A presigned PUT URL for one direct browser → R2 upload. */
export async function presignPut(key: string, expiresInSeconds = 15 * 60) {
  const url = new URL(objectUrl(key));
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
  const signed = await client().sign(new Request(url, { method: "PUT" }), { aws: { signQuery: true } });
  return signed.url;
}

/** Size and type of a stored object, or null if it does not exist. Throws on R2 errors. */
export async function headObject(key: string): Promise<{ size: number; contentType: string } | null> {
  const res = await client().fetch(objectUrl(key), { method: "HEAD" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 HEAD ${key}: HTTP ${res.status}`);
  return {
    size: Number(res.headers.get("content-length") ?? Number.NaN),
    contentType: res.headers.get("content-type") ?? "",
  };
}

/** Delete an object (a missing object is not an error). */
export async function deleteObject(key: string) {
  const res = await client().fetch(objectUrl(key), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE ${key}: HTTP ${res.status}`);
}
