/// <reference types="vite/client" />
// The listing desk: briefs Giorgi hands to his agent, drafts it submits over
// MCP, approval, send-back, new sites and the undoable copy history.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { mintServiceCredential } from "../convex/lib/tokens";
import { writeupProblems, editorialRules } from "../convex/lib/editorial";
import { DEFAULT_CONFIG } from "../convex/lib/config";

const modules = import.meta.glob("../convex/**/*.{ts,js}");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-11-16T08:00:00Z"));
  vi.stubEnv("MCP_SERVICE_SECRET", "test-secret-test-secret-test-secret");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** A write-up that passes the rules: three paragraphs, ~150 words, no hype. */
const WRITEUP = [
  "Floema is the site of a Portuguese maker of outdoor furniture and signage cast from recycled plastic, designed and built by the Lisbon studio Bürocratik.",
  "The first screen drops you into a slow WebGL scene where a bench is assembled from coloured plastic flakes as you scroll; each product page then swaps the scene for a tactile close-up of the material. Headlines are set large in a narrow grotesk, and the navigation stays as a single line of text at the top, so the material keeps the attention.",
  "Under the hood the scene is built with Three.js and the scroll timelines with GSAP, smoothed by Lenis. Studios working on product sites for physical goods will find a clear example of letting one material carry a whole brand, and of keeping heavy 3D calm and readable on a phone as well as on a desktop screen.",
].join("\n\n");

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("users", { externalId: "admin", name: "Giorgi", email: "admin@example.com", role: "admin", createdAt: now, updatedAt: now });
  });
  const admin = t.withIdentity({ subject: "admin" });
  const token = (await mintServiceCredential("admin"))!;
  const coverId = await t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/jpeg" })));
  const { id, slug } = await admin.mutation(api.admin.createListing, {
    title: "Floema",
    tagline: "A site",
    url: "https://floema.example",
    categories: ["architecture"],
    technologies: [],
    region: "global",
    creatorTier: "agency",
    creditName: "Bürocratik",
    coverId,
    status: "in_voting",
    isClaimed: false,
  });
  return { t, admin, token, listingId: id, slug, coverId };
}

const listing = (env: Awaited<ReturnType<typeof setup>>) => env.t.run((ctx) => ctx.db.get(env.listingId));

describe("editorial rules", () => {
  it("passes a good write-up and names the problems of a bad one", () => {
    expect(writeupProblems(WRITEUP)).toEqual([]);
    expect(writeupProblems("Too short.").join(" ")).toMatch(/2 words/);
    const hype = `${WRITEUP}\n\nA stunning, cutting-edge experience.`;
    expect(writeupProblems(hype).join(" ")).toMatch(/"stunning".*"cutting-edge"/);
    expect(writeupProblems(WRITEUP.replaceAll("\n\n", " ")).join(" ")).toMatch(/paragraphs/);
  });

  it("states the live award facts, never Code or a 60/40 split", () => {
    const rules = editorialRules(DEFAULT_CONFIG);
    expect(rules).toContain(`Site of the Day: final score ${DEFAULT_CONFIG.sotdMin.toFixed(1)}`);
    expect(rules).toContain("Content 10%");
    expect(rules).not.toMatch(/60%/);
  });
});

