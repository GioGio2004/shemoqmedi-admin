/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { addDays, isDay, utcDay } from "../convex/lib/sotd";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const p = (n: number) => ({ design: n, usability: n, creativity: n, code: n });

// 9 Nov 2026, 10:00 UTC.
const START = Date.UTC(2026, 10, 9, 10);
const TODAY = "2026-11-09";

async function setup() {
  const t = convexTest(schema, modules);
  await t.run((ctx) =>
    ctx.db.insert("users", {
      externalId: "admin",
      name: "Admin",
      email: "admin@example.com",
      role: "admin",
      createdAt: START,
      updatedAt: START,
    }),
  );
  return { t, admin: t.withIdentity({ subject: "admin" }) };
}

type Env = Awaited<ReturnType<typeof setup>>;

let n = 0;
/** A site in voting with a jury score; closeVotingNow decides its awards. */
async function nominee(env: Env, score: number, tier: "solo" | "agency" = "agency") {
  n += 1;
  const coverId = await env.t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/jpeg" })));
  const { id, slug } = await env.admin.mutation(api.admin.createListing, {
    title: `Site ${n}`,
    tagline: "",
    url: `https://site-${n}.example`,
    categories: ["portfolio"],
    technologies: [],
    region: "global",
    creatorTier: tier,
    creditName: `Studio ${n}`,
    coverId,
    status: "in_voting",
    editorialScores: p(score),
    isClaimed: false,
  });
  return { id, slug };
}

async function winner(env: Env, score = 9) {
  const site = await nominee(env, score);
  await env.admin.mutation(api.listings.closeVotingNow, { id: site.id });
  return site;
}

const pub = (env: Env, slug: string) => env.t.query(api.listings.getPublicBySlug, { slug });
const at = (day: string, hour = 0) => vi.setSystemTime(Date.parse(`${day}T${String(hour).padStart(2, "0")}:05:00Z`));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
});
afterEach(() => vi.useRealTimers());

describe("day helpers", () => {
  it("works in UTC calendar days", () => {
    expect(utcDay(START)).toBe(TODAY);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(isDay("2026-02-29")).toBe(false);
    expect(isDay("2026-11-09")).toBe(true);
    expect(isDay("9 Nov")).toBe(false);
  });
});

