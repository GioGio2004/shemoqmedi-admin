/// <reference types="vite/client" />
// Claim links (convex/claimLinks.ts): bound to the invited email, 14-day
// expiry, stored hashed and shown once, single use, admin activation for
// unverified jurors, and taking a claim back.
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { mintServiceCredential } from "../convex/lib/tokens";
import { CLAIM_LINK_TTL, hashClaimToken } from "../convex/claimLinks";

const modules = import.meta.glob("../convex/**/*.{ts,js}");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  await t.run(async (ctx) => {
    const mk = (externalId: string, email: string, extra: Record<string, unknown> = {}) =>
      ctx.db.insert("users", { externalId, name: externalId, email, createdAt: now, updatedAt: now, ...extra });
    await mk("admin", "admin@example.com", { role: "super_admin" });
    await mk("ana", "ana@example.com");
    await mk("ana2", "ana.personal@gmail.com"); // Ana's other Google account
    await mk("stranger", "stranger@example.com");
  });
  const admin = t.withIdentity({ subject: "admin" });
  const coverId = await t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/png" })));
  const site = await admin.mutation(api.admin.createListing, {
    title: "Kencho Room",
    tagline: "Kitchens",
    url: "https://room.example.ge",
    categories: ["architecture"],
    technologies: ["React"],
    region: "georgia",
    creatorTier: "solo",
    creditName: "Kencho",
    coverId,
    status: "in_voting",
    isClaimed: false,
  });
  return {
    t,
    admin,
    site,
    ana: t.withIdentity({ subject: "ana" }),
    ana2: t.withIdentity({ subject: "ana2" }),
    stranger: t.withIdentity({ subject: "stranger" }),
  };
}
type Env = Awaited<ReturnType<typeof setup>>;
const tokenOf = (url: string) => url.split("/claim/")[1];

async function juror(env: Env, extra: Record<string, unknown> = {}) {
  const { id, slug } = await env.admin.mutation(api.jury.createJuror, {
    name: "Ana Beridze",
    title: "Designer",
    category: "design",
    ...extra,
  });
  const { url, expiresAt } = await env.admin.action(api.claimLinks.link, { target: { kind: "juror", id } });
  return { id, slug, token: tokenOf(url), expiresAt };
}

const isPublic = async (env: Env, slug: string) => (await env.t.query(api.jury.getBySlug, { slug })) !== null;

describe("claim links are bound to the invited email", () => {
  it("rejects an account with another email, naming the signed-in address", async () => {
    const env = await setup();
    const { id, slug, token } = await juror(env, { email: "ana@example.com" });
    // The preview hints which address to use, without giving it away.
    expect(await env.t.query(api.claimLinks.resolve, { token })).toMatchObject({ state: "open", emailHint: "an•••@example.com" });

    await expect(env.ana2.mutation(api.claimLinks.claim, { token })).rejects.toThrow(
      /different email address\. You're signed in as ana\.personal@gmail\.com\. Sign out and sign in with the address/,
    );
    // A forwarded link is no use to a stranger either.
    await expect(env.stranger.mutation(api.claimLinks.claim, { token })).rejects.toThrow(/stranger@example\.com/);
    // Nothing changed: still unclaimed, private and claimable.
    const row = (await env.t.run((ctx) => ctx.db.get(id)))!;
    expect(row).toMatchObject({ status: "unclaimed" });
    expect(row.userId).toBeUndefined();
    expect(await isPublic(env, slug)).toBe(false);
    expect((await env.t.query(api.claimLinks.resolve, { token })).state).toBe("open");
  });

  it("a matching email (any case) claims and goes public at once", async () => {
    const env = await setup();
    const { slug, token } = await juror(env, { email: "Ana@Example.COM" });
    expect(await env.ana.mutation(api.claimLinks.claim, { token })).toEqual({
      kind: "juror",
      redirect: "/jury/profile?claimed=1",
      pending: false,
    });
    expect(await isPublic(env, slug)).toBe(true);
    expect(await env.ana.query(api.jury.me, {})).toMatchObject({ name: "Ana Beridze" });
    const [row] = await env.admin.query(api.jury.adminOverview, {});
    expect(row).toMatchObject({ status: "claimed", active: true, claimPending: false });
  });

  it("a listing link emailed to a studio only works for that inbox's account", async () => {
    const env = await setup();
    const token = "c".repeat(64);
    await env.t.run(async (ctx) => {
      const { ensureListingClaimUrl } = await import("../convex/claimLinks");
      await ensureListingClaimUrl(ctx, env.site.id, token, "Ana@example.com");
    });
    await expect(env.stranger.mutation(api.claimLinks.claim, { token })).rejects.toThrow(/different email address/);
    expect((await env.ana.mutation(api.claimLinks.claim, { token })).kind).toBe("listing");
    expect((await env.ana.query(api.listings.myListings, {})).map((l) => l.slug)).toEqual([env.site.slug]);
  });
});

