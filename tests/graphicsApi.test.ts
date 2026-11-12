/// <reference types="vite/client" />
// The graphics API around the renderer: the Studio's admin actions
// (renderForPost, finalUploadAuth, media.registerSocial), the one-request
// carousel wire format, the preview assets endpoint, the font files, and
// how screenshots are fetched. fetch is mocked: nothing leaves the test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { unpackSlides } from "../convex/graphics";
import { SLIDES_CONTENT_TYPE, packSlides } from "../lib/graphics/render";
import { deliveryUrl } from "../lib/graphics/imaging";
import { GET as assetsGET } from "../app/api/graphics/assets/route";
import { GET as fontsGET } from "../app/api/graphics/fonts/[file]/route";
import { GET as graphicGET } from "../app/api/graphics/route";
import { mintServiceCredential } from "../convex/lib/tokens";

const modules = import.meta.glob("../convex/**/*.{ts,js}");

const IK = "https://ik.imagekit.io/shemoqmedi";
const ORIGIN = "https://admin.example.test";
const KEY = "render-key-for-tests";

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { externalId: "admin", name: "Admin", email: "a@example.com", role: "admin", createdAt: 0, updatedAt: 0 });
    await ctx.db.insert("users", { externalId: "maker", name: "Maker", email: "m@example.com", createdAt: 0, updatedAt: 0 });
  });
  return { t, admin: t.withIdentity({ subject: "admin" }), maker: t.withIdentity({ subject: "maker" }) };
}

type Call = { url: URL; headers: Headers; method: string };

/** The admin app's render routes and ImageKit's upload API, faked. */
function fakeServices() {
  const calls: Call[] = [];
  let uploads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      calls.push({ url, headers: req.headers, method: req.method });
      if (url.origin === ORIGIN && url.pathname === "/api/graphics") {
        return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { headers: { "Content-Type": "image/jpeg" } });
      }
      if (url.origin === ORIGIN && url.pathname === "/api/graphics/carousel") {
        const files = ["hook", "site", "cta"].map((name) => Buffer.from(`jpeg:${name}`));
        const body = packSlides(files, ["hook", "site", "cta"], { width: 1080, height: 1350, type: "image/jpeg" });
        return new Response(new Uint8Array(body), { headers: { "Content-Type": SLIDES_CONTENT_TYPE } });
      }
      if (url.host === "upload.imagekit.io") {
        uploads++;
        return Response.json({ fileId: `file_${uploads}_abcdef`, url: `${IK}/social/graphics/f${uploads}.jpg`, filePath: `/social/graphics/f${uploads}.jpg`, size: 2048, width: 1080, height: 1350 });
      }
      return new Response("not found", { status: 404 });
    }),
  );
  return calls;
}

