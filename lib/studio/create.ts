// The Create page's choices and the plain data it sends: which template a
// source starts from, which formats an output offers, the preview assets
// URL, the final render's arguments and the post it becomes. Pure, so the
// rules are unit tested (tests/studioHelpers.test.ts).

import { FORMATS, STYLES, TEMPLATES, TEMPLATE_IDS, type FormatId, type Style, type TemplateId } from "@/lib/graphics/spec";
import { PALETTE_IDS } from "@/lib/palettes";
import type { DraftSource } from "./drafts";

export type Source = DraftSource;
export type Output = "single" | "carousel" | "story";
export type GlassId = "frost" | "liquid" | "tint";
export type PaletteChoice = (typeof PALETTE_IDS)[number] | "auto";
export type Fields = Record<string, string>;

export const SOURCES: { id: Source; label: string; hint: string }[] = [
  { id: "listing", label: "Listing", hint: "A live site" },
  { id: "award", label: "Award", hint: "SOTD, HM, SOTM…" },
  { id: "announcement", label: "Announcement", hint: "News" },
  { id: "call_submissions", label: "Call: submissions", hint: "Weekly call" },
  { id: "call_jury", label: "Call: jurors", hint: "Invite the jury" },
  { id: "free", label: "Free text", hint: "Anything" },
];

export const OUTPUTS: { id: Output; label: string; hint: string }[] = [
  { id: "single", label: "Feed image", hint: "One image" },
  { id: "carousel", label: "Carousel", hint: "The site's story" },
  { id: "story", label: "Story", hint: "9:16" },
];

export const GLASS: { id: GlassId; label: string }[] = [
  { id: "frost", label: "Frost" },
  { id: "liquid", label: "Liquid" },
  { id: "tint", label: "Tint" },
];

export const PALETTE_CHOICES: PaletteChoice[] = [...PALETTE_IDS, "auto"];

/** Feed formats Instagram accepts as they are (4:5 to 1.91:1). Stories have their own output. */
export const FEED_FORMATS: FormatId[] = ["ig_portrait", "square", "link"];

export const DEFAULT_TEMPLATE: Record<Source, TemplateId> = {
  listing: "new_listing",
  award: "award",
  announcement: "announcement",
  call_submissions: "call_submissions",
  call_jury: "call_jury",
  free: "announcement",
};

/** The source's own template first, then the rest. */
export function templatesFor(source: Source): TemplateId[] {
  const first = DEFAULT_TEMPLATE[source];
  return [first, ...TEMPLATE_IDS.filter((t) => t !== first)];
}

/** A carousel tells one site's story: it needs a listing. */
export function needsListing(source: Source) {
  return source === "listing" || source === "award";
}

export function outputAllowed(output: Output, source: Source) {
  return output !== "carousel" || needsListing(source);
}

export function formatFor(output: Output, format: FormatId): FormatId {
  if (output === "story") return "story";
  if (output === "carousel") return "ig_portrait";
  return FEED_FORMATS.includes(format) ? format : "ig_portrait";
}

/** Each template's fields with its defaults, for a fresh editor. */
export function initialFields(): Record<TemplateId, Fields> {
  return Object.fromEntries(
    TEMPLATE_IDS.map((t) => [t, Object.fromEntries(TEMPLATES[t].fields.map((f) => [f.key, (TEMPLATES[t].defaults as Fields)[f.key] ?? ""]))]),
  ) as Record<TemplateId, Fields>;
}

/** Only the filled-in fields, trimmed (the server fills the rest with the template's defaults). */
export function filledFields(fields: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    const t = v?.trim();
    if (t) out[k] = t;
  }
  return out;
}

/** "https://www.floema.com/work" → "floema.com". */
export function hostOf(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
}

/** Glass (backdrop and frost) and "auto" (the palette picked from the screenshot) need server-made assets. */
export function needsAssets(style: Style, palette: string) {
  return style === "glass" || palette === "auto";
}

/** GET /api/graphics/assets for one preview, or null when it needs none. */
export function assetsUrl(o: { style: Style; palette: string; glass: GlassId; format: FormatId; shot: string | null }) {
  if (!needsAssets(o.style, o.palette)) return null;
  // "auto" without a screenshot has nothing to pick colours from (the preview falls back), and flat styles need nothing else.
  if (o.style !== "glass" && !o.shot) return null;
  const q = new URLSearchParams({ palette: o.palette, glass: o.glass, format: o.format });
  if (o.shot) q.set("shot", o.shot);
  return `/api/graphics/assets?${q.toString()}`;
}

/** The carousel's own text (the rest comes from the listing). */
export const CAROUSEL_FIELDS = [
  { key: "quote", label: "Jury quote", long: true, placeholder: "What the jury said" },
  { key: "juror", label: "Juror", placeholder: "Name" },
  { key: "role", label: "Juror role", placeholder: "Creative director" },
  { key: "cta", label: "Last slide headline", placeholder: "See the whole site on Shemoqmedi." },
] as const;

export type Design = {
  source: Source;
  output: Output;
  template: TemplateId;
  format: FormatId;
  style: Style;
  palette: PaletteChoice;
  glass: GlassId;
  fields: Fields;
  carouselFields: Fields;
  shot: string | null;
  listingId: string | null;
};

/** graphics.renderForPost's arguments for a design (listingId typed by the caller). */
export function renderArgs(d: Design) {
  const glass = d.style === "glass" ? d.glass : undefined;
  if (d.output === "carousel") {
    return {
      template: "new_listing",
      format: "ig_portrait",
      palette: d.palette,
      style: d.style,
      glass,
      fields: filledFields(d.carouselFields),
      carousel: true as const,
      listingId: d.listingId ?? undefined,
    };
  }
  const slots: readonly string[] = TEMPLATES[d.template].images;
  return {
    template: d.template,
    format: formatFor(d.output, d.format),
    palette: d.palette,
    style: d.style,
    glass,
    fields: filledFields(d.fields),
    imageUrls: slots.includes("screenshot") && d.shot ? [d.shot] : undefined,
    carousel: undefined,
    listingId: undefined,
  };
}

/** A key that changes whenever the final render would (to mark an old render stale). */
export function renderKey(d: Design) {
  return JSON.stringify(renderArgs(d));
}

/** The post kind for a source. Listing posts made here are "custom": approving a "new_listing" post emails the studio. */
export function kindFor(source: Source) {
  switch (source) {
    case "award":
      return "award" as const;
    case "announcement":
      return "announcement" as const;
    case "call_submissions":
      return "call_submissions" as const;
    case "call_jury":
      return "call_jury" as const;
    default:
      return "custom" as const;
  }
}

export function isStyleId(x: string): x is Style {
  return (STYLES as readonly string[]).includes(x);
}

export function formatSize(format: FormatId) {
  return FORMATS[format];
}
