/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { mediaUrl } from "../convex/lib/media";

const modules = import.meta.glob("../convex/**/*.{ts,js}");

const R2_ENV = {
  R2_ACCOUNT_ID: "acct123",
  R2_ACCESS_KEY_ID: "AKIATEST",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "shemoqmedi-media",
  R2_PUBLIC_URL: "https://pub-test.r2.dev/",
};

async function setup() {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert("users", { externalId: "maker", name: "Maker", email: "m@example.com", createdAt: 0, updatedAt: 0 }),
  );
  return { t, maker: t.withIdentity({ subject: "maker" }) };
}

const KEY = "listings/paper-weather/paper-weather-website-preview-0123456789.mp4";

describe("preview videos on R2", () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(R2_ENV)) vi.stubEnv(k, v);
    vi.stubEnv("IMAGEKIT_URL_ENDPOINT", "https://ik.imagekit.io/x");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("signs a direct upload to a server-chosen key", async () => {
    const { t, maker } = await setup();
    await expect(
      t.action(api.media.videoUploadUrl, { site: "a", label: "preview", contentType: "video/mp4", size: 10 }),
    ).rejects.toThrow(/log in/);
    const { uploadUrl, key } = await maker.action(api.media.videoUploadUrl, {
      site: "Paper Weather",
      label: "preview",
      contentType: "video/mp4",
      size: 3_000_000,
    });
    expect(key).toMatch(/^listings\/paper-weather\/paper-weather-website-preview-[a-f0-9]{10}\.mp4$/);
    const url = new URL(uploadUrl);
    expect(url.origin).toBe("https://acct123.r2.cloudflarestorage.com");
    expect(url.pathname).toBe(`/shemoqmedi-media/${key}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("refuses oversized or non-video uploads", async () => {
    const { maker } = await setup();
    await expect(
      maker.action(api.media.videoUploadUrl, { site: "a", label: "p", contentType: "video/mp4", size: 16 * 1024 * 1024 }),
    ).rejects.toThrow(/15 MB/);
    await expect(
      maker.action(api.media.videoUploadUrl, { site: "a", label: "p", contentType: "image/png", size: 10 }),
    ).rejects.toThrow(/MP4 or WebM/);
  });

  it("says so when R2 is not configured", async () => {
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "");
    const { maker } = await setup();
    await expect(
      maker.action(api.media.videoUploadUrl, { site: "a", label: "p", contentType: "video/mp4", size: 10 }),
    ).rejects.toThrow(/not configured/);
  });

  it("registers only our own keys, once, and serves them from R2_PUBLIC_URL", async () => {
    const { t, maker } = await setup();
    for (const key of ["listings/a/../b.mp4", "other/a/a.mp4", "listings/a/a.mov", "https://evil.example/x.mp4"]) {
      await expect(
        maker.mutation(api.media.registerVideo, { key, contentType: "video/mp4", size: 10 }),
      ).rejects.toThrow(/did not come from this site/);
    }
    const id = await maker.mutation(api.media.registerVideo, { key: KEY, contentType: "video/mp4", size: 10 });
    expect(await maker.mutation(api.media.registerVideo, { key: KEY, contentType: "video/mp4", size: 10 })).toBe(id);
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ store: "r2", fileId: KEY, kind: "video" });
    expect(await t.run((ctx) => mediaUrl(ctx, id))).toBe(`https://pub-test.r2.dev/${KEY}`);
    // Moving the bucket to a custom domain is one env change.
    vi.stubEnv("R2_PUBLIC_URL", "https://media.shemoqmedi.space");
    expect(await t.run((ctx) => mediaUrl(ctx, id))).toBe(`https://media.shemoqmedi.space/${KEY}`);
  });

  it("no longer accepts videos on ImageKit", async () => {
    const { maker } = await setup();
    await expect(
      maker.mutation(api.media.register, {
        fileId: "abcdef123",
        url: "https://ik.imagekit.io/x/listings/a/a.mp4",
        filePath: "/listings/a/a.mp4",
        kind: "video",
        contentType: "video/mp4",
        size: 10,
      }),
    ).rejects.toThrow(/different way/);
  });
});
