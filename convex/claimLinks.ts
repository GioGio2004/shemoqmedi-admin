// Secret claim links for pre-created entities.
//
// An admin pre-creates a jury profile and/or a listing (unclaimed) and mints
// its link, https://www.shemoqmedi.space/claim/<token>, for an outreach DM or
// email. The invited person opens it, signs in and confirms:
//
//   juror token   → the jury profile, plus every unclaimed listing pre-created
//                   for that juror (listings.jurorId): the "bundle"
//   listing token → that listing alone
//
// Tokens are 32 random bytes (64 hex characters), minted only in actions
// (queries and mutations are deterministic). Only their SHA-256 is stored
// (the claimLinks table), so the raw link exists in one place: the admin's
// screen or the email it was minted for. Links expire after 14 days and work
// once; a used link keeps redirecting its claimer to what they got.
//
// The link alone is not proof: when the invitation has an email (the juror's
// profile email, or the address a studio email went to), the account that
// claims must have that email. A juror claimed with no email to check stays
// off the public jury until an admin activates it (activateJuror). Claiming a
// listing also makes its outbound links followed (dofollow). Admins can take
// a claim back (unclaim) to hand the profile or listing to someone else.

import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin, requireUser } from "./authHelpers";
import { juryCategory, juryEducation, juryExperience, juryWork } from "./schema";
import { mediaUrl } from "./lib/media";
import {
  claimIntent,
  claimedListingPatch,
  fail,
  giveCreatorProfile,
  isPublicStatus,
  releaseCreatorProfile,
} from "./lib/listingHelpers";
import { DAY_MS } from "./lib/time";
import { audit } from "./lib/awards";
import { isClaimedJuror, isPublicJuror, jurorOf, jurorPhoto } from "./jury";
import { listingPaths, scheduleIndexNow, siteUrl } from "./seo";
import { claimLinkStatus, linkStatus, revokeClaimLinks, type Target } from "./lib/claimLinkRows";
import { rateLimit } from "./lib/rateLimit";
import { deliver, type Message } from "./emails";

/** A claim token: exactly 64 lowercase hex characters (never a valid listing slug, which is at most 60). */
export const CLAIM_TOKEN = /^[a-f0-9]{64}$/;

/** How long a claim link works after it is minted. */
export const CLAIM_LINK_TTL = 14 * DAY_MS;

function newToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** What is stored for a token: its SHA-256, hex. */
export async function hashClaimToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const claimUrl = (token: string) => `${siteUrl()}/claim/${token}`;

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** "ana.beridze@gmail.com" → "an•••@gmail.com": enough to pick the right account, not enough to harvest. */
function maskEmail(email: string) {
  const [local, domain] = email.trim().toLowerCase().split("@");
  if (!local || !domain) return null;
  return `${local.slice(0, local.length > 2 ? 2 : 1)}•••@${domain}`;
}

/** A fresh claim token. Call it in an action and pass the result to a mutation. */
export const newClaimToken = () => newToken();

const target = v.union(
  v.object({ kind: v.literal("juror"), id: v.id("jurors") }),
  v.object({ kind: v.literal("listing"), id: v.id("listings") }),
);

/** Stores the hash of a new link for a target. Returns the row and when it expires. */
async function mintLink(
  ctx: MutationCtx,
  t: Target,
  token: string,
  opts: { email?: string; createdBy?: Id<"users">; now?: number } = {},
) {
  if (!CLAIM_TOKEN.test(token)) fail("Invalid token.");
  const now = opts.now ?? Date.now();
  const expiresAt = now + CLAIM_LINK_TTL;
  const id = await ctx.db.insert("claimLinks", {
    tokenHash: await hashClaimToken(token),
    ...(t.kind === "juror" ? { jurorId: t.id } : { listingId: t.id }),
    email: opts.email?.trim() ? opts.email.trim().toLowerCase() : undefined,
    createdBy: opts.createdBy,
    createdAt: now,
    expiresAt,
  });
  return { id, expiresAt };
}

/**
 * A new claim link for an unclaimed listing, from `freshToken` (minted by the
 * calling action with newClaimToken), bound to `email` when the link is about
 * to be emailed there; null once the listing is claimed. For server-side
 * senders (studio emails, the MCP connector) whose caller was already
 * checked. Every call makes a new link; earlier ones keep working until they
 * expire, so a link already sent is never broken by a later one.
 */
