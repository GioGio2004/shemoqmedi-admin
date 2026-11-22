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
import { emailHtml, emailImageUrl, escapeHtml, sendEmail } from "./lib/email";
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
        preheader: `The jury scores it this week. Voting closes ${closesAt(d.votingEndsAt)}.`,
        image: d.cover ? { src: d.cover, alt: `${d.title} screenshot`, href: url } : undefined,
        button: { label: "See your listing", href: url },
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
      finalScore: v.union(v.number(), v.null()),
      pillars: v.union(
        v.null(),
        v.object({ design: v.number(), usability: v.number(), creativity: v.number(), content: v.number() }),
      ),
      minVotes: v.number(),
      awards: v.array(v.string()),
      reviews: v.array(v.object({ name: v.string(), title: v.string(), score: v.number(), comment: v.string() })),
      cover: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, { listingId }) => {
    const listing = await ctx.db.get(listingId);
    if (!listing || (listing.status !== "archived" && listing.status !== "awarded")) return null;
    const who = await contestant(ctx, listing);
    if (!who) return null;
    const config = await getConfig(ctx);
    const evaluations = await ctx.db
      .query("juryEvaluations")
      .withIndex("by_listing", (q) => q.eq("listingId", listingId))
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
    const awards = (
      await ctx.db
        .query("awards")
        .withIndex("by_listing", (q) => q.eq("listingId", listingId))
        .collect()
    )
      .filter((a) => a.status === "active")
      .map((a) => TIER_NAMES[a.tier]);
    const p = listing.editorialScores ? readPillars(listing.editorialScores) : null;
    return {
      ...who,
      title: listing.title,
      slug: listing.slug,
      finalScore: listing.finalScore ?? null,
      pillars: p ? { design: p.design, usability: p.usability, creativity: p.creativity, content: p.content } : null,
      minVotes: config.minVotes,
      awards,
      reviews,
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
    const url = pageUrl(d.slug);
    const f = (n: number) => n.toFixed(2);
    const head: string[] = [`Hi ${d.first},`];
    if (d.reviews.length === 0 && d.finalScore === null) {
      head.push(
        `Voting on ${d.title} has closed. Our jury didn't get to score it in this round, so it has no jury score. We're sorry: we're growing the jury so every site gets scored. Your listing stays on Shemoqmedi: ${url}`,
      );
    } else {
      head.push(
        `Voting on ${d.title} has closed, and the jury's scores are in.`,
        `Final score: ${d.finalScore !== null ? f(d.finalScore) : "—"} out of 10${d.reviews.length ? `, from ${d.reviews.length} ${d.reviews.length === 1 ? "juror" : "jurors"}` : ""}.` +
          (d.pillars
            ? ` Design ${f(d.pillars.design)}, usability ${f(d.pillars.usability)}, creativity ${f(d.pillars.creativity)}, content ${f(d.pillars.content)}.`
            : ""),
      );
      if (d.awards.length) {
        head.push(`It won ${d.awards.join(" and ")}. You'll get a separate email with the badge.`);
      } else if (d.reviews.length > 0 && d.reviews.length < d.minVotes) {
        head.push(`An award needs at least ${d.minVotes} jury scores, so this round it wasn't eligible for one.`);
      }
    }
    const reviewText = d.reviews
      .filter((r) => r.comment.trim())
      .map((r) => `${r.name}${r.title ? `, ${r.title}` : ""} (${f(r.score)}):\n${r.comment.trim()}`);
    const tail = [
      reviewText.length ? "What the jury wrote is on your listing page, with their names." : "",
      "Thank you for submitting your work. Shemoqmedi",
    ].filter(Boolean);
    const text = [...head, ...reviewText, ...tail].join("\n\n");

    // HTML: reviews as quoted blocks.
    const para = (s: string) => escapeHtml(s).replace(/\n/g, "<br>");
    const paragraphs = [
      ...head.map(para),
      ...d.reviews
        .filter((r) => r.comment.trim())
        .map(
          (r) =>
            `<span style="display:block;border-left:3px solid #FF4D00;padding:2px 0 2px 14px"><strong>${escapeHtml(r.name)}</strong>${r.title ? `<span style="color:#6B665E">, ${escapeHtml(r.title)}</span>` : ""}<span style="float:right;font-weight:700">${f(r.score)}</span><br><span style="color:#333">${para(r.comment.trim())}</span></span>`,
        ),
      ...tail.map(para),
    ];
    await deliver(
      ctx,
      d.email,
      {
        subject: d.reviews.length || d.finalScore !== null ? `Jury results for ${d.title}` : `Voting closed for ${d.title}`,
        text,
        paragraphs,
        eyebrow: d.awards.length ? `Jury results · ${d.awards.join(" · ")}` : "Jury results",
        preheader:
          d.finalScore !== null && d.reviews.length
            ? `Final score ${f(d.finalScore)} from ${d.reviews.length} ${d.reviews.length === 1 ? "juror" : "jurors"}.`
            : "Voting has closed.",
        image: d.cover ? { src: d.cover, alt: `${d.title} screenshot`, href: url } : undefined,
        button: { label: "See your listing", href: url },
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
          button: { label: n === 1 ? "Score it now" : "Score the first one", href: pageUrl(j.sites[0].slug) },
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
