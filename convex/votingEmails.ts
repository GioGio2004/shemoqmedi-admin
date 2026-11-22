// Emails around a site's voting window:
//
//   live      - to the site's owner or submitter when it goes into voting
//               (listings.approve schedules it).
//   results   - to the same person when voting closes (lib/awards.ts
//               closeVoting): the jury's scores and every juror's review,
//               whether or not it won anything.
//   reminders - hourly (crons.ts): jurors get one email listing the sites
//               closing within 24 hours that they haven't scored, and the
//               admins get one alert for sites about to close with fewer
//               jury votes than an award needs.
//
// Contestant and juror emails go through emails.deliver (opt-out, unsubscribe
// link, logged); each is sent once per listing (and once per juror for
// reminders), so running a job twice sends nothing twice.

import { v } from "convex/values";
import { internalAction, internalQuery, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { deliver } from "./emails";
import { emailHtml, emailImageUrl, escapeHtml, reviewCardsHtml, scoreCardHtml, sendEmail } from "./lib/email";
import { PILLARS } from "./lib/taxonomy";
import { mediaUrl } from "./lib/media";
import { getConfig } from "./lib/config";
import { conflictReason } from "./lib/conflicts";
import { readPillars, weighted } from "./lib/scoring";
import { TIER_NAMES } from "./lib/awards";
import { siteUrl } from "./seo";
import { adminUrl } from "../lib/hosts";

const HOUR_MS = 3_600_000;
/** Reminders go out for sites closing within this window. */
const REMINDER_WINDOW_MS = 24 * HOUR_MS;

const pageUrl = (slug: string) => `${siteUrl()}/sites/${slug}`;

/** "Sunday 30 November, 23:59" in Tbilisi time. */
function closesAt(ms: number) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tbilisi",
  }).format(ms);
}

/**
 * Who hears about a listing: its verified owner, else the person who
 * submitted it, else whoever claimed its creator profile, else the creator's
 * private contact email.
 */
async function contestant(ctx: QueryCtx, listing: Doc<"listings">) {
  const creator = listing.creatorId ? await ctx.db.get(listing.creatorId) : null;
  const userId = listing.ownerId ?? listing.submittedBy ?? creator?.claimedBy;
  const user = userId ? await ctx.db.get(userId) : null;
  const email = user?.email ?? creator?.contactEmail;
  if (!email) return null;
  const name = user?.name ?? creator?.name ?? listing.creditName;
  return { email, first: name.split(" ")[0] || "there" };
}

/** The listing's screenshot as an email image (JPEG at email width), or null. */
async function coverOf(ctx: QueryCtx, listing: Doc<"listings">) {
  const url = listing.coverId ? await mediaUrl(ctx, listing.coverId) : null;
  return url ? emailImageUrl(url) : null;
}

/** For other emails about a listing (featured, award): its screenshot and page. */
export const cover = internalQuery({
  args: { listingId: v.id("listings") },
  returns: v.union(v.null(), v.object({ src: v.string(), alt: v.string(), href: v.string() })),
  handler: async (ctx, { listingId }) => {
    const listing = await ctx.db.get(listingId);
    if (!listing) return null;
    const src = await coverOf(ctx, listing);
    return src ? { src, alt: `${listing.title} screenshot`, href: pageUrl(listing.slug) } : null;
  },
});

/** Validator for a listing's jury verdict, shared by the results and award emails. */
export const vSummary = v.object({
  final: v.union(v.number(), v.null()),
  jurors: v.number(),
  pillars: v.array(v.object({ name: v.string(), weight: v.number(), value: v.number() })),
  reviews: v.array(v.object({ name: v.string(), title: v.string(), score: v.number(), comment: v.string() })),
});

