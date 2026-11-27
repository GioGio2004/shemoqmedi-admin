import { ConvexError, v, type Infer } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdmin } from "./authHelpers";
import { guideArea, guideRole } from "./schema";
import { fail, slugify } from "./lib/listingHelpers";
import { deleteMediaMany, mediaUrl } from "./lib/media";
import { GUIDE_STARTERS } from "./lib/guideStarters";

// Team guides: how-tos the owner writes for the team (/guides in the admin).
// A guide is a title, an area, who it is for, and sections in order; a
// section is a heading, plain text and screenshots (ImageKit, /guides/<slug>/,
// media.guideUploadAuth + media.registerGuide). "template" sections are
// copy-ready messages. Admin-only, like the team docs.

export const GUIDE_LIMITS = {
  title: 120,
  summary: 280,
  heading: 140,
  body: 10_000,
  caption: 200,
  images: 8,
  sections: 80,
} as const;

const GUIDES_FOLDER = "/guides/";

type Area = Infer<typeof guideArea>;
type Role = Infer<typeof guideRole>;

const sectionKind = v.union(v.literal("steps"), v.literal("template"));
const sectionLanguage = v.union(v.literal("ka"), v.literal("en"));
const sectionImage = v.object({ mediaId: v.id("media"), caption: v.optional(v.string()) });

function line(value: string, field: string, max: number, required = true) {
  const text = value.trim().replace(/\s+/g, " ");
  if (required && !text) fail(`${field} is required.`);
  if (text.length > max) fail(`${field} must be ${max} characters or fewer.`);
  return text;
}

/** Section text keeps its line breaks (paragraphs, lists, messages); only trailing spaces and runs of blank lines go. */
export function cleanBody(value: string) {
  const text = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length > GUIDE_LIMITS.body) fail(`The text must be ${GUIDE_LIMITS.body} characters or fewer.`);
  return text;
}

function cleanRoles(roles: Role[]) {
  const unique = [...new Set(roles)];
  if (!unique.length) fail("Pick who the guide is for.");
  return unique;
}

async function sectionsOf(ctx: MutationCtx, guideId: Id<"guides">) {
  return await ctx.db
    .query("guideSections")
    .withIndex("by_guide_position", (q) => q.eq("guideId", guideId))
    .collect();
}

async function uniqueSlug(ctx: MutationCtx, title: string) {
  const base = slugify(title, "guide");
  for (let n = 1; n < 100; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const taken = await ctx.db
      .query("guides")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!taken) return slug;
  }
  fail("Too many guides with this title.");
}

async function touch(ctx: MutationCtx, guideId: Id<"guides">, user: Doc<"users">) {
  await ctx.db.patch(guideId, { updatedAt: Date.now(), updatedBy: user._id });
}

async function getGuide(ctx: MutationCtx, guideId: Id<"guides">) {
  const guide = await ctx.db.get(guideId);
  if (!guide) fail("This guide was deleted.");
  return guide;
}

async function getSection(ctx: MutationCtx, sectionId: Id<"guideSections">) {
  const section = await ctx.db.get(sectionId);
  if (!section) fail("This section was deleted.");
  return section;
}

const guideSummary = v.object({
  id: v.id("guides"),
  slug: v.string(),
  title: v.string(),
  summary: v.optional(v.string()),
  area: guideArea,
  roles: v.array(guideRole),
  status: v.union(v.literal("draft"), v.literal("ready")),
  sections: v.number(),
  updatedAt: v.number(),
});

/** Every guide, newest change first, with how many sections it has. */
export const list = query({
  args: {},
  returns: v.array(guideSummary),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const guides = await ctx.db.query("guides").withIndex("by_updated").order("desc").take(500);
    return await Promise.all(
      guides.map(async (g) => ({
        id: g._id,
        slug: g.slug,
        title: g.title,
        summary: g.summary,
        area: g.area,
        roles: g.roles,
        status: g.status,
        sections: (
          await ctx.db
            .query("guideSections")
            .withIndex("by_guide_position", (q) => q.eq("guideId", g._id))
            .collect()
        ).length,
        updatedAt: g.updatedAt,
      })),
    );
  },
});

