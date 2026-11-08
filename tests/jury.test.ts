/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const p = (n: number) => ({ design: n, usability: n, creativity: n, code: n });
const COMMENT = "Confident typography and a calm, precise grid. The 3D kitchen loads fast.";

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  await t.run(async (ctx) => {
    const mk = (externalId: string, extra: Record<string, unknown> = {}) =>
      ctx.db.insert("users", {
        externalId,
        name: externalId,
        email: `${externalId}@example.com`,
        createdAt: now,
        updatedAt: now,
        ...extra,
      });
    await mk("admin", { role: "super_admin" });
    await mk("ana", { hasImage: true, profilePicture: "https://img.clerk.com/ana.png" });
    await mk("beka", { hasImage: false, profilePicture: "https://img.clerk.com/default.png" });
    await mk("stranger");
  });
  const admin = t.withIdentity({ subject: "admin" });
  async function listing(title: string, url: string, extra: Record<string, unknown> = {}) {
    const coverId = await t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/png" })));
    return admin.mutation(api.admin.createListing, {
      title,
      tagline: "Kitchens",
      url,
      categories: ["architecture"],
      technologies: ["React"],
      region: "georgia",
      creatorTier: "solo",
      creditName: title,
      coverId,
      status: "in_voting",
      isClaimed: false,
      ...extra,
    });
  }
  const site = await listing("Kencho Room", "https://room.example.ge");
  return {
    t,
    admin,
    listing,
    site,
    ana: t.withIdentity({ subject: "ana" }),
    beka: t.withIdentity({ subject: "beka" }),
    stranger: t.withIdentity({ subject: "stranger" }),
  };
}

type Env = Awaited<ReturnType<typeof setup>>;
const tokenOf = (url: string) => url.split("/claim/")[1];

async function juror(env: Env, name: string, extra: Record<string, unknown> = {}) {
  const { id } = await env.admin.mutation(api.jury.createJuror, {
    name,
    title: "Designer",
    category: "design",
    ...extra,
  });
  const { url } = await env.admin.action(api.claimLinks.link, { target: { kind: "juror", id } });
  return { id, token: tokenOf(url) };
}

async function joinJury(env: Env, name: string, user: Env["ana"]) {
  const { id, token } = await juror(env, name);
  await user.mutation(api.claimLinks.claim, { token });
  return id;
}

