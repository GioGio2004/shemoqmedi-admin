// Pure scoring rules (no database access), shared by every function that
// touches scores and covered by tests/scoring.test.ts.
//
//   A vote scores four pillars from 1 to 10. Its weighted score is
//     Design 40% + Usability 30% + Creativity 20% + Content 10%.
//   finalScore       = the jury's weighted score, averaged over every jury
//                      vote, rounded to 2 decimals. Only the jury decides.
//   communityAverage = the same weighting over community votes. Shown on the
//                      site for interest; it never decides an award.
//   Ties: more jury votes, then a higher Design score, then the earlier submission.
//
// Stored scores written before the Content pillar have `code` instead of
// `content`; readPillars() treats the two as the same pillar until the
// migration (convex/migrations.ts) has moved every row.

import type { PillarKey } from "./taxonomy";

export type Pillars = Record<PillarKey, number>;

/** A pillar score as stored: older rows have `code` where newer have `content`. */
export type StoredPillars = {
  design: number;
  usability: number;
  creativity: number;
  content?: number;
  code?: number;
};

export const PILLAR_KEYS: PillarKey[] = ["design", "usability", "creativity", "content"];

export const WEIGHTS: Pillars = { design: 0.4, usability: 0.3, creativity: 0.2, content: 0.1 };

export const ZERO_PILLARS: Pillars = { design: 0, usability: 0, creativity: 0, content: 0 };

export function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Any stored pillar object (old `code` or new `content`) as the current shape. */
export function readPillars(stored: StoredPillars): Pillars {
  return {
    design: stored.design,
    usability: stored.usability,
    creativity: stored.creativity,
    content: stored.content ?? stored.code ?? 0,
  };
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
    content: clampPillar(scores.content, "Content"),
  };
}

/** Design 40% + Usability 30% + Creativity 20% + Content 10% (not rounded). */
export function weighted(scores: Pillars): number {
  return (
    scores.design * WEIGHTS.design +
    scores.usability * WEIGHTS.usability +
    scores.creativity * WEIGHTS.creativity +
    scores.content * WEIGHTS.content
  );
}

/** Per-pillar average of a set of votes (null without votes). */
export function averagePillars(votes: Pillars[]): Pillars | null {
  if (votes.length === 0) return null;
  const sum = votes.reduce(addPillars, ZERO_PILLARS);
  const n = votes.length;
  return {
    design: round2(sum.design / n),
    usability: round2(sum.usability / n),
    creativity: round2(sum.creativity / n),
    content: round2(sum.content / n),
  };
}

/**
 * The final score of a set of jury votes: each vote's weighted score,
 * averaged, rounded to 2 decimals. Null without votes.
 */
export function finalScore(votes: Pillars[]): number | null {
  if (votes.length === 0) return null;
  return round2(votes.reduce((s, v) => s + weighted(v), 0) / votes.length);
}

/** Per-pillar community averages from running totals. */
export function communityPillars(totals: Pillars, count: number): Pillars | null {
  if (count <= 0) return null;
  return {
    design: totals.design / count,
    usability: totals.usability / count,
    creativity: totals.creativity / count,
    content: totals.content / count,
  };
}

export function addPillars(a: Pillars, b: Pillars): Pillars {
  return {
    design: a.design + b.design,
    usability: a.usability + b.usability,
    creativity: a.creativity + b.creativity,
    content: a.content + b.content,
  };
}

export type ScoreSummary = {
  editorialAverage: number | null;
  communityAverage: number | null;
  finalScore: number | null;
};

/**
 * The stored score fields. `editorial` is the per-pillar jury average (or an
 * admin's manual jury score); the final score is its weighted score. Weighting
 * is linear, so this equals averaging every juror's weighted score.
 */
export function summarize(editorial: Pillars | null | undefined, totals: Pillars, count: number): ScoreSummary {
  const jury = editorial ? round2(weighted(editorial)) : null;
  const community = communityPillars(totals, count);
  return {
    editorialAverage: jury,
    communityAverage: community ? round2(weighted(community)) : null,
    finalScore: jury,
  };
}

/** What the tie-break looks at. */
export type Ranked = {
  finalScore: number;
  votes: number; // jury votes
  design: number; // average jury Design score
  submittedAt: number;
};

/**
 * Sort order for candidates: higher final score first; ties go to more jury
 * votes, then a higher Design score, then the earlier submission.
 */
export function compareRanked(a: Ranked, b: Ranked): number {
  return (
    b.finalScore - a.finalScore ||
    b.votes - a.votes ||
    b.design - a.design ||
    a.submittedAt - b.submittedAt
  );
}
