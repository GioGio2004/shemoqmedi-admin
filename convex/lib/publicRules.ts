// The award rules as the public site states them. Built from the same
// constants and settings the engine runs on (lib/scoring.ts WEIGHTS and
// lib/config.ts), so the storefront's copy can never describe a different
// model from the one that decides awards. The storefront keeps a fallback
// copy of the defaults in lib/taxonomy.ts (AWARD_RULES). Covered by
// tests/publicRules.test.ts.

import { v, type Infer } from "convex/values";
import type { AwardConfig } from "./config";
import { PILLARS } from "./taxonomy";
import { WEIGHTS } from "./scoring";

export const vPublicRules = v.object({
  /** The four jury pillars, heaviest first, with their weight in the final score. */
  pillars: v.array(v.object({ key: v.string(), name: v.string(), weight: v.number() })),
  /** Each pillar is scored from scoreMin to scoreMax. */
  scoreMin: v.number(),
  scoreMax: v.number(),
  /** The final score is the mean of the jurors' weighted scores, rounded to this many decimals. */
  decimals: v.number(),
  /** Always false: community votes are shown on the site but never decide an award. */
  communityCounts: v.boolean(),
  minVotes: v.number(),
  honorableMentionMin: v.number(),
  sotdMin: v.number(),
  bscMin: v.number(),
  /** Awards go public at this time of day, "HH:MM" in timeZone. */
  announceTime: v.string(),
  timeZone: v.string(),
  monthlyRoundDays: v.number(),
  yearlyRoundDays: v.number(),
  /** "MM-DD": the Site of the Year announcement. */
  yearlyAnnounceDate: v.string(),
  resubmitMonths: v.number(),
});

export type PublicRules = Infer<typeof vPublicRules>;

export function publicRulesFrom(config: AwardConfig): PublicRules {
  return {
    pillars: PILLARS.map((p) => ({ key: p.key, name: p.name, weight: WEIGHTS[p.key] })),
    scoreMin: 1,
    scoreMax: 10,
    decimals: 2,
    communityCounts: false,
    minVotes: config.minVotes,
    honorableMentionMin: config.honorableMentionMin,
    sotdMin: config.sotdMin,
    bscMin: config.bscMin,
    announceTime: config.announceTime,
    timeZone: "Asia/Tbilisi",
    monthlyRoundDays: config.monthlyRoundDays,
    yearlyRoundDays: config.yearlyRoundDays,
    yearlyAnnounceDate: config.yearlyAnnounceDate,
    resubmitMonths: config.resubmitMonths,
  };
}
