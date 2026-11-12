/// <reference types="vite/client" />
// The social desk: MCP credentials, the post queue, studio emails (opt-outs,
// unsubscribe, the log) and broadcasts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { mintServiceCredential, unsubscribeToken } from "../convex/lib/tokens";
import { cleanHandle, mergeSocials } from "../convex/lib/contacts";
import { textToParagraphs } from "../convex/emails";

const modules = import.meta.glob("../convex/**/*.{ts,js}");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-11-12T08:00:00Z"));
  vi.stubEnv("MCP_SERVICE_SECRET", "test-secret-test-secret-test-secret");
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
  vi.stubEnv("RESEND_API_KEY", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("users", { externalId: "admin", name: "Giorgi Admin", email: "admin@example.com", role: "admin", createdAt: now, updatedAt: now });
    await ctx.db.insert("users", { externalId: "member", name: "Member", email: "member@example.com", createdAt: now, updatedAt: now });
  });
  const admin = t.withIdentity({ subject: "admin" });
  const token = (await mintServiceCredential("admin"))!;
  return { t, admin, token };
}
type Env = Awaited<ReturnType<typeof setup>>;

let n = 0;
/** A public, unclaimed site by a fresh studio with a contact email. */
async function site(env: Env, contactEmail: string | null = "hello@studio.example") {
  n += 1;
  const coverId = await env.t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/jpeg" })));
  const { id, slug } = await env.admin.mutation(api.admin.createListing, {
    title: `Site ${n}`,
    tagline: "A site",
    url: `https://site-${n}.example`,
    categories: ["portfolio"],
    technologies: [],
    region: "global",
    creatorTier: "agency",
    creditName: `Studio ${n}`,
    coverId,
    status: "in_voting",
    isClaimed: false,
  });
  const creatorId = (await env.t.run((ctx) => ctx.db.get(id)))!.creatorId!;
  if (contactEmail) {
    await env.admin.mutation(api.admin.updateCreator, { id: creatorId, contactEmail, socials: { instagram: "@studio_ig" } });
  }
  return { id, slug, creatorId };
}

const posts = (env: Env) => env.t.run((ctx) => ctx.db.query("socialPosts").collect());
const emails = (env: Env) => env.t.run((ctx) => ctx.db.query("emailLog").collect());
const drain = (env: Env) => env.t.finishAllScheduledFunctions(vi.runAllTimers);

describe("MCP credentials", () => {
  it("accepts a fresh admin credential only", async () => {
    const env = await setup();
    expect(await env.t.query(api.mcp.whoami, { token: env.token })).toMatchObject({ name: "Giorgi Admin", role: "admin" });

    // Not an admin.
    const member = (await mintServiceCredential("member"))!;
    expect(await env.t.query(api.mcp.whoami, { token: member })).toBeNull();
    // Forged signature.
    expect(await env.t.query(api.mcp.whoami, { token: `${env.token.slice(0, -4)}AAAA` })).toBeNull();
    // Expired.
    const old = (await mintServiceCredential("admin", 60_000, Date.now() - 5 * 60_000))!;
    expect(await env.t.query(api.mcp.whoami, { token: old })).toBeNull();
    // Claims too long a life.
    const long = (await mintServiceCredential("admin", 60 * 60_000))!;
    expect(await env.t.query(api.mcp.whoami, { token: long })).toBeNull();
    // Tools refuse a bad token.
    await expect(env.t.query(api.mcp.socialQueue, { token: member })).rejects.toThrow(/Not signed in/);
  });
});

describe("social queue", () => {
  it("queues one new-listing post per fresh site", async () => {
    const env = await setup();
    const s = await site(env);
    expect(await env.t.mutation(internal.social.queueNewListings, {})).toBe(1);
    expect(await env.t.mutation(internal.social.queueNewListings, {})).toBe(0);
    const [post] = await posts(env);
    expect(post).toMatchObject({ kind: "new_listing", status: "waiting", listingId: s.id });
    expect(post.facts.studio.socials).toEqual({ instagram: "studio_ig" });
    expect(post.media?.[0]).toMatchObject({ kind: "image", role: "screenshot" });
  });

  it("needs captions (and media for Instagram) before approval, then emails the studio once", async () => {
    const env = await setup();
    const s = await site(env);
    await env.t.mutation(internal.social.queueNewListings, {});
    const [post] = await posts(env);

    await expect(env.t.mutation(api.mcp.approvePost, { token: env.token, id: post._id })).rejects.toThrow(/at least one caption/);
    await env.t.mutation(api.mcp.updatePost, { token: env.token, id: post._id, captions: { instagram: "New on Shemoqmedi", linkedin: "I'm glad…" }, media: [] });
    await expect(env.t.mutation(api.mcp.approvePost, { token: env.token, id: post._id })).rejects.toThrow(/Instagram needs/);
    await env.t.mutation(api.mcp.updatePost, { token: env.token, id: post._id, captions: { instagram: "" } });
    const approved = await env.t.mutation(api.mcp.approvePost, { token: env.token, id: post._id });
    expect(approved.status).toBe("approved");
    await drain(env);

    const log = await emails(env);
    expect(log).toHaveLength(1);
    // No Resend key in tests: tried, logged as failed, to the studio's contact email.
    expect(log[0]).toMatchObject({ to: "hello@studio.example", kind: "featured", status: "failed", listingId: s.id });
    // The unclaimed listing got a claim link for the email.
    expect((await env.t.run((ctx) => ctx.db.get(s.id)))!.claimToken).toMatch(/^[a-f0-9]{64}$/);

    // Editing an approved post sends it back to waiting.
    const back = await env.t.mutation(api.mcp.updatePost, { token: env.token, id: post._id, note: "tweak" });
    expect(back.status).toBe("waiting");
  });

  it("calls and roundups are queued at most once a week", async () => {
    const env = await setup();
    await site(env);
    expect(await env.t.mutation(internal.social.queueCall, { kind: "call_submissions" })).not.toBeNull();
    expect(await env.t.mutation(internal.social.queueCall, { kind: "call_submissions" })).toBeNull();
    expect(await env.t.mutation(internal.social.queueRoundup, {})).not.toBeNull();
    expect(await env.t.mutation(internal.social.queueRoundup, {})).toBeNull();
  });
});

