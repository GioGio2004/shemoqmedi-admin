// Emails to people outside the admin team: award winners, studios whose site
// was just featured, outreach Claude writes in chat, and broadcasts. Every
// one goes through `deliver`, which
//   - skips anyone on the opt-out list (emailOptOuts),
//   - adds an unsubscribe link (footer + List-Unsubscribe header; http.ts
//     serves /unsubscribe),
//   - logs it in emailLog, so the same email never goes out twice.
// Admin alerts (notify.ts emptyDay, digest) stay plain sendEmail calls.

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { emailKind } from "./schema";
import { emailHtml, escapeHtml, sendEmail } from "./lib/email";
import { isEmail } from "./lib/contacts";
import { unsubscribeToken } from "./lib/tokens";
import { newClaimToken } from "./claimLinks";

export type EmailKind = "award" | "featured" | "outreach" | "broadcast" | "custom";

/** Resend's batch endpoint takes at most this many emails per request. */
export const BATCH_SIZE = 100;

// ─────────────────────────────────────────────────────────────────────────────
// Bodies
// ─────────────────────────────────────────────────────────────────────────────

/** Escapes a line of plain text and turns bare URLs into links. */
export function linkify(line: string) {
  return escapeHtml(line).replace(
    /\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g,
    (url) => `<a href="${url}" style="color:#000">${url}</a>`,
  );
}

/** Plain text as written in chat (blank line = new paragraph) → HTML paragraphs. */
export function textToParagraphs(body: string): string[] {
  return body
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split("\n").map(linkify).join("<br>"));
}

/** Where the unsubscribe link points: this deployment's HTTP actions (http.ts). */
export async function unsubscribeUrl(email: string): Promise<string | null> {
  const base = process.env.CONVEX_SITE_URL?.trim();
  const token = await unsubscribeToken(email);
  if (!base || !token) return null;
  return `${base.replace(/\/$/, "")}/unsubscribe?e=${encodeURIComponent(email)}&t=${token}`;
}

function footer(unsubscribe: string | null) {
  const line = unsubscribe
    ? `You get this because your work is listed on Shemoqmedi. <a href="${escapeHtml(unsubscribe)}" style="color:#777">Unsubscribe</a>.`
    : "You get this because your work is listed on Shemoqmedi.";
  return `<p style="margin-top:32px;font-size:11px;color:#777">${line}</p>`;
}

export type Message = {
  subject: string;
  /** Plain-text body; blank lines separate paragraphs. */
  text: string;
  /** Pre-built HTML paragraphs (escaped already); defaults to the text's. */
  paragraphs?: string[];
  button?: { label: string; href: string };
  /** Extra HTML after the button (badge embed code, ...). */
  extraHtml?: string;
};

export type DeliverMeta = {
  kind: EmailKind;
  listingId?: Id<"listings">;
  creatorId?: Id<"creators">;
  postId?: Id<"socialPosts">;
  broadcastId?: string;
};

export type Delivery = { to: string; status: "sent" | "failed" | "skipped"; error?: string };