beforeEach(() => {
  vi.stubEnv("ADMIN_ORIGIN", ORIGIN);
  vi.stubEnv("GRAPHICS_RENDER_KEY", KEY);
  vi.stubEnv("IMAGEKIT_PRIVATE_KEY", "private_test");
  vi.stubEnv("IMAGEKIT_PUBLIC_KEY", "public_test");
  vi.stubEnv("IMAGEKIT_URL_ENDPOINT", IK);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("MCP render tools", () => {
  async function mcp() {
    vi.stubEnv("MCP_SERVICE_SECRET", "test-secret-test-secret-test-secret");
    const env = await setup();
    return { ...env, token: (await mintServiceCredential("admin"))! };
  }

  it("render_graphic forwards the style and returns the graphic's size", async () => {
    const { t, token } = await mcp();
    const calls = fakeServices();
    const out = await t.action(api.mcp.renderGraphic, { token, template: "award", format: "story", palette: "egypt", style: "kinetic", fields: { title: "Floema" } });
    expect(out).toEqual({ url: `${IK}/social/graphics/f1.jpg`, mediaId: expect.any(String), width: 1080, height: 1920 });
    expect(calls.find((c) => c.url.pathname === "/api/graphics")!.url.searchParams.get("style")).toBe("kinetic");
    await expect(t.action(api.mcp.renderGraphic, { token, template: "award", format: "story", palette: "egypt", style: "brutal" })).rejects.toThrow(/Unknown style/);
  });

  it("render_carousel forwards the style in its one request", async () => {
    const { t, token } = await mcp();
    const calls = fakeServices();
    const out = await t.action(api.mcp.renderCarousel, { token, facts: { title: "Floema", studio: "Studio" }, palette: "egypt", style: "bento" });
    expect(out.urls).toHaveLength(3);
    const renders = calls.filter((c) => c.url.origin === ORIGIN);
    expect(renders).toHaveLength(1);
    expect(renders[0].url.searchParams.get("style")).toBe("bento");
  });
});

describe("graphics.renderForPost", () => {
  const args = { template: "award", format: "square", palette: "egypt", style: "swiss", fields: { title: "Floema", tier: "SOTD" } };

  it("is for admins only", async () => {
    const { t, maker } = await setup();
    const calls = fakeServices();
    await expect(t.action(api.graphics.renderForPost, args)).rejects.toThrow();
    await expect(maker.action(api.graphics.renderForPost, args)).rejects.toThrow(/admin/);
    expect(calls).toHaveLength(0);
  });

  it("renders one graphic with the style, stores it and reports its size", async () => {
    const { admin } = await setup();
    const calls = fakeServices();
    const out = await admin.action(api.graphics.renderForPost, args);
    expect(out.urls).toEqual([`${IK}/social/graphics/f1.jpg`]);
    expect(out.mediaIds).toHaveLength(1);
    expect([out.width, out.height]).toEqual([1080, 1080]);
    const render = calls.find((c) => c.url.pathname === "/api/graphics")!;
    expect(render.url.searchParams.get("style")).toBe("swiss");
    expect(render.url.searchParams.get("title")).toBe("Floema");
    expect(render.headers.get("x-render-key")).toBe(KEY);
  });

  it("renders a whole carousel in one request", async () => {
    const { admin } = await setup();
    const calls = fakeServices();
    const out = await admin.action(api.graphics.renderForPost, { ...args, carousel: true, style: "magazine" });
    const renders = calls.filter((c) => c.url.origin === ORIGIN);
    expect(renders).toHaveLength(1);
    expect(renders[0].url.searchParams.get("slide")).toBe("all");
    expect(renders[0].url.searchParams.get("style")).toBe("magazine");
    expect(out.urls).toHaveLength(3);
    expect([out.width, out.height]).toEqual([1080, 1350]);
    expect(calls.filter((c) => c.url.host === "upload.imagekit.io")).toHaveLength(3);
  });

  it("refuses unknown styles before rendering", async () => {
    const { admin } = await setup();
    const calls = fakeServices();
    await expect(admin.action(api.graphics.renderForPost, { ...args, style: "brutal" })).rejects.toThrow(/Unknown style/);
    expect(calls).toHaveLength(0);
  });
});

describe("the Studio's own upload", () => {
  it("signs uploads into /social/graphics for admins only", async () => {
    const { t, admin, maker } = await setup();
    await expect(t.action(api.graphics.finalUploadAuth, {})).rejects.toThrow();
    await expect(maker.action(api.graphics.finalUploadAuth, {})).rejects.toThrow(/admin/);
    const auth = await admin.action(api.graphics.finalUploadAuth, {});
    expect(auth.folder).toBe("/social/graphics");
    expect(auth.publicKey).toBe("public_test");
    expect(auth.signature).toMatch(/^[a-f0-9]{40}$/);
  });

  it("registers only JPEG/PNG files from the social graphics folder", async () => {
    const { t, admin, maker } = await setup();
    const file = { url: `${IK}/social/graphics/final_x.jpg`, fileId: "file_abcdef", filePath: "/social/graphics/final_x.jpg", size: 300_000, width: 1080, height: 1350, contentType: "image/jpeg" };
    await expect(maker.mutation(api.media.registerSocial, file)).rejects.toThrow(/admin/);
    await expect(admin.mutation(api.media.registerSocial, { ...file, url: `${IK}/listings/x/a.jpg`, filePath: "/listings/x/a.jpg" })).rejects.toThrow(/social graphics folder/);
    await expect(admin.mutation(api.media.registerSocial, { ...file, contentType: "image/gif" })).rejects.toThrow(/JPEG or PNG/);
    const id = await admin.mutation(api.media.registerSocial, file);
    expect(await admin.mutation(api.media.registerSocial, file)).toBe(id);
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row).toMatchObject({ kind: "image", url: file.url, width: 1080, height: 1350 });
  });
});

describe("media.verify for the Studio's uploads", () => {
  function fakeDetails(filePath: string) {
    const calls: { url: string; method: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input instanceof Request ? input.url : input), method: init?.method ?? "GET" });
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        return Response.json({ size: 200_000, mime: "image/jpeg", filePath });
      }),
    );
    return calls;
  }

  async function registered() {
    const { t, admin } = await setup();
    const file = { url: `${IK}/social/graphics/final_v.jpg`, fileId: "file_verify1", filePath: "/social/graphics/final_v.jpg", size: 200_000, width: 1080, height: 1350, contentType: "image/jpeg" };
    const id = await admin.mutation(api.media.registerSocial, file);
    return { t, id, fileId: file.fileId };
  }

  it("keeps a file ImageKit really holds in /social/graphics", async () => {
    const { t, id, fileId } = await registered();
    const calls = fakeDetails("/social/graphics/final_v.jpg");
    await t.action(internal.media.verify, { id, fileId, kind: "image", folder: "/social/graphics/" });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect((await t.run((ctx) => ctx.db.get(id)))?.invalid).toBeFalsy();
  });

  it("flags and deletes a file that is really somewhere else", async () => {
    const { t, id, fileId } = await registered();
    const calls = fakeDetails("/listings/someone/else.jpg");
    await t.action(internal.media.verify, { id, fileId, kind: "image", folder: "/social/graphics/" });
    expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1);
    expect((await t.run((ctx) => ctx.db.get(id)))?.invalid).toBe(true);
  });
});

