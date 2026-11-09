// Site of the Day: one winner per calendar day (UTC), and never twice.
//
// A site wins when its voting closes with a final score of 8.50 or more (or
// when an admin picks it). It then gets the first free day from today on, as
// `sotdDay` ("YYYY-MM-DD"). The award shows publicly from that day: until
// then the site is scheduled (status "awarded", sotdDay in the future, no
// "SOTD" in awards). The cron in convex/sotd.ts adds "SOTD" at 00:00 UTC.
// A site that has had its day keeps it for good; it is never given another.

import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

type Award = Doc<"listings">["awards"][number];

export const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The UTC calendar day of a timestamp, "2026-11-09". */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `day` moved by `n` days (n may be negative). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return utcDay(d.getTime());
}

/** A real calendar day in YYYY-MM-DD form. */
export function isDay(day: string): boolean {
  return DAY_PATTERN.test(day) && utcDay(Date.parse(`${day}T00:00:00Z`) || 0) === day;
}

/** The listing that has `day`, if any. */
export async function winnerOn(ctx: QueryCtx, day: string) {
  return ctx.db
    .query("listings")
    .withIndex("by_sotdDay", (q) => q.eq("sotdDay", day))
    .first();
}

/** The first day from `from` on that has no Site of the Day yet. */
export async function nextFreeDay(ctx: QueryCtx, from: string): Promise<string> {
  // Absent sotdDay sorts before every string, so gte() skips sites without a day.
  const taken = await ctx.db
    .query("listings")
    .withIndex("by_sotdDay", (q) => q.gte("sotdDay", from))
    .take(1000);
  let day = from;
  for (const row of taken) {
    if (row.sotdDay === day) day = addDays(day, 1);
    else if (row.sotdDay! > day) break;
  }
  return day;
}

/** Whether the listing's Site of the Day has been made public. */
export function sotdPublished(listing: Pick<Doc<"listings">, "awards">) {
  return listing.awards.includes("SOTD");
}

/**
 * Day and awards for a Site of the Day winner: its current day if it has
 * one, else `day`, else the first free day. "SOTD" joins the other awards
 * once the day has come.
 */
export async function winnerFields(
  ctx: QueryCtx,
  listing: Pick<Doc<"listings">, "sotdDay"> | null,
  awards: readonly Award[],
  now: number,
  day?: string,
): Promise<{ sotdDay: string; awards: Award[] }> {
  const today = utcDay(now);
  const sotdDay = listing?.sotdDay ?? day ?? (await nextFreeDay(ctx, today));
  const others = [...new Set(awards.filter((a) => a !== "SOTD"))];
  return { sotdDay, awards: sotdDay <= today ? [...others, "SOTD"] : others };
}
