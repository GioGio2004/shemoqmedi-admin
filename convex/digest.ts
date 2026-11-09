// Jurors' daily digest: one email per juror (never one per site) listing the
// sites approved since their last digest in the categories they follow
// (jurors.interests). Sites no active juror follows form the general queue:
// it is in every juror's digest and on the jury page (generalQueue below).

import { v } from "convex/values";
import { internalAction, internalMutation, query, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { getConfig } from "./lib/config";
import { atTime, DAY_MS, tbilisiDay } from "./lib/time";
import { listingCategories } from "./lib/listingHelpers";
import { conflictReason } from "./lib/conflicts";
import { mediaUrl } from "./lib/media";
import { emailHtml, escapeHtml, sendEmail } from "./lib/email";
import { siteUrl } from "./seo";
import { currentJuror } from "./jury";

/** Jurors who get digests and can be matched: claimed, active, with an account. */
async function activeJurors(ctx: QueryCtx) {
  return (
    await ctx.db
      .query("jurors")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect()
  ).filter((j) => j.userId && j.status !== "unclaimed");
}

function follows(juror: Doc<"jurors">, listing: Doc<"listings">) {
  const interests = juror.interests ?? [];
  return listingCategories(listing).some((c) => interests.includes(c));
}

/** Sites in voting that no active juror follows by category. */
async function generalQueueOf(ctx: QueryCtx, jurors: Doc<"jurors">[], listings: Doc<"listings">[]) {
  return listings.filter((l) => !jurors.some((j) => follows(j, l)));
}

async function inVoting(ctx: QueryCtx) {
  return (
    await ctx.db
      .query("listings")
      .withIndex("by_status", (q) => q.eq("status", "in_voting"))
      .collect()
  ).filter((l) => !l.byTeam);
}

type Item = { title: string; slug: string; creditName: string; categories: string[] };
const item = (l: Doc<"listings">): Item => ({
  title: l.title,
  slug: l.slug,
  creditName: l.creditName,
  categories: listingCategories(l),
});

/**
 * Every half hour (crons.ts): after config.digestTime each day, jurors whose
 * last digest was before today's digest time get one, if there is anything
 * new for them. Running it twice sends nothing twice.
 */
export const run = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const config = await getConfig(ctx);
    const sendAt = atTime(tbilisiDay(now), config.digestTime);
    if (now < sendAt) return 0;
    const jurors = await activeJurors(ctx);
    const open = await inVoting(ctx);
    const general = new Set((await generalQueueOf(ctx, jurors, open)).map((l) => l._id));
    let queued = 0;
    for (const juror of jurors) {
      if ((juror.lastDigestAt ?? 0) >= sendAt) continue;
      const since = juror.lastDigestAt ?? now - 7 * DAY_MS;
      const fresh = [];
      for (const l of open) {
        if ((l.publishedAt ?? l.createdAt) <= since) continue;
        if (await conflictReason(ctx, l, juror)) continue;
        fresh.push(l);
      }
      const mine = fresh.filter((l) => follows(juror, l));
      const rest = fresh.filter((l) => general.has(l._id) && !follows(juror, l));
      await ctx.db.patch(juror._id, { lastDigestAt: now });
      if (mine.length + rest.length === 0) continue;
      const user = await ctx.db.get(juror.userId!);
      if (!user?.email) continue;
      await ctx.scheduler.runAfter(0, internal.digest.send, {
        to: user.email,
        name: juror.name,
        mine: mine.map(item),
        general: rest.map(item),
      });
      queued += 1;
    }
    return queued;
  },
});

const vItem = v.object({ title: v.string(), slug: v.string(), creditName: v.string(), categories: v.array(v.string()) });

export const send = internalAction({
  args: { to: v.string(), name: v.string(), mine: v.array(vItem), general: v.array(vItem) },
  returns: v.null(),
  handler: async (_ctx, { to, name, mine, general }) => {
    const base = siteUrl();
    const list = (items: Item[]) =>
      `<ul>${items
        .map((i) => `<li><a href="${base}/sites/${i.slug}">${escapeHtml(i.title)}</a> by ${escapeHtml(i.creditName)}</li>`)
        .join("")}</ul>`;
    const text = (items: Item[]) => items.map((i) => `- ${i.title} by ${i.creditName}: ${base}/sites/${i.slug}`).join("\n");
    const first = name.split(" ")[0];
    const total = mine.length + general.length;
    const error = await sendEmail({
      to: [to],
      subject: `${total} new ${total === 1 ? "site" : "sites"} to score on Shemoqmedi`,
      text: [
        `Hi ${first},`,
        "",
        mine.length ? `In your categories:\n${text(mine)}` : "",
        general.length ? `\nGeneral queue (no juror follows these categories yet):\n${text(general)}` : "",
        "",
        "Shemoqmedi",
      ].join("\n"),
      html: emailHtml(
        [`Hi ${escapeHtml(first)},`, `${total} new ${total === 1 ? "site is" : "sites are"} waiting for your score.`],
        undefined,
        `${mine.length ? `<p><strong>In your categories</strong></p>${list(mine)}` : ""}${
          general.length
            ? `<p><strong>General queue</strong> <span style="color:#555">(no juror follows these categories yet)</span></p>${list(general)}`
            : ""
        }<p style="font-size:12px;color:#555">Choose your categories on your jury profile: ${base}/jury/profile</p>`,
      ),
    });
    if (error) console.warn(`Jury digest to ${to} not sent: ${error}`);
    return null;
  },
});

/** For jurors: sites in voting that match no juror's categories (visible to every juror). */
export const generalQueue = query({
  args: {},
  returns: v.union(
    v.array(
      v.object({
        slug: v.string(),
        title: v.string(),
        creditName: v.string(),
        coverUrl: v.union(v.string(), v.null()),
        votingEndsAt: v.number(),
      }),
    ),
    v.null(),
  ),
  handler: async (ctx) => {
    if (!(await currentJuror(ctx))) return null;
    const jurors = await activeJurors(ctx);
    const open = await inVoting(ctx);
    const general = await generalQueueOf(ctx, jurors, open);
    return Promise.all(
      general.map(async (l) => ({
        slug: l.slug,
        title: l.title,
        creditName: l.creditName,
        coverUrl: await mediaUrl(ctx, l.coverId),
        votingEndsAt: l.votingEndsAt ?? 0,
      })),
    );
  },
});
