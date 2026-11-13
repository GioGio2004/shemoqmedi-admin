// Create's edit mode (/create?post=<id>&item=<index>, or &mode=add): turning
// a post's media item, and its design recipe when it has one, back into
// Create's choices; what "Update post" renders and the media list it sends
// to social.update. Pure, so the rules are unit tested
// (tests/postEditCreate.test.ts). Contract: docs/post-editing.md (5).

import type { CarouselStory, DesignView, MediaDetail } from "@/convex/lib/design";
import { formatDay } from "@/lib/storefront";
import { FORMAT_IDS, TEMPLATES, TEMPLATE_IDS, TIER_IDS, type FormatId, type Style, type TemplateId } from "@/lib/graphics/spec";
import type { Network } from "./captions";
import {
  CAROUSEL_FIELDS,
  DEFAULT_TEMPLATE,
  FEED_FORMATS,
  GLASS,
  PALETTE_CHOICES,
  filledFields,
  formatFor,
  hostOf,
  isStyleId,
  renderArgs,
  type Design,
  type Fields,
  type GlassId,
  type Output,
  type PaletteChoice,
  type Source,
} from "./create";
import { KIND_LABEL } from "./queue";

/** Which media item a visit edits; `item: null` adds a new graphic to the post. */
export type EditTarget = { postId: string; item: number | null };

/** A post's media item as social.get and social.update carry it. */
export type MediaItem = { kind: "image" | "video"; url: string; role?: string; networks?: Network[] };

/** What edit mode reads from social.get. */
export type EditablePost = {
  kind: string;
  placement: "feed" | "story";
  listing: { slug: string; title: string } | null;
  facts: unknown;
  captions: Partial<Record<string, string>>;
  media: MediaItem[];
  mediaDetails: MediaDetail[];
};

/**
 * The recipe's inputs Create has no control for, passed back on render so
 * nothing Claude (or an older render) chose is lost: a graphic's extra
 * texts and image slots, a carousel's facts beyond its four boxes and its
 * story (chips, notes, cta, mobile shot, screenshots).
 */
export type Carry =
  /** `format`: the recipe's own format when Create's feed choices have no button for it (a reel cover, a 9:16 image). */
  | { kind: "graphic"; template: TemplateId; fields: Fields; extraImages: string[]; format?: FormatId }
  | { kind: "carousel"; listingId: string | null; facts: Fields; story: CarouselStory };

/** Create's starting choices for an edit. */
export type EditSeed = {
  source: Source;
  output: Output;
  template: TemplateId;
  format: FormatId;
  style: Style;
  palette: PaletteChoice;
  glass: GlassId;
  edits: Partial<Record<TemplateId, Fields>>;
  carouselEdits: Fields;
  listingId: string | null;
  shot: string | null;
  carry: Carry | null;
  /** Shown above the steps: how the design was started when there was no recipe. */
  note: string | null;
};

export const NO_RECIPE_NOTE = "No design saved for this image: starting from the post.";
export const VIDEO_NOTE = "This is a video. Update post puts a new image in its place.";

/** A seed's `shot` when the recipe had no image: none (not the listing's cover). */
export const NO_SHOT = "";

/** What a change to an approved, scheduled or failed post means for it, said before it is saved. */
export function editResetText(status: string) {
  return status === "scheduled" ? "This post goes back to Waiting and its schedule is cancelled. You approve it again after." : "This post goes back to Waiting. You approve it again after.";
}

const first = (v: string | string[] | undefined | null) => (Array.isArray(v) ? v[0] : v) ?? undefined;

/** Reads ?post=&item= or ?post=&mode=add; null when it is no edit link (Create then starts as usual). */
export function parseEditTarget(params: { post?: string | string[]; item?: string | string[]; mode?: string | string[] }): EditTarget | null {
  const postId = first(params.post)?.trim();
  if (!postId || !/^[a-z0-9]{10,64}$/i.test(postId)) return null;
  if (first(params.mode) === "add") return { postId, item: null };
  const raw = first(params.item)?.trim();
  if (!raw || !/^\d{1,2}$/.test(raw)) return null;
  return { postId, item: Number(raw) };
}

/** The edit draft's own id under the "create-edit" store: never the normal Create draft. */
export function editDraftId(t: EditTarget) {
  return `${t.postId}:${t.item ?? "add"}`;
}