/** One guide with its sections in order and each screenshot's URL; null when there is no such guide. */
export const get = query({
  args: { slug: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      id: v.id("guides"),
      slug: v.string(),
      title: v.string(),
      summary: v.optional(v.string()),
      area: guideArea,
      roles: v.array(guideRole),
      status: v.union(v.literal("draft"), v.literal("ready")),
      updatedAt: v.number(),
      updatedByName: v.optional(v.string()),
      sections: v.array(
        v.object({
          id: v.id("guideSections"),
          kind: sectionKind,
          heading: v.string(),
          body: v.string(),
          language: v.optional(sectionLanguage),
          images: v.array(v.object({ mediaId: v.id("media"), caption: v.optional(v.string()), url: v.union(v.string(), v.null()) })),
        }),
      ),
    }),
  ),
  handler: async (ctx, { slug }) => {
    await requireAdmin(ctx);
    const guide = await ctx.db
      .query("guides")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();
    if (!guide) return null;
    const sections = await ctx.db
      .query("guideSections")
      .withIndex("by_guide_position", (q) => q.eq("guideId", guide._id))
      .collect();
    const editor = guide.updatedBy ? await ctx.db.get(guide.updatedBy) : null;
    return {
      id: guide._id,
      slug: guide.slug,
      title: guide.title,
      summary: guide.summary,
      area: guide.area,
      roles: guide.roles,
      status: guide.status,
      updatedAt: guide.updatedAt,
      updatedByName: editor?.name ?? undefined,
      sections: await Promise.all(
        sections.map(async (s) => ({
          id: s._id,
          kind: s.kind,
          heading: s.heading,
          body: s.body,
          language: s.language,
          images: await Promise.all(
            s.images.map(async (img) => ({ mediaId: img.mediaId, caption: img.caption, url: await mediaUrl(ctx, img.mediaId) })),
          ),
        })),
      ),
    };
  },
});

/** A new, empty guide (a draft); returns its slug. */
export const create = mutation({
  args: { title: v.string(), area: guideArea, roles: v.array(guideRole), summary: v.optional(v.string()) },
  returns: v.string(),
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx);
    const title = line(args.title, "Title", GUIDE_LIMITS.title);
    const summary = args.summary === undefined ? undefined : line(args.summary, "Summary", GUIDE_LIMITS.summary, false) || undefined;
    const slug = await uniqueSlug(ctx, title);
    const now = Date.now();
    await ctx.db.insert("guides", {
      slug,
      title,
      summary,
      area: args.area,
      roles: cleanRoles(args.roles),
      status: "draft",
      createdBy: user._id,
      updatedBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    return slug;
  },
});

/** Change a guide's title, summary, area, roles or status. The slug (its address) stays. */
export const update = mutation({
  args: {
    guideId: v.id("guides"),
    title: v.optional(v.string()),
    summary: v.optional(v.string()),
    area: v.optional(guideArea),
    roles: v.optional(v.array(guideRole)),
    status: v.optional(v.union(v.literal("draft"), v.literal("ready"))),
  },
  returns: v.null(),
  handler: async (ctx, { guideId, ...args }) => {
    const user = await requireAdmin(ctx);
    await getGuide(ctx, guideId);
    const patch: Partial<Doc<"guides">> = { updatedAt: Date.now(), updatedBy: user._id };
    if (args.title !== undefined) patch.title = line(args.title, "Title", GUIDE_LIMITS.title);
    if (args.summary !== undefined) patch.summary = line(args.summary, "Summary", GUIDE_LIMITS.summary, false) || undefined;
    if (args.area !== undefined) patch.area = args.area;
    if (args.roles !== undefined) patch.roles = cleanRoles(args.roles);
    if (args.status !== undefined) patch.status = args.status;
    await ctx.db.patch(guideId, patch);
    return null;
  },
});

/** Delete a guide, its sections and their screenshots. */
export const remove = mutation({
  args: { guideId: v.id("guides") },
  returns: v.null(),
  handler: async (ctx, { guideId }) => {
    const user = await requireAdmin(ctx);
    await getGuide(ctx, guideId);
    const sections = await sectionsOf(ctx, guideId);
    const media = sections.flatMap((s) => s.images.map((i) => i.mediaId));
    for (const s of sections) await ctx.db.delete(s._id);
    await ctx.db.delete(guideId);
    await deleteMediaMany(ctx, media, user);
    return null;
  },
});

/** Add an empty section at the end of a guide; returns its id. */
export const addSection = mutation({
  args: { guideId: v.id("guides"), kind: v.optional(sectionKind) },
  returns: v.id("guideSections"),
  handler: async (ctx, { guideId, kind = "steps" }) => {
    const user = await requireAdmin(ctx);
    await getGuide(ctx, guideId);
    const sections = await sectionsOf(ctx, guideId);
    if (sections.length >= GUIDE_LIMITS.sections) fail(`A guide can have up to ${GUIDE_LIMITS.sections} sections.`);
    const last = sections.at(-1);
    const id = await ctx.db.insert("guideSections", {
      guideId,
      position: last ? last.position + 1 : 0,
      kind,
      heading: kind === "template" ? "New message" : "New section",
      body: "",
      images: [],
      updatedAt: Date.now(),
    });
    await touch(ctx, guideId, user);
    return id;
  },
});

/**
 * Save a section: heading, text, kind, language and its screenshots (the
 * whole list, in order). Screenshots taken off the list are deleted from
 * ImageKit. New ones must be guide screenshots (media.registerGuide).
 */
