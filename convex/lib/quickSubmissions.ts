// What the full submission form (/submit/full, listings.submit) needs to know
// about the 30-second submissions (convex/quickSubmit.ts): a website is in the
// queue once, whichever form it came through.

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { domainKey } from "./domains";
import type { MediaActor } from "./media";

/** With the editors: no listing has been made from it yet. */
export const isOpenSubmission = (r: Doc<"quickSubmissions">) => r.status === "received" || r.status === "preparing";

/** Shown when someone else already sent this website (the 30-second form says the same). */
export const ALREADY_SUBMITTED =
  "This site has already been submitted and is with our editors. We'll be in touch with whoever sent it.";

/**
 * The open 30-second submission of this website, for an account sending the
 * full form:
 *   own    theirs (linked to the account, or sent with the account's verified
 *          email and not linked yet): the full form completes it
 *   taken  someone else's: the site is already with the editors
 */
export async function openSubmissionFor(ctx: QueryCtx, url: string, user: Doc<"users">) {
  const open = (
    await ctx.db
      .query("quickSubmissions")
      .withIndex("by_domain", (q) => q.eq("domain", domainKey(url)))
      .collect()
  ).filter(isOpenSubmission);
  const email = user.email.trim().toLowerCase();
  const own = open.find((r) => r.userId === user._id || (!r.userId && r.email === email)) ?? null;
  return { own, taken: !own && open.length > 0 };
}

/** The creator's full form made the listing: the submission is listed, and theirs. */
export async function completeSubmission(
  ctx: MutationCtx,
  submission: Doc<"quickSubmissions">,
  listingId: Id<"listings">,
  user: Doc<"users">,
  now: number,
) {
  await ctx.db.patch(submission._id, {
    status: "listed",
    listingId,
    updatedAt: now,
    ...(submission.userId ? {} : { userId: user._id, linkedAt: now }),
  });
}

/**
 * A listing made from a submission is being deleted. Withdrawn by the person
 * who submitted it: their submission goes with it. Deleted by anyone else (an
 * editor): the submission is closed as not accepted, and can be reopened in
 * Review. Either way nothing keeps pointing at a listing that is gone.
 */
export async function releaseSubmissions(ctx: MutationCtx, listingId: Id<"listings">, by: MediaActor, now: number) {
  const rows = await ctx.db
    .query("quickSubmissions")
    .withIndex("by_listing", (q) => q.eq("listingId", listingId))
    .collect();
  for (const r of rows) {
    if (by !== "server" && r.userId === by._id) await ctx.db.delete(r._id);
    else await ctx.db.patch(r._id, { status: "rejected", listingId: undefined, updatedAt: now });
  }
}