describe("Site of the Day schedule", () => {
  it("gives one winner a day: the first today, the next ones on the following days", async () => {
    const env = await setup();
    const a = await winner(env);
    const b = await winner(env, 8.7);
    const c = await winner(env, 8.5);

    expect(await pub(env, a.slug)).toMatchObject({ status: "awarded", awards: ["SOTD"], sotdDay: TODAY });
    // Scheduled: awarded, but the award is not public until its day.
    expect(await pub(env, b.slug)).toMatchObject({ status: "awarded", awards: [], sotdDay: "2026-11-10" });
    expect(await pub(env, c.slug)).toMatchObject({ status: "awarded", awards: [], sotdDay: "2026-11-11" });

    // Nothing is due before midnight.
    expect(await env.t.mutation(internal.sotd.publishDue, {})).toBe(0);

    at("2026-11-10");
    expect(await env.t.mutation(internal.sotd.publishDue, {})).toBe(1);
    expect(await pub(env, b.slug)).toMatchObject({ awards: ["SOTD"], sotdDay: "2026-11-10" });
    expect(await pub(env, c.slug)).toMatchObject({ awards: [] });
    // Yesterday's winner keeps its day and award; it never gets another day.
    expect(await pub(env, a.slug)).toMatchObject({ awards: ["SOTD"], sotdDay: TODAY });
    expect(await env.t.mutation(internal.sotd.publishDue, {})).toBe(0);
  });

  it("keeps Best Solo Creation at once and adds SOTD on the day", async () => {
    const env = await setup();
    await winner(env);
    const solo = await nominee(env, 8.9, "solo");
    await env.admin.mutation(api.listings.closeVotingNow, { id: solo.id });
    expect(await pub(env, solo.slug)).toMatchObject({ status: "awarded", awards: ["BSC"], sotdDay: "2026-11-10" });
    at("2026-11-10");
    await env.t.mutation(internal.sotd.publishDue, {});
    expect(await pub(env, solo.slug)).toMatchObject({ awards: ["BSC", "SOTD"] });
  });

  it("catches up on a missed day", async () => {
    const env = await setup();
    await winner(env);
    const b = await winner(env);
    at("2026-11-12");
    expect(await env.t.mutation(internal.sotd.publishDue, {})).toBe(1);
    expect(await pub(env, b.slug)).toMatchObject({ awards: ["SOTD"], sotdDay: "2026-11-10" });
  });

  it("fills a free day after a gap", async () => {
    const env = await setup();
    await winner(env); // today
    at("2026-11-14", 9);
    const late = await winner(env);
    expect(await pub(env, late.slug)).toMatchObject({ awards: ["SOTD"], sotdDay: "2026-11-14" });
  });

  it("frees a day when a scheduled site is unpublished, and reopening clears it", async () => {
    const env = await setup();
    await winner(env);
    const b = await winner(env);
    await env.admin.mutation(api.listings.reject, { id: b.id, note: "Broken links" });
    expect((await env.t.run((ctx) => ctx.db.get(b.id as Id<"listings">)))!.sotdDay).toBeUndefined();
    const c = await winner(env);
    expect(await pub(env, c.slug)).toMatchObject({ sotdDay: "2026-11-10" });

    await env.admin.mutation(api.admin.setLifecycle, { id: c.id, status: "in_voting" });
    expect(await pub(env, c.slug)).toMatchObject({ status: "in_voting", awards: [], sotdDay: null });
  });

  it("admin awards: SOTD picked by hand takes the next free day; removing it frees the day", async () => {
    const env = await setup();
    await winner(env);
    const b = await nominee(env, 7);
    await env.admin.mutation(api.listings.closeVotingNow, { id: b.id });
    expect(await pub(env, b.slug)).toMatchObject({ status: "archived", sotdDay: null });

    await env.admin.mutation(api.admin.setLifecycle, { id: b.id, status: "awarded", awards: ["SOTD"] });
    expect(await pub(env, b.slug)).toMatchObject({ status: "awarded", awards: [], sotdDay: "2026-11-10" });
    // Saving the lifecycle again without awards keeps the scheduled day.
    await env.admin.mutation(api.admin.setLifecycle, { id: b.id, status: "awarded" });
    expect(await pub(env, b.slug)).toMatchObject({ sotdDay: "2026-11-10" });

    await env.admin.mutation(api.admin.setLifecycle, { id: b.id, status: "awarded", awards: ["HM"] });
    expect(await pub(env, b.slug)).toMatchObject({ awards: ["HM"], sotdDay: null });
  });

  it("an awarded site created with SOTD gets a day too", async () => {
    const env = await setup();
    await winner(env);
    const coverId = await env.t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/jpeg" })));
    const { slug } = await env.admin.mutation(api.admin.createListing, {
      title: "Hand picked",
      tagline: "",
      url: "https://hand-picked.example",
      categories: ["portfolio"],
      technologies: [],
      region: "global",
      creatorTier: "agency",
      creditName: "Someone",
      coverId,
      status: "awarded",
      awards: ["SOTD"],
      isClaimed: false,
    });
    expect(await pub(env, slug)).toMatchObject({ status: "awarded", awards: [], sotdDay: "2026-11-10" });
  });
});

