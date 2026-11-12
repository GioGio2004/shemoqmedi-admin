// Secret claim links for pre-created entities.
//
// An admin pre-creates a jury profile and/or a listing (unclaimed) and copies
// its link, https://www.shemoqmedi.space/claim/<token>, into an outreach DM or
// email. Whoever opens it, signs in and confirms becomes the owner:
//
//   juror token   → the jury profile, plus every unclaimed listing pre-created
//                   for that juror (listings.jurorId): the "bundle"
//   listing token → that listing alone
//
// Tokens are 32 random bytes (64 hex characters), minted only in actions
// (queries and mutations are deterministic), single-use, and moved to
// `claimTokenUsed` on claim so an old link resolves to a redirect instead of an
// error. Claiming a listing also makes its outbound links followed (dofollow).

import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin, requireUser } from "./authHelpers";
import { juryCategory } from "./schema";
import { mediaUrl } from "./lib/media";
import { claimedListingPatch, fail, isPublicStatus } from "./lib/listingHelpers";
import { isClaimedJuror, jurorOf, jurorPhoto } from "./jury";
import { listingPaths, scheduleIndexNow, siteUrl } from "./seo";

/** A claim token: exactly 64 lowercase hex characters (never a valid listing slug, which is at most 60). */
export const CLAIM_TOKEN = /^[a-f0-9]{64}$/;

function newToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const claimUrl = (token: string) => `${siteUrl()}/claim/${token}`;

/** A fresh claim token. Call it in an action and pass the result to a mutation. */
export const newClaimToken = () => newToken();

/**
 * The claim link of an unclaimed listing, storing `freshToken` (minted by the
 * calling action with newClaimToken) on first use; null once it is claimed.
 * For server-side senders (studio emails, the MCP connector) whose caller
 * was already checked.
 */
export async function ensureListingClaimUrl(
  ctx: MutationCtx,
  listingId: Id<"listings">,
  freshToken: string,
): Promise<string | null> {
  const listing = await ctx.db.get(listingId);
  if (!listing || listing.isClaimed || listing.status === "rejected") return null;
  if (listing.claimToken) return claimUrl(listing.claimToken);
  if (!CLAIM_TOKEN.test(freshToken)) fail("Invalid token.");
  await ctx.db.patch(listingId, { claimToken: freshToken, updatedAt: Date.now() });
  return claimUrl(freshToken);
}

const target = v.union(
  v.object({ kind: v.literal("juror"), id: v.id("jurors") }),
  v.object({ kind: v.literal("listing"), id: v.id("listings") }),
);

async function jurorByToken(ctx: QueryCtx, field: "claimToken" | "claimTokenUsed", token: string) {
  return field === "claimToken"
    ? await ctx.db.query("jurors").withIndex("by_claimToken", (q) => q.eq("claimToken", token)).first()
    : await ctx.db.query("jurors").withIndex("by_claimTokenUsed", (q) => q.eq("claimTokenUsed", token)).first();
}

