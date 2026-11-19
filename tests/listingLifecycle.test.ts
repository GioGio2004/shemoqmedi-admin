/// <reference types="vite/client" />
// Listing lifecycle and ownership (audit A-03, A-05): owners archive rather
// than delete anything that has been public or won something; deleting
// cascades; submitting records the submitter but grants no ownership until an
// admin chooses to give it.
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.{ts,js}");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const user = (externalId: string, role?: "admin") =>
      ctx.db.insert("users", { externalId, name: externalId, email: `${externalId}@example.com`, role, createdAt: now, updatedAt: now });
    return { maker: await user("maker"), other: await user("other"), admin: await user("admin", "admin") };
  });
  return {
    t,
    ids,
    maker: t.withIdentity({ subject: "maker" }),
    other: t.withIdentity({ subject: "other" }),
    admin: t.withIdentity({ subject: "admin" }),
  };
}
type Env = Awaited<ReturnType<typeof setup>>;

let n = 0;
async function submit(env: Env, who: "maker" | "other" = "maker", overrides: Record<string, unknown> = {}) {
  n += 1;
  const coverId = await env.t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/png" })));
  const { slug } = await env[who].mutation(api.listings.submit, {
    title: `Site ${n}`,
    tagline: "A site.",
    url: `https://site-${n}.example`,
    categories: ["portfolio"],
    technologies: ["Next.js"],
    creatorTier: "solo",
    region: "georgia",
    creditName: `Maker ${n}`,
    submissionTier: "standard",
    coverId,
    ...overrides,
  });
  const row = await env.t.run((ctx) => ctx.db.query("listings").withIndex("by_slug", (q) => q.eq("slug", slug)).unique());
  return { slug, id: row!._id };
}

const get = (env: Env, id: Id<"listings">) => env.t.run((ctx) => ctx.db.get(id));
const count = (env: Env, table: "awards" | "awardAudit" | "listings") =>
  env.t.run(async (ctx) => (await ctx.db.query(table).collect()).length);

/** Submitted by the maker, approved with ownership, closed, then given an HM by hand. */
async function awardedSite(env: Env) {
  const s = await submit(env);
  await env.admin.mutation(api.listings.approve, { id: s.id, grantOwnership: true });
  await env.admin.mutation(api.listings.closeVotingNow, { id: s.id });
  const awardId = await env.admin.mutation(api.awards.grant, { listingId: s.id, tier: "HM", reason: "Jury chair" });
  return { ...s, awardId };
}