describe("the carousel's wire format", () => {
  it("packs and unpacks every slide in order", () => {
    const files = [Buffer.from("first"), Buffer.from("second slide"), Buffer.from("3")];
    const body = packSlides(files, ["hook", "site", "cta"], { width: 1080, height: 1350, type: "image/jpeg" });
    const ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
    const out = unpackSlides(ab);
    expect(out.slides.map((s) => s.name)).toEqual(["hook", "site", "cta"]);
    expect([out.width, out.height]).toEqual([1080, 1350]);
    expect(out.slides.map((s) => s.blob.size)).toEqual([5, 12, 1]);
    expect(() => unpackSlides(ab.slice(0, ab.byteLength - 1))).toThrow(/Malformed/);
    const noSize = packSlides(files, ["hook", "site", "cta"], { width: 0, height: 1350, type: "image/jpeg" });
    expect(() => unpackSlides(noSize.buffer.slice(noSize.byteOffset, noSize.byteOffset + noSize.byteLength) as ArrayBuffer)).toThrow(/Malformed/);
  });
});

describe("routes", () => {
  const req = (path: string, key?: string) => new NextRequest(`http://localhost${path}`, { headers: key === undefined ? {} : { "x-render-key": key } });

  it("judge a request that carries a render key by the key alone", async () => {
    vi.stubEnv("GRAPHICS_RENDER_KEY", KEY);
    expect((await graphicGET(req("/api/graphics?template=award", "wrong"))).status).toBe(401);
    expect((await assetsGET(req("/api/graphics/assets?palette=egypt", "wrong"))).status).toBe(401);
    // No key and no session.
    expect((await assetsGET(req("/api/graphics/assets?palette=egypt"))).status).toBe(401);
    expect((await graphicGET(req("/api/graphics?template=award&style=brutal", KEY))).status).toBe(400);
  });

  it("assets: palette, glass layers and the screenshot, cached by the browser", async () => {
    const jpeg = await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#D0202A" } }).jpeg().toBuffer();
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        fetched.push(String(input instanceof Request ? input.url : input));
        return new Response(new Uint8Array(jpeg), { headers: { "Content-Type": "image/jpeg" } });
      }),
    );
    const shot = `${IK}/listings/floema/cover-assets-test.webp`;
    const res = await assetsGET(req(`/api/graphics/assets?shot=${encodeURIComponent(shot)}&palette=auto&glass=frost&format=square`, KEY));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=600");
    const body = (await res.json()) as { palette: { base: string }; light: boolean; back: string; frost: string; shot: string };
    expect(body.palette.base).toMatch(/^#[0-9A-F]{6}$/);
    expect(typeof body.light).toBe("boolean");
    expect(body.back).toMatch(/^data:image\/jpeg;base64,/);
    expect(body.frost).toMatch(/^data:image\/jpeg;base64,/);
    // A 1600 px JPEG is drawn as delivered: no re-encode.
    expect(body.shot).toBe(`data:image/jpeg;base64,${jpeg.toString("base64")}`);
    // ImageKit was asked for a 1600 px JPEG, not the stored WebP.
    expect(fetched).toHaveLength(1);
    expect(new URL(fetched[0]).searchParams.get("tr")).toBe("w-1600,f-jpg");
  });

  it("fonts: only the listed files", async () => {
    const ok = await fontsGET(new Request("http://localhost/x"), { params: Promise.resolve({ file: "instrument-serif-latin-400-italic.woff" }) });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("font/woff");
    expect((await ok.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    const no = await fontsGET(new Request("http://localhost/x"), { params: Promise.resolve({ file: "..%2F.env.local" }) });
    expect(no.status).toBe(404);
  });
});

