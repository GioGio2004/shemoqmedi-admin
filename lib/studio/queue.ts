// The Studio queue: its tabs, labels, and which actions a post offers. Pure,
// so the rules are unit tested (tests/studioHelpers.test.ts) and match the
// server's (convex/social.ts publishPost, unschedulePost, rejectPost, retryPost).

import { publishState } from "@/lib/socialPublishState";
import type { Captions } from "./captions";

export type QueueTab = "waiting" | "scheduled" | "sent" | "failed" | "approved" | "rejected" | "all";

export const QUEUE_TABS: { id: QueueTab; label: string }[] = [
  { id: "waiting", label: "Waiting" },
  { id: "scheduled", label: "Scheduled" },
  { id: "sent", label: "Sent" },
  { id: "failed", label: "Failed" },
  { id: "approved", label: "Not connected" },
  { id: "rejected", label: "Rejected" },
  { id: "all", label: "All" },
];

/** ?status= from a link (old /social links included); anything unknown is the waiting tab. */
export function parseQueueTab(value: string | string[] | undefined | null): QueueTab {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === "pending" || v === "skipped") return "waiting";
  return QUEUE_TABS.find((t) => t.id === v)?.id ?? "waiting";
}

export const KIND_LABEL: Record<string, string> = {
  award: "Award",
  new_listing: "New listing",
  call_submissions: "Call for submissions",
  call_jury: "Call for jurors",
  roundup: "Weekly roundup",
  announcement: "Announcement",
  custom: "Post",
};

export const STATUS_LABEL: Record<string, string> = {
  waiting: "Waiting",
  approved: "Not connected",
  scheduled: "Scheduled",
  sent: "Sent",
  failed: "Failed",
  rejected: "Rejected",
  pending: "Waiting",
  skipped: "Waiting",
};

export type QueuePostLike = {
  status: string;
  placement: "feed" | "story";
  captions: Captions;
  results: { network: string; status: string }[];
  publishingUntil: number | null;
  scheduledFor: number | null;
};

export type PostActions = {
  /** A publish run holds the post right now: nothing can be done until it ends. */
  publishing: boolean;
  publishNow: boolean;
  /** Pick a time (or a new one for a scheduled post). */
  schedule: boolean;
  unschedule: boolean;
  retry: boolean;
  reject: boolean;
  /** Captions can be edited (approved/scheduled/failed posts go back to waiting). */
  edit: boolean;
  /** Editing sends this post back to waiting first. */
  editResets: boolean;
};

const NONE: PostActions = {
  publishing: false,
  publishNow: false,
  schedule: false,
  unschedule: false,
  retry: false,
  reject: false,
  edit: false,
  editResets: false,
};

export function postActions(post: QueuePostLike, now: number): PostActions {
  const state = publishState(post, now);
  if (state.publishing) return { ...NONE, publishing: true };
  const status = post.status === "pending" || post.status === "skipped" ? "waiting" : post.status;
  switch (status) {
    case "waiting":
      return { ...NONE, publishNow: true, schedule: true, reject: true, edit: true };
    case "scheduled":
      // A run that claimed the post and died: retry it (sent networks stay sent).
      if (state.stalled) return { ...NONE, retry: true, reject: true };
      return { ...NONE, publishNow: true, schedule: true, unschedule: true, reject: true, edit: true, editResets: true };
    case "failed":
    case "approved":
      return { ...NONE, retry: state.canRetry, reject: true, edit: true, editResets: true };
    case "sent":
      // Networks skipped for lack of an account can still go out.
      return { ...NONE, retry: state.canRetry };
    default:
      return NONE;
  }
}

/** The soonest scheduled post (one without a time is publishing as soon as possible: it comes first). */
export function nextScheduled<T extends { status: string; scheduledFor: number | null; approvedAt?: number | null }>(posts: T[]): T | null {
  const scheduled = posts.filter((p) => p.status === "scheduled");
  if (scheduled.length === 0) return null;
  return [...scheduled].sort((a, b) => (a.scheduledFor ?? 0) - (b.scheduledFor ?? 0))[0];
}