describe("no email on file", () => {
  it("the claim goes through but the profile stays private until an admin activates it", async () => {
    const env = await setup();
    const { id, slug, token } = await juror(env);
    expect((await env.t.query(api.claimLinks.resolve, { token })).emailHint).toBeNull();
    expect(await env.ana.mutation(api.claimLinks.claim, { token })).toEqual({
      kind: "juror",
      redirect: "/account?jury=pending",
      pending: true,
    });
    expect(await isPublic(env, slug)).toBe(false);
    expect(await env.t.query(api.jury.listPublic, {})).toEqual([]);
    expect(await env.ana.query(api.jury.me, {})).toBeNull();
    // Re-opening the link says the same.
    expect((await env.ana.mutation(api.claimLinks.claim, { token })).pending).toBe(true);
    const [row] = await env.admin.query(api.jury.adminOverview, {});
    expect(row).toMatchObject({ status: "claimed", active: false, claimPending: true, accountEmail: "ana@example.com" });

    await expect(env.ana.mutation(api.claimLinks.activateJuror, { jurorId: id })).rejects.toThrow(/admin/);
    await env.admin.mutation(api.claimLinks.activateJuror, { jurorId: id });
    expect(await isPublic(env, slug)).toBe(true);
    expect((await env.admin.query(api.jury.adminOverview, {}))[0]).toMatchObject({ active: true, claimPending: false });
    const log = await env.admin.query(api.awards.auditLog, { limit: 10 });
    expect(log.map((r) => r.kind)).toContain("juror_activated");
  });
});

describe("expiry and reuse", () => {
  it("a link older than 14 days is refused with a clear message", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-11-01T10:00:00Z"));
    const env = await setup();
    const { token, expiresAt } = await juror(env, { email: "ana@example.com" });
    expect(Math.abs(expiresAt - (Date.now() + CLAIM_LINK_TTL))).toBeLessThan(1000);
    vi.setSystemTime(Date.now() + CLAIM_LINK_TTL + 1000);
    expect((await env.t.query(api.claimLinks.resolve, { token })).state).toBe("expired");
    await expect(env.ana.mutation(api.claimLinks.claim, { token })).rejects.toThrow(/expired.*14 days.*new one/);
    // A new link works.
    const [row] = await env.admin.query(api.jury.adminOverview, {});
    const fresh = await env.admin.action(api.claimLinks.link, { target: { kind: "juror", id: row.id } });
    expect((await env.ana.mutation(api.claimLinks.claim, { token: tokenOf(fresh.url) })).pending).toBe(false);
  });

  it("a used link can't be used by another account; its claimer is just redirected", async () => {
    const env = await setup();
    const { url } = await env.admin.action(api.claimLinks.link, { target: { kind: "listing", id: env.site.id } });
    const token = tokenOf(url);
    await env.ana.mutation(api.claimLinks.claim, { token });
    await expect(env.stranger.mutation(api.claimLinks.claim, { token })).rejects.toThrow(
      /already been used by another account/,
    );
    expect(await env.ana.mutation(api.claimLinks.claim, { token })).toEqual({
      kind: "listing",
      redirect: `/sites/${env.site.slug}`,
      pending: false,
    });
    expect((await env.t.query(api.claimLinks.resolve, { token })).state).toBe("claimed");
  });
});

