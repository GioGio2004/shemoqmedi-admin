/// <reference types="vite/client" />
// The awards hierarchy, end to end: jury votes → weekly batch close → HM and
// the SOTD queue → one Site of the Day a day → monthly and yearly rounds,
// plus conflicts, team sites, duplicates, overrides, audit and badges.
// Time is simulated (Date only), in Tbilisi time (UTC+4).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { atTime, batchVotingEnds, dayStart } from "../convex/lib/time";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const p = (n: number) => ({ design: n, usability: n, creativity: n, content: n });
const set = (ms: number) => vi.setSystemTime(ms);
/** Tbilisi wall-clock time. */
const at = (day: string, time = "12:00") => atTime(day, time);

// Monday 2 Nov 2026, noon Tbilisi: batch "2026-11-02", judged 9–15 Nov.
const MONDAY = "2026-11-02";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  set(at(MONDAY));
});
afterEach(() => vi.useRealTimers());

async function setup(jurorCount = 4) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const user = (externalId: string, role?: "admin") =>
      ctx.db.insert("users", { externalId, name: externalId, email: `${externalId}@example.com`, role, createdAt: now, updatedAt: now });
    const admin = await user("admin", "admin");
    const owner = await user("owner");
    const jurors: Id<"jurors">[] = [];
    for (let i = 1; i <= jurorCount; i++) {
      const userId = await user(`juror${i}`);
      jurors.push(
        await ctx.db.insert("jurors", {
          userId,
          status: "claimed",
          slug: `juror-${i}`,
          name: `Juror ${i}`,
          title: "Designer",
          active: true,
          joinedAt: now,
          updatedAt: now,
        }),
      );
    }
    return { admin, owner, jurors };
  });
  return {
    t,
    ids,
    admin: t.withIdentity({ subject: "admin" }),
    owner: t.withIdentity({ subject: "owner" }),
    juror: (i: number) => t.withIdentity({ subject: `juror${i}` }),
  };
}
type Env = Awaited<ReturnType<typeof setup>>;

let n = 0;
/** A site approved now (joins this week's batch), owned by `owner`. */
async function site(env: Env, extra: Record<string, unknown> = {}) {
  n += 1;
  const coverId = await env.t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/jpeg" })));
  const { id, slug } = await env.admin.mutation(api.admin.createListing, {
    title: `Site ${n}`,
    tagline: "",
    url: `https://site-${n}.example`,
    categories: ["portfolio"],
    technologies: [],
    region: "global",
    creatorTier: "agency",
    creditName: `Studio ${n}`,
    coverId,
    status: "in_voting",
    isClaimed: true,
    ...extra,
  });
  await env.t.run((ctx) => ctx.db.patch(id, { ownerId: env.ids.owner }));
  return { id, slug };
}

/** Jurors 1..k score the site `score` on every pillar. */
async function vote(env: Env, slug: string, score: number | number[], k = 3) {
  for (let i = 1; i <= k; i++) {
    const s = Array.isArray(score) ? score[i - 1] : score;
    await env.juror(i).mutation(api.jury.evaluate, { slug, scores: p(s), comment: "" });
  }
}

const tick = (env: Env) => env.t.mutation(internal.awards.tick, {});
const listing = (env: Env, id: Id<"listings">) => env.t.run((ctx) => ctx.db.get(id));
const awardsOf = (env: Env, id: Id<"listings">) =>
  env.t.run((ctx) => ctx.db.query("awards").withIndex("by_listing", (q) => q.eq("listingId", id)).collect());
const sotdOn = (env: Env, day: string) =>
  env.t.run((ctx) =>
    ctx.db.query("awards").withIndex("by_tier_period", (q) => q.eq("tier", "SOTD").eq("period", day)).collect(),
  );
const auditOf = (env: Env, kind: string) =>
  env.t.run(async (ctx) => (await ctx.db.query("awardAudit").collect()).filter((a) => a.kind === kind));

