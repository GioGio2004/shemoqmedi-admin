// The agent desk. Giorgi hands listings (or new sites) to his AI agent; the
// agent researches each site and drafts its copy over MCP (convex/mcp.ts);
// a draft changes the listing only when Giorgi approves it, here in the admin
// or by saying yes in chat. Every applied change is a revision that can be
// undone (lib/revisions.ts).
//
// Brief lifecycle: queued → drafted → approved, with "send back" (drafted →
// queued, with his feedback) and cancel. A brief for a new site has no
// listing: once approved, Giorgi adds its screenshots on /listings/new?brief=…
// and the new listing is linked to the brief.

import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireAdmin } from "./authHelpers";
import { applyListingEdit } from "./admin";
import { briefStatus, creatorTier, region } from "./schema";
import { LIMITS } from "./lib/taxonomy";
import {
  checkCategories,
  checkTechnologies,
  cleanParagraphs,
  cleanText,
  fail,
  normalizeUrl,
} from "./lib/listingHelpers";
import { domainKey, listingsOnDomain } from "./lib/domains";
import { COPY_KEYS, copyOf, diffCopy, type ListingCopy } from "./lib/revisions";
import { writeupProblems, wordCount } from "./lib/editorial";
import { pushAdmins } from "./push";
import { adminUrl } from "../lib/hosts";
import { siteUrl } from "./seo";

type Ctx = QueryCtx | MutationCtx;
type Brief = Doc<"listingBriefs">;

const OPEN: Brief["status"][] = ["queued", "drafted"];

// ─────────────────────────────────────────────────────────────────────────────
// Views
// ─────────────────────────────────────────────────────────────────────────────

export const copyView = v.object({
  title: v.optional(v.string()),
  tagline: v.optional(v.string()),
  writeup: v.optional(v.string()),
  categories: v.optional(v.array(v.string())),
  technologies: v.optional(v.array(v.string())),
  region: v.optional(region),
  creatorTier: v.optional(creatorTier),
  creditName: v.optional(v.string()),
  creditUrl: v.optional(v.string()),
});

