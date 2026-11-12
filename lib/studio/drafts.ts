// First-draft captions for a post made in the Studio, written from the same
// facts the graphic shows. Plain and short, in the house voice (no hype, no
// emoji); every one fits its network. They are only a start: the Create
// page shows them in editable boxes.

import { fitCaption, type Captions, type Network } from "./captions";

export type DraftSource = "listing" | "award" | "announcement" | "call_submissions" | "call_jury" | "free";

export type DraftFacts = {
  title?: string;
  studio?: string;
  tagline?: string;
  /** The listing's page on the storefront. */
  pageUrl?: string;
  /** "Site of the Day". */
  tierName?: string;
  /** "12 Nov 2026". */
  date?: string;
  headline?: string;
  body?: string;
  /** "shemoqmedi.space/submit" or a full URL. */
  cta?: string;
};

const HASHTAGS = "#webdesign #webdevelopment #shemoqmedi";

const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** A sentence ends in punctuation. */
function sentence(s: string | undefined) {
  const t = clean(s);
  if (!t) return "";
  return /[.!?…:]$/.test(t) ? t : `${t}.`;
}

/** "shemoqmedi.space/submit" → "https://shemoqmedi.space/submit"; "" stays "". */
export function asUrl(s: string | undefined) {
  const t = clean(s);
  if (!t) return "";
  return /^https?:\/\//i.test(t) ? t : `https://${t.replace(/^\/+/, "")}`;
}

function join(...parts: (string | false | undefined)[]) {
  return parts.filter((p): p is string => !!p && !!p.trim()).join("\n\n");
}

/** "Floema by Studio X" (or just one of them). */
function byline(f: DraftFacts) {
  const title = clean(f.title);
  const studio = clean(f.studio);
  return title && studio ? `${title} by ${studio}` : title || studio;
}

function siteDrafts(lead: string, f: DraftFacts, linkedinLead: string): Record<Network, string> {
  const tagline = sentence(f.tagline);
  const url = asUrl(f.pageUrl);
  return {
    instagram: join(sentence(lead), tagline, "Reviewed by hand and scored by an independent jury. The full site is linked in our bio.", HASHTAGS),
    facebook: join(sentence(lead), tagline, url),
    threads: [sentence(lead), tagline, url].filter(Boolean).join(" "),
    linkedin: join(sentence(linkedinLead), tagline, "Every site on Shemoqmedi is reviewed by hand and scored by an independent jury of designers and developers.", url),
  };
}

function textDrafts(f: DraftFacts, fallbackHeadline: string): Record<Network, string> {
  const headline = sentence(f.headline) || sentence(fallbackHeadline);
  const body = sentence(f.body);
  const url = asUrl(f.cta);
  return {
    instagram: join(headline, body, url && "Link in bio.", HASHTAGS),
    facebook: join(headline, body, url),
    threads: [headline, body, url].filter(Boolean).join(" "),
    linkedin: join(headline, body, url),
  };
}

/** Drafts for every network (each within its limit). */
export function draftCaptions(source: DraftSource, f: DraftFacts): Captions {
  let drafts: Record<Network, string>;
  switch (source) {
    case "award": {
      const tier = clean(f.tierName) || "Award";
      const date = clean(f.date);
      drafts = siteDrafts(`${tier}: ${byline(f)}`, f, `${byline(f)} is the Shemoqmedi ${tier}${date ? ` for ${date}` : ""}`);
      break;
    }
    case "listing":
      drafts = siteDrafts(`New on Shemoqmedi: ${byline(f)}`, f, `New on Shemoqmedi: ${byline(f)}`);
      break;
    case "call_submissions":
      drafts = textDrafts({ ...f, cta: f.cta || "shemoqmedi.space/submit" }, "Show us the site you're proud of");
      break;
    case "call_jury":
      drafts = textDrafts({ ...f, cta: f.cta || "shemoqmedi.space/jury" }, "Judge the web's finest websites");
      break;
    default:
      drafts = textDrafts(f, "News from Shemoqmedi");
  }
  return Object.fromEntries(Object.entries(drafts).map(([n, text]) => [n, fitCaption(n as Network, text)])) as Captions;
}

/**
 * Stories show no text: the caption only picks the network. A short label
 * is enough (the post's title), never empty.
 */
export function storyCaption(f: DraftFacts) {
  return clean(f.title) || clean(f.headline) || "Story";
}