describe("admin schedule", () => {
  it("lists the schedule and the sites that can still be picked", async () => {
    const env = await setup();
    const a = await winner(env);
    const b = await winner(env);
    const c = await nominee(env, 7.9);
    await env.admin.mutation(api.listings.closeVotingNow, { id: c.id });

    const s = await env.admin.query(api.sotd.schedule, {});
    expect(s.today).toBe(TODAY);
    expect(s.nextFree).toBe("2026-11-11");
    expect(s.days.map((d) => [d.day, d.listing.slug, d.published])).toEqual([
      ["2026-11-10", b.slug, false],
      [TODAY, a.slug, true],
    ]);
    expect(s.candidates.map((x) => x.slug)).toEqual([c.slug]);
  });

  it("schedules by hand, moves, swaps and unschedules", async () => {
    const env = await setup();
    const a = await winner(env); // today
    const b = await winner(env); // 10 Nov
    const c = await nominee(env, 7);
    await env.admin.mutation(api.listings.closeVotingNow, { id: c.id });

    // A picked site takes the first free day.
    expect(await env.admin.mutation(api.sotd.setDay, { id: c.id })).toEqual({ day: "2026-11-11" });
    expect(await pub(env, c.slug)).toMatchObject({ status: "awarded", sotdDay: "2026-11-11" });

    // Moving onto a scheduled day swaps the two.
    await env.admin.mutation(api.sotd.setDay, { id: c.id, day: "2026-11-10" });
    expect(await pub(env, c.slug)).toMatchObject({ sotdDay: "2026-11-10" });
    expect(await pub(env, b.slug)).toMatchObject({ sotdDay: "2026-11-11" });

    // Today's published winner keeps its day; nothing can take it.
    await expect(env.admin.mutation(api.sotd.setDay, { id: b.id, day: TODAY })).rejects.toThrow(/already has/);
    await expect(env.admin.mutation(api.sotd.setDay, { id: a.id, day: "2026-11-20" })).rejects.toThrow(/once/);
    await expect(env.admin.mutation(api.sotd.setDay, { id: b.id, day: "2026-11-01" })).rejects.toThrow(/today or a later/);
    await expect(env.admin.mutation(api.sotd.setDay, { id: b.id, day: "next week" })).rejects.toThrow(/date/);

    // Unscheduling a site with no other award returns it to archived.
    await env.admin.mutation(api.sotd.unschedule, { id: c.id });
    expect(await pub(env, c.slug)).toMatchObject({ status: "archived", awards: [], sotdDay: null });
    await expect(env.admin.mutation(api.sotd.unschedule, { id: a.id })).rejects.toThrow(/already public/);
  });

  it("refuses sites still in voting, and non-admins", async () => {
    const env = await setup();
    const live = await nominee(env, 9);
    await expect(env.admin.mutation(api.sotd.setDay, { id: live.id })).rejects.toThrow(/voting has closed/);
    await expect(env.t.query(api.sotd.schedule, {})).rejects.toThrow();
  });

  it("backfills a day for winners from before the schedule", async () => {
    const env = await setup();
    const ids = await env.t.run(async (ctx) => {
      const cover = await ctx.storage.store(new Blob(["img"]));
      const base = {
        source: "import" as const,
        submissionTier: "standard" as const,
        tagline: "",
        category: "portfolio",
        technologies: [],
        region: "global" as const,
        creatorTier: "agency" as const,
        creditName: "Old",
        coverId: cover,
        status: "awarded" as const,
        communityTotals: p(0),
        communityVotesCount: 0,
        awards: ["SOTD" as const],
        isClaimed: false,
        createdAt: START,
        updatedAt: START,
      };
      const one = await ctx.db.insert("listings", { ...base, slug: "old-1", title: "Old 1", url: "https://o1.example", awardedAt: Date.UTC(2026, 9, 1, 12) });
      const two = await ctx.db.insert("listings", { ...base, slug: "old-2", title: "Old 2", url: "https://o2.example", awardedAt: Date.UTC(2026, 9, 1, 18) });
      return [one, two];
    });
    expect(await env.t.mutation(internal.sotd.backfillDays, {})).toBe(2);
    const days = await env.t.run(async (ctx) => Promise.all(ids.map(async (id) => (await ctx.db.get(id))!.sotdDay)));
    expect(days).toEqual(["2026-10-01", "2026-09-30"]);
  });
});
