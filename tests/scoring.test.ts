import { describe, expect, it } from "vitest";
import {
  averagePillars,
  compareRanked,
  finalScore,
  normalizePillars,
  readPillars,
  round2,
  summarize,
  weighted,
  ZERO_PILLARS,
} from "../convex/lib/scoring";
import { domainKey } from "../convex/lib/domains";
import {
  addMonths,
  atTime,
  batchVotingEnds,
  dayStart,
  previousMonth,
  tbilisiDay,
  weekOf,
} from "../convex/lib/time";
import { checkConfig, DEFAULT_CONFIG } from "../convex/lib/config";

const p = (n: number) => ({ design: n, usability: n, creativity: n, content: n });

describe("weighted jury score", () => {
  it("weights Design 40%, Usability 30%, Creativity 20%, Content 10%", () => {
    expect(weighted({ design: 10, usability: 0, creativity: 0, content: 0 })).toBeCloseTo(4);
    expect(weighted({ design: 0, usability: 10, creativity: 0, content: 0 })).toBeCloseTo(3);
    expect(weighted({ design: 0, usability: 0, creativity: 10, content: 0 })).toBeCloseTo(2);
    expect(weighted({ design: 0, usability: 0, creativity: 0, content: 10 })).toBeCloseTo(1);
    expect(weighted({ design: 9, usability: 8, creativity: 7, content: 6 })).toBeCloseTo(8);
  });

  it("averages every juror's weighted score, rounded to 2 decimals", () => {
    const a = { design: 9, usability: 8, creativity: 7, content: 6 }; // 8.0
    const b = { design: 7.3, usability: 6.1, creativity: 9.9, content: 5 }; // 7.23
    const c = { design: 8, usability: 8, creativity: 8, content: 8 }; // 8
    expect(finalScore([a, b, c])).toBe(7.74); // (8 + 7.23 + 8) / 3 = 7.7433
    expect(finalScore([])).toBeNull();
  });

  it("rounds half up at two decimals", () => {
    expect(round2(7.005)).toBe(7.01);
    expect(round2(6.494999)).toBe(6.49);
  });

  it("the final score is the jury's only; the community score is for show", () => {
    const totals = { design: 18, usability: 18, creativity: 18, content: 18 }; // two votes of 9
    expect(summarize(p(8), totals, 2)).toEqual({ editorialAverage: 8, communityAverage: 9, finalScore: 8 });
    expect(summarize(null, totals, 2).finalScore).toBeNull();
  });

  it("averages pillars per juror", () => {
    expect(averagePillars([p(8), p(9)])).toEqual(p(8.5));
    expect(averagePillars([])).toBeNull();
  });

  it("reads old scores whose fourth pillar was called code as content", () => {
    expect(readPillars({ design: 1, usability: 2, creativity: 3, code: 4 })).toEqual({
      design: 1,
      usability: 2,
      creativity: 3,
      content: 4,
    });
    expect(readPillars({ design: 1, usability: 2, creativity: 3, content: 5, code: 4 }).content).toBe(5);
  });
});

describe("ties", () => {
  const base = { finalScore: 8, votes: 3, design: 8, submittedAt: 100 };
  it("higher score first", () => {
    expect(compareRanked({ ...base, finalScore: 9 }, base)).toBeLessThan(0);
  });
  it("then more jury votes", () => {
    expect(compareRanked({ ...base, votes: 4 }, base)).toBeLessThan(0);
  });
  it("then a higher Design score", () => {
    expect(compareRanked({ ...base, design: 8.5 }, base)).toBeLessThan(0);
  });
  it("then the earlier submission", () => {
    expect(compareRanked({ ...base, submittedAt: 50 }, base)).toBeLessThan(0);
    expect(compareRanked(base, base)).toBe(0);
  });
});

