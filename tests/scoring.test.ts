import { describe, expect, it } from "vitest";
import { decideAwards, normalizePillars, summarize, ZERO_PILLARS } from "../convex/lib/scoring";

const p = (n: number) => ({ design: n, usability: n, creativity: n, code: n });

describe("60/40 weighted score", () => {
  it("uses the editorial average when there are no community votes", () => {
    expect(summarize(p(8.65), ZERO_PILLARS, 0)).toEqual({
      editorialAverage: 8.65,
      communityAverage: null,
      finalScore: 8.65,
    });
  });

  it("weights jury 60% and community 40%", () => {
    // editorial mean 8.0; two votes averaging 9.0
    const totals = { design: 18, usability: 18, creativity: 18, code: 18 };
    expect(summarize(p(8), totals, 2)).toEqual({
      editorialAverage: 8,
      communityAverage: 9,
      finalScore: 8.4,
    });
  });

  it("averages the four pillars", () => {
    const editorial = { design: 9, usability: 8, creativity: 7, code: 10 };
    expect(summarize(editorial, ZERO_PILLARS, 0).editorialAverage).toBe(8.5);
  });

  it("rounds to two decimals", () => {
    const totals = { design: 7, usability: 7, creativity: 7, code: 8 }; // 7.25
    expect(summarize(p(8.33), totals, 1).finalScore).toBe(Number((8.33 * 0.6 + 7.25 * 0.4).toFixed(2)));
  });

  it("falls back to the community average when the jury hasn't scored", () => {
    expect(summarize(null, p(16), 2).finalScore).toBe(8);
    expect(summarize(null, ZERO_PILLARS, 0).finalScore).toBeNull();
  });
});

describe("award thresholds", () => {
  it("BSC is solo-only at 8.20+", () => {
    expect(decideAwards("solo", 8.2)).toEqual(["BSC", "HM"]);
    expect(decideAwards("agency", 8.2)).toEqual(["HM"]);
    expect(decideAwards("solo", 8.19)).toEqual(["HM"]);
  });

  it("SOTD at 8.50+ replaces HM", () => {
    expect(decideAwards("agency", 8.5)).toEqual(["SOTD"]);
    expect(decideAwards("solo", 8.9)).toEqual(["BSC", "SOTD"]);
  });

  it("HM at 7.50+, nothing below", () => {
    expect(decideAwards("agency", 7.5)).toEqual(["HM"]);
    expect(decideAwards("agency", 7.49)).toEqual([]);
    expect(decideAwards("solo", null)).toEqual([]);
  });
});

describe("pillar validation", () => {
  it("accepts 1–10 and rounds to one decimal", () => {
    expect(normalizePillars({ design: 9.94, usability: 1, creativity: 10, code: 5.55 })).toEqual({
      design: 9.9,
      usability: 1,
      creativity: 10,
      code: 5.6,
    });
  });

  it("rejects out-of-range and non-numbers", () => {
    expect(() => normalizePillars({ ...p(5), design: 0.9 })).toThrow(/Design/);
    expect(() => normalizePillars({ ...p(5), code: 10.1 })).toThrow(/Code/);
    expect(() => normalizePillars({ ...p(5), usability: Number.NaN })).toThrow(/Usability/);
  });
});
