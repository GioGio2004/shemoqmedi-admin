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

/**
 * Whether a request's Host header is the Studio. Any "studio." subdomain
 * counts, so studio.localhost:3000 works in development the same way.
 */
export function isStudioHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const name = hostname(host);
  return name === new URL(STUDIO_ORIGIN).hostname || name.startsWith("studio.");
}

/** An absolute admin link for a path, e.g. adminUrl("/review/abc"). */
export function adminUrl(path: string) {
  return `${ADMIN_APP_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

/** An absolute Studio link for a path. */
export function studioUrl(path = "/") {
  return `${STUDIO_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}
