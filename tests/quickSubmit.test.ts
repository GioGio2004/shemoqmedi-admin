/// <reference types="vite/client" />
// Website submissions (convex/quickSubmit.ts): saved before any sign-in,
// idempotent on the browser's secret, linked to an account only with the
// secret AND a matching verified email, never exposing the email publicly.
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  await t.run(async (ctx) => {
    const mk = (externalId: string, email: string, extra: Record<string, unknown> = {}) =>
      ctx.db.insert("users", { externalId, name: externalId, email, createdAt: now, updatedAt: now, ...extra });
    await mk("admin", "admin@example.com", { role: "super_admin" });
    await mk("nino", "nino@studio.ge");
    await mk("other", "other@example.com");
  });
  return {
    t,
    admin: t.withIdentity({ subject: "admin" }),
    nino: t.withIdentity({ subject: "nino" }),
    other: t.withIdentity({ subject: "other" }),
  };
}

const site = { name: "Studio Nord", url: "studionord.example.com", email: "Nino@Studio.ge" };
const rows = (t: Awaited<ReturnType<typeof setup>>["t"]) => t.run((ctx) => ctx.db.query("quickSubmissions").collect());
const saved = (t: Awaited<ReturnType<typeof setup>>["t"]) =>
  t.run(async (ctx) =>
    (await ctx.db.query("funnelCounts").collect())
      .filter((r) => r.event === "guest_submission_saved")
      .reduce((n, r) => n + r.count, 0),
  );

describe("submit", () => {
  it("saves a guest submission for good, once per browser secret", async () => {
    const { t } = await setup();
    const first = await t.mutation(api.quickSubmit.submit, { ...site, token: A });
    const again = await t.mutation(api.quickSubmit.submit, { ...site, token: A });
    expect(first).toEqual({ id: again.id, linked: false });
    const all = await rows(t);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ status: "received", email: "nino@studio.ge", url: "https://studionord.example.com" });
    expect(all[0].userId).toBeUndefined();
    expect(await saved(t)).toBe(1);
  });

  it("records attribution without personal data", async () => {
    const { t } = await setup();
    await t.mutation(api.quickSubmit.submit, {
      ...site,
      token: A,
      attribution: { utmSource: "instagram", utmCampaign: "submit-carousel", device: "mobile", inApp: "instagram" },
    });
    const [row] = await rows(t);
    expect(row).toMatchObject({ utmSource: "instagram", utmCampaign: "submit-carousel", device: "mobile", inApp: "instagram" });
    const funnel = await t.run((ctx) => ctx.db.query("funnelCounts").collect());
    expect(funnel.map((f) => f.source)).toEqual(["instagram"]);
    expect(JSON.stringify(funnel)).not.toContain("@");
  });

  it("links right away when signed in with the same email", async () => {
    const { nino } = await setup();
    const res = await nino.mutation(api.quickSubmit.submit, { ...site, token: A });
    expect(res.linked).toBe(true);
    expect(await nino.query(api.quickSubmit.mine, {})).toHaveLength(1);
  });

  it("does not link when signed in with a different email", async () => {
    const { other } = await setup();
    const res = await other.mutation(api.quickSubmit.submit, { ...site, token: A });
    expect(res.linked).toBe(false);
    expect(await other.query(api.quickSubmit.mine, {})).toHaveLength(0);
  });

  it("refuses the honeypot, bad secrets and bad addresses", async () => {
    const { t } = await setup();
    await expect(t.mutation(api.quickSubmit.submit, { ...site, token: A, website: "spam" })).rejects.toThrow();
    await expect(t.mutation(api.quickSubmit.submit, { ...site, token: "short" })).rejects.toThrow();
    await expect(t.mutation(api.quickSubmit.submit, { ...site, email: "nope", token: A })).rejects.toThrow(/valid email/);
    await expect(t.mutation(api.quickSubmit.submit, { ...site, url: "javascript:alert(1)", token: A })).rejects.toThrow();
    expect(await rows(t)).toHaveLength(0);
  });

  it("refuses a second submitter for an open site; the same email from another browser gets the same submission", async () => {
    const { t } = await setup();
    const { id } = await t.mutation(api.quickSubmit.submit, { ...site, token: A });
    await expect(
      t.mutation(api.quickSubmit.submit, { ...site, email: "someone@else.com", token: B }),
    ).rejects.toThrow(/already been submitted/);
    const second = await t.mutation(api.quickSubmit.submit, { ...site, url: "https://studionord.example.com/", token: B });
    expect(second.id).toBe(id);
    expect(await rows(t)).toHaveLength(1);
    // That browser can see and link it, but never change its email.
    expect(await t.query(api.quickSubmit.prefill, { id, token: B })).toMatchObject({ canCorrect: false });
    await expect(t.mutation(api.quickSubmit.correctEmail, { id, token: B, email: "x@evil.com" })).rejects.toThrow();
    // The first browser keeps its secret.
    expect(await t.query(api.quickSubmit.prefill, { id, token: A })).toMatchObject({ canCorrect: true });
  });
});

