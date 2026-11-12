// Award emails and the social posting job, run by the scheduler right after
// an award is given (lib/awards.ts grantAward) or a day/round has no winner.
//
//   Winner email: to the site's verified owner (or the person who claimed
//   its creator profile), with the badge and its embed code; for a site
//   nobody has claimed yet, to the creator's private contact email with the
//   listing's claim link.
//
//   Social post: queued for the social desk (social.ts), where Claude writes
//   the captions through the MCP connector and an admin approves them.

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { mediaUrl } from "./lib/media";
import { TIER_NAMES } from "./lib/awards";
import { emailHtml, escapeHtml, sendEmail } from "./lib/email";
import { siteUrl } from "./seo";
import { deliver, type Message } from "./emails";
import { newClaimToken } from "./claimLinks";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-12" → "12 Nov 2026". */
export function formatDay(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/**
 * Embed code for a badge: the image links to the award page (a followed
 * link, no nofollow). "tag" is the horizontal strip (its width follows its
 * text, so only the height is set); "seal" the round one. Both in the
 * award's own colours. The site's /account/badges page builds the same code
 * with more options (shemoqmedi/lib/badgeInfo.ts embedCode).
 */
export function embedCode(slug: string, label: string, shape: "tag" | "seal" = "tag") {
  const base = siteUrl();
  const img =
    shape === "seal"
      ? `<img src="${base}/badge/${slug}?shape=seal" alt="${label} — Shemoqmedi" width="128" height="128" loading="lazy" style="display:block">`
      : `<img src="${base}/badge/${slug}" alt="${label} — Shemoqmedi" height="56" loading="lazy" style="display:block">`;
  return `<a href="${base}/awards/${slug}" target="_blank" rel="noopener" title="${label} on Shemoqmedi">${img}</a>`;
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

/**
 * Winner email + social post for a newly given award.
 *
 * The email goes to the site's owner (or the owner of its creator profile)
 * with the badge embed code; when nobody has claimed it yet, to the
 * creator's private contact email with the listing's claim link instead
 * (claiming unlocks the badge and makes the site's link followed). Sent once
 * (awards.notifiedAt), through emails.deliver (opt-outs, unsubscribe, log).
 *
 * The social post is queued for the desk (social.queueAward): Claude writes
 * the captions and an admin approves them. Not for the honorary First 100.
 */
export const awardAnnounced = internalAction({
  args: { awardId: v.id("awards") },
  returns: v.null(),
  handler: async (ctx, { awardId }) => {
    const data = await ctx.runQuery(internal.notify.announcement, { awardId });
    if (!data) return null;
    const award = data.award as Doc<"awards">;
    const name = TIER_NAMES[award.tier];
    const honorary = award.tier === "F100";
    const label = honorary ? `First 100 · Honorary No. ${award.period}` : `${name} · ${formatDay(award.date)}`;
    // "won Site of the Day" / "is one of the First 100".
    const verb = honorary ? "is one of the" : "won";
    const pageUrl = `${siteUrl()}/awards/${award.slug}`;

    if (!award.notifiedAt) {
      const contact = await ctx.runMutation(internal.social.studioContact, {
        listingId: award.listingId,
        freshToken: newClaimToken(),
      });
      if (contact) {
        const first = contact.name.split(" ")[0] || "there";
        const subject = `${data.listing.title} ${verb} ${name} on Shemoqmedi`;
        const intro = `${data.listing.title} ${verb} ${label} on Shemoqmedi. ${honorary ? "Thank you for being here early." : "Congratulations."}`;
        let message: Message;
        if (contact.claimUrl) {
          message = {
            subject,
            text: [
              `Hi ${first},`,
              intro,
              `Its award page: ${pageUrl}`,
              `Claim the listing (free, one minute) to get the award badge for your site and to turn the link to your site into a followed link: ${contact.claimUrl}`,
              "Shemoqmedi",
            ].join("\n\n"),
            button: { label: "Claim your badge", href: contact.claimUrl },
          };
        } else {
          const tag = embedCode(award.slug, label, "tag");
          const seal = embedCode(award.slug, label, "seal");
          const badgesUrl = `${siteUrl()}/account/badges`;
          message = {
            subject,
            text: [
              `Hi ${first},`,
              intro,
              `Its award page: ${pageUrl}`,
              `Add the badge to your site (the tag, for a footer):\n${tag}`,
              `The round seal:\n${seal}`,
              `Light and dark versions, sizes and a pinned-corner option: ${badgesUrl}`,
              "Shemoqmedi",
            ].join("\n\n"),
            paragraphs: [
              `Hi ${escapeHtml(first)},`,
              `<strong>${escapeHtml(data.listing.title)}</strong> ${verb} <strong>${escapeHtml(label)}</strong> on Shemoqmedi. ${honorary ? "Thank you for being here early." : "Congratulations."}`,
            ],
            button: { label: "See the award", href: pageUrl },
            extraHtml: `<p>Add the badge to your site. The tag, for a footer:</p>
<pre style="white-space:pre-wrap;font-size:12px;background:#f4f4f4;padding:12px;border-radius:8px">${escapeHtml(tag)}</pre>
<p>The round seal:</p>
<pre style="white-space:pre-wrap;font-size:12px;background:#f4f4f4;padding:12px;border-radius:8px">${escapeHtml(seal)}</pre>
<p style="font-size:12px;color:#555">See both, pick light or dark, a size or a pinned corner, and copy the code any time: <a href="${badgesUrl}">${badgesUrl}</a></p>`,
          };
        }
        const result = await deliver(ctx, contact.email, message, {
          kind: "award",
          listingId: award.listingId,
          creatorId: contact.creatorId ?? undefined,
        });
        if (result.status === "sent") await ctx.runMutation(internal.notify.markNotified, { awardId });
        else console.warn(`Winner email for ${award.slug} not sent: ${result.error ?? result.status}`);
      }
    }

    await ctx.runMutation(internal.social.queueAward, { awardId });
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