describe("jury claim links", () => {
  it("an unclaimed jury profile is private until its link is claimed", async () => {
    const env = await setup();
    const { id, token } = await juror(env, "Ana Beridze", { linkedinUrl: "linkedin.com/in/ana", website: "" });
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    // Same link on the second request: copying twice doesn't break the first DM.
    const again = await env.admin.action(api.claimLinks.link, { target: { kind: "juror", id } });
    expect(tokenOf(again.url)).toBe(token);

    expect(await env.t.query(api.jury.listPublic, {})).toEqual([]);
    const slug = (await env.admin.query(api.jury.adminOverview, {}))[0].slug;
    expect(await env.t.query(api.jury.getBySlug, { slug })).toBeNull();

    const preview = await env.t.query(api.claimLinks.resolve, { token });
    expect(preview).toMatchObject({
      state: "open",
      kind: "juror",
      juror: { name: "Ana Beridze", website: null, linkedinUrl: "https://linkedin.com/in/ana", isFounding: true },
      listings: [],
    });

    await expect(env.t.mutation(api.claimLinks.claim, { token })).rejects.toThrow(/Unauthenticated/);
    expect(await env.ana.mutation(api.claimLinks.claim, { token })).toEqual({
      kind: "juror",
      redirect: "/jury/profile?claimed=1",
    });
    expect(await env.ana.query(api.jury.me, {})).toMatchObject({ name: "Ana Beridze", imageUrl: "https://img.clerk.com/ana.png" });
    expect(await env.t.query(api.jury.listPublic, {})).toHaveLength(1);
    expect(await env.t.query(api.jury.getBySlug, { slug })).not.toBeNull();

    // Burned: the link now redirects, and nobody else can use it.
    expect(await env.t.query(api.claimLinks.resolve, { token })).toMatchObject({ state: "claimed", redirect: `/jury/${slug}` });
    await expect(env.stranger.mutation(api.claimLinks.claim, { token })).rejects.toThrow(/already been used/);
    expect(await env.ana.mutation(api.claimLinks.claim, { token })).toEqual({ kind: "juror", redirect: "/jury/profile" });
    await expect(env.admin.action(api.claimLinks.link, { target: { kind: "juror", id } })).rejects.toThrow(/already been claimed/);
  });

  it("only admins mint links; bad and rotated tokens are invalid", async () => {
    const env = await setup();
    const { id, token } = await juror(env, "Ana");
    await expect(env.stranger.action(api.claimLinks.link, { target: { kind: "juror", id } })).rejects.toThrow(/admin/);
    expect((await env.t.query(api.claimLinks.resolve, { token: "nope" })).state).toBe("invalid");
    expect((await env.t.query(api.claimLinks.resolve, { token: "a".repeat(64) })).state).toBe("invalid");
    const rotated = await env.admin.action(api.claimLinks.link, { target: { kind: "juror", id }, rotate: true });
    expect(tokenOf(rotated.url)).not.toBe(token);
    expect((await env.t.query(api.claimLinks.resolve, { token })).state).toBe("invalid");
    await expect(env.ana.mutation(api.claimLinks.claim, { token })).rejects.toThrow(/not valid/);
    // No email on the profile: emailing explains instead of failing silently.
    await expect(env.admin.action(api.claimLinks.emailJuror, { jurorId: id })).rejects.toThrow(/email/);
  });

  it("one account holds one jury profile", async () => {
    const env = await setup();
    await joinJury(env, "Ana", env.ana);
    const second = await juror(env, "Ana again");
    await expect(env.ana.mutation(api.claimLinks.claim, { token: second.token })).rejects.toThrow(/already has a jury profile/);
  });

  it("a bundle claims the juror and the listing pre-created for them; they can't score it", async () => {
    const env = await setup();
    const { id, token } = await juror(env, "Beka");
    const startup = await env.listing("Beka Labs", "https://bekalabs.example", { jurorId: id, isStartup: true });
    const before = await env.t.query(api.listings.getPublicBySlug, { slug: startup.slug });
    expect(before).toMatchObject({ isClaimed: false, isDoFollow: false, isStartup: true });

    expect(await env.t.query(api.claimLinks.resolve, { token })).toMatchObject({
      state: "open",
      kind: "bundle",
      listings: [{ slug: startup.slug, isStartup: true, isPublic: true }],
    });
    expect((await env.beka.mutation(api.claimLinks.claim, { token })).kind).toBe("bundle");
    expect(await env.t.query(api.listings.getPublicBySlug, { slug: startup.slug })).toMatchObject({
      isClaimed: true,
      isDoFollow: true,
    });
    expect((await env.beka.query(api.listings.myListings, {})).map((l) => l.slug)).toEqual([startup.slug]);

    expect((await env.beka.query(api.jury.myEvaluation, { slug: startup.slug }))!.blocked).toMatch(/your own site/);
    await expect(
      env.beka.mutation(api.jury.evaluate, { slug: startup.slug, scores: p(10), comment: COMMENT }),
    ).rejects.toThrow(/your own site/);
    // Other sites are fine.
    await env.beka.mutation(api.jury.evaluate, { slug: env.site.slug, scores: p(8), comment: COMMENT });
  });

  it("a standalone listing link hands the site to its founder and follows its links", async () => {
    const env = await setup();
    const { url } = await env.admin.action(api.claimLinks.link, { target: { kind: "listing", id: env.site.id } });
    const token = tokenOf(url);
    expect(await env.t.query(api.claimLinks.resolve, { token })).toMatchObject({ state: "open", kind: "listing", juror: null });
    // A competing claim request is closed when the owner claims by link.
    await env.stranger.mutation(api.claims.submit, { targetType: "listing", slug: env.site.slug, message: "It's mine, honestly." });
    expect(await env.ana.mutation(api.claimLinks.claim, { token })).toEqual({
      kind: "listing",
      redirect: "/account?claimed=1",
    });
    expect(await env.t.query(api.listings.getPublicBySlug, { slug: env.site.slug })).toMatchObject({
      isClaimed: true,
      isDoFollow: true,
    });
    const queue = await env.admin.query(api.claims.queue, { status: "pending" });
    expect(queue).toHaveLength(0);
    expect((await env.t.query(api.claimLinks.resolve, { token })).redirect).toBe(`/sites/${env.site.slug}`);
  });

  it("the photo prepared with the invitation beats the account photo until the juror changes it", async () => {
    const env = await setup();
    const avatarId = await env.t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/webp" })));
    const { token } = await juror(env, "Ana", { avatarId });
    const preset = (await env.t.query(api.claimLinks.resolve, { token })).juror!.imageUrl;
    expect(preset).toBeTruthy();
    // ana's account has its own photo (e.g. Google's): the preset still shows.
    await env.ana.mutation(api.claimLinks.claim, { token });
    expect(await env.ana.query(api.jury.me, {})).toMatchObject({ imageUrl: preset, hasPresetPhoto: true });
    expect((await env.t.query(api.jury.listPublic, {}))[0].imageUrl).toBe(preset);
    // Changing the photo on the profile page drops the preset.
    await env.ana.mutation(api.jury.dropPresetPhoto, {});
    expect(await env.ana.query(api.jury.me, {})).toMatchObject({
      imageUrl: "https://img.clerk.com/ana.png",
      hasPresetPhoto: false,
    });
    await expect(env.stranger.mutation(api.jury.dropPresetPhoto, {})).rejects.toThrow(/jury members/);
  });

  it("a juror can't community-vote on a site linked to them after they claimed; slugs stay put", async () => {
    const env = await setup();
    const jurorId = await joinJury(env, "Ana", env.ana);
    await env.admin.mutation(api.admin.updateListing, { id: env.site.id, jurorId });
    await expect(env.ana.mutation(api.votes.cast, { slug: env.site.slug, scores: p(9) })).rejects.toThrow(/your own site/);

    const before = (await env.ana.query(api.jury.me, {}))!.slug;
    const out = await env.ana.mutation(api.jury.updateProfile, { name: "Ana Beridze", title: "Designer" });
    expect(out.slug).toBe(before);
    await env.admin.mutation(api.jury.updateJuror, { jurorId, name: "Ana B." });
    expect((await env.ana.query(api.jury.me, {}))!.slug).toBe(before);
  });

  it("admins can force the follow state either way", async () => {
    const env = await setup();
    await env.admin.mutation(api.admin.updateListing, { id: env.site.id, isDoFollow: true });
    expect((await env.t.query(api.listings.getPublicBySlug, { slug: env.site.slug }))!.isDoFollow).toBe(true);
    await env.admin.mutation(api.admin.updateListing, { id: env.site.id, isDoFollow: null });
    expect((await env.t.query(api.listings.getPublicBySlug, { slug: env.site.slug }))!.isDoFollow).toBe(false);
  });
});

