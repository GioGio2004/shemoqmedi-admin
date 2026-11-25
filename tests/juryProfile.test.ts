/// <reference types="vite/client" />
// LinkedIn-style jury profiles: more panels, dated experience and education.
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { cleanEducation, cleanExperience, sortExperience } from "../convex/lib/juryProfile";
import { JURY_CATEGORIES, LIMITS } from "../convex/lib/taxonomy";

const modules = import.meta.glob("../convex/**/*.{ts,js}");
const NOW = Date.UTC(2026, 10, 25); // 25 Nov 2026

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  await t.run(async (ctx) => {
    for (const [externalId, extra] of [
      ["admin", { role: "super_admin" as const }],
      ["ana", {}],
      ["stranger", {}],
    ] as const) {
      await ctx.db.insert("users", {
        externalId,
        name: externalId,
        email: `${externalId}@example.com`,
        createdAt: now,
        updatedAt: now,
        ...extra,
      });
    }
  });
  const admin = t.withIdentity({ subject: "admin" });
  const ana = t.withIdentity({ subject: "ana" });
  const stranger = t.withIdentity({ subject: "stranger" });
  return { t, admin, ana, stranger };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** An admin creates Ana's profile, Ana claims it, an admin activates it. */
async function anaOnTheJury(env: Env, extra: Record<string, unknown> = {}) {
  const { id, slug } = await env.admin.mutation(api.jury.createJuror, {
    name: "Ana Beridze",
    title: "Head of Product",
    category: "product",
    ...extra,
  });
  const { url } = await env.admin.action(api.claimLinks.link, { target: { kind: "juror", id } });
  await env.ana.mutation(api.claimLinks.claim, { token: url.split("/claim/")[1] });
  await env.admin.mutation(api.claimLinks.activateJuror, { jurorId: id });
  return { id, slug };
}

