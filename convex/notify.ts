// Award emails and the social posting job, run by the scheduler right after
// an award is given (lib/awards.ts grantAward) or a day/round has no winner.
//
//   Winner email: to the site's verified owner (or the person who claimed
//   its creator profile), with the badge and its embed code. A site nobody
//   has claimed yet gets no email; claiming it shows the badge on /account/badges.
//
//   Social post: queued in `socialPosts` with the screenshot, studio name and
//   studio tag. There was no social integration in the codebase, so posting
//   goes to SOCIAL_WEBHOOK_URL (any automation endpoint: Zapier, Make, n8n,
//   Buffer...) when set; without it the post stays "skipped" in the table.

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { mediaUrl } from "./lib/media";
import { TIER_NAMES } from "./lib/awards";
import { emailHtml, escapeHtml, sendEmail } from "./lib/email";
import { siteUrl } from "./seo";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-12" → "12 Nov 2026". */
export function formatDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Embed code for a badge: links to the award page (followed, no nofollow). */
export function embedCode(slug: string, label: string, theme: "light" | "dark" = "light") {
  const base = siteUrl();
  return (
    `<a href="${base}/awards/${slug}" target="_blank" rel="noopener" title="${label} on Shemoqmedi">` +
    `<img src="${base}/badge/${slug}?theme=${theme}" alt="${label} — Shemoqmedi" width="200" height="64"></a>`
  );
}

/** "@handle" from an X or Instagram profile link, else null. */
export function studioTag(links: string[] | undefined) {
  for (const link of links ?? []) {
    const m = /^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com|instagram\.com)\/([A-Za-z0-9_.]{1,30})\/?$/i.exec(link);
    if (m) return `@${m[1]}`;
  }
  return null;
}

/** Everything the announcement needs, read in one query. */
export const announcement = internalQuery({
  args: { awardId: v.id("awards") },
  returns: v.any(),
  handler: async (ctx, { awardId }) => {
    const award = await ctx.db.get(awardId);
    if (!award || award.status !== "active") return null;
    const listing = await ctx.db.get(award.listingId);
    if (!listing) return null;
    const creator = listing.creatorId ? await ctx.db.get(listing.creatorId) : null;
    const ownerId = listing.ownerId ?? creator?.claimedBy;
    const owner = ownerId ? await ctx.db.get(ownerId) : null;
    return {
      award,
      listing: { slug: listing.slug, title: listing.title, creditName: listing.creditName },
      coverUrl: await mediaUrl(ctx, listing.coverId),
      tag: studioTag(creator?.links),
      owner: owner ? { name: owner.name, email: owner.email } : null,
    };
  },
});

export const markNotified = internalMutation({
  args: { awardId: v.id("awards") },
  returns: v.null(),
  handler: async (ctx, { awardId }) => {
    await ctx.db.patch(awardId, { notifiedAt: Date.now() });
    return null;
  },
});

export const queueSocialPost = internalMutation({
  args: {
    awardId: v.id("awards"),
    payload: v.object({
      text: v.string(),
      url: v.string(),
      screenshotUrl: v.union(v.string(), v.null()),
      studioName: v.string(),
      studioTag: v.union(v.string(), v.null()),
    }),
  },
  returns: v.union(v.id("socialPosts"), v.null()),
  handler: async (ctx, { awardId, payload }) => {
    const existing = await ctx.db
      .query("socialPosts")
      .withIndex("by_award", (q) => q.eq("awardId", awardId))
      .first();
    if (existing) return null; // one post per award, however often this runs
    return await ctx.db.insert("socialPosts", { awardId, status: "pending", payload, createdAt: Date.now() });
  },
});

export const finishSocialPost = internalMutation({
  args: {
    id: v.id("socialPosts"),
    status: v.union(v.literal("sent"), v.literal("failed"), v.literal("skipped")),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { id, status, error }) => {
    await ctx.db.patch(id, { status, error, ...(status === "sent" ? { sentAt: Date.now() } : {}) });
    return null;
  },
});

