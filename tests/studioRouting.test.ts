// Host routing between the Studio and the admin (lib/studioRouting.ts, used
// by proxy.ts): Studio rewrites, the paths both hosts share, and the admin's
// redirects to the Studio.
import { describe, expect, it } from "vitest";
import { MOVED_TO_STUDIO, studioOriginFor, studioRequestOrigin, studioRouting, studioSignInUrl } from "../lib/studioRouting";

const STUDIO = "studio.shemoqmedi.space";
const ADMIN = "admin.shemoqmedi.space";

/** The decision for a request to `path` (with its query) on `host`. */
function route(host: string | null, path: string) {
  const origin = host && !host.startsWith("localhost") && !host.startsWith("127.") && !host.startsWith("studio.localhost") ? `https://${host}` : `http://${host ?? "localhost:3000"}`;
  // Concatenated, not resolved: "//x" must stay a path, as a request line would give it.
  return studioRouting(host, new URL(`${origin}${path}`));
}

describe("the Studio host", () => {
  it("rewrites every page to /studio/<path>, keeping the query", () => {
    expect(route(STUDIO, "/")).toEqual({ type: "rewrite", path: "/studio" });
    expect(route(STUDIO, "/queue")).toEqual({ type: "rewrite", path: "/studio/queue" });
    expect(route(STUDIO, "/queue?post=abc&tab=failed")).toEqual({ type: "rewrite", path: "/studio/queue?post=abc&tab=failed" });
    expect(route(STUDIO, "/create/award/x")).toEqual({ type: "rewrite", path: "/studio/create/award/x" });
    expect(route(STUDIO, "/reels")).toEqual({ type: "rewrite", path: "/studio/reels" });
    expect(route(STUDIO, "/reminders")).toEqual({ type: "rewrite", path: "/studio/reminders" });
    // Admin pages don't exist on the Studio host: they become (missing) Studio pages, never the admin.
    expect(route(STUDIO, "/dashboard")).toEqual({ type: "rewrite", path: "/studio/dashboard" });
    expect(route(STUDIO, "/review/abc")).toEqual({ type: "rewrite", path: "/studio/review/abc" });
    expect(route(STUDIO, "/social")).toEqual({ type: "rewrite", path: "/studio/social" });
  });

  it("matches the host case-insensitively and with any port", () => {
    expect(route("STUDIO.Shemoqmedi.Space", "/queue")).toEqual({ type: "rewrite", path: "/studio/queue" });
    expect(route("studio.shemoqmedi.space:443", "/queue")).toEqual({ type: "rewrite", path: "/studio/queue" });
    expect(route("studio.localhost:3000", "/queue")).toEqual({ type: "rewrite", path: "/studio/queue" });
  });

  it("serves the shared paths as they are", () => {
    for (const path of [
      "/api/mcp",
      "/api/graphics/assets?shot=x",
      "/api/graphics/fonts/inter-400.woff",
      "/api",
      "/sign-in",
      "/sign-in/factor-one",
      "/sign-in/sso-callback",
      "/sign-up",
      "/sign-up/verify-email-address",
      "/sso-callback",
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource/api/mcp",
      "/_next/static/chunks/app.js",
      "/_next/image?url=x",
      "/__nextjs_original-stack-frame",
      "/sw.js",
      "/manifest.webmanifest",
      "/icons/crow-192.png",
      "/fonts/inter.woff2",
      "/robots.txt",
      "/favicon.ico",
      "/logo.png",
    ]) {
      expect(route(STUDIO, path), path).toEqual({ type: "pass" });
    }
  });

  it("does not treat look-alike prefixes as shared", () => {
    expect(route(STUDIO, "/apis")).toEqual({ type: "rewrite", path: "/studio/apis" });
    expect(route(STUDIO, "/iconsx")).toEqual({ type: "rewrite", path: "/studio/iconsx" });
    expect(route(STUDIO, "/sw")).toEqual({ type: "rewrite", path: "/studio/sw" });
  });

  it("sends /studio/<path> to its one address, /<path>", () => {
    expect(route(STUDIO, "/studio")).toEqual({ type: "redirect", url: "https://studio.shemoqmedi.space/" });
    expect(route(STUDIO, "/studio/")).toEqual({ type: "redirect", url: "https://studio.shemoqmedi.space/" });
    expect(route(STUDIO, "/studio/queue?post=1")).toEqual({ type: "redirect", url: "https://studio.shemoqmedi.space/queue?post=1" });
    expect(route("studio.localhost:3000", "/studio/reels")).toEqual({ type: "redirect", url: "http://studio.localhost:3000/reels" });
  });

  it("redirects on the host the browser is on, not the request URL's origin", () => {
    // next dev / next start report http://localhost:<port> as the request URL whatever the Host header says.
    const local = new URL("http://localhost:3000/studio/reels?x=1");
    expect(studioRouting("studio.localhost:3000", local)).toEqual({ type: "redirect", url: "http://studio.localhost:3000/reels?x=1" });
    expect(studioRouting(STUDIO, new URL("http://localhost:3000/studio/queue"))).toEqual({ type: "redirect", url: "https://studio.shemoqmedi.space/queue" });
  });

  it("never redirects off the host through extra slashes", () => {
    const r = route(STUDIO, "/studio//evil.example/x");
    expect(r).toEqual({ type: "redirect", url: "https://studio.shemoqmedi.space/evil.example/x" });
    expect(new URL((r as { url: string }).url).host).toBe(STUDIO);
    // Still a path on this host: a Studio page, or (with a dot, like a file) served as is.
    expect(route(STUDIO, "//evil")).toEqual({ type: "rewrite", path: "/studio//evil" });
    expect(route(STUDIO, "//evil.example")).toEqual({ type: "pass" });
  });

  it("only the Studio's own names count as the Studio", () => {
    for (const host of ["studio.example.com", "studio.shemoqmedi.space.evil.com", "xstudio.shemoqmedi.space", "shemoqmedi.space"]) {
      expect(route(host, "/queue"), host).toEqual({ type: "pass" });
    }
  });
});