describe("prefill", () => {
  it("shows nothing without the right secret", async () => {
    const { t } = await setup();
    const { id } = await t.mutation(api.quickSubmit.submit, { ...site, token: A });
    expect(await t.query(api.quickSubmit.prefill, { id, token: C })).toBeNull();
    expect(await t.query(api.quickSubmit.prefill, { id: "not-an-id", token: A })).toBeNull();
    expect(await t.query(api.quickSubmit.prefill, { id, token: A })).toEqual({
      name: "Studio Nord",
      email: "nino@studio.ge",
      linked: false,
      canCorrect: true,
    });
  });
});

describe("link", () => {
  it("needs a signed-in account", async () => {
    const { t } = await setup();
    const { id } = await t.mutation(api.quickSubmit.submit, { ...site, token: A });
    await expect(t.mutation(api.quickSubmit.link, { id, token: A })).rejects.toThrow();
  });

  it("links with the secret and the matching verified email, once", async () => {
    const { t, nino, other } = await setup();
    const { id } = await t.mutation(api.quickSubmit.submit, { ...site, token: A });
    expect(await nino.mutation(api.quickSubmit.link, { id, token: C })).toEqual({ status: "not_found", submittedEmail: null });
    expect(await nino.mutation(api.quickSubmit.link, { id, token: A })).toEqual({ status: "linked", submittedEmail: null });
    expect(await nino.mutation(api.quickSubmit.link, { id, token: A })).toEqual({ status: "linked", submittedEmail: null });
    expect(await other.mutation(api.quickSubmit.link, { id, token: A })).toEqual({ status: "taken", submittedEmail: null });
    expect(await nino.query(api.quickSubmit.mine, {})).toMatchObject([{ id, status: "received" }]);
    expect(await other.query(api.quickSubmit.mine, {})).toEqual([]);
  });

  it("does not link another email, and shows it only masked", async () => {
    const { t, other } = await setup();
    const { id } = await t.mutation(api.quickSubmit.submit, { ...site, token: A });
    const res = await other.mutation(api.quickSubmit.link, { id, token: A });
    expect(res.status).toBe("mismatch");
    expect(res.submittedEmail).toBe("ni•••@studio.ge");
    const [row] = await rows(t);
    expect(row.userId).toBeUndefined();
  });
});

describe("correctEmail", () => {
  it("lets the submitting browser fix a typo, then linking follows the new address", async () => {
    const { t, nino } = await setup();
    const { id } = await t.mutation(api.quickSubmit.submit, { ...site, email: "nino@studoi.ge", token: A });
    await t.mutation(api.quickSubmit.correctEmail, { id, token: A, email: "nino@studio.ge" });
    expect(await nino.mutation(api.quickSubmit.link, { id, token: A })).toMatchObject({ status: "linked" });
    // Linked: no more changes.
    await expect(t.mutation(api.quickSubmit.correctEmail, { id, token: A, email: "x@y.com" })).rejects.toThrow();
  });
});

describe("admin", () => {
  it("lists new submissions for admins only and turns one into a listing", async () => {
    const { t, admin, nino } = await setup();
    const { id } = await t.mutation(api.quickSubmit.submit, { ...site, token: A });
    await expect(nino.query(api.quickSubmit.adminList, { status: "received" })).rejects.toThrow();
    const list = await admin.query(api.quickSubmit.adminList, { status: "received" });
    expect(list).toMatchObject([{ id, linked: false, email: "nino@studio.ge" }]);
    expect(await admin.query(api.quickSubmit.adminOpenCount, {})).toBe(1);

    await admin.mutation(api.quickSubmit.setStatus, { id, status: "preparing" });
    const coverId = await t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/png" })));
    const listing = await admin.mutation(api.admin.createListing, {
      title: "Studio Nord",
      tagline: "Studio",
      url: "https://studionord.example.com",
      categories: ["architecture"],
      technologies: ["React"],
      region: "georgia",
      creatorTier: "solo",
      creditName: "Studio Nord",
      coverId,
      status: "pending",
      isClaimed: false,
      quickId: id as Id<"quickSubmissions">,
    });
    const [row] = await rows(t);
    expect(row).toMatchObject({ status: "listed", listingId: listing.id });

    // Linking later makes the account its submitter (for emails), not its owner.
    await nino.mutation(api.quickSubmit.link, { id, token: A });
    const l = await t.run((ctx) => ctx.db.get(listing.id));
    expect(l?.submittedBy).toBeDefined();
    expect(l?.ownerId).toBeUndefined();
  });
});

