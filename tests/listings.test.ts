/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const DAY = 24 * 60 * 60 * 1000;
const p = (n: number) => ({ design: n, usability: n, creativity: n, code: n });

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const user = (externalId: string, name: string, role?: "admin") =>
    t.run((ctx) =>
      ctx.db.insert("users", {
        externalId,
        name,
        email: `${externalId}@example.com`,
        role,
        createdAt: now,
        updatedAt: now,
      }),
    );
  await user("maker", "Maker");
  await user("voter1", "Voter One");
  await user("voter2", "Voter Two");
  await user("admin", "Admin", "admin");
  return {
    t,
    maker: t.withIdentity({ subject: "maker" }),
    voter1: t.withIdentity({ subject: "voter1" }),
    voter2: t.withIdentity({ subject: "voter2" }),
    admin: t.withIdentity({ subject: "admin" }),
  };
}

type T = Awaited<ReturnType<typeof setup>>["t"];

function storeFile(t: T, type = "image/png") {
  return t.run((ctx) => ctx.storage.store(new Blob(["bytes"], { type })));
}

function input(coverId: Id<"_storage">, overrides: Record<string, unknown> = {}) {
  return {
    title: "Paper Weather",
    tagline: "A forecast you can fold.",
    url: "paperweather.studio/",
    category: "portfolio",
    technologies: ["Next.js", "GSAP"],
    creatorTier: "solo" as const,
    region: "georgia" as const,
    creditName: "Fold & Co.",
    submissionTier: "standard" as const,
    coverId,
    ...overrides,
  };
}

async function submitAndApprove(env: Awaited<ReturnType<typeof setup>>) {
  const { t, maker, admin } = env;
  const { slug } = await maker.mutation(api.listings.submit, input(await storeFile(t)));
  const [{ id }] = await maker.query(api.listings.myListings, {});
  await admin.mutation(api.listings.approve, { id });
  return { slug, id };
}

describe("submission", () => {
  it("requires a signed-in user", async () => {
    const { t } = await setup();
    await expect(t.mutation(api.listings.submit, input(await storeFile(t)))).rejects.toThrow(
      /Unauthenticated/,
    );
    await expect(
      t.mutation(api.media.register, {
        fileId: "abcdef123",
        url: "https://ik.imagekit.io/x/listings/a/a.webp",
        filePath: "/listings/a/a.webp",
        kind: "image",
        contentType: "image/webp",
        size: 10,
      }),
    ).rejects.toThrow(/Unauthenticated/);
  });

  it("creates a pending listing and a claimed creator profile", async () => {
    const { t, maker } = await setup();
    const { slug } = await maker.mutation(api.listings.submit, input(await storeFile(t)));
    expect(slug).toBe("paper-weather");
    const [mine] = await maker.query(api.listings.myListings, {});
    expect(mine).toMatchObject({ status: "pending", url: "https://paperweather.studio" });
    expect(await t.query(api.listings.listPublic, {})).toEqual([]);
    expect(await t.query(api.listings.getPublicBySlug, { slug })).toBeNull();
    const creator = await t.run((ctx) => ctx.db.query("creators").first());
    expect(creator).toMatchObject({ slug: "fold-co", tier: "solo", region: "georgia", isClaimed: true });
  });

  it("rejects Express Fast-Track for now", async () => {
    const { t, maker } = await setup();
    await expect(
      maker.mutation(api.listings.submit, input(await storeFile(t), { submissionTier: "express" })),
    ).rejects.toThrow(/coming soon/);
  });

  it("validates input and media", async () => {
    const { t, maker } = await setup();
    const cover = await storeFile(t);
    await expect(maker.mutation(api.listings.submit, input(cover, { url: "localhost:3000" }))).rejects.toThrow(/public website/);
    await expect(maker.mutation(api.listings.submit, input(cover, { category: "restaurants" }))).rejects.toThrow(/category/);
    await expect(maker.mutation(api.listings.submit, input(cover, { category: undefined }))).rejects.toThrow(/category/);
    await expect(
      maker.mutation(api.listings.submit, input(cover, { categories: ["ai", "saas", "fintech", "agency"] })),
    ).rejects.toThrow(/up to 3 categories/);
    await expect(maker.mutation(api.listings.submit, input(cover, { technologies: ["COBOL"] }))).rejects.toThrow(/technology/);
    await expect(maker.mutation(api.listings.submit, input(await storeFile(t, "application/pdf")))).rejects.toThrow(/image/);
    await expect(
      maker.mutation(api.listings.submit, input(cover, { videoId: await storeFile(t, "image/gif") })),
    ).rejects.toThrow(/MP4 or WebM/);
    const ok = await maker.mutation(api.listings.submit, input(cover, { videoId: await storeFile(t, "video/mp4") }));
    expect(ok.slug).toBe("paper-weather");
  });

  it("stores several categories, primary first", async () => {
    const { t, maker } = await setup();
    const { slug } = await maker.mutation(
      api.listings.submit,
      input(await storeFile(t), { category: undefined, categories: ["ai", "saas", "ai"] }),
    );
    const row = await t.run((ctx) => ctx.db.query("listings").withIndex("by_slug", (q) => q.eq("slug", slug)).unique());
    expect(row).toMatchObject({ category: "ai", categories: ["ai", "saas"] });
  });

  it("refuses a duplicate website", async () => {
    const { t, maker, voter1 } = await setup();
    await maker.mutation(api.listings.submit, input(await storeFile(t)));
    await expect(
      voter1.mutation(api.listings.submit, input(await storeFile(t), { url: "https://paperweather.studio" })),
    ).rejects.toThrow(/already been submitted/);
  });
});