async function listingByToken(ctx: QueryCtx, field: "claimToken" | "claimTokenUsed", token: string) {
  return field === "claimToken"
    ? await ctx.db.query("listings").withIndex("by_claimToken", (q) => q.eq("claimToken", token)).first()
    : await ctx.db.query("listings").withIndex("by_claimTokenUsed", (q) => q.eq("claimTokenUsed", token)).first();
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

/** Stores a freshly minted token (or keeps the current one unless rotating). Returns the live token. */
export const storeToken = internalMutation({
  args: { target, token: v.string(), rotate: v.boolean() },
  returns: v.string(),
  handler: async (ctx, { target, token, rotate }) => {
    await requireAdmin(ctx);
    if (!CLAIM_TOKEN.test(token)) fail("Invalid token.");
    const row = target.kind === "juror" ? await ctx.db.get(target.id) : await ctx.db.get(target.id);
    if (!row) fail(target.kind === "juror" ? "Juror not found." : "Listing not found.");
    const claimed =
      target.kind === "juror" ? isClaimedJuror(row as Doc<"jurors">) : (row as Doc<"listings">).isClaimed;
    if (claimed) fail("This has already been claimed, so it has no claim link.");
    if (row.claimToken && !rotate) return row.claimToken;
    await ctx.db.patch(target.id, { claimToken: token, updatedAt: Date.now() });
    return token;
  },
});

/**
 * Admin: the claim link of an unclaimed juror or listing, minting one on first
 * use. `rotate` replaces it (the old link stops working).
 */
export const link = action({
  args: { target, rotate: v.optional(v.boolean()) },
  returns: v.object({ url: v.string(), token: v.string() }),
  handler: async (ctx, { target, rotate }): Promise<{ url: string; token: string }> => {
    const token: string = await ctx.runMutation(internal.claimLinks.storeToken, {
      target,
      token: newToken(),
      rotate: rotate ?? false,
    });
    return { url: claimUrl(token), token };
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

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Sends a claim link through Resend. Returns an error message, or null when sent. */
async function sendClaimEmail(to: string, name: string, link: string, bundled: number) {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return "RESEND_API_KEY is not set on this Convex deployment. Copy the link and send it yourself.";
  const from = process.env.RESEND_FROM?.trim() || "Shemoqmedi <jury@shemoqmedi.space>";
  const first = name.split(" ")[0];
  const extra = bundled > 0 ? ` Your ${bundled === 1 ? "website is" : "websites are"} already listed and will be claimed with it.` : "";
  const text = [
    `Hi ${first},`,
    "",
    "We'd like you on the founding jury of Shemoqmedi, the website awards platform. Jurors score sites in their voting week on design, usability, creativity and code, and leave a short comment that is shown on each site's page.",
    "",
    `Your jury profile is ready. Open this private link to claim it:${extra}`,
    link,
    "",
    "Shemoqmedi",
  ].join("\n");
  const html = `<div style="font-family:Inter,Arial,sans-serif;color:#000;max-width:520px;line-height:1.6">
<p>Hi ${escapeHtml(first)},</p>
<p>We'd like you on the founding jury of <strong>Shemoqmedi</strong>, the website awards platform. Jurors score sites in their voting week on design, usability, creativity and code, and leave a short comment that is shown on each site's page.</p>
<p>Your jury profile is ready.${escapeHtml(extra)}</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#000;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600;font-size:13px;letter-spacing:.06em;text-transform:uppercase">Claim your jury spot</a></p>
<p style="font-size:12px;color:#555">This link is private and works once.</p>
</div>`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject: "Your Shemoqmedi jury profile", text, html }),
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

/** Admin: email an unclaimed juror their claim link (needs their email on the profile). */
export const emailJuror = action({
  args: { jurorId: v.id("jurors") },
  returns: v.object({ url: v.string(), sent: v.boolean(), error: v.union(v.string(), v.null()) }),
  handler: async (ctx, { jurorId }): Promise<{ url: string; sent: boolean; error: string | null }> => {
    const contact = await ctx.runQuery(internal.claimLinks.jurorContact, { jurorId });
    if (!contact.email) fail("Add the juror's email to their profile first, or copy the link and send it yourself.");
    const token: string = await ctx.runMutation(internal.claimLinks.storeToken, {
      target: { kind: "juror", id: jurorId },
      token: newToken(),
      rotate: false,
    });
    const url = claimUrl(token);
    const error = await sendClaimEmail(contact.email, contact.name, url, contact.bundled);
    return { url, sent: error === null, error };
  },
});

/** Admin: everything still waiting to be claimed, for outreach. */
export const outreach = query({
  args: {},
  returns: v.object({
    jurors: v.array(
      v.object({
        id: v.id("jurors"),
        name: v.string(),
        title: v.string(),
        email: v.union(v.string(), v.null()),
        claimToken: v.union(v.string(), v.null()),
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
        claimToken: v.union(v.string(), v.null()),
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
            claimToken: j.claimToken ?? null,
            listings: (await bundledListings(ctx, j._id)).map((l) => ({ id: l._id, title: l.title })),
            createdAt: j.joinedAt,
          })),
      ),
      listings: listings.map((l) => ({
        id: l._id,
        slug: l.slug,
        title: l.title,
        status: l.status,
        isStartup: l.isStartup ?? false,
        claimToken: l.claimToken ?? null,
        juror: (l.jurorId && jurorName.get(l.jurorId)) || null,
        createdAt: l.createdAt,
      })),
    };
  },
});

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

/** Where a claimed juror or listing lives now (for used links and after claiming). */
function jurorHome(j: Doc<"jurors">) {
  return j.active ? `/jury/${j.slug}` : "/jury";
}
function listingHome(l: Doc<"listings">) {
  return isPublicStatus(l.status) ? `/sites/${l.slug}` : "/account";
}

/**
 * What a claim link points to. "open": claimable (kind juror, bundle or
 * listing, with previews). "claimed": already used (redirect to the claimed
 * profile or listing). "invalid": unknown, rotated or malformed.
 */
export const resolve = query({
  args: { token: v.string() },
  returns: v.object({
    state: v.union(v.literal("open"), v.literal("claimed"), v.literal("invalid")),
    kind: v.union(v.literal("juror"), v.literal("bundle"), v.literal("listing"), v.null()),
    juror: v.union(jurorPreview, v.null()),
    listings: v.array(listingPreview),
    redirect: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { token }) => {
    const none = { juror: null, listings: [], redirect: null };
    if (!CLAIM_TOKEN.test(token)) return { state: "invalid" as const, kind: null, ...none };

    const juror = await jurorByToken(ctx, "claimToken", token);
    if (juror && !isClaimedJuror(juror)) {
      const listings = await bundledListings(ctx, juror._id);
      return {
        state: "open" as const,
        kind: listings.length > 0 ? ("bundle" as const) : ("juror" as const),
        juror: await previewJuror(ctx, juror),
        listings: await Promise.all(listings.map((l) => previewListing(ctx, l))),
        redirect: null,
      };
    }
    const listing = await listingByToken(ctx, "claimToken", token);
    if (listing && !listing.isClaimed) {
      return {
        state: "open" as const,
        kind: "listing" as const,
        juror: null,
        listings: [await previewListing(ctx, listing)],
        redirect: null,
      };
    }
    const usedJuror = await jurorByToken(ctx, "claimTokenUsed", token);
    if (usedJuror) return { state: "claimed" as const, kind: "juror" as const, ...none, redirect: jurorHome(usedJuror) };
    const usedListing = await listingByToken(ctx, "claimTokenUsed", token);
    if (usedListing) {
      return { state: "claimed" as const, kind: "listing" as const, ...none, redirect: listingHome(usedListing) };
    }
    return { state: "invalid" as const, kind: null, ...none };
  },
});

/** Approving a claim (by link or by request) rejects other pending requests for that listing. */
export async function rejectCompetingClaims(ctx: MutationCtx, listingId: Id<"listings">, now: number) {
  const pending = await ctx.db
    .query("claims")
    .withIndex("by_listing", (q) => q.eq("listingId", listingId))
    .collect();
  for (const c of pending) {
    if (c.status === "pending") {
      await ctx.db.patch(c._id, { status: "rejected", reviewNote: "The site was claimed by its owner.", reviewedAt: now });
    }
  }
}

async function claimListing(ctx: MutationCtx, listing: Doc<"listings">, userId: Id<"users">, now: number) {
  await ctx.db.patch(listing._id, claimedListingPatch(listing, userId, now));
  await rejectCompetingClaims(ctx, listing._id, now);
}

/**
 * The signed-in user claims what the link points to. Returns where to go next.
 * Re-opening a link you already used just returns its destination.
 */
export const claim = mutation({
  args: { token: v.string() },
  returns: v.object({
    kind: v.union(v.literal("juror"), v.literal("bundle"), v.literal("listing")),
    redirect: v.string(),
  }),
  handler: async (ctx, { token }) => {
    const user = await requireUser(ctx);
    if (!CLAIM_TOKEN.test(token)) fail("This claim link is not valid.");
    const now = Date.now();

    const juror = await jurorByToken(ctx, "claimToken", token);
    if (juror && !isClaimedJuror(juror)) {
      const existing = await jurorOf(ctx, user._id);
      if (existing && existing._id !== juror._id) {
        fail(`This account already has a jury profile (${existing.name}). Sign in with another account to claim this one.`);
      }
      const listings = await bundledListings(ctx, juror._id);
      await ctx.db.patch(juror._id, {
        userId: user._id,
        status: "claimed",
        claimToken: undefined,
        claimTokenUsed: token,
        claimedAt: now,
        active: true,
        updatedAt: now,
      });
      for (const l of listings) await claimListing(ctx, l, user._id, now);
      const paths: (string | null)[] = ["/jury", `/jury/${juror.slug}`];
      for (const l of listings) if (isPublicStatus(l.status)) paths.push(...(await listingPaths(ctx, l)));
      await scheduleIndexNow(ctx, paths);
      return { kind: listings.length > 0 ? ("bundle" as const) : ("juror" as const), redirect: "/jury/profile?claimed=1" };
    }

    const listing = await listingByToken(ctx, "claimToken", token);
    if (listing && !listing.isClaimed) {
      await claimListing(ctx, listing, user._id, now);
      if (isPublicStatus(listing.status)) await scheduleIndexNow(ctx, await listingPaths(ctx, listing));
      // The account page is rendered per request; the public page is cached
      // and would still show the unclaimed state for up to a minute.
      return { kind: "listing" as const, redirect: "/account?claimed=1" };
    }

    const usedJuror = await jurorByToken(ctx, "claimTokenUsed", token);
    if (usedJuror) {
      if (usedJuror.userId === user._id) return { kind: "juror" as const, redirect: "/jury/profile" };
      fail("This claim link has already been used.");
    }
    const usedListing = await listingByToken(ctx, "claimTokenUsed", token);
    if (usedListing) {
      if (usedListing.ownerId === user._id) return { kind: "listing" as const, redirect: listingHome(usedListing) };
      fail("This claim link has already been used.");
    }
    fail("This claim link is not valid. Ask us for a new one.");
  },
});
