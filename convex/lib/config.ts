// Award settings. Defaults live here; an admin can change any of them on the
// Awards page (stored in the `settings` table, row key "awards").

import type { QueryCtx } from "../_generated/server";
import { parseTime } from "./time";

export type AwardConfig = {
  /** Jury votes a site needs to be eligible for any award. Raise as the jury grows. */
  minVotes: number;
  /** Final score for Honorable Mention. */
  honorableMentionMin: number;
  /** Final score to enter the Site of the Day queue. */
  sotdMin: number;
  /** Final score for Best Solo Creation (side award for solo makers, outside the tiers). */
  bscMin: number;
  /** When awards go public, Tbilisi time "HH:MM" (Site of the Day daily, SOTM on the 6th, SOTY on its date). */
  announceTime: string;
  /** Days the Site of the Month jury round stays open (from the 1st). Announced the day after it closes. */
  monthlyRoundDays: number;
  /** Days the Site of the Year jury round stays open (from 1 January). */
  yearlyRoundDays: number;
  /** Site of the Year announcement, "MM-DD" in January or later, to match an awards event. */
  yearlyAnnounceDate: string;
  /** Months after its last award before a winner can come back as a redesign. */
  resubmitMonths: number;
  /** When jurors get their daily digest of new submissions, Tbilisi time. */
  digestTime: string;
};

export const DEFAULT_CONFIG: AwardConfig = {
  minVotes: 3,
  honorableMentionMin: 6.5,
  sotdMin: 7.0,
  bscMin: 8.2,
  announceTime: "00:00",
  monthlyRoundDays: 5,
  yearlyRoundDays: 10,
  yearlyAnnounceDate: "01-20",
  resubmitMonths: 12,
  digestTime: "09:00",
};

export async function getConfig(ctx: QueryCtx): Promise<AwardConfig> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", "awards"))
    .unique();
  return { ...DEFAULT_CONFIG, ...(row?.awards ?? {}) };
}

/** Throws a readable error when a value is out of range. */
export function checkConfig(config: AwardConfig) {
  const int = (v: number, min: number, max: number, label: string) => {
    if (!Number.isInteger(v) || v < min || v > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  };
  const score = (v: number, label: string) => {
    if (!Number.isFinite(v) || v < 1 || v > 10) throw new Error(`${label} must be between 1 and 10.`);
  };
  int(config.minVotes, 1, 50, "Minimum jury votes");
  score(config.honorableMentionMin, "Honorable Mention score");
  score(config.sotdMin, "Site of the Day score");
  score(config.bscMin, "Best Solo Creation score");
  if (config.sotdMin < config.honorableMentionMin) {
    throw new Error("The Site of the Day score can't be lower than the Honorable Mention score.");
  }
  parseTime(config.announceTime);
  parseTime(config.digestTime);
  int(config.monthlyRoundDays, 1, 27, "Monthly round days");
  int(config.yearlyRoundDays, 1, 60, "Yearly round days");
  int(config.resubmitMonths, 0, 60, "Months before a winner can return");
  const match = /^(\d{2})-(\d{2})$/.exec(config.yearlyAnnounceDate);
  const month = match ? Number(match[1]) : 0;
  const day = match ? Number(match[2]) : 0;
  if (!match || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error('The Site of the Year date must look like "01-20".');
  }
}