// The site's full form (/submit/full, listings.submit) and the 30-second
// submissions: one entry per website, whichever form it came through.
describe("full form", () => {
  const full = (coverId: Id<"_storage">, url = "https://www.studionord.example.com/") => ({
    title: "Studio Nord",
    tagline: "Architecture studio from Tbilisi.",
    url,
    categories: ["architecture"],
    technologies: ["React"],
    creatorTier: "solo" as const,
    region: "georgia" as const,
    creditName: "Studio Nord",
    submissionTier: "standard" as const,
    coverId,
  });
  const cover = (t: Awaited<ReturnType<typeof setup>>["t"]) =>
    t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/png" })));
  const listings = (t: Awaited<ReturnType<typeof setup>>["t"]) => t.run((ctx) => ctx.db.query("listings").collect());

  it("completes the account's own open submission instead of adding a second entry", async () => {
    const { t, admin, nino } = await setup();
    const { id } = await nino.mutation(api.quickSubmit.submit, { ...site, token: A });
    expect(await nino.query(api.listings.precheckSubmission, { url: site.url })).toEqual({ ok: true });
    await nino.mutation(api.listings.submit, full(await cover(t)));

    const [listing] = await listings(t);
    expect(await listings(t)).toHaveLength(1);
    expect(listing).toMatchObject({ status: "pending", source: "submission" });
    expect(await rows(t)).toMatchObject([{ status: "listed", listingId: listing._id }]);
    expect(await admin.query(api.quickSubmit.adminOpenCount, {})).toBe(0);
    expect(await nino.query(api.quickSubmit.mine, {})).toMatchObject([{ id, status: "listed", listing: { status: "pending" } }]);
  });

  it("links and completes a guest submission sent with the account's email", async () => {
    const { t, nino } = await setup();
    await t.mutation(api.quickSubmit.submit, { ...site, token: A });
    expect((await rows(t))[0].userId).toBeUndefined();
    await nino.mutation(api.listings.submit, full(await cover(t)));
    const [row] = await rows(t);
    expect(row.status).toBe("listed");
    expect(row.userId).toBeDefined();
    expect(row.listingId).toBeDefined();
    expect(await nino.query(api.quickSubmit.mine, {})).toHaveLength(1);
  });

  it("refuses a site someone else already sent, before any upload", async () => {
    const { t, other } = await setup();
    await t.mutation(api.quickSubmit.submit, { ...site, token: A });
    expect(await other.query(api.listings.precheckSubmission, { url: site.url })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/already been submitted/),
    });
    await expect(other.mutation(api.listings.submit, full(await cover(t)))).rejects.toThrow(/already been submitted/);
    expect(await listings(t)).toHaveLength(0);
    expect(await rows(t)).toMatchObject([{ status: "received" }]);
  });

  it("leaves another website's submission alone", async () => {
    const { t, nino } = await setup();
    await nino.mutation(api.quickSubmit.submit, { ...site, token: A });
    await nino.mutation(api.listings.submit, full(await cover(t), "https://another-site.example.com"));
    expect(await rows(t)).toMatchObject([{ status: "received" }]);
    expect((await rows(t))[0].listingId).toBeUndefined();
  });

  it("withdrawing the listing takes the creator's submission with it", async () => {
    const { t, nino } = await setup();
    await nino.mutation(api.quickSubmit.submit, { ...site, token: A });
    await nino.mutation(api.listings.submit, full(await cover(t)));
    const [mine] = await nino.query(api.listings.myListings, {});
    expect(await nino.mutation(api.listings.withdraw, { id: mine.id })).toEqual({ result: "deleted" });
    expect(await rows(t)).toHaveLength(0);
    expect(await nino.query(api.quickSubmit.mine, {})).toEqual([]);
  });

  it("an editor deleting the listing closes the submission, which can be reopened", async () => {
    const { t, admin, nino } = await setup();
    const { id } = await nino.mutation(api.quickSubmit.submit, { ...site, token: A });
    await nino.mutation(api.listings.submit, full(await cover(t)));
    const [listing] = await listings(t);
    await admin.mutation(api.listings.remove, { id: listing._id });
    const [row] = await rows(t);
    expect(row.status).toBe("rejected");
    expect(row.listingId).toBeUndefined();
    await admin.mutation(api.quickSubmit.setStatus, { id: id as Id<"quickSubmissions">, status: "received" });
    expect(await admin.query(api.quickSubmit.adminOpenCount, {})).toBe(1);
  });
});
