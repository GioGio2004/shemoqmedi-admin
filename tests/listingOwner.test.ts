/// <reference types="vite/client" />
// An admin assigns a listing's owner directly (no claim link), changes or removes them.
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.{ts,js}");

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  await t.run(async (ctx) => {
    const mk = (externalId: string, name: string, extra: Record<string, unknown> = {}) =>
      ctx.db.insert("users", { externalId, name, email: `${externalId}@example.com`, createdAt: now, updatedAt: now, ...extra });
    await mk("admin", "Admin", { role: "super_admin" });
    await mk("nino", "Nino Studio");
    await mk("luka", "Luka Agency");
  });
  const admin = t.withIdentity({ subject: "admin" });
  const nino = t.withIdentity({ subject: "nino" });
  const luka = t.withIdentity({ subject: "luka" });
  const userId = (externalId: string) =>
    t.run(async (ctx) => (await ctx.db.query("users").withIndex("byExternalId", (q) => q.eq("externalId", externalId)).first())!._id);
  async function listing(extra: Record<string, unknown> = {}) {
    const coverId = await t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/png" })));
    return admin.mutation(api.admin.createListing, {
      title: "Kencho Room",
      tagline: "Kitchens",
      url: `https://room-${Math.random().toString(36).slice(2, 8)}.example.ge`,
      categories: ["architecture"],
      technologies: ["React"],
      region: "georgia",
      creatorTier: "solo",
      creditName: "Kencho",
      coverId,
      status: "in_voting",
      isClaimed: false,
      ...extra,
    });
  }
  return { t, admin, nino, luka, userId, listing };
}

const detail = (env: Awaited<ReturnType<typeof setup>>, id: Awaited<ReturnType<Awaited<ReturnType<typeof setup>>["listing"]>>["id"]) =>
  env.admin.query(api.listings.reviewDetail, { id });