describe("jury panels", () => {
  it("keeps the original four panels and adds the new ones, without duplicates", () => {
    const slugs = JURY_CATEGORIES.map((c) => c.slug);
    for (const old of ["design", "engineering", "venture", "academic"]) expect(slugs).toContain(old);
    for (const added of ["product", "brand", "motion", "accessibility", "growth"]) expect(slugs).toContain(added);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("an admin can put a juror on a new panel, and an unknown panel is refused", async () => {
    const env = await setup();
    const { id } = await env.admin.mutation(api.jury.createJuror, { name: "Nino", title: "Motion designer", category: "motion" });
    await env.admin.mutation(api.jury.updateJuror, { jurorId: id, category: "accessibility" });
    const row = (await env.admin.query(api.jury.adminOverview, {})).find((j) => j.id === id);
    expect(row!.category).toBe("accessibility");
    await expect(
      env.admin.mutation(api.jury.updateJuror, { jurorId: id, category: "astrology" as never }),
    ).rejects.toThrow();
  });
});

describe("cleanExperience", () => {
  it("sorts newest first: current roles, then by end date, then by start; undated rows last", () => {
    const rows = cleanExperience(
      [
        { title: "Intern", organization: "A", startYear: 2012, endYear: 2013 },
        { title: "Legacy", organization: "B", period: "2010 – 2011" },
        { title: "Lead", organization: "C", startYear: 2020, startMonth: 3, current: true },
        { title: "Senior", organization: "D", startYear: 2016, startMonth: 1, endYear: 2020, endMonth: 2 },
        { title: "Founder", organization: "E", startYear: 2023, current: true },
      ],
      NOW,
    )!;
    expect(rows.map((r) => r.title)).toEqual(["Founder", "Lead", "Senior", "Intern", "Legacy"]);
  });

  it("keeps every LinkedIn field, normalises the company link and keeps line breaks in the description", () => {
    const [row] = cleanExperience(
      [
        {
          title: " Design director ",
          organization: "Studio X",
          organizationUrl: "studiox.com",
          location: "Tbilisi,   Georgia",
          startYear: 2021,
          startMonth: 4,
          current: true,
          description: "Led the rebrand.\n- Built the team\n\n\n\n- Shipped the site",
        },
      ],
      NOW,
    )!;
    expect(row).toEqual({
      title: "Design director",
      organization: "Studio X",
      organizationUrl: "https://studiox.com",
      location: "Tbilisi, Georgia",
      startYear: 2021,
      startMonth: 4,
      current: true,
      description: "Led the rebrand.\n- Built the team\n\n- Shipped the site",
    });
  });

  it("drops the end date of a current role and the free-text period once real dates are set", () => {
    const [row] = cleanExperience(
      [{ title: "Lead", organization: "C", startYear: 2020, endYear: 2022, endMonth: 5, current: true, period: "2020 – now" }],
      NOW,
    )!;
    expect(row).toEqual({ title: "Lead", organization: "C", startYear: 2020, current: true });
  });

  it("keeps the free-text period on rows without dates", () => {
    expect(cleanExperience([{ title: "Art director", organization: "Studio X", period: "2019 – present" }], NOW)).toEqual([
      { title: "Art director", organization: "Studio X", period: "2019 – present" },
    ]);
  });

  it("refuses broken dates", () => {
    const one = (row: Record<string, unknown>) => () =>
      cleanExperience([{ title: "Lead", organization: "C", ...row }], NOW);
    expect(one({ startYear: 2022, endYear: 2020 })).toThrow(/ends before it starts/);
    expect(one({ startYear: 2022, startMonth: 6, endYear: 2022, endMonth: 3 })).toThrow(/ends before it starts/);
    expect(one({ endYear: 2020 })).toThrow(/start year/);
    expect(one({ current: true })).toThrow(/start year/);
    expect(one({ startYear: 2027 })).toThrow(/between 1950 and 2026/);
    expect(one({ startYear: 2026, startMonth: 12 })).toThrow(/starts in the future/);
    expect(one({ startYear: 1900 })).toThrow(/between 1950/);
    expect(one({ startYear: 2020.5 })).toThrow(/year/);
    expect(one({ startYear: 2020, startMonth: 13 })).toThrow(/month from 1 to 12/);
    expect(one({ startMonth: 3 })).toThrow(/needs a year/);
    expect(one({ organizationUrl: "javascript:alert(1)" })).toThrow();
    expect(one({ description: "x".repeat(LIMITS.juryExperienceDescription + 1) })).toThrow(/characters or fewer/);
  });

  it("same month start and end is fine; a year-only end counts as December", () => {
    expect(cleanExperience([{ title: "A", organization: "B", startYear: 2022, startMonth: 6, endYear: 2022, endMonth: 6 }], NOW)).toHaveLength(1);
    expect(cleanExperience([{ title: "A", organization: "B", startYear: 2022, startMonth: 6, endYear: 2022 }], NOW)).toHaveLength(1);
  });

  it("drops empty rows, requires role and company on the rest, caps the count", () => {
    expect(cleanExperience([{ title: " ", organization: "" }], NOW)).toBeUndefined();
    expect(() => cleanExperience([{ title: "", organization: "", startYear: 2020 }], NOW)).toThrow(/role and a company/);
    const many = Array.from({ length: LIMITS.juryExperience + 1 }, (_, i) => ({ title: `R${i}`, organization: "X" }));
    expect(() => cleanExperience(many, NOW)).toThrow(/Add up to/);
  });

  it("sortExperience is stable for undated rows", () => {
    const rows = [
      { title: "B", organization: "x" },
      { title: "A", organization: "x" },
    ];
    expect(sortExperience(rows).map((r) => r.title)).toEqual(["B", "A"]);
  });
});

describe("cleanEducation", () => {
  it("needs a school, checks years (expected graduation allowed), sorts newest first", () => {
    expect(
      cleanEducation(
        [
          { school: "Tbilisi State Academy of Arts", degree: "BA", field: "Graphic design", startYear: 2008, endYear: 2012 },
          { school: "Aalto University", degree: "MA", startYear: 2024, endYear: 2028 },
          { school: " ", degree: "" },
        ],
        NOW,
      )!.map((r) => r.school),
    ).toEqual(["Aalto University", "Tbilisi State Academy of Arts"]);
    expect(() => cleanEducation([{ school: "", degree: "MA" }], NOW)).toThrow(/needs a school/);
    expect(() => cleanEducation([{ school: "X", startYear: 2020, endYear: 2018 }], NOW)).toThrow(/ends before/);
    expect(() => cleanEducation([{ school: "X", endYear: 2040 }], NOW)).toThrow(/between/);
    expect(() => cleanEducation([{ school: "X", startYear: 2030 }], NOW)).toThrow(/between/);
    expect(cleanEducation([], NOW)).toBeUndefined();
  });
});

describe("experience and education on the profile", () => {
  it("a juror saves dated experience and education; the public page shows them newest first", async () => {
    const env = await setup();
    const { slug } = await anaOnTheJury(env);
    await env.ana.mutation(api.jury.updateProfile, {
      name: "Ana Beridze",
      title: "Head of Product",
      experience: [
        { title: "Product designer", organization: "Bank of Georgia", startYear: 2017, startMonth: 2, endYear: 2021, endMonth: 8 },
        {
          title: "Head of Product",
          organization: "Studio X",
          organizationUrl: "https://studiox.com",
          location: "Tbilisi, Georgia",
          startYear: 2021,
          startMonth: 9,
          current: true,
          description: "Leads product and research.",
        },
      ],
      education: [{ school: "Tbilisi State University", degree: "BSc", field: "Computer science", startYear: 2012, endYear: 2016 }],
    });
    const page = await env.t.query(api.jury.getBySlug, { slug });
    expect(page!.juror.experience.map((e) => e.title)).toEqual(["Head of Product", "Product designer"]);
    expect(page!.juror.experience[0]).toMatchObject({ current: true, location: "Tbilisi, Georgia", organizationUrl: "https://studiox.com" });
    expect(page!.juror.education).toEqual([
      { school: "Tbilisi State University", degree: "BSc", field: "Computer science", startYear: 2012, endYear: 2016 },
    ]);
    // Absent keeps, [] clears.
    await env.ana.mutation(api.jury.updateProfile, { name: "Ana Beridze", title: "Head of Product", education: [] });
    const me = await env.ana.query(api.jury.me, {});
    expect(me!.experience).toHaveLength(2);
    expect(me!.education).toEqual([]);
  });

  it("refuses a juror's broken dates and leaves the saved profile alone", async () => {
    const env = await setup();
    await anaOnTheJury(env, { experience: [{ title: "Lead", organization: "C", startYear: 2020, current: true }] });
    await expect(
      env.ana.mutation(api.jury.updateProfile, {
        name: "Ana Beridze",
        title: "Head of Product",
        experience: [{ title: "Lead", organization: "C", startYear: 2024, endYear: 2020 }],
      }),
    ).rejects.toThrow(/ends before it starts/);
    expect((await env.ana.query(api.jury.me, {}))!.experience).toEqual([
      { title: "Lead", organization: "C", startYear: 2020, current: true },
    ]);
  });

  it("an admin sets and clears experience and education; old free-text rows still load", async () => {
    const env = await setup();
    const { id } = await env.admin.mutation(api.jury.createJuror, {
      name: "Giga",
      title: "Brand director",
      category: "brand",
      experience: [{ title: "Brand director", organization: "Old Co", period: "2015 – 2019" }],
      education: [{ school: "Free University of Tbilisi" }],
    });
    let row = (await env.admin.query(api.jury.adminOverview, {})).find((j) => j.id === id)!;
    expect(row.experience).toEqual([{ title: "Brand director", organization: "Old Co", period: "2015 – 2019" }]);
    expect(row.education).toEqual([{ school: "Free University of Tbilisi" }]);
    await env.admin.mutation(api.jury.updateJuror, {
      jurorId: id,
      experience: [{ title: "Brand director", organization: "Old Co", startYear: 2015, endYear: 2019, period: "2015 – 2019" }],
      education: [],
    });
    row = (await env.admin.query(api.jury.adminOverview, {})).find((j) => j.id === id)!;
    expect(row.experience).toEqual([{ title: "Brand director", organization: "Old Co", startYear: 2015, endYear: 2019 }]);
    expect(row.education).toEqual([]);
  });

  it("only the juror themself or an admin can edit the lists", async () => {
    const env = await setup();
    const { id } = await anaOnTheJury(env);
    await expect(
      env.stranger.mutation(api.jury.updateProfile, { name: "X", title: "Y", experience: [] }),
    ).rejects.toThrow();
    await expect(
      env.stranger.mutation(api.jury.updateJuror, { jurorId: id, education: [{ school: "Hacked" }] }),
    ).rejects.toThrow();
  });

  it("the claim page preview shows the education before claiming", async () => {
    const env = await setup();
    const { id } = await env.admin.mutation(api.jury.createJuror, {
      name: "Nino",
      title: "Researcher",
      category: "academic",
      education: [{ school: "Ilia State University", degree: "PhD", endYear: 2020 }],
    });
    const { url } = await env.admin.action(api.claimLinks.link, { target: { kind: "juror", id } });
    const preview = await env.t.query(api.claimLinks.resolve, { token: url.split("/claim/")[1] });
    expect(preview.juror!.education).toEqual([{ school: "Ilia State University", degree: "PhD", endYear: 2020 }]);
  });
});
