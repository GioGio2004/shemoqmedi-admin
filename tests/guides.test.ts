/// <reference types="vite/client" />
// Team guides (convex/guides.ts): admin-only, sections in order, reorder,
// screenshots only from the guides folder, starters added once by slug.
// And the section text format (lib/guideText.ts).
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { GUIDE_STARTERS } from "../convex/lib/guideStarters";
import { linkify, parseGuideText, placeholders } from "../lib/guideText";

const modules = import.meta.glob("../convex/**/*.{ts,js}");

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert("users", { externalId: "admin", name: "Giorgi", email: "admin@example.com", role: "super_admin", createdAt: now, updatedAt: now });
    await ctx.db.insert("users", { externalId: "user", name: "User", email: "user@example.com", createdAt: now, updatedAt: now });
  });
  return { t, admin: t.withIdentity({ subject: "admin" }), user: t.withIdentity({ subject: "user" }) };
}

const media = (t: Awaited<ReturnType<typeof setup>>["t"], filePath: string) =>
  t.run((ctx) =>
    ctx.db.insert("media", {
      fileId: `file${Math.random().toString(36).slice(2, 10)}`,
      url: `https://ik.imagekit.io/x${filePath}`,
      filePath,
      kind: "image",
      contentType: "image/webp",
      size: 1000,
      createdAt: Date.now(),
    }),
  );

describe("guides", () => {
  it("is admin-only", async () => {
    const { user } = await setup();
    await expect(user.query(api.guides.list, {})).rejects.toThrow(/admin/);
    await expect(user.mutation(api.guides.create, { title: "X", area: "social", roles: ["everyone"] })).rejects.toThrow(/admin/);
  });

  it("creates a draft with a unique slug, and edits its details", async () => {
    const { admin } = await setup();
    const a = await admin.mutation(api.guides.create, { title: "How to post on Instagram", area: "social", roles: ["ops"] });
    const b = await admin.mutation(api.guides.create, { title: "How to post on Instagram", area: "social", roles: ["ops"] });
    expect(a).toBe("how-to-post-on-instagram");
    expect(b).toBe("how-to-post-on-instagram-2");
    const g = (await admin.query(api.guides.get, { slug: a }))!;
    expect(g).toMatchObject({ status: "draft", area: "social", roles: ["ops"], sections: [], updatedByName: "Giorgi" });
    await admin.mutation(api.guides.update, { guideId: g.id, title: "  Post a listing  ", area: "listings", roles: ["ops", "ops", "developer"], status: "ready" });
    expect(await admin.query(api.guides.get, { slug: a })).toMatchObject({ title: "Post a listing", area: "listings", roles: ["ops", "developer"], status: "ready" });
    await expect(admin.mutation(api.guides.update, { guideId: g.id, roles: [] })).rejects.toThrow(/who the guide is for/);
  });

  it("adds, edits, reorders and deletes sections", async () => {
    const { t, admin } = await setup();
    const slug = await admin.mutation(api.guides.create, { title: "Replies", area: "networking", roles: ["owner"] });
    const guideId = (await admin.query(api.guides.get, { slug }))!.id;
    const s1 = await admin.mutation(api.guides.addSection, { guideId });
    const s2 = await admin.mutation(api.guides.addSection, { guideId, kind: "template" });
    const s3 = await admin.mutation(api.guides.addSection, { guideId });
    await admin.mutation(api.guides.updateSection, {
      sectionId: s2,
      kind: "template",
      heading: "Says yes",
      body: "Hi {name},\r\n\r\n\r\n\r\nthanks!   \n",
      language: "en",
      images: [],
    });
    let g = (await admin.query(api.guides.get, { slug }))!;
    expect(g.sections.map((s) => s.id)).toEqual([s1, s2, s3]);
    expect(g.sections[1]).toMatchObject({ heading: "Says yes", body: "Hi {name},\n\nthanks!", language: "en", kind: "template" });

    await admin.mutation(api.guides.moveSection, { sectionId: s2, direction: "up" });
    await admin.mutation(api.guides.moveSection, { sectionId: s2, direction: "up" }); // already first: no change
    await admin.mutation(api.guides.moveSection, { sectionId: s1, direction: "down" });
    g = (await admin.query(api.guides.get, { slug }))!;
    expect(g.sections.map((s) => s.id)).toEqual([s2, s3, s1]);

    // Language only applies to messages.
    await admin.mutation(api.guides.updateSection, { sectionId: s2, kind: "steps", heading: "Steps", body: "1. a", language: "en", images: [] });
    expect((await admin.query(api.guides.get, { slug }))!.sections[0].language).toBeUndefined();

    await admin.mutation(api.guides.removeSection, { sectionId: s3 });
    g = (await admin.query(api.guides.get, { slug }))!;
    expect(g.sections.map((s) => s.id)).toEqual([s2, s1]);
    await expect(admin.mutation(api.guides.updateSection, { sectionId: s1, kind: "steps", heading: " ", body: "", images: [] })).rejects.toThrow(/Heading/);

    await admin.mutation(api.guides.remove, { guideId });
    expect(await admin.query(api.guides.get, { slug })).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("guideSections").collect())).toHaveLength(0);
  });

  it("takes screenshots only from the guides folder, and deletes the ones taken off", async () => {
    const { t, admin } = await setup();
    const slug = await admin.mutation(api.guides.create, { title: "Shots", area: "listings", roles: ["ops"] });
    const guideId = (await admin.query(api.guides.get, { slug }))!.id;
    const sectionId = await admin.mutation(api.guides.addSection, { guideId });
    const listingShot = await media(t, "/listings/kencho/kencho-website-cover.webp");
    const a = await media(t, "/guides/shots/shots-1.webp");
    const b = await media(t, "/guides/shots/shots-2.webp");
    const base = { sectionId, kind: "steps" as const, heading: "Click here", body: "" };

    await expect(admin.mutation(api.guides.updateSection, { ...base, images: [{ mediaId: listingShot }] })).rejects.toThrow(/not uploaded to this guide/);
    await admin.mutation(api.guides.updateSection, { ...base, images: [{ mediaId: a, caption: " Press Save " }, { mediaId: b }, { mediaId: a }] });
    let s = (await admin.query(api.guides.get, { slug }))!.sections[0];
    expect(s.images.map((i) => [i.mediaId, i.caption])).toEqual([
      [a, "Press Save"],
      [b, undefined],
    ]);
    expect(s.images[0].url).toContain("/guides/shots/");

    await admin.mutation(api.guides.updateSection, { ...base, images: [{ mediaId: b }] });
    s = (await admin.query(api.guides.get, { slug }))!.sections[0];
    expect(s.images.map((i) => i.mediaId)).toEqual([b]);
    expect(await t.run((ctx) => ctx.db.get(a))).toBeNull(); // removed from the section → deleted
    expect(await t.run((ctx) => ctx.db.get(listingShot))).not.toBeNull();
  });

  it("adds the starter guides once, by slug, without overwriting edits", async () => {
    const { admin } = await setup();
    expect(await admin.query(api.guides.missingStarters, {})).toHaveLength(GUIDE_STARTERS.length);
    expect(await admin.mutation(api.guides.addStarters, {})).toBe(GUIDE_STARTERS.length);
    expect(await admin.mutation(api.guides.addStarters, {})).toBe(0);
    expect(await admin.query(api.guides.missingStarters, {})).toEqual([]);

    const list = await admin.query(api.guides.list, {});
    expect(list.map((g) => g.slug)).toEqual(GUIDE_STARTERS.map((g) => g.slug));
    const jury = (await admin.query(api.guides.get, { slug: "jury-invitations" }))!;
    expect(jury.status).toBe("ready");
    expect(jury.sections.length).toBe(GUIDE_STARTERS[0].sections.length);

    await admin.mutation(api.guides.update, { guideId: jury.id, title: "My own title" });
    await admin.mutation(api.guides.remove, { guideId: list[1].id });
    expect(await admin.mutation(api.guides.addStarters, {})).toBe(1);
    expect((await admin.query(api.guides.get, { slug: "jury-invitations" }))!.title).toBe("My own title");
  });
});

