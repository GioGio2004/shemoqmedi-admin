/// <reference types="vite/client" />
// awards.publicRules: the rules the storefront prints come from the same
// constants and settings the engine scores with, and follow admin changes.
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { DEFAULT_CONFIG } from "../convex/lib/config";
import { WEIGHTS, weighted } from "../convex/lib/scoring";

const modules = import.meta.glob("../convex/**/*.{ts,js}");

async function withAdmin() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("users", { externalId: "admin", name: "admin", email: "admin@example.com", role: "admin", createdAt: now, updatedAt: now });
  });
  return { t, admin: t.withIdentity({ subject: "admin" }) };
}

describe("awards.publicRules", () => {
  it("matches the scoring weights and the default award settings", async () => {
    const t = convexTest(schema, modules);
    const rules = await t.query(api.awards.publicRules, {});
    expect(rules.pillars.map((p) => p.key)).toEqual(["design", "usability", "creativity", "content"]);
    for (const p of rules.pillars) expect(p.weight).toBe(WEIGHTS[p.key as keyof typeof WEIGHTS]);
    expect(rules.pillars.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1, 10);
    expect(rules.pillars.some((p) => p.key === "code" || p.name === "Code")).toBe(false);
    // The weights it states reproduce the engine's weighted score.
    const vote = { design: 9, usability: 8, creativity: 7, content: 6 };
    expect(rules.pillars.reduce((s, p) => s + vote[p.key as keyof typeof vote] * p.weight, 0)).toBeCloseTo(weighted(vote), 10);
    expect(rules).toMatchObject({
      scoreMin: 1,
      scoreMax: 10,
      decimals: 2,
      communityCounts: false,
      minVotes: DEFAULT_CONFIG.minVotes,
      honorableMentionMin: DEFAULT_CONFIG.honorableMentionMin,
      sotdMin: DEFAULT_CONFIG.sotdMin,
      bscMin: DEFAULT_CONFIG.bscMin,
      announceTime: DEFAULT_CONFIG.announceTime,
      monthlyRoundDays: DEFAULT_CONFIG.monthlyRoundDays,
      yearlyRoundDays: DEFAULT_CONFIG.yearlyRoundDays,
      yearlyAnnounceDate: DEFAULT_CONFIG.yearlyAnnounceDate,
      resubmitMonths: DEFAULT_CONFIG.resubmitMonths,
      timeZone: "Asia/Tbilisi",
    });
  });

  it("follows settings an admin changes at runtime", async () => {
    const { t, admin } = await withAdmin();
    await admin.mutation(api.awards.updateSettings, { sotdMin: 7.4, honorableMentionMin: 6.8, minVotes: 5 });
    const rules = await t.query(api.awards.publicRules, {});
    expect(rules.sotdMin).toBe(7.4);
    expect(rules.honorableMentionMin).toBe(6.8);
    expect(rules.minVotes).toBe(5);
    expect(rules.bscMin).toBe(DEFAULT_CONFIG.bscMin);
  });
});
