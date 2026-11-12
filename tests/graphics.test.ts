/// <reference types="vite/client" />
// Social graphics: text fitting, the carousel's slide plan, palettes from a
// site's colours, the backdrop raster, and the facts a carousel is told from.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { fit, wrapLines } from "../lib/graphics/glass";
import { storyPlan, type StoryFacts } from "../lib/graphics/story";
import { graphicsQuery } from "../lib/graphics/spec";
import { autoPalette, buildBackdrop, picture, region } from "../lib/graphics/imaging";
import { getPalette, luminance } from "../lib/palettes";

const modules = import.meta.glob("../convex/**/*.{ts,js}");

describe("text fitting", () => {
  it("wraps by words and refuses words wider than the line", () => {
    expect(wrapLines("one two three", 10_000, 20)).toBe(1);
    expect(wrapLines("Photographer Agency & Commercial Photo Production", 900, 150)).toBeGreaterThan(2);
    expect(wrapLines("Supercalifragilistic", 200, 60)).toBe(Infinity);
  });

  it("finds the largest size that fits the lines and the height", () => {
    const title = "Photographer Agency & Commercial Photo Production";
    const size = fit(title, 904, 3, 176, 40);
    expect(wrapLines(title, 904, size)).toBeLessThanOrEqual(3);
    expect(wrapLines(title, 904, size + 2)).toBeGreaterThan(3);
    const capped = fit(title, 904, 4, 176, 40, 200);
    expect(wrapLines(title, 904, capped) * capped * 0.95).toBeLessThanOrEqual(200);
    expect(fit("FLOEMA", 904, 3, 230)).toBe(230);
  });
});

describe("carousel plan", () => {
  const facts = { quote: "", score: null } as unknown as StoryFacts;
  it("tells 6–8 slides depending on what exists", () => {
    expect(storyPlan(facts, { details: 1, mobile: false })).toEqual(["hook", "site", "detail", "credits", "cta"]);
    expect(storyPlan({ ...facts, score: 8.4 }, { details: 3, mobile: true })).toEqual([
      "hook",
      "site",
      "detail",
      "detail",
      "mobile",
      "jury",
      "credits",
      "cta",
    ]);
    expect(storyPlan({ ...facts, quote: "Lovely." }, { details: 2, mobile: false })).toHaveLength(7);
  });

  it("query strings skip empty values", () => {
    const q = new URLSearchParams(graphicsQuery({ template: "award", format: "square", palette: "egypt", fields: { title: " A ", studio: "", x: undefined } }));
    expect(q.get("title")).toBe("A");
    expect(q.has("studio")).toBe(false);
  });
});

async function solidImage(width: number, height: number, colour: string) {
  return picture(await sharp({ create: { width, height, channels: 3, background: colour } }).png().toBuffer());
}

describe("imaging", () => {
  it("tints an auto palette from the site's colours", async () => {
    const red = await autoPalette(await solidImage(64, 40, "#D0202A"), getPalette("night"));
    expect(red.id).toBe("auto");
    expect(luminance(red.base)).toBeLessThan(0.1); // deep, so white text reads
    const grey = await autoPalette(await solidImage(64, 40, "#808080"), getPalette("night"));
    expect(grey.base).toBe("#101012");
  });

  it("builds a backdrop the size of the canvas, and windows of it", async () => {
    const pic = (await solidImage(320, 200, "#3355AA"))!;
    const bd = await buildBackdrop({
      width: 2160,
      height: 1350,
      palette: getPalette("egypt"),
      layers: [
        { pic, from: 0, to: 0.5 },
        { pic, from: 0.5, to: 1 },
      ],
      veil: 0.5,
      blur: 26,
      frostBlur: 120,
      frostLight: 0.1,
    });
    expect(bd.luminance).toBeLessThan(0.55);
    const window = await region(bd, "frost", { left: 1080, top: 0, width: 1080, height: 1350 });
    const meta = await sharp(Buffer.from(window.split(",")[1], "base64")).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([1080, 1350, "jpeg"]);
  });
});

describe("carousel facts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-11-12T08:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("collects screenshots, the phone view, the award and the best jury quote", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { externalId: "admin", name: "Admin", email: "a@example.com", role: "admin", createdAt: now, updatedAt: now });
    });
    const admin = t.withIdentity({ subject: "admin" });
    const coverId = await t.run((ctx) => ctx.storage.store(new Blob(["img"], { type: "image/jpeg" })));
    const { id } = await admin.mutation(api.admin.createListing, {
      title: "FLOEMA",
      tagline: "The nature of what endures.",
      url: "https://floema.com",
      categories: ["portfolio"],
      technologies: ["GSAP", "WebGL"],
      region: "global",
      creatorTier: "agency",
      creditName: "Bürocratik",
      coverId,
      status: "in_voting",
      isClaimed: false,
    });
    await t.run(async (ctx) => {
      const media = (w: number, h: number, name: string) =>
        ctx.db.insert("media", {
          fileId: name,
          url: `https://ik.imagekit.io/shemoqmedi/listings/floema/${name}.webp`,
          filePath: `/listings/floema/${name}.webp`,
          kind: "image",
          contentType: "image/webp",
          size: 1000,
          width: w,
          height: h,
          createdAt: now,
        });
      const wide = await media(1920, 1080, "wide-shot");
      const tall = await media(390, 844, "phone-shot");
      await ctx.db.patch(id, { galleryIds: [wide, tall], finalScore: 8.9, editorialScores: { design: 9.2, usability: 8.4, creativity: 9.1, content: 8.6 } });
      await ctx.db.insert("awards", { listingId: id, tier: "SOTD", period: "2026-11-09", date: "2026-11-09", score: 8.9, slug: "floema-sotd-2026-11-09", status: "active", source: "auto", createdAt: now });
      const jurorId = await ctx.db.insert("jurors", { slug: "nino", name: "Nino", title: "Creative director", active: true, joinedAt: now, updatedAt: now });
      const scores = { design: 9, usability: 8, creativity: 9, content: 8 };
      await ctx.db.insert("juryEvaluations", { listingId: id, jurorId, scores, comment: "Short.", createdAt: now, updatedAt: now });
      await ctx.db.insert("juryEvaluations", { listingId: id, jurorId, scores, comment: "Material, light and restraint. It feels like walking through the product.", createdAt: now, updatedAt: now });
    });

    const facts = await t.query(internal.graphics.carouselFacts, { listingId: id });
    expect(facts).not.toBeNull();
    expect(facts!.shots).toHaveLength(2); // the cover (storage) and the wide shot
    expect(facts!.mobile).toContain("phone-shot");
    expect(facts!.award).toEqual({ tier: "SOTD", date: "9 Nov 2026", slug: "floema-sotd-2026-11-09" });
    expect(facts!.pillars).toEqual({ design: 9.2, usability: 8.4, creativity: 9.1, content: 8.6 });
    expect(facts!.quote).toEqual({ text: "Material, light and restraint. It feels like walking through the product.", juror: "Nino", role: "Creative director" });
    expect(facts!.tech).toEqual(["GSAP", "WebGL"]);
  });
});