export const briefView = v.object({
  id: v.id("listingBriefs"),
  status: briefStatus,
  url: v.string(),
  note: v.union(v.string(), v.null()),
  feedback: v.union(v.string(), v.null()),
  rounds: v.number(),
  listing: v.union(
    v.object({
      id: v.id("listings"),
      slug: v.string(),
      title: v.string(),
      status: v.string(),
      pageUrl: v.string(),
    }),
    v.null(),
  ),
  /** The listing's copy now (null for a new site). */
  current: v.union(copyView, v.null()),
  draft: v.union(copyView, v.null()),
  /** Fields the draft would change: [field, before, after]. */
  changes: v.array(v.object({ field: v.string(), before: v.any(), after: v.any() })),
  writeupWords: v.union(v.number(), v.null()),
  sources: v.array(v.string()),
  agentNote: v.union(v.string(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
  draftedAt: v.union(v.number(), v.null()),
  decidedAt: v.union(v.number(), v.null()),
});

export async function viewBrief(ctx: Ctx, brief: Brief) {
  const listing = brief.listingId ? await ctx.db.get(brief.listingId) : null;
  const current = listing ? copyOf(listing) : null;
  const draft = brief.draft ?? null;
  const changes =
    draft && current
      ? (() => {
          const d = diffCopy(current, { ...current, ...draft } as Required<ListingCopy>);
          return d.changed.map((field) => ({ field, before: d.before[field], after: d.after[field] }));
        })()
      : draft
        ? COPY_KEYS.filter((k) => draft[k] !== undefined).map((field) => ({ field, before: null, after: draft[field] }))
        : [];
  return {
    id: brief._id,
    status: brief.status,
    url: brief.url,
    note: brief.note ?? null,
    feedback: brief.feedback ?? null,
    rounds: brief.rounds,
    listing: listing
      ? {
          id: listing._id,
          slug: listing.slug,
          title: listing.title,
          status: listing.status,
          pageUrl: `${siteUrl()}/sites/${listing.slug}`,
        }
      : null,
    current,
    draft,
    changes,
    writeupWords: draft?.writeup ? wordCount(draft.writeup) : null,
    sources: brief.sources ?? [],
    agentNote: brief.agentNote ?? null,
    createdAt: brief.createdAt,
    updatedAt: brief.updatedAt,
    draftedAt: brief.draftedAt ?? null,
    decidedAt: brief.decidedAt ?? null,
  };
}

export const revisionView = v.object({
  id: v.id("listingRevisions"),
  source: v.union(v.literal("agent"), v.literal("admin"), v.literal("undo")),
  fields: v.array(v.string()),
  before: copyView,
  after: copyView,
  createdAt: v.number(),
  undoneAt: v.union(v.number(), v.null()),
});

function viewRevision(r: Doc<"listingRevisions">) {
  return {
    id: r._id,
    source: r.source,
    fields: Object.keys(r.after),
    before: r.before,
    after: r.after,
    createdAt: r.createdAt,
    undoneAt: r.undoneAt ?? null,
  };
}

export async function revisionsOf(ctx: Ctx, listingId: Id<"listings">, limit = 20) {
  const rows = await ctx.db
    .query("listingRevisions")
    .withIndex("by_listing", (q) => q.eq("listingId", listingId))
    .order("desc")
    .take(limit);
  return rows.map(viewRevision);
}

// ─────────────────────────────────────────────────────────────────────────────
// The desk's operations (shared by the admin and the MCP tools)
// ─────────────────────────────────────────────────────────────────────────────

async function openBriefFor(ctx: Ctx, listingId: Id<"listings">) {
  const rows = await ctx.db
    .query("listingBriefs")
    .withIndex("by_listing", (q) => q.eq("listingId", listingId))
    .order("desc")
    .take(20);
  return rows.find((b) => OPEN.includes(b.status)) ?? null;
}

/** Hand a listing (or a new site's URL) to the agent. An open brief for the same listing gets the new note instead. */
export async function queueBrief(
  ctx: MutationCtx,
  actor: Doc<"users">,
  input: { listingId?: Id<"listings">; url?: string; note?: string },
): Promise<Id<"listingBriefs">> {
  const note = cleanText(input.note ?? "", "Note to the agent", LIMITS.briefNote, false) || undefined;
  const now = Date.now();
  if (input.listingId) {
    const listing = await ctx.db.get(input.listingId);
    if (!listing) fail("Listing not found.");
    const open = await openBriefFor(ctx, listing._id);
    if (open) {
      await ctx.db.patch(open._id, { note: note ?? open.note, updatedAt: now });
      return open._id;
    }
    return await ctx.db.insert("listingBriefs", {
      listingId: listing._id,
      url: listing.url,
      note,
      status: "queued",
      rounds: 0,
      createdBy: actor._id,
      createdAt: now,
      updatedAt: now,
    });
  }
  if (!input.url?.trim()) fail("Give the site's URL or pick a listing.");
  const url = normalizeUrl(input.url);
  const key = domainKey(url);
  const listed = (await listingsOnDomain(ctx, key)).filter((l) => l.status !== "rejected");
  if (listed.length) fail(`That site is already listed as "${listed[0].title}" (/sites/${listed[0].slug}). Hand that listing to the agent instead.`);
  const openNew = (await ctx.db.query("listingBriefs").withIndex("by_status", (q) => q.eq("status", "queued")).take(500))
    .concat(await ctx.db.query("listingBriefs").withIndex("by_status", (q) => q.eq("status", "drafted")).take(500))
    .find((b) => !b.listingId && domainKey(b.url) === key);
  if (openNew) {
    await ctx.db.patch(openNew._id, { note: note ?? openNew.note, updatedAt: now });
    return openNew._id;
  }
  return await ctx.db.insert("listingBriefs", {
    url,
    note,
    status: "queued",
    rounds: 0,
    createdBy: actor._id,
    createdAt: now,
    updatedAt: now,
  });
}

/** The agent's draft, validated with the same rules as the admin form, plus the editorial checks. */
export function cleanDraft(draft: ListingCopy, isNewSite: boolean): ListingCopy {
  const out: ListingCopy = {};
  if (draft.title !== undefined) out.title = cleanText(draft.title, "Title", LIMITS.title);
  if (draft.tagline !== undefined) out.tagline = cleanText(draft.tagline, "Tagline", LIMITS.tagline);
  if (draft.writeup !== undefined) {
    out.writeup = cleanParagraphs(draft.writeup, "About this site", LIMITS.writeup);
    const problems = writeupProblems(out.writeup);
    if (problems.length) fail(`The write-up doesn't follow the editorial rules yet: ${problems.join(" ")}`);
  }
  if (draft.categories !== undefined) out.categories = checkCategories(draft.categories);
  if (draft.technologies !== undefined) out.technologies = checkTechnologies(draft.technologies);
  if (draft.region !== undefined) out.region = draft.region;
  if (draft.creatorTier !== undefined) out.creatorTier = draft.creatorTier;
  if (draft.creditName !== undefined) out.creditName = cleanText(draft.creditName, "Made by", LIMITS.creditName);
  if (draft.creditUrl !== undefined) {
    out.creditUrl = draft.creditUrl.trim() ? normalizeUrl(draft.creditUrl, "Creator website") : "";
  }
  if (isNewSite) {
    const missing = (["title", "tagline", "writeup", "categories", "region", "creatorTier", "creditName"] as const).filter(
      (k) => out[k] === undefined,
    );
    if (missing.length) fail(`A new site's draft needs every field. Missing: ${missing.join(", ")}.`);
    out.technologies ??= [];
  } else if (Object.keys(out).length === 0) {
    fail("The draft changes nothing. Send at least one field.");
  }
  return out;
}

/** The agent submits (or replaces) the draft of an open brief; Giorgi gets a push. */
export async function submitDraft(
  ctx: MutationCtx,
  brief: Brief,
  input: { draft: ListingCopy; sources: string[]; agentNote?: string },
) {
  if (!OPEN.includes(brief.status)) fail("This brief is closed (approved or cancelled). Ask Giorgi to queue the site again.");
  const draft = cleanDraft(input.draft, !brief.listingId);
  const sources = [...new Set(input.sources.map((s) => normalizeUrl(s, "Source")))];
  if (sources.length === 0) fail("List the pages you looked at (sources). Research the live site before drafting.");
  if (sources.length > LIMITS.draftSources) fail(`List at most ${LIMITS.draftSources} sources.`);
  const agentNote = cleanText(input.agentNote ?? "", "Agent note", LIMITS.agentNote, false) || undefined;
  const now = Date.now();
  await ctx.db.patch(brief._id, {
    status: "drafted",
    draft,
    sources,
    agentNote,
    rounds: brief.rounds + 1,
    draftedAt: now,
    updatedAt: now,
  });
  const listing = brief.listingId ? await ctx.db.get(brief.listingId) : null;
  const name = draft.title ?? listing?.title ?? brief.url;
  await pushAdmins(ctx, {
    title: "Listing draft ready",
    body: `${name}: the agent's copy is waiting for your yes.`,
    url: adminUrl(listing ? `/review/${listing._id}` : "/agent"),
    tag: `brief-${brief._id}`,
  });
}

/** Apply a drafted brief: the listing gets the draft (one revision); a new site waits for its media. */
export async function approveBrief(ctx: MutationCtx, actor: Doc<"users">, brief: Brief) {
  if (brief.status !== "drafted" || !brief.draft) fail("There is no draft to approve on this brief.");
  const now = Date.now();
  let slug: string | null = null;
  let revisionId: Id<"listingRevisions"> | null = null;
  if (brief.listingId) {
    const listing = await ctx.db.get(brief.listingId);
    if (!listing) fail("The listing of this brief no longer exists.");
    const result = await applyListingEdit(ctx, listing, brief.draft, {
      source: "agent",
      actorId: actor._id,
      briefId: brief._id,
    });
    slug = result.slug;
    revisionId = result.revisionId;
  }
  await ctx.db.patch(brief._id, { status: "approved", decidedAt: now, decidedBy: actor._id, updatedAt: now });
  return {
    slug,
    revisionId,
    next: brief.listingId
      ? "Applied to the listing."
      : `Approved. Add the screenshots on ${adminUrl(`/listings/new?brief=${brief._id}`)} to create the listing.`,
  };
}

export async function sendBackBrief(ctx: MutationCtx, actor: Doc<"users">, brief: Brief, feedback: string) {
  if (!OPEN.includes(brief.status)) fail("This brief is closed.");
  const text = cleanText(feedback, "Feedback", LIMITS.briefNote);
  const now = Date.now();
  await ctx.db.patch(brief._id, { status: "queued", feedback: text, decidedBy: actor._id, updatedAt: now });
}

export async function cancelBrief(ctx: MutationCtx, actor: Doc<"users">, brief: Brief) {
  if (brief.status === "approved") fail("An approved brief can't be cancelled; undo its change on the listing instead.");
  const now = Date.now();
  await ctx.db.patch(brief._id, { status: "cancelled", decidedAt: now, decidedBy: actor._id, updatedAt: now });
}

/**
 * Undo one revision: its fields go back to how they were. Refused when one of
 * them changed again since (undo the later change first), or it was undone.
 */
export async function undoRevision(ctx: MutationCtx, actor: Doc<"users">, revisionId: Id<"listingRevisions">) {
  const rev = await ctx.db.get(revisionId);
  if (!rev) fail("That change no longer exists.");
  if (rev.undoneAt) fail("That change was already undone.");
  const listing = await ctx.db.get(rev.listingId);
  if (!listing) fail("The listing no longer exists.");
  const now = copyOf(listing);
  const stale = (Object.keys(rev.after) as (keyof ListingCopy)[]).filter(
    (k) => JSON.stringify(now[k]) !== JSON.stringify(rev.after[k]),
  );
  if (stale.length) fail(`The ${stale.join(", ")} changed again since. Undo the later change first.`);
  const result = await applyListingEdit(ctx, listing, rev.before, { source: "undo", actorId: actor._id });
  await ctx.db.patch(rev._id, { undoneAt: Date.now() });
  return result;
}

export async function getBriefOrFail(ctx: Ctx, id: string) {
  const briefId = ctx.db.normalizeId("listingBriefs", id);
  const brief = briefId ? await ctx.db.get(briefId) : null;
  if (!brief) fail(`No brief with the id "${id}". Use editorial_queue to see the desk.`);
  return brief;
}

export async function briefsWithStatus(ctx: Ctx, statuses: Brief["status"][], limit = 100) {
  const rows: Brief[] = [];
  for (const status of statuses) {
    rows.push(
      ...(await ctx.db
        .query("listingBriefs")
        .withIndex("by_status", (q) => q.eq("status", status))
        .order("desc")
        .take(limit)),
    );
  }
  return rows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin (Clerk session)
// ─────────────────────────────────────────────────────────────────────────────

/** Hand a listing to the agent (or update the note of its open brief). */
export const queueListing = mutation({
  args: { listingId: v.id("listings"), note: v.optional(v.string()) },
  returns: v.id("listingBriefs"),
  handler: async (ctx, args) => queueBrief(ctx, await requireAdmin(ctx), args),
});

/** Hand a site that isn't listed yet to the agent. */
export const queueNewSite = mutation({
  args: { url: v.string(), note: v.optional(v.string()) },
  returns: v.id("listingBriefs"),
  handler: async (ctx, args) => queueBrief(ctx, await requireAdmin(ctx), args),
});

/** The desk: open briefs (queued and drafted) and the recent approved and cancelled ones. */
export const desk = query({
  args: {},
  returns: v.object({ open: v.array(briefView), recent: v.array(briefView) }),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const open = await briefsWithStatus(ctx, ["drafted", "queued"]);
    const recent = await briefsWithStatus(ctx, ["approved", "cancelled"], 20);
    return {
      open: await Promise.all(open.map((b) => viewBrief(ctx, b))),
      recent: await Promise.all(recent.map((b) => viewBrief(ctx, b))),
    };
  },
});

/** Drafts waiting for Giorgi (the nav badge). */
export const draftedCount = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return (await ctx.db.query("listingBriefs").withIndex("by_status", (q) => q.eq("status", "drafted")).take(200)).length;
  },
});

