// The jury: invitation-only members who evaluate listings during their
// voting window. A listing's jury score (editorialScores) is the per-pillar
// average of its jurors' evaluations; each evaluation's comment is shown on
// the listing page.
//
//   admin  → invite (action: creates the invite, emails it through Resend)
//   invitee → /jury/join?token=… on the site → acceptInvite → a jurors row
//   juror  → Evaluate button on /sites/<slug> → evaluate

import { v } from "convex/values";
import { action, internalMutation, mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin, requireUser } from "./authHelpers";
import { getUserByExternalId } from "./users";
import { pillars } from "./schema";
import { DAY_MS, LIMITS } from "./lib/taxonomy";
import { normalizePillars, round2, type Pillars } from "./lib/scoring";
import { cleanText, fail, isPublicStatus, normalizeUrl, scoreFields, slugify } from "./lib/listingHelpers";
import { listingPaths, scheduleIndexNow, siteUrl } from "./seo";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 32 random bytes as hex. Actions only: mutations and queries are deterministic. */
function newToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanEmail(raw: string) {
  const email = raw.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) fail("Enter a valid email address.");
  return email;
}

/** Keeps line breaks (up to one blank line) but tidies spaces. */
function cleanComment(raw: string) {
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length < LIMITS.juryCommentMin) {
    fail(`Write at least ${LIMITS.juryCommentMin} characters about the site.`);
  }
  if (text.length > LIMITS.juryComment) fail(`Keep the comment to ${LIMITS.juryComment} characters.`);
  return text;
}

/** The user's Clerk photo, or null when they only have Clerk's default avatar. */
function photoOf(user: Doc<"users"> | null) {
  return user?.hasImage && user.profilePicture ? user.profilePicture : null;
}

async function jurorOf(ctx: QueryCtx, userId: Id<"users">) {
  return await ctx.db
    .query("jurors")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/** The signed-in user and their active juror row, or null (no throw). */
async function currentJuror(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const user = await getUserByExternalId(ctx, identity.subject);
  if (!user) return null;
  const juror = await jurorOf(ctx, user._id);
  return juror?.active ? { user, juror } : null;
}

async function requireJuror(ctx: QueryCtx) {
  const user = await requireUser(ctx);
  const juror = await jurorOf(ctx, user._id);
  if (!juror?.active) fail("Only jury members can do this.");
  return { user, juror };
}

async function uniqueJurorSlug(ctx: QueryCtx, name: string, except?: Id<"jurors">) {
  const base = slugify(name, "juror");
  for (let i = 1; ; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    const taken = await ctx.db
      .query("jurors")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!taken || taken._id === except) return slug;
  }
}

const profileArgs = {
  name: v.string(),
  title: v.string(),
  location: v.optional(v.string()),
  website: v.optional(v.string()),
  bio: v.optional(v.string()),
};

function cleanProfile(args: { name: string; title: string; location?: string; website?: string; bio?: string }) {
  return {
    name: cleanText(args.name, "Name", LIMITS.creditName),
    title: cleanText(args.title, "Role", LIMITS.juryTitle),
    location: cleanText(args.location ?? "", "Location", 80, false) || undefined,
    website: args.website?.trim() ? normalizeUrl(args.website, "Website") : undefined,
    bio: cleanText(args.bio ?? "", "Bio", LIMITS.juryBio, false) || undefined,
  };
}

/**
 * Set a listing's jury score to the per-pillar average of its evaluations
 * (or clear it when none are left) and recompute the final score.
 */
