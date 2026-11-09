// One active listing per website. A website is its normalized domain key:
// protocol, "www." and a trailing slash stripped, so
//   https://www.example.com/  →  example.com
//   http://example.com/work/  →  example.com/work
//
// "Active" means pending review or in voting. A site that has already been
// through the showcase (awarded or archived) can only come back as a
// significant redesign: a new entry linked to the old one, reviewed by an
// admin, and, if it won anything, at least config.resubmitMonths after its
// last award.

import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { addMonths, tbilisiDay } from "./time";

export function domainKey(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return url.trim().toLowerCase();
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${host}${path}`;
}

/** Listings on this domain key. Rows from before domainKey existed are matched by their URL. */
export async function listingsOnDomain(ctx: QueryCtx, key: string): Promise<Doc<"listings">[]> {
  const indexed = await ctx.db
    .query("listings")
    .withIndex("by_domainKey", (q) => q.eq("domainKey", key))
    .take(50);
  // Until migrations.backfillAwardsData has run, older rows have no key yet.
  // The showcase is hand-curated, so a bounded scan is fine for those.
  const legacy = (await ctx.db.query("listings").take(2000)).filter(
    (l) => l.domainKey === undefined && domainKey(l.url) === key,
  );
  return [...indexed, ...legacy];
}

const ACTIVE: Doc<"listings">["status"][] = ["pending", "in_voting"];

export type DomainCheck =
  | { ok: true; redesignOf?: Id<"listings"> }
  | { ok: false; reason: string };

/**
 * Whether a new listing for `url` may be created. `redesignOf` is the slug or
 * id of the earlier listing it replaces, when it is a resubmitted redesign.
 */
export async function checkDomain(
  ctx: QueryCtx,
  url: string,
  options: { redesignOf?: Id<"listings">; resubmitMonths: number; now: number; except?: Id<"listings"> },
): Promise<DomainCheck> {
  const key = domainKey(url);
  const others = (await listingsOnDomain(ctx, key)).filter(
    (l) => l._id !== options.except && l.status !== "rejected",
  );
  if (others.length === 0) return { ok: true };

  const active = others.find((l) => ACTIVE.includes(l.status));
  if (active) {
    return { ok: false, reason: `This website is already listed (“${active.title}”) and is in review or voting.` };
  }
  const previous = options.redesignOf ? others.find((l) => l._id === options.redesignOf) : undefined;
  if (!previous) {
    return {
      ok: false,
      reason: "This website is already in the showcase. It can only come back as a significant redesign.",
    };
  }
  const awards = await ctx.db
    .query("awards")
    .withIndex("by_listing", (q) => q.eq("listingId", previous._id))
    .take(50);
  const lastAward = awards
    .filter((a) => a.status === "active")
    .map((a) => a.date)
    .sort()
    .at(-1);
  if (lastAward) {
    const allowedFrom = addMonths(lastAward, options.resubmitMonths);
    if (tbilisiDay(options.now) < allowedFrom) {
      return {
        ok: false,
        reason: `This site won an award on ${lastAward}. A redesign can be submitted from ${allowedFrom}.`,
      };
    }
  }
  return { ok: true, redesignOf: previous._id };
}
