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

  it("a listing can be created with its owner already set", async () => {
    const env = await setup();
    const ninoId = await env.userId("nino");
    const { id } = await env.listing({ ownerId: ninoId });
    expect(await detail(env, id)).toMatchObject({ isClaimed: true, owner: { id: ninoId } });
    const missing = await env.t.run(async (ctx) => {
      const gone = await ctx.db.insert("users", { externalId: "gone", name: "Gone", email: "gone@example.com", createdAt: 0, updatedAt: 0 });
      await ctx.db.delete(gone);
      return gone;
    });
    await expect(env.listing({ ownerId: missing })).rejects.toThrow(/no longer exists/);
  });
});