describe("the admin host", () => {
  it("leaves admin pages, the API and sign-in alone", () => {
    for (const path of ["/", "/dashboard", "/review/abc", "/settings", "/api/mcp", "/sign-in", "/socialite", "/designs", "/social-media", "/studios"]) {
      expect(route(ADMIN, path), path).toEqual({ type: "pass" });
    }
  });

  it("moves /studio and /studio/* to the Studio host, keeping the path and query", () => {
    expect(route(ADMIN, "/studio")).toEqual({ type: "redirect", url: "https://studio.shemoqmedi.space/" });
    expect(route(ADMIN, "/studio/")).toEqual({ type: "redirect", url: "https://studio.shemoqmedi.space/" });
    expect(route(ADMIN, "/studio/queue")).toEqual({ type: "redirect", url: "https://studio.shemoqmedi.space/queue" });
    expect(route(ADMIN, "/studio/create?style=swiss")).toEqual({ type: "redirect", url: "https://studio.shemoqmedi.space/create?style=swiss" });
    expect(route(ADMIN, "/studio//evil.example")).toEqual({ type: "redirect", url: "https://studio.shemoqmedi.space/evil.example" });
  });

  it("sends the pages that moved to their Studio counterparts, keeping the query", () => {
    expect(route(ADMIN, "/social")).toEqual({ type: "redirect", url: "https://studio.shemoqmedi.space/queue" });
    expect(route(ADMIN, "/social?status=failed")).toEqual({ type: "redirect", url: "https://studio.shemoqmedi.space/queue?status=failed" });
    expect(route(ADMIN, "/social/")).toEqual({ type: "redirect", url: "https://studio.shemoqmedi.space/queue" });
    expect(route(ADMIN, "/design")).toEqual({ type: "redirect", url: "https://studio.shemoqmedi.space/create" });
    expect(route(ADMIN, "/design?template=award")).toEqual({ type: "redirect", url: "https://studio.shemoqmedi.space/create?template=award" });
    expect(route(ADMIN, "/voiceover")).toEqual({ type: "redirect", url: "https://studio.shemoqmedi.space/reels" });
    expect(route(ADMIN, "/voiceover?listing=paper")).toEqual({ type: "redirect", url: "https://studio.shemoqmedi.space/reels?listing=paper" });
    expect(Object.keys(MOVED_TO_STUDIO).sort()).toEqual(["/design", "/social", "/voiceover"]);
  });

  it("treats any other host (previews, a missing Host header) as the admin", () => {
    expect(route("shemoqmedi-admin-git-main.vercel.app", "/social")).toEqual({ type: "redirect", url: "https://studio.shemoqmedi.space/queue" });
    expect(route(null, "/dashboard")).toEqual({ type: "pass" });
    expect(route(null, "/studio/queue")).toEqual({ type: "redirect", url: "http://studio.localhost:3000/queue" });
  });

  it("sends local development to studio.localhost on the same port", () => {
    expect(route("localhost:3000", "/studio/queue")).toEqual({ type: "redirect", url: "http://studio.localhost:3000/queue" });
    expect(route("127.0.0.1:4000", "/design")).toEqual({ type: "redirect", url: "http://studio.localhost:4000/create" });
  });
});

describe("studioRequestOrigin and studioSignInUrl", () => {
  it("builds the Studio origin from the Host header", () => {
    expect(studioRequestOrigin("studio.shemoqmedi.space")).toBe("https://studio.shemoqmedi.space");
    expect(studioRequestOrigin("Studio.Shemoqmedi.Space:443")).toBe("https://studio.shemoqmedi.space");
    expect(studioRequestOrigin("studio.localhost:3000")).toBe("http://studio.localhost:3000");
    expect(studioRequestOrigin("studio.localhost")).toBe("http://studio.localhost");
  });

  it("signs in on the Studio host and comes back to the same path", () => {
    const local = new URL("http://localhost:3000/queue?status=failed&post=abc");
    const url = new URL(studioSignInUrl("studio.localhost:3000", local));
    expect(url.origin).toBe("http://studio.localhost:3000");
    expect(url.pathname).toBe("/sign-in");
    expect(url.searchParams.get("redirect_url")).toBe("/queue?status=failed&post=abc");
    const prod = new URL(studioSignInUrl(STUDIO, new URL("https://studio.shemoqmedi.space/")));
    expect(prod.origin).toBe("https://studio.shemoqmedi.space");
    expect(prod.searchParams.get("redirect_url")).toBe("/");
  });

  it("never comes back to another site", () => {
    const url = new URL(studioSignInUrl(STUDIO, new URL("https://studio.shemoqmedi.space//evil.example/x")));
    expect(url.searchParams.get("redirect_url")).toBe("/evil.example/x");
  });
});

describe("studioOriginFor", () => {
  it("is production for deployed hosts and studio.localhost locally", () => {
    expect(studioOriginFor(new URL("https://admin.shemoqmedi.space/x"))).toBe("https://studio.shemoqmedi.space");
    expect(studioOriginFor(new URL("https://preview.vercel.app/x"))).toBe("https://studio.shemoqmedi.space");
    expect(studioOriginFor(new URL("http://localhost:3000/x"))).toBe("http://studio.localhost:3000");
    expect(studioOriginFor(new URL("http://localhost/x"))).toBe("http://studio.localhost");
    expect(studioOriginFor(new URL("http://[::1]:3000/x"))).toBe("http://studio.localhost:3000");
  });
});