/** After the batch's judging week: voting closed. */
const AFTER_JUDGING = batchVotingEnds(MONDAY) + 1; // Mon 16 Nov 00:00 Tbilisi

describe("jury votes and eligibility", () => {
  it("a site is judged the week after its batch, and closes with the jury's weighted score", async () => {
    const env = await setup();
    const s = await site(env);
    expect((await listing(env, s.id))!).toMatchObject({ batchWeek: MONDAY, votingEndsAt: batchVotingEnds(MONDAY) });
    await env.juror(1).mutation(api.jury.evaluate, {
      slug: s.slug,
      scores: { design: 9, usability: 8, creativity: 7, content: 6 }, // 8.0
      comment: "",
    });
    await vote(env, s.slug, 7, 1); // juror 1 again: 7.0 replaces 8.0
    await env.juror(2).mutation(api.jury.evaluate, { slug: s.slug, scores: p(8), comment: "" });
    await env.juror(3).mutation(api.jury.evaluate, { slug: s.slug, scores: p(9.1), comment: "" });
    set(batchVotingEnds(MONDAY) - 1);
    expect((await tick(env)).closed).toBe(0); // still Sunday 23:59
    set(AFTER_JUDGING);
    expect((await tick(env)).closed).toBe(1);
    const closed = (await listing(env, s.id))!;
    expect(closed).toMatchObject({ finalScore: 8.03, juryVotes: 3, status: "awarded" }); // (7 + 8 + 9.1) / 3
  });

  it("needs MIN_VOTES jury votes for any award", async () => {
    const env = await setup();
    const s = await site(env);
    await vote(env, s.slug, 9.5, 2);
    set(AFTER_JUDGING);
    await tick(env);
    expect((await listing(env, s.id))!).toMatchObject({ status: "archived", awards: [], finalScore: 9.5 });
    expect((await listing(env, s.id))!.sotdQueuedAt).toBeUndefined();
    const [closed] = await auditOf(env, "batch_closed");
    expect(closed.details).toMatchObject({ eligible: false, juryVotes: 2 });
  });

  it("MIN_VOTES is a setting", async () => {
    const env = await setup();
    await env.admin.mutation(api.awards.updateSettings, { minVotes: 2 });
    const s = await site(env);
    await vote(env, s.slug, 6.8, 2);
    set(AFTER_JUDGING);
    await tick(env);
    expect((await listing(env, s.id))!.awards).toEqual(["HM"]);
    expect(await auditOf(env, "settings")).toHaveLength(1);
  });

  it("jurors can't score sites they built or have a conflict with", async () => {
    const env = await setup();
    const s = await site(env);
    await env.t.run((ctx) => ctx.db.patch(s.id, { ownerId: undefined }));
    // Juror 1 owns it.
    const juror1User = (await env.t.run((ctx) => ctx.db.get(env.ids.jurors[0])))!.userId!;
    await env.t.run((ctx) => ctx.db.patch(s.id, { ownerId: juror1User }));
    await expect(env.juror(1).mutation(api.jury.evaluate, { slug: s.slug, scores: p(9), comment: "" })).rejects.toThrow(/own site/);
    // Juror 2 scores, then declares a conflict: the score is removed.
    await env.juror(2).mutation(api.jury.evaluate, { slug: s.slug, scores: p(9), comment: "" });
    expect((await listing(env, s.id))!.juryVotes).toBe(1);
    await env.juror(2).mutation(api.conflicts.declare, { slug: s.slug, reason: "My company built it." });
    expect((await listing(env, s.id))!.juryVotes).toBe(0);
    await expect(env.juror(2).mutation(api.jury.evaluate, { slug: s.slug, scores: p(9), comment: "" })).rejects.toThrow(/conflict/);
    // An admin flags juror 3.
    await env.admin.mutation(api.conflicts.set, { listingId: s.id, jurorId: env.ids.jurors[2], reason: "Former employer." });
    await expect(env.juror(3).mutation(api.jury.evaluate, { slug: s.slug, scores: p(9), comment: "" })).rejects.toThrow(/conflict/);
    const flags = await env.admin.query(api.conflicts.forListing, { listingId: s.id });
    expect(flags.conflicts.map((c) => c.declaredBy).sort()).toEqual(["admin", "juror"]);
  });

  it("Shemoqmedi team sites are never judged or awarded", async () => {
    const env = await setup();
    const s = await site(env);
    await vote(env, s.slug, 9, 2);
    await env.admin.mutation(api.awards.setTeamSite, { listingId: s.id, byTeam: true });
    await expect(env.juror(3).mutation(api.jury.evaluate, { slug: s.slug, scores: p(9), comment: "" })).rejects.toThrow(/team/);
    set(AFTER_JUDGING);
    await tick(env);
    expect((await listing(env, s.id))!).toMatchObject({ awards: [], byTeam: true, status: "archived" });
    expect((await env.t.query(api.listings.getPublicBySlug, { slug: s.slug }))!.byTeam).toBe(true);
    await expect(env.admin.mutation(api.awards.grant, { listingId: s.id, tier: "HM", reason: "Try" })).rejects.toThrow(/team/);
  });

  it("marking a team site revokes its awards, with the reason logged", async () => {
    const env = await setup();
    const s = await site(env);
    await vote(env, s.slug, 8);
    set(AFTER_JUDGING);
    await tick(env);
    expect((await listing(env, s.id))!.awards).toEqual(["SOTD", "HM"]);
    expect(await env.admin.mutation(api.awards.setTeamSite, { listingId: s.id, byTeam: true })).toEqual({ revoked: 2 });
    expect((await listing(env, s.id))!).toMatchObject({ awards: [], status: "archived" });
    const revoked = await auditOf(env, "revoked");
    expect(revoked).toHaveLength(2);
    expect(revoked[0].reason).toMatch(/team site/);
  });
});

