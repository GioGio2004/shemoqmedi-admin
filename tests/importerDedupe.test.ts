/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";

// Audit A-10: the importer matched the exact URL only, so www/http variants of
// a listed site came in twice, and it changed input silently.

const modules = import.meta.glob("../convex/**/*.{ts,js}");

const base = {
  tagline: "A site.",
  category: "architecture",
  technologies: ["WebGL"],
  region: "global" as const,
  creatorTier: "agency" as const,
  creditName: "Studio",
  status: "pending" as const,
  isClaimed: false,
  source: "import" as const,
};

async function insert(t: ReturnType<typeof convexTest>, url: string, extra: Record<string, unknown> = {}) {
  const coverId = await t.run((ctx) => ctx.storage.store(new Blob(["x"], { type: "image/png" })));
  return t.mutation(internal.importer.insertImported, { ...base, url, title: "Floema", coverId, ...extra } as never);
}

describe("importer dedupe and warnings", () => {
  it("skips another spelling of a website that is already listed", async () => {
    const t = convexTest(schema, modules);
    const first = await insert(t, "https://floema.pt");
    expect(first.skipped).toBe(false);
    for (const url of ["https://www.floema.pt/", "http://FLOEMA.pt"]) {
      const again = await insert(t, url);
      expect(again).toMatchObject({ skipped: true, id: first.id });
    }
    expect(await t.query(internal.importer.existingOnDomain, { url: "https://www.floema.pt" })).toMatchObject({ id: first.id });
    expect(await t.query(internal.importer.existingOnDomain, { url: "https://other.example" })).toBeNull();
  });

  it("says what it changed instead of changing it silently", async () => {
    const t = convexTest(schema, modules);
    const out = await insert(t, "https://new.example", { category: "made-up", technologies: ["WebGL", "NotATech"] });
    expect(out.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/Unknown category/), expect.stringMatching(/1 technology/)]),
    );
  });
});