describe("pillar validation", () => {
  it("accepts 1–10 and rounds to one decimal", () => {
    expect(normalizePillars({ design: 9.94, usability: 1, creativity: 10, content: 5.55 })).toEqual({
      design: 9.9,
      usability: 1,
      creativity: 10,
      content: 5.6,
    });
  });

  it("rejects out-of-range and non-numbers", () => {
    expect(() => normalizePillars({ ...p(5), design: 0.9 })).toThrow(/Design/);
    expect(() => normalizePillars({ ...p(5), content: 10.1 })).toThrow(/Content/);
    expect(() => normalizePillars({ ...p(5), usability: Number.NaN })).toThrow(/Usability/);
  });

  it("zero pillars use content", () => {
    expect(ZERO_PILLARS).toEqual(p(0));
  });
});

describe("Tbilisi calendar (UTC+4)", () => {
  it("days change at midnight Tbilisi, 20:00 UTC", () => {
    expect(tbilisiDay(Date.UTC(2026, 10, 11, 19, 59))).toBe("2026-11-11");
    expect(tbilisiDay(Date.UTC(2026, 10, 11, 20, 0))).toBe("2026-11-12");
    expect(dayStart("2026-11-12")).toBe(Date.UTC(2026, 10, 11, 20, 0));
    expect(atTime("2026-11-12", "09:30")).toBe(Date.UTC(2026, 10, 12, 5, 30));
  });

  it("batches run Monday 00:00 to Sunday 23:59 and are judged the week after", () => {
    // Wed 11 Nov 2026 → batch of Mon 9 Nov; Sunday 15 Nov 23:59 is still that batch.
    expect(weekOf(Date.UTC(2026, 10, 11, 12))).toBe("2026-11-09");
    expect(weekOf(Date.UTC(2026, 10, 15, 19, 59))).toBe("2026-11-09");
    expect(weekOf(Date.UTC(2026, 10, 15, 20, 0))).toBe("2026-11-16"); // Monday 00:00 Tbilisi
    // Judged Mon 16 – Sun 22 Nov: voting ends just before Mon 23 Nov 00:00 Tbilisi.
    expect(batchVotingEnds("2026-11-09")).toBe(dayStart("2026-11-23") - 1);
  });

  it("month and month arithmetic", () => {
    expect(previousMonth("2027-01-01")).toBe("2026-12");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-12", 12)).toBe("2027-11-12");
  });
});

describe("domain keys", () => {
  it("strip protocol, www and a trailing slash", () => {
    expect(domainKey("https://www.Example.com/")).toBe("example.com");
    expect(domainKey("http://example.com")).toBe("example.com");
    expect(domainKey("example.com/work/")).toBe("example.com/work");
    expect(domainKey("https://studio.example.com/work")).toBe("studio.example.com/work");
  });
});

describe("config", () => {
  it("has the documented defaults", () => {
    expect(DEFAULT_CONFIG).toEqual({
      minVotes: 3,
      honorableMentionMin: 6.5,
      sotdMin: 7,
      bscMin: 8.2,
      announceTime: "00:00",
      monthlyRoundDays: 5,
      yearlyRoundDays: 10,
      yearlyAnnounceDate: "01-20",
      resubmitMonths: 12,
      digestTime: "09:00",
    });
    expect(() => checkConfig(DEFAULT_CONFIG)).not.toThrow();
  });

  it("rejects bad values", () => {
    expect(() => checkConfig({ ...DEFAULT_CONFIG, minVotes: 0 })).toThrow(/Minimum jury votes/);
    expect(() => checkConfig({ ...DEFAULT_CONFIG, announceTime: "24:00" })).toThrow(/time/);
    expect(() => checkConfig({ ...DEFAULT_CONFIG, sotdMin: 6 })).toThrow(/Honorable Mention/);
    expect(() => checkConfig({ ...DEFAULT_CONFIG, yearlyAnnounceDate: "Jan 20" })).toThrow(/01-20/);
  });
});
