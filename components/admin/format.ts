import { ConvexError } from "convex/values";
import { AWARDS, CREATOR_TIERS, REGIONS } from "@/convex/lib/taxonomy";
import { STOREFRONT_URL } from "@/lib/storefront";

// Status lists live here (not in the "use client" components) because server
// pages need them too: a value imported from a client module is only a client
// reference on the server, not the real array.
export type ListingStatus = "pending" | "in_voting" | "awarded" | "archived" | "rejected";
export const REVIEW_STATUSES: ListingStatus[] = ["pending", "in_voting", "awarded", "archived", "rejected"];

export type ClaimStatus = "pending" | "approved" | "rejected";
export const CLAIM_STATUSES: ClaimStatus[] = ["pending", "approved", "rejected"];
export type ListingSource = "submission" | "import" | "seed";
export type AwardSlug = (typeof AWARDS)[number]["slug"];

/** Readable message from a Convex call: ConvexError data first. */
export function errorMessage(err: unknown): string {
  if (err instanceof ConvexError) {
    return typeof err.data === "string" ? err.data : JSON.stringify(err.data);
  }
  if (err instanceof Error) {
    // Plain errors thrown inside a Convex function arrive wrapped:
    // "[CONVEX A(...)] [Request ID: ...] Server Error\nUncaught Error: <message>\n    at ...".
    const match = err.message.match(/Uncaught Error: ([^\n]+)/);
    if (match) return match[1].trim();
    // Never show the raw wrapper (request ids, stack) for anything else.
    if (err.message.includes("[CONVEX") || err.message.includes("Server Error")) {
      return "Something went wrong on the server. Please try again.";
    }
    return err.message;
  }
  return "Something went wrong.";
}

/** Score in mono-friendly form: two decimals, or a dash. */
export function score(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toFixed(2);
}

export function tierLabel(tier: string): string {
  return CREATOR_TIERS.find((t) => t.slug === tier)?.badge ?? tier;
}

export function regionLabel(region: string): string {
  return REGIONS.find((r) => r.slug === region)?.name ?? region;
}

export function awardName(slug: AwardSlug): string {
  return AWARDS.find((a) => a.slug === slug)?.name ?? slug;
}

export const SOURCE_LABEL: Record<ListingSource, string> = {
  submission: "Submission",
  import: "Imported",
  seed: "Seed",
};

export function storefrontCreatorUrl(slug: string) {
  return `${STOREFRONT_URL}/creators/${slug}`;
}

/** The URL when it is a plain http(s) link, otherwise null (never render javascript: etc.). */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function shortUrl(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
