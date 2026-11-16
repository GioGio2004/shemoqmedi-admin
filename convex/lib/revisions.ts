// Version history of a listing's copy. Every change to the descriptive text
// (an approved agent draft, an admin edit, an undo) is stored with the fields
// as they were and as they became, so any one of them can be undone from the
// admin or over MCP (convex/editorial.ts).

import type { Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { listingCopy } from "../schema";
import { listingCategories } from "./listingHelpers";

export type ListingCopy = Infer<typeof listingCopy>;

/** The copy fields, in the order they are shown. */
export const COPY_KEYS = [
  "title",
  "tagline",
  "writeup",
  "categories",
  "technologies",
  "region",
  "creatorTier",
  "creditName",
  "creditUrl",
] as const satisfies readonly (keyof ListingCopy)[];

export type CopyKey = (typeof COPY_KEYS)[number];

/** The listing's current copy. Empty optional text reads as "" (so it can be restored as "cleared"). */
export function copyOf(listing: Doc<"listings">): Required<ListingCopy> {
  return {
    title: listing.title,
    tagline: listing.tagline,
    writeup: listing.writeup ?? "",
    categories: listingCategories(listing),
    technologies: listing.technologies,
    region: listing.region,
    creatorTier: listing.creatorTier,
    creditName: listing.creditName,
    creditUrl: listing.creditUrl ?? "",
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The fields that differ between two copies, as {before, after}. Empty when nothing changed. */
export function diffCopy(before: Required<ListingCopy>, after: Required<ListingCopy>) {
  const b: ListingCopy = {};
  const a: ListingCopy = {};
  for (const key of COPY_KEYS) {
    if (same(before[key], after[key])) continue;
    (b as Record<string, unknown>)[key] = before[key];
    (a as Record<string, unknown>)[key] = after[key];
  }
  return { before: b, after: a, changed: Object.keys(a) as CopyKey[] };
}

/** Store one revision when a change touched the copy; returns its id (null: nothing changed). */
export async function recordRevision(
  ctx: MutationCtx,
  listingId: Id<"listings">,
  before: Required<ListingCopy>,
  after: Required<ListingCopy>,
  meta: { source: "agent" | "admin" | "undo"; actorId?: Id<"users">; briefId?: Id<"listingBriefs"> },
): Promise<Id<"listingRevisions"> | null> {
  const diff = diffCopy(before, after);
  if (diff.changed.length === 0) return null;
  return await ctx.db.insert("listingRevisions", {
    listingId,
    source: meta.source,
    before: diff.before,
    after: diff.after,
    briefId: meta.briefId,
    actorId: meta.actorId,
    createdAt: Date.now(),
  });
}