export async function recomputeJuryScore(ctx: MutationCtx, listingId: Id<"listings">) {
  const listing = await ctx.db.get(listingId);
  if (!listing) return;
  const evaluations = await ctx.db
    .query("juryEvaluations")
    .withIndex("by_listing", (q) => q.eq("listingId", listingId))
    .collect();
  let editorial: Pillars | undefined;
  if (evaluations.length > 0) {
    const n = evaluations.length;
    const sum = (k: keyof Pillars) => evaluations.reduce((s, e) => s + e.scores[k], 0);
    editorial = {
      design: round2(sum("design") / n),
      usability: round2(sum("usability") / n),
      creativity: round2(sum("creativity") / n),
      code: round2(sum("code") / n),
    };
  }
  await ctx.db.patch(listingId, {
    editorialScores: editorial,
    ...scoreFields(editorial, listing.communityTotals, listing.communityVotesCount),
    updatedAt: Date.now(),
  });
}

/** Why a juror can't evaluate this listing right now, or null if they can. */
async function blockReason(ctx: QueryCtx, listing: Doc<"listings">, userId: Id<"users">) {
  if (listing.status !== "in_voting" || !listing.votingEndsAt || Date.now() >= listing.votingEndsAt) {
    return "Voting is closed for this site.";
  }
  if (listing.ownerId === userId) return "You can't evaluate your own site.";
  if (listing.creatorId) {
    const creator = await ctx.db.get(listing.creatorId);
    if (creator?.claimedBy === userId) return "You can't evaluate your own site.";
  }
  return null;
}

async function listingBySlug(ctx: QueryCtx, slug: string) {
  return await ctx.db
    .query("listings")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .first();
}

const jurorPublic = v.object({
  slug: v.string(),
  name: v.string(),
  title: v.string(),
  location: v.union(v.string(), v.null()),
  website: v.union(v.string(), v.null()),
  bio: v.union(v.string(), v.null()),
  imageUrl: v.union(v.string(), v.null()), // null: show the grey placeholder
});

