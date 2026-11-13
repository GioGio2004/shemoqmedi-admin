// What the queue's cards and detail sheet show, worked out from a post.
// Presentational only: which actions a post offers stays in lib/studio/queue.

import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { NETWORKS, NETWORK_LABEL, STORY_NETWORKS, captionedNetworks, type Captions, type Network } from "@/lib/studio/captions";
import { KIND_LABEL, STATUS_LABEL, type PostActions } from "@/lib/studio/queue";
import { isReelItem } from "@/lib/studio/reelPost";
import { formatTbilisi } from "@/lib/studio/time";

export type Post = FunctionReturnType<typeof api.social.queue>[number];
export type Result = Post["results"][number];
export type Channel = FunctionReturnType<typeof api.social.channels>[number];
export type Channels = Partial<Record<Network, Channel>>;

/** The channels query as a map by network (empty while it loads). */
export function channelMap(list: readonly Channel[] | undefined): Channels {
  const out: Channels = {};
  for (const c of list ?? []) out[c.network] = c;
  return out;
}

/** The first caption's first line, when it reads as a title ("Hello, we're Shemoqmedi."). */
export function captionTitle(captions: Captions | undefined) {
  const text = NETWORKS.map((n) => captions?.[n]?.trim()).find(Boolean);
  const line = text?.split("\n")[0].trim();
  return line && line.length >= 3 && line.length <= 90 ? line : null;
}

/**
 * The card's and the sheet's title: the listing, the headline, the caption's
 * first line, or the kind (the kind alone repeats the line under the title).
 */
export function postTitle(post: Post, captions: Captions | undefined = (post as { captions?: Captions }).captions) {
  const facts = post.facts;
  const headline = facts && typeof facts === "object" && "headline" in facts ? String((facts as { headline: unknown }).headline) : null;
  return post.listing?.title ?? headline ?? captionTitle(captions) ?? KIND_LABEL[post.kind] ?? "Post";
}

/** "Story", "Carousel · 6", "Reel", "Video", "Feed". */
export function formatText(post: Post) {
  if (post.placement === "story") return "Story · 9:16";
  if (post.media.length > 1) return `Carousel · ${post.media.length}`;
  if (post.media[0]?.kind === "video") return isReelItem(post.media[0]) ? "Reel" : "Video";
  return "Feed post";
}

/** The first caption as one line (Instagram first). */
export function excerpt(captions: Captions, skipTitleLine = false) {
  let text = NETWORKS.map((n) => captions[n]?.trim()).find(Boolean) ?? "";
  // The first line is already the title: start the excerpt after it.
  if (skipTitleLine) text = text.split("\n").slice(1).join("\n").trim();
  return text.replace(/\s*\n+\s*/g, " ");
}

/** "Instagram and Facebook", "Instagram, Facebook and Threads". */
export function listNames(networks: readonly Network[]) {
  const names = networks.map((n) => NETWORK_LABEL[n]);
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The networks a post goes to (a story only reaches Instagram and Facebook). */
export function targetNetworks(post: Post, captions: Captions) {
  const nets = captionedNetworks(captions);
  return post.placement === "story" ? nets.filter((n) => STORY_NETWORKS.includes(n)) : nets;
}

export type StatusKey = "waiting" | "scheduled" | "sent" | "failed" | "approved" | "rejected" | "publishing";

export function statusKey(post: Post, actions: PostActions): StatusKey {
  if (actions.publishing) return "publishing";
  return post.status;
}

export function statusWord(key: StatusKey) {
  return key === "publishing" ? "Publishing" : (STATUS_LABEL[key] ?? key);
}

/** The short line in the card's glass pill: when it goes, or went. */
export function whenText(post: Post, key: StatusKey, now: number) {
  switch (key) {
    case "publishing":
      return "Publishing now";
    case "waiting":
      return post.scheduledFor ? formatTbilisi(post.scheduledFor, now) : "Ready now";
    case "scheduled":
      return post.scheduledFor ? formatTbilisi(post.scheduledFor, now) : "As soon as possible";
    case "sent":
      return post.sentAt ? formatTbilisi(post.sentAt, now) : "Sent";
    case "failed":
      return "Not sent";
    case "approved":
      return "No account";
    case "rejected":
      return "Rejected";
  }
}

/**
 * Each network for the glyph row: on (it goes, or went, there), off, or not
 * connected (from the channels query; unknown while it loads counts as connected).
 */
export function networkStates(post: Post, captions: Captions, channels: Channels) {
  const went = post.results.length > 0 && (post.status === "sent" || post.status === "failed") ? new Set(post.results.filter((r) => r.status === "sent").map((r) => r.network)) : null;
  const targets = new Set(targetNetworks(post, captions));
  return NETWORKS.map((n) => {
    const connected = channels[n]?.connected ?? true;
    const on = connected && (went ? went.has(n) : targets.has(n));
    const label = !connected ? `${NETWORK_LABEL[n]}: not connected` : `${NETWORK_LABEL[n]}: ${went ? (on ? "sent" : "not sent") : on ? "on" : "off"}`;
    return { network: n, connected, on, label };
  });
}

/** The account name a preview shows for a network. */
export function accountName(channels: Channels, network: "instagram" | "facebook") {
  const account = channels[network]?.connected ? channels[network]?.account : null;
  if (account && !/^\d+$/.test(account)) return account.replace(/^@/, "");
  return network === "instagram" ? "shemoqmedi.voloostudio" : "Shemoqmedi.space";
}