describe("emails", () => {
  it("skips people who unsubscribed, and the unsubscribe link works", async () => {
    const env = await setup();
    const s = await site(env, "Team@Studio.example");
    const tokenFor = (await unsubscribeToken("team@studio.example"))!;

    // GET shows a confirmation page and changes nothing.
    const page = await env.t.fetch(`/unsubscribe?e=team%40studio.example&t=${tokenFor}`, { method: "GET" });
    expect(page.status).toBe(200);
    expect(await env.t.run((ctx) => ctx.db.query("emailOptOuts").collect())).toHaveLength(0);
    // A wrong token is refused.
    const bad = await env.t.fetch(`/unsubscribe?e=team%40studio.example&t=nope`, { method: "POST" });
    expect(bad.status).toBe(400);
    // POST unsubscribes.
    const ok = await env.t.fetch(`/unsubscribe?e=team%40studio.example&t=${tokenFor}`, { method: "POST" });
    expect(ok.status).toBe(200);

    const sent = await env.t.action(api.mcp.sendEmail, {
      token: env.token,
      listingSlug: s.slug,
      subject: "Hello",
      body: "Hi!\n\nClaim it: {claimLink}",
      confirm: true,
    });
    expect(sent).toMatchObject({ sent: false, status: "skipped", to: "team@studio.example" });
    expect((await emails(env))[0]).toMatchObject({ status: "skipped", error: "Unsubscribed." });
  });

  it("previews without sending; {claimLink} is filled in", async () => {
    const env = await setup();
    const s = await site(env);
    const preview = await env.t.action(api.mcp.sendEmail, {
      token: env.token,
      listingSlug: s.slug,
      subject: "Your site",
      body: "Claim: {claimLink}",
      confirm: false,
    });
    expect(preview.sent).toBe(false);
    expect(preview.text).toMatch(/^Claim: https:\/\/.+\/claim\/[a-f0-9]{64}$/);
    expect(await emails(env)).toHaveLength(0);
  });

  it("award emails go to the studio's contact email when nobody owns the site", async () => {
    const env = await setup();
    const s = await site(env, "awards@studio.example");
    const awardId = await env.t.run((ctx) =>
      ctx.db.insert("awards", {
        listingId: s.id,
        tier: "SOTD",
        period: "2026-11-12",
        date: "2026-11-12",
        score: 7.5,
        slug: `${s.slug}-sotd-2026-11-12`,
        status: "active",
        source: "manual",
        reason: "test",
        createdAt: Date.now(),
      }),
    );
    await env.t.action(internal.notify.awardAnnounced, { awardId });
    const log = await emails(env);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ to: "awards@studio.example", kind: "award" });
    const [post] = await posts(env);
    expect(post).toMatchObject({ kind: "award", awardId, status: "waiting" });
    expect(post.facts.award).toMatchObject({ tier: "SOTD", name: "Site of the Day" });
  });

  it("broadcasts need confirm and count the audience without opt-outs", async () => {
    const env = await setup();
    await site(env, "one@studio.example");
    await site(env, "two@studio.example");
    await env.t.mutation(internal.emails.optOut, { email: "two@studio.example" });
    const preview = await env.t.action(api.mcp.sendBroadcast, { token: env.token, audience: "studios", subject: "News", body: "Hello", confirm: false });
    expect(preview).toMatchObject({ started: false, recipients: 1, sample: ["one@studio.example"] });
    expect(await emails(env)).toHaveLength(0);
    const started = await env.t.action(api.mcp.sendBroadcast, { token: env.token, audience: "studios", subject: "News", body: "Hello", confirm: true });
    expect(started.started).toBe(true);
    await drain(env);
    const log = await emails(env);
    expect(log.map((e) => e.to)).toEqual(["one@studio.example"]);
    expect(log[0]).toMatchObject({ kind: "broadcast", broadcastId: started.broadcastId });
  });
});

describe("contact helpers", () => {
  it("cleans handles from URLs and @-names", () => {
    expect(cleanHandle("instagram", "https://www.instagram.com/studio.x/")).toBe("studio.x");
    expect(cleanHandle("instagram", "@studio_x")).toBe("studio_x");
    expect(cleanHandle("linkedin", "https://www.linkedin.com/company/studio-x/")).toBe("company/studio-x");
    expect(() => cleanHandle("instagram", "not a handle!")).toThrow();
    expect(mergeSocials({ instagram: "a" }, { instagram: "", facebook: "b" })).toEqual({ facebook: "b" });
  });

  it("turns chat text into safe paragraphs with links", () => {
    expect(textToParagraphs("Hi <b>\n\nSee https://x.example/a.")).toEqual([
      "Hi &lt;b&gt;",
      'See <a href="https://x.example/a" style="color:#000">https://x.example/a</a>.',
    ]);
  });
});