describe("starter guide facts", () => {
  const all = GUIDE_STARTERS.flatMap((g) => g.sections.map((s) => s.body)).join("\n");
  const jury = GUIDE_STARTERS.find((g) => g.slug === "jury-invitations")!;

  it("says what the live jury guide says", () => {
    const text = jury.sections.map((s) => s.body).join("\n");
    for (const fact of ["40%", "30%", "20%", "10%", "at least 3", "10 to 15 minutes", "5 to 15", "unpaid", "Founding Jury", "Jury Member, Shemoqmedi Awards"]) {
      expect(text).toContain(fact);
    }
    expect(text).not.toMatch(/a few minutes/i);
  });

  it("has every jury reply in English and Georgian", () => {
    const templates = jury.sections.filter((s) => s.kind === "template");
    expect(templates.filter((s) => s.language === "en").length).toBe(templates.filter((s) => s.language === "ka").length);
    expect(templates.length).toBeGreaterThanOrEqual(14);
  });

  it("never offers anything paid", () => {
    expect(all).not.toMatch(/\$|GEL|fast-track for|express/i);
  });
});

describe("guide text", () => {
  it("splits paragraphs, bullets and numbered steps", () => {
    expect(parseGuideText("Intro line\nsecond line\n\n- one\n- two\n  more of two\n\n3. third\n4) fourth")).toEqual([
      { type: "paragraph", lines: ["Intro line", "second line"] },
      { type: "bullets", items: ["one", "two\nmore of two"] },
      { type: "steps", start: 3, items: ["third", "fourth"] },
    ]);
    expect(parseGuideText("  \n\n")).toEqual([]);
  });

  it("links URLs but leaves trailing punctuation as text", () => {
    expect(linkify("See https://www.shemoqmedi.space/jury/guide.")).toEqual([
      { type: "text", text: "See " },
      { type: "link", href: "https://www.shemoqmedi.space/jury/guide", text: "https://www.shemoqmedi.space/jury/guide" },
      { type: "text", text: "." },
    ]);
    expect(linkify("no links")).toEqual([{ type: "text", text: "no links" }]);
  });

  it("lists the placeholders to fill in", () => {
    expect(placeholders("Hi {first name}, {site} and {site}. {სახელი}")).toEqual(["first name", "site", "სახელი"]);
  });
});
