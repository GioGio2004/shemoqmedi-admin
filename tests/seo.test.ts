/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const p = (n: number) => ({ design: n, usability: n, creativity: n, content: n });
const KEY = "0123456789abcdef0123456789abcdef";

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      externalId: "admin",
      name: "Admin",
      email: "admin@example.com",
      role: "admin",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("users", {
      externalId: "maker",
      name: "Maker",
      email: "maker@example.com",
      createdAt: now,
      updatedAt: now,
    });
  });
  return { t, admin: t.withIdentity({ subject: "admin" }), maker: t.withIdentity({ subject: "maker" }) };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** A registered ImageKit screenshot (the `media` table). */
function image(env: Env) {
  return env.t.run((ctx) =>
    ctx.db.insert("media", {
      fileId: `file-${Math.random().toString(36).slice(2)}`,
      url: "https://ik.imagekit.io/demo/listings/x/cover.webp",
      filePath: "/listings/x/cover.webp",
      kind: "image",
      contentType: "image/webp",
      size: 1000,
      createdAt: Date.now(),
    }),
  );
}

async function create(env: Env, overrides: Record<string, unknown> = {}) {
  return env.admin.mutation(api.admin.createListing, {
    title: "Floema",
    tagline: "Furniture, quietly.",
    url: "https://floema.pt",
    categories: ["architecture"],
    technologies: ["WebGL"],
    region: "global",
    creatorTier: "agency",
    creditName: "Bürocratik",
    coverId: await image(env),
    status: "in_voting",
    isClaimed: false,
    ...overrides,
  });
}

