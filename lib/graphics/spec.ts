// What the social graphics renderer (app/api/graphics) accepts: templates,
// their text fields and image slots, and the output formats. Image slots are
// optional: calls and announcements use a screenshot only as a blurred
// backdrop, and draw a soft palette gradient without one. Plain data, so
// the Design page, the route and Convex (convex/graphics.ts) share it.

export const FORMATS = {
  ig_portrait: { label: "Instagram feed", width: 1080, height: 1350 },
  square: { label: "Square", width: 1080, height: 1080 },
  story: { label: "Story", width: 1080, height: 1920 },
  /** 9:16, with everything that matters inside the 3:4 crop the profile grid shows. */
  reel_cover: { label: "Reel cover", width: 1080, height: 1920 },
  link: { label: "Link post (LinkedIn, Facebook)", width: 1200, height: 627 },
} as const;

export type FormatId = keyof typeof FORMATS;
export const FORMAT_IDS = Object.keys(FORMATS) as FormatId[];

export const TIERS = {
  SOTD: "Site of the Day",
  HM: "Honorable Mention",
  SOTM: "Site of the Month",
  SOTY: "Site of the Year",
  BSC: "Best Solo Creation",
  F100: "First 100",
} as const;

export type Tier = keyof typeof TIERS;
export const TIER_IDS = Object.keys(TIERS) as Tier[];

export type FieldSpec = {
  key: string;
  label: string;
  /** Shown in the editor as a multi-line box. */
  long?: boolean;
  /** One of these values (rendered as a select). */
  options?: readonly string[];
  placeholder?: string;
};

export type TemplateSpec = {
  label: string;
  fields: readonly FieldSpec[];
  /**
   * Image slots, in order. `imageUrls[i]` of graphics.render fills slot i;
   * the route takes each as a query parameter of the same name.
   */
  images: readonly string[];
  /** Filled in when a field is left empty. */
  defaults: Readonly<Record<string, string>>;
};

export const TEMPLATES = {
  award: {
    label: "Award",
    fields: [
      { key: "tier", label: "Tier", options: TIER_IDS },
      { key: "title", label: "Site title" },
      { key: "studio", label: "Studio" },
      { key: "date", label: "Date", placeholder: "12 Nov 2026" },
      { key: "awardSlug", label: "Award slug (for the badge)", placeholder: "floema-sotd-2026-11-12" },
      { key: "url", label: "Site address", placeholder: "floema.com" },
    ],
    images: ["screenshot", "badge"],
    defaults: { tier: "SOTD", title: "Site title", studio: "Studio" },
  },
  new_listing: {
    label: "New listing",
    fields: [
      { key: "title", label: "Site title" },
      { key: "studio", label: "Studio" },
      { key: "tagline", label: "Tagline", long: true },
      { key: "url", label: "Site address", placeholder: "floema.com" },
    ],
    images: ["screenshot"],
    defaults: { title: "Site title", studio: "Studio", kicker: "New on Shemoqmedi" },
  },
  call_submissions: {
    label: "Call for submissions",
    fields: [
      { key: "headline", label: "Headline", long: true },
      { key: "body", label: "Body", long: true },
      { key: "cta", label: "Call to action URL", placeholder: "shemoqmedi.space/submit" },
    ],
    images: ["screenshot"],
    defaults: {
      kicker: "Call for submissions",
      headline: "Show us the site you’re proud of.",
      body: "Every submission is reviewed by hand and scored by an independent jury.",
      cta: "shemoqmedi.space/submit",
    },
  },
  call_jury: {
    label: "Call for jury",
    fields: [
      { key: "headline", label: "Headline", long: true },
      { key: "body", label: "Body", long: true },
      { key: "cta", label: "Call to action URL", placeholder: "shemoqmedi.space/jury" },
    ],
    images: ["screenshot"],
    defaults: {
      kicker: "Call for jury",
      headline: "Judge the web’s finest websites.",
      body: "We’re inviting designers and developers to score new sites each week.",
      cta: "shemoqmedi.space/jury",
    },
  },
  announcement: {
    label: "Announcement",
    fields: [
      { key: "kicker", label: "Kicker", placeholder: "Announcement" },
      { key: "headline", label: "Headline", long: true },
      { key: "body", label: "Body", long: true },
      { key: "cta", label: "Call to action URL", placeholder: "shemoqmedi.space" },
    ],
    images: ["screenshot"],
    defaults: { kicker: "Announcement", headline: "Headline", body: "", cta: "shemoqmedi.space" },
  },
  jury_quote: {
    label: "Jury quote",
    fields: [
      { key: "quote", label: "Quote", long: true },
      { key: "juror", label: "Juror name" },
      { key: "role", label: "Juror role", placeholder: "Designer, Studio" },
      { key: "site", label: "Site title" },
      { key: "score", label: "Jury score (optional)", placeholder: "8.4" },
    ],
    images: ["screenshot"],
    defaults: { quote: "Quote", juror: "Juror", site: "" },
  },
  screenshot: {
    label: "Screenshot slide",
    fields: [
      { key: "title", label: "Site title" },
      { key: "studio", label: "Studio" },
      { key: "url", label: "Site address", placeholder: "floema.com" },
      { key: "index", label: "Slide number", placeholder: "2 / 5" },
    ],
    images: ["screenshot"],
    defaults: {},
  },
} as const satisfies Record<string, TemplateSpec>;

export type TemplateId = keyof typeof TEMPLATES;
export const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[];

export function isTemplate(x: string | null | undefined): x is TemplateId {
  return !!x && x in TEMPLATES;
}

export function isFormat(x: string | null | undefined): x is FormatId {
  return !!x && x in FORMATS;
}

/** The query string the route reads, from template + format + palette + fields + named images. */
export function graphicsQuery(input: {
  template: string;
  format: string;
  palette: string;
  fields?: Record<string, string | undefined>;
  images?: Record<string, string | undefined>;
}) {
  const q = new URLSearchParams({ template: input.template, format: input.format, palette: input.palette });
  for (const [k, v] of Object.entries({ ...input.fields, ...input.images })) {
    if (v && v.trim()) q.set(k, v.trim());
  }
  return q.toString();
}