describe("withdraw (A-03)", () => {
  it("archives an awarded listing and keeps its awards; restore brings it back", async () => {
    const env = await setup();
    const s = await awardedSite(env);
    expect(await env.t.query(api.listings.getPublicBySlug, { slug: s.slug })).toMatchObject({ status: "awarded" });
    const [mine] = await env.maker.query(api.listings.myListings, {});
    expect(mine).toMatchObject({ removal: "archive", canRestore: false });

    expect(await env.maker.mutation(api.listings.withdraw, { id: s.id })).toEqual({ result: "archived" });
    expect(await get(env, s.id)).toMatchObject({ status: "withdrawn", withdrawnFrom: "awarded", awards: ["HM"] });
    expect(await env.t.run((ctx) => ctx.db.get(s.awardId))).toMatchObject({ status: "active" });
    expect(await env.t.query(api.listings.getPublicBySlug, { slug: s.slug })).toBeNull();
    const [after] = await env.maker.query(api.listings.myListings, {});
    expect(after).toMatchObject({ status: "withdrawn", removal: null, canRestore: true });
    await expect(env.maker.mutation(api.listings.withdraw, { id: s.id })).rejects.toThrow(/already withdrawn/);

    await expect(env.other.mutation(api.listings.restore, { id: s.id })).rejects.toThrow(/not found/);
    await env.maker.mutation(api.listings.restore, { id: s.id });
    expect(await get(env, s.id)).toMatchObject({ status: "awarded", awards: ["HM"] });
    expect((await get(env, s.id))!.withdrawnFrom).toBeUndefined();
  });

  it("archives a published listing without awards too", async () => {
    const env = await setup();
    const s = await submit(env);
    await env.admin.mutation(api.listings.approve, { id: s.id, grantOwnership: true });
    expect(await env.maker.mutation(api.listings.withdraw, { id: s.id })).toEqual({ result: "archived" });
    expect(await get(env, s.id)).toMatchObject({ status: "withdrawn", withdrawnFrom: "in_voting" });
  });

  it("lets the submitter delete a never-public submission for good", async () => {
    const env = await setup();
    const s = await submit(env);
    const [mine] = await env.maker.query(api.listings.myListings, {});
    expect(mine).toMatchObject({ status: "pending", removal: "delete" });
    await expect(env.other.mutation(api.listings.withdraw, { id: s.id })).rejects.toThrow(/not found/);
    expect(await env.maker.mutation(api.listings.withdraw, { id: s.id })).toEqual({ result: "deleted" });
    expect(await get(env, s.id)).toBeNull();
    expect(await env.maker.query(api.listings.myListings, {})).toEqual([]);
  });

  it("a rejected listing that was once public is archived, not deleted", async () => {
    const env = await setup();
    const s = await submit(env);
    await env.admin.mutation(api.listings.approve, { id: s.id, grantOwnership: true });
    await env.admin.mutation(api.listings.reject, { id: s.id, note: "Broken link." });
    expect(await env.maker.mutation(api.listings.withdraw, { id: s.id })).toEqual({ result: "archived" });
    expect(await get(env, s.id)).toMatchObject({ status: "withdrawn", withdrawnFrom: "rejected" });
  });

  it("a submitter who wasn't given ownership can't take a public site down", async () => {
    const env = await setup();
    const s = await submit(env);
    await env.admin.mutation(api.listings.approve, { id: s.id, grantOwnership: false });
    const [mine] = await env.maker.query(api.listings.myListings, {});
    expect(mine).toMatchObject({ status: "in_voting", removal: null });
    await expect(env.maker.mutation(api.listings.withdraw, { id: s.id })).rejects.toThrow(/Only the site's owner/);
    expect(await get(env, s.id)).toMatchObject({ status: "in_voting" });
  });

  it("an admin can restore a withdrawn listing to the status it had", async () => {
    const env = await setup();
    const s = await awardedSite(env);
    await env.maker.mutation(api.listings.withdraw, { id: s.id });
    await expect(env.admin.mutation(api.admin.setLifecycle, { id: s.id, status: "withdrawn" })).rejects.toThrow(/Only the owner/);
    await env.admin.mutation(api.admin.setLifecycle, { id: s.id, status: "awarded" });
    expect(await get(env, s.id)).toMatchObject({ status: "awarded", awards: ["HM"] });
  });
});

describe("admin delete cascade (A-03, missing test #5)", () => {
  it("refuses while an award is active, then deletes with every dependent row once it is revoked", async () => {
    const env = await setup();
    const s = await awardedSite(env);
    // A later redesign of the same site points back at it.
    const r = await env.t.run(async (ctx) => {
      const listing = (await ctx.db.get(s.id))!;
      const { _id, _creationTime, ...rest } = listing;
      void _id;
      void _creationTime;
      const now = Date.now();
      const redesign = await ctx.db.insert("listings", { ...rest, slug: `${listing.slug}-2`, status: "pending", awards: [], redesignOf: s.id });
      const jurorId = await ctx.db.insert("jurors", { slug: "j", name: "J", title: "Designer", active: true, joinedAt: now, updatedAt: now });
      await ctx.db.insert("conflicts", { jurorId, listingId: s.id, reason: "Built it", declaredBy: "admin", createdAt: now });
      const roundId = await ctx.db.insert("rounds", {
        kind: "SOTM",
        period: "2026-11",
        candidates: [s.id],
        opensAt: now,
        closesAt: now + 1,
        announceAt: now + 2,
        status: "open",
        createdAt: now,
      });
      await ctx.db.insert("roundVotes", {
        roundId,
        listingId: s.id,
        jurorId,
        scores: { design: 8, usability: 8, creativity: 8, content: 8 },
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("emailLog", { to: "maker@example.com", subject: "You won", kind: "award", listingId: s.id, status: "sent", sentAt: now });
      await ctx.db.insert("socialPosts", { kind: "award", awardId: s.awardId, listingId: s.id, status: "sent", createdAt: now });
      await ctx.db.insert("socialPosts", { kind: "new_listing", listingId: s.id, status: "waiting", createdAt: now });
      await ctx.db.insert("listingRevisions", { listingId: s.id, source: "admin", before: {}, after: {}, createdAt: now });
      await ctx.db.insert("listingBriefs", { listingId: s.id, url: listing.url, status: "queued", rounds: 0, createdBy: listing.ownerId!, createdAt: now, updatedAt: now });
      return { redesign, roundId };
    });

    await expect(env.admin.mutation(api.listings.remove, { id: s.id })).rejects.toThrow(/Revoke/);
    expect(await get(env, s.id)).not.toBeNull();

    await env.admin.mutation(api.awards.revoke, { awardId: s.awardId, reason: "Mistake" });
    await env.admin.mutation(api.listings.remove, { id: s.id });

    const left = await env.t.run(async (ctx) => {
      const byListing = async (table: "conflicts" | "roundVotes" | "listingRevisions" | "listingBriefs") =>
        (await ctx.db.query(table).collect()).filter((r) => r.listingId === s.id).length;
      return {
        listing: await ctx.db.get(s.id),
        awards: (await ctx.db.query("awards").collect()).length,
        conflicts: await byListing("conflicts"),
        roundVotes: await byListing("roundVotes"),
        revisions: await byListing("listingRevisions"),
        briefs: await byListing("listingBriefs"),
        redesign: await ctx.db.get(r.redesign),
        round: await ctx.db.get(r.roundId),
        posts: await ctx.db.query("socialPosts").collect(),
        emails: await ctx.db.query("emailLog").collect(),
        audit: await ctx.db.query("awardAudit").collect(),
      };
    });
    expect(left.listing).toBeNull();
    expect(left.awards).toBe(0);
    expect(left.conflicts + left.roundVotes + left.revisions + left.briefs).toBe(0);
    expect(left.redesign!.redesignOf).toBeUndefined();
    expect(left.round!.candidates).toEqual([]);
    // The sent post and the email stay as history, unlinked; the unsent posts are gone.
    expect(left.posts.map((p) => [p.status, p.listingId, p.awardId])).toEqual([["sent", undefined, undefined]]);
    expect(left.emails.map((e) => e.listingId)).toEqual([undefined]);
    // The award log keeps every entry (unlinked) plus one saying what was deleted.
    expect(left.audit.every((a) => a.listingId === undefined)).toBe(true);
    expect(left.audit.find((a) => a.kind === "listing_deleted")!.details).toMatchObject({
      slug: s.slug,
      revokedAwards: [{ tier: "HM" }],
    });
    expect(left.audit.filter((a) => a.kind === "granted" || a.kind === "revoked")).toHaveLength(2);
  });
});

describe("submission ownership (A-05)", () => {
  it("records the submitter without claiming the listing or its new creator", async () => {
    const env = await setup();
    const s = await submit(env, "maker", { creditName: "Fold & Co." });
    const row = (await get(env, s.id))!;
    expect(row).toMatchObject({ submittedBy: env.ids.maker, isClaimed: false, status: "pending" });
    expect(row.ownerId).toBeUndefined();
    const creator = (await env.t.run((ctx) => ctx.db.get(row.creatorId!)))!;
    expect(creator).toMatchObject({ slug: "fold-co", isClaimed: false });
    expect(creator.claimedBy).toBeUndefined();
    // Not public, so neither is the profile.
    expect(await env.t.query(api.creators.getBySlug, { slug: "fold-co" })).toBeNull();
  });

  it("doesn't attach a submission to someone else's claimed creator profile", async () => {
    const env = await setup();
    const studio = await env.t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("creators", {
        slug: "big-studio",
        name: "Big Studio",
        tier: "agency",
        region: "global",
        isClaimed: true,
        claimedBy: env.ids.other,
        createdAt: now,
        updatedAt: now,
      });
    });
    const s = await submit(env, "maker", { creditName: "Big Studio" });
    const row = (await get(env, s.id))!;
    expect(row.creatorId).toBeUndefined();
    expect(await env.t.run((ctx) => ctx.db.get(studio))).toMatchObject({ claimedBy: env.ids.other });
    // The admin sees the match and decides.
    expect(await env.admin.query(api.listings.reviewDetail, { id: s.id })).toMatchObject({
      creator: null,
      creditMatch: { slug: "big-studio", isClaimed: true },
      canGrantOwnership: true,
      owner: null,
      submitter: { name: "maker" },
    });
    // Approved without linking: still not on Big Studio's profile.
    await env.admin.mutation(api.listings.approve, { id: s.id, grantOwnership: true });
    expect((await get(env, s.id))!.creatorId).toBeUndefined();
    expect(await env.t.run((ctx) => ctx.db.get(studio))).toMatchObject({ claimedBy: env.ids.other });
  });

  it("the admin can link the matching profile when approving", async () => {
    const env = await setup();
    const studio = await env.t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("creators", {
        slug: "big-studio",
        name: "Big Studio",
        tier: "agency",
        region: "global",
        isClaimed: true,
        claimedBy: env.ids.other,
        createdAt: now,
        updatedAt: now,
      });
    });
    const s = await submit(env, "maker", { creditName: "Big Studio" });
    await env.admin.mutation(api.listings.approve, { id: s.id, linkCreator: true });
    expect(await get(env, s.id)).toMatchObject({ creatorId: studio, isClaimed: false });
  });

  it("approval with ownership grants it; without, the site goes live unowned", async () => {
    const env = await setup();
    const owned = await submit(env);
    await expect(env.maker.mutation(api.listings.approve, { id: owned.id, grantOwnership: true })).rejects.toThrow(/admin/);
    await env.admin.mutation(api.listings.approve, { id: owned.id, grantOwnership: true });
    const row = (await get(env, owned.id))!;
    expect(row).toMatchObject({ status: "in_voting", ownerId: env.ids.maker, isClaimed: true });
    expect(await env.t.run((ctx) => ctx.db.get(row.creatorId!))).toMatchObject({ isClaimed: true, claimedBy: env.ids.maker });
    expect(await env.t.query(api.listings.getPublicBySlug, { slug: owned.slug })).toMatchObject({ isClaimed: true, isDoFollow: true });

    const unowned = await submit(env);
    await env.admin.mutation(api.listings.approve, { id: unowned.id });
    const row2 = (await get(env, unowned.id))!;
    expect(row2).toMatchObject({ status: "in_voting", isClaimed: false, submittedBy: env.ids.maker });
    expect(row2.ownerId).toBeUndefined();
    expect(await env.t.run((ctx) => ctx.db.get(row2.creatorId!))).toMatchObject({ isClaimed: false });
    expect(await env.t.query(api.listings.getPublicBySlug, { slug: unowned.slug })).toMatchObject({ isClaimed: false, isDoFollow: false });
    // Still their own site to vote on, owned or not.
    expect(await env.maker.query(api.votes.eligibility, { slug: unowned.slug })).toMatchObject({ canVote: false, kind: "own" });
  });

  it("the migration hands older pending submissions back to review", async () => {
    const env = await setup();
    const s = await submit(env);
    const creatorId = (await get(env, s.id))!.creatorId!;
    // As submit used to leave it: owned and claimed, with a claimed profile.
    await env.t.run(async (ctx) => {
      await ctx.db.patch(s.id, { ownerId: env.ids.maker, submittedBy: undefined, isClaimed: true });
      await ctx.db.patch(creatorId, { isClaimed: true, claimedBy: env.ids.maker });
    });
    expect(await env.t.mutation(internal.migrations.unclaimPendingSubmissions, {})).toEqual({ listings: 1, creators: 1 });
    const row = (await get(env, s.id))!;
    expect(row).toMatchObject({ submittedBy: env.ids.maker, isClaimed: false });
    expect(row.ownerId).toBeUndefined();
    expect(await env.t.run((ctx) => ctx.db.get(creatorId))).toMatchObject({ isClaimed: false });
    expect(await env.t.mutation(internal.migrations.unclaimPendingSubmissions, {})).toEqual({ listings: 0, creators: 0 });
  });

  it("ownership doesn't take over a creator profile that credits other sites", async () => {
    const env = await setup();
    const first = await submit(env, "other", { creditName: "Shared Name" });
    await env.admin.mutation(api.listings.approve, { id: first.id });
    const second = await submit(env, "maker", { creditName: "Shared Name" });
    await env.admin.mutation(api.listings.approve, { id: second.id, grantOwnership: true });
    const row = (await get(env, second.id))!;
    expect(row).toMatchObject({ ownerId: env.ids.maker, isClaimed: true });
    expect(await env.t.run((ctx) => ctx.db.get(row.creatorId!))).toMatchObject({ isClaimed: false });
    expect(await count(env, "listings")).toBe(2);
  });
});
