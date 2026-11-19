/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

// Audit C-01: media ids were not owner-checked, so any signed-in user could
// attach another listing's screenshot or video to their own submission and
// delete the file by withdrawing it.

const modules = import.meta.glob("../convex/**/*.{ts,js}");

const ENV = {
  R2_ACCOUNT_ID: "acct123",
  R2_ACCESS_KEY_ID: "AKIATEST",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "shemoqmedi-media",
  R2_PUBLIC_URL: "https://pub-test.r2.dev/",
  IMAGEKIT_URL_ENDPOINT: "https://ik.imagekit.io/x",
};

const KEY_A = "listings/paper-weather/paper-weather-website-preview-0123456789.mp4";

async function setup() {
  const t = convexTest(schema, modules);
  const user = (externalId: string, role?: "admin") =>
    t.run((ctx) =>
      ctx.db.insert("users", { externalId, name: externalId, email: `${externalId}@example.com`, role, createdAt: 0, updatedAt: 0 }),
    );
  await user("alice");
  await user("bob");
  await user("boss", "admin");
  return {
    t,
    alice: t.withIdentity({ subject: "alice" }),
    bob: t.withIdentity({ subject: "bob" }),
    admin: t.withIdentity({ subject: "boss" }),
  };
}

type Env = Awaited<ReturnType<typeof setup>>;
type Caller = Env["alice"];

let shot = 0;
/** A screenshot registered (ImageKit) by `who`. */
function registerShot(who: Caller) {
  const fileId = `shotfile${++shot}`;
  return who.mutation(api.media.register, {
    fileId,
    url: `https://ik.imagekit.io/x/listings/site/${fileId}.webp`,
    filePath: `/listings/site/${fileId}.webp`,
    kind: "image",
    contentType: "image/webp",
    size: 1000,
  });
}

function registerVideo(who: Caller, key = KEY_A) {
  return who.mutation(api.media.registerVideo, { key, contentType: "video/mp4", size: 1_000_000 });
}

let site = 0;
function input(coverId: Id<"media">, overrides: Record<string, unknown> = {}) {
  site++;
  return {
    title: `Site ${site}`,
    tagline: "A forecast you can fold.",
    url: `https://site${site}.example/`,
    category: "portfolio",
    technologies: ["Next.js"],
    creatorTier: "solo" as const,
    region: "georgia" as const,
    creditName: `Studio ${site}`,
    submissionTier: "standard" as const,
    coverId,
    ...overrides,
  };
}

async function listingId(who: Caller, slug: string) {
  const mine = await who.query(api.listings.myListings, {});
  return mine.find((l) => l.slug === slug)!.id;
}

/** Keys / file ids queued for deletion on R2 / ImageKit. */
async function queuedDeletes(t: Env["t"]) {
  const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  return jobs
    .filter((j) => j.name.includes("deleteR2") || j.name.includes("deleteRemote"))
    .flatMap((j) => {
      const arg = j.args[0] as { keys?: string[]; fileIds?: string[] };
      return [...(arg.keys ?? []), ...(arg.fileIds ?? [])];
    });
}