async function render(to: string, message: Message) {
  const unsubscribe = await unsubscribeUrl(to);
  const html = emailHtml(
    message.paragraphs ?? textToParagraphs(message.text),
    message.button,
    (message.extraHtml ?? "") + footer(unsubscribe),
  );
  const text = `${message.text}${message.button ? `\n\n${message.button.label}: ${message.button.href}` : ""}${
    unsubscribe ? `\n\n—\nUnsubscribe: ${unsubscribe}` : ""
  }`;
  const headers: Record<string, string> = unsubscribe
    ? { "List-Unsubscribe": `<${unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
    : {};
  return { html, text, headers };
}

/** Sends one email to one person, unless they opted out. Always logged. */
export async function deliver(ctx: ActionCtx, toInput: string, message: Message, meta: DeliverMeta): Promise<Delivery> {
  const to = toInput.trim().toLowerCase();
  const log = async (status: Delivery["status"], error?: string): Promise<Delivery> => {
    await ctx.runMutation(internal.emails.log, { to, subject: message.subject, status, error, ...meta });
    return { to, status, ...(error ? { error } : {}) };
  };
  if (!isEmail(to)) return log("skipped", "Not an email address.");
  const optedOut: string[] = await ctx.runQuery(internal.emails.optedOut, { emails: [to] });
  if (optedOut.length) return log("skipped", "Unsubscribed.");
  const { html, text, headers } = await render(to, message);
  const error = await sendEmail({ to: [to], subject: message.subject, text, html, headers });
  return log(error ? "failed" : "sent", error ?? undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
// Opt-outs and the log
// ─────────────────────────────────────────────────────────────────────────────

/** The ones among `emails` that unsubscribed. */
export const optedOut = internalQuery({
  args: { emails: v.array(v.string()) },
  returns: v.array(v.string()),
  handler: async (ctx, { emails }) => {
    const out: string[] = [];
    for (const raw of emails) {
      const email = raw.trim().toLowerCase();
      const row = await ctx.db
        .query("emailOptOuts")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();
      if (row) out.push(email);
    }
    return out;
  },
});

export const optOut = internalMutation({
  args: { email: v.string() },
  returns: v.null(),
  handler: async (ctx, { email: raw }) => {
    const email = raw.trim().toLowerCase();
    const row = await ctx.db
      .query("emailOptOuts")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (!row) await ctx.db.insert("emailOptOuts", { email, createdAt: Date.now() });
    return null;
  },
});

export const log = internalMutation({
  args: {
    to: v.string(),
    subject: v.string(),
    kind: emailKind,
    status: v.union(v.literal("sent"), v.literal("failed"), v.literal("skipped")),
    error: v.optional(v.string()),
    listingId: v.optional(v.id("listings")),
    creatorId: v.optional(v.id("creators")),
    postId: v.optional(v.id("socialPosts")),
    broadcastId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("emailLog", { ...args, subject: args.subject.slice(0, 300), sentAt: Date.now() });
    return null;
  },
});

/** Whether `kind` was already sent (not just tried) about this listing. */
export const alreadySent = internalQuery({
  args: { listingId: v.id("listings"), kind: emailKind },
  returns: v.boolean(),
  handler: async (ctx, { listingId, kind }) => {
    const rows = await ctx.db
      .query("emailLog")
      .withIndex("by_listing_kind", (q) => q.eq("listingId", listingId).eq("kind", kind))
      .take(20);
    return rows.some((r) => r.status === "sent");
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Broadcasts
// ─────────────────────────────────────────────────────────────────────────────

export const audience = v.union(
  v.literal("users"), // everyone with an account
  v.literal("studios"), // creator contact emails + owners of claimed studios and listings
  v.literal("jurors"),
  v.literal("all"),
);
export type Audience = "users" | "studios" | "jurors" | "all";

/** Everyone in an audience, lowercased and deduplicated, minus opt-outs. */
export const audienceEmails = internalQuery({
  args: { audience },
  returns: v.array(v.string()),
  handler: async (ctx, { audience }) => {
    const set = new Set<string>();
    const add = (email: string | undefined | null) => {
      if (email && isEmail(email)) set.add(email.trim().toLowerCase());
    };
    const users = await ctx.db.query("users").take(5000);
    const userEmail = new Map(users.map((u) => [u._id, u.email]));
    if (audience === "users" || audience === "all") users.forEach((u) => add(u.email));
    if (audience === "studios" || audience === "all") {
      for (const c of await ctx.db.query("creators").take(2000)) {
        add(c.contactEmail);
        if (c.claimedBy) add(userEmail.get(c.claimedBy));
      }
      for (const l of await ctx.db.query("listings").take(5000)) {
        if (l.ownerId && l.status !== "rejected") add(userEmail.get(l.ownerId));
      }
    }
    if (audience === "jurors" || audience === "all") {
      for (const j of await ctx.db.query("jurors").take(500)) {
        if (!j.active) continue;
        add(j.email);
        if (j.userId) add(userEmail.get(j.userId));
      }
    }
    const out: string[] = [];
    for (const email of set) {
      const opted = await ctx.db
        .query("emailOptOuts")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();
      if (!opted) out.push(email);
    }
    return out.sort();
  },
});

/**
 * Sends one message to an audience through Resend's batch endpoint (100 per
 * request), each with its own unsubscribe link. Scheduled by
 * mcp.sendBroadcast after the admin confirmed the preview.
 */
export const broadcast = internalAction({
  args: { audience, subject: v.string(), body: v.string(), broadcastId: v.string() },
  returns: v.object({ sent: v.number(), failed: v.number() }),
  handler: async (ctx, { audience, subject, body, broadcastId }) => {
    const key = process.env.RESEND_API_KEY?.trim();
    const from = process.env.RESEND_FROM?.trim() || "Shemoqmedi <awards@shemoqmedi.space>";
    const emails: string[] = await ctx.runQuery(internal.emails.audienceEmails, { audience });
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const chunk = emails.slice(i, i + BATCH_SIZE);
      const rendered = await Promise.all(chunk.map((to) => render(to, { subject, text: body })));
      let error: string | null = key ? null : "RESEND_API_KEY is not set on this Convex deployment.";
      if (key) {
        try {
          const res = await fetch("https://api.resend.com/emails/batch", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify(
              chunk.map((to, n) => ({ from, to: [to], subject, ...rendered[n] })),
            ),
          });
          if (!res.ok) error = `Resend refused the batch (${res.status}). ${(await res.text().catch(() => "")).slice(0, 200)}`;
        } catch (err) {
          error = `Could not reach Resend: ${(err as Error).message}`;
        }
      }
      for (const to of chunk) {
        await ctx.runMutation(internal.emails.log, {
          to,
          subject,
          kind: "broadcast",
          status: error ? "failed" : "sent",
          error: error ?? undefined,
          broadcastId,
        });
      }
      if (error) failed += chunk.length;
      else sent += chunk.length;
    }
    return { sent, failed };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Studio emails the desk sends by itself
// ─────────────────────────────────────────────────────────────────────────────

/** "You're featured on Shemoqmedi": sent when the new-listing post is approved. */
export const featured = internalAction({
  args: { listingId: v.id("listings"), postId: v.optional(v.id("socialPosts")) },
  returns: v.union(v.object({ to: v.string(), status: v.string(), error: v.optional(v.string()) }), v.null()),
  handler: async (ctx, { listingId, postId }) => {
    if (await ctx.runQuery(internal.emails.alreadySent, { listingId, kind: "featured" })) return null;
    const contact = await ctx.runMutation(internal.social.studioContact, { listingId, freshToken: newClaimToken() });
    if (!contact) return null;
    const first = contact.name.split(" ")[0] || "there";
    const lines = [
      `Hi ${first},`,
      `${contact.title} is now featured on Shemoqmedi, a curated showcase of the best web design, judged by a jury of designers and developers: ${contact.pageUrl}`,
      contact.claimUrl
        ? `It's listed under your studio but not yet claimed. Claim it (free, one minute) to manage the listing, get the badge if it wins an award, and turn the link to your site into a followed link: ${contact.claimUrl}`
        : "The jury is scoring it this week. If it wins an award you'll get the badge and an email from us.",
      "Shemoqmedi",
    ];
    const result = await deliver(
      ctx,
      contact.email,
      {
        subject: `${contact.title} is featured on Shemoqmedi`,
        text: lines.join("\n\n"),
        button: contact.claimUrl ? { label: "Claim your listing", href: contact.claimUrl } : { label: "See the listing", href: contact.pageUrl },
      },
      { kind: "featured", listingId, creatorId: contact.creatorId ?? undefined, postId },
    );
    return result;
  },
});
