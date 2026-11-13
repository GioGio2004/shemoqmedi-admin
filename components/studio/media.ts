// Picture URLs sized to their box. ImageKit URLs get a width transform
// (?tr=w-<n>); anything else (Convex storage, R2 video) is returned as is.

const IK = /^https:\/\/ik\.imagekit\.io\//;

/** `url` resized by ImageKit to `width` px wide (never upscaled past the original by ImageKit). */
export function ikUrl(url: string, width: number) {
  if (!IK.test(url) || /[?&]tr=/.test(url) || /\/tr:/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}tr=w-${Math.round(width)}`;
}

/** A srcset for `url` at the given widths (ImageKit only; undefined otherwise). */
export function ikSrcSet(url: string, widths: number[] = [480, 720, 1080]) {
  if (!IK.test(url)) return undefined;
  return widths.map((w) => `${ikUrl(url, w)} ${w}w`).join(", ");
}

/** True for a video file by extension (R2 reels, uploaded clips). */
export function isVideoUrl(url: string) {
  return /\.(mp4|mov|webm|m4v)(\?|#|$)/i.test(url);
}