describe("jury evaluations", () => {
  it("averages several jurors; admins moderate instead of overriding", async () => {
    const env = await setup();
    await joinJury(env, "ana", env.ana);
    await joinJury(env, "beka", env.beka);
    const slug = env.site.slug;
    await expect(env.stranger.mutation(api.jury.evaluate, { slug, scores: p(8), comment: COMMENT })).rejects.toThrow(
      /jury members/,
    );
    await expect(env.ana.mutation(api.jury.evaluate, { slug, scores: p(8), comment: "Nice." })).rejects.toThrow(/at least/);
    await env.ana.mutation(api.jury.evaluate, { slug, scores: p(9), comment: COMMENT });
    await env.beka.mutation(api.jury.evaluate, { slug, scores: p(7), comment: COMMENT });
    await env.beka.mutation(api.jury.evaluate, { slug, scores: p(8), comment: COMMENT }); // update replaces
    expect((await env.t.query(api.listings.getPublicBySlug, { slug }))!.editorialScores).toEqual(p(8.5));

    const reviews = await env.t.query(api.jury.reviewsForListing, { slug });
    expect(reviews.map((r) => [r.juror.name, r.average, r.juror.imageUrl])).toEqual([
      ["ana", 9, "https://img.clerk.com/ana.png"],
      ["beka", 8, null], // Clerk default avatar and no admin photo → grey placeholder
    ]);

    await expect(env.admin.mutation(api.listings.setEditorialScores, { id: env.site.id, scores: p(5) })).rejects.toThrow(
      /average of its jury evaluations/,
    );
    const [first] = await env.admin.query(api.jury.evaluationsForListing, { listingId: env.site.id });
    await env.admin.mutation(api.jury.deleteEvaluation, { evaluationId: first.id });
    expect((await env.t.query(api.listings.getPublicBySlug, { slug }))!.editorialScores).toEqual(p(8));

    const jurors = await env.admin.query(api.jury.adminOverview, {});
    await env.admin.mutation(api.jury.setJurorActive, { jurorId: jurors[0].id as Id<"jurors">, active: false });
    expect(await env.t.query(api.jury.listPublic, {})).toHaveLength(1);
  });

  it("deleting is only for unclaimed profiles and unlinks their listings", async () => {
    const env = await setup();
    const { id } = await juror(env, "Nino");
    const site = await env.listing("Nino Studio", "https://nino.example", { jurorId: id });
    await env.admin.mutation(api.jury.deleteJuror, { jurorId: id });
    const detail = await env.admin.query(api.listings.reviewDetail, { id: site.id });
    expect(detail!.juror).toBeNull();
    const claimedId = await joinJury(env, "Ana", env.ana);
    await expect(env.admin.mutation(api.jury.deleteJuror, { jurorId: claimedId })).rejects.toThrow(/claimed/);
  });
});
