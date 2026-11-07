/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const DAY = 24 * 60 * 60 * 1000;
const p = (n: number) => ({ design: n, usability: n, creativity: n, code: n });

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const ids = await t.run(async (ctx) => {
    const mk = (externalId: string, role?: "admin" | "super_admin") =>
      ctx.db.insert("users", {
        externalId,
        name: externalId,
        email: `${externalId}@example.com`,
        role,
        createdAt: now,
        updatedAt: now,
      });
    return {
      owner: await mk("owner", "super_admin"),
      helper: await mk("helper", "admin"),
      member: await mk("member"),
    };
  });
  return {
    t,
    ids,
    owner: t.withIdentity({ subject: "owner" }),
    helper: t.withIdentity({ subject: "helper" }),
    member: t.withIdentity({ subject: "member" }),
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

async function create(env: Env, overrides: Record<string, unknown> = {}) {
  const coverId = await env.t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/jpeg" })));
  return env.owner.mutation(api.admin.createListing, {
    title: "Floema",
    tagline: "Furniture, quietly.",
    url: "https://floema.pt",
    category: "architecture",
    technologies: ["WebGL", "GSAP"],
    region: "global",
    creatorTier: "agency",
    creditName: "Bürocratik",
    coverId,
    status: "in_voting",
    isClaimed: false,
    ...overrides,
  });
}

describe("admin: listings", () => {
  it("is admin-only", async () => {
    const env = await setup();
    const coverId = await env.t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/png" })));
    await expect(
      env.member.mutation(api.admin.createListing, {
        title: "x", tagline: "", url: "https://x.com", category: "other", technologies: [],
        region: "global", creatorTier: "solo", creditName: "x", coverId, status: "pending", isClaimed: false,
      }),
    ).rejects.toThrow(/admin/);
    await expect(env.member.query(api.admin.listUsers, {})).rejects.toThrow(/admin/);
    await expect(env.member.query(api.admin.listCreators, {})).rejects.toThrow(/admin/);
  });

  it("creates a live listing with a 7-day window and jury score", async () => {
    const env = await setup();
    const { slug } = await create(env, { editorialScores: p(8.4) });
    const pub = await env.t.query(api.listings.getPublicBySlug, { slug });
    expect(pub).toMatchObject({ status: "in_voting", finalScore: 8.4, isClaimed: false, technologies: ["WebGL", "GSAP"] });
    expect(pub!.votingEndsAt - Date.now()).toBeGreaterThan(6.9 * DAY);
  });

  it("creates awarded listings only with an award, and duplicates are refused", async () => {
    const env = await setup();
    await expect(create(env, { status: "awarded" })).rejects.toThrow(/at least one award/);
    const { slug } = await create(env, { status: "awarded", awards: ["SOTD"], editorialScores: p(9) });
    expect(await env.t.query(api.listings.getPublicBySlug, { slug })).toMatchObject({ status: "awarded", awards: ["SOTD"] });
    await expect(create(env, { title: "Other" })).rejects.toThrow(/already uses this website/);
  });

  it("edits fields, slug and creator", async () => {
    const env = await setup();
    const { id } = await create(env);
    const out = await env.owner.mutation(api.admin.updateListing, {
      id, title: "Floema Furniture", slug: "floema-furniture", creditName: "Studio X", technologies: ["Three.js"], creditUrl: "studio-x.com",
    });
    expect(out.slug).toBe("floema-furniture");
    const pub = await env.t.query(api.listings.getPublicBySlug, { slug: "floema-furniture" });
    expect(pub).toMatchObject({
      title: "Floema Furniture",
      creditName: "Studio X",
      creditUrl: "https://studio-x.com",
      technologies: ["Three.js"],
      creator: { slug: "studio-x" },
    });
    await create(env, { url: "https://another.site", title: "Another" });
    await expect(env.owner.mutation(api.admin.updateListing, { id, slug: "another" })).rejects.toThrow(/already taken/);
  });

  it("lifecycle overrides: award, archive, reopen voting, reject", async () => {
    const env = await setup();
    const { id, slug } = await create(env, { editorialScores: p(8) });
    await expect(env.owner.mutation(api.admin.setLifecycle, { id, status: "awarded" })).rejects.toThrow(/award/);
    await env.owner.mutation(api.admin.setLifecycle, { id, status: "awarded", awards: ["HM", "BSC"] });
    expect(await env.t.query(api.listings.getPublicBySlug, { slug })).toMatchObject({ status: "awarded", awards: ["HM", "BSC"] });

    await env.owner.mutation(api.admin.setLifecycle, { id, status: "archived" });
    expect(await env.t.query(api.listings.getPublicBySlug, { slug })).toMatchObject({ status: "archived", awards: [] });

    const ends = Date.now() + 3 * DAY;
    await env.owner.mutation(api.admin.setLifecycle, { id, status: "in_voting", votingEndsAt: ends });
    expect((await env.t.query(api.listings.getPublicBySlug, { slug }))!.votingEndsAt).toBe(ends);
    await expect(
      env.owner.mutation(api.admin.setLifecycle, { id, status: "in_voting", votingEndsAt: Date.now() - 1 }),
    ).rejects.toThrow(/future/);

    await expect(env.owner.mutation(api.admin.setLifecycle, { id, status: "rejected" })).rejects.toThrow(/Reason/);
    await env.owner.mutation(api.admin.setLifecycle, { id, status: "rejected", note: "Duplicate" });
    expect(await env.t.query(api.listings.getPublicBySlug, { slug })).toBeNull();
  });

  it("replaces and removes media; clears jury scores", async () => {
    const env = await setup();
    const { id, slug } = await create(env, { editorialScores: p(8) });
    const newCover = await env.t.run((ctx) => ctx.storage.store(new Blob(["new"], { type: "image/webp" })));
    await env.owner.mutation(api.listings.replaceMedia, { id, kind: "cover", storageId: newCover });
    const video = await env.t.run((ctx) => ctx.storage.store(new Blob(["vid"], { type: "video/mp4" })));
    await env.owner.mutation(api.listings.replaceMedia, { id, kind: "video", storageId: video });
    expect((await env.t.query(api.listings.getPublicBySlug, { slug }))!.videoUrl).toBeTruthy();
    await env.owner.mutation(api.admin.removeMedia, { id, kind: "video" });
    expect((await env.t.query(api.listings.getPublicBySlug, { slug }))!.videoUrl).toBeNull();
    await env.owner.mutation(api.admin.clearEditorialScores, { id });
    expect((await env.t.query(api.listings.getPublicBySlug, { slug }))!.finalScore).toBeNull();
  });
});

describe("admin: creators and users", () => {
  it("renaming a creator renames the credit on its listings; delete only when unused", async () => {
    const env = await setup();
    const { slug } = await create(env);
    const [creator] = await env.owner.query(api.admin.listCreators, {});
    expect(creator).toMatchObject({ name: "Bürocratik", listings: 1 });
    await env.owner.mutation(api.admin.updateCreator, { id: creator.id, name: "Burocratik Studio", location: "Braga, PT", isClaimed: true });
    expect((await env.t.query(api.listings.getPublicBySlug, { slug }))!.creditName).toBe("Burocratik Studio");
    await expect(env.owner.mutation(api.admin.deleteCreator, { id: creator.id })).rejects.toThrow(/still has listings/);
  });

  it("role rules: no self-change; only super admins touch super admin", async () => {
    const env = await setup();
    await expect(env.owner.mutation(api.admin.setUserRole, { userId: env.ids.owner, role: null })).rejects.toThrow(/own role/);
    await expect(env.helper.mutation(api.admin.setUserRole, { userId: env.ids.member, role: "super_admin" })).rejects.toThrow(/super admin/);
    await expect(env.helper.mutation(api.admin.setUserRole, { userId: env.ids.owner, role: null })).rejects.toThrow(/super admin/);
    await env.helper.mutation(api.admin.setUserRole, { userId: env.ids.member, role: "admin" });
    const users = await env.owner.query(api.admin.listUsers, {});
    expect(users.find((u) => u.email === "member@example.com")!.role).toBe("admin");
    expect(users.find((u) => u.isYou)!.email).toBe("owner@example.com");
  });

  it("wipeShowcase deletes every listing and creator", async () => {
    const env = await setup();
    await create(env);
    await create(env, { url: "https://b.site", title: "B", creditName: "B Studio" });
    const out = await env.t.mutation(internal.admin.wipeShowcase, { confirm: "DELETE" });
    expect(out).toMatchObject({ listings: 2, creators: 2, done: true });
    expect(await env.t.query(api.listings.listPublic, {})).toEqual([]);
  });
});

describe("admin: screenshots", () => {
  const img = (env: Env) => env.t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/png" })));

  it("creates with up to 4 more screenshots and rejects a 5th", async () => {
    const env = await setup();
    const four = [await img(env), await img(env), await img(env), await img(env)];
    const { slug } = await create(env, { galleryIds: four });
    const pub = await env.t.query(api.listings.getPublicBySlug, { slug });
    expect(pub!.galleryUrls).toHaveLength(4);
    await expect(
      create(env, { url: "https://other.example", galleryIds: [...four, await img(env)] }),
    ).rejects.toThrow(/up to 4 more/);
  });

  it("adds, reorders, promotes to cover and removes", async () => {
    const env = await setup();
    const { id } = await create(env);
    const a = await img(env);
    const b = await img(env);
    await env.owner.mutation(api.listings.addGalleryImage, { id, storageId: a });
    await env.owner.mutation(api.listings.addGalleryImage, { id, storageId: b });
    await env.owner.mutation(api.listings.setGalleryOrder, { id, galleryIds: [b, a] });
    let row = await env.t.run((ctx) => ctx.db.get(id));
    expect(row!.galleryIds).toEqual([b, a]);

    const oldCover = row!.coverId;
    await env.owner.mutation(api.listings.makeGalleryCover, { id, storageId: a });
    row = await env.t.run((ctx) => ctx.db.get(id));
    expect(row!.coverId).toBe(a);
    expect(row!.galleryIds).toEqual([b, oldCover]);

    await env.owner.mutation(api.listings.removeGalleryImage, { id, storageId: b });
    row = await env.t.run((ctx) => ctx.db.get(id));
    expect(row!.galleryIds).toEqual([oldCover]);
    expect(await env.t.run((ctx) => ctx.storage.getUrl(b))).toBeNull();

    await expect(
      env.member.mutation(api.listings.addGalleryImage, { id, storageId: await img(env) }),
    ).rejects.toThrow(/admin/);
  });

  it("rejects a reorder that is not the same set", async () => {
    const env = await setup();
    const { id } = await create(env);
    const a = await img(env);
    await env.owner.mutation(api.listings.addGalleryImage, { id, storageId: a });
    await expect(
      env.owner.mutation(api.listings.setGalleryOrder, { id, galleryIds: [a, a] }),
    ).rejects.toThrow(/changed/);
  });
});