/** The jury's verdict on a listing: final score, per-criterion averages, every review. */
async function summaryOf(ctx: QueryCtx, listing: Doc<"listings">) {
  const evaluations = await ctx.db
    .query("juryEvaluations")
    .withIndex("by_listing", (q) => q.eq("listingId", listing._id))
    .collect();
  const reviews = [];
  for (const e of evaluations) {
    const juror = await ctx.db.get(e.jurorId);
    reviews.push({
      name: juror?.name ?? "A juror",
      title: juror?.title ?? "",
      score: Math.round(weighted(readPillars(e.scores)) * 100) / 100,
      comment: e.comment,
    });
  }
  const p = listing.editorialScores ? readPillars(listing.editorialScores) : null;
  return {
    final: listing.finalScore ?? null,
    jurors: evaluations.length,
    pillars: p ? PILLARS.map((x) => ({ name: x.name, weight: x.weight, value: p[x.key] })) : [],
    reviews,
  };
}

/** For the award email (notify.ts): the listing's verdict, cover and whether it's claimed. */
export const awardExtras = internalQuery({
  args: { listingId: v.id("listings") },
  returns: v.union(
    v.null(),
    v.object({ summary: vSummary, cover: v.union(v.string(), v.null()), claimed: v.boolean(), slug: v.string() }),
  ),
  handler: async (ctx, { listingId }) => {
    const listing = await ctx.db.get(listingId);
    if (!listing) return null;
    return {
      summary: await summaryOf(ctx, listing),
      cover: await coverOf(ctx, listing),
      claimed: Boolean(listing.isClaimed),
      slug: listing.slug,
    };
  },
});

/** The verdict and reviews as email sections (empty parts left out). */
export function verdictSections(summary: {
  final: number | null;
  jurors: number;
  pillars: { name: string; weight: number; value: number }[];
  reviews: { name: string; title: string; score: number; comment: string }[];
}) {
  const sections: { title: string; html: string }[] = [];
  if (summary.final !== null && summary.pillars.length) {
    sections.push({
      title: "The jury's verdict",
      html: scoreCardHtml({ final: summary.final, jurors: summary.jurors, pillars: summary.pillars }),
    });
  }
  if (summary.reviews.length) sections.push({ title: "What the jury said", html: reviewCardsHtml(summary.reviews) });
  return sections;
}