describe("weekly batch close", () => {
  it("6.50+ gets Honorable Mention; 7.00+ also enters the SOTD queue; below gets nothing", async () => {
    const env = await setup();
    const low = await site(env);
    const hm = await site(env);
    const top = await site(env);
    await vote(env, low.slug, 6.4);
    await vote(env, hm.slug, 6.5);
    await vote(env, top.slug, 7);
    set(dayStart("2026-11-15") + 3600_000); // Sunday of the judging week: not closed yet
    await tick(env);
    expect((await listing(env, top.id))!.status).toBe("in_voting");
    set(AFTER_JUDGING);
    await tick(env);
    expect((await listing(env, low.id))!).toMatchObject({ awards: [], status: "archived" });
    expect((await listing(env, hm.id))!).toMatchObject({ awards: ["HM"], status: "awarded" });
    const queued = Object.fromEntries((await auditOf(env, "batch_closed")).map((e) => [e.listingId, e.details.sotdQueued]));
    expect(queued).toEqual({ [low.id]: false, [hm.id]: false, [top.id]: true });
    // The only queued site became today's Site of the Day.
    expect((await listing(env, top.id))!.awards).toEqual(["SOTD", "HM"]);
  });

  it("solo makers at 8.20+ also get Best Solo Creation", async () => {
    const env = await setup();
    const solo = await site(env, { creatorTier: "solo" });
    await vote(env, solo.slug, 8.2);
    set(AFTER_JUDGING);
    await tick(env);
    expect((await listing(env, solo.id))!.awards).toEqual(["SOTD", "BSC", "HM"]); // and, as the only queued site, today's SOTD
  });

  it("closing twice changes nothing", async () => {
    const env = await setup();
    const s = await site(env);
    await vote(env, s.slug, 8);
    set(AFTER_JUDGING);
    await tick(env);
    await tick(env);
    // One HM from the close and one SOTD from the announcement, however often it runs.
    expect((await awardsOf(env, s.id)).map((a) => a.tier).sort()).toEqual(["HM", "SOTD"]);
  });
});