describe("review and voting window", () => {
  it("review functions are admin-only", async () => {
    const { t, maker } = await setup();
    await maker.mutation(api.listings.submit, input(await storeFile(t)));
    const [{ id }] = await maker.query(api.listings.myListings, {});
    await expect(maker.query(api.listings.reviewQueue, { status: "pending" })).rejects.toThrow(/admin/);
    await expect(maker.mutation(api.listings.approve, { id })).rejects.toThrow(/admin/);
    await expect(maker.mutation(api.listings.setEditorialScores, { id, scores: p(9) })).rejects.toThrow(/admin/);
    await expect(maker.mutation(api.listings.closeVotingNow, { id })).rejects.toThrow(/admin/);
  });

  it("approving opens a 7-day public voting window", async () => {
    const env = await setup();
    const before = Date.now();
    const { slug } = await submitAndApprove(env);
    const listing = await env.t.query(api.listings.getPublicBySlug, { slug });
    expect(listing).toMatchObject({ status: "in_voting", awards: [], finalScore: null, isClaimed: true });
    expect(listing!.votingEndsAt - listing!.publishedAt).toBe(7 * DAY);
    expect(listing!.publishedAt).toBeGreaterThanOrEqual(before);
    expect(listing).not.toHaveProperty("ownerId");
    expect(await env.t.query(api.listings.listPublic, {})).toHaveLength(1);
  });

  it("combines jury (60%) and community (40%) scores", async () => {
    const env = await setup();
    const { slug, id } = await submitAndApprove(env);
    await env.admin.mutation(api.listings.setEditorialScores, { id, scores: p(8) });
    expect((await env.t.query(api.listings.getPublicBySlug, { slug }))!.finalScore).toBe(8);

    await env.voter1.mutation(api.votes.cast, { slug, scores: p(9) });
    await env.voter2.mutation(api.votes.cast, { slug, scores: { design: 10, usability: 9, creativity: 9, code: 8 } });
    const listing = await env.t.query(api.listings.getPublicBySlug, { slug });
    expect(listing).toMatchObject({
      editorialAverage: 8,
      communityAverage: 9,
      finalScore: 8.4,
      communityVotesCount: 2,
      communityScores: { design: 9.5, usability: 9, creativity: 9, code: 8.5 },
    });
    expect(await env.voter1.query(api.votes.mine, { slug })).toMatchObject({ scores: p(9) });
  });

  it("allows one vote per person, not by the owner, only while voting is open", async () => {
    const env = await setup();
    const { slug, id } = await submitAndApprove(env);
    await env.voter1.mutation(api.votes.cast, { slug, scores: p(7) });
    await expect(env.voter1.mutation(api.votes.cast, { slug, scores: p(9) })).rejects.toThrow(/already voted/);
    await expect(env.maker.mutation(api.votes.cast, { slug, scores: p(10) })).rejects.toThrow(/own site/);
    await expect(env.t.mutation(api.votes.cast, { slug, scores: p(10) })).rejects.toThrow(/Unauthenticated/);
    await expect(env.voter2.mutation(api.votes.cast, { slug, scores: { ...p(7), code: 11 } })).rejects.toThrow(/Code/);

    await env.t.run((ctx) => ctx.db.patch(id, { votingEndsAt: Date.now() - 1 }));
    await expect(env.voter2.mutation(api.votes.cast, { slug, scores: p(8) })).rejects.toThrow(/closed/);
  });

  it("the cron closes ended windows and assigns awards", async () => {
    const env = await setup();
    const { slug, id } = await submitAndApprove(env); // solo creator
    await env.admin.mutation(api.listings.setEditorialScores, { id, scores: p(8.6) });
    await env.t.run((ctx) => ctx.db.patch(id, { votingEndsAt: Date.now() - 1 }));

    expect(await env.t.mutation(internal.listings.closeExpiredVoting, {})).toBe(1);
    const listing = await env.t.query(api.listings.getPublicBySlug, { slug });
    expect(listing).toMatchObject({ status: "awarded", awards: ["BSC", "SOTD"], finalScore: 8.6 });
    expect(await env.t.mutation(internal.listings.closeExpiredVoting, {})).toBe(0);
    // Admins can still correct the jury score; awards stay as assigned.
    await env.admin.mutation(api.listings.setEditorialScores, { id, scores: p(5) });
    expect(await env.t.query(api.listings.getPublicBySlug, { slug })).toMatchObject({ finalScore: 5, awards: ["BSC", "SOTD"] });
  });

  it("closes without an award (archived) below 7.50", async () => {
    const env = await setup();
    const { slug, id } = await submitAndApprove(env);
    await env.admin.mutation(api.listings.setEditorialScores, { id, scores: p(7) });
    await env.admin.mutation(api.listings.closeVotingNow, { id });
    expect(await env.t.query(api.listings.getPublicBySlug, { slug })).toMatchObject({ status: "archived", awards: [] });
  });

  it("rejecting needs a reason and hides the site", async () => {
    const env = await setup();
    const { slug, id } = await submitAndApprove(env);
    await expect(env.admin.mutation(api.listings.reject, { id, note: " " })).rejects.toThrow(/Reason is required/);
    await env.admin.mutation(api.listings.reject, { id, note: "Screenshot is blurry." });
    const [mine] = await env.maker.query(api.listings.myListings, {});
    expect(mine).toMatchObject({ status: "rejected", reviewNote: "Screenshot is blurry." });
    expect(await env.t.query(api.listings.getPublicBySlug, { slug })).toBeNull();
  });

  it("only the owner can withdraw; files and votes are deleted", async () => {
    const env = await setup();
    const { slug, id } = await submitAndApprove(env);
    await env.voter1.mutation(api.votes.cast, { slug, scores: p(8) });
    await expect(env.voter1.mutation(api.listings.withdraw, { id })).rejects.toThrow(/not found/);
    await env.maker.mutation(api.listings.withdraw, { id });
    expect(await env.t.run((ctx) => ctx.db.query("votes").collect())).toEqual([]);
    expect(await env.t.run((ctx) => ctx.db.query("listings").collect())).toEqual([]);
  });
});

