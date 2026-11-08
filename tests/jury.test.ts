/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const p = (n: number) => ({ design: n, usability: n, creativity: n, code: n });
const COMMENT = "Confident typography and a calm, precise grid. The 3D kitchen loads fast.";

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  await t.run(async (ctx) => {
    const mk = (externalId: string, extra: Record<string, unknown> = {}) =>
      ctx.db.insert("users", {
        externalId,
        name: externalId,
        email: `${externalId}@example.com`,
        createdAt: now,
        updatedAt: now,
        ...extra,
      });
    await mk("admin", { role: "super_admin" });
    await mk("ana", { hasImage: true, profilePicture: "https://img.clerk.com/ana.png" });
    await mk("beka", { hasImage: false, profilePicture: "https://img.clerk.com/default.png" });
    await mk("stranger");
  });
  const admin = t.withIdentity({ subject: "admin" });
  const coverId = await t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/png" })));
  const { slug, id } = await admin.mutation(api.admin.createListing, {
    title: "Kencho Room",
    tagline: "Kitchens",
    url: "https://room.example.ge",
    categories: ["architecture"],
    technologies: ["React"],
    region: "georgia",
    creatorTier: "solo",
    creditName: "Gio",
    coverId,
    status: "in_voting",
    isClaimed: false,
  });
  return {
    t,
    admin,
    ana: t.withIdentity({ subject: "ana" }),
    beka: t.withIdentity({ subject: "beka" }),
    stranger: t.withIdentity({ subject: "stranger" }),
    slug,
    id,
  };
}

const tokenOf = (link: string) => new URL(link).searchParams.get("token")!;
const profile = { name: "Ana Beridze", title: "Creative director at Studio A" };

describe("jury", () => {
  it("invites by email, accepts once with the invited account, then evaluates", async () => {
    const env = await setup();
    await expect(env.stranger.action(api.jury.invite, { email: "ana@example.com", name: "Ana" })).rejects.toThrow(/admin/);

    const sent = await env.admin.action(api.jury.invite, { email: "Ana@Example.com ", name: "Ana" });
    // No RESEND_API_KEY in tests: not sent, but the link is returned to copy.
    expect(sent.sent).toBe(false);
    expect(sent.error).toMatch(/RESEND_API_KEY/);
    const token = tokenOf(sent.link);
    expect(await env.t.query(api.jury.inviteByToken, { token })).toMatchObject({ status: "valid", email: "ana@example.com" });
    await expect(env.admin.action(api.jury.invite, { email: "ana@example.com", name: "Ana" })).rejects.toThrow(/open invitation/);

    await expect(env.stranger.mutation(api.jury.acceptInvite, { token, ...profile })).rejects.toThrow(/sent to ana@example.com/);
    await env.ana.mutation(api.jury.acceptInvite, { token, ...profile });
    await expect(env.ana.mutation(api.jury.acceptInvite, { token, ...profile })).rejects.toThrow(/already been used/);
    expect(await env.ana.query(api.jury.me, {})).toMatchObject({ name: "Ana Beridze", imageUrl: "https://img.clerk.com/ana.png" });
    expect(await env.stranger.query(api.jury.me, {})).toBeNull();

    await expect(
      env.stranger.mutation(api.jury.evaluate, { slug: env.slug, scores: p(8), comment: COMMENT }),
    ).rejects.toThrow(/jury members/);
    await expect(env.ana.mutation(api.jury.evaluate, { slug: env.slug, scores: p(8), comment: "Nice." })).rejects.toThrow(
      /at least/,
    );
    await env.ana.mutation(api.jury.evaluate, { slug: env.slug, scores: p(8), comment: COMMENT });
    const pub = await env.t.query(api.listings.getPublicBySlug, { slug: env.slug });
    expect(pub).toMatchObject({ editorialScores: p(8), finalScore: 8 });
    expect((await env.ana.query(api.jury.myEvaluation, { slug: env.slug }))!.evaluation!.comment).toBe(COMMENT);
  });

  it("averages several jurors; admins moderate instead of overriding", async () => {
    const env = await setup();
    for (const [who, user] of [["ana", env.ana], ["beka", env.beka]] as const) {
      const { link } = await env.admin.action(api.jury.invite, { email: `${who}@example.com`, name: who });
      await user.mutation(api.jury.acceptInvite, { token: tokenOf(link), name: who, title: "Designer" });
    }
    await env.ana.mutation(api.jury.evaluate, { slug: env.slug, scores: p(9), comment: COMMENT });
    await env.beka.mutation(api.jury.evaluate, { slug: env.slug, scores: p(7), comment: COMMENT });
    // Updating an evaluation replaces it.
    await env.beka.mutation(api.jury.evaluate, { slug: env.slug, scores: p(8), comment: COMMENT });
    expect((await env.t.query(api.listings.getPublicBySlug, { slug: env.slug }))!.editorialScores).toEqual(p(8.5));

    const reviews = await env.t.query(api.jury.reviewsForListing, { slug: env.slug });
    expect(reviews.map((r) => [r.juror.name, r.average, r.juror.imageUrl])).toEqual([
      ["ana", 9, "https://img.clerk.com/ana.png"],
      ["beka", 8, null], // Clerk default avatar → grey placeholder
    ]);
    expect((await env.t.query(api.jury.listPublic, {})).map((j) => j.evaluations)).toEqual([1, 1]);

    await expect(env.admin.mutation(api.listings.setEditorialScores, { id: env.id, scores: p(5) })).rejects.toThrow(
      /average of its jury evaluations/,
    );
    const [first] = await env.admin.query(api.jury.evaluationsForListing, { listingId: env.id });
    await env.admin.mutation(api.jury.deleteEvaluation, { evaluationId: first.id });
    expect((await env.t.query(api.listings.getPublicBySlug, { slug: env.slug }))!.editorialScores).toEqual(p(8));

    const { jurors } = await env.admin.query(api.jury.adminOverview, {});
    await env.admin.mutation(api.jury.setJurorActive, { jurorId: jurors[0].id, active: false });
    expect(await env.t.query(api.jury.listPublic, {})).toHaveLength(1);
  });

  it("revoked and resent links: the old link stops working", async () => {
    const env = await setup();
    const first = await env.admin.action(api.jury.invite, { email: "ana@example.com", name: "Ana" });
    const { invites } = await env.admin.query(api.jury.adminOverview, {});
    const again = await env.admin.action(api.jury.resendInvite, { inviteId: invites[0].id });
    expect((await env.t.query(api.jury.inviteByToken, { token: tokenOf(first.link) })).status).toBe("unknown");
    await env.admin.mutation(api.jury.revokeInvite, { inviteId: invites[0].id });
    expect((await env.t.query(api.jury.inviteByToken, { token: tokenOf(again.link) })).status).toBe("revoked");
    await expect(env.ana.mutation(api.jury.acceptInvite, { token: tokenOf(again.link), ...profile })).rejects.toThrow(
      /not valid/,
    );
  });
});