describe("Site of the Day", () => {
  /** Three sites through a batch, scores 9, 8, 7.5 (closed Mon 16 Nov 00:00). */
  async function queued(env: Env) {
    const a = await site(env);
    const b = await site(env);
    const c = await site(env);
    await vote(env, b.slug, 8);
    await vote(env, a.slug, 9);
    await vote(env, c.slug, 7.5);
    return { a, b, c };
  }

  it("publishes the best queued site at ANNOUNCE_TIME, one per day, in score order", async () => {
    const env = await setup();
    const { a, b, c } = await queued(env);
    set(AFTER_JUDGING); // Mon 16 Nov 00:00: close, then announce
    expect((await tick(env)).sotd).toBe("announced");
    expect((await sotdOn(env, "2026-11-16"))[0].listingId).toBe(a.id);
    expect((await tick(env)).sotd).toBe("done"); // never two in a day
    expect(await sotdOn(env, "2026-11-16")).toHaveLength(1);

    set(at("2026-11-17", "00:00"));
    await tick(env);
    expect((await sotdOn(env, "2026-11-17"))[0].listingId).toBe(b.id);
    set(at("2026-11-18", "00:05"));
    await tick(env);
    expect((await sotdOn(env, "2026-11-18"))[0].listingId).toBe(c.id);
    expect((await listing(env, a.id))!.awards).toEqual(["SOTD", "HM"]);
  });

  it("waits for the configured announce time", async () => {
    const env = await setup();
    await env.admin.mutation(api.awards.updateSettings, { announceTime: "10:00" });
    await queued(env);
    set(AFTER_JUDGING);
    expect((await tick(env)).sotd).toBe("not_yet");
    set(at("2026-11-16", "10:00"));
    expect((await tick(env)).sotd).toBe("announced");
  });

  it("an empty queue leaves the day without a winner, never repeats one, and alerts admins once", async () => {
    const env = await setup();
    const { a } = await queued(env);
    set(AFTER_JUDGING);
    await tick(env);
    for (const day of ["2026-11-17", "2026-11-18"]) {
      set(at(day, "00:00"));
      await tick(env);
    }
    set(at("2026-11-19", "00:00"));
    expect((await tick(env)).sotd).toBe("empty");
    expect((await tick(env)).sotd).toBe("empty");
    expect(await sotdOn(env, "2026-11-19")).toHaveLength(0);
    expect((await auditOf(env, "empty_day")).filter((e) => e.period === "2026-11-19")).toHaveLength(1);
    // The admin alert is scheduled exactly once for the day.
    const scheduled = await env.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.filter((s) => s.name.includes("emptyDay"))).toHaveLength(1);
    // A past winner is never picked again.
    const all = await env.t.run((ctx) => ctx.db.query("awards").collect());
    expect(all.filter((x) => x.tier === "SOTD" && x.listingId === a.id)).toHaveLength(1);
  });

  it("leftover queued sites carry over, still ordered by score, mixed with the next batch", async () => {
    const env = await setup();
    const { a, b, c } = await queued(env); // batch of 2 Nov
    // Next batch (Mon 9 Nov): a 9.5 site, closes Mon 23 Nov.
    set(at("2026-11-10"));
    const d = await site(env);
    await vote(env, d.slug, 9.5);
    set(AFTER_JUDGING);
    await tick(env); // 16 Nov: a
    set(at("2026-11-17", "00:00"));
    await tick(env); // 17 Nov: b
    // No tick runs 18–22 Nov (past days are never back-filled). On the 23rd
    // d's batch closes: d (9.5) outranks the leftover c (7.5).
    set(at("2026-11-23", "00:00"));
    await tick(env);
    const winners = await env.t.run(async (ctx) =>
      (await ctx.db.query("awards").collect()).filter((x) => x.tier === "SOTD").map((x) => [x.period, x.listingId]),
    );
    expect(winners).toEqual([
      ["2026-11-16", a.id],
      ["2026-11-17", b.id],
      ["2026-11-23", d.id],
    ]);
    set(at("2026-11-24", "00:00"));
    await tick(env);
    expect((await sotdOn(env, "2026-11-24"))[0].listingId).toBe(c.id);
  });

  it("ties: more jury votes, then higher Design, then the earlier submission", async () => {
    const env = await setup(4);
    const early = await site(env);
    const late = await site(env);
    const moreVotes = await site(env);
    const design = await site(env);
    await env.t.run(async (ctx) => {
      await ctx.db.patch(early.id, { createdAt: 1 });
      await ctx.db.patch(late.id, { createdAt: 2 });
    });
    await vote(env, early.slug, 8);
    await vote(env, late.slug, 8);
    await vote(env, moreVotes.slug, 8, 4);
    // Same 8.00, but Design 9 (9*.4 + 7.571*.3 + 7.5*.2 + 7.15*.1 ≈ 8.0)
    for (let i = 1; i <= 3; i++) {
      await env.juror(i).mutation(api.jury.evaluate, {
        slug: design.slug,
        scores: { design: 9, usability: 7.5, creativity: 7, content: 7.5 }, // 3.6+2.25+1.4+0.75 = 8.0
        comment: "",
      });
    }
    set(AFTER_JUDGING);
    await tick(env);
    const order = [];
    for (const day of ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"]) {
      set(at(day, "00:00"));
      await tick(env);
      order.push((await sotdOn(env, day))[0].listingId);
    }
    expect(order).toEqual([moreVotes.id, design.id, early.id, late.id]);
  });

  it("a site wins SOTD only once, even by hand", async () => {
    const env = await setup();
    const { a } = await queued(env);
    set(AFTER_JUDGING);
    await tick(env);
    await expect(
      env.admin.mutation(api.awards.grant, { listingId: a.id, tier: "SOTD", period: "2026-11-20", reason: "Again" }),
    ).rejects.toThrow(/once/);
  });

  it("an unpublished site leaves the queue", async () => {
    const env = await setup();
    const { a, b } = await queued(env);
    set(AFTER_JUDGING);
    await tick(env); // a wins today
    await env.admin.mutation(api.listings.reject, { id: b.id, note: "Broken" });
    set(at("2026-11-17", "00:00"));
    await tick(env);
    expect((await sotdOn(env, "2026-11-17"))[0].listingId).not.toBe(b.id);
    expect((await listing(env, a.id))!.sotdQueuedAt).toBeUndefined();
  });
});

