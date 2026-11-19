/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { RATE_LIMITS, rateLimit } from "../convex/lib/rateLimit";

// Audit C-09: free accounts could repeat submissions, claims, votes and
// uploads without limit, each one pushing work or alerts to the admins.

const modules = import.meta.glob("../convex/**/*.{ts,js}");

async function setup() {
  const t = convexTest(schema, modules);
  const make = (externalId: string, role?: "admin") =>
    t.run((ctx) =>
      ctx.db.insert("users", { externalId, name: externalId, email: `${externalId}@example.com`, role, createdAt: 0, updatedAt: 0 }),
    );
  return { t, userId: await make("member"), adminId: await make("boss", "admin") };
}

describe("rate limits", () => {
  it("allows up to the limit, refuses the next, and resets after the window", async () => {
    const { t, userId } = await setup();
    const { max, windowMs } = RATE_LIMITS.submitClaim;
    const hit = (now: number) =>
      t.run(async (ctx) => rateLimit(ctx, "submitClaim", (await ctx.db.get(userId))!, now));
    for (let i = 0; i < max; i++) await hit(1_000 + i);
    await expect(hit(2_000)).rejects.toThrow(/tomorrow/);
    await hit(1_000 + windowMs); // a new window: allowed again
  });

  it("counts each action and account separately and never limits admins", async () => {
    const { t, userId, adminId } = await setup();
    await t.run(async (ctx) => {
      const user = (await ctx.db.get(userId))!;
      const admin = (await ctx.db.get(adminId))!;
      for (let i = 0; i < RATE_LIMITS.submitClaim.max; i++) await rateLimit(ctx, "submitClaim", user, 5);
      await rateLimit(ctx, "vote", user, 5); // other action: fine
      for (let i = 0; i < 50; i++) await rateLimit(ctx, "submitClaim", admin, 5);
    });
  });

  it("limits upload signing for the caller", async () => {
    const { t } = await setup();
    const member = t.withIdentity({ subject: "member" });
    for (let i = 0; i < RATE_LIMITS.videoUpload.max; i++) await member.mutation(internal.rateLimits.hit, { name: "videoUpload" });
    await expect(member.mutation(internal.rateLimits.hit, { name: "videoUpload" })).rejects.toThrow(/video uploads/);
  });
});
