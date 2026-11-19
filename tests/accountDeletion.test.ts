/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

// Audit J-02 / D-04: people can delete their account, and a deleted user
// (on the site or in Clerk) leaves nothing pointing at nobody.

const modules = import.meta.glob("../convex/**/*.{ts,js}");

async function setup() {
  const t = convexTest(schema, modules);
  const user = (externalId: string, role?: "admin") =>
    t.run((ctx) =>
      ctx.db.insert("users", { externalId, name: externalId, email: `${externalId}@example.com`, role, createdAt: 0, updatedAt: 0 }),
    );
  const memberId = await user("member");
  const adminId = await user("boss", "admin");
  const site = async (url: string, status: "in_voting" | "pending") => {
    const coverId = await t.run((ctx) => ctx.storage.store(new Blob(["x"], { type: "image/png" })));
    const { id } = await t.mutation(internal.importer.insertImported, {
      url,
      title: url.replace("https://", ""),
      tagline: "A site.",
      category: "architecture",
      technologies: [],
      region: "global",
      creatorTier: "agency",
      creditName: "Studio",
      status,
      votingDaysLeft: 6,
      isClaimed: false,
      coverId,
      source: "seed",
    });
    return id as Id<"listings">;
  };
  const publicId = await site("https://public.example", "in_voting");
  const pendingId = await site("https://pending.example", "pending");
  await t.run(async (ctx) => {
    await ctx.db.patch(publicId, { ownerId: memberId, isClaimed: true, communityTotals: { design: 8, usability: 8, creativity: 8, content: 8 }, communityVotesCount: 1 });
    await ctx.db.patch(pendingId, { submittedBy: memberId });
    await ctx.db.insert("votes", { listingId: publicId, userId: memberId, scores: { design: 8, usability: 8, creativity: 8, content: 8 }, createdAt: 0 });
    await ctx.db.insert("claims", { targetType: "listing", listingId: publicId, userId: memberId, message: "mine", status: "pending", createdAt: 0 } as never);
  });
  return { t, memberId, adminId, publicId, pendingId, member: t.withIdentity({ subject: "member" }), admin: t.withIdentity({ subject: "boss" }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CLERK_SECRET_KEY;
});

describe("deleting an account", () => {
  it("needs the typed confirmation and refuses admins", async () => {
    const env = await setup();
    await expect(env.member.action(api.users.deleteMyAccount, { confirm: "yes" as never })).rejects.toThrow();
    await expect(env.admin.action(api.users.deleteMyAccount, { confirm: "DELETE" })).rejects.toThrow(/Admins/);
  });

  it("removes the person and releases or deletes what pointed at them", async () => {
    const env = await setup();
    process.env.CLERK_SECRET_KEY = "sk_test_x";
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url}`);
      return new Response("{}", { status: 200 });
    });
    const out = await env.member.action(api.users.deleteMyAccount, { confirm: "DELETE" });
    expect(out.counts).toMatchObject({ listingsDeleted: 1, listingsReleased: 1, votes: 1, claims: 1 });
    // The Clerk login is deleted server-side, for this caller only.
    expect(out.loginDeleted).toBe(true);
    expect(calls).toEqual(["DELETE https://api.clerk.com/v1/users/member"]);
    await env.t.run(async (ctx) => {
      expect(await ctx.db.get(env.memberId)).toBeNull();
      expect(await ctx.db.get(env.pendingId)).toBeNull(); // never public: gone
      const pub = (await ctx.db.get(env.publicId))!;
      expect(pub).toMatchObject({ isClaimed: false, communityVotesCount: 0 });
      expect(pub.ownerId).toBeUndefined();
      expect(await ctx.db.query("votes").collect()).toHaveLength(0);
      expect(await ctx.db.query("claims").collect()).toHaveLength(0);
    });
  });

  it("does the same cleanup when Clerk deletes the user", async () => {
    const env = await setup();
    await env.t.mutation(internal.users.deleteFromClerk, { clerkUserId: "member" });
    await env.t.run(async (ctx) => {
      expect(await ctx.db.get(env.memberId)).toBeNull();
      expect((await ctx.db.get(env.publicId))!.ownerId).toBeUndefined();
    });
    // Running again (webhook retry) is harmless.
    await env.t.mutation(internal.users.deleteFromClerk, { clerkUserId: "member" });
  });
});