describe("tokens are stored hashed and shown once", () => {
  it("no query, row or MCP read returns the raw token", async () => {
    vi.stubEnv("MCP_SERVICE_SECRET", "test-secret-test-secret-test-secret");
    const env = await setup();
    const { id, token } = await juror(env, { email: "ana@example.com" });
    const listingLink = tokenOf((await env.admin.action(api.claimLinks.link, { target: { kind: "listing", id: env.site.id } })).url);

    const reads = [
      await env.admin.query(api.claimLinks.outreach, {}),
      await env.admin.query(api.jury.adminOverview, {}),
      await env.admin.query(api.listings.reviewDetail, { id: env.site.id }),
      await env.t.query(api.claimLinks.resolve, { token }),
      await env.t.query(api.mcp.getListing, { token: (await mintServiceCredential("admin"))!, slug: env.site.slug }),
    ];
    for (const r of reads) {
      const text = JSON.stringify(r);
      expect(text).not.toContain(token);
      expect(text).not.toContain(listingLink);
    }
    // Status only: there is an open link, and when it expires.
    const outreach = reads[0] as { jurors: { claimLink: unknown }[]; listings: { claimLink: unknown }[] };
    expect(outreach.jurors[0].claimLink).toEqual({ expiresAt: expect.any(Number) });
    expect(outreach.listings[0].claimLink).toEqual({ expiresAt: expect.any(Number) });

    // The database holds the hash, never the token.
    const dump = await env.t.run(async (ctx) => ({
      links: await ctx.db.query("claimLinks").collect(),
      juror: await ctx.db.get(id as Id<"jurors">),
      listing: await ctx.db.get(env.site.id),
    }));
    expect(JSON.stringify(dump)).not.toContain(token);
    expect(dump.links.map((l) => l.tokenHash)).toContain(await hashClaimToken(token));
  });

  it("old plaintext tokens keep working until the migration hashes them", async () => {
    const env = await setup();
    const legacy = "b".repeat(64);
    const usedLegacy = "d".repeat(64);
    const now = Date.now();
    const anaId = await env.t.run(async (ctx) => {
      const user = (await ctx.db.query("users").withIndex("byExternalId", (q) => q.eq("externalId", "ana")).first())!;
      await ctx.db.insert("jurors", {
        status: "unclaimed",
        slug: "nino",
        name: "Nino",
        title: "Designer",
        claimToken: legacy,
        active: true,
        joinedAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(env.site.id, { isClaimed: true, ownerId: user._id, claimTokenUsed: usedLegacy });
      return user._id;
    });
    expect((await env.t.query(api.claimLinks.resolve, { token: legacy })).state).toBe("open");

    expect(await env.t.mutation(internal.migrations.hashClaimTokens, {})).toEqual({ open: 1, used: 1, dropped: 0 });
    const after = await env.t.run(async (ctx) => ({
      juror: await ctx.db.query("jurors").withIndex("by_slug", (q) => q.eq("slug", "nino")).first(),
      listing: await ctx.db.get(env.site.id),
    }));
    expect(after.juror!.claimToken).toBeUndefined();
    expect(after.listing!.claimTokenUsed).toBeUndefined();
    // Running it again changes nothing.
    expect(await env.t.mutation(internal.migrations.hashClaimTokens, {})).toEqual({ open: 0, used: 0, dropped: 0 });

    // The migrated links still resolve: open (now with an expiry), and the used one redirects its owner.
    expect((await env.t.query(api.claimLinks.resolve, { token: legacy })).state).toBe("open");
    expect((await env.ana.mutation(api.claimLinks.claim, { token: usedLegacy })).redirect).toBe(`/sites/${env.site.slug}`);
    expect((await env.stranger.mutation(api.claimLinks.claim, { token: legacy })).pending).toBe(true);
    expect(anaId).toBeTruthy();
  });
});

describe("taking a claim back", () => {
  it("clears the owner of a listing and a juror, logs it, and lets a new link hand it on", async () => {
    const env = await setup();
    const { url } = await env.admin.action(api.claimLinks.link, { target: { kind: "listing", id: env.site.id } });
    const token = tokenOf(url);
    await env.stranger.mutation(api.claimLinks.claim, { token });
    expect((await env.t.run((ctx) => ctx.db.get(env.site.id)))!.ownerId).toBeDefined();

    await expect(
      env.stranger.mutation(api.claimLinks.unclaim, { target: { kind: "listing", id: env.site.id } }),
    ).rejects.toThrow(/admin/);
    await env.admin.mutation(api.claimLinks.unclaim, { target: { kind: "listing", id: env.site.id }, reason: "Wrong account" });
    const listing = (await env.t.run((ctx) => ctx.db.get(env.site.id)))!;
    expect(listing.isClaimed).toBe(false);
    expect(listing.ownerId).toBeUndefined();
    expect(await env.stranger.query(api.listings.myListings, {})).toEqual([]);
    // The old link is dead for everyone, even its old claimer.
    expect((await env.t.query(api.claimLinks.resolve, { token })).state).toBe("invalid");
    await expect(env.stranger.mutation(api.claimLinks.claim, { token })).rejects.toThrow(/not valid/);
    const fresh = await env.admin.action(api.claimLinks.link, { target: { kind: "listing", id: env.site.id } });
    await env.ana.mutation(api.claimLinks.claim, { token: tokenOf(fresh.url) });
    expect((await env.ana.query(api.listings.myListings, {})).map((l) => l.slug)).toEqual([env.site.slug]);

    const j = await juror(env, { email: "ana@example.com" });
    await env.ana.mutation(api.claimLinks.claim, { token: j.token });
    await env.admin.mutation(api.claimLinks.unclaim, { target: { kind: "juror", id: j.id } });
    const row = (await env.t.run((ctx) => ctx.db.get(j.id)))!;
    expect(row).toMatchObject({ status: "unclaimed" });
    expect(row.userId).toBeUndefined();
    expect(row.claimedAt).toBeUndefined();
    expect(await isPublic(env, j.slug)).toBe(false);
    expect(await env.ana.query(api.jury.me, {})).toBeNull();

    const log = await env.admin.query(api.awards.auditLog, { limit: 10 });
    expect(log.filter((r) => r.kind === "unclaimed")).toHaveLength(2);
  });

  it("un-ticking Claimed in the listing editor clears the owner too", async () => {
    const env = await setup();
    const { url } = await env.admin.action(api.claimLinks.link, { target: { kind: "listing", id: env.site.id } });
    await env.ana.mutation(api.claimLinks.claim, { token: tokenOf(url) });
    await env.admin.mutation(api.admin.updateListing, { id: env.site.id, isClaimed: false });
    expect((await env.t.run((ctx) => ctx.db.get(env.site.id)))!.ownerId).toBeUndefined();
    expect(await env.ana.query(api.listings.myListings, {})).toEqual([]);
  });
});