describe("screenshot delivery", () => {
  it("asks ImageKit for a 1600 px JPEG and leaves other hosts and transforms alone", () => {
    expect(deliveryUrl(`${IK}/listings/a/b.webp`).searchParams.get("tr")).toBe("w-1600,f-jpg");
    expect(deliveryUrl(`${IK}/listings/a/b.webp?tr=w-400`).searchParams.get("tr")).toBe("w-400");
    expect(deliveryUrl(`${IK}/tr:w-300/listings/a/b.webp`).searchParams.has("tr")).toBe(false);
    expect(deliveryUrl("https://quiet-owl.convex.cloud/api/storage/abc").searchParams.has("tr")).toBe(false);
    // Not a screenshot (a badge may be a transparent PNG): fetched as stored.
    expect(deliveryUrl(`${IK}/badges/seal.png`, false).searchParams.has("tr")).toBe(false);
  });

  it("fetches an award badge from ImageKit as stored, and the screenshot as a JPEG", async () => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const fetched: string[] = [];
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        // The renderer loads its own wasm and fonts from disk with fetch: let those through.
        if (!url.startsWith("https:")) return realFetch(input, init);
        fetched.push(url);
        return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
      }),
    );
    const shot = `${IK}/listings/floema/cover-badge-test.webp`;
    const badge = `${IK}/badges/badge-test-seal.png`;
    const res = await graphicGET(
      new NextRequest(`http://localhost/api/graphics?template=award&format=square&style=swiss&screenshot=${encodeURIComponent(shot)}&badge=${encodeURIComponent(badge)}`, { headers: { "x-render-key": KEY } }),
    );
    expect(res.status).toBe(200);
    const byPath = (part: string) => new URL(fetched.find((u) => u.includes(part))!);
    expect(byPath("cover-badge-test").searchParams.get("tr")).toBe("w-1600,f-jpg");
    expect(byPath("badge-test-seal").searchParams.has("tr")).toBe(false);
  }, 30_000);
});
