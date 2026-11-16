// The team docs host, decided from host and path alone so proxy.ts stays thin
// and this can be unit tested (tests/docsRouting.test.ts). Same shape as
// lib/studioRouting.ts:
//
//   Docs host (docs.shemoqmedi.space, docs.localhost in development): every
//   page path /x is served by app/docs/x (a rewrite: the address bar keeps
//   /x). Clerk's sign-in pages, /api/*, Next internals and files are served
//   as they are. /docs/x typed on the docs host goes to /x.
//
//   Any other host: /docs and /docs/* move to the docs host.
//
// Docs rewrites always need a signed-in session (proxy.ts), and every docs
// page checks the admin role on the server (lib/docsAccess.ts) before any
// of its text is rendered.

import { DOCS_ORIGIN, isDocsHost } from "./hosts";

export type DocsRouting =
  | { type: "pass" }
  | { type: "rewrite"; path: string }
  | { type: "redirect"; url: string };

const DOCS_PREFIX = "/docs";
const SHARED_PREFIXES = ["/api/", "/sign-in", "/sign-up", "/sso-callback", "/.well-known", "/_", "/icons/", "/fonts"];
const SHARED_FILES = new Set(["/api", "/sw.js", "/manifest.webmanifest"]);

function isShared(pathname: string) {
  if (SHARED_FILES.has(pathname)) return true;
  if (SHARED_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  return /\.[a-z0-9]+$/i.test(last);
}

/** "/docs/awards" → "/awards", "/docs" → "/"; null when the path isn't under /docs. */
function underDocs(pathname: string): string | null {
  if (pathname === DOCS_PREFIX || pathname === `${DOCS_PREFIX}/`) return "/";
  // One leading slash, so "/docs//evil.com" can never become a protocol-relative link.
  if (pathname.startsWith(`${DOCS_PREFIX}/`)) return pathname.slice(DOCS_PREFIX.length).replace(/^\/+/, "/");
  return null;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The docs origin as seen from a request URL: production, or docs.localhost on the same port locally. */
export function docsOriginFor(url: URL): string {
  if (LOCAL_HOSTS.has(url.hostname)) return `http://docs.localhost${url.port ? `:${url.port}` : ""}`;
  return DOCS_ORIGIN;
}

/** The docs origin the browser is on, from a Host header isDocsHost accepted. */
export function docsRequestOrigin(host: string): string {
  const name = host.trim().toLowerCase();
  if (name.replace(/:\d+$/, "") === "docs.localhost") return `http://${name}`;
  return DOCS_ORIGIN;
}

/** The sign-in page on the docs host, coming back to the same path and query. */
export function docsSignInUrl(host: string, url: URL): string {
  const signIn = new URL("/sign-in", docsRequestOrigin(host));
  signIn.searchParams.set("redirect_url", `${url.pathname.replace(/^\/+/, "/")}${url.search}`);
  return signIn.toString();
}

export function docsRouting(host: string | null | undefined, url: URL): DocsRouting {
  const { pathname, search } = url;

  if (host && isDocsHost(host)) {
    if (isShared(pathname)) return { type: "pass" };
    const inner = underDocs(pathname);
    if (inner !== null) return { type: "redirect", url: `${docsRequestOrigin(host)}${inner}${search}` };
    return { type: "rewrite", path: `${DOCS_PREFIX}${pathname === "/" ? "" : pathname}${search}` };
  }

  const inner = underDocs(pathname);
  if (inner !== null) return { type: "redirect", url: `${docsOriginFor(url)}${inner}${search}` };
  return { type: "pass" };
}
