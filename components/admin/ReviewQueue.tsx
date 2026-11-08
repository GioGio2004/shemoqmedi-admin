"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatDate } from "@/lib/storefront";
import {
  SOURCE_LABEL,
  awardName,
  score,
  shortUrl,
  tierLabel,
  type AwardSlug,
  type ListingStatus,
} from "./format";

export type ReviewStatus = ListingStatus;

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: "In review",
  in_voting: "Live voting",
  awarded: "Awarded",
  archived: "Closed",
  rejected: "Rejected",
};

const TABS: { status: ReviewStatus; label: string }[] = [
  { status: "pending", label: "Waiting" },
  { status: "in_voting", label: "Live voting" },
  { status: "awarded", label: "Awarded" },
  { status: "archived", label: "Closed" },
  { status: "rejected", label: "Rejected" },
];

const EMPTY: Record<ReviewStatus, { title: string; body: string }> = {
  pending: { title: "All caught up.", body: "No submissions are waiting for review." },
  in_voting: { title: "Nothing in voting.", body: "Approve a submission to open its 7-day window." },
  awarded: { title: "No awards yet.", body: "Awards are assigned when a voting window closes." },
  archived: { title: "Nothing closed yet.", body: "Sites that close without an award land here." },
  rejected: { title: "Nothing rejected.", body: "Rejected and unpublished sites land here." },
};

export function StatusBadge({ status }: { status: ReviewStatus }) {
  return (
    <span className="admin-status" data-status={status}>
      <span className="admin-status-dot" aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function AwardBadges({ awards }: { awards: AwardSlug[] }) {
  if (awards.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {awards.map((a) => (
        <span key={a} className="admin-award" title={awardName(a)}>
          {a}
        </span>
      ))}
    </span>
  );
}

export function ReviewQueue({ status }: { status: ReviewStatus }) {
  const counts = useQuery(api.listings.reviewCounts, {});
  const rows = useQuery(api.listings.reviewQueue, { status });

  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p className="admin-eyebrow">02 / Review</p>
          <h1>Listings.</h1>
          <p>
            Approve a submission to open its 7-day voting window. Awards are assigned when the
            window closes.
          </p>
        </div>
        <nav className="admin-tabs" aria-label="Filter by status">
          {TABS.map((tab) => (
            <Link
              key={tab.status}
              href={`/review?status=${tab.status}`}
              aria-current={tab.status === status ? "page" : undefined}
            >
              {tab.label}
              <span>{counts ? counts[tab.status] : "·"}</span>
            </Link>
          ))}
        </nav>
      </div>

      {rows === undefined ? (
        <p className="admin-eyebrow">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="admin-empty">
          <h2>{EMPTY[status].title}</h2>
          {EMPTY[status].body}
        </div>
      ) : (
        <ul className="request-list">
          {rows.map((row) => (
            <li key={row.id}>
              <Link href={`/review/${row.id}`} className="request-list-card">
                <div className="request-thumb">
                  {row.coverUrl && <img src={row.coverUrl} alt="" />}
                </div>
                <div className="min-w-0">
                  <p className="admin-eyebrow">{row.categoryNames.join(" · ")}</p>
                  <h2>{row.title}</h2>
                  <p>{shortUrl(row.url)}</p>
                </div>
                <div className="min-w-0">
                  <p>
                    {row.creditName}{" "}
                    <span className="admin-mono ml-1">{tierLabel(row.creatorTier)}</span>
                  </p>
                  <p>
                    {row.source === "submission"
                      ? row.submitter
                        ? `${row.submitter.name} · ${row.submitter.email}`
                        : "Unknown submitter"
                      : SOURCE_LABEL[row.source]}
                  </p>
                  <p>
                    {row.status === "in_voting" && row.votingEndsAt
                      ? `Voting ends ${formatDate(row.votingEndsAt)}`
                      : `Added ${formatDate(row.createdAt)}`}
                  </p>
                </div>
                <div className="request-card-end">
                  <AwardBadges awards={row.awards} />
                  {row.finalScore !== null && (
                    <span className="admin-mono admin-score">
                      <span className="sr-only">Final score </span>
                      {score(row.finalScore)}
                    </span>
                  )}
                  <StatusBadge status={row.status} />
                  <span className="admin-arrow" aria-hidden="true">↗</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
