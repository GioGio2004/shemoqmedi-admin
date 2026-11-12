// Which app a request belongs to, decided from its host and path alone, so
// proxy.ts stays thin and this can be unit tested (tests/studioRouting.test.ts).
//
//   Studio host (studio.shemoqmedi.space, studio.localhost in development):
//     every page path /x is served by app/studio/x (a rewrite: the address
//     bar keeps /x). Shared paths are served as they are: /api/*, Clerk's
//     /sign-in* /sign-up* /sso-callback*, /.well-known*, Next internals
//     (/_next/*, any /_…), the PWA files (/sw.js, /manifest.webmanifest,
//     /icons/*), /fonts* and any other file (a last segment with an
//     extension, e.g. /robots.txt). /studio/x typed on the Studio host goes
//     to /x, its one address.
//
//   Admin host (everything else): /studio and /studio/* move to the Studio
//   host, and the old pages that live there now go to their Studio
//   counterparts: /social → /queue, /design → /create, /voiceover → /reels.
//   Query strings are kept on every rewrite and redirect.
//
// Studio rewrites always need a signed-in session; proxy.ts checks that.

import { STUDIO_ORIGIN, isStudioHost } from "./hosts";

export type StudioRouting =
  /** Not a Studio concern: the admin's own rules apply (public pages, API auth, sign-in). */
  | { type: "pass" }
  /** A Studio page: serve `path` (pathname + search) instead. Needs a session. */
  | { type: "rewrite"; path: string }
  /** Somewhere else: an absolute URL. */
  | { type: "redirect"; url: string };

/** The admin pages that moved to the Studio, and where. */
export const MOVED_TO_STUDIO: Record<string, string> = {
  "/social": "/queue",
  "/design": "/create",
  "/voiceover": "/reels",
};

const STUDIO_PREFIX = "/studio";

/** Paths the Studio host serves as they are (prefix matches, like the admin's route matchers). */
const SHARED_PREFIXES = ["/api/", "/sign-in", "/sign-up", "/sso-callback", "/.well-known", "/_", "/icons/", "/fonts"];
const SHARED_FILES = new Set(["/api", "/sw.js", "/manifest.webmanifest"]);

function isShared(pathname: string) {
  if (SHARED_FILES.has(pathname)) return true;
  if (SHARED_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  // Any other file: /robots.txt, /favicon.ico, /logo.png, ...
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  return /\.[a-z0-9]+$/i.test(last);
}

/** "/studio/queue" → "/queue", "/studio" → "/"; null when the path isn't under /studio. */
function underStudio(pathname: string): string | null {
  if (pathname === STUDIO_PREFIX || pathname === `${STUDIO_PREFIX}/`) return "/";
  // One leading slash, so "/studio//evil.com" can never become a protocol-relative link.
  if (pathname.startsWith(`${STUDIO_PREFIX}/`)) return pathname.slice(STUDIO_PREFIX.length).replace(/^\/+/, "/");
  return null;
}

/** Without a trailing slash (except the root). */
function trimSlash(pathname: string) {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The Studio's origin as seen from a request: production for every deployed
 * host; studio.localhost on the same port when developing on localhost.
 */
export function studioOriginFor(url: URL): string {
  if (LOCAL_HOSTS.has(url.hostname)) return `http://studio.localhost${url.port ? `:${url.port}` : ""}`;
  return STUDIO_ORIGIN;
}

/**
 * The Studio origin the browser is on, from a Host header that isStudioHost
 * accepted: production, or studio.localhost with its port. Redirects on the
 * Studio host are built from this, not from the request URL: a local server
 * (next dev / next start) reports its own http://localhost:<port> as the
 * request URL whatever the Host header says, which would send the browser to
 * the admin.
 */
export function studioRequestOrigin(host: string): string {
  const name = host.trim().toLowerCase();
  if (name.replace(/:\d+$/, "") === "studio.localhost") return `http://${name}`;
  return STUDIO_ORIGIN;
}

/**
 * The Studio's sign-in page for a request on the Studio host, coming back to
 * the same path and query (a path, so it always stays on the Studio).
 */
export function studioSignInUrl(host: string, url: URL): string {
  const signIn = new URL("/sign-in", studioRequestOrigin(host));
  // One leading slash: "//host" would read as another site.
  signIn.searchParams.set("redirect_url", `${url.pathname.replace(/^\/+/, "/")}${url.search}`);
  return signIn.toString();
}

/**
 * Where a request goes. `host` is the request's Host header; `url` the
 * request URL (only its pathname and search are used; its origin only
 * locally, for the Studio's development port).
 */
export function studioRouting(host: string | null | undefined, url: URL): StudioRouting {
  const { pathname, search } = url;

  if (host && isStudioHost(host)) {
    if (isShared(pathname)) return { type: "pass" };
    const inner = underStudio(pathname);
    if (inner !== null) return { type: "redirect", url: `${studioRequestOrigin(host)}${inner}${search}` };
    return { type: "rewrite", path: `${STUDIO_PREFIX}${pathname === "/" ? "" : pathname}${search}` };
  }

  const inner = underStudio(pathname);
  if (inner !== null) return { type: "redirect", url: `${studioOriginFor(url)}${inner}${search}` };
  const moved = MOVED_TO_STUDIO[trimSlash(pathname)];
  if (moved) return { type: "redirect", url: `${studioOriginFor(url)}${moved}${search}` };
  return { type: "pass" };
}
