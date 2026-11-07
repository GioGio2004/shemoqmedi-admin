// Pure scoring rules (no database access), shared by every function that
// touches scores and covered by tests/scoring.test.ts.
//
//   editorialAverage = mean of the 4 jury pillars
//   communityAverage = mean over all community votes of each vote's 4 pillars
//   finalScore       = editorialAverage                      (no community votes)
//                    = 0.6 * editorial + 0.4 * community      (otherwise)
//                    = communityAverage                      (no jury score yet)
//   Awards when voting closes:
//     BSC  if solo and finalScore >= 8.20
//     SOTD if finalScore >= 8.50
//     HM   if finalScore >= 7.50 and not SOTD

import type { AwardSlug, CreatorTier, PillarKey } from "./taxonomy";

export type Pillars = Record<PillarKey, number>;

export const PILLAR_KEYS: PillarKey[] = ["design", "usability", "creativity", "code"];

export const JURY_WEIGHT = 0.6;
export const COMMUNITY_WEIGHT = 0.4;

export const THRESHOLDS = { BSC: 8.2, SOTD: 8.5, HM: 7.5 } as const;

export const ZERO_PILLARS: Pillars = { design: 0, usability: 0, creativity: 0, code: 0 };

export function round2(value: number) {
  return Number(value.toFixed(2));
}

/** A valid pillar score: 1.0–10.0, rounded to one decimal. Throws otherwise. */
export function clampPillar(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 1 || value > 10) {
    throw new Error(`${label} must be between 1 and 10.`);
  }
  return Math.round(value * 10) / 10;
}

export function normalizePillars(scores: Pillars): Pillars {
  return {
    design: clampPillar(scores.design, "Design"),
    usability: clampPillar(scores.usability, "Usability"),
    creativity: clampPillar(scores.creativity, "Creativity"),
    code: clampPillar(scores.code, "Code"),
  };
}

export function mean(scores: Pillars): number {
  return (scores.design + scores.usability + scores.creativity + scores.code) / 4;
}

/** Per-pillar community averages from running totals. */
export function communityPillars(totals: Pillars, count: number): Pillars | null {
  if (count <= 0) return null;
  return {
    design: totals.design / count,
    usability: totals.usability / count,
    creativity: totals.creativity / count,
    code: totals.code / count,
  };
}

export function addPillars(a: Pillars, b: Pillars): Pillars {
  return {
    design: a.design + b.design,
    usability: a.usability + b.usability,
    creativity: a.creativity + b.creativity,
    code: a.code + b.code,
  };
}

export type ScoreSummary = {
  editorialAverage: number | null;
  communityAverage: number | null;
  finalScore: number | null;
};

export function summarize(
  editorial: Pillars | null | undefined,
  totals: Pillars,
  count: number,
): ScoreSummary {
  const editorialAverage = editorial ? mean(editorial) : null;
  const community = communityPillars(totals, count);
  const communityAverage = community ? mean(community) : null;

  let finalScore: number | null = null;
  if (editorialAverage !== null && communityAverage === null) finalScore = editorialAverage;
  else if (editorialAverage !== null && communityAverage !== null) {
    finalScore = editorialAverage * JURY_WEIGHT + communityAverage * COMMUNITY_WEIGHT;
  } else if (communityAverage !== null) finalScore = communityAverage;

  return {
    editorialAverage: editorialAverage === null ? null : round2(editorialAverage),
    communityAverage: communityAverage === null ? null : round2(communityAverage),
    finalScore: finalScore === null ? null : round2(finalScore),
  };
}

export function decideAwards(tier: CreatorTier, finalScore: number | null): AwardSlug[] {
  if (finalScore === null) return [];
  const awards: AwardSlug[] = [];
  if (tier === "solo" && finalScore >= THRESHOLDS.BSC) awards.push("BSC");
  if (finalScore >= THRESHOLDS.SOTD) awards.push("SOTD");
  else if (finalScore >= THRESHOLDS.HM) awards.push("HM");
  return awards;
}