/** One listing's agent panel: its latest brief and its copy history. */
export const forListing = query({
  args: { listingId: v.id("listings") },
  returns: v.object({ brief: v.union(briefView, v.null()), revisions: v.array(revisionView) }),
  handler: async (ctx, { listingId }) => {
    await requireAdmin(ctx);
    const latest = await ctx.db
      .query("listingBriefs")
      .withIndex("by_listing", (q) => q.eq("listingId", listingId))
      .order("desc")
      .first();
    return { brief: latest ? await viewBrief(ctx, latest) : null, revisions: await revisionsOf(ctx, listingId) };
  },
});

/** An approved new-site draft, to prefill /listings/new?brief=… (null when it isn't one). */
export const draftForNewListing = query({
  args: { briefId: v.string() },
  returns: v.union(v.object({ id: v.id("listingBriefs"), url: v.string(), draft: copyView }), v.null()),
  handler: async (ctx, { briefId }) => {
    await requireAdmin(ctx);
    const id = ctx.db.normalizeId("listingBriefs", briefId);
    const brief = id ? await ctx.db.get(id) : null;
    if (!brief || brief.listingId || brief.status !== "approved" || !brief.draft) return null;
    return { id: brief._id, url: brief.url, draft: brief.draft };
  },
});

export const approve = mutation({
  args: { briefId: v.id("listingBriefs") },
  returns: v.object({ slug: v.union(v.string(), v.null()), next: v.string() }),
  handler: async (ctx, { briefId }) => {
    const admin = await requireAdmin(ctx);
    const brief = await ctx.db.get(briefId);
    if (!brief) fail("Brief not found.");
    const { slug, next } = await approveBrief(ctx, admin, brief);
    return { slug, next };
  },
});

export const sendBack = mutation({
  args: { briefId: v.id("listingBriefs"), feedback: v.string() },
  returns: v.null(),
  handler: async (ctx, { briefId, feedback }) => {
    const admin = await requireAdmin(ctx);
    const brief = await ctx.db.get(briefId);
    if (!brief) fail("Brief not found.");
    await sendBackBrief(ctx, admin, brief, feedback);
    return null;
  },
});

export const cancel = mutation({
  args: { briefId: v.id("listingBriefs") },
  returns: v.null(),
  handler: async (ctx, { briefId }) => {
    const admin = await requireAdmin(ctx);
    const brief = await ctx.db.get(briefId);
    if (!brief) fail("Brief not found.");
    await cancelBrief(ctx, admin, brief);
    return null;
  },
});

export const undo = mutation({
  args: { revisionId: v.id("listingRevisions") },
  returns: v.object({ slug: v.string() }),
  handler: async (ctx, { revisionId }) => {
    const admin = await requireAdmin(ctx);
    const { slug } = await undoRevision(ctx, admin, revisionId);
    return { slug };
  },
});
