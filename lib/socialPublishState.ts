// Where a social post's publishing stands, for the admin Social page
// (components/admin/SocialQueue.tsx) and the Studio queue. Decided on the
// client against a ticking clock: a Convex query is not re-run as time
// passes, so a lease that ran out after a publish run died would otherwise
// keep showing "publishing now".

import { retryableNetworks } from "@/convex/lib/socialApi";

type PostLike = {
  status: string;
  results: { network: string; status: string }[];
  publishingUntil: number | null;
  captions: Partial<Record<"facebook" | "instagram" | "threads" | "linkedin", string>>;
  /** "story" or "feed" (absent: feed). */
  placement?: string | null;
  /** The post's files and which networks each is for (absent: not known, only the stories rule applies). */
  media?: { networks?: readonly string[] }[];
};

export function publishState(post: PostLike, now: number) {
  const publishing = post.publishingUntil !== null && post.publishingUntil > now;
  // A run that claimed the post and never finished (timed out or crashed).
  const stalled = post.status === "scheduled" && post.publishingUntil !== null && !publishing;
  // Approved before publishing existed: nothing was published from here (social.isLegacyApproved).
  const legacy = post.status === "approved" && post.results.length === 0;
  // The same rule as social.retryPost: a network a story never reaches, or one without media for it, isn't retried.
  const canRetry =
    !publishing &&
    !legacy &&
    (post.status === "failed" || post.status === "approved" || post.status === "sent" || stalled) &&
    retryableNetworks(post).length > 0;
  return { publishing, stalled, legacy, canRetry };
}