describe("imports, creators and claims", () => {
  async function importSeed(env: Awaited<ReturnType<typeof setup>>, overrides: Record<string, unknown> = {}) {
    return env.t.mutation(internal.importer.insertImported, {
      url: "https://floema.pt",
      title: "Floema",
      tagline: "Furniture, quietly.",
      category: "architecture",
      technologies: ["WebGL", "Three.js", "GSAP", "NotATech"],
      region: "global",
      creatorTier: "agency",
      creditName: "Bürocratik",
      status: "in_voting",
      votingDaysLeft: 6,
      isClaimed: false,
      coverId: await storeFile(env.t),
      source: "seed",
      ...overrides,
    });
  }

  it("imports land unclaimed with valid technologies only, and skip duplicates", async () => {
    const env = await setup();
    const first = await importSeed(env);
    expect(first).toMatchObject({ slug: "floema", skipped: false });
    const listing = await env.t.query(api.listings.getPublicBySlug, { slug: "floema" });
    expect(listing).toMatchObject({
      status: "in_voting",
      isClaimed: false,
      technologies: ["WebGL", "Three.js", "GSAP"],
      finalScore: null,
      creator: { slug: "burocratik", name: "Bürocratik" },
    });
    expect(listing!.votingEndsAt - Date.now()).toBeGreaterThan(5.9 * DAY);
    expect(await importSeed(env)).toMatchObject({ id: first.id, slug: "floema", skipped: true });
  });

  it("seeded awards appear on the creator profile", async () => {
    const env = await setup();
    await importSeed(env, {
      url: "https://room.kenchogroup.ge",
      title: "Room Planner by Kencho Group",
      creditName: "Giorgi Khvichia",
      creatorTier: "solo",
      region: "georgia",
      status: "awarded",
      publishedDaysAgo: 12,
      editorialScore: 8.9,
      awards: ["BSC"],
      isClaimed: true,
    });
    const profile = await env.t.query(api.creators.getBySlug, { slug: "giorgi-khvichia" });
    expect(profile!.creator).toMatchObject({ tier: "solo", isClaimed: true, nominations: 1, awards: { BSC: 1, SOTD: 0, HM: 0 } });
    expect(profile!.listings[0]).toMatchObject({ status: "awarded", finalScore: 8.9, awards: ["BSC"] });
    expect(await env.t.query(api.creators.listPublic, {})).toHaveLength(1);
  });

  it("claims: one pending per user, approval hands over ownership", async () => {
    const env = await setup();
    await importSeed(env);
    await expect(
      env.t.mutation(api.claims.submit, { targetType: "listing", slug: "floema", message: "Mine" }),
    ).rejects.toThrow(/Unauthenticated/);
    await env.voter1.mutation(api.claims.submit, { targetType: "listing", slug: "floema", message: "I built it." });
    await env.voter2.mutation(api.claims.submit, { targetType: "listing", slug: "floema", message: "No, I did." });
    await expect(
      env.voter1.mutation(api.claims.submit, { targetType: "listing", slug: "floema", message: "Again" }),
    ).rejects.toThrow(/already have a claim/);

    await expect(env.voter1.query(api.claims.queue, { status: "pending" })).rejects.toThrow(/admin/);
    const queue = await env.admin.query(api.claims.queue, { status: "pending" });
    expect(queue).toHaveLength(2);
    const first = queue.find((c) => c.claimant?.name === "Voter One")!;
    await env.admin.mutation(api.claims.approve, { id: first.id });

    expect(await env.t.query(api.listings.getPublicBySlug, { slug: "floema" })).toMatchObject({ isClaimed: true });
    const [mine] = await env.voter1.query(api.listings.myListings, {});
    expect(mine.slug).toBe("floema");
    const rejected = await env.admin.query(api.claims.queue, { status: "rejected" });
    expect(rejected[0]).toMatchObject({ reviewNote: "Another claim was approved." });
    await expect(
      env.maker.mutation(api.claims.submit, { targetType: "listing", slug: "floema", message: "Mine" }),
    ).rejects.toThrow(/already been claimed/);
  });

  it("creator profiles can be claimed too", async () => {
    const env = await setup();
    await importSeed(env);
    await env.voter1.mutation(api.claims.submit, { targetType: "creator", slug: "burocratik", message: "Our studio." });
    const [claim] = await env.admin.query(api.claims.queue, { status: "pending" });
    expect(claim.target).toMatchObject({ slug: "burocratik", isClaimed: false });
    await env.admin.mutation(api.claims.approve, { id: claim.id });
    const profile = await env.t.query(api.creators.getBySlug, { slug: "burocratik" });
    expect(profile!.creator.isClaimed).toBe(true);
  });
});