describe("the desk for an existing listing", () => {
  it("only drafts briefs on the desk, applies on approval and keeps an undoable history", async () => {
    const env = await setup();

    // Not on the desk: nothing to draft.
    expect(await env.t.query(api.mcp.editorialQueue, { token: env.token })).toEqual([]);

    const briefId = await env.admin.mutation(api.editorial.queueListing, { listingId: env.listingId, note: "Focus on the material" });
    // Queuing again keeps one open brief and takes the new note.
    expect(await env.admin.mutation(api.editorial.queueListing, { listingId: env.listingId, note: "Focus on the 3D" })).toBe(briefId);
    const queue = await env.t.query(api.mcp.editorialQueue, { token: env.token });
    expect(queue).toMatchObject([{ briefId, status: "queued", listingSlug: env.slug, note: "Focus on the 3D" }]);

    // The rules are enforced on submit.
    await expect(
      env.t.mutation(api.mcp.submitDraftTool, { token: env.token, briefId, draft: { writeup: "Short and stunning." }, sources: ["https://floema.example"] }),
    ).rejects.toThrow(/editorial rules/);
    await expect(
      env.t.mutation(api.mcp.submitDraftTool, { token: env.token, briefId, draft: { writeup: WRITEUP }, sources: [] }),
    ).rejects.toThrow(/sources/);
    await expect(
      env.t.mutation(api.mcp.submitDraftTool, { token: env.token, briefId, draft: { categories: ["not-a-category"] }, sources: ["https://floema.example"] }),
    ).rejects.toThrow();

    await env.t.mutation(api.mcp.submitDraftTool, {
      token: env.token,
      briefId,
      draft: { tagline: "Recycled-plastic outdoor furniture, shown in a scroll-built WebGL scene.", writeup: WRITEUP, technologies: ["Three.js", "GSAP", "Lenis"] },
      sources: ["https://floema.example", "https://floema.example/products"],
      agentNote: "Credits found in the footer.",
    });
    // Drafted: the site is untouched until Giorgi approves.
    expect((await listing(env))!.writeup).toBeUndefined();
    const brief = await env.t.query(api.mcp.getBrief, { token: env.token, briefId });
    expect(brief.status).toBe("drafted");
    expect(brief.changes.map((c: { field: string }) => c.field).sort()).toEqual(["tagline", "technologies", "writeup"]);

    // Without confirm the agent only gets the draft back.
    expect(await env.t.mutation(api.mcp.approveDraftTool, { token: env.token, briefId, confirm: false })).toMatchObject({ applied: false });
    expect((await listing(env))!.writeup).toBeUndefined();

    const approved = await env.t.mutation(api.mcp.approveDraftTool, { token: env.token, briefId, confirm: true });
    expect(approved).toMatchObject({ applied: true, slug: env.slug });
    const after = (await listing(env))!;
    expect(after.writeup).toBe(WRITEUP);
    expect(after.technologies).toEqual(["Three.js", "GSAP", "Lenis"]);
    expect(after.title).toBe("Floema"); // not in the draft: kept

    // The public page carries the write-up.
    const pub = await env.t.query(api.listings.getPublicBySlug, { slug: env.slug });
    expect(pub?.writeup).toBe(WRITEUP);

    // History: one agent revision, undoable.
    const history = await env.t.query(api.mcp.listingRevisions, { token: env.token, slug: env.slug });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ source: "agent", undoneAt: null });
    await env.t.mutation(api.mcp.undoChangeTool, { token: env.token, revisionId: history[0].id, confirm: true });
    const undone = (await listing(env))!;
    expect(undone.writeup).toBeUndefined();
    expect(undone.tagline).toBe("A site");
    expect(undone.technologies).toEqual([]);
    await expect(env.t.mutation(api.mcp.undoChangeTool, { token: env.token, revisionId: history[0].id, confirm: true })).rejects.toThrow(/already undone/);

    // The brief is closed: a new draft needs a new brief.
    await expect(
      env.t.mutation(api.mcp.submitDraftTool, { token: env.token, briefId, draft: { writeup: WRITEUP }, sources: ["https://floema.example"] }),
    ).rejects.toThrow(/closed/);
  });

  it("send back returns the brief to the agent with Giorgi's feedback", async () => {
    const env = await setup();
    const briefId = await env.admin.mutation(api.editorial.queueListing, { listingId: env.listingId });
    await env.t.mutation(api.mcp.submitDraftTool, { token: env.token, briefId, draft: { writeup: WRITEUP }, sources: ["https://floema.example"] });
    await env.admin.mutation(api.editorial.sendBack, { briefId, feedback: "Say more about the type." });
    expect(await env.t.query(api.mcp.editorialQueue, { token: env.token })).toMatchObject([
      { briefId, status: "queued", feedback: "Say more about the type.", rounds: 1 },
    ]);
  });

  it("refuses to undo a change whose fields changed again since", async () => {
    const env = await setup();
    await env.admin.mutation(api.admin.updateListing, { id: env.listingId, tagline: "First" });
    await env.admin.mutation(api.admin.updateListing, { id: env.listingId, tagline: "Second" });
    const [latest, first] = await env.admin.query(api.editorial.forListing, { listingId: env.listingId }).then((r) => r.revisions);
    expect(latest.source).toBe("admin");
    await expect(env.admin.mutation(api.editorial.undo, { revisionId: first.id })).rejects.toThrow(/changed again/);
    await env.admin.mutation(api.editorial.undo, { revisionId: latest.id });
    expect((await listing(env))!.tagline).toBe("First");
  });
});

describe("the desk for a new site", () => {
  it("drafts every field, waits for screenshots and links the new listing", async () => {
    const env = await setup();
    await expect(env.admin.mutation(api.editorial.queueNewSite, { url: "https://www.floema.example/" })).rejects.toThrow(/already listed/);

    const briefId = await env.t.mutation(api.mcp.queueBriefTool, { token: env.token, url: "https://new-site.example", note: "Giorgi asked" });
    await expect(
      env.t.mutation(api.mcp.submitDraftTool, { token: env.token, briefId, draft: { writeup: WRITEUP }, sources: ["https://new-site.example"] }),
    ).rejects.toThrow(/Missing: title, tagline, categories, region, creatorTier, creditName/);

    await env.t.mutation(api.mcp.submitDraftTool, {
      token: env.token,
      briefId,
      draft: {
        title: "New Site",
        tagline: "A portfolio built around one scroll-driven reel.",
        writeup: WRITEUP,
        categories: ["portfolio"],
        region: "georgia",
        creatorTier: "solo",
        creditName: "Nino Example",
        creditUrl: "nino.example",
      },
      sources: ["https://new-site.example"],
    });
    const approved = await env.admin.mutation(api.editorial.approve, { briefId: briefId as never });
    expect(approved.slug).toBeNull();
    expect(approved.next).toMatch(/listings\/new\?brief=/);

    const prefill = await env.admin.query(api.editorial.draftForNewListing, { briefId });
    expect(prefill).toMatchObject({ url: "https://new-site.example", draft: { title: "New Site", creditUrl: "https://nino.example" } });

    const { id } = await env.admin.mutation(api.admin.createListing, {
      title: prefill!.draft.title!,
      tagline: prefill!.draft.tagline!,
      writeup: prefill!.draft.writeup,
      url: prefill!.url,
      categories: prefill!.draft.categories!,
      technologies: prefill!.draft.technologies ?? [],
      region: prefill!.draft.region!,
      creatorTier: prefill!.draft.creatorTier!,
      creditName: prefill!.draft.creditName!,
      creditUrl: prefill!.draft.creditUrl,
      coverId: env.coverId,
      status: "pending",
      isClaimed: false,
      briefId: prefill!.id,
    });
    const brief = await env.t.run((ctx) => ctx.db.get(prefill!.id));
    expect(brief?.listingId).toBe(id);
    expect(await env.admin.query(api.editorial.draftForNewListing, { briefId })).toBeNull();
  });
});
