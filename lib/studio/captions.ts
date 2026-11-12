// Captions in the Studio: the four networks, their limits and the live
// counters. Lengths are counted as the server counts them before it accepts
// an edit (convex/social.ts editPost): trimmed, and Threads counts emoji as
// their UTF-8 bytes (threadsLength, shared with the publisher).

import { threadsLength } from "@/convex/lib/socialApi";

export type Network = "instagram" | "facebook" | "threads" | "linkedin";
export type Captions = Partial<Record<Network, string>>;

/** Display order: Instagram first, it is where most posts go. */
export const NETWORKS: Network[] = ["instagram", "facebook", "threads", "linkedin"];

export const NETWORK_LABEL: Record<Network, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  threads: "Threads",
  linkedin: "LinkedIn",
};

export const NETWORK_SHORT: Record<Network, string> = { instagram: "IG", facebook: "FB", threads: "TH", linkedin: "IN" };

/** Keep equal to CAPTION_MAX in convex/social.ts (tests/studioHelpers.test.ts checks). */
export const CAPTION_MAX: Record<Network, number> = { facebook: 3000, instagram: 2200, threads: 500, linkedin: 3000 };

/** Stories go to these two only (convex/lib/socialApi.ts STORY_NETWORKS). */
export const STORY_NETWORKS: Network[] = ["instagram", "facebook"];

/** A caption's length as its network counts it. */
export function captionLength(network: Network, text: string) {
  const clean = text.trim();
  return network === "threads" ? threadsLength(clean) : clean.length;
}

export type Counter = {
  length: number;
  max: number;
  /** Over the limit: the server refuses the save. */
  over: boolean;
  /** In the last 10%. */
  near: boolean;
  /** Threads counted emoji as bytes, so the number is above the character count. */
  bytes: boolean;
};

export function captionCounter(network: Network, text: string): Counter {
  const length = captionLength(network, text);
  const max = CAPTION_MAX[network];
  return { length, max, over: length > max, near: length > max * 0.9 && length <= max, bytes: length !== text.trim().length };
}

/** The networks a post goes to: the ones with a caption. */
export function captionedNetworks(captions: Captions): Network[] {
  return NETWORKS.filter((n) => !!captions[n]?.trim());
}

/** Whether every caption fits its network. */
export function captionsFit(captions: Captions) {
  return NETWORKS.every((n) => !captionCounter(n, captions[n] ?? "").over);
}

/** Two caption sets differ (blank and missing are the same). */
export function captionsDiffer(a: Captions, b: Captions) {
  return NETWORKS.some((n) => (a[n] ?? "").trim() !== (b[n] ?? "").trim());
}

/**
 * What social.update / social.create get: every network, blank ones as ""
 * (the server removes those), so a cleared caption is really cleared.
 */
export function captionsForSave(captions: Captions): Record<Network, string> {
  return Object.fromEntries(NETWORKS.map((n) => [n, (captions[n] ?? "").trim()])) as Record<Network, string>;
}

/** Cut `text` to fit `network`, on a word boundary when one is close. */
export function fitCaption(network: Network, text: string) {
  const max = CAPTION_MAX[network];
  if (captionLength(network, text) <= max) return text.trim();
  // Every character counts at least 1, so the first `max` characters are an upper bound.
  let cut = [...text.trim()].slice(0, max).join("");
  while (cut && captionLength(network, `${cut}…`) > max) cut = [...cut].slice(0, -1).join("");
  const space = cut.lastIndexOf(" ");
  if (space > cut.length - 40) cut = cut.slice(0, space);
  return `${cut.trimEnd()}…`;
}
