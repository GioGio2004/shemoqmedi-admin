/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.{ts,js}");

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      externalId: "user_maker",
      name: "Maker",
      email: "maker@example.com",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("users", {
      externalId: "user_other",
      name: "Other",
      email: "other@example.com",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("users", {
      externalId: "user_admin",
      name: "Admin",
      email: "admin@example.com",
      role: "admin",
      createdAt: now,
      updatedAt: now,
    });
  });
  return {
    t,
    maker: t.withIdentity({ subject: "user_maker" }),
    other: t.withIdentity({ subject: "user_other" }),
    admin: t.withIdentity({ subject: "user_admin" }),
  };
}

function storeImage(t: ReturnType<typeof convexTest>, type = "image/png") {
  return t.run((ctx) => ctx.storage.store(new Blob(["pixels"], { type })));
}

function input(coverId: Awaited<ReturnType<typeof storeImage>>, overrides = {}) {
  return {
    title: "Paper Weather",
    tagline: "A forecast you can fold.",
    url: "paperweather.studio/",
    category: "portfolio",
    technologies: ["Next.js", "GSAP"],
    creditName: "Fold & Co.",
    coverId,
    ...overrides,
  };
}

describe("listing submission", () => {
  it("requires a signed-in user", async () => {
    const { t } = await setup();
    const coverId = await storeImage(t);
    await expect(t.mutation(api.listings.submit, input(coverId))).rejects.toThrow(
      /Unauthenticated/,
    );
    await expect(t.mutation(api.listings.generateUploadUrl, {})).rejects.toThrow(
      /Unauthenticated/,
    );
  });

  it("creates a pending listing that is not public yet", async () => {
    const { t, maker } = await setup();
    const coverId = await storeImage(t);
    const { slug } = await maker.mutation(api.listings.submit, input(coverId));

    expect(slug).toBe("paper-weather");
    const mine = await maker.query(api.listings.myListings, {});
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: "pending", url: "https://paperweather.studio" });
    expect(await t.query(api.listings.listPublished, {})).toEqual([]);
    expect(await t.query(api.listings.getPublishedBySlug, { slug })).toBeNull();
  });

  it("rejects bad input", async () => {
    const { t, maker } = await setup();
    const coverId = await storeImage(t);
    await expect(
      maker.mutation(api.listings.submit, input(coverId, { url: "localhost:3000" })),
    ).rejects.toThrow(/public website/);
    await expect(
      maker.mutation(api.listings.submit, input(coverId, { category: "restaurants" })),
    ).rejects.toThrow(/category/);
    await expect(
      maker.mutation(api.listings.submit, input(coverId, { technologies: ["COBOL"] })),
    ).rejects.toThrow(/technology/);
    await expect(
      maker.mutation(api.listings.submit, input(coverId, { title: "   " })),
    ).rejects.toThrow(/title is required/);
  });

  it("refuses non-image uploads", async () => {
    const { t, maker } = await setup();
    const pdfId = await storeImage(t, "application/pdf");
    await expect(maker.mutation(api.listings.submit, input(pdfId))).rejects.toThrow(/image/);
    expect(await maker.query(api.listings.myListings, {})).toEqual([]);
  });

  it("refuses a website that is already listed or waiting", async () => {
    const { t, maker, other } = await setup();
    await maker.mutation(api.listings.submit, input(await storeImage(t)));
    await expect(
      other.mutation(
        api.listings.submit,
        input(await storeImage(t), { url: "https://paperweather.studio" }),
      ),
    ).rejects.toThrow(/already been submitted/);
  });

  it("gives duplicate titles unique slugs", async () => {
    const { t, maker } = await setup();
    await maker.mutation(api.listings.submit, input(await storeImage(t)));
    const second = await maker.mutation(
      api.listings.submit,
      input(await storeImage(t), { url: "https://another.site" }),
    );
    expect(second.slug).toBe("paper-weather-2");
  });
});

describe("admin review", () => {
  it("is admin-only", async () => {
    const { t, maker } = await setup();
    await maker.mutation(api.listings.submit, input(await storeImage(t)));
    const [{ id }] = await maker.query(api.listings.myListings, {});
    await expect(maker.query(api.listings.reviewQueue, { status: "pending" })).rejects.toThrow(
      /admin/,
    );
    await expect(maker.mutation(api.listings.approve, { id })).rejects.toThrow(/admin/);
  });

  it("approving publishes the listing", async () => {
    const { t, maker, admin } = await setup();
    const { slug } = await maker.mutation(api.listings.submit, input(await storeImage(t)));

    const queue = await admin.query(api.listings.reviewQueue, { status: "pending" });
    expect(queue).toHaveLength(1);
    expect(queue[0].submitter).toEqual({ name: "Maker", email: "maker@example.com" });
    expect(await admin.query(api.listings.reviewCounts, {})).toEqual({
      pending: 1,
      approved: 0,
      rejected: 0,
    });

    await admin.mutation(api.listings.approve, { id: queue[0].id });

    const published = await t.query(api.listings.listPublished, {});
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ slug, title: "Paper Weather", category: "portfolio" });
    expect(published[0].coverUrl).toBeTruthy();
    expect(published[0]).not.toHaveProperty("ownerId");
    expect(await t.query(api.listings.listPublished, { category: "portfolio" })).toHaveLength(1);
    expect(await t.query(api.listings.listPublished, { category: "saas" })).toHaveLength(0);
    expect(await t.query(api.listings.categoryCounts, {})).toEqual({
      total: 1,
      byCategory: { portfolio: 1 },
    });
    expect(await t.query(api.listings.getPublishedBySlug, { slug })).not.toBeNull();
  });

  it("rejecting needs a reason and shows it to the owner", async () => {
    const { t, maker, admin } = await setup();
    await maker.mutation(api.listings.submit, input(await storeImage(t)));
    const [{ id }] = await maker.query(api.listings.myListings, {});

    await expect(admin.mutation(api.listings.reject, { id, note: "  " })).rejects.toThrow(
      /Reason is required/,
    );
    await admin.mutation(api.listings.reject, { id, note: "Screenshot is blurry." });

    const [mine] = await maker.query(api.listings.myListings, {});
    expect(mine).toMatchObject({ status: "rejected", reviewNote: "Screenshot is blurry." });
    expect(await t.query(api.listings.listPublished, {})).toEqual([]);
  });

  it("only the owner can withdraw, and files are deleted", async () => {
    const { t, maker, other } = await setup();
    const coverId = await storeImage(t);
    await maker.mutation(api.listings.submit, input(coverId));
    const [{ id }] = await maker.query(api.listings.myListings, {});

    await expect(other.mutation(api.listings.withdraw, { id })).rejects.toThrow(/not found/);
    await maker.mutation(api.listings.withdraw, { id });
    expect(await maker.query(api.listings.myListings, {})).toEqual([]);
    expect(await t.run((ctx) => ctx.db.system.get(coverId))).toBeNull();
  });
});