describe("media ownership (C-01)", () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    // Scheduled jobs (ImageKit / R2 checks and deletes) stay queued: no
    // network calls, and the test can read which files were queued for deletion.
    vi.useFakeTimers();
    vi.stubGlobal("fetch", () => Promise.reject(new Error("no network in tests")));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("user B cannot attach user A's media to a submission", async () => {
    const { alice, bob } = await setup();
    const aliceCover = await registerShot(alice);
    const aliceVideo = await registerVideo(alice);
    const bobCover = await registerShot(bob);

    await expect(bob.mutation(api.listings.submit, input(aliceCover))).rejects.toThrow(/not found/);
    await expect(bob.mutation(api.listings.submit, input(bobCover, { videoId: aliceVideo }))).rejects.toThrow(/not found/);
    await expect(bob.mutation(api.listings.submit, input(bobCover, { galleryIds: [aliceCover] }))).rejects.toThrow(/not found/);
    // His own files still work.
    await expect(bob.mutation(api.listings.submit, input(bobCover))).resolves.toMatchObject({ slug: expect.any(String) });
  });

  it("register / registerVideo by B for A's file never return A's id", async () => {
    const { t, alice, bob } = await setup();
    const aliceVideo = await registerVideo(alice);
    await expect(registerVideo(bob)).rejects.toThrow(/did not come from this site/);
    // The uploader registering again gets the same row back.
    expect(await registerVideo(alice)).toBe(aliceVideo);

    const aliceShot = await registerShot(alice);
    const row = await t.run((ctx) => ctx.db.get(aliceShot));
    await expect(
      bob.mutation(api.media.register, {
        fileId: row!.fileId,
        url: row!.url,
        filePath: row!.filePath,
        kind: "image",
        contentType: "image/webp",
        size: 1000,
      }),
    ).rejects.toThrow(/did not come from this site/);
    // No second row for the same file either (deleting it would delete A's file).
    const rows = await t.run((ctx) => ctx.db.query("media").collect());
    expect(rows.filter((r) => r.fileId === KEY_A)).toHaveLength(1);
    expect(rows.filter((r) => r.fileId === row!.fileId)).toHaveLength(1);
  });

  it("withdrawing B's listing never deletes A's media", async () => {
    const { t, alice, bob, admin } = await setup();
    const aliceVideo = await registerVideo(alice);
    const aliceCover = await registerShot(alice);
    const { slug: aSlug } = await alice.mutation(api.listings.submit, input(aliceCover, { videoId: aliceVideo }));

    // Even if B's listing points at A's files (a listing from before this
    // fix), B withdrawing it leaves them alone.
    const bobCover = await registerShot(bob);
    const { slug } = await bob.mutation(api.listings.submit, input(bobCover));
    const bobId = await listingId(bob, slug);
    const bobFile = (await t.run((ctx) => ctx.db.get(bobCover)))!.fileId;
    await t.run((ctx) => ctx.db.patch(bobId, { videoId: aliceVideo, galleryIds: [aliceCover] }));
    await bob.mutation(api.listings.withdraw, { id: bobId });

    expect(await t.run((ctx) => ctx.db.get(aliceVideo))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.get(aliceCover))).not.toBeNull();
    const bobCoverRow = await t.run((ctx) => ctx.db.get(bobCover));
    expect(bobCoverRow).toBeNull(); // B's own cover went
    expect(await queuedDeletes(t)).toEqual([bobFile]);

    const aId = await listingId(alice, aSlug);
    expect((await t.run((ctx) => ctx.db.get(aId)))!.videoId).toBe(aliceVideo);

    // A file A uploaded that no listing uses any more is still kept when B
    // withdraws (B didn't upload it).
    const orphan = await registerShot(alice);
    const { slug: s2 } = await bob.mutation(api.listings.submit, input(await registerShot(bob)));
    const b2 = await listingId(bob, s2);
    await t.run((ctx) => ctx.db.patch(b2, { galleryIds: [orphan] }));
    await bob.mutation(api.listings.withdraw, { id: b2 });
    expect(await t.run((ctx) => ctx.db.get(orphan))).not.toBeNull();

    // An admin removing A's listing still deletes its files.
    await admin.mutation(api.listings.remove, { id: aId });
    expect(await t.run((ctx) => ctx.db.get(aliceVideo))).toBeNull();
    expect(await queuedDeletes(t)).toContain(KEY_A);
  });

  it("no delete removes a file another listing still uses", async () => {
    const { t, alice, admin } = await setup();
    const shared = await registerShot(alice);
    const { slug: s1 } = await alice.mutation(api.listings.submit, input(shared));
    const { slug: s2 } = await alice.mutation(api.listings.submit, input(shared));
    await admin.mutation(api.listings.remove, { id: await listingId(alice, s1) });
    expect(await t.run((ctx) => ctx.db.get(shared))).not.toBeNull();
    // The uploader withdrawing the last listing that uses it deletes it.
    await alice.mutation(api.listings.withdraw, { id: await listingId(alice, s2) });
    expect(await t.run((ctx) => ctx.db.get(shared))).toBeNull();
  });

  it("admins can still attach any media", async () => {
    const { t, alice, admin } = await setup();
    const aliceCover = await registerShot(alice);
    const aliceVideo = await registerVideo(alice);
    // Admins may re-register anyone's file (the existing id comes back).
    expect(await registerVideo(admin)).toBe(aliceVideo);
    const { slug } = await alice.mutation(api.listings.submit, input(await registerShot(alice)));
    const id = await listingId(alice, slug);
    await admin.mutation(api.listings.replaceMedia, { id, kind: "video", storageId: aliceVideo });
    await admin.mutation(api.listings.addGalleryImage, { id, storageId: aliceCover });
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row!.videoId).toBe(aliceVideo);
    expect(row!.galleryIds).toEqual([aliceCover]);
  });
});