/** Winner email + social post for a newly given award. */
export const awardAnnounced = internalAction({
  args: { awardId: v.id("awards") },
  returns: v.null(),
  handler: async (ctx, { awardId }) => {
    const data = await ctx.runQuery(internal.notify.announcement, { awardId });
    if (!data) return null;
    const award = data.award as Doc<"awards">;
    const name = TIER_NAMES[award.tier];
    const label = `${name} · ${formatDay(award.date)}`;
    const pageUrl = `${siteUrl()}/awards/${award.slug}`;

    if (data.owner && !award.notifiedAt) {
      const light = embedCode(award.slug, label, "light");
      const dark = embedCode(award.slug, label, "dark");
      const first = String(data.owner.name).split(" ")[0] || "there";
      const error = await sendEmail({
        to: [data.owner.email],
        subject: `${data.listing.title} won ${name} on Shemoqmedi`,
        text: [
          `Hi ${first},`,
          "",
          `${data.listing.title} won ${label} on Shemoqmedi.`,
          `Its award page: ${pageUrl}`,
          "",
          "Add the badge to your site (light):",
          light,
          "",
          "Dark version:",
          dark,
          "",
          "Shemoqmedi",
        ].join("\n"),
        html: emailHtml(
          [
            `Hi ${escapeHtml(first)},`,
            `<strong>${escapeHtml(data.listing.title)}</strong> won <strong>${escapeHtml(label)}</strong> on Shemoqmedi. Congratulations.`,
          ],
          { label: "See the award", href: pageUrl },
          `<p><img src="${siteUrl()}/badge/${award.slug}?theme=light" alt="${escapeHtml(label)}" width="200" height="64"></p>
<p>Add the badge to your site:</p>
<pre style="white-space:pre-wrap;font-size:12px;background:#f4f4f4;padding:12px;border-radius:8px">${escapeHtml(light)}</pre>
<p>Dark version:</p>
<pre style="white-space:pre-wrap;font-size:12px;background:#f4f4f4;padding:12px;border-radius:8px">${escapeHtml(dark)}</pre>
<p style="font-size:12px;color:#555">You can also copy it any time from your account: ${siteUrl()}/account/badges</p>`,
        ),
      });
      if (error) console.warn(`Winner email for ${award.slug} not sent: ${error}`);
      else await ctx.runMutation(internal.notify.markNotified, { awardId });
    }

    // Social post for every announced award (the payload says which tier, so
    // the automation can skip some if the feed gets busy).
    const postId = await ctx.runMutation(internal.notify.queueSocialPost, {
      awardId,
      payload: {
        text: `${label}: ${data.listing.title} by ${data.listing.creditName}${data.tag ? ` ${data.tag}` : ""}`,
        url: pageUrl,
        screenshotUrl: data.coverUrl,
        studioName: data.listing.creditName,
        studioTag: data.tag,
      },
    });
    if (!postId) return null;
    const hook = process.env.SOCIAL_WEBHOOK_URL?.trim();
    if (!hook) {
      await ctx.runMutation(internal.notify.finishSocialPost, { id: postId, status: "skipped", error: "SOCIAL_WEBHOOK_URL is not set." });
      return null;
    }
    try {
      const res = await fetch(hook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: award.tier, date: award.date, label, title: data.listing.title, ...{ url: pageUrl, screenshotUrl: data.coverUrl, studioName: data.listing.creditName, studioTag: data.tag } }),
      });
      await ctx.runMutation(internal.notify.finishSocialPost, {
        id: postId,
        status: res.ok ? "sent" : "failed",
        error: res.ok ? undefined : `HTTP ${res.status}`,
      });
    } catch (err) {
      await ctx.runMutation(internal.notify.finishSocialPost, { id: postId, status: "failed", error: (err as Error).message });
    }
    return null;
  },
});

export const adminEmails = internalQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const users = await ctx.db.query("users").take(2000);
    return users.filter((u) => u.role === "admin" || u.role === "super_admin").map((u) => u.email);
  },
});

/** The Site of the Day queue was empty: no winner today. Tell the admins to push the jury. */
export const emptyDay = internalAction({
  args: { day: v.string() },
  returns: v.null(),
  handler: async (ctx, { day }) => {
    const to = await ctx.runQuery(internal.notify.adminEmails, {});
    const error = await sendEmail({
      to,
      subject: `No Site of the Day for ${formatDay(day)}`,
      text: `The Site of the Day queue was empty, so ${formatDay(day)} has no winner. Ask the jury to score this week's batch, or give the day a winner by hand on the Awards page.`,
      html: emailHtml([
        `The Site of the Day queue was empty, so <strong>${formatDay(day)}</strong> has no winner.`,
        "Ask the jury to score this week's batch, or give the day a winner by hand on the admin Awards page.",
      ]),
    });
    if (error) console.warn(`Empty-day alert for ${day} not sent: ${error}`);
    return null;
  },
});

export const roundInfo = internalQuery({
  args: { roundId: v.id("rounds") },
  returns: v.union(v.object({ kind: v.string(), period: v.string() }), v.null()),
  handler: async (ctx, { roundId }) => {
    const r = await ctx.db.get(roundId);
    return r ? { kind: r.kind, period: r.period } : null;
  },
});

/** A Site of the Month / Year round ended without an eligible winner. */
export const noRoundWinner = internalAction({
  args: { roundId: v.id("rounds") },
  returns: v.null(),
  handler: async (ctx, { roundId }) => {
    const round = await ctx.runQuery(internal.notify.roundInfo, { roundId });
    if (!round) return null;
    const name = round.kind === "SOTM" ? "Site of the Month" : "Site of the Year";
    const to = await ctx.runQuery(internal.notify.adminEmails, {});
    const error = await sendEmail({
      to,
      subject: `No ${name} for ${round.period}`,
      text: `The ${name} round for ${round.period} closed without an eligible winner (too few jury votes, or no candidates). You can give it by hand on the Awards page.`,
      html: emailHtml([
        `The <strong>${name}</strong> round for ${round.period} closed without an eligible winner (too few jury votes, or no candidates).`,
        "You can give it by hand on the admin Awards page.",
      ]),
    });
    if (error) console.warn(`No-winner alert for ${name} ${round.period} not sent: ${error}`);
    return null;
  },
});
