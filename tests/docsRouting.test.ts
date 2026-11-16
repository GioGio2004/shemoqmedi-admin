// Host routing for the team docs (lib/docsRouting.ts, used by proxy.ts).
import { describe, expect, it } from "vitest";
import { docsOriginFor, docsRouting, docsSignInUrl } from "../lib/docsRouting";
import { isDocsHost } from "../lib/hosts";

function route(host: string, path: string) {
  const local = host.startsWith("localhost") || host.startsWith("docs.localhost");
  return docsRouting(host, new URL(`${local ? "http" : "https"}://${host}${path}`));
}

describe("the docs host", () => {
  it("rewrites every page to /docs/<path>, keeping the query", () => {
    expect(route("docs.shemoqmedi.space", "/")).toEqual({ type: "rewrite", path: "/docs" });
    expect(route("docs.shemoqmedi.space", "/awards")).toEqual({ type: "rewrite", path: "/docs/awards" });
    expect(route("docs.shemoqmedi.space", "/awards?x=1")).toEqual({ type: "rewrite", path: "/docs/awards?x=1" });
    expect(route("DOCS.shemoqmedi.space:443", "/mcp")).toEqual({ type: "rewrite", path: "/docs/mcp" });
    expect(route("docs.localhost:3000", "/mcp")).toEqual({ type: "rewrite", path: "/docs/mcp" });
  });

  it("serves sign-in, the API, Next internals and files as they are", () => {
    for (const path of ["/sign-in", "/sign-in/factor-one", "/sso-callback", "/api/mcp", "/_next/static/x.js", "/icons/crow-mark.png", "/robots.txt", "/manifest.webmanifest"]) {
      expect(route("docs.shemoqmedi.space", path)).toEqual({ type: "pass" });
    }
  });

  it("sends /docs/x typed on the docs host to /x, never off-site", () => {
    expect(route("docs.shemoqmedi.space", "/docs/awards")).toEqual({ type: "redirect", url: "https://docs.shemoqmedi.space/awards" });
    expect(route("docs.shemoqmedi.space", "/docs")).toEqual({ type: "redirect", url: "https://docs.shemoqmedi.space/" });
    expect(route("docs.shemoqmedi.space", "/docs//evil")).toEqual({ type: "redirect", url: "https://docs.shemoqmedi.space/evil" });
  });

  it("signs in on the docs host and comes back to the same page", () => {
    const url = new URL("http://localhost:3000/awards?x=1");
    expect(docsSignInUrl("docs.localhost:3000", url)).toBe("http://docs.localhost:3000/sign-in?redirect_url=%2Fawards%3Fx%3D1");
    expect(docsSignInUrl("docs.shemoqmedi.space", url)).toBe("https://docs.shemoqmedi.space/sign-in?redirect_url=%2Fawards%3Fx%3D1");
  });
});

describe("other hosts", () => {
  it("move /docs to the docs host", () => {
    expect(route("admin.shemoqmedi.space", "/docs/awards")).toEqual({ type: "redirect", url: "https://docs.shemoqmedi.space/awards" });
    expect(route("localhost:3000", "/docs")).toEqual({ type: "redirect", url: "http://docs.localhost:3000/" });
    expect(docsOriginFor(new URL("http://127.0.0.1:4000/x"))).toBe("http://docs.localhost:4000");
  });

  it("leave everything else alone", () => {
    expect(route("admin.shemoqmedi.space", "/dashboard")).toEqual({ type: "pass" });
    expect(route("admin.shemoqmedi.space", "/documents")).toEqual({ type: "pass" });
  });

  it("only the real docs names count as the docs host", () => {
    expect(isDocsHost("docs.shemoqmedi.space")).toBe(true);
    expect(isDocsHost("docs.localhost:3000")).toBe(true);
    expect(isDocsHost("docs.example.com")).toBe(false);
    expect(isDocsHost("docs.shemoqmedi.space.evil.com")).toBe(false);
    expect(isDocsHost(null)).toBe(false);
  });
});