describe("admin assigns a listing's owner", () => {
  it("finds accounts by name or email, admins only", async () => {
    const env = await setup();
    const byEmail = await env.admin.query(api.claimLinks.ownerCandidates, { search: "nino@example.com" });
    expect(byEmail.map((u) => u.name)).toEqual(["Nino Studio"]);
    const byName = await env.admin.query(api.claimLinks.ownerCandidates, { search: "agen" });
    expect(byName.map((u) => u.email)).toEqual(["luka@example.com"]);
    expect(await env.admin.query(api.claimLinks.ownerCandidates, { search: "n" })).toEqual([]);
    await expect(env.nino.query(api.claimLinks.ownerCandidates, { search: "luka" })).rejects.toThrow();
  });

  it("makes an account the owner with no claim link: claimed, followed, open link revoked, logged", async () => {
    const env = await setup();
    const { id } = await env.listing();
    const { url } = await env.admin.action(api.claimLinks.link, { target: { kind: "listing", id } });
    const ninoId = await env.userId("nino");

    const out = await env.admin.mutation(api.claimLinks.setListingOwner, { listingId: id, userId: ninoId, reason: "Asked by email" });
    expect(out.owner).toMatchObject({ id: ninoId, name: "Nino Studio" });
    const row = await detail(env, id);
    expect(row).toMatchObject({ isClaimed: true, isDoFollow: true, owner: { id: ninoId, email: "nino@example.com" } });
    // The claim link sent earlier no longer hands the site to anyone else.
    const link = await env.t.query(api.claimLinks.resolve, { token: url.split("/claim/")[1] });
    expect(link.state).not.toBe("open");
    await expect(env.luka.mutation(api.claimLinks.claim, { token: url.split("/claim/")[1] })).rejects.toThrow();
    // The owner sees it in their account.
    expect((await env.nino.query(api.listings.myListings, {})).map((l) => l.id)).toContain(id);
    const log = await env.admin.query(api.awards.auditLog, { limit: 10 });
    expect(log.some((r) => r.kind === "owner_assigned")).toBe(true);
  });

  it("changes the owner, then removes them", async () => {
    const env = await setup();
    const { id } = await env.listing();
    const ninoId = await env.userId("nino");
    const lukaId = await env.userId("luka");
    await env.admin.mutation(api.claimLinks.setListingOwner, { listingId: id, userId: ninoId });
    await env.admin.mutation(api.claimLinks.setListingOwner, { listingId: id, userId: lukaId });
    expect((await detail(env, id))!.owner!.id).toBe(lukaId);
    expect((await env.nino.query(api.listings.myListings, {})).map((l) => l.id)).not.toContain(id);

    await env.admin.mutation(api.claimLinks.setListingOwner, { listingId: id, userId: null });
    expect(await detail(env, id)).toMatchObject({ owner: null, isClaimed: false, isDoFollow: false });
    // Removing again is a no-op, not an error.
    await env.admin.mutation(api.claimLinks.setListingOwner, { listingId: id, userId: null });
  });

  it("only admins can assign an owner", async () => {
    const env = await setup();
    const { id } = await env.listing();
    const ninoId = await env.userId("nino");
    await expect(env.nino.mutation(api.claimLinks.setListingOwner, { listingId: id, userId: ninoId })).rejects.toThrow();
    expect((await detail(env, id))!.owner).toBeNull();
  });

  it("the creator profile goes with the owner, moves on a change and is released on removal", async () => {
    const env = await setup();
    const { id } = await env.listing();
    const ninoId = await env.userId("nino");
    const lukaId = await env.userId("luka");
    const creator = async () => (await detail(env, id))!.creator!;
    expect(await creator()).toMatchObject({ isClaimed: false, claimedBy: null });

    const out = await env.admin.mutation(api.claimLinks.setListingOwner, { listingId: id, userId: ninoId });
    expect(out.creatorProfile).toBe(true);
    expect(await creator()).toMatchObject({ isClaimed: true, claimedBy: { id: ninoId, name: "Nino Studio" } });
    // The public profile is claimed now: no "Claim this profile".
    const slug = (await creator()).slug;
    expect((await env.t.query(api.creators.getBySlug, { slug }))!.creator.isClaimed).toBe(true);

    await env.admin.mutation(api.claimLinks.setListingOwner, { listingId: id, userId: lukaId });
    expect((await creator()).claimedBy!.id).toBe(lukaId);

    await env.admin.mutation(api.claimLinks.setListingOwner, { listingId: id, userId: null });
    expect(await creator()).toMatchObject({ isClaimed: false, claimedBy: null });
  });

  it("assigning the same owner again hands over a profile left behind (listings assigned before)", async () => {
    const env = await setup();
    const { id } = await env.listing();
    const ninoId = await env.userId("nino");
    await env.admin.mutation(api.claimLinks.setListingOwner, { listingId: id, userId: ninoId });
    // As it was before profiles moved with owners: owned listing, unclaimed profile.
    const creatorId = await env.t.run(async (ctx) => {
      const l = await ctx.db.get(id);
      await ctx.db.patch(l!.creatorId!, { isClaimed: false, claimedBy: undefined });
      return l!.creatorId!;
    });
    const out = await env.admin.mutation(api.claimLinks.setListingOwner, { listingId: id, userId: ninoId });
    expect(out.creatorProfile).toBe(true);
    const row = await env.t.run((ctx) => ctx.db.get(creatorId));
    expect(row).toMatchObject({ isClaimed: true, claimedBy: ninoId });
  });

  it("never takes a creator profile another account holds", async () => {
    const env = await setup();
    const { id } = await env.listing();
    const ninoId = await env.userId("nino");
    const lukaId = await env.userId("luka");
    await env.t.run(async (ctx) => {
      const l = await ctx.db.get(id);
      await ctx.db.patch(l!.creatorId!, { isClaimed: true, claimedBy: lukaId });
    });
    const out = await env.admin.mutation(api.claimLinks.setListingOwner, { listingId: id, userId: ninoId });
    expect(out.creatorProfile).toBe(false);
    expect((await detail(env, id))!.creator!.claimedBy!.id).toBe(lukaId);
    // Taking the listing from Nino leaves Luka's profile alone too.
    await env.admin.mutation(api.claimLinks.setListingOwner, { listingId: id, userId: null });
    expect((await detail(env, id))!.creator!.claimedBy!.id).toBe(lukaId);
  });

  it("removing an owner keeps the profile when they own another site credited to it", async () => {
    const env = await setup();
    const ninoId = await env.userId("nino");
    const first = await env.listing();
    const second = await env.listing();
    await env.admin.mutation(api.claimLinks.setListingOwner, { listingId: first.id, userId: ninoId });
    await env.admin.mutation(api.claimLinks.setListingOwner, { listingId: second.id, userId: ninoId });
    await env.admin.mutation(api.claimLinks.setListingOwner, { listingId: first.id, userId: null });
    expect((await detail(env, second.id))!.creator!.claimedBy!.id).toBe(ninoId);
  });

  it("the creator profile shows the owner's jury photo when they have no account photo", async () => {
    const env = await setup();
    const { id } = await env.listing();
    const lukaId = await env.userId("luka");
    await env.t.run(async (ctx) => {
      const avatarId = await ctx.storage.store(new Blob(["jpg"], { type: "image/jpeg" }));
      await ctx.db.insert("jurors", {
        userId: lukaId,
        status: "claimed",
        slug: "luka-agency",
        name: "Luka Agency",
        title: "Designer",
        avatarId,
        active: true,
        joinedAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    await env.admin.mutation(api.claimLinks.setListingOwner, { listingId: id, userId: lukaId });
    const slug = (await detail(env, id))!.creator!.slug;
    const page = await env.t.query(api.creators.getBySlug, { slug });
    expect(page!.creator.photoUrl).toMatch(/^https?:\/\//);
    // Their own account photo still wins.
    await env.t.run((ctx) => ctx.db.patch(lukaId, { hasImage: true, profilePicture: "https://img.clerk.com/luka.png" }));
    expect((await env.t.query(api.creators.getBySlug, { slug }))!.creator.photoUrl).toBe("https://img.clerk.com/luka.png");
  });

  it("a listing can be created with its owner already set", async () => {
    const env = await setup();
    const ninoId = await env.userId("nino");
    const { id } = await env.listing({ ownerId: ninoId });
    expect(await detail(env, id)).toMatchObject({ isClaimed: true, owner: { id: ninoId }, creator: { isClaimed: true, claimedBy: { id: ninoId } } });
    const missing = await env.t.run(async (ctx) => {
      const gone = await ctx.db.insert("users", { externalId: "gone", name: "Gone", email: "gone@example.com", createdAt: 0, updatedAt: 0 });
      await ctx.db.delete(gone);
      return gone;
    });
    await expect(env.listing({ ownerId: missing })).rejects.toThrow(/no longer exists/);
  });
});
