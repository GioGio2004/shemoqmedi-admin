// Which file of a screenshot the graphics use: pure (no sharp, no node), so
// the server's fetch (imaging.ts fetchImage) and the Studio's instant preview
// (lib/studio/create.ts previewShotUrl) ask ImageKit for the same JPEG.

function hostOf(url: string | undefined) {
  try {
    return url ? new URL(url).hostname : null;
  } catch {
    return null;
  }
}

function isImageKit(url: URL) {
  return url.hostname === "ik.imagekit.io" || url.hostname === hostOf(process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT);
}

/** Widest a screenshot is ever drawn (the carousel's browser window, at 1.2x). */
export const FETCH_WIDTH = 1600;

/**
 * ImageKit screenshots are stored as big WebPs. Asking for a 1600 px JPEG
 * instead is a smaller download, a faster decode, and a format satori draws
 * as it is. Only for screenshots: a badge or logo may be a transparent PNG,
 * which a JPEG would flatten onto a box. Images that already carry a
 * transform are left alone.
 */
export function deliveryUrl(raw: string, screenshot = true) {
  const url = new URL(raw);
  if (screenshot && isImageKit(url) && !url.searchParams.has("tr") && !url.pathname.includes("/tr:")) {
    url.searchParams.set("tr", `w-${FETCH_WIDTH},f-jpg`);
  }
  return url;
}