const novemberRound = async (env: Env) =>
  (await env.t.run((ctx) => ctx.db.query("rounds").collect())).find((r) => r.kind === "SOTM" && r.period === "2026-11")!;

describe("Site of the Month and Site of the Year", () => {
  /** SOTD winners in November: a (9), b (8). */
  async function novemberWinners(env: Env) {
    const a = await site(env);
    const b = await site(env);
    await vote(env, a.slug, 9);
    await vote(env, b.slug, 8);
    set(AFTER_JUDGING);
    await tick(env);
    set(at("2026-11-17", "00:00"));
    await tick(env);
    return { a, b };
  }

  it("opens on the 1st with last month's SOTD winners, lasts 5 days, announces on the 6th", async () => {
    const env = await setup();
    const { a, b } = await novemberWinners(env);
    set(at("2026-12-01", "00:00"));
    expect((await tick(env)).opened).toEqual(["SOTM 2026-11"]);
    expect((await tick(env)).opened).toEqual([]); // once
    const round = await novemberRound(env);
    expect(round.candidates).toEqual([a.id, b.id]);
    expect(round.closesAt).toBe(at("2026-12-06", "00:00"));

    // Jurors score: b wins this round.
    const rounds = await env.juror(1).query(api.rounds.open, {});
    expect(rounds![0].candidates.map((c) => c.slug)).toEqual([a.slug, b.slug]);
    for (let i = 1; i <= 3; i++) {
      await env.juror(i).mutation(api.rounds.vote, { roundId: round._id, slug: a.slug, scores: p(8) });
      await env.juror(i).mutation(api.rounds.vote, { roundId: round._id, slug: b.slug, scores: p(9) });
    }
    set(at("2026-12-05", "23:00"));
    expect((await tick(env)).announced).toBe(0);
    set(at("2026-12-06", "00:00"));
    await expect(env.juror(1).mutation(api.rounds.vote, { roundId: round._id, slug: a.slug, scores: p(10) })).rejects.toThrow(/closed/);
    expect((await tick(env)).announced).toBe(1);
    expect((await tick(env)).announced).toBe(0);
    const sotm = (await env.t.run((ctx) => ctx.db.query("awards").collect())).filter((x) => x.tier === "SOTM");
    expect(sotm).toHaveLength(1);
    expect(sotm[0]).toMatchObject({ listingId: b.id, period: "2026-11", date: "2026-12-06", score: 9 });
    expect((await auditOf(env, "round_decided")).find((e) => e.period === "2026-11")!.details.results).toHaveLength(2);
  });

  it("a round needs MIN_VOTES per candidate; no eligible winner means no award", async () => {
    const env = await setup();
    const { a } = await novemberWinners(env);
    set(at("2026-12-01", "00:00"));
    await tick(env);
    const round = await novemberRound(env);
    await env.juror(1).mutation(api.rounds.vote, { roundId: round._id, slug: a.slug, scores: p(10) });
    set(at("2026-12-06", "00:00"));
    await tick(env);
    expect((await env.t.run((ctx) => ctx.db.query("awards").collect())).filter((x) => x.tier === "SOTM")).toHaveLength(0);
    expect((await auditOf(env, "round_decided")).find((e) => e.period === "2026-11")!.reason).toMatch(/No eligible/);
  });

  it("Site of the Year: January round over the year's SOTM winners, announced on the configured date", async () => {
    const env = await setup();
    const { b } = await novemberWinners(env);
    set(at("2026-12-01", "00:00"));
    await tick(env);
    const nov = await novemberRound(env);
    for (let i = 1; i <= 3; i++) await env.juror(i).mutation(api.rounds.vote, { roundId: nov._id, slug: b.slug, scores: p(9) });
    set(at("2026-12-06", "00:00"));
    await tick(env);

    set(at("2027-01-01", "00:00"));
    const opened = (await tick(env)).opened;
    expect(opened).toContain("SOTY 2026");
    const soty = (await env.t.run((ctx) => ctx.db.query("rounds").collect())).find((r) => r.kind === "SOTY")!;
    expect(soty.candidates).toEqual([b.id]);
    expect(soty.closesAt).toBe(at("2027-01-11", "00:00")); // 10 days
    expect(soty.announceAt).toBe(at("2027-01-20", "00:00"));
    for (let i = 1; i <= 3; i++) await env.juror(i).mutation(api.rounds.vote, { roundId: soty._id, slug: b.slug, scores: p(9.5) });
    set(at("2027-01-19", "23:59"));
    expect((await tick(env)).announced).toBe(0);
    set(at("2027-01-20", "00:00"));
    expect((await tick(env)).announced).toBe(1);
    const won = (await env.t.run((ctx) => ctx.db.query("awards").collect())).filter((x) => x.tier === "SOTY");
    expect(won).toEqual([expect.objectContaining({ listingId: b.id, period: "2026" })]);
    expect((await listing(env, b.id))!.awards).toEqual(["SOTY", "SOTM", "SOTD", "HM"]);
  });

  it("one SOTM per month and once per site, even by hand", async () => {
    const env = await setup();
    const { a, b } = await novemberWinners(env);
    await env.admin.mutation(api.awards.grant, { listingId: a.id, tier: "SOTM", period: "2026-11", reason: "Jury chair decision" });
    await expect(
      env.admin.mutation(api.awards.grant, { listingId: b.id, tier: "SOTM", period: "2026-11", reason: "Second" }),
    ).rejects.toThrow(/already has/);
    await expect(
      env.admin.mutation(api.awards.grant, { listingId: a.id, tier: "SOTM", period: "2026-12", reason: "Again" }),
    ).rejects.toThrow(/once/);
  });
});

