/// <reference types="vite/client" />
// Scores stay sealed while a listing is being judged (audit B-02). Public
// queries show no score, pillar scores, juror comments or vote counts until
// judging closes (closeVoting moves the listing out of in_voting); the juror
// still sees their own evaluation and admins see everything throughout.
// Time is simulated (Date only), in Tbilisi time (UTC+4).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { atTime, batchVotingEnds } from "../convex/lib/time";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const p = (n: number) => ({ design: n, usability: n, creativity: n, content: n });
const MONDAY = "2026-11-02"; // batch "2026-11-02", judged 9–15 Nov
const AFTER_JUDGING = batchVotingEnds(MONDAY) + 1;
const COMMENT = "Confident typography and a calm grid.";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(atTime(MONDAY, "12:00"));
});
afterEach(() => vi.useRealTimers());

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const user = (externalId: string, role?: "admin") =>
      ctx.db.insert("users", { externalId, name: externalId, email: `${externalId}@example.com`, role, createdAt: now, updatedAt: now });
    await user("admin", "admin");
    const owner = await user("owner");
    for (let i = 1; i <= 2; i++) {
      const userId = await user(`juror${i}`);
      await ctx.db.insert("jurors", {
        userId,
        status: "claimed",
        slug: `juror-${i}`,
        name: `Juror ${i}`,
        title: "Designer",
        active: true,
        joinedAt: now,
        updatedAt: now,
      });
    }
    return { owner };
  });
  const admin = t.withIdentity({ subject: "admin" });
  const coverId = await t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/jpeg" })));
  const { id, slug } = await admin.mutation(api.admin.createListing, {
    title: "Sealed Site",
    tagline: "",
    url: "https://sealed.example",
    categories: ["portfolio"],
    technologies: [],
    region: "global",
    creatorTier: "agency",
    creditName: "Sealed Studio",
    coverId,
    status: "in_voting",
    isClaimed: true,
  });
  await t.run((ctx) => ctx.db.patch(id, { ownerId: ids.owner }));
  const juror = (i: number) => t.withIdentity({ subject: `juror${i}` });
  await juror(1).mutation(api.jury.evaluate, { slug, scores: p(9), comment: COMMENT });
  await juror(2).mutation(api.jury.evaluate, { slug, scores: p(7), comment: COMMENT });
  return { t, admin, owner: t.withIdentity({ subject: "owner" }), juror, id, slug };
}

const SEALED = {
  scoresRevealed: false,
  finalScore: null,
  editorialScores: null,
  communityScores: null,
  editorialAverage: null,
  communityAverage: null,
  juryVotes: null,
  communityVotesCount: null,
};

describe("score visibility while judging is open", () => {
  it("public queries reveal nothing until judging closes, then everything", async () => {
    const env = await setup();
    const { t, slug } = env;

    // During voting
    expect(await t.query(api.listings.getPublicBySlug, { slug })).toMatchObject({ status: "in_voting", ...SEALED });
    const listed = (await t.query(api.listings.listPublic, {})).find((l) => l.slug === slug);
    expect(listed).toMatchObject(SEALED);
    const studio = await t.query(api.creators.getBySlug, { slug: "sealed-studio" });
    expect(studio!.listings[0]).toMatchObject(SEALED);
    expect(await t.query(api.jury.reviewsForListing, { slug })).toEqual([]);
    expect((await t.query(api.jury.getBySlug, { slug: "juror-1" }))!.reviews).toEqual([]);
    expect((await t.query(api.jury.listPublic, {})).map((j) => j.evaluations)).toEqual([0, 0]);
    // The owner waits too.
    expect((await env.owner.query(api.listings.myListings, {}))[0].finalScore).toBeNull();
    // SOTM/SOTY rounds have no public tallies: only jurors, and only their own scores.
    expect(await t.query(api.rounds.open, {})).toBeNull();

    // The juror still sees their own evaluation.
    expect((await env.juror(1).query(api.jury.myEvaluation, { slug }))!.evaluation).toMatchObject({
      scores: p(9),
      comment: COMMENT,
    });
    expect((await env.juror(2).query(api.jury.myEvaluation, { slug }))!.evaluation).toMatchObject({ scores: p(7) });

    // Admins see the live tally.
    expect(await env.admin.query(api.listings.reviewDetail, { id: env.id })).toMatchObject({
      finalScore: 8,
      juryVotes: 2,
      editorialScores: p(8),
    });
    expect(await env.admin.query(api.jury.evaluationsForListing, { listingId: env.id })).toHaveLength(2);

    // Judging closes
    vi.setSystemTime(AFTER_JUDGING);
    expect((await t.mutation(internal.awards.tick, {})).closed).toBe(1);

    const pub = (await t.query(api.listings.getPublicBySlug, { slug }))!;
    expect(pub.status).not.toBe("in_voting");
    expect(pub).toMatchObject({ scoresRevealed: true, finalScore: 8, juryVotes: 2, editorialScores: p(8), communityVotesCount: 0 });
    const reviews = await t.query(api.jury.reviewsForListing, { slug });
    expect(reviews.map((r) => [r.juror.name, r.average, r.comment])).toEqual([
      ["Juror 1", 9, COMMENT],
      ["Juror 2", 7, COMMENT],
    ]);
    expect((await t.query(api.jury.getBySlug, { slug: "juror-1" }))!.reviews).toMatchObject([
      { listing: { slug }, average: 9, comment: COMMENT },
    ]);
    expect((await t.query(api.jury.listPublic, {})).map((j) => j.evaluations)).toEqual([1, 1]);
    expect((await env.owner.query(api.listings.myListings, {}))[0].finalScore).toBe(8);
    expect(await env.admin.query(api.listings.reviewDetail, { id: env.id })).toMatchObject({ finalScore: 8, juryVotes: 2 });
  });

  it("a listing put back into voting is sealed again", async () => {
    const env = await setup();
    vi.setSystemTime(AFTER_JUDGING);
    await env.t.mutation(internal.awards.tick, {});
    expect((await env.t.query(api.listings.getPublicBySlug, { slug: env.slug }))!.scoresRevealed).toBe(true);
    // Its HM keeps it "awarded"; clear awards so the admin may reopen voting.
    await env.t.run(async (ctx) => {
      const awards = await ctx.db.query("awards").withIndex("by_listing", (q) => q.eq("listingId", env.id)).collect();
      for (const a of awards) await ctx.db.delete(a._id);
      await ctx.db.patch(env.id, { awards: [], status: "archived" });
    });
    await env.admin.mutation(api.admin.setLifecycle, { id: env.id, status: "in_voting" });
    expect(await env.t.query(api.listings.getPublicBySlug, { slug: env.slug })).toMatchObject(SEALED);
    expect(await env.t.query(api.jury.reviewsForListing, { slug: env.slug })).toEqual([]);
  });
});