export const updateSection = mutation({
  args: {
    sectionId: v.id("guideSections"),
    kind: sectionKind,
    heading: v.string(),
    body: v.string(),
    language: v.optional(sectionLanguage),
    images: v.array(sectionImage),
  },
  returns: v.null(),
  handler: async (ctx, { sectionId, ...args }) => {
    const user = await requireAdmin(ctx);
    const section = await getSection(ctx, sectionId);
    if (args.images.length > GUIDE_LIMITS.images) fail(`A section can have up to ${GUIDE_LIMITS.images} screenshots.`);
    const before = new Set<string>(section.images.map((i) => i.mediaId));
    const seen = new Set<string>();
    const images = [];
    for (const img of args.images) {
      if (seen.has(img.mediaId)) continue;
      seen.add(img.mediaId);
      if (!before.has(img.mediaId)) {
        const row = await ctx.db.get(img.mediaId);
        if (!row || row.kind !== "image" || !row.filePath.startsWith(GUIDES_FOLDER)) {
          throw new ConvexError("That screenshot was not uploaded to this guide. Upload it again.");
        }
      }
      const caption = img.caption === undefined ? undefined : line(img.caption, "Caption", GUIDE_LIMITS.caption, false) || undefined;
      images.push({ mediaId: img.mediaId, caption });
    }
    await ctx.db.patch(sectionId, {
      kind: args.kind,
      heading: line(args.heading, "Heading", GUIDE_LIMITS.heading),
      body: cleanBody(args.body),
      language: args.kind === "template" ? args.language : undefined,
      images,
      updatedAt: Date.now(),
    });
    const removed = [...before].filter((id) => !seen.has(id)) as Id<"media">[];
    await deleteMediaMany(ctx, removed, user);
    await touch(ctx, section.guideId, user);
    return null;
  },
});

/** Move a section one place up or down. */
export const moveSection = mutation({
  args: { sectionId: v.id("guideSections"), direction: v.union(v.literal("up"), v.literal("down")) },
  returns: v.null(),
  handler: async (ctx, { sectionId, direction }) => {
    const user = await requireAdmin(ctx);
    const section = await getSection(ctx, sectionId);
    const sections = await sectionsOf(ctx, section.guideId);
    const i = sections.findIndex((s) => s._id === sectionId);
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= sections.length) return null;
    // Renumber 0..n-1 with the two swapped, so equal or gappy positions can't stick.
    const order = sections.map((s) => s._id);
    [order[i], order[j]] = [order[j], order[i]];
    for (const [position, id] of order.entries()) {
      const s = sections.find((x) => x._id === id)!;
      if (s.position !== position) await ctx.db.patch(id, { position });
    }
    await touch(ctx, section.guideId, user);
    return null;
  },
});

/** Delete a section and its screenshots. */
export const removeSection = mutation({
  args: { sectionId: v.id("guideSections") },
  returns: v.null(),
  handler: async (ctx, { sectionId }) => {
    const user = await requireAdmin(ctx);
    const section = await getSection(ctx, sectionId);
    await ctx.db.delete(sectionId);
    await deleteMediaMany(
      ctx,
      section.images.map((i) => i.mediaId),
      user,
    );
    await touch(ctx, section.guideId, user);
    return null;
  },
});

/** The starter guides (convex/lib/guideStarters.ts) not in the database yet, by slug. */
export const missingStarters = query({
  args: {},
  returns: v.array(v.object({ slug: v.string(), title: v.string() })),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const missing = [];
    for (const g of GUIDE_STARTERS) {
      const found = await ctx.db
        .query("guides")
        .withIndex("by_slug", (q) => q.eq("slug", g.slug))
        .first();
      if (!found) missing.push({ slug: g.slug, title: g.title });
    }
    return missing;
  },
});

/**
 * Add the starter guides that aren't there yet (matched by slug, so a guide
 * that was edited is never overwritten, and a deleted one can be added back).
 * Returns how many were added.
 */
export const addStarters = mutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const user = await requireAdmin(ctx);
    let added = 0;
    const now = Date.now();
    for (const [n, g] of GUIDE_STARTERS.entries()) {
      const found = await ctx.db
        .query("guides")
        .withIndex("by_slug", (q) => q.eq("slug", g.slug))
        .first();
      if (found) continue;
      const guideId = await ctx.db.insert("guides", {
        slug: g.slug,
        title: g.title,
        summary: g.summary,
        area: g.area as Area,
        roles: [...g.roles] as Role[],
        status: "ready",
        createdBy: user._id,
        updatedBy: user._id,
        createdAt: now,
        // Keeps the starters in their written order on the list (newest first).
        updatedAt: now - n,
      });
      for (const [position, s] of g.sections.entries()) {
        await ctx.db.insert("guideSections", {
          guideId,
          position,
          kind: s.kind,
          heading: s.heading,
          body: cleanBody(s.body),
          language: s.language,
          images: [],
          updatedAt: now,
        });
      }
      added++;
    }
    return added;
  },
});