describe("overrides, audit and badges", () => {
  it("manual grants and revokes need a reason and are logged", async () => {
    const env = await setup();
    const s = await site(env);
    await vote(env, s.slug, 6);
    set(AFTER_JUDGING);
    await tick(env);
    await expect(env.admin.mutation(api.awards.grant, { listingId: s.id, tier: "HM", reason: " " })).rejects.toThrow(/reason/);
    const id = await env.admin.mutation(api.awards.grant, { listingId: s.id, tier: "HM", reason: "Jury recount" });
    expect((await listing(env, s.id))!).toMatchObject({ awards: ["HM"], status: "awarded" });
    await expect(env.admin.mutation(api.awards.revoke, { awardId: id, reason: "" })).rejects.toThrow(/reason/);
    await env.admin.mutation(api.awards.revoke, { awardId: id, reason: "Plagiarised design" });
    expect((await listing(env, s.id))!).toMatchObject({ awards: [], status: "archived" });
    const log = await env.admin.query(api.awards.auditLog, {});
    expect(log.map((e) => e.kind)).toEqual(expect.arrayContaining(["granted", "revoked", "batch_closed"]));
    expect(log.find((e) => e.kind === "revoked")).toMatchObject({ reason: "Plagiarised design", actor: "admin" });
    // A revoked award has no public page or badge.
    const award = (await env.t.run((ctx) => ctx.db.get(id)))!;
    expect(await env.t.query(api.awards.getBySlug, { slug: award.slug })).toBeNull();
  });

  it("non-admins can't override", async () => {
    const env = await setup();
    const s = await site(env);
    await expect(env.owner.mutation(api.awards.grant, { listingId: s.id, tier: "HM", reason: "Me" })).rejects.toThrow(/admin/);
    await expect(env.owner.query(api.awards.auditLog, {})).rejects.toThrow(/admin/);
  });

  it("every award has a public page; only the verified owner gets their badges", async () => {
    const env = await setup();
    const s = await site(env);
    await vote(env, s.slug, 9);
    set(AFTER_JUDGING);
    await tick(env);
    const rows = await awardsOf(env, s.id);
    const sotd = rows.find((r) => r.tier === "SOTD")!;
    expect(sotd).toMatchObject({ date: "2026-11-16", slug: `${s.slug}-sotd-2026-11-16` });
    expect(await env.t.query(api.awards.getBySlug, { slug: sotd.slug })).toMatchObject({
      tier: "SOTD",
      name: "Site of the Day",
      date: "2026-11-16",
      score: 9,
    });
    expect((await env.t.query(api.awards.forListing, { slug: s.slug })).map((a) => a.tier).sort()).toEqual(["HM", "SOTD"]);
    expect(await env.owner.query(api.awards.mine, {})).toHaveLength(2);
    expect(await env.juror(1).query(api.awards.mine, {})).toHaveLength(0);
    expect(await env.t.query(api.awards.mine, {})).toHaveLength(0);
    const pub = (await env.t.query(api.listings.getPublicBySlug, { slug: s.slug }))!;
    expect(pub).toMatchObject({ sotdDay: "2026-11-16", juryVotes: 3 });
  });

  it("a scheduled winner email and social post are queued for each award", async () => {
    const env = await setup();
    const s = await site(env);
    await vote(env, s.slug, 9);
    set(AFTER_JUDGING);
    await tick(env);
    const scheduled = await env.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled.filter((f) => f.name.includes("awardAnnounced"))).toHaveLength(2); // HM + SOTD
  });
});

