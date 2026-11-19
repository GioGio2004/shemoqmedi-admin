// Signed browser → ImageKit uploads (ImageKit Upload API v2).
//
// The v1 signature only covered a random token and an expiry, so whoever got
// one could upload any file into any folder of the account and choose its
// name (audit C-02). A v2 token is a JWT signed with the private key whose
// payload IS the upload's parameters: ImageKit rejects the upload if the
// form fields differ. So the server decides the folder, the file name, that
// nothing is overwritten and the size/type checks, and the browser can only
// send the file bytes.

import { latinizeGeorgian } from "./georgian";

export const UPLOAD_V2_URL = "https://upload.imagekit.io/api/v2/files/upload";

/** How long a signed upload stays valid (ImageKit allows at most an hour). */
export const UPLOAD_TTL_SECONDS = 10 * 60;

/** The form fields the browser must send next to `file` and `token`, exactly as signed. */
export type UploadParams = {
  fileName: string;
  folder: string;
  useUniqueFileName: "true";
  overwriteFile: "false";
  tags: string;
  checks: string;
};

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array | string) {
  const raw = typeof bytes === "string" ? encoder.encode(bytes) : bytes;
  let bin = "";
  for (const b of raw) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** HS256 JWT, `kid` = the public key (what ImageKit expects for v2 uploads). */
export async function signJwt(payload: Record<string, unknown>, privateKey: string, publicKey: string) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT", kid: publicKey }));
  const body = base64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey("raw", encoder.encode(privateKey), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${header}.${body}`)));
  return `${header}.${body}.${base64url(sig)}`;
}

/** ImageKit upload check: size cap and allowed MIME types, enforced by ImageKit itself. */
export function uploadChecks(maxBytes: number, mimeTypes: readonly string[]) {
  const mb = Math.max(1, Math.floor(maxBytes / 1024 / 1024));
  return `"file.size" <= "${mb}mb" AND "file.mime" IN [${mimeTypes.map((t) => `"${t}"`).join(", ")}]`;
}

/** Folder and file names: lowercase a-z, 0-9 and dashes only (no "..", no slashes). */
export function safeSegment(value: string, fallback: string, max = 60) {
  return (
    latinizeGeorgian(value)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max)
      .replace(/-+$/g, "") || fallback
  );
}

export async function signUploadParams(
  params: Omit<UploadParams, "useUniqueFileName" | "overwriteFile">,
  keys: { privateKey: string; publicKey: string },
  now = Date.now(),
) {
  const full: UploadParams = { ...params, useUniqueFileName: "true", overwriteFile: "false" };
  const iat = Math.floor(now / 1000);
  const token = await signJwt({ ...full, iat, exp: iat + UPLOAD_TTL_SECONDS }, keys.privateKey, keys.publicKey);
  return { token, params: full };
}