export async function ensureListingClaimUrl(
  ctx: MutationCtx,
  listingId: Id<"listings">,
  freshToken: string,
  email?: string,
): Promise<string | null> {
  const listing = await ctx.db.get(listingId);
  if (!listing || listing.isClaimed || listing.status === "rejected") return null;
  await mintLink(ctx, { kind: "listing", id: listingId }, freshToken, { email });
  return claimUrl(freshToken);
}

/** Unclaimed listings pre-created for a juror: claimed together with the profile. */
async function bundledListings(ctx: QueryCtx, jurorId: Id<"jurors">) {
  const rows = await ctx.db
    .query("listings")
    .withIndex("by_juror", (q) => q.eq("jurorId", jurorId))
    .take(50);
  return rows.filter((l) => !l.isClaimed && l.status !== "rejected");
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: minting links
// ─────────────────────────────────────────────────────────────────────────────

/** Stores a freshly minted token for an unclaimed target (revoking every older link when rotating). */
export const storeToken = internalMutation({
  args: { target, token: v.string(), rotate: v.boolean() },
  returns: v.object({ expiresAt: v.number() }),
  handler: async (ctx, { target, token, rotate }) => {
    const admin = await requireAdmin(ctx);
    const row = target.kind === "juror" ? await ctx.db.get(target.id) : await ctx.db.get(target.id);
    if (!row) fail(target.kind === "juror" ? "Juror not found." : "Listing not found.");
    const claimed =
      target.kind === "juror" ? isClaimedJuror(row as Doc<"jurors">) : (row as Doc<"listings">).isClaimed;
    if (claimed) fail("This has already been claimed, so it has no claim link.");
    if (rotate) {
      await revokeClaimLinks(ctx, target, Date.now());
      // A legacy plaintext link dies with the rest.
      if (row.claimToken) await ctx.db.patch(target.id, { claimToken: undefined });
    }
    const { expiresAt } = await mintLink(ctx, target, token, { createdBy: admin._id });
    return { expiresAt };
  },
});

/**
 * Admin: a new claim link for an unclaimed juror or listing. The URL is in
 * this result only and can't be read back later (only its hash is stored),
 * so it is copied now. Earlier links keep working until they expire, unless
 * `rotate` kills them first.
 */
export const link = action({
  args: { target, rotate: v.optional(v.boolean()) },
  returns: v.object({ url: v.string(), token: v.string(), expiresAt: v.number() }),
  handler: async (ctx, { target, rotate }): Promise<{ url: string; token: string; expiresAt: number }> => {
    const token = newToken();
    const { expiresAt }: { expiresAt: number } = await ctx.runMutation(internal.claimLinks.storeToken, {
      target,
      token,
      rotate: rotate ?? false,
    });
    return { url: claimUrl(token), token, expiresAt };
  },
});

export const jurorContact = internalQuery({
  args: { jurorId: v.id("jurors") },
  returns: v.object({ email: v.union(v.string(), v.null()), name: v.string(), bundled: v.number() }),
  handler: async (ctx, { jurorId }) => {
    await requireAdmin(ctx);
    const juror = await ctx.db.get(jurorId);
    if (!juror) fail("Juror not found.");
    return { email: juror.email ?? null, name: juror.name, bundled: (await bundledListings(ctx, jurorId)).length };
  },
});

/**
 * The juror's claim email, sent through emails.deliver like every other
 * email (audit J-05): unsubscribe link and header, opt-outs respected, and a
 * row in the email log. The log keeps the subject only, never the link.
 */
function claimEmail(to: string, name: string, link: string, bundled: number): Message {
  const first = name.split(" ")[0];
  const extra = bundled > 0 ? ` Your ${bundled === 1 ? "website is" : "websites are"} already listed and will be claimed with it.` : "";
  return {
    subject: "Your Shemoqmedi jury profile",
    text: [
      `Hi ${first},`,
      "We'd like you on the founding jury of Shemoqmedi, the website awards platform. Jurors score sites in their voting week on design, usability, creativity and content, and leave a short comment that is shown on each site's page.",
      `Your jury profile is ready. Open the private link below to claim it.${extra}`,
      `Sign in with this address (${to}) to claim it. The link works once and expires in 14 days.`,
    ].join("\n\n"),
    button: { label: "Claim your jury spot", href: link },
    eyebrow: "Founding jury invitation",
    preheader: "Your jury profile is ready to claim.",
    footerNote: "You get this because we invited you to the Shemoqmedi jury.",
  };
}

/** Admin: email an unclaimed juror a new claim link (needs their email on the profile). */
export const emailJuror = action({
  args: { jurorId: v.id("jurors") },
  returns: v.object({ url: v.string(), sent: v.boolean(), error: v.union(v.string(), v.null()) }),
  handler: async (ctx, { jurorId }): Promise<{ url: string; sent: boolean; error: string | null }> => {
    const contact = await ctx.runQuery(internal.claimLinks.jurorContact, { jurorId });
    if (!contact.email) fail("Add the juror's email to their profile first, or copy the link and send it yourself.");
    const token = newToken();
    await ctx.runMutation(internal.claimLinks.storeToken, { target: { kind: "juror", id: jurorId }, token, rotate: false });
    const url = claimUrl(token);
    const delivery = await deliver(ctx, contact.email, claimEmail(contact.email, contact.name, url, contact.bundled), { kind: "outreach" });
    const error = delivery.status === "sent" ? null : (delivery.error ?? "Not sent.");
    return { url, sent: error === null, error: error && `${error} Copy the link and send it yourself.` };
  },
});

/** Admin: everything still waiting to be claimed, for outreach. Link status only, never a link. */
export const outreach = query({
  args: {},
  returns: v.object({
    jurors: v.array(
      v.object({
        id: v.id("jurors"),
        name: v.string(),
        title: v.string(),
        email: v.union(v.string(), v.null()),
        claimLink: claimLinkStatus,
        listings: v.array(v.object({ id: v.id("listings"), title: v.string() })),
        createdAt: v.number(),
      }),
    ),
    listings: v.array(
      v.object({
        id: v.id("listings"),
        slug: v.string(),
        title: v.string(),
        status: v.string(),
        isStartup: v.boolean(),
        claimLink: claimLinkStatus,
        juror: v.union(v.string(), v.null()), // bundled with this (unclaimed) juror
        createdAt: v.number(),
      }),
    ),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const jurors = (await ctx.db.query("jurors").take(500)).filter((j) => !isClaimedJuror(j));
    const listings = (await ctx.db.query("listings").order("desc").take(1000)).filter(
      (l) => !l.isClaimed && l.status !== "rejected",
    );
    const jurorName = new Map(jurors.map((j) => [j._id, j.name]));
    return {
      jurors: await Promise.all(
        jurors
          .sort((a, b) => b.joinedAt - a.joinedAt)
          .map(async (j) => ({
            id: j._id,
            name: j.name,
            title: j.title,
            email: j.email ?? null,
            claimLink: await linkStatus(ctx, { kind: "juror", id: j._id }, j),
            listings: (await bundledListings(ctx, j._id)).map((l) => ({ id: l._id, title: l.title })),
            createdAt: j.joinedAt,
          })),
      ),
      listings: await Promise.all(
        listings.map(async (l) => ({
          id: l._id,
          slug: l.slug,
          title: l.title,
          status: l.status,
          isStartup: l.isStartup ?? false,
          claimLink: await linkStatus(ctx, { kind: "listing", id: l._id }, l),
          juror: (l.jurorId && jurorName.get(l.jurorId)) || null,
          createdAt: l.createdAt,
        })),
      ),
    };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// What a link points to, and whether it can still be used
// ─────────────────────────────────────────────────────────────────────────────

/** A link row, or a legacy plaintext token read off the juror/listing itself (id null). */
type FoundLink = {
  id: Id<"claimLinks"> | null;
  target: Target;
  email?: string;
  expiresAt: number | null; // null: legacy, no expiry until the migration gives it one
  usedBy?: Id<"users">;
  revoked: boolean;
};

async function findLink(ctx: QueryCtx, token: string): Promise<FoundLink | null> {
  const tokenHash = await hashClaimToken(token);
  const row = await ctx.db
    .query("claimLinks")
    .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
    .first();
  if (row) {
    const t: Target | null = row.jurorId
      ? { kind: "juror", id: row.jurorId }
      : row.listingId
        ? { kind: "listing", id: row.listingId }
        : null;
    if (!t) return null;
    return { id: row._id, target: t, email: row.email, expiresAt: row.expiresAt, usedBy: row.usedBy, revoked: !!row.revokedAt };
  }

  // Legacy plaintext tokens, read until migrations:hashClaimTokens has moved them.
  const juror = await ctx.db.query("jurors").withIndex("by_claimToken", (q) => q.eq("claimToken", token)).first();
  if (juror) return { id: null, target: { kind: "juror", id: juror._id }, expiresAt: null, revoked: false };
  const listing = await ctx.db.query("listings").withIndex("by_claimToken", (q) => q.eq("claimToken", token)).first();
  if (listing) return { id: null, target: { kind: "listing", id: listing._id }, expiresAt: null, revoked: false };
  const usedJuror = await ctx.db
    .query("jurors")
    .withIndex("by_claimTokenUsed", (q) => q.eq("claimTokenUsed", token))
    .first();
  if (usedJuror) {
    const usedBy = usedJuror.userId;
    return { id: null, target: { kind: "juror", id: usedJuror._id }, expiresAt: null, usedBy, revoked: !usedBy };
  }
  const usedListing = await ctx.db
    .query("listings")
    .withIndex("by_claimTokenUsed", (q) => q.eq("claimTokenUsed", token))
    .first();
  if (usedListing) {
    const usedBy = usedListing.ownerId;
    return { id: null, target: { kind: "listing", id: usedListing._id }, expiresAt: null, usedBy, revoked: !usedBy };
  }
  return null;
}

/** Where a claimed juror or listing lives now (for used links and after claiming). */
function jurorHome(j: Doc<"jurors">) {
  return j.active ? `/jury/${j.slug}` : "/jury";
}
function listingHome(l: Doc<"listings">) {
  return isPublicStatus(l.status) ? `/sites/${l.slug}` : "/account";
}

type Inspection =
  | { state: "invalid" }
  | { state: "expired" }
  | { state: "claimed"; kind: "juror" | "listing"; redirect: string; ownerId: Id<"users"> | null; juror: Doc<"jurors"> | null }
  | {
      state: "open";
      kind: "juror" | "bundle" | "listing";
      juror: Doc<"jurors"> | null;
      listings: Doc<"listings">[];
      invitedEmail: string | null;
    };

async function inspect(ctx: QueryCtx, link: FoundLink, now: number): Promise<Inspection> {
  if (link.revoked) return { state: "invalid" };
  const expired = link.expiresAt !== null && link.expiresAt <= now;

  if (link.target.kind === "juror") {
    const juror = await ctx.db.get(link.target.id);
    if (!juror) return { state: "invalid" };
    if (isClaimedJuror(juror)) {
      // Taken back by an admin and claimed again since: this link is dead.
      if (link.usedBy && link.usedBy !== juror.userId) return { state: "invalid" };
      return { state: "claimed", kind: "juror", redirect: jurorHome(juror), ownerId: juror.userId ?? null, juror };
    }
    // Used, then an admin took the claim back: a new owner needs a new link.
    if (link.usedBy) return { state: "invalid" };
    if (expired) return { state: "expired" };
    const listings = await bundledListings(ctx, juror._id);
    return {
      state: "open",
      kind: listings.length > 0 ? "bundle" : "juror",
      juror,
      listings,
      invitedEmail: juror.email ?? null,
    };
  }

  const listing = await ctx.db.get(link.target.id);
  if (!listing) return { state: "invalid" };
  if (listing.isClaimed) {
    if (link.usedBy && link.usedBy !== listing.ownerId) return { state: "invalid" };
    return { state: "claimed", kind: "listing", redirect: listingHome(listing), ownerId: listing.ownerId ?? null, juror: null };
  }
  if (link.usedBy) return { state: "invalid" };
  if (expired) return { state: "expired" };
  return { state: "open", kind: "listing", juror: null, listings: [listing], invitedEmail: link.email ?? null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public: the /claim/<token> page
// ─────────────────────────────────────────────────────────────────────────────

const jurorPreview = v.object({
  name: v.string(),
  title: v.string(),
  category: v.union(juryCategory, v.null()),
  location: v.union(v.string(), v.null()),
  bio: v.union(v.string(), v.null()),
  website: v.union(v.string(), v.null()), // null: render no website link at all
  linkedinUrl: v.union(v.string(), v.null()),
  isFounding: v.boolean(),
  imageUrl: v.union(v.string(), v.null()),
  // The full profile as it will look on /jury/<slug>, shown before claiming.
  experience: v.array(juryExperience),
  education: v.array(juryEducation),
  work: v.array(juryWork),
});

const listingPreview = v.object({
  slug: v.string(),
  title: v.string(),
  tagline: v.string(),
  url: v.string(),
  creditName: v.string(),
  coverUrl: v.union(v.string(), v.null()),
  isPublic: v.boolean(), // has a /sites/<slug> page yet
  isStartup: v.boolean(),
});

async function previewJuror(ctx: QueryCtx, j: Doc<"jurors">) {
  return {
    name: j.name,
    title: j.title,
    category: j.category ?? null,
    location: j.location ?? null,
    bio: j.bio ?? null,
    website: j.website ?? null,
    linkedinUrl: j.linkedinUrl ?? null,
    experience: j.experience ?? [],
    education: j.education ?? [],
    work: j.work ?? [],
    isFounding: j.isFounding ?? false,
    imageUrl: await jurorPhoto(ctx, j),
  };
}

async function previewListing(ctx: QueryCtx, l: Doc<"listings">) {
  return {
    slug: l.slug,
    title: l.title,
    tagline: l.tagline,
    url: l.url,
    creditName: l.creditName,
    coverUrl: await mediaUrl(ctx, l.coverId),
    isPublic: isPublicStatus(l.status),
    isStartup: l.isStartup ?? false,
  };
}

/**
 * What a claim link points to. "open": claimable (kind juror, bundle or
 * listing, with previews, and a masked hint of the invited email when there
 * is one). "claimed": already used (redirect to the claimed profile or
 * listing). "expired": older than 14 days. "invalid": unknown, rotated,
 * revoked or malformed.
 */
export const resolve = query({
  args: { token: v.string() },
  returns: v.object({
    state: v.union(v.literal("open"), v.literal("claimed"), v.literal("expired"), v.literal("invalid")),
    kind: v.union(v.literal("juror"), v.literal("bundle"), v.literal("listing"), v.null()),
    juror: v.union(jurorPreview, v.null()),
    listings: v.array(listingPreview),
    redirect: v.union(v.string(), v.null()),
    emailHint: v.union(v.string(), v.null()), // "an•••@gmail.com": sign in with this address
  }),
  handler: async (ctx, { token }) => {
    const none = { kind: null, juror: null, listings: [], redirect: null, emailHint: null };
    if (!CLAIM_TOKEN.test(token)) return { ...none, state: "invalid" as const };
    const link = await findLink(ctx, token);
    if (!link) return { ...none, state: "invalid" as const };
    const seen = await inspect(ctx, link, Date.now());
    if (seen.state === "invalid" || seen.state === "expired") return { ...none, state: seen.state };
    if (seen.state === "claimed") return { ...none, state: "claimed" as const, kind: seen.kind, redirect: seen.redirect };
    return {
      state: "open" as const,
      kind: seen.kind,
      juror: seen.juror ? await previewJuror(ctx, seen.juror) : null,
      listings: await Promise.all(seen.listings.map((l) => previewListing(ctx, l))),
      redirect: null,
      emailHint: seen.invitedEmail ? maskEmail(seen.invitedEmail) : null,
    };
  },
});

/**
 * Approving a claim (by link or by request) rejects other pending ownership
 * claims for that listing. Removal requests stay open: someone asking for
 * the site to come down still deserves an answer once it has an owner.
 */
export async function rejectCompetingClaims(ctx: MutationCtx, listingId: Id<"listings">, now: number) {
  const pending = await ctx.db
    .query("claims")
    .withIndex("by_listing", (q) => q.eq("listingId", listingId))
    .collect();
  for (const c of pending) {
    if (c.status === "pending" && claimIntent(c) === "claim") {
      await ctx.db.patch(c._id, { status: "rejected", reviewNote: "The site was claimed by its owner.", reviewedAt: now });
    }
  }
}

async function claimListing(
  ctx: MutationCtx,
  listing: Doc<"listings">,
  userId: Id<"users">,
  now: number,
  keep?: Id<"claimLinks">,
) {
  await ctx.db.patch(listing._id, claimedListingPatch(listing, userId, now));
  await rejectCompetingClaims(ctx, listing._id, now);
  await revokeClaimLinks(ctx, { kind: "listing", id: listing._id }, now, keep);
}

const PENDING_REDIRECT = "/account?jury=pending";

/**
 * The signed-in user claims what the link points to. Returns where to go
 * next; `pending` when the jury profile waits for an admin to activate it.
 * Re-opening a link you already used just returns its destination.
 */
export const claim = mutation({
  args: { token: v.string() },
  returns: v.object({
    kind: v.union(v.literal("juror"), v.literal("bundle"), v.literal("listing")),
    redirect: v.string(),
    pending: v.boolean(),
  }),
  handler: async (ctx, { token }) => {
    const user = await requireUser(ctx);
    await rateLimit(ctx, "claimLink", user);
    if (!CLAIM_TOKEN.test(token)) fail("This claim link is not valid.");
    const now = Date.now();
    const link = await findLink(ctx, token);
    if (!link) fail("This claim link is not valid. Ask us for a new one.");
    const seen = await inspect(ctx, link, now);

    if (seen.state === "invalid") fail("This claim link is not valid. Ask us for a new one.");
    if (seen.state === "expired") fail("This claim link has expired: links work for 14 days. Ask us for a new one.");
    if (seen.state === "claimed") {
      if (seen.ownerId !== user._id) {
        fail("This claim link has already been used by another account. If that wasn't you, contact us.");
      }
      if (seen.juror?.claimPending) return { kind: "juror" as const, redirect: PENDING_REDIRECT, pending: true };
      return { kind: seen.kind, redirect: seen.kind === "juror" ? "/jury/profile" : seen.redirect, pending: false };
    }

    // Bound to the invited address: the link alone could have been forwarded.
    if (seen.invitedEmail && !sameEmail(seen.invitedEmail, user.email)) {
      fail(
        `This invitation was sent to a different email address. You're signed in as ${user.email}. ` +
          "Sign out and sign in with the address the invitation was sent to.",
      );
    }
    if (seen.juror) {
      const existing = await jurorOf(ctx, user._id);
      if (existing && existing._id !== seen.juror._id) {
        fail(`This account already has a jury profile (${existing.name}). Sign in with another account to claim this one.`);
      }
    }

    // A legacy plaintext link becomes a hashed row now, so it is burned like any other.
    let linkId = link.id;
    if (!linkId) {
      linkId = (await mintLink(ctx, link.target, token, { now })).id;
      await ctx.db.patch(link.target.id, { claimToken: undefined });
    }
    await ctx.db.patch(linkId, { usedBy: user._id, usedAt: now });

    if (seen.juror) {
      const juror = seen.juror;
      // Public at once only when the account's email matched the invitation.
      const verified = seen.invitedEmail !== null;
      await ctx.db.patch(juror._id, {
        userId: user._id,
        status: "claimed",
        claimedAt: now,
        active: verified,
        claimPending: verified ? undefined : true,
        updatedAt: now,
      });
      await revokeClaimLinks(ctx, { kind: "juror", id: juror._id }, now, linkId);
      for (const l of seen.listings) await claimListing(ctx, l, user._id, now);
      const paths: (string | null)[] = verified ? ["/jury", `/jury/${juror.slug}`] : [];
      for (const l of seen.listings) if (isPublicStatus(l.status)) paths.push(...(await listingPaths(ctx, l)));
      if (paths.length > 0) await scheduleIndexNow(ctx, paths);
      const kind = seen.listings.length > 0 ? ("bundle" as const) : ("juror" as const);
      return verified
        ? { kind, redirect: "/jury/profile?claimed=1", pending: false }
        : { kind, redirect: PENDING_REDIRECT, pending: true };
    }

    const listing = seen.listings[0];
    await claimListing(ctx, listing, user._id, now, linkId);
    if (isPublicStatus(listing.status)) await scheduleIndexNow(ctx, await listingPaths(ctx, listing));
    // The account page is rendered per request; the public page is cached
    // and would still show the unclaimed state for up to a minute.
    return { kind: "listing" as const, redirect: "/account?claimed=1", pending: false };
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin: activating and taking back claims
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Admin: put a juror who claimed without an email check (no email on the
 * profile) on the public jury, after checking it is really them.
 */
export const activateJuror = mutation({
  args: { jurorId: v.id("jurors") },
  returns: v.null(),
  handler: async (ctx, { jurorId }) => {
    const admin = await requireAdmin(ctx);
    const juror = await ctx.db.get(jurorId);
    if (!juror) fail("Juror not found.");
    if (!isClaimedJuror(juror)) fail("Nobody has claimed this profile yet.");
    await ctx.db.patch(jurorId, { active: true, claimPending: undefined, updatedAt: Date.now() });
    await audit(ctx, { kind: "juror_activated", actorId: admin._id, details: { jurorId, userId: juror.userId ?? null } });
    await scheduleIndexNow(ctx, ["/jury", `/jury/${juror.slug}`]);
    return null;
  },
});

/** Takes a listing from its owner: unowned, unclaimed, nofollow again, open links killed, logged. */
async function unclaimListing(
  ctx: MutationCtx,
  listing: Doc<"listings">,
  adminId: Id<"users">,
  now: number,
  reason?: string,
) {
  await ctx.db.patch(listing._id, {
    ownerId: undefined,
    isClaimed: false,
    // Back to automatic: nofollow while unclaimed.
    isDoFollow: undefined,
    claimToken: undefined,
    updatedAt: now,
  });
  await revokeClaimLinks(ctx, { kind: "listing", id: listing._id }, now);
  // Their creator profile goes with it, unless they own another site credited to it.
  await releaseCreatorProfile(ctx, listing, listing.ownerId, now);
  await audit(ctx, {
    kind: "unclaimed",
    listingId: listing._id,
    actorId: adminId,
    reason,
    details: { target: "listing", previousOwner: listing.ownerId ?? null },
  });
  if (isPublicStatus(listing.status)) await scheduleIndexNow(ctx, await listingPaths(ctx, listing));
}

/**
 * Admin: make an account a listing's owner directly, with no claim link: the
 * same result as the person claiming it (owned, claimed, followed links, open
 * claim links and competing claim requests closed). Replaces a current owner.
 * The listing's creator profile ("Made by", /creators/<slug>) goes to the owner
 * too, unless another account holds it; assigning the same owner again hands
 * over a profile left behind. `userId: null` takes the listing (and that
 * profile) from its owner, as `unclaim`. Logged to the audit log either way.
 */
export const setListingOwner = mutation({
  args: { listingId: v.id("listings"), userId: v.union(v.id("users"), v.null()), reason: v.optional(v.string()) },
  returns: v.object({
    owner: v.union(v.object({ id: v.id("users"), name: v.string(), email: v.string() }), v.null()),
    /** The listing's creator profile now belongs to the owner. */
    creatorProfile: v.boolean(),
  }),
  handler: async (ctx, { listingId, userId, reason }) => {
    const admin = await requireAdmin(ctx);
    const now = Date.now();
    const why = reason?.trim().slice(0, 500) || undefined;
    const listing = await ctx.db.get(listingId);
    if (!listing) fail("Listing not found.");
    if (userId === null) {
      if (listing.isClaimed || listing.ownerId) await unclaimListing(ctx, listing, admin._id, now, why);
      return { owner: null, creatorProfile: false };
    }
    const user = await ctx.db.get(userId);
    if (!user) fail("That account no longer exists.");
    const owner = { id: user._id, name: user.name, email: user.email };
    const creatorBefore = listing.creatorId ? await ctx.db.get(listing.creatorId) : null;
    if (listing.ownerId === userId && listing.isClaimed) {
      // Already the owner: only hand over a creator profile left behind
      // (listings assigned before profiles moved with them).
      const creatorProfile = await giveCreatorProfile(ctx, listing, userId, undefined, now);
      if (creatorProfile && creatorBefore && creatorBefore.claimedBy !== userId) {
        await audit(ctx, {
          kind: "owner_assigned",
          listingId,
          actorId: admin._id,
          reason: why,
          details: { previousOwner: userId, owner: userId, creator: creatorBefore._id },
        });
        if (isPublicStatus(listing.status)) await scheduleIndexNow(ctx, [`/creators/${creatorBefore.slug}`]);
      }
      return { owner, creatorProfile };
    }
    await claimListing(ctx, listing, userId, now);
    const creatorProfile = await giveCreatorProfile(ctx, listing, userId, listing.ownerId, now);
    await audit(ctx, {
      kind: "owner_assigned",
      listingId,
      actorId: admin._id,
      reason: why,
      details: {
        previousOwner: listing.ownerId ?? null,
        owner: userId,
        ...(creatorProfile && creatorBefore ? { creator: creatorBefore._id } : {}),
      },
    });
    if (isPublicStatus(listing.status)) await scheduleIndexNow(ctx, await listingPaths(ctx, listing));
    return { owner, creatorProfile };
  },
});

/**
 * Admin: accounts to pick a listing's owner from, matched on name or email
 * (two characters or more), with how many listings each already owns.
 */
export const ownerCandidates = query({
  args: { search: v.string() },
  returns: v.array(v.object({ id: v.id("users"), name: v.string(), email: v.string(), listings: v.number() })),
  handler: async (ctx, { search }) => {
    await requireAdmin(ctx);
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    const exact = q.includes("@")
      ? await ctx.db
          .query("users")
          .withIndex("byEmail", (i) => i.eq("email", q))
          .take(1)
      : [];
    const recent = await ctx.db.query("users").order("desc").take(2000);
    const seen = new Set<string>();
    const hits: Doc<"users">[] = [];
    for (const u of [...exact, ...recent]) {
      if (seen.has(u._id)) continue;
      seen.add(u._id);
      if (u.email.toLowerCase().includes(q) || u.name.toLowerCase().includes(q)) hits.push(u);
      if (hits.length >= 8) break;
    }
    return await Promise.all(
      hits.map(async (u) => ({
        id: u._id,
        name: u.name,
        email: u.email,
        listings: (
          await ctx.db
            .query("listings")
            .withIndex("by_owner", (i) => i.eq("ownerId", u._id))
            .take(100)
        ).length,
      })),
    );
  },
});

/**
 * Admin: take a listing or jury profile back from whoever claimed it (a
 * wrong account, or to transfer it). Clears the owner, not just the claimed
 * flag, kills open links, and logs it to the audit log. Mint a new claim
 * link to hand it to the right person. A juror's evaluations stay with the
 * profile.
 */
export const unclaim = mutation({
  args: { target, reason: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { target, reason }) => {
    const admin = await requireAdmin(ctx);
    const now = Date.now();
    const why = reason?.trim().slice(0, 500) || undefined;
    if (target.kind === "listing") {
      const listing = await ctx.db.get(target.id);
      if (!listing) fail("Listing not found.");
      if (!listing.isClaimed && !listing.ownerId) fail("This listing isn't claimed.");
      await unclaimListing(ctx, listing, admin._id, now, why);
      return null;
    }

    const juror = await ctx.db.get(target.id);
    if (!juror) fail("Juror not found.");
    if (!isClaimedJuror(juror)) fail("This jury profile isn't claimed.");
    await ctx.db.patch(juror._id, {
      userId: undefined,
      status: "unclaimed",
      claimedAt: undefined,
      claimPending: undefined,
      // Unclaimed profiles are private whatever this says; true is how new ones start.
      active: true,
      claimToken: undefined,
      updatedAt: now,
    });
    await revokeClaimLinks(ctx, target, now);
    await audit(ctx, {
      kind: "unclaimed",
      actorId: admin._id,
      reason: why,
      details: { target: "juror", jurorId: juror._id, previousUser: juror.userId ?? null },
    });
    if (isPublicJuror(juror)) await scheduleIndexNow(ctx, ["/jury", `/jury/${juror.slug}`]);
    return null;
  },
});