/** Paths of every IndexNow ping scheduled so far, one array per ping. */
async function pings(env: Env) {
  const jobs = await env.t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  return jobs
    .filter((j) => /pingIndexNow/.test(j.name))
    .map((j) => (j.args[0] as { paths: string[] }).paths);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("slug history", () => {
  it("keeps old slugs and resolveSlug points them at the current one", async () => {
    const env = await setup();
    const { id } = await create(env);
    await env.admin.mutation(api.admin.updateListing, { id, slug: "floema-furniture" });

    expect(await env.t.query(api.listings.getPublicBySlug, { slug: "floema" })).toBeNull();
    expect(await env.t.query(api.listings.resolveSlug, { slug: "floema" })).toBe("floema-furniture");
    expect(await env.t.query(api.listings.resolveSlug, { slug: "floema-furniture" })).toBeNull();
    expect(await env.t.query(api.listings.resolveSlug, { slug: "never-existed" })).toBeNull();

    await env.admin.mutation(api.admin.updateListing, { id, slug: "floema-studio" });
    expect(await env.t.query(api.listings.resolveSlug, { slug: "floema" })).toBe("floema-studio");
    expect(await env.t.query(api.listings.resolveSlug, { slug: "floema-furniture" })).toBe("floema-studio");
    let row = await env.t.run((ctx) => ctx.db.get(id));
    expect(row!.previousSlugs).toEqual(["floema", "floema-furniture"]);

    // Taking an old slug back removes it from the history.
    await env.admin.mutation(api.admin.updateListing, { id, slug: "floema" });
    row = await env.t.run((ctx) => ctx.db.get(id));
    expect(row!.slug).toBe("floema");
    expect(row!.previousSlugs).toEqual(["floema-furniture", "floema-studio"]);
    expect(await env.t.query(api.listings.resolveSlug, { slug: "floema" })).toBeNull();
    expect(await env.t.query(api.listings.resolveSlug, { slug: "floema-studio" })).toBe("floema");
  });

  it("keeps at most 10 old slugs, newest last", async () => {
    const env = await setup();
    const { id } = await create(env);
    for (let i = 1; i <= 12; i++) await env.admin.mutation(api.admin.updateListing, { id, slug: `floema-v${i}` });
    const row = await env.t.run((ctx) => ctx.db.get(id));
    expect(row!.previousSlugs).toHaveLength(10);
    expect(row!.previousSlugs!.at(-1)).toBe("floema-v11");
    expect(row!.previousSlugs).not.toContain("floema");
  });

  it("another listing's old slug counts as taken", async () => {
    const env = await setup();
    const { id } = await create(env);
    await env.admin.mutation(api.admin.updateListing, { id, slug: "floema-furniture" });

    // A new listing with the same title skips the retired slug.
    const other = await create(env, { url: "https://floema.example", creditName: "Someone Else" });
    expect(other.slug).toBe("floema-2");
    await expect(
      env.admin.mutation(api.admin.updateListing, { id: other.id, slug: "floema" }),
    ).rejects.toThrow(/already taken/);
    await expect(
      env.admin.mutation(api.admin.updateListing, { id: other.id, slug: "floema-furniture" }),
    ).rejects.toThrow(/already taken/);
  });

  it("only public listings redirect", async () => {
    const env = await setup();
    const { id } = await create(env);
    await env.admin.mutation(api.admin.updateListing, { id, slug: "floema-furniture" });
    await env.admin.mutation(api.admin.setLifecycle, { id, status: "rejected", note: "Duplicate" });
    expect(await env.t.query(api.listings.resolveSlug, { slug: "floema" })).toBeNull();
  });
});

describe("jury note", () => {
  it("is optional, public, cleaned and clearable", async () => {
    const env = await setup();
    const plain = await create(env, { url: "https://plain.example", title: "Plain" });
    expect((await env.t.query(api.listings.getPublicBySlug, { slug: plain.slug }))!.juryNote).toBeNull();

    const { id, slug } = await create(env, { juryNote: "  Calm,   precise\n\nand fast.  " });
    expect((await env.t.query(api.listings.getPublicBySlug, { slug }))!.juryNote).toBe("Calm, precise and fast.");
    expect((await env.admin.query(api.listings.reviewDetail, { id }))!.juryNote).toBe("Calm, precise and fast.");
    expect((await env.t.query(api.listings.listPublic, {})).find((l) => l.slug === slug)!.juryNote).toBe(
      "Calm, precise and fast.",
    );

    await env.admin.mutation(api.admin.updateListing, { id, juryNote: "A new note." });
    expect((await env.t.query(api.listings.getPublicBySlug, { slug }))!.juryNote).toBe("A new note.");
    await env.admin.mutation(api.admin.updateListing, { id, juryNote: "" });
    expect((await env.t.query(api.listings.getPublicBySlug, { slug }))!.juryNote).toBeNull();

    await expect(
      env.admin.mutation(api.admin.updateListing, { id, juryNote: "x".repeat(601) }),
    ).rejects.toThrow(/600 characters/);
  });
});

describe("IndexNow", () => {
  // Scheduled functions stay queued (only setTimeout is faked) so the tests
  // can inspect them, and a stubbed fetch means none can reach a real API.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
  });

  it("schedules nothing without INDEXNOW_KEY", async () => {
    const env = await setup();
    const { id } = await create(env);
    await env.admin.mutation(api.admin.updateListing, { id, slug: "floema-2026" });
    await env.admin.mutation(api.listings.closeVotingNow, { id });
    expect(await pings(env)).toEqual([]);
  });

  it("pings new, changed and removed public pages, once per mutation", async () => {
    vi.stubEnv("INDEXNOW_KEY", KEY);
    const env = await setup();

    // Pending: nothing public yet.
    const pending = await create(env, { status: "pending", url: "https://pending.example", title: "Pending" });
    expect(await pings(env)).toEqual([]);
    await env.admin.mutation(api.listings.approve, { id: pending.id });
    expect((await pings(env))[0]).toEqual(["/sites/pending", "/creators/burocratik", "/"]);

    const { id } = await create(env, { editorialScores: p(9) });
    expect((await pings(env))[1]).toEqual(["/sites/floema", "/creators/burocratik", "/"]);

    await env.admin.mutation(api.admin.updateListing, { id, slug: "floema-furniture" });
    expect((await pings(env))[2]).toEqual(["/sites/floema-furniture", "/creators/burocratik", "/sites/floema"]);

    await env.admin.mutation(api.listings.closeVotingNow, { id });
    expect((await pings(env))[3]).toEqual(["/sites/floema-furniture", "/creators/burocratik"]);

    // An award pings its award pages too.
    await env.admin.mutation(api.awards.grant, { listingId: id, tier: "SOTD", reason: "Test" });
    const award = (await env.t.run((ctx) => ctx.db.query("awards").first()))!;
    expect((await pings(env))[4]).toEqual([
      "/sites/floema-furniture",
      "/creators/burocratik",
      "/site-of-the-day",
      `/awards/${award.slug}`,
    ]);

    await env.admin.mutation(api.awards.revoke, { awardId: award._id, reason: "Test" });
    await env.admin.mutation(api.listings.remove, { id });
    expect((await pings(env))[6]).toEqual(["/sites/floema-furniture", "/creators/burocratik"]);
    expect(await pings(env)).toHaveLength(7);
  });

  it("pings creator profile edits and closes a batch of windows with one ping", async () => {
    vi.stubEnv("INDEXNOW_KEY", KEY);
    const env = await setup();
    const a = await create(env);
    const b = await create(env, { url: "https://b.example", title: "Bee" });
    const [creator] = await env.admin.query(api.admin.listCreators, {});
    await env.admin.mutation(api.admin.updateCreator, { id: creator.id, slug: "burocratik-studio" });
    expect((await pings(env)).at(-1)).toEqual(["/creators/burocratik-studio", "/creators/burocratik"]);

    for (const { id } of [a, b]) await env.t.run((ctx) => ctx.db.patch(id, { votingEndsAt: Date.now() - 1 }));
    const before = (await pings(env)).length;
    expect((await env.t.mutation(internal.awards.tick, {})).closed).toBe(2);
    const all = await pings(env);
    expect(all).toHaveLength(before + 1);
    expect(all.at(-1)).toEqual(expect.arrayContaining(["/sites/floema", "/sites/bee", "/creators/burocratik-studio"]));
  });

  it("POSTs absolute URLs with the key, and never throws", async () => {
    vi.stubEnv("INDEXNOW_KEY", KEY);
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const env = await setup();
    await create(env);
    await env.t.finishAllScheduledFunctions(vi.runAllTimers);

    // Each page is requested once (rebuilding its stale ISR copy), then one POST.
    const calls = fetchMock.mock.calls as [string, RequestInit | undefined][];
    expect(calls).toHaveLength(4);
    expect(calls.slice(0, 3).map(([u]) => u)).toEqual([
      "https://www.shemoqmedi.space/sites/floema",
      "https://www.shemoqmedi.space/creators/burocratik",
      "https://www.shemoqmedi.space/",
    ]);
    const [url, init] = calls[3] as [string, RequestInit];
    expect(url).toBe("https://api.indexnow.org/indexnow");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      host: "www.shemoqmedi.space",
      key: KEY,
      keyLocation: `https://www.shemoqmedi.space/${KEY}.txt`,
      urlList: [
        "https://www.shemoqmedi.space/sites/floema",
        "https://www.shemoqmedi.space/creators/burocratik",
        "https://www.shemoqmedi.space/",
      ],
    });

    // A network failure is logged, not thrown.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new Error("offline"));
    await env.t.action(internal.seo.pingIndexNow, { paths: ["/sites/floema"] });
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("does nothing in the action without a key", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const env = await setup();
    await env.t.action(internal.seo.pingIndexNow, { paths: ["/sites/floema"] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
