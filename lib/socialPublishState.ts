// Where a social post's publishing stands, for the admin Social page
// (components/admin/SocialQueue.tsx). Decided on the client against a ticking
// clock: a Convex query is not re-run as time passes, so a lease that ran out
// after a publish run died would otherwise keep showing "publishing now".

type PostLike = {
  status: string;
  results: { network: string; status: string }[];
  publishingUntil: number | null;
  captions: Partial<Record<"facebook" | "instagram" | "threads" | "linkedin", string>>;
};

const NETWORKS = ["facebook", "instagram", "threads", "linkedin"] as const;

export function publishState(post: PostLike, now: number) {
  const publishing = post.publishingUntil !== null && post.publishingUntil > now;
  // A run that claimed the post and never finished (timed out or crashed).
  const stalled = post.status === "scheduled" && post.publishingUntil !== null && !publishing;
  // Approved before publishing existed: nothing was published from here (social.isLegacyApproved).
  const legacy = post.status === "approved" && post.results.length === 0;
  const sent = new Set(post.results.filter((r) => r.status === "sent").map((r) => r.network));
  const canRetry =
    !publishing &&
    !legacy &&
    (post.status === "failed" || post.status === "approved" || post.status === "sent" || stalled) &&
    NETWORKS.some((n) => post.captions[n] && !sent.has(n));
  return { publishing, stalled, legacy, canRetry };
}