async function toJurorPublic(ctx: QueryCtx, juror: Doc<"jurors">) {
  return {
    slug: juror.slug,
    name: juror.name,
    title: juror.title,
    location: juror.location ?? null,
    website: juror.website ?? null,
    bio: juror.bio ?? null,
    imageUrl: photoOf(await ctx.db.get(juror.userId)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public (site)
// ─────────────────────────────────────────────────────────────────────────────

/** Active jurors for /jury, longest-serving first, with their evaluation counts. */
export const listPublic = query({
  args: {},
  returns: v.array(v.object({ ...jurorPublic.fields, evaluations: v.number() })),
  handler: async (ctx) => {
    const jurors = await ctx.db
      .query("jurors")
      .withIndex("by_active", (q) => q.eq("active", true))
      .take(200);
    return await Promise.all(
      jurors.map(async (j) => ({
        ...(await toJurorPublic(ctx, j)),
        evaluations: (
          await ctx.db
            .query("juryEvaluations")
            .withIndex("by_juror", (q) => q.eq("jurorId", j._id))
            .take(1000)
        ).length,
      })),
    );
  },
});

/** Jury evaluations of a public listing, oldest first, for its page. */
export const reviewsForListing = query({
  args: { slug: v.string() },
  returns: v.array(
    v.object({
      juror: jurorPublic,
      scores: pillars,
      average: v.number(),
      comment: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, { slug }) => {
    const listing = await listingBySlug(ctx, slug);
    if (!listing || !isPublicStatus(listing.status)) return [];
    const evaluations = await ctx.db
      .query("juryEvaluations")
      .withIndex("by_listing", (q) => q.eq("listingId", listing._id))
      .collect();
    evaluations.sort((a, b) => a.createdAt - b.createdAt);
    const out = [];
    for (const e of evaluations) {
      const juror = await ctx.db.get(e.jurorId);
      if (!juror) continue;
      const s = e.scores;
      out.push({
        juror: await toJurorPublic(ctx, juror),
        scores: s,
        average: round2((s.design + s.usability + s.creativity + s.code) / 4),
        comment: e.comment,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      });
    }
    return out;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Jurors
// ─────────────────────────────────────────────────────────────────────────────

/** The signed-in user's jury profile, or null if they are not on the jury. */
export const me = query({
  args: {},
  returns: v.union(jurorPublic, v.null()),
  handler: async (ctx) => {
    const current = await currentJuror(ctx);
    return current ? await toJurorPublic(ctx, current.juror) : null;
  },
});

/** For the Evaluate panel: whether the juror can evaluate, and their saved evaluation. */
export const myEvaluation = query({
  args: { slug: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      blocked: v.union(v.string(), v.null()),
      evaluation: v.union(
        v.object({ scores: pillars, comment: v.string(), updatedAt: v.number() }),
        v.null(),
      ),
      votingEndsAt: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx, { slug }) => {
    const current = await currentJuror(ctx);
    if (!current) return null;
    const listing = await listingBySlug(ctx, slug);
    if (!listing || !isPublicStatus(listing.status)) return null;
    const saved = await ctx.db
      .query("juryEvaluations")
      .withIndex("by_listing_juror", (q) => q.eq("listingId", listing._id).eq("jurorId", current.juror._id))
      .unique();
    return {
      blocked: await blockReason(ctx, listing, current.user._id),
      evaluation: saved ? { scores: saved.scores, comment: saved.comment, updatedAt: saved.updatedAt } : null,
      votingEndsAt: listing.votingEndsAt ?? null,
    };
  },
});

/** Save (or update) the juror's evaluation of a listing in its voting window. */
export const evaluate = mutation({
  args: { slug: v.string(), scores: pillars, comment: v.string() },
  returns: v.null(),
  handler: async (ctx, { slug, scores, comment }) => {
    const { user, juror } = await requireJuror(ctx);
    const listing = await listingBySlug(ctx, slug);
    if (!listing) fail("Site not found.");
    const blocked = await blockReason(ctx, listing, user._id);
    if (blocked) fail(blocked);
    let clean: Pillars;
    try {
      clean = normalizePillars(scores);
    } catch (err) {
      fail((err as Error).message);
    }
    const text = cleanComment(comment);
    const now = Date.now();
    const saved = await ctx.db
      .query("juryEvaluations")
      .withIndex("by_listing_juror", (q) => q.eq("listingId", listing._id).eq("jurorId", juror._id))
      .unique();
    if (saved) {
      await ctx.db.patch(saved._id, { scores: clean, comment: text, updatedAt: now });
    } else {
      await ctx.db.insert("juryEvaluations", {
        listingId: listing._id,
        jurorId: juror._id,
        scores: clean,
        comment: text,
        createdAt: now,
        updatedAt: now,
      });
    }
    await recomputeJuryScore(ctx, listing._id);
    if (!saved) await scheduleIndexNow(ctx, await listingPaths(ctx, listing));
    return null;
  },
});

/** A juror edits their own public profile. */
export const updateProfile = mutation({
  args: profileArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const { juror } = await requireJuror(ctx);
    const profile = cleanProfile(args);
    const slug = profile.name === juror.name ? juror.slug : await uniqueJurorSlug(ctx, profile.name, juror._id);
    await ctx.db.patch(juror._id, { ...profile, slug, updatedAt: Date.now() });
    return null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Invitations
// ─────────────────────────────────────────────────────────────────────────────

async function inviteFor(ctx: QueryCtx, token: string) {
  const hash = await sha256Hex(token);
  return await ctx.db
    .query("juryInvites")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", hash))
    .unique();
}

/** What the join page shows for a link: who it is for and whether it still works. */
export const inviteByToken = query({
  args: { token: v.string() },
  returns: v.object({
    status: v.union(
      v.literal("valid"),
      v.literal("accepted"),
      v.literal("revoked"),
      v.literal("expired"),
      v.literal("unknown"),
    ),
    name: v.union(v.string(), v.null()),
    email: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { token }) => {
    const invite = token ? await inviteFor(ctx, token) : null;
    if (!invite) return { status: "unknown" as const, name: null, email: null };
    const status =
      invite.status !== "pending"
        ? invite.status
        : Date.now() > invite.expiresAt
          ? ("expired" as const)
          : ("valid" as const);
    return { status, name: invite.name, email: invite.email };
  },
});

/** The invitee, signed in with the invited email, joins the jury. */
export const acceptInvite = mutation({
  args: { token: v.string(), ...profileArgs },
  returns: v.null(),
  handler: async (ctx, { token, ...args }) => {
    const user = await requireUser(ctx);
    const invite = await inviteFor(ctx, token);
    if (!invite || invite.status === "revoked") fail("This invitation link is not valid.");
    if (invite.status === "accepted") fail("This invitation has already been used.");
    if (Date.now() > invite.expiresAt) fail("This invitation has expired. Ask for a new one.");
    if (user.email.toLowerCase() !== invite.email) {
      fail(`This invitation was sent to ${invite.email}. Sign in with that email address to accept it.`);
    }
    const profile = cleanProfile(args);
    const now = Date.now();
    const existing = await jurorOf(ctx, user._id);
    if (existing) {
      // A former juror invited back.
      await ctx.db.patch(existing._id, { ...profile, active: true, updatedAt: now });
    } else {
      await ctx.db.insert("jurors", {
        userId: user._id,
        slug: await uniqueJurorSlug(ctx, profile.name),
        ...profile,
        active: true,
        joinedAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch(invite._id, { status: "accepted", acceptedBy: user._id, acceptedAt: now });
    await scheduleIndexNow(ctx, ["/jury"]);
    return null;
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────────────────────────────────────

export const createInvite = internalMutation({
  args: { email: v.string(), name: v.string(), note: v.optional(v.string()), tokenHash: v.string() },
  returns: v.id("juryInvites"),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const email = cleanEmail(args.email);
    const name = cleanText(args.name, "Name", LIMITS.creditName);
    const note = cleanText(args.note ?? "", "Note", 500, false) || undefined;
    const open = await ctx.db
      .query("juryInvites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    if (open.some((i) => i.status === "pending" && i.expiresAt > Date.now())) {
      fail("This email already has an open invitation. Resend it from the list instead.");
    }
    const user = await ctx.db
      .query("users")
      .withIndex("byEmail", (q) => q.eq("email", email))
      .first();
    if (user && (await jurorOf(ctx, user._id))?.active) fail("This person is already on the jury.");
    const now = Date.now();
    return await ctx.db.insert("juryInvites", {
      email,
      name,
      note,
      tokenHash: args.tokenHash,
      status: "pending",
      invitedBy: admin._id,
      expiresAt: now + LIMITS.juryInviteDays * DAY_MS,
      createdAt: now,
    });
  },
});

/** New token and expiry for a pending invite (the old link stops working). */
export const rotateInvite = internalMutation({
  args: { inviteId: v.id("juryInvites"), tokenHash: v.string() },
  returns: v.object({ email: v.string(), name: v.string(), note: v.union(v.string(), v.null()) }),
  handler: async (ctx, { inviteId, tokenHash }) => {
    await requireAdmin(ctx);
    const invite = await ctx.db.get(inviteId);
    if (!invite) fail("Invitation not found.");
    if (invite.status !== "pending") fail("Only open invitations can be resent.");
    await ctx.db.patch(inviteId, {
      tokenHash,
      expiresAt: Date.now() + LIMITS.juryInviteDays * DAY_MS,
      sendError: undefined,
    });
    return { email: invite.email, name: invite.name, note: invite.note ?? null };
  },
});

export const recordSend = internalMutation({
  args: { inviteId: v.id("juryInvites"), error: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { inviteId, error }) => {
    await ctx.db.patch(inviteId, error ? { sendError: error } : { sentAt: Date.now(), sendError: undefined });
    return null;
  },
});

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Sends the invitation through Resend. Returns an error message, or null when sent. */
async function sendInviteEmail(to: string, name: string, note: string | null, link: string) {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return "RESEND_API_KEY is not set on this Convex deployment. Copy the link and send it yourself.";
  const from = process.env.RESEND_FROM?.trim() || "Shemoqmedi <jury@shemoqmedi.space>";
  const first = name.split(" ")[0];
  const text = [
    `Hi ${first},`,
    "",
    "We'd like to invite you to the jury of Shemoqmedi, the website awards platform.",
    "Jurors score the sites in their voting week on design, usability, creativity and code, and leave a short comment that is shown on each site's page.",
    ...(note ? ["", note] : []),
    "",
    `Accept the invitation and set up your jury profile (the link works for ${LIMITS.juryInviteDays} days):`,
    link,
    "",
    "Shemoqmedi",
  ].join("\n");
  const html = `<div style="font-family:Inter,Arial,sans-serif;color:#000;max-width:520px;line-height:1.6">
<p>Hi ${escapeHtml(first)},</p>
<p>We'd like to invite you to the jury of <strong>Shemoqmedi</strong>, the website awards platform. Jurors score the sites in their voting week on design, usability, creativity and code, and leave a short comment that is shown on each site's page.</p>
${note ? `<p>${escapeHtml(note)}</p>` : ""}
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#000;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600;font-size:13px;letter-spacing:.06em;text-transform:uppercase">Join the jury</a></p>
<p style="font-size:12px;color:#555">The link works for ${LIMITS.juryInviteDays} days and only for ${escapeHtml(to)}.</p>
</div>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: "Join the Shemoqmedi jury", text, html }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return `Resend refused the email (${res.status}). ${body.slice(0, 200)}`.trim();
    }
    return null;
  } catch (err) {
    return `Could not reach Resend: ${(err as Error).message}`;
  }
}

const inviteResult = v.object({ link: v.string(), sent: v.boolean(), error: v.union(v.string(), v.null()) });

/** Admin: invite someone to the jury by email. Returns the link (to copy if sending failed). */
export const invite = action({
  args: { email: v.string(), name: v.string(), note: v.optional(v.string()) },
  returns: inviteResult,
  handler: async (ctx, args): Promise<{ link: string; sent: boolean; error: string | null }> => {
    const token = newToken();
    const inviteId = await ctx.runMutation(internal.jury.createInvite, { ...args, tokenHash: await sha256Hex(token) });
    const link = `${siteUrl()}/jury/join?token=${token}`;
    const error = await sendInviteEmail(args.email.trim().toLowerCase(), args.name.trim(), args.note?.trim() || null, link);
    await ctx.runMutation(internal.jury.recordSend, { inviteId, error: error ?? undefined });
    return { link, sent: error === null, error };
  },
});

/** Admin: send a pending invitation again with a fresh link. */
export const resendInvite = action({
  args: { inviteId: v.id("juryInvites") },
  returns: inviteResult,
  handler: async (ctx, { inviteId }): Promise<{ link: string; sent: boolean; error: string | null }> => {
    const token = newToken();
    const invite = await ctx.runMutation(internal.jury.rotateInvite, { inviteId, tokenHash: await sha256Hex(token) });
    const link = `${siteUrl()}/jury/join?token=${token}`;
    const error = await sendInviteEmail(invite.email, invite.name, invite.note, link);
    await ctx.runMutation(internal.jury.recordSend, { inviteId, error: error ?? undefined });
    return { link, sent: error === null, error };
  },
});

export const revokeInvite = mutation({
  args: { inviteId: v.id("juryInvites") },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    await requireAdmin(ctx);
    const invite = await ctx.db.get(inviteId);
    if (!invite) fail("Invitation not found.");
    if (invite.status !== "pending") fail("Only open invitations can be revoked.");
    await ctx.db.patch(inviteId, { status: "revoked" });
    return null;
  },
});

/** Admin: every invitation and juror. */
export const adminOverview = query({
  args: {},
  returns: v.object({
    invites: v.array(
      v.object({
        id: v.id("juryInvites"),
        email: v.string(),
        name: v.string(),
        status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("revoked"), v.literal("expired")),
        createdAt: v.number(),
        expiresAt: v.number(),
        sentAt: v.union(v.number(), v.null()),
        sendError: v.union(v.string(), v.null()),
        invitedBy: v.union(v.string(), v.null()),
      }),
    ),
    jurors: v.array(
      v.object({
        id: v.id("jurors"),
        ...jurorPublic.fields,
        email: v.union(v.string(), v.null()),
        active: v.boolean(),
        joinedAt: v.number(),
        evaluations: v.number(),
      }),
    ),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const now = Date.now();
    const invites = await ctx.db.query("juryInvites").withIndex("by_created").order("desc").take(300);
    const jurors = await ctx.db.query("jurors").take(300);
    return {
      invites: await Promise.all(
        invites.map(async (i) => ({
          id: i._id,
          email: i.email,
          name: i.name,
          status: i.status === "pending" && now > i.expiresAt ? ("expired" as const) : i.status,
          createdAt: i.createdAt,
          expiresAt: i.expiresAt,
          sentAt: i.sentAt ?? null,
          sendError: i.sendError ?? null,
          invitedBy: (await ctx.db.get(i.invitedBy))?.name ?? null,
        })),
      ),
      jurors: await Promise.all(
        jurors
          .sort((a, b) => Number(b.active) - Number(a.active) || a.joinedAt - b.joinedAt)
          .map(async (j) => ({
            id: j._id,
            ...(await toJurorPublic(ctx, j)),
            email: (await ctx.db.get(j.userId))?.email ?? null,
            active: j.active,
            joinedAt: j.joinedAt,
            evaluations: (
              await ctx.db
                .query("juryEvaluations")
                .withIndex("by_juror", (q) => q.eq("jurorId", j._id))
                .take(1000)
            ).length,
          })),
      ),
    };
  },
});

/** Admin: take someone off the jury (or bring them back). Evaluations stay. */
export const setJurorActive = mutation({
  args: { jurorId: v.id("jurors"), active: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { jurorId, active }) => {
    await requireAdmin(ctx);
    const juror = await ctx.db.get(jurorId);
    if (!juror) fail("Juror not found.");
    await ctx.db.patch(jurorId, { active, updatedAt: Date.now() });
    await scheduleIndexNow(ctx, ["/jury"]);
    return null;
  },
});

/** Admin: the jury evaluations of one listing (review screen). */
export const evaluationsForListing = query({
  args: { listingId: v.id("listings") },
  returns: v.array(
    v.object({
      id: v.id("juryEvaluations"),
      jurorName: v.string(),
      scores: pillars,
      comment: v.string(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, { listingId }) => {
    await requireAdmin(ctx);
    const rows = await ctx.db
      .query("juryEvaluations")
      .withIndex("by_listing", (q) => q.eq("listingId", listingId))
      .collect();
    return await Promise.all(
      rows.map(async (e) => ({
        id: e._id,
        jurorName: (await ctx.db.get(e.jurorId))?.name ?? "Former juror",
        scores: e.scores,
        comment: e.comment,
        updatedAt: e.updatedAt,
      })),
    );
  },
});

/** Admin: remove one evaluation (moderation); the jury score is recomputed. */
export const deleteEvaluation = mutation({
  args: { evaluationId: v.id("juryEvaluations") },
  returns: v.null(),
  handler: async (ctx, { evaluationId }) => {
    await requireAdmin(ctx);
    const e = await ctx.db.get(evaluationId);
    if (!e) fail("Evaluation not found.");
    await ctx.db.delete(evaluationId);
    await recomputeJuryScore(ctx, e.listingId);
    return null;
  },
});

/** True when a listing's jury score comes from evaluations (admins can't set it by hand). */
export async function hasJuryEvaluations(ctx: QueryCtx, listingId: Id<"listings">) {
  return (
    (await ctx.db
      .query("juryEvaluations")
      .withIndex("by_listing", (q) => q.eq("listingId", listingId))
      .first()) !== null
  );
}
