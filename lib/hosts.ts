// The two hosts this one Next app serves (proxy.ts routes between them):
// the Studio (social posts, graphics, reels) and the admin (everything else).
// Shared by Next (manifest, nav links) and Convex (push deep links), so it
// must stay free of Node and browser imports.

export const STUDIO_ORIGIN = "https://studio.shemoqmedi.space";
export const ADMIN_APP_ORIGIN = "https://admin.shemoqmedi.space";

/** The host part of a Host header, lowercased and without its port. */
function hostname(host: string) {
  return host.trim().toLowerCase().replace(/:\d+$/, "");
}

// studio.localhost:3000 stands in for the Studio in development (browsers
// resolve *.localhost to this machine). Only these two names count: the host
// decides routing (proxy.ts), so a look-alike such as studio.example.com
// must not.
const STUDIO_HOSTS = new Set([new URL(STUDIO_ORIGIN).hostname, "studio.localhost"]);

/** Whether a request's Host header is the Studio (production or local development). */
export function isStudioHost(host: string | null | undefined): boolean {
  if (!host) return false;
  return STUDIO_HOSTS.has(hostname(host));
}

/** An absolute admin link for a path, e.g. adminUrl("/review/abc"). */
export function adminUrl(path: string) {
  return `${ADMIN_APP_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

/** An absolute Studio link for a path. */
export function studioUrl(path = "/") {
  return `${STUDIO_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

/** A post in the Studio queue (opened on top): where post pushes link. */
export function studioPostUrl(id: string) {
  return studioUrl(`/queue?post=${encodeURIComponent(id)}`);
}

/** A reel draft in the Studio's reel editor: where "Reel draft ready to render" pushes link. */
export function studioReelUrl(id: string) {
  return studioUrl(`/reels?draft=${encodeURIComponent(id)}`);
}
