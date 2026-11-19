/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.{ts,js}");

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
  const ownerId = await user("owner", "Site Owner");
  const removerId = await user("remover", "Remover");
  const adminId = await user("admin", "Admin", "admin");
  const coverId = await t.run((ctx) => ctx.storage.store(new Blob(["bytes"], { type: "image/png" })));
  const { id: listingId } = await t.mutation(internal.importer.insertImported, {
    url: "https://floema.pt",
    title: "Floema",
    tagline: "Furniture, quietly.",
    category: "architecture",
    technologies: ["WebGL"],
    region: "global",
    creatorTier: "agency",
    creditName: "Bürocratik",
    status: "in_voting",
    votingDaysLeft: 6,
    isClaimed: false,
    coverId,
    source: "seed",
  });
  return {
    t,
    ownerId,
    removerId,
    adminId,
    listingId: listingId as Id<"listings">,
    owner: t.withIdentity({ subject: "owner" }),
    remover: t.withIdentity({ subject: "remover" }),
    admin: t.withIdentity({ subject: "admin" }),
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

const listing = (env: Env) => env.t.run((ctx) => ctx.db.get(env.listingId));
const pending = (env: Env) => env.admin.query(api.claims.queue, { status: "pending" });
const claimRow = (env: Env, id: Id<"claims">) => env.t.run((ctx) => ctx.db.get(id));

async function fileBoth(env: Env) {
  await env.owner.mutation(api.claims.submit, {
    targetType: "listing",
    slug: "floema",
    message: "I built it.",
    intent: "claim",
  });
  await env.remover.mutation(api.claims.submit, {
    targetType: "listing",
    slug: "floema",
    message: "Take it down.",
    intent: "remove",
  });
  const rows = await pending(env);
  return { claim: rows.find((r) => r.intent === "claim")!, removal: rows.find((r) => r.intent === "remove")! };
}

describe("claims: removal requests vs ownership claims", () => {
  it("approving a removal request takes the site down and never hands over ownership", async () => {
    const env = await setup();
    await env.remover.mutation(api.claims.submit, {
      targetType: "listing",
      slug: "floema",
      message: "Please take this down, it's an old version of our site.",
      intent: "remove",
    });
    const [request] = await pending(env);
    expect(request).toMatchObject({ intent: "remove", target: { isPublic: true } });

    await env.admin.mutation(api.claims.approve, { id: request.id });

    const after = await listing(env);
    // Taken down (reversible status), not deleted, and nobody owns it.
    expect(after).toMatchObject({ slug: "floema", status: "rejected", isClaimed: false, reviewedBy: env.adminId });
    expect(after!.ownerId).toBeUndefined();
    expect(await env.t.query(api.listings.getPublicBySlug, { slug: "floema" })).toBeNull();
    expect(await claimRow(env, request.id)).toMatchObject({
      status: "approved",
      intent: "remove",
      reviewedBy: env.adminId,
    });
  });

  it("treats an old row whose message starts with the removal prefix as a removal", async () => {
    const env = await setup();
    // A row written before `intent` existed.
    const id = await env.t.run((ctx) =>
      ctx.db.insert("claims", {
        targetType: "listing",
        listingId: env.listingId,
        userId: env.removerId,
        message: "Removal request: we never agreed to be listed.",
        status: "pending",
        createdAt: Date.now(),
      }),
    );
    const [row] = await pending(env);
    expect(row).toMatchObject({ id, intent: "remove" });

    await env.admin.mutation(api.claims.approve, { id });
    const after = await listing(env);
    expect(after).toMatchObject({ status: "rejected", isClaimed: false });
    expect(after!.ownerId).toBeUndefined();
  });

  it("an old storefront that only sends the prefix still files a removal", async () => {
    const env = await setup();
    await env.remover.mutation(api.claims.submit, {
      targetType: "listing",
      slug: "floema",
      message: "Removal request: not ours to show.",
    });
    const [row] = await pending(env);
    expect(row.intent).toBe("remove");
  });

  it("a removal can't target a creator profile", async () => {
    const env = await setup();
    await expect(
      env.remover.mutation(api.claims.submit, {
        targetType: "creator",
        slug: "burocratik",
        message: "Remove us",
        intent: "remove",
      }),
    ).rejects.toThrow(/Only a site/);
  });

  it("approving a claim still grants ownership and records the reviewer", async () => {
    const env = await setup();
    await env.owner.mutation(api.claims.submit, {
      targetType: "listing",
      slug: "floema",
      message: "I built it.",
      intent: "claim",
    });
    const [claim] = await pending(env);
    expect(claim.intent).toBe("claim");
    await env.admin.mutation(api.claims.approve, { id: claim.id });

    expect(await listing(env)).toMatchObject({ status: "in_voting", isClaimed: true, ownerId: env.ownerId });
    expect(await claimRow(env, claim.id)).toMatchObject({ status: "approved", reviewedBy: env.adminId });
  });

  it("approving a claim leaves a pending removal request open", async () => {
    const env = await setup();
    const { claim, removal } = await fileBoth(env);
    await env.admin.mutation(api.claims.approve, { id: claim.id });
    expect(await claimRow(env, removal.id)).toMatchObject({ status: "pending" });
    expect((await pending(env)).map((r) => r.id)).toEqual([removal.id]);
  });

  it("approving a removal leaves a pending ownership claim open", async () => {
    const env = await setup();
    const { claim, removal } = await fileBoth(env);
    await env.admin.mutation(api.claims.approve, { id: removal.id });
    expect(await claimRow(env, claim.id)).toMatchObject({ status: "pending" });
    expect(await listing(env)).toMatchObject({ status: "rejected", isClaimed: false });
  });

  it("rejecting records who reviewed it", async () => {
    const env = await setup();
    await env.owner.mutation(api.claims.submit, { targetType: "listing", slug: "floema", message: "Mine" });
    const [claim] = await pending(env);
    await env.admin.mutation(api.claims.reject, { id: claim.id, note: "No proof." });
    expect(await claimRow(env, claim.id)).toMatchObject({
      status: "rejected",
      reviewNote: "No proof.",
      reviewedBy: env.adminId,
    });
  });
});