describe("duplicates and redesigns", () => {
  it("one active listing per domain (protocol, www and trailing slash ignored)", async () => {
    const env = await setup();
    await site(env, { url: "https://www.dup.example/" });
    await expect(site(env, { url: "http://dup.example" })).rejects.toThrow(/already listed/);
  });

  it("an award winner returns only as a redesign, 12 months after its last award", async () => {
    const env = await setup();
    const old = await site(env, { url: "https://winner.example" });
    await vote(env, old.slug, 9);
    set(AFTER_JUDGING);
    await tick(env);
    await expect(site(env, { url: "https://winner.example" })).rejects.toThrow(/redesign/);
    await expect(site(env, { url: "https://winner.example", redesignOf: old.id })).rejects.toThrow(/2027-11-16/);
    set(at("2027-11-16"));
    const redesign = await site(env, { url: "https://winner.example", redesignOf: old.id });
    expect((await listing(env, redesign.id))!.redesignOf).toBe(old.id);
    expect((await env.t.query(api.listings.getPublicBySlug, { slug: redesign.slug }))!.redesignOf).toBe(old.slug);
  });

  it("owners submit redesigns for admin review", async () => {
    const env = await setup();
    const old = await site(env, { url: "https://mine.example" });
    set(AFTER_JUDGING);
    await tick(env); // closed, no award
    const coverId = await env.t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/jpeg" })));
    const base = {
      title: "Mine v2",
      tagline: "New",
      url: "mine.example/",
      categories: ["portfolio"],
      technologies: ["Next.js"],
      creatorTier: "solo" as const,
      region: "global" as const,
      creditName: "Me",
      submissionTier: "standard" as const,
      coverId,
    };
    await expect(env.owner.mutation(api.listings.submit, base)).rejects.toThrow(/redesign/);
    const { slug } = await env.owner.mutation(api.listings.submit, { ...base, redesignOf: old.slug });
    const created = await env.t.run((ctx) => ctx.db.query("listings").withIndex("by_slug", (q) => q.eq("slug", slug)).unique());
    expect(created).toMatchObject({ status: "pending", redesignOf: old.id });
  });
});