/** The verdict as plain text, for the text part of an email. */
export function verdictText(summary: {
  final: number | null;
  pillars: { name: string; value: number }[];
  reviews: { name: string; title: string; score: number; comment: string }[];
}) {
  const out: string[] = [];
  if (summary.final !== null) {
    out.push(
      `Final score: ${summary.final.toFixed(2)} / 10` +
        (summary.pillars.length ? ` (${summary.pillars.map((x) => `${x.name} ${x.value.toFixed(2)}`).join(", ")})` : ""),
    );
  }
  for (const r of summary.reviews) {
    out.push(`${r.name}${r.title ? `, ${r.title}` : ""} (${r.score.toFixed(2)})${r.comment.trim() ? `:\n${r.comment.trim()}` : ""}`);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live in voting
// ─────────────────────────────────────────────────────────────────────────────

export const liveData = internalQuery({
  args: { listingId: v.id("listings") },
  returns: v.union(
    v.null(),
    v.object({
      email: v.string(),
      first: v.string(),
      title: v.string(),
      slug: v.string(),
      votingEndsAt: v.number(),
      cover: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { listingId }) => {
    const listing = await ctx.db.get(listingId);
    if (!listing || listing.status !== "in_voting" || !listing.votingEndsAt) return null;
    const who = await contestant(ctx, listing);
    if (!who) return null;
    return {
      ...who,
      title: listing.title,
      slug: listing.slug,
      votingEndsAt: listing.votingEndsAt,
      cover: await coverOf(ctx, listing),
    };
  },
});

export const live = internalAction({
  args: { listingId: v.id("listings") },
  returns: v.null(),
  handler: async (ctx, { listingId }): Promise<null> => {
    if (await ctx.runQuery(internal.emails.alreadySent, { listingId, kind: "voting" })) return null;
    const d = await ctx.runQuery(internal.votingEmails.liveData, { listingId });
    if (!d) return null;
    const url = pageUrl(d.slug);
    const text = [
      `Hi ${d.first},`,
      `${d.title} is live on Shemoqmedi and in voting until ${closesAt(d.votingEndsAt)} (Tbilisi time): ${url}`,
      "This week our jury of designers and developers scores it on design, usability, creativity and content, each on their own. Their scores stay private until voting closes, so nobody is swayed by anyone else's.",
      "Anyone can also leave a community vote on the page. Community votes are shown next to the jury score but don't decide awards, so share the link with your team, clients and followers for the visibility.",
      "When voting closes we'll email you the jury's scores and every juror's review. If the site wins an award, you'll get the badge too.",
      "Shemoqmedi",
    ].join("\n\n");
    await deliver(
      ctx,
      d.email,
      {
        subject: `${d.title} is live in voting on Shemoqmedi`,
        text,
        eyebrow: "Live in voting",
        headline: `${d.title} is live in voting`,
        preheader: `The jury scores it this week. Voting closes ${closesAt(d.votingEndsAt)}.`,
        image: d.cover ? { src: d.cover, alt: `${d.title} screenshot`, href: url } : undefined,
        primary: { label: "See your listing", href: url },
      },
      { kind: "voting", listingId },
    );
    return null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Results
// ─────────────────────────────────────────────────────────────────────────────

export const resultsData = internalQuery({
  args: { listingId: v.id("listings") },
  returns: v.union(
    v.null(),
    v.object({
      email: v.string(),
      first: v.string(),
      title: v.string(),
      slug: v.string(),
      claimed: v.boolean(),
      minVotes: v.number(),
      awards: v.array(v.object({ slug: v.string(), name: v.string() })),
      summary: vSummary,
      cover: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { listingId }) => {
    const listing = await ctx.db.get(listingId);
    if (!listing || (listing.status !== "archived" && listing.status !== "awarded")) return null;
    const who = await contestant(ctx, listing);
    if (!who) return null;
    const config = await getConfig(ctx);
    const awards = (
      await ctx.db
        .query("awards")
        .withIndex("by_listing", (q) => q.eq("listingId", listingId))
        .collect()
    )
      .filter((a) => a.status === "active")
      .map((a) => ({ slug: a.slug, name: TIER_NAMES[a.tier] }));
    return {
      ...who,
      title: listing.title,
      slug: listing.slug,
      claimed: Boolean(listing.isClaimed),
      minVotes: config.minVotes,
      awards,
      summary: await summaryOf(ctx, listing),
      cover: await coverOf(ctx, listing),
    };
  },
});

export const results = internalAction({
  args: { listingId: v.id("listings") },
  returns: v.null(),
  handler: async (ctx, { listingId }): Promise<null> => {
    if (await ctx.runQuery(internal.emails.alreadySent, { listingId, kind: "results" })) return null;
    const d = await ctx.runQuery(internal.votingEmails.resultsData, { listingId });
    if (!d) return null;
    const base = siteUrl();
    const url = pageUrl(d.slug);
    const { summary } = d;
    const scored = summary.final !== null;
    const won = d.awards.map((a) => a.name);

    const headline = won.length
      ? `${d.title} won ${won.join(" and ")}`
      : scored
        ? `Your jury results for ${d.title}`
        : `Voting has closed for ${d.title}`;
    const intro: string[] = [`Hi ${d.first},`];
    if (won.length) {
      intro.push(
        `Voting on ${d.title} has closed and the jury has spoken: it won ${won.join(" and ")}. Congratulations. Below are the final score, how it did on each criterion, and what every juror wrote.`,
        "Collect your badge to show the award on your site. It links back to your award page on Shemoqmedi.",
      );
    } else if (scored) {
      intro.push(
        `Voting on ${d.title} has closed and the jury's scores are in. Below are the final score, how it did on each criterion, and what every juror wrote.`,
      );
      if (summary.jurors > 0 && summary.jurors < d.minVotes) {
        intro.push(
          `An award needs at least ${d.minVotes} jury scores and this round it got ${summary.jurors}, so it wasn't eligible for one. We're growing the jury so every site gets a full panel.`,
        );
      }
    } else {
      intro.push(
        `Voting on ${d.title} has closed. Our jury didn't get to score it in this round, so it has no jury score. We're sorry: we're growing the jury so every site gets scored. Your listing stays on Shemoqmedi.`,
      );
    }

    const badgesHref = d.claimed ? `${base}/account/badges` : url;
    const primary = won.length
      ? { label: d.claimed ? "Collect your badge" : "Claim your listing to collect your badge", href: badgesHref }
      : { label: "See your full results", href: url };
    const sections = verdictSections(summary);
    sections.push({
      title: "What happens next",
      html: `<p style="margin:0 0 12px;font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0A0A0A">${
        won.length
          ? "Award winners are shared on our Instagram, Facebook and LinkedIn. When you post about it, tag Shemoqmedi and we'll reshare it."
          : "Your listing stays on Shemoqmedi with the jury's scores and reviews, and it keeps collecting community votes."
      }</p><p style="margin:0;font-family:Inter,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0A0A0A">Working on something new? Submit it any time: every site gets its own week with the jury.</p>`,
    });

    const text = [
      ...intro,
      `${primary.label}: ${primary.href}`,
      ...verdictText(summary),
      `Your listing: ${url}`,
      "Thank you for submitting your work. Shemoqmedi",
    ].join("\n\n");

    await deliver(
      ctx,
      d.email,
      {
        subject: won.length ? `${d.title} won ${won.join(" and ")} on Shemoqmedi` : scored ? `Jury results for ${d.title}` : `Voting closed for ${d.title}`,
        text,
        paragraphs: intro.map((x) => escapeHtml(x)),
        eyebrow: won.length ? "Award" : "Jury results",
        headline,
        preheader: scored ? `Final score ${summary.final!.toFixed(2)} / 10.` : "Voting has closed.",
        badges: d.awards.map((a) => ({
          src: `${base}/badge/${a.slug}/png?shape=seal`,
          alt: `${a.name} badge`,
          href: `${base}/awards/${a.slug}`,
          width: d.awards.length > 1 ? 160 : 220,
        })),
        primary,
        sections,
        image: d.cover ? { src: d.cover, alt: `${d.title} screenshot`, href: url } : undefined,
        imageAt: "bottom",
        button: won.length ? { label: "See your listing", href: url } : undefined,
      },
      { kind: "results", listingId },
    );
    return null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Reminders (hourly)
// ─────────────────────────────────────────────────────────────────────────────

/** Whether this address already got `kind` about this listing. */
async function sentTo(ctx: QueryCtx, listingId: Id<"listings">, kind: "juryReminder" | "lowVotes", to: string) {
  const rows = await ctx.db
    .query("emailLog")
    .withIndex("by_listing_kind", (q) => q.eq("listingId", listingId).eq("kind", kind))
    .take(500);
  return rows.some((r) => r.to === to && r.status !== "failed");
}

const site = v.object({ listingId: v.id("listings"), title: v.string(), slug: v.string(), votingEndsAt: v.number() });

/** Hourly: who needs a reminder, and which closing sites are short of jury votes. */
export const plan = internalQuery({
  args: {},
  returns: v.object({
    jurors: v.array(v.object({ email: v.string(), first: v.string(), sites: v.array(site) })),
    short: v.array(v.object({ ...site.fields, votes: v.number() })),
    minVotes: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const config = await getConfig(ctx);
    const closing = await ctx.db
      .query("listings")
      .withIndex("by_status_votingEndsAt", (q) =>
        q.eq("status", "in_voting").gt("votingEndsAt", now).lte("votingEndsAt", now + REMINDER_WINDOW_MS),
      )
      .take(200);
    const jurors = (
      await ctx.db
        .query("jurors")
        .withIndex("by_active", (q) => q.eq("active", true))
        .collect()
    ).filter((j) => j.userId && j.status !== "unclaimed" && !j.claimPending);

    const out = [];
    for (const juror of jurors) {
      const user = await ctx.db.get(juror.userId!);
      const email = user?.email?.trim().toLowerCase();
      if (!email) continue;
      const sites = [];
      for (const l of closing) {
        if (l.byTeam) continue;
        const scored = await ctx.db
          .query("juryEvaluations")
          .withIndex("by_listing_juror", (q) => q.eq("listingId", l._id).eq("jurorId", juror._id))
          .unique();
        if (scored || (await conflictReason(ctx, l, juror))) continue;
        if (await sentTo(ctx, l._id, "juryReminder", email)) continue;
        sites.push({ listingId: l._id, title: l.title, slug: l.slug, votingEndsAt: l.votingEndsAt! });
      }
      if (sites.length) out.push({ email, first: juror.name.split(" ")[0] || "there", sites });
    }

    const short = [];
    for (const l of closing) {
      if (l.byTeam) continue;
      const votes = (
        await ctx.db
          .query("juryEvaluations")
          .withIndex("by_listing", (q) => q.eq("listingId", l._id))
          .collect()
      ).length;
      if (votes >= config.minVotes) continue;
      if (await sentTo(ctx, l._id, "lowVotes", "admins")) continue;
      short.push({ listingId: l._id, title: l.title, slug: l.slug, votingEndsAt: l.votingEndsAt!, votes });
    }
    return { jurors: out, short, minVotes: config.minVotes };
  },
});

export const remind = internalAction({
  args: {},
  returns: v.object({ jurors: v.number(), short: v.number() }),
  handler: async (ctx): Promise<{ jurors: number; short: number }> => {
    const { jurors, short, minVotes } = await ctx.runQuery(internal.votingEmails.plan, {});

    for (const j of jurors) {
      const n = j.sites.length;
      const lines = j.sites.map((s) => `${s.title}, closes ${closesAt(s.votingEndsAt)}: ${pageUrl(s.slug)}`);
      const text = [
        `Hi ${j.first},`,
        `${n === 1 ? "A site you haven't scored closes" : `${n} sites you haven't scored close`} within 24 hours. Each one needs ${minVotes} jury scores to be eligible for an award, so yours counts.`,
        ...lines,
        "Open a site and use the Evaluate button in the bottom-right corner; the technical report is inside it.",
        "Thank you. Shemoqmedi",
      ].join("\n\n");
      const result = await deliver(
        ctx,
        j.email,
        {
          subject: n === 1 ? `Last day to score ${j.sites[0].title}` : `Last day to score ${n} sites on Shemoqmedi`,
          text,
          primary: { label: n === 1 ? "Score it now" : "Score the first one", href: pageUrl(j.sites[0].slug) },
          headline: n === 1 ? `Last day to score ${j.sites[0].title}` : `${n} sites close tomorrow`,
          footerNote: "You get this because you're on the Shemoqmedi jury.",
          eyebrow: "Last day to score",
          preheader: "Each site needs your score before voting closes.",
        },
        { kind: "juryReminder", listingId: j.sites[0].listingId },
      );
      // One log row per site, so each site reminds each juror once.
      for (const s of j.sites.slice(1)) {
        await ctx.runMutation(internal.emails.log, {
          to: j.email,
          subject: `Reminder included: ${s.title}`,
          kind: "juryReminder",
          status: result.status,
          listingId: s.listingId,
        });
      }
    }

    if (short.length) {
      const to = await ctx.runQuery(internal.notify.adminEmails, {});
      const items = short.map(
        (s) => `${s.title}: ${s.votes} of ${minVotes} jury scores, closes ${closesAt(s.votingEndsAt)}`,
      );
      const error = await sendEmail({
        to,
        subject: `${short.length} ${short.length === 1 ? "site closes" : "sites close"} without enough jury scores`,
        text: [
          `These close within 24 hours with fewer than ${minVotes} jury scores, so they can't win an award:`,
          ...items,
          `Chase the jury, or extend voting on each site's review page: ${adminUrl("/nominees")}`,
        ].join("\n\n"),
        html: emailHtml(
          [
            `These close within 24 hours with fewer than ${minVotes} jury scores, so they can't win an award:`,
            items.map(escapeHtml).join("<br>"),
            "Chase the jury, or extend voting on each site's review page.",
          ],
          { label: "Open nominees", href: adminUrl("/nominees") },
        ),
      });
      for (const s of short) {
        await ctx.runMutation(internal.emails.log, {
          to: "admins",
          subject: "Low jury votes alert",
          kind: "lowVotes",
          status: error ? "failed" : "sent",
          error: error ?? undefined,
          listingId: s.listingId,
        });
      }
    }
    return { jurors: jurors.length, short: short.length };
  },
});
