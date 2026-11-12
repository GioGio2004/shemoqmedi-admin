// Browser helpers for the PWA (service worker, install, push). Client-only:
// every function touches window or navigator, so call them from effects or
// event handlers, never during render on the server.

/** The public VAPID key the push service checks our server's pushes against. */
export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/**
 * Register (or get) public/sw.js for this origin. Registering again is a
 * no-op that returns the existing registration; "none" makes the browser
 * check sw.js itself for updates instead of trusting the HTTP cache.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
}

/** iPhone or iPad (iPadOS reports itself as a Mac with touch). */
export function isIos() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Running as the installed app (home screen), not in a browser tab. */
export function isStandalone() {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
}

/** A base64url VAPID key as the bytes PushManager.subscribe wants. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Whether a subscription was made with this VAPID key (keys can be rotated).
 * A browser that doesn't report the key gets the benefit of the doubt:
 * answering "no" there would drop a working subscription on every visit.
 */
export function madeWithKey(subscription: PushSubscription, base64url: string) {
  const current = subscription.options?.applicationServerKey;
  if (!current) return true;
  const a = new Uint8Array(current);
  const b = keyBytes(base64url);
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** "iPhone · Safari", "Mac · Chrome": enough to tell devices apart in a list. */
export function deviceLabel(userAgent: string | null) {
  if (!userAgent) return "Unknown device";
  const device = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/.test(userAgent)
        ? "Android"
        : /Macintosh/.test(userAgent)
          ? "Mac"
          : /Windows/.test(userAgent)
            ? "Windows"
            : /Linux/.test(userAgent)
              ? "Linux"
              : "Device";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\/|CriOS\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : null;
  return browser ? `${device} · ${browser}` : device;
}