describe("juror digest", () => {
  it("one email per juror with their categories plus the general queue", async () => {
    const env = await setup(2);
    await env.t.run(async (ctx) => {
      await ctx.db.patch(env.ids.jurors[0], { interests: ["portfolio"] });
      await ctx.db.patch(env.ids.jurors[1], { interests: ["fashion"] });
    });
    await site(env, { categories: ["portfolio"] });
    await site(env, { categories: ["portfolio"] });
    await site(env, { categories: ["ai"] }); // nobody follows: general queue
    set(at(MONDAY, "21:00"));
    expect(await env.t.mutation(internal.digest.run, {})).toBe(2);
    expect(await env.t.mutation(internal.digest.run, {})).toBe(0); // once a day
    const sends = (await env.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).filter((f) =>
      f.name.includes("digest"),
    );
    const byJuror = Object.fromEntries(sends.map((f) => [f.args[0].to, f.args[0]]));
    expect(byJuror["juror1@example.com"].mine).toHaveLength(2);
    expect(byJuror["juror1@example.com"].general).toHaveLength(1);
    expect(byJuror["juror2@example.com"].mine).toHaveLength(0);
    expect(byJuror["juror2@example.com"].general).toHaveLength(1);
    expect(await env.juror(1).query(api.digest.generalQueue, {})).toHaveLength(1);
    expect(await env.owner.query(api.digest.generalQueue, {})).toBeNull();
  });
});