/** Where Update post and Cancel go: the queue, with that post's sheet open. */
export function queueUrlFor(postId: string) {
  const id = encodeURIComponent(postId);
  return `/queue?post=${id}`;
}

// ── Small readers ─────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => (x && typeof x === "object" && !Array.isArray(x) ? (x as Obj) : null);
const str = (x: unknown) => (typeof x === "string" && x.trim() ? x.trim() : undefined);

const isTemplate = (x: string): x is TemplateId => (TEMPLATE_IDS as string[]).includes(x);
const isFormat = (x: string): x is FormatId => (FORMAT_IDS as string[]).includes(x);
const isPalette = (x: string): x is PaletteChoice => (PALETTE_CHOICES as string[]).includes(x);
const isGlass = (x: string | undefined): x is GlassId => !!x && GLASS.some((g) => g.id === x);

const templateKeys = (t: TemplateId) => new Set<string>(TEMPLATES[t].fields.map((f) => f.key));
const CAROUSEL_KEYS = new Set<string>(CAROUSEL_FIELDS.map((f) => f.key));

function pick(fields: Fields, keys: Set<string>, keep: boolean): Fields {
  return Object.fromEntries(Object.entries(fields).filter(([k, v]) => keys.has(k) === keep && typeof v === "string"));
}

/** Every key, with the recipe's text or "" (so the listing's facts never fill a box the recipe left to the template's defaults). */
function every(fields: Fields, keys: Iterable<string>): Fields {
  return Object.fromEntries([...keys].map((k) => [k, typeof fields[k] === "string" ? fields[k] : ""]));
}

/** The post's name for the banner: its site, else its text, else its kind. */
export function postTitle(post: Pick<EditablePost, "kind" | "listing" | "facts">) {
  const f = obj(post.facts);
  const text = obj(f?.text);
  return post.listing?.title ?? str(f?.title) ?? str(text?.title) ?? str(text?.headline) ?? str(f?.headline) ?? KIND_LABEL[post.kind] ?? "Post";
}

/** The source a template belongs to (a site's templates only when the post has a site). */
function sourceForTemplate(template: TemplateId, post: Pick<EditablePost, "listing">): Source {
  switch (template) {
    case "award":
      return "award";
    case "new_listing":
    case "screenshot":
      return post.listing ? "listing" : "free";
    case "announcement":
    case "call_submissions":
    case "call_jury":
      return template;
    default:
      return "free";
  }
}

function sourceForKind(kind: string, post: Pick<EditablePost, "listing">): Source {
  switch (kind) {
    case "award":
      return "award";
    case "announcement":
    case "call_submissions":
    case "call_jury":
      return kind;
    case "new_listing":
    case "custom":
      return post.listing ? "listing" : "free";
    default:
      return "free";
  }
}

/**
 * The first line of a caption, as a headline (no hashtags, links or emoji), at most 120
 * characters. Instagram first, like the cards' titles; emoji go because the graphics'
 * fonts can't draw them (they would render as empty boxes in the final image).
 */
export function headlineFromCaptions(captions: Partial<Record<string, string>>) {
  const text = captions.instagram ?? captions.facebook ?? captions.linkedin ?? captions.threads ?? "";
  for (const raw of text.split(/\n+/)) {
    const line = raw
      .replace(/#[\p{L}\p{N}_]+/gu, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}‍️]/gu, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!line) continue;
    if (line.length <= 120) return line;
    const cut = line.slice(0, 120);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 60)).trim()}…`;
  }
  return undefined;
}

/** Texts the post itself knows (system facts, Claude's facts, or what Create typed), by template field key. */
export function factsAsFields(post: Pick<EditablePost, "facts" | "captions" | "listing">): Fields {
  const f = obj(post.facts) ?? {};
  const text = obj(f.text) ?? {};
  const award = obj(f.award);
  const studio = typeof f.studio === "string" ? f.studio : str(obj(f.studio)?.name);
  const tier = str(award?.tier);
  const day = str(award?.date);
  const awardSlug = str(award?.slug) ?? str(award?.pageUrl)?.match(/\/awards\/([^/?#]+)/)?.[1];
  const siteUrl = str(f.siteUrl) ?? str(f.url);
  const out: Fields = {
    title: str(text.title) ?? str(f.title) ?? post.listing?.title ?? "",
    studio: str(text.studio) ?? str(studio) ?? "",
    tagline: str(text.tagline) ?? str(f.tagline) ?? "",
    url: str(text.url) ?? (siteUrl ? hostOf(siteUrl) : ""),
    tier: str(text.tier) ?? (tier && (TIER_IDS as string[]).includes(tier) ? tier : ""),
    date: str(text.date) ?? (day ? (/^\d{4}-\d{2}-\d{2}$/.test(day) ? formatDay(day) : day) : ""),
    awardSlug: str(text.awardSlug) ?? awardSlug ?? "",
    headline: str(text.headline) ?? str(f.headline) ?? headlineFromCaptions(post.captions) ?? "",
    body: str(text.body) ?? str(f.body) ?? "",
    cta: str(text.cta) ?? str(f.cta) ?? "",
    kicker: str(text.kicker) ?? str(f.kicker) ?? "",
  };
  // What Create typed (a Studio-made post keeps every text field in facts.text) wins.
  for (const [k, v] of Object.entries(text)) {
    const t = str(v);
    if (t) out[k] = t;
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}

/** Whether the post's own item looks like a site screenshot (usable as the graphic's image). */
function isScreenshot(item: MediaItem | undefined) {
  return !!item && item.kind === "image" && (item.role === "screenshot" || item.url.includes("/listings/"));
}

const BASE = { style: "swiss" as Style, palette: "house" as PaletteChoice, glass: "frost" as GlassId };

// ── Seeds ─────────────────────────────────────────────────────────────────

/** Create's choices from a saved recipe. `listingId` is the post's listing (by slug), when known. */
export function seedFromRecipe(design: DesignView, post: Pick<EditablePost, "kind" | "placement" | "listing" | "facts" | "captions">, listingId: string | null): EditSeed {
  // A reel's recipe opens in the reel editor (docs/reel-editor.md), never in Create.
  if (design.kind === "reel") throw new Error("A reel is edited in the reel editor.");
  const style = isStyleId(design.style) ? design.style : "glass";
  const palette = isPalette(design.palette) ? design.palette : "auto";
  if (design.kind === "carousel") {
    const source: Source = post.kind === "award" ? "award" : "listing";
    const facts = design.facts ?? {};
    const template = DEFAULT_TEMPLATE[source];
    const story = post.placement === "story";
    // Only the recipe's own listing: a carousel told from facts alone stays so (not the post's site).
    const recipeListing = design.listingId ?? null;
    return {
      source,
      output: story ? "story" : "carousel",
      template,
      format: story ? "story" : "ig_portrait",
      style,
      palette,
      glass: isGlass(design.story?.glass) ? design.story.glass : "frost",
      // A switch to one image starts from the same texts.
      edits: { [template]: pick({ ...factsAsFields(post), ...facts }, templateKeys(template), true) },
      carouselEdits: every(facts, CAROUSEL_KEYS),
      listingId: recipeListing,
      shot: design.story?.shots?.[0] ?? null,
      carry: { kind: "carousel", listingId: recipeListing, facts: pick(facts, CAROUSEL_KEYS, false), story: design.story ?? {} },
      note: null,
    };
  }
  const template = isTemplate(design.template) ? design.template : DEFAULT_TEMPLATE[sourceForKind(post.kind, post)];
  const source = sourceForTemplate(template, post);
  const story = post.placement === "story";
  const format: FormatId = story ? "story" : isFormat(design.format) ? design.format : "ig_portrait";
  // A feed post's reel cover or 9:16 graphic keeps its format while the design keeps it (editFormat).
  const ownFormat = !story && !FEED_FORMATS.includes(format) ? format : null;
  const keys = templateKeys(template);
  const fields = design.fields ?? {};
  return {
    source,
    output: story ? "story" : "single",
    template,
    format,
    style,
    palette,
    glass: isGlass(design.glass) ? design.glass : "frost",
    edits: { [template]: every(fields, keys) },
    carouselEdits: {},
    listingId: source === "listing" || source === "award" ? listingId : null,
    shot: design.imageUrls?.[0] ?? NO_SHOT,
    carry: { kind: "graphic", template, fields: pick(fields, keys, false), extraImages: (design.imageUrls ?? []).slice(1), ...(ownFormat ? { format: ownFormat } : {}) },
    note: null,
  };
}

/** Best effort when an image has no recipe (or a new graphic is added): the post's kind, site, texts and screenshot. */
export function seedFromPost(post: EditablePost, item: number | null, listingId: string | null): EditSeed {
  const f = obj(post.facts);
  const made = f?.madeIn === "studio" ? obj(f.design) : null;
  const madeTemplate = str(made?.template);
  const template: TemplateId = madeTemplate && isTemplate(madeTemplate) ? madeTemplate : DEFAULT_TEMPLATE[sourceForKind(post.kind, post)];
  const source = madeTemplate && isTemplate(madeTemplate) ? sourceForTemplate(template, post) : sourceForKind(post.kind, post);
  const madeOutput = str(made?.output);
  const story = post.placement === "story";
  const output: Output = story ? "story" : madeOutput === "carousel" && post.listing ? "carousel" : "single";
  const madeFormat = str(made?.format);
  const format: FormatId = story ? "story" : madeFormat && isFormat(madeFormat) ? madeFormat : "ig_portrait";
  const madeStyle = str(made?.style);
  const madePalette = str(made?.palette);
  const current = item === null ? undefined : post.media[item];
  const fields = factsAsFields(post);
  return {
    source,
    output,
    template,
    format,
    style: madeStyle && isStyleId(madeStyle) ? madeStyle : BASE.style,
    palette: madePalette && isPalette(madePalette) ? madePalette : BASE.palette,
    glass: BASE.glass,
    edits: { [template]: pick(fields, templateKeys(template), true) },
    carouselEdits: {},
    listingId: source === "listing" || source === "award" || output === "carousel" ? listingId : null,
    shot: isScreenshot(current) ? current!.url : null,
    carry: null,
    note: item === null ? null : current?.kind === "video" ? VIDEO_NOTE : NO_RECIPE_NOTE,
  };
}

/** The seed for a visit: the item's recipe when it has one, else the best-effort prefill. */
export function seedForEdit(post: EditablePost, target: EditTarget, listingId: string | null): EditSeed {
  const design = target.item === null ? null : (post.mediaDetails[target.item]?.design ?? null);
  return design && design.kind !== "reel" ? seedFromRecipe(design, post, listingId) : seedFromPost(post, target.item, listingId);
}

// ── Rules ─────────────────────────────────────────────────────────────────

/** A story post stays a story (one 9:16 image); a feed post takes feed images and carousels. */
export function editOutputAllowed(output: Output, placement: "feed" | "story") {
  return placement === "story" ? output === "story" : output !== "story";
}

/** Why the post can't be edited now (from lib/studio/queue postActions), or null. */
export function editBlockReason(post: { status: string }, actions: { publishing: boolean; edit: boolean }) {
  if (actions.edit) return null;
  if (actions.publishing) return "This post is being published right now; wait a few minutes.";
  if (post.status === "sent") return "This post is sent; it can't be changed any more.";
  if (post.status === "rejected") return "This post was rejected; it can't be changed any more.";
  return "This post can't be changed now. Open it in the queue.";
}

/** Whether two media lists hold the same URLs in the same order. */
export function sameUrls(a: string[], b: string[]) {
  return a.length === b.length && a.every((u, i) => u === b[i]);
}

/** Why this target can't be edited from Create (beyond the post's status), or null. */
export function targetProblem(post: Pick<EditablePost, "placement" | "media">, target: EditTarget) {
  if (target.item === null) {
    if (post.placement === "story" && post.media.length > 0) return "A story is one image. Edit that image instead.";
    if (post.media.length >= 10) return "This post already has 10 images or videos, the most a post can hold.";
    return null;
  }
  if (target.item >= post.media.length) return "That image is no longer in this post.";
  return null;
}

/** Whether the carried carousel inputs still belong to the design (same site, still a carousel). */
function carouselCarry(d: Pick<Design, "output" | "listingId">, carry: Carry | null) {
  return carry?.kind === "carousel" && d.output === "carousel" && (carry.listingId ?? null) === (d.listingId ?? null) ? carry : null;
}

/** A carousel needs a listing, or (a recipe told from facts only) a title among its facts. */
export function carouselCanRender(d: Pick<Design, "output" | "listingId">, carry: Carry | null) {
  if (d.output !== "carousel") return true;
  return !!d.listingId || !!carouselCarry(d, carry)?.facts.title?.trim();
}

/** The format edit mode draws and renders: the recipe's own (non-feed) format while it is still chosen, else Create's. */
export function editFormat(output: Output, format: FormatId, carry: Carry | null): FormatId {
  if (output === "single" && carry?.kind === "graphic" && carry.format && format === carry.format) return carry.format;
  return formatFor(output, format);
}

/** graphics.renderForPost's arguments in edit mode: Create's design plus what the recipe carried. */
export function editRenderArgs(d: Design, carry: Carry | null) {
  const own = editFormat(d.output, d.format, carry);
  const args = { ...renderArgs(d), ...(d.output === "single" ? { format: own } : {}) };
  const c = carouselCarry(d, carry);
  if (c) {
    const { chips, notes, cta, mobile } = c.story;
    const story = Object.fromEntries(Object.entries({ chips, notes, cta, mobile }).filter(([, v]) => v !== undefined)) as Omit<CarouselStory, "glass" | "shots">;
    return {
      ...args,
      fields: { ...c.facts, ...args.fields },
      imageUrls: c.story.shots?.length ? c.story.shots : undefined,
      story: Object.keys(story).length ? story : undefined,
    };
  }
  if (carry?.kind === "graphic" && d.output !== "carousel" && d.template === carry.template) {
    const extra = filledFields(carry.fields);
    return {
      ...args,
      fields: { ...extra, ...args.fields },
      imageUrls: args.imageUrls && carry.extraImages.length ? [...args.imageUrls, ...carry.extraImages] : args.imageUrls,
      story: undefined,
    };
  }
  return { ...args, story: undefined };
}

// ── The media list Update post sends ──────────────────────────────────────

const threadsOnly = (m: MediaItem) => m.networks?.length === 1 && m.networks[0] === "threads";

/** The items one edit replaces: the item, or every slide of its carousel set. */
export function editedSet(details: (MediaDetail | undefined)[], index: number) {
  const d = details[index]?.design;
  if (d?.kind !== "carousel") return [index];
  return details.flatMap((x, j) => (x?.design?.kind === "carousel" && x.design.setId === d.setId ? [j] : []));
}

/**
 * The post's media with item `index` replaced by a new render. A carousel
 * slide's whole set goes: the new slides take the set's first place (with
 * its networks), a Threads-only copy of the hook becomes the new first
 * slide in its own place, and the set's other items are dropped.
 */
export function replaceItem(media: MediaItem[], details: (MediaDetail | undefined)[], index: number, urls: string[], rendered: "graphic" | "carousel"): MediaItem[] {
  if (!media[index]) throw new Error("That image is no longer in this post.");
  if (urls.length === 0) throw new Error("Render the final image first.");
  const set = new Set(editedSet(details, index));
  const main = [...set].filter((j) => !threadsOnly(media[j]));
  const anchor = main.length ? main[0] : index;
  const out: MediaItem[] = [];
  media.forEach((m, j) => {
    if (!set.has(j)) {
      out.push(m);
    } else if (j === anchor) {
      for (const url of urls) out.push({ kind: "image", url, role: rendered, ...(m.networks ? { networks: m.networks } : {}) });
    } else if (threadsOnly(m)) {
      out.push({ kind: "image", url: urls[0], ...(m.role ? { role: m.role } : {}), networks: ["threads"] });
    }
  });
  return out;
}

/** The post's media with a new render added at the end. */
export function appendItems(media: MediaItem[], urls: string[], rendered: "graphic" | "carousel"): MediaItem[] {
  return [...media, ...urls.map((url) => ({ kind: "image" as const, url, role: rendered }))];
}

/** What Update post will do, in one plain line. */
export function describeUpdate(media: MediaItem[], details: (MediaDetail | undefined)[], target: EditTarget, count: number) {
  const these = count === 1 ? "this image" : `these ${count} images`;
  if (target.item === null) return `Adds ${these} to the post.`;
  const set = editedSet(details, target.item);
  if (set.length > 1) return `Replaces the carousel (${set.length} slides) with ${these}.`;
  const word = media[target.item]?.kind === "video" ? "video" : "image";
  return `Replaces ${word} ${target.item + 1} of ${media.length}${count === 1 ? "" : ` with ${these}`}.`;
}

/** What the banner says is being edited: "image 2", "the carousel", "a new image". */
export function targetLabel(post: Pick<EditablePost, "media" | "mediaDetails">, target: EditTarget) {
  if (target.item === null) return "a new image";
  if (editedSet(post.mediaDetails, target.item).length > 1) return "the carousel";
  const word = post.media[target.item]?.kind === "video" ? "video" : "image";
  return post.media.length > 1 ? `${word} ${target.item + 1}` : `the ${word}`;
}
